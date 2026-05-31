import { CONFIG } from "./config";

export function radiusOf(mass: number): number {
  return Math.sqrt(mass) * CONFIG.radiusScale;
}

export function speedOf(mass: number): number {
  const r = radiusOf(mass);
  return CONFIG.player.baseSpeed / Math.sqrt(r);
}

export function zoomOf(mass: number): number {
  const z = CONFIG.zoomBase / Math.sqrt(radiusOf(mass));
  return Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, z));
}

// How far around a viewer to include in their snapshot. Larger cells see further
// because their zoom is smaller, so AOI grows as mass grows. We assume a worst-case
// screen of about 2400x1600 px so this is a generous over-estimate.
export function aoiHalfExtent(mass: number): { x: number; y: number } {
  const zoom = zoomOf(mass);
  // v0.6.8: trimmed 1200/800 -> 1100/700. The render buffer is capped at
  // 1920x1080 (so visible half-extent is at most 960/zoom x 540/zoom); the old
  // constants over-estimated for a 2400x1600 screen. 1100/700 still covers the
  // real view with margin but shrinks the snapshot area ~20%. (Bigger lever,
  // untouched here: player.startMass — smaller start = more zoom = smaller AOI.)
  return { x: 1100 / zoom + 200, y: 700 / zoom + 200 };
}
