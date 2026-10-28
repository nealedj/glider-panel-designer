/**
 * Wire and tube lengths, and bundle sizes. See ADR 0012.
 *
 * A wire on a route leaves its first terminal straight to the nearest point of the route,
 * follows the route, and leaves it at the point nearest its second terminal. All distances
 * are 3D, so depth changes count. A wire with no route is taken as a straight 3D line and
 * marked as an estimate. Two off-panel parts at the same exit are joined beyond the panel,
 * by the difference of their runs. To either end is added the end allowance (stripping, termination,
 * service loop), and for off-panel parts, the run from the panel exit to the part.
 */
import type { PlacedPart, Project, Route, Wire } from '../model/schema';
import { keyOf, type TerminalInfo, type Vec3 } from './terminals';

const d3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function routeLength(r: Pick<Route, 'points'>): number {
  let s = 0;
  for (let i = 1; i < r.points.length; i++) s += d3(r.points[i - 1]!, r.points[i]!);
  return s;
}

/** The nearest point of a route to p, and how far along the route it is. */
export function projectOnRoute(r: Pick<Route, 'points'>, p: Vec3): { at: Vec3; s: number; dist: number } {
  let best = { at: r.points[0]!, s: 0, dist: Infinity };
  let s0 = 0;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1]!;
    const b = r.points[i]!;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const L2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / L2)) : 0;
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    const dist = d3(p, q);
    if (dist < best.dist - 1e-9) best = { at: q, s: s0 + Math.sqrt(L2) * t, dist };
    s0 += Math.sqrt(L2);
  }
  return best;
}

export interface WireLength {
  mm: number;
  /** No route: a straight line, so the real wire will be longer. */
  estimated: boolean;
  /** Off-panel run unknown for an end on an off-panel part. */
  missingOffPanel: boolean;
  /** The 3D path, for drawing. */
  path: Vec3[];
}

export function wireLength(w: Wire, doc: Project, terms: Map<string, TerminalInfo>): WireLength | null {
  const a = terms.get(keyOf(w.from));
  const b = terms.get(keyOf(w.to));
  if (!a || !b) return null;
  const route = w.route ? doc.routes.find((r) => r.id === w.route) : undefined;
  let core: number;
  let path: Vec3[];
  if (route && route.points.length >= 2) {
    const pa = projectOnRoute(route, a.pos);
    const pb = projectOnRoute(route, b.pos);
    const [lo, hi] = pa.s <= pb.s ? [pa, pb] : [pb, pa];
    core = pa.dist + Math.abs(pb.s - pa.s) + pb.dist;
    // The route's own vertices between the two projections, in order.
    let s = 0;
    const inner: Vec3[] = [];
    for (let i = 0; i < route.points.length; i++) {
      if (i > 0) s += d3(route.points[i - 1]!, route.points[i]!);
      if (s > lo.s + 1e-9 && s < hi.s - 1e-9) inner.push(route.points[i]!);
    }
    const along = pa.s <= pb.s ? inner : inner.reverse();
    path = [a.pos, pa.at, ...along, pb.at, b.pos];
  } else {
    core = d3(a.pos, b.pos);
    path = [a.pos, b.pos];
  }
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const off = (t: TerminalInfo): { mm: number; missing: boolean } => {
    if (!t.offPanel) return { mm: 0, missing: false };
    const pp = byId.get(t.partId) as PlacedPart | undefined;
    return pp?.offPanelRunMm == null ? { mm: 0, missing: true } : { mm: pp.offPanelRunMm, missing: false };
  };
  const oa = off(a);
  const ob = off(b);
  // Two off-panel parts at the same exit (battery and its main fuse) are joined beyond the
  // panel: the wire is the difference of their runs, not a trip to the panel and back.
  if (a.offPanel && b.offPanel && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 1) {
    return { mm: Math.abs(oa.mm - ob.mm) + 2 * doc.settings.endAllowanceMm, estimated: false, missingOffPanel: oa.missing || ob.missing, path: [a.pos, b.pos] };
  }
  return { mm: core + oa.mm + ob.mm + 2 * doc.settings.endAllowanceMm, estimated: !route, missingOffPanel: oa.missing || ob.missing, path };
}

/** Outer diameter estimate for a wire of conductor area mm², or a tube of bore mm. */
export function outerDiameter(w: Pick<Wire, 'sizeMm2' | 'tubeBoreMm'>, sizeMm2: number | null): number {
  if (w.tubeBoreMm) return w.tubeBoreMm + 2; // tube wall about 1 mm
  const a = sizeMm2 ?? 0.5;
  // Stranded conductor about 15 % over solid, plus about 0.25 mm of insulation each side.
  return 1.15 * Math.sqrt((4 * a) / Math.PI) + 0.5;
}

/** Bundle diameter estimate: 1.15 × √(Σ d²), the usual packing allowance for round wires. */
export function bundleDiameter(ods: number[]): number {
  if (!ods.length) return 0;
  return 1.15 * Math.sqrt(ods.reduce((s, d) => s + d * d, 0));
}
