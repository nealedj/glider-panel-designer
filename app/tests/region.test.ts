import { describe, expect, it } from 'vitest';
import { distanceToLine, insideMargin, separation, shapesOverlap, toPolygon, FLATTEN_TOL } from '../src/geom/region';
import type { Shape } from '../src/model/schema';

const circle = (cx: number, cy: number, d: number): Shape => ({ kind: 'circle', cx, cy, d });
const rect = (cx: number, cy: number, w: number, h: number, r = 0): Shape => ({ kind: 'rect', cx, cy, w, h, r });
const square300: Shape = {
  kind: 'poly',
  closed: true,
  points: [
    { x: -150, y: -100 },
    { x: 150, y: -100 },
    { x: 150, y: 100 },
    { x: -150, y: 100 },
  ],
};

describe('separation', () => {
  it('is exact for circles', () => {
    expect(separation(circle(0, 0, 80), circle(100, 0, 57))).toBeCloseTo(100 - 40 - 28.5, 9);
    expect(separation(circle(0, 0, 80), circle(60, 0, 57))).toBeCloseTo(-8.5, 9);
  });

  it('measures circle to rect within the flattening tolerance', () => {
    expect(separation(circle(0, 0, 20), rect(30, 0, 20, 20))).toBeCloseTo(10, 2);
    // Corner case: gap along the diagonal to a sharp corner.
    const d = Math.hypot(20, 20) - 10;
    expect(Math.abs(separation(circle(0, 0, 20), rect(30, 30, 20, 20)) - d)).toBeLessThan(FLATTEN_TOL);
  });

  it('measures rounded rects, whose corners are arcs', () => {
    // Two 20 mm squares with 10 mm radius are circles of 20 mm diameter.
    const a = rect(0, 0, 20, 20, 10);
    const b = rect(30, 30, 20, 20, 10);
    expect(Math.abs(separation(a, b) - (Math.hypot(30, 30) - 20))).toBeLessThan(2 * FLATTEN_TOL);
  });

  it('is negative when polygons overlap, including a cross with no vertex inside', () => {
    expect(separation(rect(0, 0, 20, 20), rect(15, 0, 20, 20))).toBeLessThan(0);
    expect(separation(rect(0, 0, 100, 10), rect(0, 0, 10, 100))).toBeLessThan(0);
  });

  it('treats touching as not overlapping', () => {
    expect(shapesOverlap(rect(0, 0, 20, 20), rect(20, 0, 20, 20))).toBe(false);
    expect(shapesOverlap(circle(0, 0, 57), circle(57, 0, 57))).toBe(false);
    expect(shapesOverlap(circle(0, 0, 57), circle(56.9, 0, 57))).toBe(true);
  });

  it('keeps flattened arcs within tolerance', () => {
    const p = toPolygon(circle(0, 0, 80)).pts;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      const mid = Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
      expect(40 - mid).toBeLessThanOrEqual(FLATTEN_TOL + 1e-12);
    }
  });
});

describe('insideMargin', () => {
  it('gives the gap to the outline for shapes inside it', () => {
    expect(insideMargin(circle(-100, 0, 80), square300)).toBeCloseTo(10, 6);
    expect(insideMargin(rect(0, 80, 40, 20), square300)).toBeCloseTo(10, 6);
  });
  it('is negative for shapes crossing the outline', () => {
    expect(insideMargin(circle(-130, 0, 80), square300)).toBeCloseTo(-20, 6);
    expect(insideMargin(rect(150, 0, 40, 20), square300)).toBeLessThan(0);
  });
});

describe('distanceToLine', () => {
  it('measures from a shape to a bend line', () => {
    expect(distanceToLine(circle(0, 50, 20), { x: -150, y: 80 }, { x: 150, y: 80 })).toBeCloseTo(20, 9);
    expect(distanceToLine(rect(0, 50, 20, 20), { x: -150, y: 80 }, { x: 150, y: 80 })).toBeCloseTo(20, 9);
    expect(distanceToLine(rect(0, 75, 20, 20), { x: -150, y: 80 }, { x: 150, y: 80 })).toBe(0);
  });
});
