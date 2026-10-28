/**
 * Fitting circles and ellipses to clicked edge points, and recovering the panel plane
 * from round instruments of known size. See ADR 0010.
 */
import type { Vec2 } from '../model/schema';
import { applyH } from './homography';
import { eigSym2, leastSquares, solve, type Mat3 } from './linalg';

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS radial residual. */
  rms: number;
}

/** Circle through three or more points: algebraic (Kåsa) start, then geometric Gauss–Newton. */
export function fitCircle(pts: Vec2[]): CircleFit | null {
  if (pts.length < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const q = pts.map((p) => ({ x: p.x - mx, y: p.y - my }));
  const sol = leastSquares(
    q.map((p) => [p.x, p.y, 1]),
    q.map((p) => p.x * p.x + p.y * p.y),
  );
  if (!sol) return null;
  let cx = sol[0]! / 2;
  let cy = sol[1]! / 2;
  let r = Math.sqrt(Math.max(0, sol[2]! + cx * cx + cy * cy));
  for (let it = 0; it < 20; it++) {
    const J: number[][] = [];
    const res: number[] = [];
    for (const p of q) {
      const d = Math.hypot(p.x - cx, p.y - cy) || 1e-12;
      J.push([-(p.x - cx) / d, -(p.y - cy) / d, -1]);
      res.push(-(d - r));
    }
    const step = leastSquares(J, res);
    if (!step) break;
    cx += step[0]!;
    cy += step[1]!;
    r += step[2]!;
    if (Math.hypot(step[0]!, step[1]!, step[2]!) < 1e-12) break;
  }
  const rms = Math.sqrt(q.reduce((s, p) => s + (Math.hypot(p.x - cx, p.y - cy) - r) ** 2, 0) / q.length);
  return { cx: cx + mx, cy: cy + my, r: Math.abs(r), rms };
}

export interface EllipseFit {
  cx: number;
  cy: number;
  /** Quadratic form: (p − c)ᵀ M (p − c) = 1 on the ellipse. */
  M: [number, number, number];
  /** Semi-axes, larger first. */
  a: number;
  b: number;
  /** Angle of the major axis, radians. */
  angle: number;
}

/** Ellipse through five or more points (algebraic least squares on centred, scaled data). */
export function fitEllipse(pts: Vec2[]): EllipseFit | null {
  if (pts.length < 5) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const k = pts.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / pts.length || 1;
  const q = pts.map((p) => ({ x: (p.x - mx) / k, y: (p.y - my) / k }));
  // A x² + B xy + C y² + D x + E y = 1, which holds with the origin inside the ellipse.
  const sol = leastSquares(
    q.map((p) => [p.x * p.x, p.x * p.y, p.y * p.y, p.x, p.y]),
    q.map(() => 1),
  );
  if (!sol) return null;
  const [A, B, C, D, E] = sol as [number, number, number, number, number];
  if (4 * A * C - B * B <= 0) return null;
  const c = solve(
    [
      [2 * A, B],
      [B, 2 * C],
    ],
    [-D, -E],
  );
  if (!c) return null;
  const [x0, y0] = c as [number, number];
  const Fc = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 - 1;
  if (Fc >= 0) return null;
  // Undo the scaling: M in pixel units.
  const s = -Fc * k * k;
  const M: [number, number, number] = [A / s, B / 2 / s, C / s];
  const { l1, l2, v1 } = eigSym2(M[0], M[1], M[2]);
  if (l2 <= 0) return null;
  // The larger eigenvalue belongs to the shorter axis.
  return { cx: x0 * k + mx, cy: y0 * k + my, M, a: 1 / Math.sqrt(l2), b: 1 / Math.sqrt(l1), angle: Math.atan2(-v1[0], v1[1]) };
}

export interface KnownCircle {
  /** Points clicked on the circle's edge, image pixels. */
  points: Vec2[];
  /** True diameter, mm. */
  diameter: number;
}

export interface CirclePlaneFit {
  /** Image pixels to plane mm. */
  H: Mat3;
  /** Per circle: fitted diameter in the plane minus the stated one, mm. */
  diameterErrors: number[];
  /** RMS radial error of every edge point, mm. */
  rms: number;
  model: 'affine' | 'projective';
}

/**
 * The panel plane from round instruments of known size.
 *
 * With one or two circles, a common affine map is recovered from the ellipses' shapes (a
 * circle seen at a distance). With three or more, that is refined to a full homography by
 * making every edge point lie on its circle (Levenberg–Marquardt), which handles angled
 * photos taken close up.
 */
export function planeFromCircles(circles: KnownCircle[]): CirclePlaneFit | null {
  const ell = circles.map((c) => fitEllipse(c.points));
  if (ell.some((e) => !e) || !circles.length) return null;
  const es = ell as EllipseFit[];
  // Average the det-normalised shape: each Mᵢ = N · √det Mᵢ for a common affine map.
  let n0 = 0;
  let n1 = 0;
  let n2 = 0;
  for (const e of es) {
    const d = Math.sqrt(e.M[0] * e.M[2] - e.M[1] * e.M[1]);
    n0 += e.M[0] / d;
    n1 += e.M[1] / d;
    n2 += e.M[2] / d;
  }
  n0 /= es.length;
  n1 /= es.length;
  n2 /= es.length;
  const dn = Math.sqrt(n0 * n2 - n1 * n1);
  [n0, n1, n2] = [n0 / dn, n1 / dn, n2 / dn];
  // Symmetric square root of N, so the image keeps its orientation.
  const { l1, l2, v1 } = eigSym2(n0, n1, n2);
  const [s1, s2] = [Math.sqrt(l1), Math.sqrt(l2)];
  const [ux, uy] = v1;
  const L = [s1 * ux * ux + s2 * uy * uy, (s1 - s2) * ux * uy, (s1 - s2) * ux * uy, s1 * uy * uy + s2 * ux * ux];
  // Radius of each ellipse after L, and the scale that best matches the stated sizes.
  const rho = es.map((e) => 1 / Math.sqrt(Math.sqrt(e.M[0] * e.M[2] - e.M[1] * e.M[1])));
  const R = circles.map((c) => c.diameter / 2);
  const s = rho.reduce((a, r, i) => a + r * R[i]!, 0) / rho.reduce((a, r) => a + r * r, 0);
  const c0 = { x: es[0]!.cx, y: es[0]!.cy };
  const Haff: Mat3 = [s * L[0]!, s * L[1]!, -s * (L[0]! * c0.x + L[1]! * c0.y), s * L[2]!, s * L[3]!, -s * (L[2]! * c0.x + L[3]! * c0.y), 0, 0, 1];
  const H = circles.length >= 3 ? refineCircles(Haff, circles) : Haff;
  return { ...circleErrors(H, circles), H, model: circles.length >= 3 ? 'projective' : 'affine' };
}

function circleErrors(H: Mat3, circles: KnownCircle[]) {
  let sum = 0;
  let count = 0;
  const diameterErrors = circles.map((c) => {
    const f = fitCircle(c.points.map((p) => applyH(H, p)))!;
    for (const p of c.points) {
      const q = applyH(H, p);
      sum += (Math.hypot(q.x - f.cx, q.y - f.cy) - c.diameter / 2) ** 2;
      count++;
    }
    return 2 * f.r - c.diameter;
  });
  return { diameterErrors, rms: Math.sqrt(sum / count) };
}

/** LM over H's 8 entries and each circle's centre, with the radii fixed at their stated sizes. */
function refineCircles(H0: Mat3, circles: KnownCircle[]): Mat3 {
  // Work in centred, scaled image coordinates for conditioning.
  const all = circles.flatMap((c) => c.points);
  const mx = all.reduce((s, p) => s + p.x, 0) / all.length;
  const my = all.reduce((s, p) => s + p.y, 0) / all.length;
  const k = all.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / all.length || 1;
  const T: Mat3 = [1 / k, 0, -mx / k, 0, 1 / k, -my / k, 0, 0, 1];
  const Tinv: Mat3 = [k, 0, mx, 0, k, my, 0, 0, 1];
  // H0 ∘ T⁻¹ acts on normalised points.
  const mulM = (a: Mat3, b: Mat3) => {
    const o = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let q = 0; q < 3; q++) o[r * 3 + c]! += a[r * 3 + q]! * b[q * 3 + c]!;
    return o;
  };
  let Hn = mulM(H0, Tinv);
  Hn = Hn.map((v) => v / Hn[8]!);
  const pts = circles.map((c) => c.points.map((p) => applyH(T, p)));
  let centres = pts.map((ps) => {
    const f = fitCircle(ps.map((p) => applyH(Hn, p)))!;
    return { x: f.cx, y: f.cy };
  });
  const params = () => [...Hn.slice(0, 8), ...centres.flatMap((c) => [c.x, c.y])];
  const unpack = (p: number[]) => ({ H: [...p.slice(0, 8), 1], C: centres.map((_, i) => ({ x: p[8 + 2 * i]!, y: p[9 + 2 * i]! })) });
  const residuals = (p: number[]) => {
    const { H, C } = unpack(p);
    const out: number[] = [];
    pts.forEach((ps, i) => {
      for (const q of ps) {
        const w = applyH(H, q);
        out.push(Math.hypot(w.x - C[i]!.x, w.y - C[i]!.y) - circles[i]!.diameter / 2);
      }
    });
    return out;
  };
  let p = params();
  let r = residuals(p);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  for (let it = 0; it < 100; it++) {
    // Numeric Jacobian: the problem is small.
    const J = r.map(() => new Array<number>(p.length).fill(0));
    for (let j = 0; j < p.length; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(p[j]!));
      const pp = [...p];
      pp[j]! += h;
      const rr = residuals(pp);
      for (let i = 0; i < r.length; i++) J[i]![j] = (rr[i]! - r[i]!) / h;
    }
    const n = p.length;
    const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const Atr = new Array<number>(n).fill(0);
    J.forEach((row, i) => {
      for (let a = 0; a < n; a++) {
        if (!row[a]) continue;
        Atr[a]! -= row[a]! * r[i]!;
        for (let b = 0; b < n; b++) AtA[a]![b]! += row[a]! * row[b]!;
      }
    });
    let improved = false;
    for (let tries = 0; tries < 10 && !improved; tries++) {
      const A = AtA.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (v || 1) : v)));
      const step = solve(A, Atr);
      if (!step) {
        lambda *= 10;
        continue;
      }
      const np = p.map((v, i) => v + step[i]!);
      const nr = residuals(np);
      const nc = nr.reduce((s, v) => s + v * v, 0);
      if (nc < cost) {
        const gain = cost - nc;
        p = np;
        r = nr;
        cost = nc;
        lambda = Math.max(lambda / 3, 1e-12);
        improved = true;
        if (gain < 1e-14 * Math.max(1, cost)) it = 1e9;
      } else lambda *= 10;
    }
    if (!improved) break;
  }
  const { H, C } = unpack(p);
  centres = C;
  return mulM(H, T).map((v, _i, arr) => v / arr[8]!);
}
