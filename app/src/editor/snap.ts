/**
 * Snapping, as in 2D CAD: object alignment first (centres, bezel edges, template edges,
 * guides, the panel centreline) and equal gaps between parts, then the grid.
 */
import { boxCentre, shapeBox, shapeSnapPoints, type Box } from '../geom/shapes';
import type { PartGeometry } from '../model/resolve';
import type { Guide, KeepOut, PanelTemplate, Vec2 } from '../model/schema';
import type { SnapSettings } from '../store/ui';

export interface SnapTargets {
  xs: number[];
  ys: number[];
  points: Vec2[];
  /** Boxes of the other parts, and the gaps between them, for equal-gap snapping. */
  boxes: Box[];
  gaps: { x: SnapGap[]; y: SnapGap[] };
}

export interface SnapLine {
  axis: 'x' | 'y';
  value: number;
}

/** A gap along `axis` from `a` to `b`, drawn across at `at`. */
export interface SnapGap {
  axis: 'x' | 'y';
  a: number;
  b: number;
  at: number;
}

export interface SnapResult {
  point: Vec2;
  lines: SnapLine[];
  /** A snapped-to point, for a marker. */
  marker: Vec2 | null;
}

/** Front view: parts on the panel face, by their cut and bezel bounds. */
const frontGapBox = (g: PartGeometry): Box | null => (g.mounted || g.part.offPanel ? null : g.frontBox);

/**
 * Collect snap targets, excluding the parts being moved. `gapBox` gives the box a part
 * keeps its gaps by in the current view, or null to leave it out.
 */
export function collectTargets(
  geometry: Map<string, PartGeometry>,
  exclude: Set<string>,
  template: PanelTemplate | undefined,
  guides: Guide[],
  keepOuts: KeepOut[],
  settings: SnapSettings,
  gapBox: (g: PartGeometry) => Box | null = frontGapBox,
): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  const points: Vec2[] = [];
  const boxes: Box[] = [];
  if (settings.gaps) {
    for (const [id, g] of geometry) {
      const b = exclude.has(id) ? null : gapBox(g);
      if (b) boxes.push(b);
    }
  }
  if (settings.objects) {
    for (const [id, g] of geometry) {
      if (exclude.has(id)) continue;
      const b = g.frontBox;
      xs.push(b.minX, g.transform.x, b.maxX);
      ys.push(b.minY, g.transform.y, b.maxY);
      points.push({ x: g.transform.x, y: g.transform.y });
      for (const s of g.cutouts) points.push(...shapeSnapPoints(s));
      if (g.bezel) points.push(...shapeSnapPoints(g.bezel));
      for (const h of g.holes) points.push({ x: h.x, y: h.y });
    }
    if (template) {
      const ob = shapeBox(template.outline);
      xs.push(ob.minX, ob.maxX);
      ys.push(ob.minY, ob.maxY);
      for (const p of template.outline.points) points.push({ x: p.x, y: p.y });
      for (const f of template.fixings) points.push({ x: f.x, y: f.y });
      for (const bl of template.bendLines) {
        points.push(bl.a, bl.b);
        if (Math.abs(bl.a.y - bl.b.y) < 1e-6) ys.push(bl.a.y);
        if (Math.abs(bl.a.x - bl.b.x) < 1e-6) xs.push(bl.a.x);
      }
    }
    for (const k of keepOuts) {
      const b = shapeBox(k.shape);
      xs.push(b.minX, b.maxX);
      ys.push(b.minY, b.maxY);
    }
    // Panel centreline and datum.
    xs.push(0);
    ys.push(0);
  }
  if (settings.guides) {
    for (const g of guides) (g.axis === 'x' ? xs : ys).push(g.value);
  }
  return { xs, ys, points, boxes, gaps: { x: boxGaps(boxes, 'x'), y: boxGaps(boxes, 'y') } };
}

