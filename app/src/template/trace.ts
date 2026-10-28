/**
 * Tracing helpers: suggest an outline by growing a region from a click (a "magic wand"),
 * simplify it to straight lines and arcs, and snap clicked instrument rims to the edge.
 */
import type { PolyVertex, Vec2 } from '../model/schema';
import { fitCircle, fitEllipse, type EllipseFit } from './fit';
import { boxMean, luminance, sample, type Channel, type Raster } from './raster';

/**
 * Pixels connected to `seed` whose colour stays close to the colours met so far (a
 * flood fill against the running mean of the region, so gentle shading is followed but
 * an edge to the background stops it). Returns a mask, 1 inside.
 */
export function growRegion(r: Raster, seed: Vec2, tolerance = 28): Uint8Array {
  const { width: w, height: h, data } = r;
  const mask = new Uint8Array(w * h);
  const sx = Math.max(0, Math.min(w - 1, Math.floor(seed.x)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(seed.y)));
  // Seed colour from a small neighbourhood, so a speck under the click does not matter.
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let n = 0;
  for (let y = Math.max(0, sy - 3); y <= Math.min(h - 1, sy + 3); y++) {
    for (let x = Math.max(0, sx - 3); x <= Math.min(w - 1, sx + 3); x++) {
      const i = (y * w + x) * 4;
      mr += data[i]!;
      mg += data[i + 1]!;
      mb += data[i + 2]!;
      n++;
    }
  }
  mr /= n;
  mg /= n;
  mb /= n;
  const stack = [sy * w + sx];
  mask[sy * w + sx] = 1;
  let count = 1;
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w;
    const y = (k - x) / w;
    for (const nk of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
      if (nk < 0 || mask[nk]) continue;
      const i = nk * 4;
      const dr = data[i]! - mr;
      const dg = data[i + 1]! - mg;
      const db = data[i + 2]! - mb;
      if (dr * dr + dg * dg + db * db > t2) continue;
      mask[nk] = 1;
      stack.push(nk);
      // Follow slow shading: the reference drifts towards what has been accepted.
      count++;
      const a = 1 / Math.min(count, 5000);
      mr += (data[i]! - mr) * a;
      mg += (data[i + 1]! - mg) * a;
      mb += (data[i + 2]! - mb) * a;
    }
  }
  return closeMask(mask, w, h, 3);
}

/** Morphological closing (dilate then erode) with a square of radius r, to bridge pencil lines and specks. */
function closeMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const dil = morph(m, w, h, r, true);
  const out = morph(dil, w, h, r, false);
  // Fill holes: anything not reachable from the border outside the region is inside.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!out[y * w + x]) stack.push(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!out[y * w + x]) stack.push(y * w + x);
  for (const k of stack) outside[k] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w;
    const y = (k - x) / w;
    for (const nk of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
      if (nk < 0 || outside[nk] || out[nk]) continue;
      outside[nk] = 1;
      stack.push(nk);
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = outside[k] ? 0 : 1;
  return out;
}

