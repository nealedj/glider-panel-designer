import { describe, expect, it } from 'vitest';
import { flattenPoly, pointInPolygon } from '../src/geom/shapes';
import { snapRim, suggestOutline, traceBoundary } from '../src/template/trace';
import type { Raster } from '../src/template/raster';

/** Paint a raster: `inside(x, y)` gives panel colour, else background, plus mild noise. */
function paint(w: number, h: number, inside: (x: number, y: number) => boolean, fg: number[], bg: number[]): Raster {
  const data = new Uint8Array(w * h * 4);
  let s = 9;
  const noise = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 10;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 3 × 3 supersampling for clean edges.
      let k = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (inside(x + (a + 0.5) / 3, y + (b + 0.5) / 3)) k++;
      const c = fg.map((v, i) => (v * k + bg[i]! * (9 - k)) / 9 + noise());
      data.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

describe('outline suggestion', () => {
  it('traces a simple square exactly', () => {
    const m = new Uint8Array(10 * 10);
    for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) m[y * 10 + x] = 1;
    const b = traceBoundary(m, 10, 10);
    // Every pixel-corner step around a 5 × 4 block, clockwise on screen from its top-left.
    expect(b).toHaveLength(18);
    expect(b[0]).toEqual({ x: 3, y: 2 });
    expect(b[5]).toEqual({ x: 8, y: 2 });
    expect(b[9]).toEqual({ x: 8, y: 6 });
    expect(b[14]).toEqual({ x: 3, y: 6 });
  });

  it('finds a panel with rounded corners, as lines and arcs', () => {
    // A 200 × 120 px panel with 25 px corner radii, centred at (150, 100), with a pencil mark inside.
    const inside = (x: number, y: number) => {
      const dx = Math.max(Math.abs(x - 150) - 75, 0);
      const dy = Math.max(Math.abs(y - 100) - 35, 0);
      const pencil = Math.abs(y - 90) < 0.7 && x > 110 && x < 190;
      return Math.hypot(dx, dy) <= 25 && !pencil;
    };
    const r = paint(300, 200, inside, [190, 160, 120], [40, 150, 120]);
    const poly = suggestOutline(r, { x: 150, y: 120 });
    const pts = flattenPoly(poly, 0.5);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(50, 0);
    expect(Math.max(...xs)).toBeCloseTo(250, 0);
    expect(Math.min(...ys)).toBeCloseTo(40, 0);
    expect(Math.max(...ys)).toBeCloseTo(160, 0);
    // Four corners came out as arcs; the whole thing is a handful of vertices.
    expect(poly.filter((p) => p.bulge).length).toBe(4);
    expect(poly.length).toBeLessThan(14);
    // Corner arcs are near the true radius: the outline passes 25(1 − 1/√2) px inside the box corner.
    expect(pointInPolygon({ x: 50 + 25 * (1 - Math.SQRT1_2) + 1.5, y: 40 + 25 * (1 - Math.SQRT1_2) + 1.5 }, pts)).toBe(true);
    expect(pointInPolygon({ x: 50 + 25 * (1 - Math.SQRT1_2) - 1.5, y: 40 + 25 * (1 - Math.SQRT1_2) - 1.5 }, pts)).toBe(false);
  });
});

describe('rim snapping', () => {
  it('finds an instrument rim in perspective from two rough clicks', () => {
    // A black rim (ellipse 60 × 44 px, turned 20°) on a grey panel, with a screw on the edge.
    const t = (20 * Math.PI) / 180;
    const inside = (x: number, y: number) => {
      const u = (x - 160) * Math.cos(t) + (y - 120) * Math.sin(t);
      const v = -(x - 160) * Math.sin(t) + (y - 120) * Math.cos(t);
      return (u / 60) ** 2 + (v / 44) ** 2 <= 1 || Math.hypot(x - 225, y - 160) < 5;
    };
    const r = paint(320, 240, inside, [25, 25, 25], [120, 122, 125]);
    const snap = snapRim(r, { x: 157, y: 123 }, { x: 205, y: 140 })!;
    expect(snap.ellipse.cx).toBeCloseTo(160, 0);
    expect(snap.ellipse.cy).toBeCloseTo(120, 0);
    expect(snap.ellipse.a).toBeCloseTo(60, 0);
    expect(snap.ellipse.b).toBeCloseTo(44, 0);
  });
});
