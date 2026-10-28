/**
 * Wiring edits as document ops: connect two terminals, remove wires, routes. Pure, so the
 * editor, the sample generator and the tests share them.
 */
import { projectGeometry } from '../model/resolve';
import type { Project, Route, Terminal, Wire } from '../model/schema';
import { applyOps, newId, ops, type Op } from '../store/doc';
import { COLOUR_BY_TYPE, DATA_COLOURS, DEFAULT_TUBE_BORE_MM, netOps, netType, nextLabel } from './nets';
import { keyOf, terminals } from './terminals';

export interface ConnectResult {
  ops: Op[];
  wire: Wire | null;
  error?: string;
}

export function connectOps(doc: Project, a: Terminal, b: Terminal, patch: Partial<Wire> = {}): ConnectResult {
  const terms = terminals(doc, projectGeometry(doc));
  const ta = terms.get(keyOf(a));
  const tb = terms.get(keyOf(b));
  if (!ta || !tb) return { ops: [], wire: null, error: 'That terminal no longer exists' };
  if (ta.key === tb.key) return { ops: [], wire: null, error: 'Pick a different terminal to connect to' };
  if (ta.kind !== tb.kind) return { ops: [], wire: null, error: 'A tube joins ports, a wire joins pins' };
  if (doc.wires.some((w) => (keyOf(w.from) === ta.key && keyOf(w.to) === tb.key) || (keyOf(w.from) === tb.key && keyOf(w.to) === ta.key)))
    return { ops: [], wire: null, error: 'Those two are already connected' };
  // The type the joined net will have, for defaults.
  // A tee's ports are one space: a tube on any of them joins the line on the others.
  const sameSpace = (k: string) => {
    const t = terms.get(k)!;
    return t.port?.kind === 'any' ? [...terms.values()].filter((o) => o.partId === t.partId && o.port?.kind === 'any').map((o) => o.key) : [k];
  };
  const keys = new Set([...sameSpace(ta.key), ...sameSpace(tb.key)]);
  const existing = doc.nets.find((n) => n.members.some((m) => keys.has(keyOf(m))));
  const type = existing && existing.type !== 'other' ? existing.type : netType([ta, tb]);
  const isTube = ta.kind === 'port';
  let colour = COLOUR_BY_TYPE[type];
  if (type === 'data' && !existing) {
    const dataNets = doc.nets.filter((n) => n.type === 'data').length;
    colour = DATA_COLOURS[dataNets % DATA_COLOURS.length]!;
  } else if (existing) {
    const sibling = doc.wires.find((w) => w.net === existing.id);
    if (sibling) colour = sibling.colour;
  }
  const wire: Wire = {
    id: newId('w'),
    net: '',
    from: ta.terminal,
    to: tb.terminal,
    sizeMm2: null,
    tubeBoreMm: isTube ? DEFAULT_TUBE_BORE_MM : null,
    colour,
    label: nextLabel(doc, isTube ? type : 'power'),
    route: null,
    sizeAuto: !isTube,
    ...patch,
  };
  const n = netOps(doc, [...doc.wires, wire], terms);
  wire.net = n.netOf.get(ta.key)!;
  return { ops: [ops.insert('wires', wire), ...n.ops], wire };
}

export function removeWiresOps(doc: Project, ids: Set<string>): Op[] {
  if (!doc.wires.some((w) => ids.has(w.id))) return [];
  const terms = terminals(doc, projectGeometry(doc));
  const rest = doc.wires.filter((w) => !ids.has(w.id));
  return [...doc.wires.filter((w) => ids.has(w.id)).map((w) => ops.remove('wires', w.id)), ...netOps(doc, rest, terms).ops];
}

/** Wires to remove when parts go. */
export function wiresOfParts(doc: Project, partIds: Set<string>): Set<string> {
  return new Set(doc.wires.filter((w) => partIds.has(w.from.part) || partIds.has(w.to.part)).map((w) => w.id));
}

export function addRouteOps(points: Route['points'], label = ''): { ops: Op[]; route: Route } {
  const route: Route = { id: newId('r'), label, points, ties: [] };
  return { ops: [ops.insert('routes', route)], route };
}

export function assignRouteOps(doc: Project, wireIds: string[], routeId: string | null): Op[] {
  return doc.wires.filter((w) => wireIds.includes(w.id) && w.route !== routeId).map((w) => ops.replace('wires', { ...w, route: routeId }));
}

export function removeRoutesOps(doc: Project, ids: Set<string>): Op[] {
  return [
    ...doc.routes.filter((r) => ids.has(r.id)).map((r) => ops.remove('routes', r.id)),
    ...doc.wires.filter((w) => w.route && ids.has(w.route)).map((w) => ops.replace('wires', { ...w, route: null })),
  ];
}

/** Apply a sequence of connects to a document (for building projects in code). */
export function withConnections(doc: Project, pairs: [Terminal, Terminal, Partial<Wire>?][]): Project {
  let d = doc;
  for (const [a, b, patch] of pairs) {
    const r = connectOps(d, a, b, patch);
    if (r.error) throw new Error(`${keyOf(a)} → ${keyOf(b)}: ${r.error}`);
    d = applyOps(d, r.ops)[0];
  }
  return d;
}
