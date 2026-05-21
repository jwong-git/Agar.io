import { CONFIG } from "../shared/config";
import { radiusOf } from "../shared/math";
import type {
  CellSnapshot,
  FoodSnapshot,
  BlobSnapshot,
  VirusSnapshot,
  MotherSnapshot,
  SpeedCellSnapshot,
  ExplosiveSnapshot,
  AntiAgingSnapshot,
  MagnetSnapshot,
} from "../shared/protocol";

export interface DeathFade {
  x: number;
  y: number;
  mass: number;
  color: string;
  startTime: number;
}

export type ThemeName = "dark" | "light";

interface ThemeColors {
  bg: string;
  grid: string;
  worldBorder: string;
  nameStroke: string;
  nameFill: string;
}

const THEMES: Record<ThemeName, ThemeColors> = {
  dark: {
    bg: "#0e0e12",
    grid: "#1d1d28",
    worldBorder: "#444",
    nameStroke: "#000",
    nameFill: "#fff",
  },
  light: {
    bg: "#f0f1f5",
    grid: "#dadbe3",
    worldBorder: "#999",
    nameStroke: "#fff",
    nameFill: "#111",
  },
};
let currentTheme: ThemeName = "dark";
export function setRenderTheme(t: ThemeName): void {
  currentTheme = t;
}
export function getBackgroundColor(): string {
  return THEMES[currentTheme].bg;
}

export function render(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  food: FoodSnapshot[],
  blobs: BlobSnapshot[],
  viruses: VirusSnapshot[],
  mothers: MotherSnapshot[],
  speedCells: SpeedCellSnapshot[],
  explosives: ExplosiveSnapshot[],
  antiAgings: AntiAgingSnapshot[],
  magnets: MagnetSnapshot[],
  view: { x: number; y: number; zoom: number } | null,
  selfId: string | null,
): void {
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  const theme = THEMES[currentTheme];

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const cx = view?.x ?? CONFIG.world.width / 2;
  const cy = view?.y ?? CONFIG.world.height / 2;
  const zoom = view?.zoom ?? 0.5;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  drawGrid(ctx, cx, cy, zoom, w, h);
  drawFood(ctx, food, cx, cy, zoom, w, h);
  drawMothers(ctx, mothers);
  drawSpeedCells(ctx, speedCells);
  drawExplosives(ctx, explosives);
  drawAntiAgings(ctx, antiAgings);
  drawMagnets(ctx, magnets);
  drawBlobs(ctx, blobs);
  drawViruses(ctx, viruses);
  drawCells(ctx, cells, selfId);

  ctx.restore();
}

export function renderDeathFades(
  ctx: CanvasRenderingContext2D,
  fades: DeathFade[],
  view: { x: number; y: number; zoom: number },
  screenW: number,
  screenH: number,
  now: number,
  durationMs: number,
): void {
  if (fades.length === 0) return;
  ctx.save();
  ctx.translate(screenW / 2, screenH / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.x, -view.y);
  for (let i = fades.length - 1; i >= 0; i--) {
    const f = fades[i];
    const t = (now - f.startTime) / durationMs;
    if (t >= 1) {
      fades.splice(i, 1);
      continue;
    }
    const baseR = radiusOf(f.mass);
    const r = baseR * (1 - t * 0.5);
    const alpha = 1 - t;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = Math.max(2, 4 / view.zoom);
    ctx.beginPath();
    ctx.arc(f.x, f.y, baseR * (1 + t * 0.9), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  zoom: number,
  screenW: number,
  screenH: number,
): void {
  const theme = THEMES[currentTheme];
  const { gridSize, width, height } = CONFIG.world;
  const halfW = screenW / 2 / zoom;
  const halfH = screenH / 2 / zoom;
  const x0 = Math.max(0, cx - halfW);
  const y0 = Math.max(0, cy - halfH);
  const x1 = Math.min(width, cx + halfW);
  const y1 = Math.min(height, cy + halfH);

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = Math.floor(x0 / gridSize) * gridSize; x <= x1; x += gridSize) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = Math.floor(y0 / gridSize) * gridSize; y <= y1; y += gridSize) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();

  ctx.strokeStyle = theme.worldBorder;
  ctx.lineWidth = 4 / zoom;
  ctx.strokeRect(0, 0, width, height);
}

