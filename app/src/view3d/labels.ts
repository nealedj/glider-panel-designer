/**
 * Part labels written on the faces of the 3D view's solids: on the pilot's face of each
 * bezel, and on the rear face of each body. A label is placed only where it fits inside the
 * face at a legible size; otherwise the face is left plain and the hover tip still names it.
 * No renderer here: text widths come from the caller's `measure`, so this is testable.
 */
import { signedDistanceToPolygon } from '../geom/region';
import { pointsBox } from '../geom/shapes';
import type { Vec2 } from '../model/schema';
import type { Model3D, Solid } from './model3d';

/** Text height (em size), mm. Smaller than MIN is unreadable at a normal zoom; larger than MAX shouts. */
export const LABEL_MIN_MM = 2;
export const LABEL_MAX_MM = 10;
/** Line pitch, in ems. */
export const LINE_HEIGHT = 1.2;

/** Width of `text` in ems (at an em size of 1). */
export type Measure = (text: string) => number;

export interface FaceLabel {
  key: string;
  partId: string;
  lines: string[];
  /** Centre of the text, panel mm. */
  x: number;
  y: number;
  /** Depth of the face, mm rearward from the panel back face. */
  z: number;
  /** Em size, mm. */
  size: number;
  /** Which way the face looks: the pilot's side or the fitter's. */
  facing: 'front' | 'rear';
  solid: Solid;
}

export interface Fit {
  lines: string[];
  x: number;
  y: number;
  size: number;
}

/** The text as one line, and as two lines split at the space that balances them best. */
function layouts(text: string, measure: Measure): string[][] {
  const out: string[][] = [[text]];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return out;
  let best: string[] | null = null;
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(...pair.map(measure));
    if (w < bestW) {
      bestW = w;
      best = pair;
    }
  }
  if (best) out.push(best);
  return out;
}

/** Whether a w × h box centred on c sits inside the polygon, clear of its edge by `margin`. */
function boxFits(poly: Vec2[], c: Vec2, w: number, h: number, margin: number): boolean {
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const fx = -w / 2 + (w * i) / n;
    const fy = -h / 2 + (h * i) / n;
    const probes = [
      { x: c.x + fx, y: c.y - h / 2 },
      { x: c.x + fx, y: c.y + h / 2 },
      { x: c.x - w / 2, y: c.y + fy },
      { x: c.x + w / 2, y: c.y + fy },
    ];
    for (const p of probes) if (signedDistanceToPolygon(p, poly) > -margin) return false;
  }
  return true;
}

/** The largest legible size at which `text` fits inside the outline, or null when it does not fit. */
export function fitLabel(outline: Vec2[], text: string, measure: Measure): Fit | null {
  if (!text.trim() || outline.length < 3) return null;
  const b = pointsBox(outline);
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  let best: Fit | null = null;
  for (const lines of layouts(text.trim(), measure)) {
    const wEm = Math.max(...lines.map(measure));
    const hEm = lines.length * LINE_HEIGHT;
    const fits = (s: number) => boxFits(outline, c, wEm * s, hEm * s, 0.6 + 0.15 * s);
    if (!fits(LABEL_MIN_MM)) continue;
    let lo = LABEL_MIN_MM;
    let hi = LABEL_MAX_MM;
    if (fits(hi)) lo = hi;
    else
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
    // One line wins unless two are clearly larger.
    if (!best || lo > best.size * 1.15) best = { lines, x: c.x, y: c.y, size: lo };
  }
  return best;
}

/** Labels for every bezel and body face that has room for one. */
export function faceLabels(m: Model3D, measure: Measure): FaceLabel[] {
  const out: FaceLabel[] = [];
  for (const s of m.solids) {
    if (!s.partId || s.role === 'panel') continue;
    const text = m.labels.get(s.partId);
    if (!text) continue;
    const fit = fitLabel(s.outline, text, measure);
    if (!fit) continue;
    const front = s.role === 'bezel';
    out.push({ key: `label:${s.key}`, partId: s.partId, ...fit, z: front ? s.z0 : s.z1, facing: front ? 'front' : 'rear', solid: s });
  }
  return out;
}
