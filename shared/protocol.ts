// Wire format for client <-> server messages. Keep in sync on both sides.

export interface CellSnapshot {
  id: string;
  ownerId: string;
  ownerName: string;
  color: string;
  x: number;
  y: number;
  mass: number;
  raged?: boolean;
  speedBuffRemainingMs?: number;
  antiAgingBuffRemainingMs?: number;
  magnetBuffRemainingMs?: number;
}

export interface FoodSnapshot {
  x: number;
  y: number;
  color: string;
}

export interface BlobSnapshot {
  x: number;
  y: number;
  color: string;
}

export interface VirusSnapshot {
  x: number;
  y: number;
  mass: number;
  fedCount: number;
}

export interface MotherSnapshot {
  x: number;
  y: number;
  mass: number;
}

export interface SpeedCellSnapshot {
  x: number;
  y: number;
  mass: number;
}

export interface ExplosiveSnapshot {
  x: number;
  y: number;
  mass: number;
}

export interface AntiAgingSnapshot {
  x: number;
  y: number;
  mass: number;
}

export interface MagnetSnapshot {
  x: number;
  y: number;
  mass: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  mass: number;
}

export type ClientMessage =
  | { type: "join"; name: string; color?: string }
  | { type: "input"; targetX: number; targetY: number }
  | { type: "split" }
  | { type: "eject" };

export type ServerMessage =
  | { type: "welcome"; id: string; world: { width: number; height: number } }
  | {
      type: "state";
      t: number;
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
  | { type: "dead"; killedBy: string | null };
