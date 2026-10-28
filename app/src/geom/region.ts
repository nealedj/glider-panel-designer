/**
 * Distances and overlaps between shapes, for the design rule checks.
 *
 * Circles are handled exactly. Everything else is flattened to a polygon whose chords stay
 * within FLATTEN_TOL of the true arcs, so a reported distance is within that tolerance of
 * the exact one. See ADR 0005.
 */
import type { PolyVertex, Shape, Vec2 } from '../model/schema';
import { arcCentre, distanceToSegment, pointInPolygon, rectToPoly, shapeBox, type Box } from './shapes';

/** Maximum gap between a flattened chord and its arc, mm. */
export const FLATTEN_TOL = 0.01;

export interface Polygon {
  pts: Vec2[];
  box: Box;
}

const polyCache = new WeakMap<Shape, Polygon>();

/** Segments for an arc of radius r so the chord error stays under `tol`. */
function arcSegments(r: number, sweep: number, tol: number): number {
  if (r <= tol) return 4;
  const step = 2 * Math.acos(1 - tol / r);
  return Math.max(4, Math.ceil(Math.abs(sweep) / step));
}

function flattenTol(points: PolyVertex[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    out.push({ x: a.x, y: a.y });
    if (!a.bulge) continue;
    const theta = 4 * Math.atan(a.bulge);
    const { cx, cy, r } = arcCentre(a, b, a.bulge);
    const start = Math.atan2(a.y - cy, a.x - cx);
    const n = arcSegments(r, theta, tol);
    for (let k = 1; k < n; k++) {
      const ang = start + (theta * k) / n;
      out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
  }
  return out;
}

/** The shape as a closed polygon (cached per shape object). */
export function toPolygon(shape: Shape): Polygon {
  let p = polyCache.get(shape);
  if (p) return p;
  let pts: Vec2[];
  switch (shape.kind) {
    case 'circle': {
      const r = shape.d / 2;
      const n = arcSegments(r, 2 * Math.PI, FLATTEN_TOL);
      pts = [];
      for (let k = 0; k < n; k++) pts.push({ x: shape.cx + r * Math.cos((2 * Math.PI * k) / n), y: shape.cy + r * Math.sin((2 * Math.PI * k) / n) });
      break;
    }
    case 'rect':
      pts = flattenTol(rectToPoly(shape).points, FLATTEN_TOL);
      break;
    case 'poly':
      pts = flattenTol(shape.points, FLATTEN_TOL);
      break;
  }
  p = { pts, box: shapeBox(shape) };
  polyCache.set(shape, p);
  return p;
}

// ---------------------------------------------------------------- segment helpers

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** True if segments ab and cd cross at a point interior to both (touching ends do not count). */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

function expand(b: Box, m: number): Box {
  return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

function boxOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Distance between two box outlines' interiors; 0 if they overlap. */
function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/** Minimum distance between two polygon boundaries, skipping edge pairs whose boxes are further apart than `limit`. */
function boundaryDistance(p: Vec2[], q: Vec2[], limit = Infinity): number {
  let best = limit;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const ex: Box = { minX: Math.min(a.x, b.x) - best, maxX: Math.max(a.x, b.x) + best, minY: Math.min(a.y, b.y) - best, maxY: Math.max(a.y, b.y) + best };
    for (let j = 0; j < q.length; j++) {
      const c = q[j]!;
      const d = q[(j + 1) % q.length]!;
      if (Math.max(c.x, d.x) < ex.minX || Math.min(c.x, d.x) > ex.maxX || Math.max(c.y, d.y) < ex.minY || Math.min(c.y, d.y) > ex.maxY) continue;
      const dist = segmentDistance(a, b, c, d);
      if (dist < best) {
        best = dist;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

/** Distance from a point to a polygon boundary, negative when the point is inside. */
export function signedDistanceToPolygon(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return pointInPolygon(p, poly) ? -best : best;
}

// ---------------------------------------------------------------- separation

/**
 * Signed separation between two filled shapes: the gap between them when apart, and a
 * negative value when they overlap (its size is the penetration, approximate for
 * polygons). Touching shapes give 0.
 *
 * `limit` lets callers skip exact work when the shapes are clearly further apart than
 * they care about; the result is then some value ≥ limit.
 */
export function separation(a: Shape, b: Shape, limit = Infinity): number {
  if (a.kind === 'circle' && b.kind === 'circle') {
    return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.d / 2 - b.d / 2;
  }
  const pa = toPolygon(a);
  const pb = toPolygon(b);
  const gap = boxGap(pa.box, pb.box);
  if (gap >= limit) return gap;
  if (a.kind === 'circle' || b.kind === 'circle') {
    const [c, other] = a.kind === 'circle' ? [a, pb] : [b as Extract<Shape, { kind: 'circle' }>, pa];
    return signedDistanceToPolygon({ x: c.cx, y: c.cy }, other.pts) - c.d / 2;
  }
  return polygonSeparation(pa.pts, pb.pts, limit);
}

function polygonSeparation(p: Vec2[], q: Vec2[], limit: number): number {
  // Penetration: the deepest vertex or edge midpoint of either polygon inside the other.
  // Midpoints catch overlaps where every vertex lies on the other's boundary, as with two
  // squares overlapping along a shared edge line.
  let depth = 0;
  for (const v of samples(p)) {
    const s = signedDistanceToPolygon(v, q);
    if (s < depth) depth = s;
  }
  for (const v of samples(q)) {
    const s = signedDistanceToPolygon(v, p);
    if (s < depth) depth = s;
  }
  if (depth < 0) return depth;
  const d = boundaryDistance(p, q, limit);
  // Edges cross with no vertex inside (e.g. a plus sign through a bar): a real overlap.
  if (d === 0 && crosses(p, q)) return -FLATTEN_TOL;
  return d;
}

function samples(p: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    out.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

function crosses(p: Vec2[], q: Vec2[]): boolean {
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      if (segmentsCross(p[i]!, p[(i + 1) % p.length]!, q[j]!, q[(j + 1) % q.length]!)) return true;
    }
  }
  return false;
}

/** True if the shapes' interiors overlap by more than `tol`. */
export function shapesOverlap(a: Shape, b: Shape, tol = FLATTEN_TOL): boolean {
  if (!boxOverlap(expand(toPolygon(a).box, tol), toPolygon(b).box)) return false;
  return separation(a, b, tol) < -tol;
}

// ---------------------------------------------------------------- containment

/**
 * How far `inner` sits inside `outer`: the smallest gap between inner's boundary and
 * outer's, or a negative value when any part of inner lies outside outer.
 */
export function insideMargin(inner: Shape, outer: Shape): number {
  const po = toPolygon(outer);
  if (inner.kind === 'circle') {
    const c = { x: inner.cx, y: inner.cy };
    if (outer.kind === 'circle') return outer.d / 2 - Math.hypot(c.x - outer.cx, c.y - outer.cy) - inner.d / 2;
    return -signedDistanceToPolygon(c, po.pts) - inner.d / 2;
  }
  const pi = toPolygon(inner);
  let outside = 0;
  for (const v of samples(pi.pts)) {
    const s = signedDistanceToPolygon(v, po.pts);
    if (s > outside) outside = s;
  }
  if (outside > 0) return -outside;
  if (crosses(pi.pts, po.pts)) return -FLATTEN_TOL;
  return boundaryDistance(pi.pts, po.pts);
}

/** Distance from a shape to a line segment (0 if the segment touches or crosses it). */
export function distanceToLine(shape: Shape, a: Vec2, b: Vec2): number {
  if (shape.kind === 'circle') return Math.max(0, distanceToSegment({ x: shape.cx, y: shape.cy }, a, b) - shape.d / 2);
  const p = toPolygon(shape).pts;
  if (pointInPolygon(a, p) || pointInPolygon(b, p)) return 0;
  return segToPolyline(a, b, p);
}

function segToPolyline(a: Vec2, b: Vec2, p: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) best = Math.min(best, segmentDistance(a, b, p[i]!, p[(i + 1) % p.length]!));
  return best;
}
