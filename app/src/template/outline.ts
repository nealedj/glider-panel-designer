/**
 * Outline editing operations, as pure functions on polylines with bulged arcs.
 */
import { arcCentre } from '../geom/shapes';
import type { PolyVertex } from '../model/schema';

/** Signed area; positive when counter-clockwise (y up). Arcs are ignored, which is fine for a sign. */
export function signedArea(pts: PolyVertex[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Reverse the winding: each arc's bulge moves to its new start vertex and changes sign. */
export function reverse(pts: PolyVertex[]): PolyVertex[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const p = pts[n - 1 - i]!;
    const seg = pts[(2 * n - 2 - i) % n]!; // the segment that ended at p now starts there
    return { x: p.x, y: p.y, ...(seg.bulge ? { bulge: -seg.bulge } : {}) };
  });
}

export function ccw(pts: PolyVertex[]): PolyVertex[] {
  return signedArea(pts) >= 0 ? pts : reverse(pts);
}

/** Replace any arc that crosses x = 0 with short chords, so clipping at the axis stays exact. */
function flattenAxisArcs(pts: PolyVertex[], tol = 0.05): PolyVertex[] {
  const out: PolyVertex[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (!a.bulge) {
      out.push(a);
      continue;
    }
    const theta = 4 * Math.atan(a.bulge);
    const { cx, cy, r } = arcCentre(a, b, a.bulge);
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    // Does the arc reach x = 0 strictly between its ends?
    const n = Math.max(8, Math.ceil(Math.abs(theta) / (2 * Math.acos(Math.max(-1, 1 - tol / Math.max(r, tol))))));
    const pts2 = Array.from({ length: n - 1 }, (_, k) => ({ x: cx + r * Math.cos(a0 + (theta * (k + 1)) / n), y: cy + r * Math.sin(a0 + (theta * (k + 1)) / n) }));
    const crosses = [a, ...pts2, b].some((p, k, arr) => k > 0 && Math.sign(p.x) !== Math.sign(arr[k - 1]!.x) && Math.abs(p.x) > 1e-9 && Math.abs(arr[k - 1]!.x) > 1e-9);
    if (!crosses) {
      out.push(a);
      continue;
    }
    out.push({ x: a.x, y: a.y }, ...pts2);
  }
  return out;
}

/**
 * Keep one half of the outline (x ≤ 0 for 'left', x ≥ 0 for 'right') and mirror it about
 * x = 0 onto the other, for symmetric panels. Returns null unless the outline crosses the
 * centreline exactly twice.
 */
export function mirrorHalf(outline: PolyVertex[], keep: 'left' | 'right'): PolyVertex[] | null {
  const sign = keep === 'left' ? -1 : 1;
  const pts = flattenAxisArcs(ccw(outline));
  const n = pts.length;
  const inside = (x: number) => sign * x >= -1e-9;
  // Clip to the kept half-plane (Sutherland–Hodgman against one line).
  const clipped: PolyVertex[] = [];
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const inA = inside(a.x);
    const inB = inside(b.x);
    if (inA) clipped.push({ ...a, ...(inB ? {} : { bulge: undefined }) });
    if (inA !== inB) {
      crossings++;
      const t = a.x / (a.x - b.x);
      clipped.push({ x: 0, y: a.y + t * (b.y - a.y) });
    }
  }
  if (crossings !== 2) return null;
  for (const p of clipped) if (p.bulge === undefined) delete p.bulge;
  // Find the edge along the axis and open the polygon there: side runs axis → … → axis.
  const m0 = clipped.length;
  let cut = -1;
  for (let i = 0; i < m0; i++) {
    const a = clipped[i]!;
    const b = clipped[(i + 1) % m0]!;
    if (Math.abs(a.x) < 1e-9 && Math.abs(b.x) < 1e-9 && !a.bulge) cut = i;
  }
  if (cut < 0) return null;
  const side = [...clipped.slice(cut + 1), ...clipped.slice(0, cut + 1)];
  const m = side.length;
  // side[0] and side[m − 1] are on the axis. Mirror the run back, reversed. The mirror of
  // segment side[k] → side[k+1] runs mirror(side[k+1]) → mirror(side[k]) with the same
  // bulge: reflection and reversal each flip its sign.
  const out: PolyVertex[] = side.slice(0, m - 1).map((p) => ({ ...p }));
  const lastSeg = side[m - 2]!;
  out.push({ x: 0, y: side[m - 1]!.y, ...(lastSeg.bulge ? { bulge: lastSeg.bulge } : {}) });
  for (let k = m - 2; k >= 1; k--) out.push({ x: -side[k]!.x, y: side[k]!.y, ...(side[k - 1]!.bulge ? { bulge: side[k - 1]!.bulge } : {}) });
  return ccw(out);
}

/** Insert a vertex on segment i (from vertex i to i+1), splitting an arc into two arcs. */
export function insertVertex(pts: PolyVertex[], i: number, at: { x: number; y: number }): PolyVertex[] {
  const a = pts[i]!;
  const out = pts.map((p) => ({ ...p }));
  if (a.bulge) {
    // Keep the arc: each part sweeps the same share of the angle as its end point does.
    const b = pts[(i + 1) % pts.length]!;
    const { cx, cy } = arcCentre(a, b, a.bulge);
    const theta = 4 * Math.atan(a.bulge);
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    let t = Math.atan2(at.y - cy, at.x - cx) - a0;
    while (theta > 0 && t < 0) t += 2 * Math.PI;
    while (theta < 0 && t > 0) t -= 2 * Math.PI;
    const r = Math.hypot(a.x - cx, a.y - cy);
    const p = { x: cx + r * Math.cos(a0 + t), y: cy + r * Math.sin(a0 + t) };
    out[i] = { ...a, bulge: Math.tan(t / 4) };
    out.splice(i + 1, 0, { ...p, bulge: Math.tan((theta - t) / 4) });
    return out;
  }
  out.splice(i + 1, 0, { x: at.x, y: at.y });
  return out;
}

export function removeVertex(pts: PolyVertex[], i: number): PolyVertex[] {
  if (pts.length <= 3) return pts;
  const out = pts.map((p) => ({ ...p }));
  out.splice(i, 1);
  // The merged segment starts at the previous vertex and is straight.
  const prev = (i - 1 + out.length) % out.length;
  delete out[prev]!.bulge;
  return out;
}

/** Bulge for an arc from a to b that passes through (or nearest to) the point m. */
export function bulgeThrough(a: { x: number; y: number }, b: { x: number; y: number }, m: { x: number; y: number }): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-9) return 0;
  // Signed sagitta: distance of m from the chord, positive to the left of a → b.
  const s = ((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)) / L;
  if (Math.abs(s) < 0.05) return 0;
  // A counter-clockwise arc (positive bulge) lies to the right of its chord, and its
  // sagitta is bulge × L / 2.
  return (-2 * s) / L;
}
