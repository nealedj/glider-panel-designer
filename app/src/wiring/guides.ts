/**
 * Shaping wires and routes by hand (ADR 0017). A wire that is not on a route runs from its
 * first terminal through its guide points to its second; a route is its own points. Both are
 * edited the same way, with handles in the rear view:
 * - drag a point to move it;
 * - drag the handle in the middle of a leg to add a point there;
 * - double-click a point to remove it.
 * A wire's ends stay on their terminals. A route keeps at least two points.
 */
import { midpoint } from '../geom/smooth';
import type { Project } from '../model/schema';
import { ops, type Op } from '../store/doc';
import type { Analysis } from './circuit';
import { guidePoints } from './length';
import { keyOf, type Vec3 } from './terminals';

export interface GuideTarget {
  kind: 'wire' | 'route';
  id: string;
}

/** The points of a wire or route that the user shapes, in order. A wire's first and last are its terminals. */
export interface Control {
  target: GuideTarget;
  points: Vec3[];
}

export interface Handle {
  /** Index of the point; for an insert handle, where the new point goes. */
  index: number;
  insert: boolean;
  at: Vec3;
}

/** What can be shaped for a selected id; null when nothing can (a wire that follows a route). */
export function controlOf(doc: Project, a: Analysis, id: string): Control | null {
  const r = doc.routes.find((x) => x.id === id);
  if (r) return r.points.length >= 2 ? { target: { kind: 'route', id }, points: r.points.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })) } : null;
  const w = doc.wires.find((x) => x.id === id);
  if (!w) return null;
  if (w.route && (doc.routes.find((x) => x.id === w.route)?.points.length ?? 0) >= 2) return null;
  const ta = a.terms.get(keyOf(w.from));
  const tb = a.terms.get(keyOf(w.to));
  if (!ta || !tb) return null;
  // Two off-panel parts at one exit are joined beyond the panel: nothing to draw or shape.
  if (ta.offPanel && tb.offPanel && Math.hypot(ta.pos.x - tb.pos.x, ta.pos.y - tb.pos.y) < 1) return null;
  return { target: { kind: 'wire', id }, points: [ta.pos, ...guidePoints(w), tb.pos] };
}

/** Handles: one on every point that can move, and one in the middle of every leg to add a point. */
export function handlesOf(c: Control): Handle[] {
  const out: Handle[] = [];
  const fixedEnds = c.target.kind === 'wire';
  c.points.forEach((p, i) => {
    if (i > 0) out.push({ index: i, insert: true, at: midpoint(c.points[i - 1]!, p) });
    if (!fixedEnds || (i > 0 && i < c.points.length - 1)) out.push({ index: i, insert: false, at: p });
  });
  return out;
}

/** The control points with one moved, or one added, at a plan position. Depth is kept, or taken from the leg. */
export function movePoint(c: Control, h: Pick<Handle, 'index' | 'insert'>, to: { x: number; y: number }): Vec3[] {
  const pts = c.points.map((p) => ({ ...p }));
  if (h.insert) {
    const z = midpoint(pts[h.index - 1]!, pts[h.index]!).z;
    pts.splice(h.index, 0, { x: to.x, y: to.y, z });
  } else pts[h.index] = { ...pts[h.index]!, x: to.x, y: to.y };
  return pts;
}

/** The control points without one; null if it cannot go (a wire's end, or a route's last two). */
export function withoutPoint(c: Control, index: number): Vec3[] | null {
  if (c.target.kind === 'wire' && (index <= 0 || index >= c.points.length - 1)) return null;
  if (c.target.kind === 'route' && c.points.length <= 2) return null;
  return c.points.filter((_, i) => i !== index);
}

const round = (p: Vec3): Vec3 => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100 });

/** Ops that give a wire or route these control points. */
export function setControlOps(doc: Project, t: GuideTarget, points: Vec3[]): Op[] {
  if (t.kind === 'route') {
    const r = doc.routes.find((x) => x.id === t.id);
    return r ? [ops.replace('routes', { ...r, points: points.map(round) })] : [];
  }
  const w = doc.wires.find((x) => x.id === t.id);
  if (!w) return [];
  const via = points.slice(1, -1).map(round);
  if (!via.length) {
    const { via: _v, ...rest } = w;
    void _v;
    return w.via ? [ops.replace('wires', rest)] : [];
  }
  return [ops.replace('wires', { ...w, via })];
}

/** Ops that take every guide point off these wires, so they run straight again. */
export function straightenOps(doc: Project, wireIds: string[]): Op[] {
  return doc.wires
    .filter((w) => wireIds.includes(w.id) && w.via?.length)
    .map((w) => {
      const { via: _v, ...rest } = w;
      void _v;
      return ops.replace('wires', rest);
    });
}
