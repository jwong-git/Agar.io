import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import sirv from "sirv";
import { CONFIG } from "../shared/config";
import { radiusOf, speedOf, aoiHalfExtent } from "../shared/math";
import { SpatialGrid } from "./spatial-grid";
import type {
  ClientMessage,
  ServerMessage,
  CellSnapshot,
  FoodSnapshot,
  BlobSnapshot,
  VirusSnapshot,
  MotherSnapshot,
  SpeedCellSnapshot,
  ExplosiveSnapshot,
  AntiAgingSnapshot,
  MagnetSnapshot,
  LeaderboardEntry,
} from "../shared/protocol";

interface Cell {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  mass: number;
  vx: number;
  vy: number;
  mergeAt: number;
  raged: boolean;
}

interface ServerPlayer {
  id: string;
  socket: WebSocket;
  name: string;
  color: string;
  targetX: number;
  targetY: number;
  splitWanted: boolean;
  ejectWanted: boolean;
  // speed buff is player-wide: all of the player's cells move faster while active
  speedBuffUntil: number;
  // anti-aging buff is player-wide: all of the player's cells decay slower while active
  antiAgingUntil: number;
  // magnet buff is player-wide: all of the player's cells pull in nearby food while active
  magnetUntil: number;
}

interface ServerFood {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  // friction applied per tick while moving (mother-shot food); randomized per shot
  friction: number;
  // true for mother-minted food: removed (not respawned) when eaten, so it doesn't
  // permanently inflate the field. base field food is false and respawns on eat.
  transient: boolean;
  // set on NATURAL mother food only: the mother that minted it, so eating the pellet
  // frees that mother's per-mother cap (spawnedFood). null for base field food AND
  // for uncapped bonus food (which is intentionally never counted against the cap).
  source: Mother | null;
}

interface MassBlob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
}

interface Virus {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fedCount: number;
  lastFedAngle: number;
}

interface Mother {
  x: number;
  y: number;
  spawnTimer: number;
  // mass eaten from player cells (90% of their mass), drained as the mother
  // converts it into extra food. Drives the mother's size and spawn rate.
  consumedMass: number;
  // count of this mother's minted food currently alive (per-mother spawn cap)
  spawnedFood: number;
}

interface SpeedCellEntity {
  x: number;
  y: number;
}

interface Explosive {
  x: number;
  y: number;
}

interface AntiAgingEntity {
  x: number;
  y: number;
}

interface MagnetEntity {
  x: number;
  y: number;
}

const players = new Map<string, ServerPlayer>();
const socketToPlayer = new Map<WebSocket, ServerPlayer>();
const cells: Cell[] = [];
const food: ServerFood[] = [];
const blobs: MassBlob[] = [];
const viruses: Virus[] = [];
const mothers: Mother[] = [];
const speedCells: SpeedCellEntity[] = [];
const explosives: Explosive[] = [];
const antiAgings: AntiAgingEntity[] = [];
const magnets: MagnetEntity[] = [];
const speedCellRespawnQueue: number[] = [];
const explosiveRespawnQueue: number[] = [];
const antiAgingRespawnQueue: number[] = [];
const magnetRespawnQueue: number[] = [];

let nextCellId = 1;
const newCellId = (): string => `c${nextCellId++}`;

const randomColor = (): string =>
  `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`;

function validHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function randomPosition(): { x: number; y: number } {
  const margin = 200;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
  };
}

function randomFoodFriction(): number {
  const { foodFrictionMin, foodFrictionMax } = CONFIG.mother;
  return foodFrictionMin + Math.random() * (foodFrictionMax - foodFrictionMin);
}

function spawnFood(): ServerFood {
  return {
    x: Math.random() * CONFIG.world.width,
    y: Math.random() * CONFIG.world.height,
    vx: 0,
    vy: 0,
    color: randomColor(),
    friction: CONFIG.mother.foodFrictionMin,
    transient: false,
    source: null,
  };
}

function spawnVirus(): Virus {
  const margin = 150;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
    vx: 0,
    vy: 0,
    fedCount: 0,
    lastFedAngle: 0,
  };
}

function spawnMother(): Mother {
  const margin = 300;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
    spawnTimer: CONFIG.mother.spawnInterval,
    consumedMass: 0,
    spawnedFood: 0,
  };
}

// the mother's effective mass (and thus size/collision radius) grows with the
// pool of mass it has eaten and not yet converted back into food.
function motherEffectiveMass(m: Mother): number {
  return CONFIG.mother.mass + m.consumedMass * CONFIG.mother.consumedSizeFactor;
}

function spawnSpeedCell(): SpeedCellEntity {
  const margin = 150;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
  };
}

function spawnExplosive(): Explosive {
  const margin = 150;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
  };
}

function spawnAntiAging(): AntiAgingEntity {
  const margin = 150;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
  };
}

function spawnMagnet(): MagnetEntity {
  const margin = 150;
  return {
    x: margin + Math.random() * (CONFIG.world.width - 2 * margin),
    y: margin + Math.random() * (CONFIG.world.height - 2 * margin),
  };
}

