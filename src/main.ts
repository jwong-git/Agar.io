import { CONFIG } from "../shared/config";
import { radiusOf, zoomOf } from "../shared/math";
import type { CellSnapshot, LeaderboardEntry } from "../shared/protocol";
import { MouseInput } from "./input";
import { Network, type Snapshot } from "./network";
import {
  render,
  renderDeathFades,
  setRenderTheme,
  getBackgroundColor,
  type DeathFade,
  type ThemeName,
} from "./render";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const highscoreEl = document.getElementById("highscore") as HTMLSpanElement;
const leaderboardHud = document.getElementById("leaderboard") as HTMLDivElement;
const startScreen = document.getElementById("start") as HTMLDivElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const colorInput = document.getElementById("color") as HTMLInputElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const themeButton = document.getElementById("themeToggle") as HTMLButtonElement;
const deathMessage = document.getElementById(
  "deathMessage",
) as HTMLParagraphElement;
const buffsEl = document.getElementById("buffs") as HTMLDivElement;

function resize(): void {
  // Cap the drawing buffer at the configured max. CSS keeps the canvas at
  // 100vw/100vh, so on a larger window the capped buffer is stretched to fill
  // — the game zooms in instead of revealing more of the world. Both axes use
  // the same scale, so the aspect ratio is preserved (no distortion).
  const scale = Math.min(
    1,
    CONFIG.maxRenderWidth / window.innerWidth,
    CONFIG.maxRenderHeight / window.innerHeight,
  );
  canvas.width = Math.round(window.innerWidth * scale);
  canvas.height = Math.round(window.innerHeight * scale);
}
resize();
window.addEventListener("resize", resize);

const savedName = localStorage.getItem("name");
if (savedName) nameInput.value = savedName;
const savedColor = localStorage.getItem("color");
if (savedColor) colorInput.value = savedColor;

let highScore = parseInt(localStorage.getItem("highScore") ?? "0", 10);
highscoreEl.textContent = String(highScore);

let theme: ThemeName =
  (localStorage.getItem("theme") as ThemeName) === "light" ? "light" : "dark";
applyTheme(theme);

themeButton.onclick = () => {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", theme);
  applyTheme(theme);
};

function applyTheme(t: ThemeName): void {
  document.body.classList.toggle("theme-light", t === "light");
  setRenderTheme(t);
  themeButton.textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
}

const RENDER_DELAY_MS = 100;
const FIT_MIN_ZOOM = 0.05;
const DEATH_FADE_MS = 380;
const VIEWPORT_MARGIN = 60;

let net: Network | null = null;
let mouse: MouseInput | null = null;
let lastView: { x: number; y: number; zoom: number } | null = null;
let lastInputSent = 0;
let prevCells: CellSnapshot[] = [];
const deathFades: DeathFade[] = [];

playButton.onclick = () => startGame();
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startGame();
});

window.addEventListener("keydown", (e) => {
  if (!net) return;
  if (startScreen.style.display !== "none") return;
  if (document.activeElement === nameInput) return;
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    net.split();
  } else if (e.code === "KeyW") {
    net.eject();
  }
});

function startGame(): void {
  const name = nameInput.value.trim() || "Anon";
  const color = colorInput.value;
  nameInput.blur();
  localStorage.setItem("name", name);
  localStorage.setItem("color", color);
  startScreen.style.display = "none";
  startScreen.classList.remove("dead");
  deathMessage.style.display = "none";

  if (net) {
    net.respawn(name, color);
    return;
  }

  // connect to the same origin the page was served from: wss:// on https pages, ws://
  // otherwise. In dev (Vite on :5173) the /ws path is proxied to the game server.
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  net = new Network(`${wsProto}://${location.host}/ws`, name, color);
  mouse = new MouseInput(canvas);

  net.onDead = (killedBy) => {
    deathMessage.textContent = killedBy
      ? `You were eaten by ${killedBy}`
      : "You died";
    deathMessage.style.display = "block";
    startScreen.classList.add("dead");
    startScreen.style.display = "flex";
    nameInput.focus();
    nameInput.select();
  };
  net.onDisconnect = () => {
    deathMessage.textContent = "Disconnected. Refresh the page to reconnect.";
    deathMessage.style.display = "block";
    startScreen.classList.add("dead");
    startScreen.style.display = "flex";
  };

  requestAnimationFrame(frame);
}

