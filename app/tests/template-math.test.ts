import { describe, expect, it } from 'vitest';
import { fitCircle, fitEllipse, planeFromCircles, type KnownCircle } from '../src/template/fit';
import { applyH, fitHomography, robustHomography } from '../src/template/homography';
import { inv3, type Mat3 } from '../src/template/linalg';
import type { Vec2 } from '../src/model/schema';

/** Deterministic pseudo-random numbers, so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

// A plausible phone photo of a 400 mm panel: plane mm → image px, with strong perspective.
const PLANE_TO_IMAGE: Mat3 = [2.6, 0.35, 600, -0.1, 2.1, 520, 0.0002, 0.0009, 1];
const IMAGE_TO_PLANE = inv3(PLANE_TO_IMAGE)!;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

describe('homography', () => {
  it('recovers an exact perspective map from four points', () => {
    const plane = [
      { x: -200, y: -150 },
      { x: 200, y: -150 },
      { x: 200, y: 150 },
      { x: -200, y: 150 },
    ];
    const H = fitHomography(plane.map((p) => ({ src: applyH(PLANE_TO_IMAGE, p), dst: p })))!;
    for (const p of [{ x: 0, y: 0 }, { x: 123, y: -77 }, { x: -190, y: 140 }]) expect(dist(applyH(H, applyH(PLANE_TO_IMAGE, p)), p)).toBeLessThan(1e-6);
  });

  it('averages out click noise and rejects a bad point', () => {
    const r = rng(7);
    const pairs = [];
    for (let i = -8; i <= 8; i++) {
      for (let j = -6; j <= 6; j++) {
        const p = { x: i * 25.4, y: j * 25.4 };
        const img = applyH(PLANE_TO_IMAGE, p);
        pairs.push({ src: { x: img.x + 0.5 * gauss(r), y: img.y + 0.5 * gauss(r) }, dst: p });
      }
    }
    pairs[10] = { ...pairs[10]!, src: { x: pairs[10]!.src.x + 40, y: pairs[10]!.src.y } };
    const fit = robustHomography(pairs)!;
    expect(fit.inliers.length).toBe(pairs.length - 1);
    // Half a pixel of noise is about 0.2 mm here; the fit over 220 points is far better.
    for (const p of [{ x: 0, y: 0 }, { x: 180, y: -140 }, { x: -200, y: 150 }]) expect(dist(applyH(fit.H, applyH(PLANE_TO_IMAGE, p)), p)).toBeLessThan(0.1);
    // Per-point residuals are the click noise itself: 0.5 px is up to 0.4 mm on the far side.
    expect(fit.rms).toBeLessThan(0.5);
  });
});

describe('circle and ellipse fits', () => {
  it('fits a circle from a partial arc with noise', () => {
    const r = rng(3);
    const pts = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 0.9;
      return { x: 40 + 28.5 * Math.cos(a) + 0.02 * gauss(r), y: -10 + 28.5 * Math.sin(a) + 0.02 * gauss(r) };
    });
    const c = fitCircle(pts)!;
    expect(c.cx).toBeCloseTo(40, 1);
    expect(c.cy).toBeCloseTo(-10, 1);
    expect(2 * c.r).toBeCloseTo(57, 1);
  });

  it('fits a rotated ellipse', () => {
    const t = 0.6;
    const pts = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * 2 * Math.PI;
      const [u, v] = [50 * Math.cos(a), 20 * Math.sin(a)];
      return { x: 300 + u * Math.cos(t) - v * Math.sin(t), y: 200 + u * Math.sin(t) + v * Math.cos(t) };
    });
    const e = fitEllipse(pts)!;
    expect(e.cx).toBeCloseTo(300, 6);
    expect(e.cy).toBeCloseTo(200, 6);
    expect(e.a).toBeCloseTo(50, 6);
    expect(e.b).toBeCloseTo(20, 6);
  });
});

describe('plane from round instruments', () => {
  // Instruments on a panel, as on the reference panel: 80, 57, 80, 80 in a row, then 57s below.
  const instruments = [
    { c: { x: -150, y: 40 }, d: 80 },
    { c: { x: -60, y: 50 }, d: 57 },
    { c: { x: 40, y: 45 }, d: 80 },
    { c: { x: 140, y: 30 }, d: 80 },
    { c: { x: -40, y: -50 }, d: 57 },
    { c: { x: 50, y: -50 }, d: 57 },
  ];
  const clicks = (noisePx: number, seed: number): KnownCircle[] => {
    const r = rng(seed);
    return instruments.map(({ c, d }) => ({
      diameter: d,
      points: Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * 2 * Math.PI + 0.2;
        const img = applyH(PLANE_TO_IMAGE, { x: c.x + (d / 2) * Math.cos(a), y: c.y + (d / 2) * Math.sin(a) });
        return { x: img.x + noisePx * gauss(r), y: img.y + noisePx * gauss(r) };
      }),
    }));
  };

  it('recovers distances between instruments in an angled photo', () => {
    const fit = planeFromCircles(clicks(0.8, 11))!;
    expect(fit.model).toBe('projective');
    const centre = (i: number) => applyH(fit.H, applyH(PLANE_TO_IMAGE, instruments[i]!.c));
    // Spans across the panel, true values from the layout above.
    for (const [i, j] of [
      [0, 3],
      [1, 5],
      [0, 4],
    ] as const) {
      const truth = dist(instruments[i]!.c, instruments[j]!.c);
      expect(Math.abs(dist(centre(i), centre(j)) - truth)).toBeLessThan(1.0);
    }
    for (const e of fit.diameterErrors) expect(Math.abs(e)).toBeLessThan(0.8);
    expect(fit.rms).toBeLessThan(0.6);
  });

  it('falls back to an affine map with two instruments, and says so', () => {
    const fit = planeFromCircles(clicks(0.3, 5).slice(0, 2))!;
    expect(fit.model).toBe('affine');
    for (const e of fit.diameterErrors) expect(Math.abs(e)).toBeLessThan(3);
  });
});

void IMAGE_TO_PLANE;
