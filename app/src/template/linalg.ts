/**
 * Small dense linear algebra for the template pipeline: least squares by normal equations
 * with partial pivoting, and 3 × 3 helpers. The systems here are tiny (≤ 9 unknowns) and
 * well conditioned after normalising the data, so nothing heavier is needed.
 */

/** Solve A x = b for square A by Gaussian elimination with partial pivoting; null if singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** Weighted least squares: minimise Σ wᵢ (aᵢ·x − bᵢ)². */
export function leastSquares(rows: number[][], rhs: number[], weights?: number[]): number[] | null {
  const n = rows[0]?.length ?? 0;
  const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const Atb = new Array<number>(n).fill(0);
  rows.forEach((a, i) => {
    const w = weights?.[i] ?? 1;
    for (let r = 0; r < n; r++) {
      Atb[r]! += w * a[r]! * rhs[i]!;
      for (let c = r; c < n; c++) AtA[r]![c]! += w * a[r]! * a[c]!;
    }
  });
  for (let r = 0; r < n; r++) for (let c = 0; c < r; c++) AtA[r]![c] = AtA[c]![r]!;
  return solve(AtA, Atb);
}

/** 3 × 3 matrix as 9 numbers, row major. */
export type Mat3 = number[];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c]! += a[r * 3 + k]! * b[k * 3 + c]!;
  return o;
}

export function inv3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Eigen-decomposition of a symmetric 2 × 2 matrix [[a, b], [b, c]]: values (larger first) and the first vector. */
export function eigSym2(a: number, b: number, c: number): { l1: number; l2: number; v1: [number, number] } {
  const t = (a + c) / 2;
  const d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const l1 = t + d;
  const l2 = t - d;
  const v1: [number, number] = Math.abs(b) > 1e-15 ? [l1 - c, b] : a >= c ? [1, 0] : [0, 1];
  const n = Math.hypot(v1[0], v1[1]);
  return { l1, l2, v1: [v1[0] / n, v1[1] / n] };
}
