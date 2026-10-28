/**
 * Cutting-mat grid detection: find the mat's grid line crossings in a photo and fit the
 * homography that rectifies and scales it. See ADR 0010.
 *
 * The grid is grown outwards from a seed cell. At each step the current fit predicts where
 * the next crossings are; each is refined by locating both grid lines near the prediction,
 * and accepted only if all four arms of the crossing are clearly visible, so crossings
 * under the template or at its edge are skipped. The fit is redone after every ring.
 */
import type { Vec2 } from '../model/schema';
import { applyH, robustHomography, type PointPair } from './homography';
import { fitWithDistortion, type DistortedFit } from './mapping';
import { inv3, type Mat3 } from './linalg';
import { matFraction, ridges, sample, type Channel, type Raster } from './raster';

/** Grid steps shorter than this many pixels are ruler ticks or texture, not the grid. */
const MIN_STEP_PX = 14;

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Vec2) => Math.hypot(a.x, a.y);

interface LineFind {
  /** Offset of the line from the prediction along the normal, px. */
  offset: number;
  /** Mean ridge strength on each half of the arm, at the best offset. */
  halves: [number, number];
  /** Background level: median over the searched offsets. */
  background: number;
}

/**
 * Locate a grid line running along `dir` through (near) `p`: search perpendicular offsets
 * within ±radius for the strongest mean ridge, skipping the crossing itself.
 */