function drawFood(
  ctx: CanvasRenderingContext2D,
  food: FoodSnapshot[],
  cx: number,
  cy: number,
  zoom: number,
  screenW: number,
  screenH: number,
): void {
  const r = CONFIG.food.radius;
  const halfW = screenW / 2 / zoom + r;
  const halfH = screenH / 2 / zoom + r;
  for (const f of food) {
    if (Math.abs(f.x - cx) > halfW || Math.abs(f.y - cy) > halfH) continue;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMothers(
  ctx: CanvasRenderingContext2D,
  mothers: MotherSnapshot[],
): void {
  for (const m of mothers) {
    const r = radiusOf(m.mass);
    ctx.fillStyle = "#cc6e1f"; // dark orange
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7a3e0a";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#8a4810";
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cc6e1f";
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSpeedCells(
  ctx: CanvasRenderingContext2D,
  speedCells: SpeedCellSnapshot[],
): void {
  for (const s of speedCells) {
    const r = radiusOf(s.mass);
    ctx.fillStyle = "#7ad0ff"; // light blue
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3ea0d8";
    ctx.lineWidth = 4;
    ctx.stroke();
    // lightning bolt
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    const bx = s.x;
    const by = s.y;
    const bs = r * 0.6;
    ctx.moveTo(bx - bs * 0.15, by - bs);
    ctx.lineTo(bx + bs * 0.35, by - bs * 0.1);
    ctx.lineTo(bx - bs * 0.05, by - bs * 0.1);
    ctx.lineTo(bx + bs * 0.15, by + bs);
    ctx.lineTo(bx - bs * 0.35, by + bs * 0.1);
    ctx.lineTo(bx + bs * 0.05, by + bs * 0.1);
    ctx.closePath();
    ctx.fill();
  }
}

// All vertical levels are signed fractions of r relative to the cell center
// (negative = up); half-widths are fractions of r. "rect" = straight body,
// "triangle" = flask body that flares from the neck to a wide base.
interface BottleShape {
  lipTop: number;
  lipBottom: number;
  shoulder: number;
  bottom: number;
  mouthHW: number;
  neckHW: number;
  bodyHW: number;
  body: "rect" | "triangle";
}

// rectangular body, short neck, wide mouth
const EXPLOSIVE_BOTTLE: BottleShape = {
  lipTop: -0.95,
  lipBottom: -0.72,
  shoulder: -0.5,
  bottom: 0.95,
  mouthHW: 0.42,
  neckHW: 0.16,
  bodyHW: 0.55,
  body: "rect",
};

// short wide triangle (flask) body, short neck, small mouth
const ANTIAGING_BOTTLE: BottleShape = {
  lipTop: -0.8,
  lipBottom: -0.6,
  shoulder: -0.42,
  bottom: 0.55,
  mouthHW: 0.3,
  neckHW: 0.15,
  bodyHW: 0.66,
  body: "triangle",
};

// Traces a bottle outline inscribed in radius r, mouth pointing up, centered at
// (cx, cy). The shape is purely cosmetic — collision stays a circle of radius r.
function bottlePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  s: BottleShape,
): void {
  const lipTop = cy + r * s.lipTop;
  const lipBottom = cy + r * s.lipBottom;
  const shoulder = cy + r * s.shoulder;
  const bottom = cy + r * s.bottom;
  const mouthHW = r * s.mouthHW;
  const neckHW = r * s.neckHW;
  const bodyHW = r * s.bodyHW;

  ctx.beginPath();
  // mouth (wide lip) + right side of neck
  ctx.moveTo(cx - mouthHW, lipTop);
  ctx.lineTo(cx + mouthHW, lipTop);
  ctx.lineTo(cx + mouthHW, lipBottom);
  ctx.lineTo(cx + neckHW, lipBottom);
  ctx.lineTo(cx + neckHW, shoulder);
  if (s.body === "rect") {
    ctx.lineTo(cx + bodyHW, shoulder);
    ctx.lineTo(cx + bodyHW, bottom);
    ctx.lineTo(cx - bodyHW, bottom);
    ctx.lineTo(cx - bodyHW, shoulder);
  } else {
    // triangle/flask: flare straight from the neck corners to a wide base
    ctx.lineTo(cx + bodyHW, bottom);
    ctx.lineTo(cx - bodyHW, bottom);
  }
  // left side of neck + back to mouth
  ctx.lineTo(cx - neckHW, shoulder);
  ctx.lineTo(cx - neckHW, lipBottom);
  ctx.lineTo(cx - mouthHW, lipBottom);
  ctx.closePath();
}

// filled hourglass — the "anti-aging" icon, drawn in the bottle body
function drawHourglass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx - size, cy - size);
  ctx.lineTo(cx + size, cy - size);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + size, cy + size);
  ctx.lineTo(cx - size, cy + size);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
}

