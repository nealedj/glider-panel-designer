/**
 * Electrical and pneumatic analysis of the wiring. See ADR 0012.
 *
 * Power paths are traced from each battery's positive terminal along wires, through
 * switches (taken as closed) and fuses or breakers, to each powered part's supply pin;
 * returns from its ground pin back to the battery's negative terminal. Each wire carries the
 * current of every load whose path uses it. From that:
 * - wires sized automatically are given the smallest chart size that carries the current,
 *   keeps their share of the voltage-drop limit, and is protected by the fuse or breaker
 *   upstream (protect the wire, not the equipment);
 * - the checks of the brief's electrical and pneumatic tables are run.
 */
import type { CheckResult } from '../checks/checks';
import { projectGeometry, type PartGeometry } from '../model/resolve';
import type { CataloguePart, Project, Wire } from '../model/schema';
import { wireLength, type WireLength } from './length';
import { chooseSize, maxProtector, ampacity, ohmsPerM, sizeLabel, type SizeChoice } from './sizing';
import { keyOf, partLabel, terminals, type TerminalInfo } from './terminals';

export interface Protector {
  partId: string;
  kind: 'fuse' | 'breaker';
  ratingA: number;
}

export interface WireCalc {
  wire: Wire;
  isTube: boolean;
  currentA: number;
  length: WireLength | null;
  /** Size in use: the automatic choice, or the user's. */
  sizeMm2: number | null;
  auto: SizeChoice | null;
  ampacityA: number;
  protector: Protector | null;
  /** Voltage drop across this wire at its current, V. */
  dropV: number;
}

export interface LoadCalc {
  partId: string;
  label: string;
  currentA: number | null;
  feed: string[];
  ret: string[];
  devices: Protector[];
  reachable: boolean;
  grounded: boolean;
  dropV: number;
}

export interface Analysis {
  terms: Map<string, TerminalInfo>;
  wires: Map<string, WireCalc>;
  loads: LoadCalc[];
  devices: Map<string, Protector & { loadA: number }>;
  totalA: number;
  capacityAh: number | null;
  results: CheckResult[];
}

type Edge = { to: string; wire?: string; device?: Protector; pass?: boolean };

const isProtector = (p: CataloguePart) => p.category === 'fuse' || p.category === 'breaker';
const isSwitch = (p: CataloguePart) => p.category === 'switch';

let last: { doc: Project; a: Analysis } | null = null;

export function analyse(doc: Project): Analysis {
  if (last && last.doc === doc) return last.a;
  const a = compute(doc);
  last = { doc, a };
  return a;
}

