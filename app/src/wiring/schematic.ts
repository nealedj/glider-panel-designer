/**
 * Schematic auto-layout: a block diagram built from the nets, so it reads without tidying.
 * See ADR 0012.
 *
 * - Blocks go in columns by role, left to right in the direction power flows: battery,
 *   switches, fuses and breakers, powered parts, pneumatic instruments and tees, then the
 *   other off-panel parts. Within a column, blocks are ordered to follow their neighbours
 *   (barycentre sweeps), which removes most crossings.
 * - Each terminal sits on the side of its block that faces what it connects to.
 * - Wires between neighbouring columns are drawn as orthogonal lines, each with its own
 *   vertical track in the channel between the columns, so no two lines overlap.
 * - Wires that would cross other columns get a net label at each end instead of a line.
 * - Ground connections get a ground symbol instead of a line.
 * - A block the user has moved keeps its position; everything else is laid out around it.
 *
 * Schematic units are drawing units with y down.
 */
import type { PartGeometry } from '../model/resolve';
import type { CataloguePart, Net, Project } from '../model/schema';
import { keyOf, partLabel, type TerminalInfo } from './terminals';

export const BLOCK_W = 160;
/** Space a net label takes beside its pin: leader, gap and text at 9.5 units (about 5.8 a character). */
export const labelWidth = (text: string) => 16 + 3 + text.length * 5.8 + 6;
export const ROW_H = 18;
export const HEAD_H = 28;
const GAP_Y = 36;
const TRACK = 10;
const CHANNEL_MIN = 70;

export type Symbol = 'battery' | 'switch' | 'fuse' | 'breaker' | 'antenna' | 'speaker' | 'tee' | 'source' | null;

export interface SchemPin {
  key: string;
  label: string;
  side: 'left' | 'right';
  x: number;
  y: number;
  net: Net | null;
  kind: 'pin' | 'port';
  signal: string;
}

export interface SchemBlock {
  partId: string;
  label: string;
  sub: string;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  offPanel: boolean;
  symbol: Symbol;
  moved: boolean;
  pins: SchemPin[];
}

export interface SchemWire {
  wireId: string;
  /** Pin keys at the first and last point. */
  startKey: string;
  endKey: string;
  netType: Net['type'];
  colour: string;
  points: { x: number; y: number }[];
}

export interface SchemLabel {
  wireId: string;
  key: string;
  x: number;
  y: number;
  side: 'left' | 'right';
  text: string;
  netType: Net['type'];
}

export interface SchemGround {
  key: string;
  x: number;
  y: number;
  side: 'left' | 'right';
}

export interface Schematic {
  blocks: SchemBlock[];
  wires: SchemWire[];
  labels: SchemLabel[];
  grounds: SchemGround[];
  width: number;
  height: number;
}

function roleColumn(p: CataloguePart): number {
  if (p.category === 'power') return 0;
  if (p.category === 'switch' && !p.offPanel) return 1;
  if (p.category === 'fuse' || p.category === 'breaker') return 2;
  if (p.offPanel) return 5;
  if (p.category === 'pneumatic') return 4;
  if (p.power || p.connectors.length) return 3;
  return 4;
}

function symbolOf(p: CataloguePart): Symbol {
  if (p.category === 'power' && p.capacityAh != null) return 'battery';
  if (p.category === 'switch') return 'switch';
  if (p.category === 'fuse') return 'fuse';
  if (p.category === 'breaker') return 'breaker';
  if (p.category === 'antenna') return 'antenna';
  if (p.category === 'audio' && p.offPanel) return 'speaker';
  if (p.category === 'pneumatic') return p.offPanel ? 'source' : 'tee';
  return null;
}

