/**
 * The full map from photo pixels to the panel plane in mm: one radial lens-distortion
 * term, then a homography. See ADR 0010.
 *
 * Distortion model (division-free, on observed pixels):
 *   u = c + (d − c)(1 + k1 · |d − c|² / R²)
 * where d is the observed pixel, u the undistorted one, c the image centre and R its
 * half-diagonal, so k1 is dimensionless (phone main cameras are typically −0.02 to −0.1).
 */
import type { Vec2 } from '../model/schema';
import { applyH, robustHomography, type HomographyFit, type PointPair } from './homography';
import { inv3, type Mat3 } from './linalg';

export interface Mapping {
  H: Mat3;
  k1: number;
  /** Image size the distortion is defined over. */
  width: number;
  height: number;
}

export function undistort(m: Pick<Mapping, 'k1' | 'width' | 'height'>, d: Vec2): Vec2 {
  if (!m.k1) return d;
  const cx = m.width / 2;
  const cy = m.height / 2;
  const R2 = cx * cx + cy * cy;
  const dx = d.x - cx;
  const dy = d.y - cy;
  const f = 1 + (m.k1 * (dx * dx + dy * dy)) / R2;
  return { x: cx + dx * f, y: cy + dy * f };
}

/** Inverse of `undistort`, by fixed-point iteration (converges fast for realistic k1). */
export function distort(m: Pick<Mapping, 'k1' | 'width' | 'height'>, u: Vec2): Vec2 {
  if (!m.k1) return u;
  const cx = m.width / 2;
  const cy = m.height / 2;
  const R2 = cx * cx + cy * cy;
  let d = u;
  for (let i = 0; i < 20; i++) {
    const dx = d.x - cx;
    const dy = d.y - cy;
    const f = 1 + (m.k1 * (dx * dx + dy * dy)) / R2;
    const next = { x: cx + (u.x - cx) / f, y: cy + (u.y - cy) / f };
    if (Math.abs(next.x - d.x) + Math.abs(next.y - d.y) < 1e-9) return next;
    d = next;
  }
  return d;
}

export function imageToPlane(m: Mapping, p: Vec2): Vec2 {
  return applyH(m.H, undistort(m, p));
}

export function planeToImage(m: Mapping, q: Vec2): Vec2 {
  const Hi = inv3(m.H)!;
  return distort(m, applyH(Hi, q));
}

/** A reusable plane → image function (inverts H once). */
export function planeToImageFn(m: Mapping): (q: Vec2) => Vec2 {
  const Hi = inv3(m.H)!;
  return (q) => distort(m, applyH(Hi, q));
}

export interface DistortedFit extends HomographyFit {
  k1: number;
}

/**
 * Fit distortion and homography together from many pairs (image px → plane mm) by a
 * golden-section search on k1. Only worth it with dozens of well-spread points, as a grid
 * gives; with few points k1 stays 0.
 */
export function fitWithDistortion(pairs: PointPair[], width: number, height: number): DistortedFit | null {
  const at = (k1: number) => robustHomography(pairs.map((p) => ({ src: undistort({ k1, width, height }, p.src), dst: p.dst })));
  const base = at(0);
  if (!base) return null;
  if (pairs.length < 24) return { ...base, k1: 0 };
  const cost = (k1: number) => at(k1)?.rms ?? Infinity;
  let a = -0.3;
  let b = 0.3;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = cost(c);
  let fd = cost(d);
  for (let i = 0; i < 40 && b - a > 1e-5; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = cost(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = cost(d);
    }
  }
  const k1 = (a + b) / 2;
  const best = at(k1);
  // Keep the distortion term only if it clearly helps; otherwise it is fitting noise.
  if (!best || best.rms > 0.85 * base.rms) return { ...base, k1: 0 };
  // Report residuals in terms of the original pairs.
  return { ...best, k1 };
}
