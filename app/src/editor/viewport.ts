/**
 * Mapping between world millimetres (y up) and canvas pixels (y down). The rear view
 * mirrors x, so it shares all of this with `mirror = true`.
 */
import { unionBox, type Box } from '../geom/shapes';
import type { Vec2 } from '../model/schema';
import { ui } from '../store/ui';

export interface Viewport {
  w: number;
  h: number;
  zoom: number;
  centre: Vec2;
  mirror: boolean;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 80;

export function toScreen(v: Viewport, p: Vec2): Vec2 {
  const sx = v.mirror ? -1 : 1;
  return { x: v.w / 2 + sx * (p.x - v.centre.x) * v.zoom, y: v.h / 2 - (p.y - v.centre.y) * v.zoom };
}

export function toWorld(v: Viewport, s: Vec2): Vec2 {
  const sx = v.mirror ? -1 : 1;
  return { x: v.centre.x + (sx * (s.x - v.w / 2)) / v.zoom, y: v.centre.y - (s.y - v.h / 2) / v.zoom };
}

/** SVG transform that maps world coordinates into the canvas. */
export function worldMatrix(v: Viewport): string {
  const sx = v.mirror ? -1 : 1;
  return `matrix(${sx * v.zoom} 0 0 ${-v.zoom} ${v.w / 2 - sx * v.centre.x * v.zoom} ${v.h / 2 + v.centre.y * v.zoom})`;
}

/** Zoom about a screen point, keeping the world point under it fixed. */
export function zoomAt(v: Viewport, s: Vec2, factor: number): { zoom: number; centre: Vec2 } {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
  const wp = toWorld(v, s);
  const sx = v.mirror ? -1 : 1;
  return { zoom, centre: { x: wp.x - (sx * (s.x - v.w / 2)) / zoom, y: wp.y + (s.y - v.h / 2) / zoom } };
}

export function fitBox(v: Pick<Viewport, 'w' | 'h'>, b: Box, marginPx = 40): { zoom: number; centre: Vec2 } {
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((v.w - 2 * marginPx) / bw, (v.h - 2 * marginPx) / bh)));
  return { zoom, centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } };
}

/** The live canvas size, set by the canvas so commands like zoom-to-fit can use it. */
export const canvasSize = { w: 800, h: 600 };

export function zoomToFit(boxes: Box[]) {
  const b = unionBox(boxes);
  if (!b) return;
  ui.set(fitBox(canvasSize, b));
}

