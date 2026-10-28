/**
 * A synthetic cutting-mat photo for template tests: solid inch lines, dashed half lines, a
 * cardboard template covering the middle, a tilted pinhole camera with barrel distortion,
 * and sensor noise. The truth is known exactly.
 */
import { applyH } from '../src/template/homography';
import { inv3, mul3 } from '../src/template/linalg';
import { undistort } from '../src/template/mapping';
import type { Raster } from '../src/template/raster';

export interface Scene {
  raster: Raster;
  /** True plane (mm, mat coordinates) → undistorted image px. */
  P: number[];
  k1: number;
  camHeight: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Render a mat photographed from `height` mm, tilted by `tilt` radians about x. */
export function renderMat(opts: { w: number; h: number; f: number; height: number; tilt: number; yaw: number; k1: number; seed: number }): Scene {
  const { w, h, f, height, tilt, yaw, k1 } = opts;
  // Camera at height `height`, looking at the mat centre from `tilt` off vertical,
  // from a direction turned by `yaw`.
  const back = height * Math.tan(tilt);
  const C = [back * Math.sin(yaw), -back * Math.cos(yaw), height];
  const norm = (v: number[]) => {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const fwd = norm([-C[0]!, -C[1]!, -C[2]!]);
  const right = norm(cross(fwd, [0, 0, 1]));
  const down = cross(fwd, right);
  const R = [right, down, fwd];
  const t = R.map((r) => -(r[0]! * C[0]! + r[1]! * C[1]! + r[2]! * C[2]!));
  const K = [f, 0, w / 2, 0, f, h / 2, 0, 0, 1];
  // P = K [r1 r2 t]: plane (x, y) → image.
  const M = [R[0]![0]!, R[0]![1]!, t[0]!, R[1]![0]!, R[1]![1]!, t[1]!, R[2]![0]!, R[2]![1]!, t[2]!];
  const P = mul3(K, M);
  const Pi = inv3(P)!;
  const r = rng(opts.seed);
  const data = new Uint8Array(w * h * 4);
  const m = { k1, width: w, height: h };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Supersample 2 × 2 for anti-aliased lines.
      let R0 = 0;
      let G0 = 0;
      let B0 = 0;
      for (const [ox, oy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const u = undistort(m, { x: x + ox!, y: y + oy! });
        const q = applyH(Pi, u);
        let c: [number, number, number] = [40, 150, 120];
        const inMat = Math.abs(q.x) < 230 && Math.abs(q.y) < 160;
        const inCard = Math.abs(q.x) < 120 && q.y > -100 && q.y < 110 && !(q.y < -20 && Math.abs(q.x) > 45);
        if (!inMat) c = [110, 70, 40];
        else if (inCard) c = [190, 160, 120];
        else {
          const dSolid = Math.min(Math.abs(q.x - 25.4 * Math.round(q.x / 25.4)), Math.abs(q.y - 25.4 * Math.round(q.y / 25.4)));
          const hx = Math.abs(q.x - 12.7 - 25.4 * Math.round((q.x - 12.7) / 25.4));
          const hy = Math.abs(q.y - 12.7 - 25.4 * Math.round((q.y - 12.7) / 25.4));
          const dashOnX = ((q.y % 4) + 4) % 4 < 2.4;
          const dashOnY = ((q.x % 4) + 4) % 4 < 2.4;
          if (dSolid < 0.45) c = [225, 235, 90];
          else if ((hx < 0.3 && dashOnX) || (hy < 0.3 && dashOnY)) c = [190, 215, 95];
        }
        R0 += c[0];
        G0 += c[1];
        B0 += c[2];
      }
      const n = () => (r() - 0.5) * 16;
      const i = (y * w + x) * 4;
      data[i] = R0 / 4 + n();
      data[i + 1] = G0 / 4 + n();
      data[i + 2] = B0 / 4 + n();
      data[i + 3] = 255;
    }
  }
  return { raster: { width: w, height: h, data }, P, k1, camHeight: height };
}

