/**
 * Annotation geometry (text labels and dimensions), shared by the canvas and the exporters.
 *
 * A dimension end is either a fixed point or a part, which follows the part's centre, so
 * a dimension stays attached when parts move.
 */
import type { PartGeometry } from '../model/resolve';
import type { Dimension, TextLabel, Vec2 } from '../model/schema';
import type { Box } from './shapes';

/**
 * Text sizes are cap heights, mm, as engraving is specified. Helvetica's cap height is
 * 0.718 em, so the font size is the cap height divided by this.
 */
export const CAP_HEIGHT = 0.718;

/** Approximate Helvetica advance, mm, for a cap height: good enough for extents and hit tests. */
export function textWidth(text: string, size: number): number {
  return text.length * (size / CAP_HEIGHT) * 0.53;
}

/** Corners of a text label's box (centred on its anchor, baseline at y), turned by its rotation. */
export function textCorners(t: Pick<TextLabel, 'x' | 'y' | 'text' | 'size' | 'rotation'>): Vec2[] {
  const w = Math.max(textWidth(t.text, t.size), t.size);
  const a = (t.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const local = [
    { x: -w / 2, y: -t.size * 0.3 },
    { x: w / 2, y: -t.size * 0.3 },
    { x: w / 2, y: t.size * 1.15 },
    { x: -w / 2, y: t.size * 1.15 },
  ];
  return local.map((p) => ({ x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c }));
}

export function textBox(t: Pick<TextLabel, 'x' | 'y' | 'text' | 'size' | 'rotation'>): Box {
  const pts = textCorners(t);
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
}

export interface DimensionGeometry {
  /** The measured points. */
  p1: Vec2;
  p2: Vec2;
  /** Ends of the dimension line. */
  d1: Vec2;
  d2: Vec2;
  /** Extension lines from near each measured point to just past the dimension line. */
  ext: [Vec2, Vec2][];
  /** Measured length, mm. */
  value: number;
  /** Text anchor (centre of the text baseline) and its angle in degrees, kept readable. */
  text: Vec2;
  angle: number;
  /** Unit vector along the dimension line, from d1 to d2. */
  dir: Vec2;
}

/** Gap between a measured point and its extension line, and overshoot past the dimension line, mm. */
const EXT_GAP = 1;

/** Where a dimension end sits now: a part's centre, or a fixed point. */
export function dimensionEndPoint(geometry: Map<string, PartGeometry>) {
  return (end: Dimension['a']): Vec2 | null => {
    if ('part' in end) {
      const g = geometry.get(end.part);
      return g ? { x: g.transform.x, y: g.transform.y } : null;
    }
    return end;
  };
}

const EXT_OVER = 1.5;
/** Text sits this far off the dimension line, mm. */
const TEXT_LIFT = 1.2;

export function dimensionGeometry(dim: Dimension, endPoint: (end: Dimension['a']) => Vec2 | null): DimensionGeometry | null {
  const p1 = endPoint(dim.a);
  const p2 = endPoint(dim.b);
  if (!p1 || !p2) return null;
  let d1: Vec2;
  let d2: Vec2;
  let value: number;
  if (dim.kind === 'horizontal') {
    const y = (dim.offset >= 0 ? Math.max(p1.y, p2.y) : Math.min(p1.y, p2.y)) + dim.offset;
    d1 = { x: p1.x, y };
    d2 = { x: p2.x, y };
    value = Math.abs(p2.x - p1.x);
  } else if (dim.kind === 'vertical') {
    const x = (dim.offset >= 0 ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x)) + dim.offset;
    d1 = { x, y: p1.y };
    d2 = { x, y: p2.y };
    value = Math.abs(p2.y - p1.y);
  } else {
    value = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const u = value > 1e-9 ? { x: (p2.x - p1.x) / value, y: (p2.y - p1.y) / value } : { x: 1, y: 0 };
    const n = { x: -u.y, y: u.x };
    d1 = { x: p1.x + n.x * dim.offset, y: p1.y + n.y * dim.offset };
    d2 = { x: p2.x + n.x * dim.offset, y: p2.y + n.y * dim.offset };
  }
  const ext: [Vec2, Vec2][] = [];
  for (const [p, d] of [
    [p1, d1],
    [p2, d2],
  ] as const) {
    const len = Math.hypot(d.x - p.x, d.y - p.y);
    if (len < EXT_GAP) continue;
    const ux = (d.x - p.x) / len;
    const uy = (d.y - p.y) / len;
    ext.push([
      { x: p.x + ux * EXT_GAP, y: p.y + uy * EXT_GAP },
      { x: d.x + ux * EXT_OVER, y: d.y + uy * EXT_OVER },
    ]);
  }
  const len = Math.hypot(d2.x - d1.x, d2.y - d1.y);
  const dir = len > 1e-9 ? { x: (d2.x - d1.x) / len, y: (d2.y - d1.y) / len } : { x: 1, y: 0 };
  let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (angle > 90.001) angle -= 180;
  if (angle <= -90) angle += 180;
  // Lift the text to the side of the line that stays "up" for the readable angle.
  const a = (angle * Math.PI) / 180;
  const up = { x: -Math.sin(a), y: Math.cos(a) };
  const text = { x: (d1.x + d2.x) / 2 + up.x * TEXT_LIFT, y: (d1.y + d2.y) / 2 + up.y * TEXT_LIFT };
  return { p1, p2, d1, d2, ext, value, text, angle, dir };
}

/** Arrowhead as two short strokes at `tip`, pointing along `dir`. */
export function arrowStrokes(tip: Vec2, dir: Vec2, size = 2.5): [Vec2, Vec2][] {
  const spread = Math.tan((15 * Math.PI) / 180);
  const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const n = { x: -dir.y * size * spread, y: dir.x * size * spread };
  return [
    [tip, { x: back.x + n.x, y: back.y + n.y }],
    [tip, { x: back.x - n.x, y: back.y - n.y }],
  ];
}

export function dimensionBox(dg: DimensionGeometry): Box {
  const pts = [dg.p1, dg.p2, dg.d1, dg.d2, dg.text];
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
}

/** Unit normal along which a dimension's offset grows, for dragging it. */
export function offsetDirection(dim: Dimension, dg: DimensionGeometry): Vec2 {
  if (dim.kind === 'horizontal') return { x: 0, y: 1 };
  if (dim.kind === 'vertical') return { x: 1, y: 0 };
  const len = Math.hypot(dg.p2.x - dg.p1.x, dg.p2.y - dg.p1.y);
  return len > 1e-9 ? { x: -(dg.p2.y - dg.p1.y) / len, y: (dg.p2.x - dg.p1.x) / len } : { x: 0, y: 1 };
}
