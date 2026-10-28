/**
 * Nets: the sets of terminals joined by wires (or tubes). They are worked out from the
 * wires after every change, keeping each net's id, name and protection where it survives,
 * so the user's names stick. Defaults for new wires (colour, label, tube bore) by net type.
 */
import type { Net, Project, Terminal, Wire } from '../model/schema';
import { newId, ops, type Op } from '../store/doc';
import { keyOf, type TerminalInfo } from './terminals';

export type NetType = Net['type'];

export function netType(infos: TerminalInfo[]): NetType {
  const kinds = new Set(infos.map((t) => t.port?.kind).filter((k): k is 'pitot' | 'static' | 'te' => !!k && k !== 'any'));
  if (infos.some((t) => t.kind === 'port')) return kinds.size === 1 ? [...kinds][0]! : kinds.size ? 'other' : 'other';
  const sig = new Set(infos.map((t) => t.pin?.signal));
  if (sig.has('power')) return 'power';
  if (sig.has('serial') || sig.has('bus')) return 'data';
  if (sig.has('audio')) return 'audio';
  if (sig.has('rf')) return 'rf';
  if (sig.has('ground')) return 'ground';
  if (sig.has('switch')) return 'switch';
  return 'other';
}

/** Default wire colours by net type; data links each get their own. Editable per wire. */
export const DATA_COLOURS = ['blue', 'white', 'orange', 'violet', 'grey', 'yellow', 'brown', 'green', 'pink'];
export const COLOUR_BY_TYPE: Record<NetType, string> = {
  power: 'red',
  ground: 'black',
  data: 'blue',
  audio: 'shielded pair',
  rf: 'coax',
  switch: 'white',
  pitot: 'green tube',
  static: 'clear tube',
  te: 'blue tube',
  other: 'grey',
};

/** CSS colours for drawing. */
export const CSS_COLOUR: Record<string, string> = {
  red: '#d32f2f',
  black: '#222222',
  blue: '#1e6fd9',
  white: '#e8e8e8',
  orange: '#ef7d00',
  violet: '#7b3fbf',
  grey: '#8a8f96',
  yellow: '#e3c000',
  brown: '#7a4b23',
  green: '#2e9b4a',
  pink: '#e05aa6',
  'shielded pair': '#9aa3ad',
  coax: '#5d4037',
  'green tube': '#2e9b4a',
  'clear tube': '#7fb8d8',
  'blue tube': '#1e6fd9',
};

export const cssColour = (c: string) => CSS_COLOUR[c] ?? c;

/** Tube bore by default, mm (placeholder until the real tubing is chosen). */
export const DEFAULT_TUBE_BORE_MM = 4;

const PREFIX: Record<NetType, string> = { power: 'PWR', ground: 'GND', data: 'DATA', audio: 'AUD', rf: 'RF', switch: 'SW', pitot: 'PITOT', static: 'STATIC', te: 'TE', other: 'NET' };

/** Next wire label: W001… for wires; P01, S01, T01 for pitot, static and TE tubes. */
export function nextLabel(doc: Pick<Project, 'wires'>, type: NetType): string {
  const pre = type === 'pitot' ? 'P' : type === 'static' ? 'S' : type === 'te' ? 'T' : 'W';
  const width = pre === 'W' ? 3 : 2;
  let n = 0;
  for (const w of doc.wires) {
    const m = new RegExp(`^${pre}(\\d+)$`).exec(w.label);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${pre}${String(n + 1).padStart(width, '0')}`;
}

/** Connected components of terminals over wires, and through tube tees (their ports are one space). */
function components(wires: Wire[], terms?: Map<string, TerminalInfo>): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (x: string, y: string) => {
    for (const k of [x, y]) if (!parent.has(k)) parent.set(k, k);
    const a = find(x);
    const b = find(y);
    if (a !== b) parent.set(a, b);
  };
  for (const w of wires) union(keyOf(w.from), keyOf(w.to));
  // Tees: every 'any' port of a part is the same pressure, so a tee joins its tubes.
  if (terms) {
    const used = new Set(parent.keys());
    const byPart = new Map<string, string[]>();
    for (const t of terms.values()) if (t.port?.kind === 'any' && used.has(t.key)) byPart.set(t.partId, [...(byPart.get(t.partId) ?? []), t.key]);
    for (const keys of byPart.values()) for (let i = 1; i < keys.length; i++) union(keys[0]!, keys[i]!);
  }
  const out = new Map<string, Set<string>>();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!out.has(r)) out.set(r, new Set());
    out.get(r)!.add(k);
  }
  return out;
}

/**
 * The nets for a set of wires, reusing existing nets where their terminals carry over, and
 * the ops that bring the document there (nets inserted, replaced or removed; wires re-pointed).
 */
export function netOps(doc: Project, wires: Wire[], terms: Map<string, TerminalInfo>): { ops: Op[]; netOf: Map<string, string>; nets: Net[] } {
  const comps = [...components(wires, terms).values()];
  const old = doc.nets.map((n) => ({ net: n, keys: new Set(n.members.map(keyOf)) }));
  const used = new Set<string>();
  const result: Net[] = [];
  const counters: Partial<Record<NetType, number>> = {};
  for (const n of doc.nets) {
    const m = /^([A-Z]+)(?: (\d+))?$/.exec(n.name);
    if (m) for (const [t, p] of Object.entries(PREFIX)) if (p === m[1]) counters[t as NetType] = Math.max(counters[t as NetType] ?? 0, Number(m[2] ?? 1));
  }
  // Largest components first, so the biggest piece of a split net keeps its name.
  comps.sort((a, b) => b.size - a.size);
  for (const keys of comps) {
    const infos = [...keys].map((k) => terms.get(k)).filter((t): t is TerminalInfo => !!t);
    const type = netType(infos);
    let best: (typeof old)[number] | null = null;
    let overlap = 0;
    for (const o of old) {
      if (used.has(o.net.id)) continue;
      let c = 0;
      for (const k of keys) if (o.keys.has(k)) c++;
      if (c > overlap) [best, overlap] = [o, c];
    }
    const members: Terminal[] = infos.map((t) => t.terminal);
    if (best) {
      used.add(best.net.id);
      result.push({ ...best.net, type, members });
    } else {
      const n = (counters[type] ?? 0) + 1;
      counters[type] = n;
      const singular = type === 'ground' || type === 'pitot' || type === 'static' || type === 'te';
      result.push({ id: newId('n'), name: singular && n === 1 ? PREFIX[type] : `${PREFIX[type]} ${n}`, type, members, protection: null });
    }
  }
  const list: Op[] = [];
  const resultIds = new Set(result.map((n) => n.id));
  for (const n of doc.nets) if (!resultIds.has(n.id)) list.push(ops.remove('nets', n.id));
  for (const n of result) {
    const before = doc.nets.find((x) => x.id === n.id);
    if (!before) list.push(ops.insert('nets', n));
    else if (JSON.stringify(before) !== JSON.stringify(n)) list.push(ops.replace('nets', n));
  }
  // Point each wire at its net.
  const netOf = new Map<string, string>();
  for (const n of result) for (const m of n.members) netOf.set(keyOf(m), n.id);
  for (const w of wires) {
    const net = netOf.get(keyOf(w.from))!;
    // Wires not yet in the document are inserted by the caller with the right net.
    const inDoc = doc.wires.find((x) => x.id === w.id);
    if (inDoc && inDoc.net !== net) list.push(ops.replace('wires', { ...w, net }));
  }
  return { ops: list, netOf, nets: result };
}
