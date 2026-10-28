/**
 * Snapping, as in 2D CAD: object alignment first (centres, bezel edges, template edges,
 * guides, the panel centreline), then the grid.
 */
import { boxCentre, shapeBox, shapeSnapPoints, type Box } from '../geom/shapes';
import type { PartGeometry } from '../model/resolve';
import type { Guide, KeepOut, PanelTemplate, Vec2 } from '../model/schema';
import type { SnapSettings } from '../store/ui';

export interface SnapTargets {
  xs: number[];
  ys: number[];
  points: Vec2[];
}

export interface SnapLine {
  axis: 'x' | 'y';
  value: number;
}

export interface SnapResult {
  point: Vec2;
  lines: SnapLine[];
  /** A snapped-to point, for a marker. */
  marker: Vec2 | null;
}

/** Collect snap targets, excluding the parts being moved. */
export function collectTargets(
  geometry: Map<string, PartGeometry>,
  exclude: Set<string>,
  template: PanelTemplate | undefined,
  guides: Guide[],
  keepOuts: KeepOut[],
  settings: SnapSettings,
): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  const points: Vec2[] = [];
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
  return { xs, ys, points };
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
): { delta: Vec2; lines: SnapLine[] } {
  const c = boxCentre(box);
  const movingX = [box.minX, anchor.x, c.x, box.maxX].map((v) => v + delta.x);
  const movingY = [box.minY, anchor.y, c.y, box.maxY].map((v) => v + delta.y);
  const lines: SnapLine[] = [];

  const axis = (moving: number[], targetsOnAxis: number[], anchorV: number, d: number, name: 'x' | 'y') => {
    let bestShift: number | null = null;
    let bestTarget = 0;
    for (const m of moving) {
      const t = nearest(targetsOnAxis, m, tol);
      if (t !== null && (bestShift === null || Math.abs(t - m) < Math.abs(bestShift))) {
        bestShift = t - m;
        bestTarget = t;
      }
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
  };
}