function nearest(values: number[], v: number, tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  for (const c of values) {
    const d = Math.abs(c - v);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

/** Snap a single point (placing, measuring, drawing). `tol` is in mm. */
export function snapPoint(p: Vec2, targets: SnapTargets, settings: SnapSettings, grid: number, tol: number): SnapResult {
  // 1. A target point within tolerance wins outright.
  let best: Vec2 | null = null;
  let bestD = tol;
  for (const t of targets.points) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best) return { point: { ...best }, lines: [], marker: best };
  // 2. Axis alignment with targets, then the grid on any free axis.
  const sx = nearest(targets.xs, p.x, tol);
  const sy = nearest(targets.ys, p.y, tol);
  const lines: SnapLine[] = [];
  if (sx !== null) lines.push({ axis: 'x', value: sx });
  if (sy !== null) lines.push({ axis: 'y', value: sy });
  const x = sx ?? (settings.grid ? snapToGrid(p.x, grid) : p.x);
  const y = sy ?? (settings.grid ? snapToGrid(p.y, grid) : p.y);
  return { point: { x, y }, lines, marker: null };
}

type Axis = 'x' | 'y';
const lo = (b: Box, a: Axis) => (a === 'x' ? b.minX : b.minY);
const hi = (b: Box, a: Axis) => (a === 'x' ? b.maxX : b.maxY);
const cross = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
/** Boxes side by side along `a`: they overlap across it. */
const sideBySide = (p: Box, q: Box, a: Axis) => lo(p, cross(a)) < hi(q, cross(a)) && hi(p, cross(a)) > lo(q, cross(a));

/** The gaps between neighbouring boxes along `a`, each with where to draw it. */
export function boxGaps(boxes: Box[], a: Axis): SnapGap[] {
  const out: SnapGap[] = [];
  for (const p of boxes) {
    let next: Box | null = null;
    for (const q of boxes) {
      if (q === p || lo(q, a) < hi(p, a) || !sideBySide(p, q, a)) continue;
      if (!next || lo(q, a) < lo(next, a)) next = q;
    }
    if (next) {
      const c = cross(a);
      out.push({ axis: a, a: hi(p, a), b: lo(next, a), at: (Math.max(lo(p, c), lo(next, c)) + Math.min(hi(p, c), hi(next, c))) / 2 });
    }
  }
  return out;
}

interface GapCandidate {
  shift: number;
  gaps: SnapGap[];
}

/**
 * Shifts along `a` that put the moving box `m` at an equal gap: midway between its
 * neighbours, or at a gap already used between other parts.
 */
function gapCandidates(m: Box, boxes: Box[], existing: SnapGap[], a: Axis): GapCandidate[] {
  const c = cross(a);
  const mid = (lo(m, a) + hi(m, a)) / 2;
  const at = (lo(m, c) + hi(m, c)) / 2;
  let before: Box | null = null;
  let after: Box | null = null;
  for (const b of boxes) {
    if (!sideBySide(m, b, a)) continue;
    const bm = (lo(b, a) + hi(b, a)) / 2;
    if (bm < mid && (!before || hi(b, a) > hi(before, a))) before = b;
    if (bm > mid && (!after || lo(b, a) < lo(after, a))) after = b;
  }
  const size = hi(m, a) - lo(m, a);
  const out: GapCandidate[] = [];
  if (before && after) {
    const g = (lo(after, a) - hi(before, a) - size) / 2;
    if (g > 0) {
      const at0 = hi(before, a) + g;
      out.push({ shift: at0 - lo(m, a), gaps: [{ axis: a, a: hi(before, a), b: at0, at }, { axis: a, a: at0 + size, b: lo(after, a), at }] });
    }
  }
  for (const e of existing) {
    const g = e.b - e.a;
    if (g <= 0) continue;
    if (before) out.push({ shift: hi(before, a) + g - lo(m, a), gaps: [e, { axis: a, a: hi(before, a), b: hi(before, a) + g, at }] });
    if (after) out.push({ shift: lo(after, a) - g - hi(m, a), gaps: [e, { axis: a, a: lo(after, a) - g, b: lo(after, a), at }] });
  }
  return out;
}

/**
 * Snap a move. `box` is the moving selection's bounds before the move and `anchor` the
 * primary part's centre; returns the adjusted delta.
 */
export function snapMove(
  delta: Vec2,
  box: Box,
  anchor: Vec2,
  targets: SnapTargets,
  settings: SnapSettings,
  grid: number,
  tol: number,
): { delta: Vec2; lines: SnapLine[]; gaps: SnapGap[] } {
  const c = boxCentre(box);
  const movingX = [box.minX, anchor.x, c.x, box.maxX].map((v) => v + delta.x);
  const movingY = [box.minY, anchor.y, c.y, box.maxY].map((v) => v + delta.y);
  const moved = { minX: box.minX + delta.x, maxX: box.maxX + delta.x, minY: box.minY + delta.y, maxY: box.maxY + delta.y };
  const lines: SnapLine[] = [];
  const gaps: SnapGap[] = [];

  const axis = (moving: number[], targetsOnAxis: number[], anchorV: number, d: number, name: Axis) => {
    let bestShift: number | null = null;
    let bestTarget = 0;
    for (const m of moving) {
      const t = nearest(targetsOnAxis, m, tol);
      if (t !== null && (bestShift === null || Math.abs(t - m) < Math.abs(bestShift))) {
        bestShift = t - m;
        bestTarget = t;
      }
    }
    // An equal gap wins only when it is nearer than any alignment.
    let bestGap: GapCandidate | null = null;
    if (targets.boxes.length) {
      for (const g of gapCandidates(moved, targets.boxes, targets.gaps[name], name)) {
        if (Math.abs(g.shift) <= tol && (bestShift === null || Math.abs(g.shift) < Math.abs(bestShift) - 1e-9) && (!bestGap || Math.abs(g.shift) < Math.abs(bestGap.shift))) bestGap = g;
      }
    }
    if (bestGap) {
      gaps.push(...bestGap.gaps);
      return d + bestGap.shift;
    }
    if (bestShift !== null) {
      lines.push({ axis: name, value: bestTarget });
      return d + bestShift;
    }
    return settings.grid ? snapToGrid(anchorV + d, grid) - anchorV : d;
  };

  return {
    delta: { x: axis(movingX, targets.xs, anchor.x, delta.x, 'x'), y: axis(movingY, targets.ys, anchor.y, delta.y, 'y') },
    lines,
    gaps,
  };
}