function compute(doc: Project): Analysis {
  const geometry = projectGeometry(doc);
  const terms = terminals(doc, geometry);
  const results: CheckResult[] = [];
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const name = (id: string) => partLabel(byId.get(id)!, geometry.get(id));

  const elWires = doc.wires.filter((w) => !('port' in w.from) && !('port' in w.to));
  const tubes = doc.wires.filter((w) => 'port' in w.from || 'port' in w.to);

  // ---- graph: wires, plus pass-through inside switches and protectors
  const adj = new Map<string, Edge[]>();
  const link = (a: string, e: Edge) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(e);
  };
  for (const w of elWires) {
    const a = keyOf(w.from);
    const b = keyOf(w.to);
    link(a, { to: b, wire: w.id });
    link(b, { to: a, wire: w.id });
  }
  const sources: string[] = [];
  const sinks: string[] = [];
  let capacityAh = 0;
  let hasBattery = false;
  for (const [id, g] of geometry) {
    const part = g.part;
    for (const c of part.connectors) {
      const keys = c.pins.map((p) => `${id}/${c.id}/${p.number}`);
      if (isProtector(part) && c.pins.length === 2) {
        const dev: Protector = { partId: id, kind: part.category === 'fuse' ? 'fuse' : 'breaker', ratingA: part.ratingA ?? 0 };
        link(keys[0]!, { to: keys[1]!, device: dev });
        link(keys[1]!, { to: keys[0]!, device: dev });
      } else if (isSwitch(part) && c.pins.length === 2 && c.pins.every((p) => p.signal === 'switch')) {
        link(keys[0]!, { to: keys[1]!, pass: true });
        link(keys[1]!, { to: keys[0]!, pass: true });
      }
      if (part.category === 'power' && part.capacityAh != null) {
        c.pins.forEach((p, i) => {
          if (p.signal === 'power' && p.direction === 'out') sources.push(keys[i]!);
          if (p.signal === 'ground') sinks.push(keys[i]!);
        });
      }
    }
    if (part.category === 'power' && part.capacityAh != null) {
      hasBattery = true;
      capacityAh += part.capacityAh;
    }
  }

  /** BFS from the given starts; parent edge for every reached terminal. */
  const bfs = (starts: string[], allow: (e: Edge) => boolean) => {
    const parent = new Map<string, { from: string; edge: Edge } | null>();
    const q = [...starts];
    for (const s of starts) parent.set(s, null);
    while (q.length) {
      const k = q.shift()!;
      for (const e of adj.get(k) ?? []) {
        if (!allow(e) || parent.has(e.to)) continue;
        parent.set(e.to, { from: k, edge: e });
        q.push(e.to);
      }
    }
    return parent;
  };
  const feedTree = bfs(sources, () => true);
  const groundTree = bfs(sinks, (e) => !!e.wire);
  const walk = (tree: ReturnType<typeof bfs>, k: string) => {
    const wires: string[] = [];
    const devices: Protector[] = [];
    let cur = k;
    for (let guard = 0; guard < 10000; guard++) {
      const p = tree.get(cur);
      if (!p) break;
      if (p.edge.wire) wires.push(p.edge.wire);
      if (p.edge.device) devices.push(p.edge.device);
      cur = p.from;
    }
    // Source to load order.
    return { wires: wires.reverse(), devices: devices.reverse() };
  };

  // ---- loads
  // Before any wire is drawn, open pins are work still to do rather than faults: one note
  // instead of an error per pin, so a front layout alone does not block the cut file.
  const wiringStarted = doc.wires.some((w) => !w.tubeBoreMm);
  const plumbingStarted = doc.wires.some((w) => !!w.tubeBoreMm);
  const toWire = new Set<string>();
  const loads: LoadCalc[] = [];
  const wireCurrent = new Map<string, number>();
  const wireLoads = new Map<string, LoadCalc[]>();
  for (const [id, g] of geometry) {
    const part = g.part;
    if (!part.power || isProtector(part) || part.category === 'power') continue;
    const supply = [...terms.values()].filter((t) => t.partId === id && t.pin?.signal === 'power' && t.pin.direction !== 'out');
    const ground = [...terms.values()].filter((t) => t.partId === id && t.pin?.signal === 'ground');
    if (!supply.length) continue;
    const reachedSupply = supply.find((t) => feedTree.has(t.key));
    const reachedGround = ground.find((t) => groundTree.has(t.key));
    const feed = reachedSupply ? walk(feedTree, reachedSupply.key) : { wires: [], devices: [] };
    const ret = reachedGround ? walk(groundTree, reachedGround.key) : { wires: [], devices: [] };
    const load: LoadCalc = { partId: id, label: name(id), currentA: part.power.currentA, feed: feed.wires, ret: ret.wires, devices: feed.devices, reachable: !!reachedSupply, grounded: !!reachedGround, dropV: 0 };
    loads.push(load);
    const I = part.power.currentA ?? 0;
    for (const w of [...feed.wires, ...ret.wires]) {
      wireCurrent.set(w, (wireCurrent.get(w) ?? 0) + I);
      if (!wireLoads.has(w)) wireLoads.set(w, []);
      wireLoads.get(w)!.push(load);
    }
    // Unconnected supply or ground pins.
    if (!wiringStarted) toWire.add(id);
    else {
      for (const t of supply) if (!adj.has(t.key)) results.push(err(`unpowered:${t.key}`, 'electrical', `${t.label}: power pin not connected`, [id]));
      for (const t of ground) if (!adj.has(t.key)) results.push(err(`ungrounded:${t.key}`, 'electrical', `${t.label}: ground pin not connected`, [id]));
    }
    if (supply.some((t) => adj.has(t.key)) && !reachedSupply && hasBattery) results.push(warn(`nopath:${id}`, 'electrical', `${name(id)}: no wired path from the battery to its power pin`, [id]));
    if (reachedSupply && !feed.devices.length) results.push(err(`nofuse:${id}`, 'electrical', `${name(id)}: the power path from the battery has no fuse or breaker`, [id]));
    if (part.power.currentA == null) results.push(warn(`current:${id}`, 'electrical', `${name(id)}: current draw unknown; sizing and voltage drop count it as 0 A`, [id]));
  }

  // ---- protectors: load and nearest upstream device per wire
  const devices = new Map<string, Protector & { loadA: number }>();
  for (const l of loads) {
    for (const d of l.devices) {
      const e = devices.get(d.partId) ?? { ...d, loadA: 0 };
      e.loadA += l.currentA ?? 0;
      devices.set(d.partId, e);
    }
  }
  const protectorOf = (wid: string): Protector | null => {
    // The device closest upstream of the wire on any load path through it; for a return wire,
    // the feed protection of the loads it carries (the largest, conservatively).
    let best: Protector | null = null;
    for (const l of wireLoads.get(wid) ?? []) {
      const iFeed = l.feed.indexOf(wid);
      let dev: Protector | null = null;
      if (iFeed >= 0) {
        // Devices are in path order; find the last one before this wire on the path.
        const path = walkWithDevices(feedTree, l, terms);
        for (const step of path) {
          if (step.wire === wid) break;
          if (step.device) dev = step.device;
        }
      } else dev = l.devices[l.devices.length - 1] ?? null;
      if (dev && (!best || dev.ratingA > best.ratingA)) best = dev;
    }
    return best;
  };

  // ---- sizes, then drops
  const calcs = new Map<string, WireCalc>();
  const lengths = new Map<string, WireLength | null>();
  for (const w of doc.wires) lengths.set(w.id, wireLength(w, doc, terms));
  const loopLen = (l: LoadCalc) => [...l.feed, ...l.ret].reduce((s, id) => s + (lengths.get(id)?.mm ?? 0), 0);
  for (const w of doc.wires) {
    const isTube = tubes.includes(w);
    const len = lengths.get(w.id) ?? null;
    const I = wireCurrent.get(w.id) ?? 0;
    const prot = isTube ? null : protectorOf(w.id);
    let auto: SizeChoice | null = null;
    let size = w.sizeMm2;
    if (!isTube && w.sizeAuto) {
      const L = len?.mm ?? 0;
      const loop = Math.max(L, ...(wireLoads.get(w.id) ?? []).map(loopLen));
      const budget = loop > 0 ? doc.settings.voltageDropLimitV * (L / loop) : doc.settings.voltageDropLimitV;
      auto = chooseSize({ currentA: I, lengthMm: L, dropBudgetV: budget, protector: prot }, doc.settings);
      size = auto.mm2;
    }
    const amp = size ? ampacity(size, doc.settings.wireTempRatingC) : 0;
    const drop = size && len ? I * ohmsPerM(size) * (len.mm / 1000) : 0;
    calcs.set(w.id, { wire: w, isTube, currentA: I, length: len, sizeMm2: isTube ? null : size, auto, ampacityA: amp, protector: prot, dropV: drop });
  }
  for (const l of loads) l.dropV = [...l.feed, ...l.ret].reduce((s, id) => s + (calcs.get(id)?.dropV ?? 0), 0);

  // ---- checks on wires and devices
  for (const c of calcs.values()) {
    if (c.isTube) continue;
    const label = c.wire.label || c.wire.id;
    if (c.sizeMm2 && c.currentA > c.ampacityA + 1e-9)
      results.push(err(`ampacity:${c.wire.id}`, 'electrical', `${label}: ${c.currentA.toFixed(2)} A is over the ${c.ampacityA} A rating of ${sizeLabel(c.sizeMm2)}`, [c.wire.id]));
    if (c.sizeMm2 && c.protector && c.protector.ratingA > maxProtector(c.sizeMm2, c.protector.kind))
      results.push(
        err(
          `protect:${c.wire.id}`,
          'electrical',
          `${label}: ${sizeLabel(c.sizeMm2)} is rated below its ${c.protector.ratingA} A ${c.protector.kind} (${name(c.protector.partId)}); use a larger wire or a smaller ${c.protector.kind}`,
          [c.wire.id, c.protector.partId],
        ),
      );
    if (c.auto && !c.auto.ok) results.push(err(`size:${c.wire.id}`, 'electrical', `${label}: no wire on the chart meets the load, length and protection`, [c.wire.id]));
    const bothOff = terms.get(keyOf(c.wire.from))?.offPanel && terms.get(keyOf(c.wire.to))?.offPanel;
    // A battery-to-main-fuse link beyond the panel is the one unprotected run expected.
    if (!c.protector && !bothOff && c.currentA > 0 && (wireLoads.get(c.wire.id) ?? []).some((l) => l.feed.includes(c.wire.id)))
      results.push(warn(`unprotected:${c.wire.id}`, 'electrical', `${label}: runs from the battery with no fuse or breaker before it; a fault on it would not be cleared`, [c.wire.id]));
  }
  for (const d of devices.values()) {
    if (d.ratingA && d.loadA > doc.settings.protectorDerating * d.ratingA)
      results.push(warn(`derate:${d.partId}`, 'electrical', `${name(d.partId)}: ${d.loadA.toFixed(2)} A load is over ${Math.round(doc.settings.protectorDerating * 100)} % of its ${d.ratingA} A rating`, [d.partId]));
  }
  for (const l of loads) {
    if (l.reachable && l.grounded && l.dropV > doc.settings.voltageDropLimitV)
      results.push(warn(`drop:${l.partId}`, 'electrical', `${l.label}: ${l.dropV.toFixed(2)} V drop from the battery and back, over the ${doc.settings.voltageDropLimitV} V limit`, [l.partId, ...l.feed, ...l.ret]));
  }

  // ---- incompatible pins on a net
  for (const n of doc.nets) {
    const infos = n.members.map((m) => terms.get(keyOf(m))).filter((t): t is TerminalInfo => !!t);
    const pins = infos.filter((t) => t.pin);
    const sig = new Set(pins.map((t) => t.pin!.signal));
    const ids = [...new Set(infos.map((t) => t.partId))];
    if (sig.has('power') && sig.has('ground')) results.push(err(`short:${n.id}`, 'electrical', `${n.name}: power joined to ground (a short circuit)`, ids));
    const clash = [...sig].filter((s) => s !== 'switch' && s !== 'other');
    const kinds = new Set(clash.map((s) => (s === 'bus' ? 'serial' : s)).filter((s) => s !== 'ground'));
    if (kinds.size > 1 && !(kinds.size === 2 && kinds.has('power') && sig.has('ground')))
      results.push(err(`mix:${n.id}`, 'electrical', `${n.name}: joins incompatible pins (${[...kinds].join(' and ')})`, ids));
    const tx = pins.filter((t) => t.pin!.signal === 'serial' && t.pin!.direction === 'out');
    if (tx.length > 1) results.push(err(`txtx:${n.id}`, 'electrical', `${n.name}: two outputs joined (${tx.map((t) => t.label).join(', ')}); TX goes to RX`, ids));
    const rx = pins.filter((t) => t.pin!.signal === 'serial' && t.pin!.direction === 'in');
    if (rx.length && !tx.length && pins.length > 1) results.push(warn(`rxrx:${n.id}`, 'electrical', `${n.name}: inputs joined with no output (${rx.map((t) => t.label).join(', ')})`, ids));
    // Pneumatic: a tube line must carry one kind of pressure.
    const portKinds = new Set(infos.map((t) => t.port?.kind).filter((k) => k && k !== 'any'));
    if (portKinds.size > 1) results.push(err(`pmix:${n.id}`, 'pneumatic', `${n.name}: joins ${[...portKinds].join(' and ')} ports`, ids));
    if (infos.some((t) => t.port) && pins.length) results.push(err(`ptube:${n.id}`, 'pneumatic', `${n.name}: joins a tube to an electrical pin`, ids));
  }

  // ---- pneumatic ports left open
  const connected = new Set(doc.wires.flatMap((w) => [keyOf(w.from), keyOf(w.to)]));
  const toPlumb = new Set<string>();
  for (const t of terms.values()) {
    if (t.kind !== 'port' || t.offPanel || connected.has(t.key)) continue;
    const g = geometry.get(t.partId) as PartGeometry;
    if (g.part.category === 'pneumatic') continue;
    if (!plumbingStarted) toPlumb.add(t.partId);
    else results.push(warn(`port:${t.key}`, 'pneumatic', `${t.label} (${t.port!.kind}) is not connected`, [t.partId]));
  }
  const plural = (n: number) => `${n} part${n === 1 ? '' : 's'}`;
  if (toWire.size) results.push(info('wiring:todo', 'electrical', `Wiring not started: ${plural(toWire.size)} with power pins to connect (Wire tool, W)`, [...toWire]));
  if (toPlumb.size) results.push(info('tubing:todo', 'pneumatic', `Tubing not started: ${plural(toPlumb.size)} with pressure ports to connect (Wire tool, W)`, [...toPlumb]));

  // ---- lengths and endurance
  const est = [...calcs.values()].filter((c) => c.length?.estimated);
  if (est.length) results.push(info('length:estimated', 'electrical', `${est.length} wire${est.length === 1 ? '' : 's'} not on a route; ${est.length === 1 ? 'its length is' : 'their lengths are'} straight-line estimates`, est.map((c) => c.wire.id)));
  const offMissing = [...calcs.values()].filter((c) => c.length?.missingOffPanel);
  if (offMissing.length) results.push(info('length:offpanel', 'electrical', `Off-panel run not set for ${offMissing.length} wire${offMissing.length === 1 ? '' : 's'}; set it on the off-panel part`, offMissing.map((c) => c.wire.id)));
  const totalA = loads.reduce((s, l) => s + (l.currentA ?? 0), 0);
  if (hasBattery && totalA > 0)
    results.push(info('endurance', 'electrical', `Total draw ${totalA.toFixed(2)} A: about ${(capacityAh / totalA).toFixed(1)} h from ${capacityAh} Ah (nominal capacity, new battery, all loads on)`, []));
  if (!hasBattery && loads.length && elWires.length) results.push(info('battery', 'electrical', 'No battery in the project; power paths and wire currents start from a battery', []));

  return { terms, wires: calcs, loads, devices, totalA, capacityAh: hasBattery ? capacityAh : null, results };
}

/** The feed path of a load, as steps carrying a wire or a device, source first. */
function walkWithDevices(tree: Map<string, { from: string; edge: Edge } | null>, l: LoadCalc, terms: Map<string, TerminalInfo>): Edge[] {
  const start = [...terms.values()].find((t) => t.partId === l.partId && t.pin?.signal === 'power' && t.pin.direction !== 'out' && tree.has(t.key));
  const steps: Edge[] = [];
  let cur = start?.key;
  while (cur) {
    const p = tree.get(cur);
    if (!p) break;
    steps.push(p.edge);
    cur = p.from;
  }
  return steps.reverse();
}

const mk = (severity: CheckResult['severity']) => (key: string, area: CheckResult['area'], message: string, ids: string[]): CheckResult => ({ key, severity, area, message, ids });
const err = mk('error');
const warn = mk('warning');
const info = mk('info');