export function layoutSchematic(doc: Project, geometry: Map<string, PartGeometry>, terms: Map<string, TerminalInfo>, opts: { hide?: Set<Net['type']> } = {}): Schematic {
  const hide = opts.hide ?? new Set();
  const netOfKey = new Map<string, Net>();
  for (const n of doc.nets) for (const m of n.members) netOfKey.set(keyOf(m), n);
  const wires = doc.wires.filter((w) => !hide.has(netOfKey.get(keyOf(w.from))?.type ?? 'other'));

  // ---- which parts appear: anything with terminals
  const parts = doc.parts.filter((pp) => {
    const g = geometry.get(pp.id);
    return g && (g.part.connectors.length || g.part.ports.length);
  });
  const col = new Map<string, number>();
  for (const pp of parts) col.set(pp.id, roleColumn(geometry.get(pp.id)!.part));

  // ---- neighbours, for ordering
  const neigh = new Map<string, string[]>();
  for (const w of wires) {
    const a = w.from.part;
    const b = w.to.part;
    if (a === b) continue;
    neigh.set(a, [...(neigh.get(a) ?? []), b]);
    neigh.set(b, [...(neigh.get(b) ?? []), a]);
  }
  const columns: string[][] = [[], [], [], [], [], []];
  for (const pp of parts) columns[col.get(pp.id)!]!.push(pp.id);
  const index = new Map<string, number>();
  const reindex = () => columns.forEach((c) => c.forEach((id, i) => index.set(id, i)));
  reindex();
  const bary = (id: string) => {
    const ns = (neigh.get(id) ?? []).filter((n) => col.get(n) !== col.get(id));
    return ns.length ? ns.reduce((s, n) => s + index.get(n)! / Math.max(1, columns[col.get(n)!]!.length), 0) / ns.length : index.get(id)! / Math.max(1, columns[col.get(id)!]!.length);
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 === 0 ? [1, 2, 3, 4, 5, 0] : [4, 3, 2, 1, 0, 5];
    for (const c of order) {
      const keyed = columns[c]!.map((id) => [id, bary(id)] as const);
      keyed.sort((a, b) => a[1] - b[1]);
      columns[c] = keyed.map(([id]) => id);
      reindex();
    }
  }

  // ---- terminal sides: towards the average column of what each connects to
  const partTerms = new Map<string, TerminalInfo[]>();
  for (const t of terms.values()) {
    if (!col.has(t.partId)) continue;
    partTerms.set(t.partId, [...(partTerms.get(t.partId) ?? []), t]);
  }
  const otherEnds = new Map<string, string[]>();
  for (const w of wires) {
    otherEnds.set(keyOf(w.from), [...(otherEnds.get(keyOf(w.from)) ?? []), w.to.part]);
    otherEnds.set(keyOf(w.to), [...(otherEnds.get(keyOf(w.to)) ?? []), w.from.part]);
  }
  const sideOf = (t: TerminalInfo): 'left' | 'right' => {
    const mine = col.get(t.partId)!;
    const ends = otherEnds.get(t.key) ?? [];
    if (!ends.length) return t.pin?.direction === 'in' || t.pin?.signal === 'ground' ? 'left' : 'right';
    const avg = ends.reduce((s, p) => s + (col.get(p) ?? mine), 0) / ends.length;
    if (avg < mine) return 'left';
    if (avg > mine) return 'right';
    // Links within the column go on the right, so both ends share a channel. A terminal
    // whose other ends are all inputs to this column (a fuse bus) stays on the left.
    const toLeftCol = ends.every((p) => col.get(p) === mine) && t.pin?.direction === 'in' && t.pin.signal === 'power';
    return toLeftCol ? 'left' : 'right';
  };

  // ---- columns that have blocks, in order; neighbours are judged among these
  const rankOf = new Map<number, number>();
  columns.forEach((c, i) => c.length && rankOf.set(i, rankOf.size));
  const occCols = [...rankOf.keys()];

  // ---- channel widths: one track per wire in the channel left of each occupied column
  const crossLeft = new Map<number, number>();
  const bump = (c: number) => crossLeft.set(c, (crossLeft.get(c) ?? 0) + 1);
  for (const w of wires) {
    const ca = col.get(w.from.part);
    const cb = col.get(w.to.part);
    if (ca === undefined || cb === undefined) continue;
    const ra = rankOf.get(ca)!;
    const rb = rankOf.get(cb)!;
    if (Math.abs(ra - rb) === 1) bump(occCols[Math.max(ra, rb)]!);
    if (ca === cb) {
      bump(ca);
      if (ra + 1 < occCols.length) bump(occCols[ra + 1]!);
    }
  }
  // ---- room for net labels: a labelled end's text runs into the channel on its side, so
  // each channel is at least as wide as the longest label from each side, and never overlaps
  // the next column's blocks.
  const roomL = new Map<number, number>();
  const roomR = new Map<number, number>();
  const blockLabel = (id: string) => {
    const pp = doc.parts.find((p) => p.id === id);
    const g = geometry.get(id);
    return pp && g ? partLabel(pp, g) : id;
  };
  for (const w of wires) {
    const net = netOfKey.get(keyOf(w.from));
    if (net?.type === 'ground') continue;
    const ta = terms.get(keyOf(w.from));
    const tb = terms.get(keyOf(w.to));
    const ca = col.get(w.from.part);
    const cb = col.get(w.to.part);
    if (!ta || !tb || ca === undefined || cb === undefined) continue;
    const labelled = Math.abs(rankOf.get(ca)! - rankOf.get(cb)!) > 1 || (ca === cb && sideOf(ta) !== sideOf(tb));
    if (!labelled) continue;
    for (const [t, c, other] of [
      [ta, ca, w.to.part],
      [tb, cb, w.from.part],
    ] as const) {
      const room = labelWidth(`${net?.name ?? 'net'} → ${blockLabel(other)}`);
      const m = sideOf(t) === 'left' ? roomL : roomR;
      m.set(c, Math.max(m.get(c) ?? 0, room));
    }
  }
  const colX: number[] = new Array(6).fill(40);
  let x = 40;
  occCols.forEach((c, i) => {
    const prev = occCols[i - 1];
    const labels = (roomL.get(c) ?? 0) + (prev === undefined ? 0 : (roomR.get(prev) ?? 0)) + 16;
    if (i > 0) x += BLOCK_W + Math.max(CHANNEL_MIN, ((crossLeft.get(c) ?? 0) + 2) * TRACK + 40, labels);
    else x += roomL.get(c) ?? 0;
    colX[c] = x;
  });

  // ---- blocks
  const blocks: SchemBlock[] = [];
  const byPart = new Map(doc.parts.map((p) => [p.id, p]));
  for (let c = 0; c < 6; c++) {
    let y = 40;
    for (const id of columns[c]!) {
      const pp = byPart.get(id)!;
      const g = geometry.get(id)!;
      const ts = partTerms.get(id) ?? [];
      const left = ts.filter((t) => sideOf(t) === 'left');
      const right = ts.filter((t) => sideOf(t) === 'right');
      const rows = Math.max(left.length, right.length, 1);
      const h = HEAD_H + rows * ROW_H + 8;
      const moved = !!pp.schematic;
      const bx = pp.schematic?.x ?? colX[c]!;
      const by = pp.schematic?.y ?? y;
      const mk = (t: TerminalInfo, i: number, side: 'left' | 'right'): SchemPin => ({
        key: t.key,
        label: t.pin ? `${t.connector!.id === 'T' || t.connector!.id === 'PWR' ? '' : `${t.connector!.id} `}${t.pin.number}` : t.port!.id,
        side,
        x: side === 'left' ? bx : bx + BLOCK_W,
        y: by + HEAD_H + i * ROW_H + ROW_H / 2,
        net: netOfKey.get(t.key) ?? null,
        kind: t.kind,
        signal: t.pin?.signal ?? t.port?.kind ?? 'other',
      });
      blocks.push({
        partId: id,
        label: partLabel(pp, g),
        sub: pp.label ? g.part.model : g.part.maker === 'Generic' ? '' : g.part.maker,
        col: c,
        x: bx,
        y: by,
        w: BLOCK_W,
        h,
        offPanel: !!g.part.offPanel,
        symbol: symbolOf(g.part),
        moved,
        pins: [...left.map((t, i) => mk(t, i, 'left')), ...right.map((t, i) => mk(t, i, 'right'))],
      });
      if (!moved) y += h + GAP_Y;
    }
  }

  // ---- wires
  const pinAt = new Map<string, { pin: SchemPin; block: SchemBlock }>();
  for (const b of blocks) for (const p of b.pins) pinAt.set(p.key, { pin: p, block: b });
  const out: SchemWire[] = [];
  const labels: SchemLabel[] = [];
  const grounds: SchemGround[] = [];
  const groundDone = new Set<string>();
  // The channel left of each column: from the previous non-empty column's right edge to this
  // column's left edge. Every wire in a channel gets its own track.
  const occupied = columns.map((c) => c.length > 0);
  const channelLeftOf = (c: number): [number, number] => {
    let p = c - 1;
    while (p >= 0 && !occupied[p]) p--;
    const lo = p >= 0 ? colX[p]! + BLOCK_W + 12 : colX[c]! - CHANNEL_MIN;
    return [lo, colX[c]! - 12];
  };
  const nextOccupied = (c: number) => {
    let n = c + 1;
    while (n < 6 && !occupied[n]) n++;
    return n;
  };
  // Tracks per channel, assigned so that vertical runs never overlap.
  const channels = new Map<string, { lo: number; hi: number; x: number }[]>();
  const track = (channelKey: string, x0: number, x1: number, lo: number, hi: number): number => {
    const used = channels.get(channelKey) ?? [];
    const width = Math.max(1, x1 - x0);
    const n = Math.max(1, Math.floor(width / TRACK) - 2);
    for (let k = 0; k < n; k++) {
      // Spread from the middle outwards.
      const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * TRACK;
      const tx = Math.round((x0 + x1) / 2 + off);
      if (used.some((u) => Math.abs(u.x - tx) < 1 && !(hi < u.lo - 4 || lo > u.hi + 4))) continue;
      used.push({ lo, hi, x: tx });
      channels.set(channelKey, used);
      return tx;
    }
    return Math.round((x0 + x1) / 2);
  };

  for (const w of wires) {
    const a = pinAt.get(keyOf(w.from));
    const b = pinAt.get(keyOf(w.to));
    if (!a || !b) continue;
    const net = netOfKey.get(keyOf(w.from));
    const type = net?.type ?? 'other';
    if (type === 'ground') {
      for (const e of [a, b]) {
        // The battery's own negative terminal is the ground symbol's reference; draw one at each end.
        if (groundDone.has(e.pin.key)) continue;
        groundDone.add(e.pin.key);
        grounds.push({ key: e.pin.key, x: e.pin.x, y: e.pin.y, side: e.pin.side });
      }
      continue;
    }
    const ca = a.block.col;
    const cb = b.block.col;
    const adjacent = Math.abs(rankOf.get(ca)! - rankOf.get(cb)!) <= 1;
    if (!adjacent) {
      for (const [e, other] of [
        [a, b],
        [b, a],
      ] as const) {
        labels.push({ wireId: w.id, key: e.pin.key, x: e.pin.x, y: e.pin.y, side: e.pin.side, text: `${net?.name ?? 'net'} → ${other.block.label}`, netType: type });
      }
      continue;
    }
    const pa = a.pin;
    const pb = b.pin;
    let points: { x: number; y: number }[];
    if (ca === cb) {
      // Same column: both ends on one side, into that side's channel and back. Ends on
      // opposite sides would have to go round the block, so they get net labels instead.
      if (pa.side !== pb.side) {
        for (const [e, other] of [
          [a, b],
          [b, a],
        ] as const) {
          labels.push({ wireId: w.id, key: e.pin.key, x: e.pin.x, y: e.pin.y, side: e.pin.side, text: `${net?.name ?? 'net'} → ${other.block.label}`, netType: type });
        }
        continue;
      }
      const lo = Math.min(pa.y, pb.y);
      const hi = Math.max(pa.y, pb.y);
      const left = pa.side === 'left';
      const n = nextOccupied(ca);
      const [x0, x1] = left ? channelLeftOf(ca) : n < 6 ? channelLeftOf(n) : [colX[ca]! + BLOCK_W + 12, colX[ca]! + BLOCK_W + CHANNEL_MIN];
      const tx = track(`L${left ? ca : n}`, x0, x1, lo, hi);
      points = [{ x: pa.x, y: pa.y }, { x: tx, y: pa.y }, { x: tx, y: pb.y }, { x: pb.x, y: pb.y }];
      out.push({ wireId: w.id, startKey: pa.key, endKey: pb.key, netType: type, colour: w.colour, points });
      continue;
    } else {
      const [l, r] = pa.x <= pb.x ? [pa, pb] : [pb, pa];
      const [x0, x1] = channelLeftOf(Math.max(ca, cb));
      const tx = track(`L${Math.max(ca, cb)}`, Math.max(x0, l.x + 12), Math.min(x1, r.x - 12), Math.min(l.y, r.y), Math.max(l.y, r.y));
      points = [{ x: l.x, y: l.y }, { x: tx, y: l.y }, { x: tx, y: r.y }, { x: r.x, y: r.y }];
      out.push({ wireId: w.id, startKey: l.key, endKey: r.key, netType: type, colour: w.colour, points });
    }
  }

  const lastCol = occCols[occCols.length - 1];
  const width = Math.max(...blocks.map((b) => b.x + b.w), 400) + Math.max(120, lastCol === undefined ? 0 : (roomR.get(lastCol) ?? 0) + 16);
  const height = Math.max(...blocks.map((b) => b.y + b.h), 300) + 60;
  return { blocks, wires: out, labels, grounds, width, height };
}

