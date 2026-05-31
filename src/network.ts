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

export interface Snapshot {
  serverTime: number;
  receivedAt: number;
  tps: number;
  cells: CellSnapshot[];
  food: FoodSnapshot[];
  blobs: BlobSnapshot[];
  viruses: VirusSnapshot[];
  mothers: MotherSnapshot[];
  speedCells: SpeedCellSnapshot[];
  explosives: ExplosiveSnapshot[];
  antiAgings: AntiAgingSnapshot[];
  magnets: MagnetSnapshot[];
  leaderboard: LeaderboardEntry[];
}

export class Network {
  private ws: WebSocket;
  myId: string | null = null;
  worldWidth = 5000;
  worldHeight = 5000;
  snapshots: Snapshot[] = [];
  // client-measured snapshot arrival rate (Hz), EMA. Reflects what THIS client
  // actually receives (server TPS + network delivery), vs the server-reported tps.
  recvHz = 0;
  private lastStateAt = 0;
  private recvIntervalEma = 0;
  onDead: (killedBy: string | null) => void = () => {};
  onDisconnect: () => void = () => {};

  constructor(url: string, name: string, color?: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ type: "join", name, color });
    this.ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
    this.ws.onclose = () => this.onDisconnect();
  }

  respawn(name: string, color?: string): void {
    this.send({ type: "join", name, color });
  }

  sendInput(targetX: number, targetY: number): void {
    this.send({ type: "input", targetX, targetY });
  }

  split(): void {
    this.send({ type: "split" });
  }

  eject(): void {
    this.send({ type: "eject" });
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handle(msg: ServerMessage): void {
    if (msg.type === "welcome") {
      this.myId = msg.id;
      this.worldWidth = msg.world.width;
      this.worldHeight = msg.world.height;
    } else if (msg.type === "state") {
      const receivedAt = performance.now();
      if (this.lastStateAt > 0) {
        const interval = receivedAt - this.lastStateAt;
        this.recvIntervalEma =
          this.recvIntervalEma === 0
            ? interval
            : this.recvIntervalEma * 0.8 + interval * 0.2;
        this.recvHz = 1000 / this.recvIntervalEma;
      }
      this.lastStateAt = receivedAt;
      this.snapshots.push({
        serverTime: msg.t,
        receivedAt,
        tps: msg.tps,
        cells: msg.cells,
        food: msg.food,
        blobs: msg.blobs,
        viruses: msg.viruses,
        mothers: msg.mothers,
        speedCells: msg.speedCells,
        explosives: msg.explosives,
        antiAgings: msg.antiAgings,
        magnets: msg.magnets,
        leaderboard: msg.leaderboard,
      });
      while (this.snapshots.length > 5) this.snapshots.shift();
    } else if (msg.type === "dead") {
      this.onDead(msg.killedBy);
    }
  }
}
