/**
 * Rounded corners for wire, tube and loom paths, for drawing (ADR 0017).
 *
 * Each interior corner is replaced by a quadratic Bézier curve. It starts `radius` back along
 * the leg coming in and ends `radius` along the leg going out, with the corner as its control
 * point. Each leg gives at most half its length to a corner, so neighbouring curves meet but
 * never overlap. Where they meet, the path is a smooth quadratic B-spline. The curve keeps the
 * direction of each leg where it joins it, so the path has no kinks. The ends never move.
 *
 * The curve is sampled into short straight pieces, so callers draw it as a polyline in 2D or
 * 3D. Lengths are still measured on the corner-to-corner polyline (`wiring/length.ts`), which
 * is slightly longer than the rounded path.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** How far back from each corner the rounding starts, mm: a gentle loom bend. */
export const BEND_RADIUS_MM = 30;

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: P3) => Math.hypot(a.x, a.y, a.z);
const along = (a: P3, b: P3, t: number): P3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** Drop points that sit on the one before, so every leg has a direction. */
function dedupe(pts: P3[]): P3[] {
  const out: P3[] = [];
  for (const p of pts) if (!out.length || len(sub(p, out[out.length - 1]!)) > 1e-6) out.push(p);
  return out;
}

/** A path with its corners rounded, as sample points. Paths of two points come back as they are. */
export function smoothPath(points: P3[], radius = BEND_RADIUS_MM): P3[] {
  const pts = dedupe(points);
  if (pts.length < 3 || radius <= 0) return pts.map((p) => ({ ...p }));
  const out: P3[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const c = pts[i]!;
    const next = pts[i + 1]!;
    const lin = len(sub(c, prev));
    const lout = len(sub(next, c));
    const a = along(c, prev, Math.min(radius, lin / 2) / lin);
    const b = along(c, next, Math.min(radius, lout / 2) / lout);
    // More samples for sharper turns: about one every 6° of turn.
    const u = sub(c, prev);
    const v = sub(next, c);
    const cos = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lin * lout)));
    const n = Math.max(2, Math.ceil(Math.acos(cos) / (Math.PI / 30)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const s = 1 - t;
      out.push({
        x: s * s * a.x + 2 * s * t * c.x + t * t * b.x,
        y: s * s * a.y + 2 * s * t * c.y + t * t * b.y,
        z: s * s * a.z + 2 * s * t * c.z + t * t * b.z,
      });
    }
  }
  out.push({ ...pts[pts.length - 1]! });
  return dedupe(out);
}

/** Total length of a polyline. */
export function pathLength(pts: P3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i]!, pts[i - 1]!));
  return s;
}

/** The middle of a leg: where its handle for adding a point sits, and the new point's depth. */
export function midpoint(a: P3, b: P3): P3 {
  return along(a, b, 0.5);
}