function findLine(rg: Channel, p: Vec2, dir: Vec2, radius: number): LineFind {
  const L = len(dir);
  const u = { x: dir.x / L, y: dir.y / L };
  const n = { x: -u.y, y: u.x };
  const arm = 0.42 * L;
  const gap = Math.min(0.12 * L, 6);
  const nt = Math.max(6, Math.round((arm - gap) / 1.5));
  const step = 0.25;
  const scores: number[] = [];
  const halvesAt: [number, number][] = [];
  for (let o = -radius; o <= radius + 1e-9; o += step) {
    const c = add(p, n, o);
    let a = 0;
    let b = 0;
    for (let k = 0; k < nt; k++) {
      const t = gap + ((arm - gap) * (k + 0.5)) / nt;
      a += sample(rg, add(c, u, t));
      b += sample(rg, add(c, u, -t));
    }
    a /= nt;
    b /= nt;
    scores.push(a + b);
    halvesAt.push([a, b]);
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
  // Parabolic sub-sample peak.
  let frac = 0;
  if (best > 0 && best < scores.length - 1) {
    const [l, c, r] = [scores[best - 1]!, scores[best]!, scores[best + 1]!];
    const den = l - 2 * c + r;
    if (den < 0) frac = (0.5 * (l - r)) / den;
  }
  const sorted = [...scores].sort((x, y) => x - y);
  return { offset: -radius + (best + frac) * step, halves: halvesAt[best]!, background: sorted[Math.floor(sorted.length / 2)]! / 2 };
}

export interface Crossing {
  /** Image position, px. */
  p: Vec2;
  /** Contrast of the weakest of the four arms over the background. */
  strength: number;
}

/**
 * Refine a predicted crossing, given the image vectors of one grid step along each axis.
 * Returns null unless both lines are found with all four arms visible.
 */
export function refineCrossing(rg: Channel, p: Vec2, du: Vec2, dv: Vec2, minContrast = 6): Crossing | null {
  const radius = 0.22 * Math.min(len(du), len(dv));
  if (radius < 1.5) return null;
  // The line along du is offset along its normal; likewise the line along dv.
  let q = p;
  for (let pass = 0; pass < 2; pass++) {
    const a = findLine(rg, q, du, radius);
    const b = findLine(rg, q, dv, radius);
    const weakest = Math.min(...a.halves.map((h) => h - a.background), ...b.halves.map((h) => h - b.background));
    const nu = { x: -du.y / len(du), y: du.x / len(du) };
    const nv = { x: -dv.y / len(dv), y: dv.x / len(dv) };
    // Intersect the two shifted lines: q + s·du + a.offset·nu = q + t·dv + b.offset·nv.
    const pa = add(q, nu, a.offset);
    const pb = add(q, nv, b.offset);
    const det = du.x * -dv.y - du.y * -dv.x;
    if (Math.abs(det) < 1e-9) return null;
    const d = sub(pb, pa);
    const s = (d.x * -dv.y - d.y * -dv.x) / det;
    const next = add(pa, du, s);
    if (len(sub(next, p)) > radius * 1.2) return null;
    q = next;
    if (pass === 1) return weakest >= minContrast ? { p: q, strength: weakest } : null;
  }
  return null;
}

export interface GridSeed {
  /** Four or more image points with their grid indices (i right, j down on the mat). */
  points: { img: Vec2; i: number; j: number }[];
}

export interface GridFit extends DistortedFit {
  /** With k1, maps image px → plane mm (x along i, y along j, so image-oriented). */
  H: Mat3;
  crossings: { img: Vec2; i: number; j: number }[];
  spacingMm: number;
}

/**
 * Grow and fit the grid. `spacingMm` is the distance between the grid lines that the seed
 * indices count (for an imperial mat with solid inch lines, 25.4).
 */
export function fitGrid(raster: Raster, seed: GridSeed, spacingMm: number, opts: { maxRings?: number; ridge?: Channel } = {}): GridFit | null {
  const rg = opts.ridge ?? ridges(raster);
  const found = new Map<string, { img: Vec2; i: number; j: number }>();
  const key = (i: number, j: number) => `${i},${j}`;
  const toPairs = () => [...found.values()].map((c) => ({ src: { x: c.i, y: c.j }, dst: c.img }));

  // Grid → image map from the seed; refine the seed points themselves first.
  let G = robustHomography(seed.points.map((s) => ({ src: { x: s.i, y: s.j }, dst: s.img })))?.H;
  if (!G) return null;
  const tryAt = (i: number, j: number, Gm: Mat3) => {
    const p = applyH(Gm, { x: i, y: j });
    if (p.x < 2 || p.y < 2 || p.x > raster.width - 2 || p.y > raster.height - 2) return false;
    const du = sub(applyH(Gm, { x: i + 0.5, y: j }), applyH(Gm, { x: i - 0.5, y: j }));
    const dv = sub(applyH(Gm, { x: i, y: j + 0.5 }), applyH(Gm, { x: i, y: j - 0.5 }));
    const c = refineCrossing(rg, p, du, dv);
    if (!c) return false;
    found.set(key(i, j), { img: c.p, i, j });
    return true;
  };
  for (const s of seed.points) tryAt(s.i, s.j, G);
  if (found.size >= 4) G = robustHomography(toPairs())?.H ?? G;

  const is = seed.points.map((s) => s.i);
  const js = seed.points.map((s) => s.j);
  const [i0, i1, j0, j1] = [Math.min(...is), Math.max(...is), Math.min(...js), Math.max(...js)];
  // Grow ring by ring until a whole ring falls outside the image. Rings that find nothing
  // (under the template) are crossed on the current fit's prediction.
  const maxRings = opts.maxRings ?? 80;
  for (let ring = 1; ring <= maxRings; ring++) {
    let added = 0;
    let inside = 0;
    for (let i = i0 - ring; i <= i1 + ring; i++) {
      for (let j = j0 - ring; j <= j1 + ring; j++) {
        const onRing = i === i0 - ring || i === i1 + ring || j === j0 - ring || j === j1 + ring;
        if (!onRing || found.has(key(i, j))) continue;
        const p = applyH(G!, { x: i, y: j });
        if (p.x < 0 || p.y < 0 || p.x > raster.width || p.y > raster.height) continue;
        inside++;
        if (tryAt(i, j, G!)) added++;
      }
    }
    if (!inside) break;
    if (added && found.size >= 4) G = robustHomography(toPairs())?.H ?? G;
  }
  if (found.size < 6) return null;

  // Final fit in the direction the pipeline uses: image px → plane mm.
  const pairs: PointPair[] = [...found.values()].map((c) => ({ src: c.img, dst: { x: c.i * spacingMm, y: c.j * spacingMm } }));
  const fit = fitWithDistortion(pairs, raster.width, raster.height);
  if (!fit) return null;
  const inlierKeys = new Set(fit.inliers.map((p) => key(Math.round(p.dst.x / spacingMm), Math.round(p.dst.y / spacingMm))));
  return { ...fit, crossings: [...found.values()].filter((c) => inlierKeys.has(key(c.i, c.j))), spacingMm };
}

/**
 * Find a seed cell without help: the strongest pair of line directions in the ridge map,
 * then the first crossing whose neighbours one cell away along both directions are also
 * crossings. Indices are oriented with i to the image right and j down.
 */
export function autoSeed(raster: Raster, rg: Channel = ridges(raster)): GridSeed | null {
  const { width: w, height: h } = rg;
  const mat = matFraction(raster);
  // Strong ridge pixels on the mat.
  let thr = 0;
  {
    const vals: number[] = [];
    for (let i = 0; i < rg.v.length; i += 37) if (mat.v[i]! > 0.3) vals.push(rg.v[i]!);
    if (vals.length < 100) return null;
    vals.sort((a, b) => a - b);
    thr = Math.max(12, vals[Math.floor(vals.length * 0.97)]!);
  }
  const strong: Vec2[] = [];
  const matPts: Vec2[] = [];
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const v = rg.v[y * w + x]!;
      if (mat.v[y * w + x]! > 0.8 && (x + y) % 6 === 0) matPts.push({ x: x + 0.5, y: y + 0.5 });
      if (v < thr || mat.v[y * w + x]! < 0.3) continue;
      strong.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  if (strong.length < 50 || matPts.length < 50) return null;
  // Line directions: the angle at which strong pixels, projected across it, bunch into the
  // sharpest peaks (a Hough transform scored by peakiness).
  const pts = strong.length > 4000 ? strong.filter((_, i) => i % Math.ceil(strong.length / 4000) === 0) : strong;
  const peakiness = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const hist = new Map<number, number>();
    for (const p of pts) {
      const k = Math.round(p.x * nx + p.y * ny);
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    let s2 = 0;
    for (const c of hist.values()) s2 += c * c;
    return s2;
  };
  const score = new Float64Array(360);
  for (let i = 0; i < 360; i++) score[i] = peakiness(i / 2);
  let b1 = 0;
  for (let i = 1; i < 360; i++) if (score[i]! > score[b1]!) b1 = i;
  let b2 = -1;
  for (let i = 0; i < 360; i++) {
    const d = Math.abs(((i - b1 + 360) % 360) - 180);
    if (d > 70) continue; // the other family is roughly perpendicular (within ±35°)
    if (b2 < 0 || score[i]! > score[b2]!) b2 = i;
  }
  if (b2 < 0) return null;
  const a1 = b1 / 2;
  const a2 = b2 / 2;
  const dirOf = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
  let du = dirOf(a1);
  let dv = dirOf(a2);
  // i to the right, j down.
  if (Math.abs(du.y) > Math.abs(du.x)) [du, dv] = [dv, du];
  if (du.x < 0) du = { x: -du.x, y: -du.y };
  if (dv.y < 0) dv = { x: -dv.x, y: -dv.y };

  // Spacing: autocorrelation of ridge samples along each direction from many start points.
  const spacing = (dir: Vec2): number | null => {
    const maxLag = Math.round(Math.min(w, h) / 6);
    const acc = new Float64Array(maxLag + 1);
    const nrm = { x: -dir.y, y: dir.x };
    for (let s = 0; s < 400; s++) {
      // Start anywhere on the mat (not on a line, or the walk would follow it).
      const start = matPts[(s * 7919) % matPts.length]!;
      // Walk across the lines (along the normal of the *other* family is along dir itself).
      const prof: number[] = [];
      for (let t = 0; t < 2 * maxLag; t++) prof.push(sample(rg, add(start, dir, t)));
      const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
      const variance = prof.reduce((a, b) => a + (b - mean) ** 2, 0) || 1;
      // Normalised, so the few walks that happen to run along a line do not dominate.
      for (let lag = 4; lag <= maxLag; lag++) {
        let c = 0;
        for (let t = 0; t + lag < prof.length; t++) c += (prof[t]! - mean) * (prof[t + lag]! - mean);
        acc[lag]! += c / variance;
      }
      void nrm;
    }
    // The strongest peak above the ruler-tick scale is the main grid step. On mats with
    // dashed half-lines, the solid lines win because they are continuous.
    let best = -1;
    let bestV = -Infinity;
    for (let lag = MIN_STEP_PX; lag < maxLag; lag++) if (acc[lag]! > acc[lag - 1]! && acc[lag]! >= acc[lag + 1]! && acc[lag]! > bestV) [best, bestV] = [lag, acc[lag]!];
    return best > 0 ? best : null;
  };
  const su = spacing(du);
  const sv = spacing(dv);
  if ((globalThis as { GPD_DEBUG?: boolean }).GPD_DEBUG) console.log('dirs', a1, a2, 'steps', su, sv);
  if (!su || !sv) return null;
  const U = { x: du.x * su, y: du.y * su };
  const V = { x: dv.x * sv, y: dv.y * sv };

  // Try strong pixels, nearest the image centre first, until a full cell refines.
  const centre = { x: w / 2, y: h / 2 };
  const candidates = [...strong].sort((a, b) => len(sub(a, centre)) - len(sub(b, centre)));
  for (let k = 0; k < candidates.length; k += 3) {
    const c0 = refineCrossing(rg, candidates[k]!, U, V);
    if (!c0) continue;
    const c1 = refineCrossing(rg, add(c0.p, U), U, V);
    const c2 = refineCrossing(rg, add(c0.p, V), U, V);
    if (!c1 || !c2) continue;
    const c3 = refineCrossing(rg, add(add(c0.p, U), V), U, V);
    if (!c3) continue;
    return {
      points: [
        { img: c0.p, i: 0, j: 0 },
        { img: c1.p, i: 1, j: 0 },
        { img: c2.p, i: 0, j: 1 },
        { img: c3.p, i: 1, j: 1 },
      ],
    };
  }
  return null;
}

/** Plane mm → image px, for drawing the detected grid over the photo. */
export function planeToImage(fit: { H: Mat3 }): Mat3 | null {
  return inv3(fit.H);
}
