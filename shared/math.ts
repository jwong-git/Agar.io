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
  return { x: 1200 / zoom + 200, y: 800 / zoom + 200 };
}
