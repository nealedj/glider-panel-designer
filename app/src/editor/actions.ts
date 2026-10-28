/**
 * Editing actions. Each builds ops against the current document and dispatches them as
 * one undoable command.
 */
import { dimensionBox, dimensionEndPoint, dimensionGeometry, offsetDirection, textBox } from '../geom/annotation';
import { boxCentre, normAngle, shapeBox, unionBox, type Box } from '../geom/shapes';
import { findPart } from '../catalogue';
import { descendants, projectGeometry } from '../model/resolve';
import type { Dimension, KeepOut, PartRef, PlacedPart, Project, Shape, TextLabel, Vec2 } from '../model/schema';
import { docs } from '../store/app';
import { newId, ops, type Op } from '../store/doc';
import { ui } from '../store/ui';
import { removeRoutesOps, removeWiresOps, wiresOfParts } from '../wiring/ops';

const KEEPOUT_PREFIX = 'ko';

export const isKeepOutId = (id: string) => docs.doc.keepOuts.some((k) => k.id === id);

function selectedParts(doc: Project, ids = ui.state.selection): PlacedPart[] {
  const set = new Set(ids);
  return doc.parts.filter((p) => set.has(p.id));
}

function selectedKeepOuts(doc: Project, ids = ui.state.selection): KeepOut[] {
  const set = new Set(ids);
  return doc.keepOuts.filter((k) => set.has(k.id));
}

function selectedTexts(doc: Project, ids = ui.state.selection): TextLabel[] {
  const set = new Set(ids);
  return doc.texts.filter((t) => set.has(t.id));
}

function selectedDimensions(doc: Project, ids = ui.state.selection): Dimension[] {
  const set = new Set(ids);
  return doc.dimensions.filter((d) => set.has(d.id));
}

function msg(message: string) {
  ui.set({ message });
}

export function placePart(ref: PartRef, at: Vec2, label = ''): string {
  const id = newId('p');
  // An off-panel part is placed where its wiring leaves the panel, at the loom depth.
  const offPanel = !!findPart(ref, docs.doc.customParts)?.offPanel;
  const pp: PlacedPart = { id, part: ref, x: at.x, y: at.y, rotation: 0, label, mountedTo: null, depthOffset: offPanel ? ui.state.routeDepth : 0, locked: false, offPanelRunMm: null };
  docs.dispatch('Place part', [ops.insert('parts', pp)]);
  if (offPanel && ui.state.view === 'front') msg('Placed off the panel: it shows in the rear view, where its wiring leaves the panel');
  return id;
}

/** Round stored coordinates to 1 nm so repeated moves do not accumulate float noise. */
const q = (v: number) => Math.round(v * 1e6) / 1e6;

function movePartOp(pp: PlacedPart, moving: Set<string>, dx: number, dy: number): Op | null {
  if (pp.locked) return null;
  if (pp.mountedTo) {
    // A mounted part moves with its parent; moved alone, its offset changes.
    if (moving.has(pp.mountedTo.parent)) return null;
    return ops.replace('parts', { ...pp, mountedTo: { ...pp.mountedTo, dx: q(pp.mountedTo.dx + dx), dy: q(pp.mountedTo.dy + dy) } });
  }
  return ops.replace('parts', { ...pp, x: q(pp.x + dx), y: q(pp.y + dy) });
}

function moveShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case 'circle':
    case 'rect':
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case 'poly':
      return { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
  }
}

export function moveSelection(dx: number, dy: number, label = 'Move') {
  if (dx === 0 && dy === 0) return;
  const doc = docs.doc;
  const moving = new Set(ui.state.selection);
  const list: Op[] = [];
  for (const pp of selectedParts(doc)) {
    const op = movePartOp(pp, moving, dx, dy);
    if (op) list.push(op);
  }
  for (const k of selectedKeepOuts(doc)) list.push(ops.replace('keepOuts', { ...k, shape: moveShape(k.shape, dx, dy) }));
  for (const t of selectedTexts(doc)) list.push(ops.replace('texts', { ...t, x: q(t.x + dx), y: q(t.y + dy) }));
  list.push(...moveDimensionOps(doc, selectedDimensions(doc), dx, dy));
  if (!docs.dispatch(label, list) && selectedParts(doc).some((p) => p.locked)) msg('Selection is locked');
}

/**
 * Moving a dimension slides its line away from or towards what it measures; its ends stay
 * on the points or parts they are attached to.
 */
function moveDimensionOps(doc: Project, dims: Dimension[], dx: number, dy: number): Op[] {
  if (!dims.length) return [];
  const endAt = dimensionEndPoint(projectGeometry(doc));
  return dims.flatMap((d) => {
    const dg = dimensionGeometry(d, endAt);
    if (!dg) return [];
    const n = offsetDirection(d, dg);
    const by = dx * n.x + dy * n.y;
    return Math.abs(by) < 1e-9 ? [] : [ops.replace('dimensions', { ...d, offset: q(d.offset + by) })];
  });
}