for (let i = 0; i < CONFIG.food.count; i++) food.push(spawnFood());
for (let i = 0; i < CONFIG.virus.count; i++) viruses.push(spawnVirus());
for (let i = 0; i < CONFIG.mother.count; i++) mothers.push(spawnMother());
for (let i = 0; i < CONFIG.speedCell.count; i++) speedCells.push(spawnSpeedCell());
for (let i = 0; i < CONFIG.explosive.count; i++) explosives.push(spawnExplosive());
for (let i = 0; i < CONFIG.antiAging.count; i++) antiAgings.push(spawnAntiAging());
for (let i = 0; i < CONFIG.magnet.count; i++) magnets.push(spawnMagnet());

const foodGrid = new SpatialGrid<ServerFood>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const blobGrid = new SpatialGrid<MassBlob>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const virusGrid = new SpatialGrid<Virus>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const motherGrid = new SpatialGrid<Mother>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const speedCellGrid = new SpatialGrid<SpeedCellEntity>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const explosiveGrid = new SpatialGrid<Explosive>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const antiAgingGrid = new SpatialGrid<AntiAgingEntity>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);
const magnetGrid = new SpatialGrid<MagnetEntity>(
  CONFIG.world.width,
  CONFIG.world.height,
  CONFIG.spatialGridCellSize,
);

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function spawnPlayerCells(player: ServerPlayer): void {
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].ownerId === player.id) cells.splice(i, 1);
  }
  const pos = randomPosition();
  cells.push({
    id: newCellId(),
    ownerId: player.id,
    x: pos.x,
    y: pos.y,
    mass: CONFIG.player.startMass,
    vx: 0,
    vy: 0,
    mergeAt: 0,
    raged: false,
  });
  player.targetX = pos.x;
  player.targetY = pos.y;
  player.speedBuffUntil = 0;
  player.antiAgingUntil = 0;
  player.magnetUntil = 0;
}

