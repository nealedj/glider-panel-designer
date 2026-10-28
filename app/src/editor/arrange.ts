/**
 * Layout helpers for centring and auto-arranging parts. Pure functions on boxes; the
 * actions in `actions.ts` turn their moves into ops.
 */
import { boxCentre, flattenPoly, type Box } from '../geom/shapes';
import type { PanelTemplate, Vec2 } from '../model/schema';

/**
 * The stretch of panel face along a vertical line at `x` that contains `y`: from the
 * outline, cut short by any bend line crossing it. Null when `y` is off the panel.
 */
export function faceSpanY(template: PanelTemplate, x: number, y: number): [number, number] | null {
  const pts = flattenPoly(template.outline.points, 0.5);
  const ys: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    // Half-open, so a line through a vertex counts it once.
    if (p.x <= x !== q.x <= x) ys.push(p.y + ((x - p.x) * (q.y - p.y)) / (q.x - p.x));
  }
  ys.sort((a, b) => a - b);
  let span: [number, number] | null = null;
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i]! <= y && y <= ys[i + 1]!) span = [ys[i]!, ys[i + 1]!];
  if (!span) return null;
  for (const bl of template.bendLines) {
    const [a, b] = bl.a.x <= bl.b.x ? [bl.a, bl.b] : [bl.b, bl.a];
    if (x < a.x || x > b.x || b.x - a.x < 1e-9) continue;
    const by = a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
    if (by > span[0] && by < span[1]) span = by <= y ? [by, span[1]] : [span[0], by];
  }
  return span;
}

export interface LayoutItem {
  id: string;
  box: Box;
}

/**
 * Group boxes into rows, top row first: a box joins a row when its centre lies within the
 * row's height so far. Each row is ordered left to right.
 */
export function groupRows<T extends LayoutItem>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => boxCentre(b.box).y - boxCentre(a.box).y || boxCentre(a.box).x - boxCentre(b.box).x);
  const rows: { items: T[]; minY: number; maxY: number }[] = [];
  for (const it of sorted) {
    const cy = boxCentre(it.box).y;
    const row = rows[rows.length - 1];
    if (row && cy >= row.minY && cy <= row.maxY) {
      row.items.push(it);
      row.minY = Math.min(row.minY, it.box.minY);
      row.maxY = Math.max(row.maxY, it.box.maxY);
    } else {
      rows.push({ items: [it], minY: it.box.minY, maxY: it.box.maxY });
    }
  }
  return rows.map((r) => r.items.sort((a, b) => boxCentre(a.box).x - boxCentre(b.box).x));
}

/**
 * Tidy parts into rows: within each row, centres line up on the row's mean centre and
 * boxes sit `gap` apart, the row centred on `centreX`. Rows keep their heights, except
 * that a row closer than `gap` to the one above moves down to clear it.
 * Returns each item's move.
 */
export function arrangeRows(items: LayoutItem[], gap: number, centreX = 0): Map<string, Vec2> {
  const moves = new Map<string, Vec2>();
  let floor = Infinity; // bottom of the row above, less the gap
  for (const row of groupRows(items)) {
    const width = row.reduce((s, it) => s + (it.box.maxX - it.box.minX), 0) + gap * (row.length - 1);
    let cy = row.reduce((s, it) => s + boxCentre(it.box).y, 0) / row.length;
    const top = Math.max(...row.map((it) => cy + (it.box.maxY - it.box.minY) / 2));
    if (top > floor) cy -= top - floor;
    let x = centreX - width / 2;
    let bottom = Infinity;
    for (const it of row) {
      const w = it.box.maxX - it.box.minX;
      const h = it.box.maxY - it.box.minY;
      moves.set(it.id, { x: x - it.box.minX, y: cy - boxCentre(it.box).y });
      bottom = Math.min(bottom, cy - h / 2);
      x += w + gap;
    }
    floor = bottom - gap;
  }
  return moves;
}

/**
 * Space boxes along `axis` so the gaps between them are equal, keeping the outermost two
 * where they are. Returns each item's shift along the axis.
 */
export function equalGaps(items: LayoutItem[], axis: 'x' | 'y'): Map<string, number> {
  const lo = (b: Box) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Box) => (axis === 'x' ? b.maxX : b.maxY);
  const sorted = [...items].sort((a, b) => lo(a.box) + hi(a.box) - (lo(b.box) + hi(b.box)));
  const first = sorted[0]!.box;
  const last = sorted[sorted.length - 1]!.box;
  const sizes = sorted.reduce((s, it) => s + hi(it.box) - lo(it.box), 0);
  const gap = (hi(last) - lo(first) - sizes) / (sorted.length - 1);
  const shifts = new Map<string, number>();
  let at = lo(first);
  for (const it of sorted) {
    shifts.set(it.id, at - lo(it.box));
    at += hi(it.box) - lo(it.box) + gap;
  }
  return shifts;
}
