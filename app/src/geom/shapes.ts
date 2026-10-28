/**
 * Shape maths: transforms, bounds, hit tests and SVG paths for the three shape kinds.
 *
 * These are simple closed-form tests on single shapes. Distances and overlaps between
 * shapes, for the checks, are in `region.ts`; see ADR 0005.
 */
import type { Hole, PolyShape, PolyVertex, Shape, Vec2 } from '../model/schema';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Transform {
  x: number;
  y: number;
  /** Degrees, counter-clockwise. */
  rotation: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, rotation: 0 };

const DEG = Math.PI / 180;

export function applyTransform(t: Transform, p: Vec2): Vec2 {
  const c = Math.cos(t.rotation * DEG);
  const s = Math.sin(t.rotation * DEG);
  return { x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c };
}

export function invertTransform(t: Transform, p: Vec2): Vec2 {
  const c = Math.cos(-t.rotation * DEG);
  const s = Math.sin(-t.rotation * DEG);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Normalise an angle to [0, 360). */
export function normAngle(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

function isRightAngle(rotation: number): boolean {
  return Math.abs(normAngle(rotation) % 90) < 1e-9;
}

/**
 * Transform a shape into world coordinates. Circles stay circles; rects stay rects when
 * rotated by a multiple of 90°, otherwise become polygons.
 */
export function transformShape(shape: Shape, t: Transform): Shape {
  switch (shape.kind) {
    case 'circle': {
      const c = applyTransform(t, { x: shape.cx, y: shape.cy });
      return { kind: 'circle', cx: c.x, cy: c.y, d: shape.d };
    }
    case 'rect': {
      const c = applyTransform(t, { x: shape.cx, y: shape.cy });
      if (isRightAngle(t.rotation)) {
        const swap = Math.round(normAngle(t.rotation) / 90) % 2 === 1;
        return { kind: 'rect', cx: c.x, cy: c.y, w: swap ? shape.h : shape.w, h: swap ? shape.w : shape.h, r: shape.r };
      }
      return transformShape(rectToPoly(shape), t);
    }
    case 'poly':
      return { kind: 'poly', closed: true, points: shape.points.map((p) => ({ ...applyTransform(t, p), ...(p.bulge ? { bulge: p.bulge } : {}) })) };
  }
}

export function mirrorShapeX(shape: Shape): Shape {
  switch (shape.kind) {
    case 'circle':
      return { ...shape, cx: -shape.cx };
    case 'rect':
      return { ...shape, cx: -shape.cx };
    case 'poly':
      // Mirroring reverses winding, so arc bulges change sign.
      return { kind: 'poly', closed: true, points: shape.points.map((p) => ({ x: -p.x, y: p.y, ...(p.bulge ? { bulge: -p.bulge } : {}) })) };
  }
}

/** A rounded rect as a polygon with bulged corners. */
export function rectToPoly(r: Extract<Shape, { kind: 'rect' }>): PolyShape {
  const hw = r.w / 2;
  const hh = r.h / 2;
  const rad = Math.min(r.r, hw, hh);
  const { cx, cy } = r;
  if (rad <= 0) {
    return {
      kind: 'poly',
      closed: true,
      points: [
        { x: cx - hw, y: cy - hh },
        { x: cx + hw, y: cy - hh },
        { x: cx + hw, y: cy + hh },
        { x: cx - hw, y: cy + hh },
      ],
    };
  }
  const b = Math.tan(Math.PI / 8); // quarter circle, counter-clockwise
  return {
    kind: 'poly',
    closed: true,
    points: [
      { x: cx - hw + rad, y: cy - hh },
      { x: cx + hw - rad, y: cy - hh, bulge: b },
      { x: cx + hw, y: cy - hh + rad },
      { x: cx + hw, y: cy + hh - rad, bulge: b },
      { x: cx + hw - rad, y: cy + hh },
      { x: cx - hw + rad, y: cy + hh, bulge: b },
      { x: cx - hw, y: cy + hh - rad },
      { x: cx - hw, y: cy - hh + rad, bulge: b },
    ],
  };
}

/** Polygon vertices with bulged arcs flattened to chords no longer than `maxSeg` mm. */
export function flattenPoly(points: PolyVertex[], maxSeg = 1): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    out.push({ x: a.x, y: a.y });
    if (a.bulge) out.push(...arcPoints(a, b, a.bulge, maxSeg));
  }
  return out;
}