// One HTTP server serves BOTH the built client (static files from dist/) and the
// WebSocket, on a single port — so a single tunnel/host exposes everything and `wss`
// works on the same origin. Static requests are served by sirv; only Upgrade requests
// to the /ws path are handed to the WebSocket server. In dev, Vite serves the client
// on :5173 and proxies /ws here (see vite.config.ts), so this path is identical.
const PORT = Number(process.env.PORT) || CONFIG.port;
const serveStatic = sirv("dist", { single: true });
const httpServer = createServer((req, res) => {
  serveStatic(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (client + ws at /ws)`);
});

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      const name = (msg.name || "Anon").slice(0, 16);
      const requestedColor = validHexColor(msg.color) ? msg.color : null;
      let player = socketToPlayer.get(socket);
      if (!player) {
        const id = randomUUID();
        player = {
          id,
          socket,
          name,
          color: requestedColor ?? randomColor(),
          targetX: 0,
          targetY: 0,
          splitWanted: false,
          ejectWanted: false,
          speedBuffUntil: 0,
          antiAgingUntil: 0,
          magnetUntil: 0,
        };
        players.set(id, player);
        socketToPlayer.set(socket, player);
        send(socket, {
          type: "welcome",
          id,
          world: { width: CONFIG.world.width, height: CONFIG.world.height },
        });
      } else if (requestedColor) {
        player.color = requestedColor;
      }
      player.name = name;
      spawnPlayerCells(player);
    } else {
      const player = socketToPlayer.get(socket);
      if (!player) return;
      if (msg.type === "input") {
        player.targetX = msg.targetX;
        player.targetY = msg.targetY;
      } else if (msg.type === "split") {
        player.splitWanted = true;
      } else if (msg.type === "eject") {
        player.ejectWanted = true;
      }
    }
  });

  socket.on("close", () => {
    const player = socketToPlayer.get(socket);
    if (!player) return;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i].ownerId === player.id) cells.splice(i, 1);
    }
    players.delete(player.id);
    socketToPlayer.delete(socket);
  });
});

const dt = 1 / CONFIG.tickRate;
const tickIntervalMs = 1000 / CONFIG.tickRate;
setInterval(tick, tickIntervalMs);

function tick(): void {
  const now = Date.now();

  for (const p of players.values()) {
    if (p.splitWanted) {
      doSplit(p, now);
      p.splitWanted = false;
    }
    if (p.ejectWanted) {
      doEject(p);
      p.ejectWanted = false;
    }
  }

  for (const c of cells) moveCell(c, now);

  for (const b of blobs) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= CONFIG.eject.friction;
    b.vy *= CONFIG.eject.friction;
    if (Math.abs(b.vx) < 1) b.vx = 0;
    if (Math.abs(b.vy) < 1) b.vy = 0;
    b.x = clamp(b.x, 0, CONFIG.world.width);
    b.y = clamp(b.y, 0, CONFIG.world.height);
  }
  for (const v of viruses) {
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.vx *= CONFIG.virus.friction;
    v.vy *= CONFIG.virus.friction;
    if (Math.abs(v.vx) < 1) v.vx = 0;
    if (Math.abs(v.vy) < 1) v.vy = 0;
    v.x = clamp(v.x, 0, CONFIG.world.width);
    v.y = clamp(v.y, 0, CONFIG.world.height);
  }

  for (const m of mothers) {
    m.spawnTimer -= tickIntervalMs;
    if (m.spawnTimer <= 0) {
      motherSpawnFood(m);
      m.spawnTimer = CONFIG.mother.spawnInterval;
    }
  }

  // move any food with non-zero velocity (mother-shot food). friction slows it
  // each tick; once nearly stopped it snaps to rest and rejoins the static pool.
  for (const f of food) {
    if (f.vx === 0 && f.vy === 0) continue;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vx *= f.friction;
    f.vy *= f.friction;
    if (f.vx * f.vx + f.vy * f.vy < 100) {
      f.vx = 0;
      f.vy = 0;
    }
    if (f.x <= 0) {
      f.x = 0;
      f.vx = 0;
      f.vy = 0;
    } else if (f.x >= CONFIG.world.width) {
      f.x = CONFIG.world.width;
      f.vx = 0;
      f.vy = 0;
    }
    if (f.y <= 0) {
      f.y = 0;
      f.vx = 0;
      f.vy = 0;
    } else if (f.y >= CONFIG.world.height) {
      f.y = CONFIG.world.height;
      f.vx = 0;
      f.vy = 0;
    }
  }

  // process respawn timers for speed cells & explosives
  for (let i = speedCellRespawnQueue.length - 1; i >= 0; i--) {
    if (now >= speedCellRespawnQueue[i]) {
      speedCells.push(spawnSpeedCell());
      speedCellRespawnQueue.splice(i, 1);
    }
  }
  for (let i = explosiveRespawnQueue.length - 1; i >= 0; i--) {
    if (now >= explosiveRespawnQueue[i]) {
      explosives.push(spawnExplosive());
      explosiveRespawnQueue.splice(i, 1);
    }
  }
  for (let i = antiAgingRespawnQueue.length - 1; i >= 0; i--) {
    if (now >= antiAgingRespawnQueue[i]) {
      antiAgings.push(spawnAntiAging());
      antiAgingRespawnQueue.splice(i, 1);
    }
  }
  for (let i = magnetRespawnQueue.length - 1; i >= 0; i--) {
    if (now >= magnetRespawnQueue[i]) {
      magnets.push(spawnMagnet());
      magnetRespawnQueue.splice(i, 1);
    }
  }

  foodGrid.rebuild(food);
  blobGrid.rebuild(blobs);
  virusGrid.rebuild(viruses);
  motherGrid.rebuild(mothers);
  speedCellGrid.rebuild(speedCells);
  explosiveGrid.rebuild(explosives);
  antiAgingGrid.rebuild(antiAgings);
  magnetGrid.rebuild(magnets);

  repelSiblings(now);
  feedViruses();
  applyMagnet(now);
  eatFood();
  sweepEatenFood();
  eatBlobs();
  sweepEatenBlobs();
  eatMothers(now);
  eatSpeedCells(now);
  eatExplosives();
  eatAntiAgings(now);
  eatMagnets(now);
  handleVirusCollisions(now);
  handleRageContacts(now);
  mergeSiblings(now);
  eatOpponents();

  for (const c of cells) {
    const owner = players.get(c.ownerId);
    let rate = CONFIG.player.decayRate;
    if (owner && now < owner.antiAgingUntil) {
      rate *= CONFIG.antiAging.decayMultiplier;
    }
    c.mass *= 1 - rate * dt;
    if (c.mass < CONFIG.player.minMass) c.mass = CONFIG.player.minMass;
  }

  const totalsByOwner = new Map<string, number>();
  for (const c of cells) {
    totalsByOwner.set(c.ownerId, (totalsByOwner.get(c.ownerId) ?? 0) + c.mass);
  }
  const leaderboard: LeaderboardEntry[] = [];
  for (const [id, mass] of totalsByOwner) {
    const p = players.get(id);
    if (!p) continue;
    leaderboard.push({ id, name: p.name, mass: Math.floor(mass) });
  }
  leaderboard.sort((a, b) => b.mass - a.mass);
  leaderboard.length = Math.min(leaderboard.length, 10);

  sendSnapshots(now, leaderboard);
}

function moveCell(c: Cell, now: number): void {
  const owner = players.get(c.ownerId);
  if (!owner) return;

  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.vx *= CONFIG.player.splitFriction;
  c.vy *= CONFIG.player.splitFriction;
  if (Math.abs(c.vx) < 1) c.vx = 0;
  if (Math.abs(c.vy) < 1) c.vy = 0;

  const dx = owner.targetX - c.x;
  const dy = owner.targetY - c.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1) {
    let mult = 1;
    if (now < owner.speedBuffUntil) mult *= CONFIG.speedCell.speedMultiplier;
    if (c.raged) mult *= CONFIG.explosive.rageSpeedMultiplier;
    const speed = speedOf(c.mass) * mult;
    const step = Math.min(speed * dt, dist);
    c.x += (dx / dist) * step;
    c.y += (dy / dist) * step;
  }

  const r = radiusOf(c.mass);
  c.x = clamp(c.x, r, CONFIG.world.width - r);
  c.y = clamp(c.y, r, CONFIG.world.height - r);
}

function repelSiblings(now: number): void {
  const byOwner = new Map<string, Cell[]>();
  for (const c of cells) {
    const list = byOwner.get(c.ownerId);
    if (list) list.push(c);
    else byOwner.set(c.ownerId, [c]);
  }
  for (const own of byOwner.values()) {
    for (let i = 0; i < own.length; i++) {
      const a = own[i];
      const ar = radiusOf(a.mass);
      for (let j = i + 1; j < own.length; j++) {
        const b = own[j];
        // raged cells still collide with siblings even when both could otherwise merge
        const eitherRaged = a.raged || b.raged;
        if (!eitherRaged && now >= a.mergeAt && now >= b.mergeAt) continue;
        const br = radiusOf(b.mass);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = ar + br;
        if (d >= minD) continue;
        const overlap = minD - d;
        const ux = d > 0 ? dx / d : 1;
        const uy = d > 0 ? dy / d : 0;
        const totalMass = a.mass + b.mass;
        const pushA = (b.mass / totalMass) * overlap;
        const pushB = (a.mass / totalMass) * overlap;
        a.x -= ux * pushA;
        a.y -= uy * pushA;
        b.x += ux * pushB;
        b.y += uy * pushB;
      }
    }
  }
}

function eatFood(): void {
  for (const c of cells) {
    const r = radiusOf(c.mass);
    const rSq = r * r;
    foodGrid.forEachInRange(c.x - r, c.y - r, c.x + r, c.y + r, (f) => {
      if (f.x < 0) return; // already eaten this tick (transient, pending sweep)
      const dx = f.x - c.x;
      const dy = f.y - c.y;
      if (dx * dx + dy * dy <= rSq) {
        c.mass += CONFIG.food.mass;
        if (f.transient) {
          f.x = -1; // mark minted food for removal — it doesn't respawn
        } else {
          f.x = Math.random() * CONFIG.world.width;
          f.y = Math.random() * CONFIG.world.height;
          f.vx = 0;
          f.vy = 0;
          f.color = randomColor();
        }
      }
    });
  }
}

function eatBlobs(): void {
  for (const c of cells) {
    const r = radiusOf(c.mass);
    const rSq = r * r;
    blobGrid.forEachInRange(c.x - r, c.y - r, c.x + r, c.y + r, (b) => {
      if (b.x < 0) return;
      const dx = b.x - c.x;
      const dy = b.y - c.y;
      if (dx * dx + dy * dy <= rSq) {
        c.mass += CONFIG.eject.blobMass;
        b.x = -1;
      }
    });
  }
}

function sweepEatenBlobs(): void {
  for (let i = blobs.length - 1; i >= 0; i--) {
    if (blobs[i].x < 0) blobs.splice(i, 1);
  }
}

// remove eaten transient (mother-minted) food, marked with x = -1 in eatFood
function sweepEatenFood(): void {
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i];
    if (f.x < 0) {
      // free the minting mother's cap (only natural food carries a source).
      if (f.source) f.source.spawnedFood = Math.max(0, f.source.spawnedFood - 1);
      food.splice(i, 1);
    }
  }
}

function feedViruses(): void {
  for (const b of blobs) {
    if (b.x < 0) continue;
    const vr = radiusOf(CONFIG.virus.mass);
    virusGrid.forEachInRange(b.x - vr, b.y - vr, b.x + vr, b.y + vr, (v) => {
      if (b.x < 0) return;
      const dx = b.x - v.x;
      const dy = b.y - v.y;
      if (dx * dx + dy * dy <= vr * vr) {
        v.fedCount++;
        v.lastFedAngle = Math.atan2(b.vy, b.vx);
        b.x = -1;
        if (v.fedCount >= CONFIG.virus.feedThreshold) {
          v.fedCount = 0;
          viruses.push({
            x: v.x,
            y: v.y,
            vx: Math.cos(v.lastFedAngle) * CONFIG.virus.shootVelocity,
            vy: Math.sin(v.lastFedAngle) * CONFIG.virus.shootVelocity,
            fedCount: 0,
            lastFedAngle: 0,
          });
        }
      }
    });
  }
}

// shoot one transient pellet from the mother's origin at a random angle. friction
// (applied in tick's food-movement loop) slows it so it settles in a loose ring;
// launch speed scales with radius so food clears an engorged body. `counted` pellets
// reference the mother (source) so they count toward — and free — its per-mother cap;
// uncounted (bonus) pellets pass source=null so they're invisible to the cap.
function mintMotherFood(m: Mother, speed: number, counted: boolean): void {
  const angle = Math.random() * Math.PI * 2;
  food.push({
    x: m.x,
    y: m.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    color: randomColor(),
    friction: randomFoodFriction(),
    transient: true,
    source: counted ? m : null,
  });
}

function motherSpawnFood(m: Mother): void {
  const baseR = radiusOf(CONFIG.mother.mass);
  const effR = radiusOf(motherEffectiveMass(m));
  const speed = CONFIG.mother.foodInitialVelocity * (effR / baseR);

  // NATURAL food: the base pellets every mother always emits. Subject to the
  // per-mother live-food cap (counts toward spawnedFood, freed when the pellet is
  // eaten). When a mother's natural food isn't being eaten it stops at the cap.
  for (let i = 0; i < CONFIG.mother.foodPerSpawn; i++) {
    if (m.spawnedFood >= CONFIG.mother.maxSpawnedFood) break;
    mintMotherFood(m, speed, true);
    m.spawnedFood++;
  }

  // BONUS food: mass converted back from player cells the mother ate. This IGNORES
  // the cap and is minted every spawn until consumedMass drains to 0 — so a mother
  // that grinds up players keeps pumping out food regardless of the cap. These
  // pellets are uncounted (source=null) so they never block natural food, and (like
  // all mother food) are only removed when eaten — never expired.
  let bonus = Math.floor(m.consumedMass * CONFIG.mother.foodPerConsumedMass);
  if (bonus < 1 && m.consumedMass > 0) bonus = 1; // always drain down to empty
  if (bonus > 0) {
    m.consumedMass = Math.max(0, m.consumedMass - bonus * CONFIG.mother.foodMassCost);
    for (let i = 0; i < bonus; i++) mintMotherFood(m, speed, false);
  }
}

function eatMothers(now: number): void {
  for (let mi = mothers.length - 1; mi >= 0; mi--) {
    const m = mothers[mi];
    const effMass = motherEffectiveMass(m);
    const mr = radiusOf(effMass);
    const mrSq = mr * mr;
    // both thresholds scale with the mother's effective mass, so a bigger
    // (engorged) mother both swallows bigger cells and needs a bigger cell to pop
    // it. Start at 0.8×300 = 240 and (400/300)×300 = 400 respectively.
    const consumeThreshold = CONFIG.mother.consumeMassRatio * effMass;
    const popThreshold =
      CONFIG.mother.popThreshold * (effMass / CONFIG.mother.mass);
    // iterate backwards so we can splice consumed cells safely
    for (let ci = cells.length - 1; ci >= 0; ci--) {
      const c = cells[ci];
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      if (dx * dx + dy * dy > mrSq) continue;

      if (c.mass >= popThreshold) {
        // big cell pops on the mother (virus-like), obtaining its FULL effective
        // mass (base 300 + consumedMass). the mother resets.
        popCell(c, effMass, now);
        mothers[mi] = spawnMother();
        break;
      } else if (c.mass < consumeThreshold) {
        // mother devours the small cell, banking 90% of its mass as consumedMass
        m.consumedMass += c.mass * CONFIG.mother.consumeConvertRate;
        cells.splice(ci, 1);
        const ownerStillHasCells = cells.some((x) => x.ownerId === c.ownerId);
        if (!ownerStillHasCells) {
          const ownerPlayer = players.get(c.ownerId);
          if (ownerPlayer) {
            send(ownerPlayer.socket, { type: "dead", killedBy: "Mother" });
          }
        }
      }
      // cells in [consumeThreshold, popThreshold) sit on the mother harmlessly
    }
  }
}

function eatSpeedCells(now: number): void {
  const sr = radiusOf(CONFIG.speedCell.mass);
  for (let si = speedCells.length - 1; si >= 0; si--) {
    const s = speedCells[si];
    for (const c of cells) {
      // any cell mass can consume; the buff applies to the whole player (all owner cells).
      // reach = max(cell radius, pickup radius) so a big cell covering it still consumes.
      const reach = Math.max(radiusOf(c.mass), sr);
      const dx = c.x - s.x;
      const dy = c.y - s.y;
      if (dx * dx + dy * dy <= reach * reach) {
        const owner = players.get(c.ownerId);
        if (owner) owner.speedBuffUntil = now + CONFIG.speedCell.buffDurationMs;
        speedCells.splice(si, 1);
        speedCellRespawnQueue.push(now + CONFIG.speedCell.respawnInterval);
        break;
      }
    }
  }
}

function eatExplosives(): void {
  const er = radiusOf(CONFIG.explosive.mass);
  for (let ei = explosives.length - 1; ei >= 0; ei--) {
    const e = explosives[ei];
    for (const c of cells) {
      // gated by consumableMinMass (1 = any cell can take the risk)
      if (c.mass < CONFIG.explosive.consumableMinMass) continue;
      // reach = max(cell radius, pickup radius) so a big cell covering it still consumes
      const reach = Math.max(radiusOf(c.mass), er);
      const dx = c.x - e.x;
      const dy = c.y - e.y;
      if (dx * dx + dy * dy <= reach * reach) {
        c.raged = true;
        explosives.splice(ei, 1);
        explosiveRespawnQueue.push(Date.now() + CONFIG.explosive.respawnInterval);
        break;
      }
    }
  }
}

function eatAntiAgings(now: number): void {
  const ar = radiusOf(CONFIG.antiAging.mass);
  for (let ai = antiAgings.length - 1; ai >= 0; ai--) {
    const a = antiAgings[ai];
    for (const c of cells) {
      // gated by consumableMinMass (1 = any cell can consume it)
      if (c.mass < CONFIG.antiAging.consumableMinMass) continue;
      // reach = max(cell radius, pickup radius) so a big cell covering it still consumes
      const reach = Math.max(radiusOf(c.mass), ar);
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      if (dx * dx + dy * dy <= reach * reach) {
        const owner = players.get(c.ownerId);
        if (owner) owner.antiAgingUntil = now + CONFIG.antiAging.buffDurationMs;
        antiAgings.splice(ai, 1);
        antiAgingRespawnQueue.push(now + CONFIG.antiAging.respawnInterval);
        break;
      }
    }
  }
}

function eatMagnets(now: number): void {
  const mr = radiusOf(CONFIG.magnet.mass);
  for (let mi = magnets.length - 1; mi >= 0; mi--) {
    const m = magnets[mi];
    for (const c of cells) {
      // gated by consumableMinMass (1 = any cell can consume it)
      if (c.mass < CONFIG.magnet.consumableMinMass) continue;
      // reach = max(cell radius, pickup radius) so a big cell covering it still consumes
      const reach = Math.max(radiusOf(c.mass), mr);
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      if (dx * dx + dy * dy <= reach * reach) {
        const owner = players.get(c.ownerId);
        if (owner) owner.magnetUntil = now + CONFIG.magnet.buffDurationMs;
        magnets.splice(mi, 1);
        magnetRespawnQueue.push(now + CONFIG.magnet.respawnInterval);
        break;
      }
    }
  }
}

// While a player has the magnet buff, food within (cell radius × pullRadiusMultiplier)
// of one of their cells is eased toward the NEAREST such cell each tick; once it crosses
// inside the cell radius it is consumed by the normal eatFood pass. Runs before eatFood.
function applyMagnet(now: number): void {
  // every cell whose owner currently has the magnet buff
  const buffed = cells.filter((c) => {
    const o = players.get(c.ownerId);
    return o ? now < o.magnetUntil : false;
  });
  if (buffed.length === 0) return;

  const mult = CONFIG.magnet.pullRadiusMultiplier;
  for (const c of buffed) {
    const range = radiusOf(c.mass) * mult;
    const rangeSq = range * range;
    foodGrid.forEachInRange(
      c.x - range,
      c.y - range,
      c.x + range,
      c.y + range,
      (f) => {
        const dx = c.x - f.x;
        const dy = c.y - f.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > rangeSq) return;
        // defer to any closer buffed cell that also covers this food, so the
        // food streams toward a single cell instead of being torn between several
        for (const other of buffed) {
          if (other === c) continue;
          const odx = other.x - f.x;
          const ody = other.y - f.y;
          const oDSq = odx * odx + ody * ody;
          if (oDSq >= dSq) continue;
          const oRange = radiusOf(other.mass) * mult;
          if (oDSq <= oRange * oRange) return;
        }
        f.x += dx * CONFIG.magnet.pullLerp;
        f.y += dy * CONFIG.magnet.pullLerp;
      },
    );
  }
}

function handleRageContacts(now: number): void {
  // Map each raged cell to opposing cells it's currently touching
  const contactsByRaged = new Map<Cell, Cell[]>();
  for (const raged of cells) {
    if (!raged.raged) continue;
    const rr = radiusOf(raged.mass);
    const victims: Cell[] = [];
    for (const other of cells) {
      if (other === raged) continue;
      if (other.ownerId === raged.ownerId) continue;
      const or = radiusOf(other.mass);
      const sum = rr + or;
      const dx = raged.x - other.x;
      const dy = raged.y - other.y;
      if (dx * dx + dy * dy <= sum * sum) victims.push(other);
    }
    if (victims.length > 0) contactsByRaged.set(raged, victims);
  }

  // Each struck victim loses 20% mass then fragments into random pieces; the
  // raged cell also fragments. Mass conserved per cell minus the 20% chunk.
  for (const [raged, victims] of contactsByRaged) {
    for (const v of victims) {
      v.mass *= 0.8;
      fragmentCell(v, now);
    }
    fragmentCell(raged, now);
  }
}

function fragmentCell(c: Cell, now: number): void {
  const idx = cells.indexOf(c);
  if (idx < 0) return;
  const totalMass = c.mass;
  const ownerId = c.ownerId;
  const x = c.x;
  const y = c.y;
  cells.splice(idx, 1);

  const ownerCount = cells.filter((cc) => cc.ownerId === ownerId).length;
  const slotsLeft = CONFIG.player.maxCells - ownerCount;
  const pieces = Math.min(CONFIG.explosive.explodePieces, slotsLeft);
  if (pieces <= 0) {
    const ownerStillHasCells = cells.some((cc) => cc.ownerId === ownerId);
    if (!ownerStillHasCells) {
      const ownerPlayer = players.get(ownerId);
      if (ownerPlayer) {
        send(ownerPlayer.socket, { type: "dead", killedBy: null });
      }
    }
    return;
  }

  const weights: number[] = [];
  let sumW = 0;
  for (let i = 0; i < pieces; i++) {
    const w = 0.5 + Math.random();
    weights.push(w);
    sumW += w;
  }

  for (let i = 0; i < pieces; i++) {
    const mass = (weights[i] / sumW) * totalMass;
    const angle = (i / pieces) * Math.PI * 2 + Math.random() * 0.3;
    cells.push({
      id: newCellId(),
      ownerId: ownerId,
      x: x,
      y: y,
      mass: Math.max(CONFIG.player.minMass, mass),
      vx: Math.cos(angle) * 700 * (0.8 + Math.random() * 0.4),
      vy: Math.sin(angle) * 700 * (0.8 + Math.random() * 0.4),
      mergeAt: now + CONFIG.player.mergeCooldownBase,
      raged: false,
    });
  }
}

function doSplit(player: ServerPlayer, now: number): void {
  const own = cells.filter((c) => c.ownerId === player.id);
  if (own.length === 0) return;
  if (own.length >= CONFIG.player.maxCells) return;

  own.sort((a, b) => b.mass - a.mass);
  let total = own.length;
  for (const c of own) {
    if (total >= CONFIG.player.maxCells) break;
    if (c.mass < CONFIG.player.splitMinMass) continue;
    const dx = player.targetX - c.x;
    const dy = player.targetY - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const newMass = c.mass / 2;
    c.mass = newMass;
    const cooldown =
      CONFIG.player.mergeCooldownBase +
      newMass * CONFIG.player.mergeCooldownPerMass;
    c.mergeAt = now + cooldown;
    cells.push({
      id: newCellId(),
      ownerId: c.ownerId,
      x: c.x,
      y: c.y,
      mass: newMass,
      vx: ux * CONFIG.player.splitVelocity,
      vy: uy * CONFIG.player.splitVelocity,
      mergeAt: now + cooldown,
      // child inherits rage (speed buff is player-wide so it doesn't need to be copied)
      raged: c.raged,
    });
    total++;
  }
}

function doEject(player: ServerPlayer): void {
  // must have enough mass to stay at or above minMass after ejecting, otherwise
  // pressing W while at the floor would create free blobs (mass not conserved).
  const required = Math.max(
    CONFIG.eject.minCellMass,
    CONFIG.player.minMass + CONFIG.eject.costMass,
  );
  for (const c of cells) {
    if (c.ownerId !== player.id) continue;
    if (c.mass < required) continue;
    const dx = player.targetX - c.x;
    const dy = player.targetY - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const r = radiusOf(c.mass);
    c.mass -= CONFIG.eject.costMass;
    blobs.push({
      x: c.x + ux * (r + CONFIG.eject.radius + 2),
      y: c.y + uy * (r + CONFIG.eject.radius + 2),
      vx: ux * CONFIG.eject.initialVelocity,
      vy: uy * CONFIG.eject.initialVelocity,
      color: player.color,
    });
  }
}

function handleVirusCollisions(now: number): void {
  const vr = radiusOf(CONFIG.virus.mass);
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (c.mass < CONFIG.virus.popThreshold) continue;
    const cr = radiusOf(c.mass);
    let hit: Virus | null = null;
    virusGrid.forEachInRange(c.x - cr, c.y - cr, c.x + cr, c.y + cr, (v) => {
      if (hit) return;
      const dx = c.x - v.x;
      const dy = c.y - v.y;
      const limit = cr - vr * 0.5;
      if (limit > 0 && dx * dx + dy * dy <= limit * limit) hit = v;
    });
    if (hit) {
      const idx = viruses.indexOf(hit);
      if (idx >= 0) {
        popCell(c, CONFIG.virus.mass, now);
        viruses.splice(idx, 1);
        viruses.push(spawnVirus());
      }
    }
  }
}

// shared pop: cell explodes into pieces, gaining `addedMass` distributed across them.
// Used by both virus pops (big cells) and mother eats (small cells).
function popCell(c: Cell, addedMass: number, now: number): void {
  // ownCount includes c itself. freeSlots is how many more cells the owner may have.
  const ownCount = cells.filter((x) => x.ownerId === c.ownerId).length;
  const freeSlots = CONFIG.player.maxCells - ownCount;
  if (freeSlots <= 0) {
    // already at the cell cap: no room to split, so just absorb the mass
    c.mass += addedMass;
    return;
  }
  // c becomes piece #0 and we add up to freeSlots more pieces, so total stays
  // within maxCells. Cap the burst at 8 pieces for gameplay. Mass is split evenly.
  const pieces = Math.min(freeSlots + 1, 8);
  const pieceMass = (c.mass + addedMass) / pieces;
  c.mass = pieceMass;
  c.mergeAt = now + CONFIG.player.mergeCooldownBase;
  for (let i = 1; i < pieces; i++) {
    const angle = (i / pieces) * Math.PI * 2;
    cells.push({
      id: newCellId(),
      ownerId: c.ownerId,
      x: c.x,
      y: c.y,
      mass: pieceMass,
      vx: Math.cos(angle) * 800,
      vy: Math.sin(angle) * 800,
      mergeAt: now + CONFIG.player.mergeCooldownBase,
      raged: false,
    });
  }
}

function mergeSiblings(now: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      if (now < a.mergeAt) continue;
      if (a.raged) continue; // raged cells refuse to merge
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        if (b.ownerId !== a.ownerId) continue;
        if (now < b.mergeAt) continue;
        if (b.raged) continue; // raged cells refuse to merge
        const ar = radiusOf(a.mass);
        const br = radiusOf(b.mass);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const limit = Math.max(ar, br);
        if (dx * dx + dy * dy < limit * limit) {
          const survivorIdx = a.mass >= b.mass ? i : j;
          const victimIdx = a.mass >= b.mass ? j : i;
          const survivor = cells[survivorIdx];
          const victim = cells[victimIdx];
          survivor.mass += victim.mass;
          cells.splice(victimIdx, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
}

function eatOpponents(): void {
  for (let i = cells.length - 1; i >= 0; i--) {
    const victim = cells[i];
    for (const predator of cells) {
      if (predator === victim) continue;
      if (predator.ownerId === victim.ownerId) continue;
      if (predator.mass < victim.mass * CONFIG.player.eatRatio) continue;
      const pr = radiusOf(predator.mass);
      const dx = predator.x - victim.x;
      const dy = predator.y - victim.y;
      if (dx * dx + dy * dy < pr * pr) {
        predator.mass += victim.mass;
        cells.splice(i, 1);
        const ownerStillHasCells = cells.some(
          (c) => c.ownerId === victim.ownerId,
        );
        if (!ownerStillHasCells) {
          const ownerPlayer = players.get(victim.ownerId);
          const killer = players.get(predator.ownerId);
          if (ownerPlayer) {
            send(ownerPlayer.socket, {
              type: "dead",
              killedBy: killer?.name ?? null,
            });
          }
        }
        break;
      }
    }
  }
}

function viewerAOI(
  playerId: string,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let totalMass = 0;
  for (const c of cells) {
    if (c.ownerId !== playerId) continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
    totalMass += c.mass;
  }
  if (totalMass === 0) return null;
  const ext = aoiHalfExtent(totalMass);
  return {
    x0: minX - ext.x,
    y0: minY - ext.y,
    x1: maxX + ext.x,
    y1: maxY + ext.y,
  };
}

function sendSnapshots(
  now: number,
  leaderboard: LeaderboardEntry[],
): void {
  for (const viewer of players.values()) {
    const aoi = viewerAOI(viewer.id);
    if (!aoi) continue;

    const vCells: CellSnapshot[] = [];
    for (const c of cells) {
      if (c.x < aoi.x0 || c.x > aoi.x1) continue;
      if (c.y < aoi.y0 || c.y > aoi.y1) continue;
      const owner = players.get(c.ownerId);
      const remaining = owner ? Math.max(0, owner.speedBuffUntil - now) : 0;
      const antiAgingRemaining = owner
        ? Math.max(0, owner.antiAgingUntil - now)
        : 0;
      const magnetRemaining = owner
        ? Math.max(0, owner.magnetUntil - now)
        : 0;
      vCells.push({
        id: c.id,
        ownerId: c.ownerId,
        ownerName: owner?.name ?? "?",
        color: owner?.color ?? "#888",
        x: c.x,
        y: c.y,
        mass: c.mass,
        raged: c.raged || undefined,
        speedBuffRemainingMs: remaining > 0 ? remaining : undefined,
        antiAgingBuffRemainingMs:
          antiAgingRemaining > 0 ? antiAgingRemaining : undefined,
        magnetBuffRemainingMs:
          magnetRemaining > 0 ? magnetRemaining : undefined,
      });
    }
    const vFood: FoodSnapshot[] = [];
    foodGrid.forEachInRange(aoi.x0, aoi.y0, aoi.x1, aoi.y1, (f) => {
      if (f.x < 0) return; // swept this tick; grid still holds a stale reference
      if (f.x < aoi.x0 || f.x > aoi.x1 || f.y < aoi.y0 || f.y > aoi.y1) return;
      vFood.push(f);
    });
    const vBlobs: BlobSnapshot[] = [];
    for (const b of blobs) {
      if (b.x < aoi.x0 || b.x > aoi.x1) continue;
      if (b.y < aoi.y0 || b.y > aoi.y1) continue;
      vBlobs.push({ x: b.x, y: b.y, color: b.color });
    }
    const vViruses: VirusSnapshot[] = [];
    for (const v of viruses) {
      if (v.x < aoi.x0 || v.x > aoi.x1) continue;
      if (v.y < aoi.y0 || v.y > aoi.y1) continue;
      vViruses.push({
        x: v.x,
        y: v.y,
        mass: CONFIG.virus.mass,
        fedCount: v.fedCount,
      });
    }
    const vMothers: MotherSnapshot[] = [];
    motherGrid.forEachInRange(aoi.x0, aoi.y0, aoi.x1, aoi.y1, (m) => {
      vMothers.push({ x: m.x, y: m.y, mass: motherEffectiveMass(m) });
    });
    const vSpeed: SpeedCellSnapshot[] = [];
    speedCellGrid.forEachInRange(aoi.x0, aoi.y0, aoi.x1, aoi.y1, (s) => {
      vSpeed.push({ x: s.x, y: s.y, mass: CONFIG.speedCell.mass });
    });
    const vExplosives: ExplosiveSnapshot[] = [];
    explosiveGrid.forEachInRange(aoi.x0, aoi.y0, aoi.x1, aoi.y1, (e) => {
      vExplosives.push({ x: e.x, y: e.y, mass: CONFIG.explosive.mass });
    });
    const vAntiAgings: AntiAgingSnapshot[] = [];
    antiAgingGrid.forEachInRange(aoi.x0, aoi.y0, aoi.x1, aoi.y1, (a) => {
      vAntiAgings.push({ x: a.x, y: a.y, mass: CONFIG.antiAging.mass });
    });
    const vMagnets: MagnetSnapshot[] = [];
    magnetGrid.forEachInRange(aoi.x0, aoi.y0, aoi.x1, aoi.y1, (m) => {
      vMagnets.push({ x: m.x, y: m.y, mass: CONFIG.magnet.mass });
    });

    send(viewer.socket, {
      type: "state",
      t: now,
      cells: vCells,
      food: vFood,
      blobs: vBlobs,
      viruses: vViruses,
      mothers: vMothers,
      speedCells: vSpeed,
      explosives: vExplosives,
      antiAgings: vAntiAgings,
      magnets: vMagnets,
      leaderboard,
    });
  }
}