export function setPartFields(id: string, patch: Partial<PlacedPart>, label = 'Edit part') {
  const pp = docs.doc.parts.find((p) => p.id === id);
  if (!pp) return;
  docs.dispatch(label, [ops.replace('parts', { ...pp, ...patch })]);
}

/** Set a part's world position, respecting mounting. */
export function setPartPosition(id: string, x: number, y: number) {
  const doc = docs.doc;
  const g = projectGeometry(doc).get(id);
  const pp = doc.parts.find((p) => p.id === id);
  if (!pp || !g) return;
  if (pp.locked) return;
  if (pp.mountedTo) {
    const cur = g.transform;
    const op = movePartOp(pp, new Set(), x - cur.x, y - cur.y);
    if (op) docs.dispatch('Set position', [op]);
    return;
  }
  // Typed positions are stored exactly as entered.
  docs.dispatch('Set position', [ops.replace('parts', { ...pp, x, y })]);
}

/**
 * Mount a part to another, or back to the panel (parent null). The part keeps its world
 * position. Mounted to a part, it starts just behind that part's rear face unless `dz` says
 * otherwise; back on the panel, it starts at the panel back face.
 */
export function mountTo(id: string, parent: string | null, dz?: number) {
  const doc = docs.doc;
  const pp = doc.parts.find((p) => p.id === id);
  if (!pp) return;
  const geom = projectGeometry(doc);
  const g = geom.get(id);
  if (!g) return;
  if (parent === null) {
    if (!pp.mountedTo) return;
    docs.dispatch('Mount to panel', [ops.replace('parts', { ...pp, x: g.transform.x, y: g.transform.y, mountedTo: null, depthOffset: 0 })]);
    return;
  }
  if (parent === id || descendants(doc.parts, [id]).has(parent)) return msg('A part cannot be mounted to itself or to a part mounted on it');
  const pg = geom.get(parent);
  if (!pg) return;
  const depth = dz ?? (pg.z1 === null ? 0 : pg.z1 - pg.z0);
  const pl = pg.part.model;
  docs.dispatch(`Mount to ${doc.parts.find((p) => p.id === parent)?.label || pl}`, [
    ops.replace('parts', { ...pp, mountedTo: { parent, dx: q(g.transform.x - pg.transform.x), dy: q(g.transform.y - pg.transform.y), dz: depth }, depthOffset: 0 }),
  ]);
}

export function detachSelection() {
  for (const id of ui.state.selection) mountTo(id, null);
}

export function setMountOffset(id: string, patch: Partial<{ dx: number; dy: number; dz: number }>) {
  const pp = docs.doc.parts.find((p) => p.id === id);
  if (!pp?.mountedTo) return;
  docs.dispatch('Set mounting offset', [ops.replace('parts', { ...pp, mountedTo: { ...pp.mountedTo, ...patch } })]);
}

export function rotateSelection(deg: number) {
  const list = selectedParts(docs.doc)
    .filter((p) => !p.locked)
    .map((p) => ops.replace('parts', { ...p, rotation: normAngle(p.rotation + deg) }));
  docs.dispatch(`Rotate ${deg}°`, list);
}

export function deleteSelection() {
  const doc = docs.doc;
  // Deleting a parent deletes the parts mounted to it.
  const sel = new Set([...ui.state.selection, ...descendants(doc.parts, ui.state.selection)]);
  const list: Op[] = [];
  for (const p of doc.parts) if (sel.has(p.id) && !p.locked) list.push(ops.remove('parts', p.id));
  for (const k of doc.keepOuts) if (sel.has(k.id)) list.push(ops.remove('keepOuts', k.id));
  for (const t of doc.texts) if (sel.has(t.id)) list.push(ops.remove('texts', t.id));
  // Dimensions go with the parts they measure.
  const gone = new Set(list.filter((o) => o.op === 'remove' && o.coll === 'parts').map((o) => (o as { id: string }).id));
  for (const d of doc.dimensions) {
    const attached = [d.a, d.b].some((e) => 'part' in e && gone.has(e.part));
    if (sel.has(d.id) || attached) list.push(ops.remove('dimensions', d.id));
  }
  // Wires go with their parts; selected wires and routes go too. Nets are worked out again.
  const wireIds = new Set([...wiresOfParts(doc, gone), ...doc.wires.filter((w) => sel.has(w.id)).map((w) => w.id)]);
  if (wireIds.size) list.push(...removeWiresOps(doc, wireIds));
  const routeIds = new Set(doc.routes.filter((r) => sel.has(r.id)).map((r) => r.id));
  if (routeIds.size) list.push(...removeRoutesOps(doc, routeIds).filter((o) => !(o.op === 'replace' && o.coll === 'wires' && wireIds.has((o.item as { id: string }).id))));
  const extra = list.filter((o) => o.op === 'remove' && o.coll === 'parts').length - ui.state.selection.filter((id) => doc.parts.some((p) => p.id === id)).length;
  if (docs.dispatch('Delete', list)) {
    ui.set({ selection: [], message: extra > 0 ? `Also deleted ${extra} mounted part(s)` : '' });
  } else if (selectedParts(doc).some((p) => p.locked)) {
    msg('Selection is locked');
  }
}

