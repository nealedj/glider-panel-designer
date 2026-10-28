import { describe, expect, it } from 'vitest';
import { arcCentre, flattenPoly, rectToPoly, shapeBox, shapeContains, transformShape, mirrorShapeX } from '../src/geom/shapes';
import type { Shape } from '../src/model/schema';

describe('transformShape', () => {
  it('rotates a rect by 90° by swapping its sides', () => {
    const r: Shape = { kind: 'rect', cx: 10, cy: 0, w: 40, h: 20, r: 0 };
    const t = transformShape(r, { x: 100, y: 50, rotation: 90 });
    expect(t).toMatchObject({ kind: 'rect', w: 20, h: 40 });
    if (t.kind !== 'rect') throw new Error();
    expect(t.cx).toBeCloseTo(100);
    expect(t.cy).toBeCloseTo(60);
  });
  it('turns a rect rotated off-axis into a polygon with the same area box', () => {
    const t = transformShape({ kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, r: 0 }, { x: 0, y: 0, rotation: 45 });
    expect(t.kind).toBe('poly');
    const b = shapeBox(t);
    expect(b.maxX).toBeCloseTo(Math.SQRT2 * 5);
  });
});

describe('rounded rect polygon', () => {
  it('has arc corners with the right radius and centre', () => {
    const p = rectToPoly({ kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, r: 2 });
    const a = p.points[1]!;
    const b = p.points[2]!;
    const c = arcCentre(a, b, a.bulge!);
    expect(c.r).toBeCloseTo(2);
    expect(c.cx).toBeCloseTo(8);
    expect(c.cy).toBeCloseTo(-3);
  });
  it('flattens to points on the outline', () => {
    const p = rectToPoly({ kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, r: 2 });
    for (const q of flattenPoly(p.points, 0.5)) {
      expect(Math.abs(q.x)).toBeLessThanOrEqual(10 + 1e-9);
      expect(Math.abs(q.y)).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
});

describe('shapeContains', () => {
  it('handles rounded corners', () => {
    const r: Shape = { kind: 'rect', cx: 0, cy: 0, w: 20, h: 20, r: 5 };
    expect(shapeContains(r, { x: 9.9, y: 0 })).toBe(true);
    expect(shapeContains(r, { x: 9.5, y: 9.5 })).toBe(false); // cut away by the corner radius
    expect(shapeContains(r, { x: 8, y: 8 })).toBe(true);
  });
  it('handles circles and polygons', () => {
    expect(shapeContains({ kind: 'circle', cx: 0, cy: 0, d: 10 }, { x: 4.9, y: 0 })).toBe(true);
    expect(shapeContains({ kind: 'circle', cx: 0, cy: 0, d: 10 }, { x: 4, y: 4 })).toBe(false);
    const tri: Shape = { kind: 'poly', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] };
    expect(shapeContains(tri, { x: 2, y: 2 })).toBe(true);
    expect(shapeContains(tri, { x: 6, y: 6 })).toBe(false);
  });
});

describe('mirrorShapeX', () => {
  it('mirrors polygons and flips arc direction', () => {
    const m = mirrorShapeX({ kind: 'poly', closed: true, points: [{ x: 1, y: 0, bulge: 0.5 }, { x: 2, y: 0 }, { x: 2, y: 1 }] });
    if (m.kind !== 'poly') throw new Error();
    expect(m.points[0]).toEqual({ x: -1, y: 0, bulge: -0.5 });
  });
});