/** Interior points of the arc from a to b with the given bulge. */
function arcPoints(a: Vec2, b: Vec2, bulge: number, maxSeg: number): Vec2[] {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < 1e-12) return [];
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const { cx, cy } = arcCentre(a, b, bulge);
  const start = Math.atan2(a.y - cy, a.x - cx);
  const n = Math.max(2, Math.ceil((Math.abs(theta) * radius) / maxSeg));
  const pts: Vec2[] = [];
  for (let k = 1; k < n; k++) {
    const ang = start + (theta * k) / n;
    pts.push({ x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) });
  }
  return pts;
}

export function arcCentre(a: Vec2, b: Vec2, bulge: number): { cx: number; cy: number; r: number } {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Distance from chord midpoint to centre; sign puts the centre left of a→b for positive bulge.
  const h = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;
  return { cx: mx + nx * h, cy: my + ny * h, r };
}

export function shapeBox(shape: Shape): Box {
  switch (shape.kind) {
    case 'circle': {
      const r = shape.d / 2;
      return { minX: shape.cx - r, minY: shape.cy - r, maxX: shape.cx + r, maxY: shape.cy + r };
    }
    case 'rect':
      return { minX: shape.cx - shape.w / 2, minY: shape.cy - shape.h / 2, maxX: shape.cx + shape.w / 2, maxY: shape.cy + shape.h / 2 };
    case 'poly':
      return pointsBox(flattenPoly(shape.points, 2));
  }
}

export function holeBox(h: Hole): Box {
  return { minX: h.x - h.d / 2, minY: h.y - h.d / 2, maxX: h.x + h.d / 2, maxY: h.y + h.d / 2 };
}

export function pointsBox(pts: Vec2[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function boxCentre(b: Box): Vec2 {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function boxContainsBox(outer: Box, inner: Box): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function shapeContains(shape: Shape, p: Vec2, tol = 0): boolean {
  switch (shape.kind) {
    case 'circle':
      return Math.hypot(p.x - shape.cx, p.y - shape.cy) <= shape.d / 2 + tol;
    case 'rect': {
      const dx = Math.abs(p.x - shape.cx) - shape.w / 2;
      const dy = Math.abs(p.y - shape.cy) - shape.h / 2;
      const r = Math.min(shape.r, shape.w / 2, shape.h / 2);
      // Signed distance to a rounded box.
      const qx = Math.max(dx + r, 0);
      const qy = Math.max(dy + r, 0);
      const dist = Math.hypot(qx, qy) + Math.min(Math.max(dx + r, dy + r), 0) - r;
      return dist <= tol;
    }
    case 'poly':
      return pointInPolygon(p, flattenPoly(shape.points, 1)) || (tol > 0 && distanceToPolyline(p, flattenPoly(shape.points, 1), true) <= tol);
  }
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToPolyline(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, distanceToSegment(p, pts[i]!, pts[(i + 1) % pts.length]!));
  return best;
}

/** Shape outline as an SVG path in world coordinates (y up; the view flips it). */
export function shapePath(shape: Shape): string {
  switch (shape.kind) {
    case 'circle': {
      const r = shape.d / 2;
      return `M${shape.cx - r} ${shape.cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
    case 'rect': {
      if (shape.r <= 0) {
        const x = shape.cx - shape.w / 2;
        const y = shape.cy - shape.h / 2;
        return `M${x} ${y}h${shape.w}v${shape.h}h${-shape.w}Z`;
      }
      return shapePath(rectToPoly(shape));
    }
    case 'poly':
      return polyPath(shape.points);
  }
}

export function polyPath(points: PolyVertex[]): string {
  if (!points.length) return '';
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (a.bulge) {
      const { r } = arcCentre(a, b, a.bulge);
      const large = Math.abs(a.bulge) > 1 ? 1 : 0;
      const sweep = a.bulge > 0 ? 1 : 0;
      d += `A${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
    } else if (i < points.length - 1) {
      d += `L${b.x} ${b.y}`;
    }
  }
  return d + 'Z';
}

export function holePath(h: Hole): string {
  return shapePath({ kind: 'circle', cx: h.x, cy: h.y, d: h.d });
}

/** Points worth snapping to on a shape: centre, extreme points and polygon vertices. */
export function shapeSnapPoints(shape: Shape): Vec2[] {
  const b = shapeBox(shape);
  const c = boxCentre(b);
  const pts = [c, { x: b.minX, y: c.y }, { x: b.maxX, y: c.y }, { x: c.x, y: b.minY }, { x: c.x, y: b.maxY }];
  if (shape.kind === 'poly') pts.push(...shape.points.map((p) => ({ x: p.x, y: p.y })));
  return pts;
}