export function duplicateSelection(offset: Vec2 = { x: 10, y: -10 }) {
  const doc = docs.doc;
  const idMap = new Map<string, string>();
  const parts = selectedParts(doc);
  for (const p of parts) idMap.set(p.id, newId('p'));
  const list: Op[] = parts.map((p) => {
    const parentCopied = p.mountedTo && idMap.has(p.mountedTo.parent);
    const mountedTo = p.mountedTo ? (parentCopied ? { ...p.mountedTo, parent: idMap.get(p.mountedTo.parent)! } : { ...p.mountedTo, dx: p.mountedTo.dx + offset.x, dy: p.mountedTo.dy + offset.y }) : null;
    return ops.insert('parts', { ...p, id: idMap.get(p.id)!, x: p.x + offset.x, y: p.y + offset.y, mountedTo, locked: false });
  });
  const kos = selectedKeepOuts(doc).map((k) => {
    const id = newId(KEEPOUT_PREFIX);
    idMap.set(k.id, id);
    return ops.insert('keepOuts', { ...k, id, shape: moveShape(k.shape, offset.x, offset.y) });
  });
  const texts = selectedTexts(doc).map((t) => {
    const id = newId('t');
    idMap.set(t.id, id);
    return ops.insert('texts', { ...t, id, x: t.x + offset.x, y: t.y + offset.y });
  });
  if (docs.dispatch('Duplicate', [...list, ...kos, ...texts])) ui.set({ selection: [...idMap.values()] });
}

export function addKeepOut(shape: Shape, label = 'Keep-out') {
  const id = newId(KEEPOUT_PREFIX);
  docs.dispatch('Add keep-out', [ops.insert('keepOuts', { id, label, shape })]);
  ui.set({ selection: [id] });
}

export function setKeepOut(k: KeepOut) {
  docs.dispatch('Edit keep-out', [ops.replace('keepOuts', k)]);
}

// ---------------------------------------------------------------- annotations

export function addText(at: Vec2, text = 'LABEL'): string {
  const id = newId('t');
  docs.dispatch('Add text', [ops.insert('texts', { id, text, x: q(at.x), y: q(at.y), size: 3.5, font: 'Helvetica', rotation: 0, layer: 'engrave' })]);
  ui.set({ selection: [id] });
  return id;
}

export function setText(t: TextLabel, label = 'Edit text') {
  docs.dispatch(label, [ops.replace('texts', t)]);
}

export function addDimension(a: Dimension['a'], b: Dimension['b'], kind: Dimension['kind'], offset = 10): string {
  const id = newId('d');
  docs.dispatch('Add dimension', [ops.insert('dimensions', { id, a, b, kind, offset })]);
  ui.set({ selection: [id] });
  return id;
}

export function setDimension(d: Dimension, label = 'Edit dimension') {
  docs.dispatch(label, [ops.replace('dimensions', d)]);
}

// ---------------------------------------------------------------- alignment

export type AlignMode = 'left' | 'centre-x' | 'right' | 'top' | 'centre-y' | 'bottom';

interface Item {
  pp: PlacedPart;
  box: Box;
  centre: Vec2;
}

function movableItems(): Item[] {
  const doc = docs.doc;
  const geom = projectGeometry(doc);
  return selectedParts(doc)
    .filter((pp) => !pp.locked)
    .flatMap((pp) => {
      const g = geom.get(pp.id);
      return g ? [{ pp, box: g.frontBox, centre: { x: g.transform.x, y: g.transform.y } }] : [];
    });
}

function moveItems(label: string, moves: [Item, number, number][]) {
  const moving = new Set<string>();
  const list = moves.flatMap(([it, dx, dy]) => {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return [];
    const op = movePartOp(it.pp, moving, dx, dy);
    return op ? [op] : [];
  });
  docs.dispatch(label, list);
}