// idle demo loop behind the start overlay
const demoCells = makeDemoCells();
function demoFrame(): void {
  if (net) return;
  for (const d of demoCells) {
    d.x += d.vx;
    d.y += d.vy;
    if (d.x < -d.r) d.x = canvas.width + d.r;
    if (d.x > canvas.width + d.r) d.x = -d.r;
    if (d.y < -d.r) d.y = canvas.height + d.r;
    if (d.y > canvas.height + d.r) d.y = -d.r;
  }
  ctx.fillStyle = getBackgroundColor();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const d of demoCells) {
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  requestAnimationFrame(demoFrame);
}

function makeDemoCells() {
  const arr: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    color: string;
  }[] = [];
  for (let i = 0; i < 28; i++) {
    arr.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: 22 + Math.random() * 70,
      color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`,
    });
  }
  return arr;
}
demoFrame();

function frame(): void {
  if (!net) return;
  const now = performance.now();
  const renderTime = now - RENDER_DELAY_MS;
  const state = interpolate(net.snapshots, renderTime);

  if (state) {
    const myCells = net.myId
      ? state.cells.filter((c) => c.ownerId === net!.myId)
      : [];
    const view =
      computeView(myCells, canvas.width, canvas.height) ?? lastView;
    if (view) lastView = view;

    if (view) {
      const currentIds = new Set(state.cells.map((c) => c.id));
      for (const prev of prevCells) {
        if (currentIds.has(prev.id)) continue;
        if (cellVisible(prev, view, canvas)) {
          deathFades.push({
            x: prev.x,
            y: prev.y,
            mass: prev.mass,
            color: prev.color,
            startTime: now,
          });
        }
      }
    }

    render(
      ctx,
      state.cells,
      state.food,
      state.blobs,
      state.viruses,
      state.mothers,
      state.speedCells,
      state.explosives,
      state.antiAgings,
      state.magnets,
      view,
      net.myId,
    );
    if (view) {
      renderDeathFades(
        ctx,
        deathFades,
        view,
        canvas.width,
        canvas.height,
        now,
        DEATH_FADE_MS,
      );
    }
    renderLeaderboard(state.leaderboard, net?.myId);
    renderBuffs(myCells);

    if (myCells.length > 0 && view) {
      const totalMass = myCells.reduce((s, c) => s + c.mass, 0);
      const floored = Math.floor(totalMass);
      if (floored > highScore) {
        highScore = floored;
        localStorage.setItem("highScore", String(highScore));
        highscoreEl.textContent = String(highScore);
      }
      if (now - lastInputSent > 33) {
        const target = mouseToWorld(view);
        net.sendInput(target.x, target.y);
        lastInputSent = now;
      }
    }

    prevCells = state.cells;
  }
  requestAnimationFrame(frame);
}

function cellVisible(
  c: CellSnapshot,
  view: { x: number; y: number; zoom: number },
  canvas: HTMLCanvasElement,
): boolean {
  const halfW = canvas.width / 2 / view.zoom + VIEWPORT_MARGIN;
  const halfH = canvas.height / 2 / view.zoom + VIEWPORT_MARGIN;
  return Math.abs(c.x - view.x) < halfW && Math.abs(c.y - view.y) < halfH;
}

function computeView(
  myCells: CellSnapshot[],
  screenW: number,
  screenH: number,
): { x: number; y: number; zoom: number } | null {
  if (myCells.length === 0) return null;
  let totalMass = 0;
  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of myCells) {
    cx += c.x * c.mass;
    cy += c.y * c.mass;
    totalMass += c.mass;
    const r = radiusOf(c.mass);
    minX = Math.min(minX, c.x - r);
    minY = Math.min(minY, c.y - r);
    maxX = Math.max(maxX, c.x + r);
    maxY = Math.max(maxY, c.y + r);
  }
  cx /= totalMass;
  cy /= totalMass;
  const bbW = maxX - minX + 300;
  const bbH = maxY - minY + 300;
  const zoomFit = Math.min(screenW / bbW, screenH / bbH);
  const zoomMass = zoomOf(totalMass);
  let zoom = Math.min(zoomFit, zoomMass);
  zoom = Math.max(FIT_MIN_ZOOM, Math.min(CONFIG.maxZoom, zoom));
  return { x: cx, y: cy, zoom };
}

function mouseToWorld(view: {
  x: number;
  y: number;
  zoom: number;
}): { x: number; y: number } {
  return {
    x: view.x + (mouse!.x - canvas.width / 2) / view.zoom,
    y: view.y + (mouse!.y - canvas.height / 2) / view.zoom,
  };
}

function interpolate(snapshots: Snapshot[], target: number): Snapshot | null {
  if (snapshots.length === 0) return null;
  let s0 = snapshots[0];
  let s1: Snapshot | null = null;
  for (let i = 0; i < snapshots.length; i++) {
    if (snapshots[i].receivedAt <= target) {
      s0 = snapshots[i];
      s1 = snapshots[i + 1] ?? null;
    }
  }
  if (!s1) return s0;
  const span = s1.receivedAt - s0.receivedAt;
  const t =
    span > 0
      ? Math.max(0, Math.min(1, (target - s0.receivedAt) / span))
      : 0;
  const byId = new Map<string, CellSnapshot>();
  for (const c of s0.cells) byId.set(c.id, c);
  const lerpedCells: CellSnapshot[] = s1.cells.map((b) => {
    const a = byId.get(b.id);
    if (!a) return b;
    return {
      ...b,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      mass: a.mass + (b.mass - a.mass) * t,
    };
  });
  return {
    serverTime: s1.serverTime,
    receivedAt: s1.receivedAt,
    cells: lerpedCells,
    food: s1.food,
    blobs: s1.blobs,
    viruses: s1.viruses,
    mothers: s1.mothers,
    speedCells: s1.speedCells,
    explosives: s1.explosives,
    antiAgings: s1.antiAgings,
    magnets: s1.magnets,
    leaderboard: s1.leaderboard,
  };
}

function renderLeaderboard(
  entries: LeaderboardEntry[],
  myId: string | null | undefined,
): void {
  const rows = entries
    .map((e, i) => {
      const isSelf = !!myId && e.id === myId;
      const style = isSelf ? ' style="color:#ff4a4a;font-weight:700"' : "";
      return `<div${style}>${i + 1}. ${escapeHtml(e.name)} <span>${e.mass}</span></div>`;
    })
    .join("");
  leaderboardHud.innerHTML = `<div class="lb-title">Leaderboard</div>${rows}`;
}

interface BuffView {
  id: string;
  icon: string;
  label: string;
  fillFraction: number; // 0..1
  color: string;
}

function renderBuffs(myCells: CellSnapshot[]): void {
  const buffs: BuffView[] = [];
  let maxSpeed = 0;
  let maxAntiAging = 0;
  let maxMagnet = 0;
  let raged = false;
  for (const c of myCells) {
    if (c.speedBuffRemainingMs && c.speedBuffRemainingMs > maxSpeed) {
      maxSpeed = c.speedBuffRemainingMs;
    }
    if (c.antiAgingBuffRemainingMs && c.antiAgingBuffRemainingMs > maxAntiAging) {
      maxAntiAging = c.antiAgingBuffRemainingMs;
    }
    if (c.magnetBuffRemainingMs && c.magnetBuffRemainingMs > maxMagnet) {
      maxMagnet = c.magnetBuffRemainingMs;
    }
    if (c.raged) raged = true;
  }
  if (maxSpeed > 0) {
    buffs.push({
      id: "speed",
      icon: "⚡",
      label: `Speed +${Math.round((CONFIG.speedCell.speedMultiplier - 1) * 100)}%`,
      fillFraction: Math.min(1, maxSpeed / CONFIG.speedCell.buffDurationMs),
      color: "#4ac8ff",
    });
  }
  if (maxAntiAging > 0) {
    buffs.push({
      id: "antiAging",
      icon: "⏳",
      label: `Anti-Aging −${Math.round((1 - CONFIG.antiAging.decayMultiplier) * 100)}% decay`,
      fillFraction: Math.min(1, maxAntiAging / CONFIG.antiAging.buffDurationMs),
      color: "#ff9f1a",
    });
  }
  if (maxMagnet > 0) {
    buffs.push({
      id: "magnet",
      icon: "🧲",
      label: "Magnet — pulls in food",
      fillFraction: Math.min(1, maxMagnet / CONFIG.magnet.buffDurationMs),
      color: "#9b59e6",
    });
  }
  if (raged) {
    buffs.push({
      id: "rage",
      icon: "💥",
      label: "RAGED — explodes on contact",
      fillFraction: 1,
      color: "#cc2222",
    });
  }

  if (buffs.length === 0) {
    buffsEl.style.display = "none";
    return;
  }
  buffsEl.style.display = "flex";
  buffsEl.innerHTML = buffs
    .map(
      (b) => `
    <div class="buff" style="border-left-color:${b.color}">
      <span class="icon">${b.icon}</span>
      <div class="info">
        <div class="label">${b.label}</div>
        <div class="bar"><div class="fill" style="width:${(b.fillFraction * 100).toFixed(1)}%;background:${b.color}"></div></div>
      </div>
    </div>`,
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
}