// filled spiky starburst — the "explosive" icon, drawn in the bottle body
function drawBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const points = 8;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? size : size * 0.45;
    const px = cx + Math.cos(angle) * rr;
    const py = cy + Math.sin(angle) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawExplosives(
  ctx: CanvasRenderingContext2D,
  explosives: ExplosiveSnapshot[],
): void {
  for (const e of explosives) {
    const r = radiusOf(e.mass);
    bottlePath(ctx, e.x, e.y, r, EXPLOSIVE_BOTTLE);
    ctx.fillStyle = "#3a0000"; // dark-dark-red glass
    ctx.fill();
    ctx.strokeStyle = "#e11414"; // red outline
    ctx.lineWidth = 4;
    ctx.stroke();
    // explosive burst icon, centered in the rectangular body
    ctx.fillStyle = "#ffb01f";
    drawBurst(ctx, e.x, e.y + r * 0.3, r * 0.3);
  }
}

function drawAntiAgings(
  ctx: CanvasRenderingContext2D,
  antiAgings: AntiAgingSnapshot[],
): void {
  for (const a of antiAgings) {
    const r = radiusOf(a.mass);
    bottlePath(ctx, a.x, a.y, r, ANTIAGING_BOTTLE);
    ctx.fillStyle = "#ff9f1a"; // orange glass
    ctx.fill();
    ctx.strokeStyle = "#c46a00"; // darker orange outline
    ctx.lineWidth = 4;
    ctx.stroke();
    // hourglass icon, in the triangular body
    ctx.fillStyle = "#fff3e0";
    drawHourglass(ctx, a.x, a.y + r * 0.18, r * 0.2);
  }
}

// horseshoe magnet logo (opens upward, with light pole tips)
function drawMagnet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const radius = size * 0.7;
  const lw = size * 0.42;
  const top = cy - size;
  ctx.strokeStyle = "#e23b3b"; // red magnet body
  ctx.lineWidth = lw;
  // U band: bottom semicircle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI, false);
  ctx.stroke();
  // straight prongs up from the arc ends
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx - radius, top);
  ctx.moveTo(cx + radius, cy);
  ctx.lineTo(cx + radius, top);
  ctx.stroke();
  // pole tips
  ctx.fillStyle = "#e6e6e6";
  const tipH = size * 0.3;
  ctx.fillRect(cx - radius - lw / 2, top - tipH, lw, tipH);
  ctx.fillRect(cx + radius - lw / 2, top - tipH, lw, tipH);
}

function drawMagnets(
  ctx: CanvasRenderingContext2D,
  magnets: MagnetSnapshot[],
): void {
  for (const m of magnets) {
    const r = radiusOf(m.mass);
    // pure circle body
    ctx.fillStyle = "#7b3fe4"; // purple
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4b1fa8";
    ctx.lineWidth = 4;
    ctx.stroke();
    drawMagnet(ctx, m.x, m.y - r * 0.05, r * 0.52);
  }
}

