/**
 * Wiring edits on the open document, each one undoable command.
 */
import { projectGeometry } from '../model/resolve';
import type { Net, Route, Wire } from '../model/schema';
import { docs } from '../store/app';
import { ops, type Op } from '../store/doc';
import { ui } from '../store/ui';
import { addRouteOps, assignRouteOps, connectOps, removeRoutesOps, removeWiresOps } from './ops';
import { terminals } from './terminals';

export function connectKeys(aKey: string, bKey: string): string | null {
  const terms = terminals(docs.doc, projectGeometry(docs.doc));
  const a = terms.get(aKey);
  const b = terms.get(bKey);
  if (!a || !b) return null;
  const r = connectOps(docs.doc, a.terminal, b.terminal);
  if (r.error || !r.wire) {
    ui.set({ message: r.error ?? 'Could not connect' });
    return null;
  }
  docs.dispatch(`Connect ${a.label} to ${b.label}`, r.ops);
  ui.set({ message: `${r.wire.label}: ${a.label} → ${b.label}`, selection: [r.wire.id] });
  return r.wire.id;
}

export function removeWiring(ids: Set<string>): Op[] {
  const doc = docs.doc;
  return [...removeWiresOps(doc, ids), ...removeRoutesOps(doc, ids).filter((o) => !(o.op === 'replace' && o.coll === 'wires' && ids.has((o.item as Wire).id)))];
}

export function setWire(w: Wire, label = 'Edit wire') {
  docs.dispatch(label, [ops.replace('wires', w)]);
}

export function setNet(n: Net, label = 'Rename net') {
  docs.dispatch(label, [ops.replace('nets', n)]);
}

export function setRoute(r: Route, label = 'Edit route') {
  docs.dispatch(label, [ops.replace('routes', r)]);
}

export function finishRoute(points: { x: number; y: number }[], depth: number): string | null {
  if (points.length < 2) return null;
  const n = docs.doc.routes.length + 1;
  const r = addRouteOps(points.map((p) => ({ x: p.x, y: p.y, z: depth })), `Route ${n}`);
  // Wires already selected go onto the new route.
  const selected = ui.state.selection.filter((id) => docs.doc.wires.some((w) => w.id === id));
  docs.dispatch('Add route', [...r.ops, ...assignRouteOps({ ...docs.doc, routes: [...docs.doc.routes, r.route] }, selected, r.route.id)]);
  ui.set({ selection: [r.route.id], routeDraft: [], message: `${r.route.label} added${selected.length ? ` with ${selected.length} wire(s)` : ''}. Select wires and use “Put on route” to add more.` });
  return r.route.id;
}

export function assignRoute(wireIds: string[], routeId: string | null) {
  docs.dispatch(routeId ? 'Put wires on route' : 'Take wires off route', assignRouteOps(docs.doc, wireIds, routeId));
}

export function moveBlock(partId: string, at: { x: number; y: number }) {
  const pp = docs.doc.parts.find((p) => p.id === partId);
  if (!pp) return;
  docs.dispatch('Move schematic block', [ops.replace('parts', { ...pp, schematic: { x: Math.round(at.x), y: Math.round(at.y) } })]);
}

export function resetSchematic() {
  docs.dispatch(
    'Reset schematic layout',
    docs.doc.parts.filter((p) => p.schematic).map((p) => {
      const { schematic: _s, ...rest } = p;
      void _s;
      return ops.replace('parts', rest);
    }),
  );
}