function morph(m: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  // Separable box min/max.
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - want;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        if (m[y * w + xx] === want) {
          v = want;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - want;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        if (tmp[yy * w + x] === want) {
          v = want;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Outer boundary of the mask's top-left-most region, as pixel-corner points in order,
 * walking with the inside on the right (clockwise on screen). Corner (x, y) is the
 * top-left corner of pixel (x, y).
 */
export function traceBoundary(mask: Uint8Array, w: number, h: number): Vec2[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let start = -1;
  for (let k = 0; k < mask.length; k++)
    if (mask[k]) {
      start = k;
      break;
    }
  if (start < 0) return [];
  const sx = start % w;
  const sy = (start - sx) / w;
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  // Pixels to the right and left of the edge leaving corner (x, y) heading d (0 right, 1 down, 2 left, 3 up).
  const right = (x: number, y: number, d: number) => (d === 0 ? at(x, y) : d === 1 ? at(x - 1, y) : d === 2 ? at(x - 1, y - 1) : at(x, y - 1));
  const left = (x: number, y: number, d: number) => (d === 0 ? at(x, y - 1) : d === 1 ? at(x, y) : d === 2 ? at(x - 1, y) : at(x - 1, y - 1));
  const isEdge = (x: number, y: number, d: number) => right(x, y, d) && !left(x, y, d);
  let x = sx;
  let y = sy;
  let d = 0;
  const pts: Vec2[] = [];
  const limit = 4 * w * h + 4;
  for (let guard = 0; guard < limit; guard++) {
    pts.push({ x, y });
    x += dx[d]!;
    y += dy[d]!;
    if (x === sx && y === sy) break;
    // Turn right first, so diagonal neighbours stay separate (4-connected region).
    for (const nd of [(d + 1) % 4, d, (d + 3) % 4]) {
      if (isEdge(x, y, nd)) {
        d = nd;
        break;
      }
    }
  }
  return pts;
}

function perpDist(p: Vec2, a: Vec2, b: Vec2): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
}

/** Douglas–Peucker on a closed polygon; returns the indices kept, in order. */
export function simplifyClosed(pts: Vec2[], tol: number): number[] {
  const n = pts.length;
  if (n < 4) return pts.map((_, i) => i);
  // Split at the point farthest from the first, simplify each half.
  let i1 = 0;
  let far = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pts[i]!.x - pts[0]!.x, pts[i]!.y - pts[0]!.y);
    if (d > far) [far, i1] = [d, i];
  }
  const keep = new Set<number>([0, i1]);
  const stack: [number, number][] = [
    [0, i1],
    [i1, n],
  ];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1;
    let bi = -1;
    for (let k = s + 1; k < e; k++) {
      const d = perpDist(pts[k % n]!, pts[s % n]!, pts[e % n]!);
      if (d > best) [best, bi] = [d, k];
    }
    if (best > tol) {
      keep.add(bi % n);
      stack.push([s, bi], [bi, e]);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

/**
 * Turn a simplified boundary into lines and arcs: where the original boundary between
 * several kept vertices lies on one circle (within `tol`), those vertices become a single
 * arc (a bulge), so a traced rounded corner is a true arc.
 */
export function fitArcs(boundary: Vec2[], idx: number[], tol: number, minRun = 3): PolyVertex[] {
  const n = idx.length;
  const N = boundary.length;
  const span = (i: number, j: number): Vec2[] => {
    // Boundary points from kept vertex i to kept vertex j (indices into idx, j may wrap).
    const a = idx[i % n]!;
    let b = idx[j % n]!;
    if (j >= n || b <= a) b += N;
    const out: Vec2[] = [];
    for (let k = a; k <= b; k++) out.push(boundary[k % N]!);
    return out;
  };
  if (n < minRun + 2) return idx.map((k) => ({ ...boundary[k]! }));
  const out: PolyVertex[] = [];
  let i = 0;
  while (i < n) {
    let best: { j: number; cx: number; cy: number } | null = null;
    for (let j = i + minRun; j < i + n - 1; j++) {
      const run = span(i, j);
      const c = fitCircle(run);
      if (!c || run.some((p) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) > tol)) break;
      const a = run[0]!;
      const b = run[run.length - 1]!;
      // A huge radius is a straight line, which the plain vertices already describe.
      if (c.r > 10 * Math.hypot(b.x - a.x, b.y - a.y)) break;
      best = { j, cx: c.cx, cy: c.cy };
    }
    const a = boundary[idx[i % n]!]!;
    if (best && best.j <= n) {
      const run = span(i, best.j);
      const b = run[run.length - 1]!;
      const mid = run[Math.floor(run.length / 2)]!;
      const a0 = Math.atan2(a.y - best.cy, a.x - best.cx);
      const am = Math.atan2(mid.y - best.cy, mid.x - best.cx);
      const a1 = Math.atan2(b.y - best.cy, b.x - best.cx);
      const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let sweep = norm(a1 - a0);
      if (norm(am - a0) > sweep) sweep -= 2 * Math.PI;
      out.push({ x: a.x, y: a.y, bulge: Math.tan(sweep / 4) });
      i = best.j;
    } else {
      out.push({ x: a.x, y: a.y });
      i++;
    }
  }
  return out;
}

/** Suggest an outline polygon (pixel coordinates of `r`) from a click inside the panel. */
export function suggestOutline(r: Raster, seed: Vec2, opts: { tolerance?: number; simplifyPx?: number } = {}): PolyVertex[] {
  const mask = growRegion(r, seed, opts.tolerance ?? 28);
  const boundary = traceBoundary(mask, r.width, r.height);
  if (boundary.length < 8) return [];
  const tol = opts.simplifyPx ?? 1.5;
  return fitArcs(boundary, simplifyClosed(boundary, tol / 2), tol);
}

// ---------------------------------------------------------------- instrument rims

/**
 * Snap a round instrument's rim: from a click at its centre and one on its rim, search
 * along rays for the strongest edge and fit an ellipse (the rim seen in perspective).
 */
export function snapRim(r: Raster, centre: Vec2, rim: Vec2, rays = 48, L: Channel = smoothLum(r)): { points: Vec2[]; ellipse: EllipseFit } | null {
  const r0 = Math.hypot(rim.x - centre.x, rim.y - centre.y);
  if (r0 < 6) return null;
  let pts: Vec2[] = [];
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * 2 * Math.PI;
    const u = { x: Math.cos(a), y: Math.sin(a) };
    let best = 0;
    let bestT = -1;
    for (let t = 0.75 * r0; t <= 1.25 * r0; t += 0.5) {
      const g = sample(L, { x: centre.x + u.x * (t + 1), y: centre.y + u.y * (t + 1) }) - sample(L, { x: centre.x + u.x * (t - 1), y: centre.y + u.y * (t - 1) });
      if (Math.abs(g) > best) [best, bestT] = [Math.abs(g), t];
    }
    if (bestT > 0 && best > 8) pts.push({ x: centre.x + u.x * bestT, y: centre.y + u.y * bestT });
  }
  if (pts.length < 8) return null;
  // Drop rays that caught a screw or a knob: iterate fit and trim.
  for (let it = 0; it < 3; it++) {
    const e = fitEllipse(pts);
    if (!e) return null;
    const res = pts.map((p) => Math.abs(Math.sqrt((p.x - e.cx) ** 2 * e.M[0] + 2 * (p.x - e.cx) * (p.y - e.cy) * e.M[1] + (p.y - e.cy) ** 2 * e.M[2]) - 1) * e.b);
    const sorted = [...res].sort((a, b) => a - b);
    const cut = Math.max(1.5, 3 * sorted[Math.floor(sorted.length / 2)]!);
    const kept = pts.filter((_, i) => res[i]! <= cut);
    if (kept.length === pts.length || kept.length < 8) break;
    pts = kept;
  }
  const ellipse = fitEllipse(pts);
  return ellipse ? { points: pts, ellipse } : null;
}

export function smoothLum(r: Raster): Channel {
  return boxMean(luminance(r), 1);
}
