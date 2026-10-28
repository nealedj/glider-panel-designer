/**
 * Image access for the template pipeline. Works on plain RGBA buffers (as from
 * `getImageData`), so the same code runs in the browser and in tests.
 */
import type { Vec2 } from '../model/schema';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row major. */
  data: Uint8ClampedArray | Uint8Array;
}

/** One value per pixel. */
export interface Channel {
  width: number;
  height: number;
  v: Float32Array;
}

export function luminance(r: Raster): Channel {
  const v = new Float32Array(r.width * r.height);
  for (let i = 0, j = 0; i < v.length; i++, j += 4) v[i] = 0.299 * r.data[j]! + 0.587 * r.data[j + 1]! + 0.114 * r.data[j + 2]!;
  return { width: r.width, height: r.height, v };
}

/** Mean over a (2r+1)² box, via an integral image. */
export function boxMean(c: Channel, r: number): Channel {
  const { width: w, height: h } = c;
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += c.v[y * w + x]!;
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = S[y1 * (w + 1) + x1]! - S[y0 * (w + 1) + x1]! - S[y1 * (w + 1) + x0]! + S[y0 * (w + 1) + x0]!;
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return { width: w, height: h, v: out };
}

/**
 * Thin bright lines on a darker background (a cutting mat's grid): brightness above the
 * local mean, so even lighting changes across the photo do not matter.
 */
export function ridges(r: Raster, radius = 5): Channel {
  const L = luminance(r);
  const m = boxMean(L, radius);
  const v = new Float32Array(L.v.length);
  for (let i = 0; i < v.length; i++) v[i] = Math.max(0, L.v[i]! - m.v[i]!);
  return { width: L.width, height: L.height, v };
}

/** Bilinear sample; 0 outside the image. */
export function sample(c: Channel, p: Vec2): number {
  const x = p.x - 0.5;
  const y = p.y - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= c.width || y0 + 1 >= c.height) return 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * c.width + x0;
  return (c.v[i]! * (1 - fx) + c.v[i + 1]! * fx) * (1 - fy) + (c.v[i + c.width]! * (1 - fx) + c.v[i + c.width + 1]! * fx) * fy;
}

export function rgbAt(r: Raster, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * r.width + Math.round(x)) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!];
}

/**
 * Fraction of nearby pixels that look like a cutting mat: strongly green or teal, the
 * colour of almost every mat sold. Used to ignore lines in the rest of the photo.
 */
export function matFraction(r: Raster, radius = 6): Channel {
  const v = new Float32Array(r.width * r.height);
  for (let i = 0, j = 0; i < v.length; i++, j += 4) {
    const [R, G, B] = [r.data[j]!, r.data[j + 1]!, r.data[j + 2]!];
    v[i] = G - R > 40 && G > 80 && G >= B - 30 ? 1 : 0;
  }
  return boxMean({ width: r.width, height: r.height, v }, radius);
}