export function align(mode: AlignMode) {
  const items = movableItems();
  if (items.length < 2) return msg('Select two or more unlocked parts to align');
  const all = unionBox(items.map((i) => i.box))!;
  // Centre alignment uses part centres, so round instruments line up on their axes.
  const meanX = items.reduce((s, i) => s + i.centre.x, 0) / items.length;
  const meanY = items.reduce((s, i) => s + i.centre.y, 0) / items.length;
  const first = items[0]!.centre;
  moveItems(
    `Align ${mode}`,
    items.map((i): [Item, number, number] => {
      switch (mode) {
        case 'left':
          return [i, all.minX - i.box.minX, 0];
        case 'right':
          return [i, all.maxX - i.box.maxX, 0];
        case 'top':
          return [i, 0, all.maxY - i.box.maxY];
        case 'bottom':
          return [i, 0, all.minY - i.box.minY];
        case 'centre-x':
          return [i, (items.length === 2 ? first.x : meanX) - i.centre.x, 0];
        case 'centre-y':
          return [i, 0, (items.length === 2 ? first.y : meanY) - i.centre.y];
      }
    }),
  );
}

/** Distribute centres evenly between the two outermost parts. */
export function distribute(axis: 'x' | 'y') {
  const items = movableItems();
  if (items.length < 3) return msg('Select three or more unlocked parts to distribute');
  const sorted = [...items].sort((a, b) => a.centre[axis] - b.centre[axis]);
  const lo = sorted[0]!.centre[axis];
  const hi = sorted[sorted.length - 1]!.centre[axis];
  const step = (hi - lo) / (sorted.length - 1);
  moveItems(
    `Distribute ${axis}`,
    sorted.map((it, k): [Item, number, number] => {
      const d = lo + k * step - it.centre[axis];
      return axis === 'x' ? [it, d, 0] : [it, 0, d];
    }),
  );
}

/** Copy the selection mirrored about the panel centreline (x = 0). */
export function mirrorCopy() {
  const parts = selectedParts(docs.doc).filter((p) => !p.mountedTo);
  if (!parts.length) return msg('Select parts to mirror');
  // Parts are not mirrored themselves (an instrument is the same either side), only their
  // placement: position reflects about x = 0 and rotation reverses.
  const list = parts.map((p) => ops.insert('parts', { ...p, id: newId('p'), x: -p.x, rotation: normAngle(-p.rotation), locked: false }));
  docs.dispatch('Mirror copy', list);
  ui.set({ selection: list.map((o) => (o as { item: { id: string } }).item.id) });
}

/** Linear array: `count` total copies including the original, stepping by (dx, dy). */
export function linearArray(count: number, dx: number, dy: number) {
  const parts = selectedParts(docs.doc).filter((p) => !p.mountedTo);
  if (!parts.length || count < 2) return;
  const list: Op[] = [];
  for (let k = 1; k < count; k++) {
    for (const p of parts) list.push(ops.insert('parts', { ...p, id: newId('p'), x: p.x + k * dx, y: p.y + k * dy, locked: false }));
  }
  docs.dispatch(`Linear array ×${count}`, list);
}

/** Circular array about a centre, spanning `totalDeg` (360 = full circle). */
export function circularArray(count: number, centre: Vec2, totalDeg: number, rotateParts: boolean) {
  const parts = selectedParts(docs.doc).filter((p) => !p.mountedTo);
  if (!parts.length || count < 2) return;
  const step = Math.abs(totalDeg) >= 360 ? totalDeg / count : totalDeg / (count - 1);
  const list: Op[] = [];
  for (let k = 1; k < count; k++) {
    const a = ((step * k) * Math.PI) / 180;
    for (const p of parts) {
      const rx = p.x - centre.x;
      const ry = p.y - centre.y;
      list.push(
        ops.insert('parts', {
          ...p,
          id: newId('p'),
          x: centre.x + rx * Math.cos(a) - ry * Math.sin(a),
          y: centre.y + rx * Math.sin(a) + ry * Math.cos(a),
          rotation: rotateParts ? normAngle(p.rotation + step * k) : p.rotation,
          locked: false,
        }),
      );
    }
  }
  docs.dispatch(`Circular array ×${count}`, list);
}

export function selectionBox(): Box | null {
  const geom = projectGeometry(docs.doc);
  const boxes: Box[] = [];
  const rear = ui.state.view === 'rear';
  for (const id of ui.state.selection) {
    const g = geom.get(id);
    if (g) boxes.push(rear ? g.rearBox : g.frontBox);
    const k = docs.doc.keepOuts.find((x) => x.id === id);
    if (k) boxes.push(shapeBox(k.shape));
    const t = docs.doc.texts.find((x) => x.id === id);
    if (t) boxes.push(textBox(t));
    const d = docs.doc.dimensions.find((x) => x.id === id);
    const dg = d && dimensionGeometry(d, dimensionEndPoint(geom));
    if (dg) boxes.push(dimensionBox(dg));
  }
  return unionBox(boxes);
}

export function selectionCentre(): Vec2 | null {
  const b = selectionBox();
  return b ? boxCentre(b) : null;
}