function drawBlobs(
  ctx: CanvasRenderingContext2D,
  blobs: BlobSnapshot[],
): void {
  const r = CONFIG.eject.radius;
  for (const b of blobs) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawViruses(
  ctx: CanvasRenderingContext2D,
  viruses: VirusSnapshot[],
): void {
  const spikes = 16;
  for (const v of viruses) {
    const r = radiusOf(v.mass);
    ctx.fillStyle = "#33dd33";
    ctx.strokeStyle = "#1aaa1a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r * 1.12 : r * 0.88;
      const px = v.x + Math.cos(angle) * rr;
      const py = v.y + Math.sin(angle) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (v.fedCount > 0) {
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < v.fedCount; i++) {
        const angle =
          (i / CONFIG.virus.feedThreshold) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(
          v.x + Math.cos(angle) * r * 0.45,
          v.y + Math.sin(angle) * r * 0.45,
          3.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }
}

// returns 'white' if very light, 'black' if very dark, else null
function extremeColor(hex: string): "white" | "black" | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const luminance = (r + g + b) / 3;
  if (luminance > 235) return "white";
  if (luminance < 25) return "black";
  return null;
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  selfId: string | null,
): void {
  const theme = THEMES[currentTheme];
  const sorted = [...cells].sort((a, b) => b.mass - a.mass);
  for (const c of sorted) {
    const r = radiusOf(c.mass);

    if (c.raged) {
      const grad = ctx.createRadialGradient(c.x, c.y, r, c.x, c.y, r * 1.65);
      grad.addColorStop(0, "rgba(120, 0, 0, 0.7)");
      grad.addColorStop(1, "rgba(120, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.65, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // speed and anti-aging glows can stack on a (non-raged) cell
      if (c.speedBuffRemainingMs) {
        const grad = ctx.createRadialGradient(c.x, c.y, r, c.x, c.y, r * 1.4);
        grad.addColorStop(0, "rgba(120, 200, 255, 0.45)");
        grad.addColorStop(1, "rgba(120, 200, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (c.antiAgingBuffRemainingMs) {
        const grad = ctx.createRadialGradient(c.x, c.y, r, c.x, c.y, r * 1.5);
        grad.addColorStop(0, "rgba(255, 159, 26, 0.5)");
        grad.addColorStop(1, "rgba(255, 159, 26, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (c.magnetBuffRemainingMs) {
        // glow fills the pull range exactly (same multiplier as the indicator ring)
        const gr = r * CONFIG.magnet.pullRadiusMultiplier;
        const grad = ctx.createRadialGradient(c.x, c.y, r, c.x, c.y, gr);
        grad.addColorStop(0, "rgba(155, 89, 230, 0.45)");
        grad.addColorStop(1, "rgba(155, 89, 230, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, gr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // magnet pull-range indicator: very faint, gently animated dashed ring
    if (c.magnetBuffRemainingMs) {
      const pr = r * CONFIG.magnet.pullRadiusMultiplier;
      const t = performance.now() / 1000;
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.04 * Math.sin(t * 3);
      ctx.strokeStyle = "#9b59e6";
      ctx.lineWidth = Math.max(1, r * 0.03);
      ctx.setLineDash([pr * 0.14, pr * 0.1]);
      ctx.lineDashOffset = -t * 28; // slow march, hints at the pulling
      ctx.beginPath();
      ctx.arc(c.x, c.y, pr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();

    // contrast border for near-white/near-black cells so they don't blend in
    const extreme = extremeColor(c.color);
    let strokeStyle: string;
    if (c.raged) strokeStyle = "rgba(160, 0, 0, 0.95)";
    else if (c.speedBuffRemainingMs)
      strokeStyle = "rgba(74, 170, 255, 0.9)";
    else if (c.antiAgingBuffRemainingMs)
      strokeStyle = "rgba(255, 159, 26, 0.95)";
    else if (c.magnetBuffRemainingMs)
      strokeStyle = "rgba(155, 89, 230, 0.95)";
    else if (extreme === "white") strokeStyle = "#000";
    else if (extreme === "black") strokeStyle = "#fff";
    else strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.stroke();

    if (c.ownerName) {
      const fontSize = Math.max(12, r * 0.35);
      ctx.textAlign = "center";
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = Math.max(2, fontSize * 0.18);
      ctx.strokeStyle = theme.nameStroke;
      ctx.strokeText(c.ownerName, c.x, c.y);
      ctx.fillStyle = theme.nameFill;
      ctx.fillText(c.ownerName, c.x, c.y);

      // mass only shown on YOUR cells
      if (selfId && c.ownerId === selfId) {
        const small = Math.max(10, fontSize * 0.65);
        ctx.font = `${small}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(1, small * 0.18);
        ctx.strokeStyle = theme.nameStroke;
        const massStr = String(Math.floor(c.mass));
        ctx.strokeText(massStr, c.x, c.y + 2);
        ctx.fillStyle = theme.nameFill;
        ctx.fillText(massStr, c.x, c.y + 2);
      }
    }
  }
}
