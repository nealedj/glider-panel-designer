/**
 * Camera position from a plane homography, so features that sit above the calibrated plane
 * (a cardboard template on a cutting mat) can be scaled back to their true size.
 *
 * With square pixels and the principal point at the image centre, the homography
 * H ∝ K [r1 r2 t] fixes the focal length f from r1 ⟂ r2 and |r1| = |r2| (Zhang). When the
 * photo is nearly square-on, f is poorly determined and a typical phone field of view is
 * assumed instead. See ADR 0010.
 */
import type { Vec2 } from '../model/schema';
import type { Mat3 } from './linalg';

export interface CameraEstimate {
  /** Focal length, px. */
  f: number;
  fSource: 'estimated' | 'assumed';
  /** Camera height above the plane, plane units (mm). */
  height: number;
  /** Point on the plane directly below the camera, plane mm. */
  nadir: Vec2;
}

/** Diagonal field of view assumed when f cannot be estimated: a phone's main camera. */
export const ASSUMED_DIAGONAL_FOV_DEG = 75;

/** `planeToImage` maps plane mm → undistorted image px. */
export function cameraFromHomography(planeToImage: Mat3, width: number, height: number): CameraEstimate | null {
  // Shift the principal point to the origin.
  const cx = width / 2;
  const cy = height / 2;
  const H = planeToImage.map((v) => v);
  for (let c = 0; c < 3; c++) {
    H[0 * 3 + c] = planeToImage[0 * 3 + c]! - cx * planeToImage[2 * 3 + c]!;
    H[1 * 3 + c] = planeToImage[1 * 3 + c]! - cy * planeToImage[2 * 3 + c]!;
  }
  const col = (c: number) => [H[c]!, H[3 + c]!, H[6 + c]!] as const;
  const [h1, h2, h3] = [col(0), col(1), col(2)];
  const est: number[] = [];
  const f2a = -(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]);
  const f2b = -(h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / (h1[2] ** 2 - h2[2] ** 2);
  const diag = Math.hypot(cx, cy);
  const plausible = (f2: number) => Number.isFinite(f2) && f2 > 0 && Math.sqrt(f2) > 0.4 * diag && Math.sqrt(f2) < 5 * diag;
  // Each constraint is only informative when its denominator is well away from zero.
  const scale = Math.hypot(h1[2], h2[2]) ** 2;
  if (plausible(f2a) && Math.abs(h1[2] * h2[2]) > 0.05 * scale) est.push(f2a);
  if (plausible(f2b) && Math.abs(h1[2] ** 2 - h2[2] ** 2) > 0.05 * scale) est.push(f2b);
  const assumed = diag / Math.tan(((ASSUMED_DIAGONAL_FOV_DEG / 2) * Math.PI) / 180);
  const f = est.length ? Math.sqrt(est.reduce((a, b) => a + b, 0) / est.length) : assumed;
  const Kinv = (v: readonly [number, number, number]) => [v[0] / f, v[1] / f, v[2]] as const;
  const b1 = Kinv(h1);
  const b2 = Kinv(h2);
  const b3 = Kinv(h3);
  const n1 = Math.hypot(...b1);
  const n2 = Math.hypot(...b2);
  let lambda = 2 / (n1 + n2);
  // The plane must be in front of the camera.
  if (b3[2] * lambda < 0) lambda = -lambda;
  const r1 = b1.map((v) => v * lambda);
  const r2 = b2.map((v) => v * lambda);
  const t = b3.map((v) => v * lambda);
  const r3 = [r1[1]! * r2[2]! - r1[2]! * r2[1]!, r1[2]! * r2[0]! - r1[0]! * r2[2]!, r1[0]! * r2[1]! - r1[1]! * r2[0]!];
  // Camera centre in plane coordinates: C = −Rᵀ t.
  const R = [r1, r2, r3];
  const C = [0, 1, 2].map((i) => -(R[i]![0]! * t[0]! + R[i]![1]! * t[1]! + R[i]![2]! * t[2]!));
  if (!C.every(Number.isFinite)) return null;
  return { f, fSource: est.length ? 'estimated' : 'assumed', height: Math.abs(C[2]!), nadir: { x: C[0]!, y: C[1]! } };
}

/**
 * Similarity that maps plane positions measured for features raised `h` mm above the
 * calibrated plane to their true positions: a shrink towards the nadir.
 */
export function raisedPlaneCorrection(cam: CameraEstimate, h: number): Mat3 {
  const k = (cam.height - h) / cam.height;
  return [k, 0, cam.nadir.x * (1 - k), 0, k, cam.nadir.y * (1 - k), 0, 0, 1];
}
