/**
 * The straightened photo: resample the photo onto the template's mm grid through the full
 * map (lens, perspective, raised-template correction, datum), so tracing happens on a
 * true-scale, square-on picture.
 */
import type { Box } from '../geom/shapes';
import type { Vec2 } from '../model/schema';
import type { DraftMap } from './draft';
import type { Raster } from './raster';

export interface Rectified {
  raster: Raster;
  /** Template-mm extent the raster covers; pixel (0, 0) is at (box.minX, box.maxY). */
  box: Box;
  pxPerMm: number;
}

/** Most pixels we resample, to keep it quick in the browser. */
const MAX_PIXELS = 4_000_000;

/** Template-mm area the photo covers, clipped to a sane panel-sized window. */
export function photoExtent(map: DraftMap, width: number, height: number, focus?: Box): Box {
  if (focus) return { minX: focus.minX - 60, minY: focus.minY - 60, maxX: focus.maxX + 60, maxY: focus.maxY + 60 };
  const pts: Vec2[] = [];
  // Inner 90 % of the photo: the very edges of an angled photo map far away.
  for (let i = 0; i <= 10; i++) {
    for (const [fx, fy] of [
      [i / 10, 0.05],
      [i / 10, 0.95],
      [0.05, i / 10],
      [0.95, i / 10],
    ]) {
      pts.push(map.toTemplate({ x: (0.05 + 0.9 * fx!) * width, y: (0.05 + 0.9 * fy!) * height }));
    }
  }
  const ok = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const clamp = (v: number) => Math.max(-900, Math.min(900, v));
  return {
    minX: clamp(Math.min(...ok.map((p) => p.x))),
    maxX: clamp(Math.max(...ok.map((p) => p.x))),
    minY: clamp(Math.min(...ok.map((p) => p.y))),
    maxY: clamp(Math.max(...ok.map((p) => p.y))),
  };
}

export function rectify(photo: Raster, map: DraftMap, box: Box, pxPerMm?: number): Rectified {
  const wmm = box.maxX - box.minX;
  const hmm = box.maxY - box.minY;
  // Native resolution, capped by the pixel budget.
  let k = pxPerMm ?? 1 / map.mmPerPx;
  k = Math.min(k, Math.sqrt(MAX_PIXELS / Math.max(1, wmm * hmm)));
  const W = Math.max(1, Math.round(wmm * k));
  const H = Math.max(1, Math.round(hmm * k));
  const out = new Uint8ClampedArray(W * H * 4);
  const { width: pw, height: ph, data } = photo;
  for (let y = 0; y < H; y++) {
    const ty = box.maxY - (y + 0.5) / k;
    for (let x = 0; x < W; x++) {
      const tx = box.minX + (x + 0.5) / k;
      const p = map.toImage({ x: tx, y: ty });
      const i = (y * W + x) * 4;
      const fx = p.x - 0.5;
      const fy = p.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (!(x0 >= 0 && y0 >= 0 && x0 + 1 < pw && y0 + 1 < ph)) {
        out[i + 3] = 0;
        continue;
      }
      const ax = fx - x0;
      const ay = fy - y0;
      const j = (y0 * pw + x0) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[j + c]! * (1 - ax) + data[j + 4 + c]! * ax;
        const bot = data[j + pw * 4 + c]! * (1 - ax) + data[j + pw * 4 + 4 + c]! * ax;
        out[i + c] = top * (1 - ay) + bot * ay;
      }
      out[i + 3] = 255;
    }
  }
  return { raster: { width: W, height: H, data: out }, box, pxPerMm: k };
}

/** Rectified pixel ↔ template mm. */
export const pxToMm = (r: Rectified, p: Vec2): Vec2 => ({ x: r.box.minX + p.x / r.pxPerMm, y: r.box.maxY - p.y / r.pxPerMm });
export const mmToPx = (r: Rectified, q: Vec2): Vec2 => ({ x: (q.x - r.box.minX) * r.pxPerMm, y: (r.box.maxY - q.y) * r.pxPerMm });
