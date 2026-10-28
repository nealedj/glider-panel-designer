/**
 * Plane homographies: removing perspective from a photo of a flat panel. See ADR 0010.
 *
 * A homography H maps image pixels to plane coordinates. It is fitted from four or more
 * point pairs: a normalised linear fit (Hartley), then a few Gauss–Newton steps that
 * minimise the error in the plane, which is the error that matters for cutting.
 */
import type { Vec2 } from '../model/schema';
import { inv3, leastSquares, mul3, solve, type Mat3 } from './linalg';

export interface PointPair {
  src: Vec2;
  dst: Vec2;
}

export function applyH(H: Mat3, p: Vec2): Vec2 {
  const w = H[6]! * p.x + H[7]! * p.y + H[8]!;
  return { x: (H[0]! * p.x + H[1]! * p.y + H[2]!) / w, y: (H[3]! * p.x + H[4]! * p.y + H[5]!) / w };
}

/** Similarity that moves points to mean 0 and mean distance √2 (Hartley normalisation). */
function normaliser(pts: Vec2[]): Mat3 {
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / pts.length || 1;
  const k = Math.SQRT2 / d;
  return [k, 0, -k * mx, 0, k, -k * my, 0, 0, 1];
}

function linearFit(pairs: PointPair[]): Mat3 | null {
  const Ts = normaliser(pairs.map((p) => p.src));
  const Td = normaliser(pairs.map((p) => p.dst));
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const { src, dst } of pairs) {
    const s = applyH(Ts, src);
    const d = applyH(Td, dst);
    rows.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    rhs.push(d.x);
    rows.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    rhs.push(d.y);
  }
  const h = leastSquares(rows, rhs);
  if (!h) return null;
  const Hn = [...h, 1];
  const TdInv = inv3(Td);
  if (!TdInv) return null;
  return normalise(mul3(TdInv, mul3(Hn, Ts)));
}

function normalise(H: Mat3): Mat3 {
  const s = H[8]! || 1;
  return H.map((v) => v / s);
}

/** Gauss–Newton refinement of the plane-side error, with the 8 free entries of H. */
function refine(H0: Mat3, pairs: PointPair[], iterations = 8): Mat3 {
  let H = H0;
  for (let it = 0; it < iterations; it++) {
    const J: number[][] = [];
    const r: number[] = [];
    for (const { src, dst } of pairs) {
      const w = H[6]! * src.x + H[7]! * src.y + 1;
      const u = (H[0]! * src.x + H[1]! * src.y + H[2]!) / w;
      const v = (H[3]! * src.x + H[4]! * src.y + H[5]!) / w;
      J.push([src.x / w, src.y / w, 1 / w, 0, 0, 0, (-u * src.x) / w, (-u * src.y) / w]);
      r.push(dst.x - u);
      J.push([0, 0, 0, src.x / w, src.y / w, 1 / w, (-v * src.x) / w, (-v * src.y) / w]);
      r.push(dst.y - v);
    }
    // Levenberg damping keeps steps sane when the image coordinates are large.
    const n = 8;
    const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const Atr = new Array<number>(n).fill(0);
    J.forEach((row, i) => {
      for (let a = 0; a < n; a++) {
        Atr[a]! += row[a]! * r[i]!;
        for (let b = 0; b < n; b++) AtA[a]![b]! += row[a]! * row[b]!;
      }
    });
    for (let a = 0; a < n; a++) AtA[a]![a]! *= 1 + 1e-6;
    const step = solve(AtA, Atr);
    if (!step) break;
    const next = [...H.slice(0, 8).map((v, i) => v + step[i]!), 1];
    if (rms(next, pairs) > rms(H, pairs)) break;
    H = next;
    if (Math.max(...step.map(Math.abs)) < 1e-14) break;
  }
  return H;
}

function rms(H: Mat3, pairs: PointPair[]): number {
  return Math.sqrt(pairs.reduce((s, p) => s + dist2(applyH(H, p.src), p.dst), 0) / pairs.length);
}

const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Fit H mapping src to dst from four or more pairs; null if the points are degenerate. */
export function fitHomography(pairs: PointPair[]): Mat3 | null {
  if (pairs.length < 4) return null;
  const H = linearFit(pairs);
  if (!H || H.some((v) => !Number.isFinite(v))) return null;
  return pairs.length > 4 ? refine(H, pairs) : H;
}

export interface HomographyFit {
  H: Mat3;
  /** Plane-side residual for each pair, in plane units. */
  residuals: number[];
  rms: number;
  /** Pairs kept after outlier rejection. */
  inliers: PointPair[];
}

/**
 * Fit, then drop pairs whose residual is far above the rest and refit, so a few bad grid
 * detections cannot bend the result.
 */
export function robustHomography(pairs: PointPair[], minKeep = 4): HomographyFit | null {
  let kept = pairs;
  for (let round = 0; round < 6; round++) {
    const H = fitHomography(kept);
    if (!H) return null;
    const res = kept.map((p) => Math.sqrt(dist2(applyH(H, p.src), p.dst)));
    const sorted = [...res].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const cut = Math.max(3 * 1.4826 * median, 1e-9);
    const next = kept.filter((_, i) => res[i]! <= cut);
    if (next.length === kept.length || next.length < minKeep) {
      return { H, residuals: res, rms: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length), inliers: kept };
    }
    kept = next;
  }
  const H = fitHomography(kept)!;
  const res = kept.map((p) => Math.sqrt(dist2(applyH(H, p.src), p.dst)));
  return { H, residuals: res, rms: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length), inliers: kept };
}

/** CSS matrix3d that draws an image (in its own pixel space) through H. */
export function cssMatrix3d(H: Mat3): string {
  const [a, b, c, d, e, f, g, h, i] = H as [number, number, number, number, number, number, number, number, number];
  // Column-major 4 × 4 with z passed through.
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].join(',')})`;
}

/** Local scale of H at a point: plane units per pixel (geometric mean of the two axes). */
export function localScale(H: Mat3, p: Vec2): number {
  const o = applyH(H, p);
  const ax = applyH(H, { x: p.x + 1, y: p.y });
  const ay = applyH(H, { x: p.x, y: p.y + 1 });
  const vx = { x: ax.x - o.x, y: ax.y - o.y };
  const vy = { x: ay.x - o.x, y: ay.y - o.y };
  return Math.sqrt(Math.abs(vx.x * vy.y - vx.y * vy.x));
}
