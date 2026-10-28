import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/checks';
import { projectGeometry } from '../src/model/resolve';
import { Project, type Terminal } from '../src/model/schema';
import { applyOps } from '../src/store/doc';
import { analyse } from '../src/wiring/circuit';
import { routeLength, wireLength } from '../src/wiring/length';
import { connectOps, removeWiresOps, withConnections } from '../src/wiring/ops';
import { labelWidth, layoutSchematic } from '../src/wiring/schematic';
import { ampacity, chartRow, chooseSize, maxProtector, ohmsPerM, sizeLabel } from '../src/wiring/sizing';
import { keyOf, terminals } from '../src/wiring/terminals';

const root = join(__dirname, '..', '..');
const load = () => Project.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'projects', 'wiring-sample.json'), 'utf8')));
const sample = load();
const pin = (p: string, c: string, n: string): Terminal => ({ part: p, connector: c, pin: n });
const port = (p: string, n: string): Terminal => ({ part: p, port: n });
const keys = (d: Project) => runChecks({ ...d }, projectGeometry({ ...d })).map((r) => r.key);
const settings = { wireTempRatingC: 105 as const, minWireAwg: 22 };

describe('AC 43.13-1B charts', () => {
  it('rates chart sizes and metric sizes conservatively', () => {
    // AWG 20 is 1,216 circular mils = 0.616 mm².
    expect(sizeLabel(0.616)).toBe('0.62 mm² (AWG 20)');
    expect(ampacity(0.616, 105)).toBe(4);
    expect(ampacity(0.616, 150)).toBe(7);
    // 0.5 mm² is between AWG 22 (0.383) and AWG 20 (0.616): rated as AWG 22.
    expect(chartRow(0.5)!.awg).toBe('22');
    expect(sizeLabel(0.5)).toBe('0.50 mm² (rated as AWG 22)');
    expect(ohmsPerM(0.383)).toBeCloseTo(16.2 / 304.8, 6);
    expect(maxProtector(0.383, 'fuse')).toBe(5);
    expect(maxProtector(1.229, 'breaker')).toBe(15);
    expect(maxProtector(0.2, 'fuse')).toBe(0);
  });

  it('chooses the smallest wire that carries, protects and keeps the drop', () => {
    expect(chooseSize({ currentA: 0.5, lengthMm: 1000, dropBudgetV: 0.5 }, settings)).toMatchObject({ awg: '22', reason: 'minimum' });
    expect(chooseSize({ currentA: 5, lengthMm: 500, dropBudgetV: 0.5 }, settings)).toMatchObject({ awg: '18', reason: 'current' });
    // A 10 A breaker needs AWG 18 (table 11-3), though 1 A would fit AWG 22.
    expect(chooseSize({ currentA: 1, lengthMm: 500, dropBudgetV: 0.5, protector: { kind: 'breaker', ratingA: 10 } }, settings)).toMatchObject({ awg: '18', reason: 'protection' });
    // 3 A over 3 m in AWG 22 drops 3 × 0.0531 × 3 = 0.48 V; with a 0.25 V budget it must grow.
    const c = chooseSize({ currentA: 3, lengthMm: 3000, dropBudgetV: 0.25 }, settings);
    expect(c.reason).toBe('voltage drop');
    expect(3 * ohmsPerM(c.mm2) * 3).toBeLessThanOrEqual(0.25);
  });
});

describe('connecting', () => {
  it('builds nets by type, with tees joining their tubes', () => {
    const byType = (t: string) => sample.nets.filter((n) => n.type === t);
    expect(byType('pitot')).toHaveLength(1);
    expect(byType('pitot')[0]!.members).toHaveLength(6);
    expect(byType('static')[0]!.members).toHaveLength(10);
    expect(byType('te')).toHaveLength(1);
    expect(byType('data')).toHaveLength(4);
    expect(new Set(sample.nets.map((n) => n.name)).size).toBe(sample.nets.length);
    const vario = sample.wires.find((w) => keyOf(w.to) === 'vario/PWR/+')!;
    expect(vario.colour).toBe('red');
    expect(sample.wires.find((w) => keyOf(w.from) === 'te//TE')!.label).toBe('T01');
  });

  it('refuses pin to port, repeats and self-loops', () => {
    expect(connectOps(sample, pin('vario', 'PWR', '+'), port('asi', 'P')).error).toMatch(/tube joins ports/);
    expect(connectOps(sample, pin('f1', 'T', 'LOAD'), pin('vario', 'PWR', '+')).error).toMatch(/already connected/);
    expect(connectOps(sample, pin('vario', 'PWR', '+'), pin('vario', 'PWR', '+')).error).toBeTruthy();
  });

  it('splits and renames nets when wires go, keeping the bigger piece', () => {
    const w = sample.wires.find((x) => keyOf(x.from) === 'f2/T/LINE' && keyOf(x.to) === 'f3/T/LINE')!;
    const before = sample.nets.find((n) => n.id === w.net)!;
    const d = applyOps(sample, removeWiresOps(sample, new Set([w.id])))[0];
    expect(d.nets.length).toBe(sample.nets.length + 1);
    expect(d.nets.find((n) => n.id === before.id)!.members.length).toBeGreaterThan(1);
  });
});

describe('electrical checks', () => {
  it('the sample panel is clean', () => {
    const errs = runChecks(sample, projectGeometry(sample)).filter((r) => r.area === 'electrical' || r.area === 'pneumatic');
    expect(errs.filter((r) => r.severity !== 'info')).toEqual([]);
    const a = analyse(sample);
    expect(a.totalA).toBeCloseTo(1.05, 6);
    expect(a.loads.every((l) => l.devices.length === 2 && l.dropV < 0.5)).toBe(true);
  });

  it('flags a power path with no fuse', () => {
    // Bypass F1: the vario fed straight from the bus.
    const w = sample.wires.find((x) => keyOf(x.to) === 'vario/PWR/+')!;
    let d = applyOps(sample, removeWiresOps(sample, new Set([w.id])))[0];
    d = withConnections(d, [[pin('ms', 'T', '2'), pin('vario', 'PWR', '+')]]);
    // Still behind the main fuse F0: add one more load straight off the battery.
    expect(keys(d)).not.toContain('nofuse:vario');
    const d2 = applyOps(d, removeWiresOps(d, new Set(d.wires.filter((x) => keyOf(x.to) === 'f0/T/LINE').map((x) => x.id))))[0];
    const d3 = withConnections(d2, [[pin('bat', 'T', '+'), pin('ms', 'T', '1')]]);
    expect(keys(d3)).toContain('nofuse:vario');
  });

  it('flags a wire too small for its fuse, and a fuse loaded past its derating', () => {
    const d = { ...sample, parts: sample.parts.map((p) => (p.id === 'f4' ? { ...p, params: { ratingA: 15 } } : p)) };
    // Automatic sizing grows the wire to suit a 15 A fuse (AWG 14)…
    const w = sample.wires.find((x) => keyOf(x.to) === 'radio/PWR/+')!;
    expect(analyse(d).wires.get(w.id)!.auto!.awg).toBe('14');
    // …but a wire the user fixed at AWG 22 is now under-protected.
    const fixed = { ...d, wires: d.wires.map((x) => (x.id === w.id ? { ...x, sizeAuto: false, sizeMm2: 0.383 } : x)) };
    expect(keys(fixed)).toContain(`protect:${w.id}`);
    const heavy = { ...sample, parts: sample.parts.map((p) => (p.id === 'radio' ? { ...p, params: { currentA: 4.5 } } : p)) };
    expect(keys(heavy)).toContain('derate:f4');
  });

  it('flags voltage drop over the limit on a long thin run', () => {
    // Automatic sizing would grow the wires to fit; with sizes fixed at AWG 22 the drop shows.
    const d = { ...sample, settings: { ...sample.settings, voltageDropLimitV: 0.1 }, wires: sample.wires.map((w) => (w.sizeAuto ? { ...w, sizeAuto: false, sizeMm2: 0.383 } : w)) };
    expect(keys(d).filter((k) => k.startsWith('drop:')).length).toBeGreaterThan(0);
  });

  it('flags shorts, mixed signals, TX to TX and open pins', () => {
    const short = withConnections(sample, [[pin('f1', 'T', 'LOAD'), pin('fc', 'PWR', 'GND')]]);
    expect(keys(short).some((k) => k.startsWith('short:'))).toBe(true);
    const txtx = withConnections(sample, [[pin('vario', 'DATA', 'TX'), pin('fc', 'DATA', 'TX')]]);
    expect(keys(txtx).some((k) => k.startsWith('txtx:'))).toBe(true);
    const mixed = withConnections(sample, [[pin('radio', 'AUD', 'SPK+'), pin('vario', 'DATA', 'RX')]]);
    expect(keys(mixed).some((k) => k.startsWith('mix:'))).toBe(true);
    const gnd = sample.wires.find((x) => keyOf(x.from) === 'fc/PWR/GND')!;
    const open = applyOps(sample, removeWiresOps(sample, new Set([gnd.id])))[0];
    expect(keys(open)).toContain('ungrounded:fc/PWR/GND');
  });
});

describe('pneumatic checks', () => {
  it('flags open instrument ports and mixed lines', () => {
    const w = sample.wires.find((x) => keyOf(x.to) === 'alt//S')!;
    const open = applyOps(sample, removeWiresOps(sample, new Set([w.id])))[0];
    expect(keys(open)).toContain('port:alt//S');
    const mixed = withConnections(sample, [[port('asi', 'P'), port('alt', 'S')]]);
    expect(keys(mixed).some((k) => k.startsWith('pmix:'))).toBe(true);
  });
});

describe('lengths', () => {
  it('match a route measured by hand to well under 5 mm', () => {
    const terms = terminals(sample, projectGeometry(sample));
    // F0 → master switch, on the main loom.
    const w = sample.wires.find((x) => keyOf(x.from) === 'f0/T/LOAD')!;
    // By hand: F0's exit is the loom's first point (-140, -95, 130), so it joins the loom at
    // once. The switch's tag is at (-130, -85), 30 mm deep. The nearest loom point is on the
    // first leg, (-140, -85, 130): 10 mm along the loom, then √(10² + 100²) = 100.50 mm to the
    // tag. Plus F0's run beyond the exit (1,450 mm) and two 50 mm end allowances.
    const byHand = 0 + 10 + Math.sqrt(10 * 10 + 100 * 100) + 1450 + 100;
    expect(Math.abs(wireLength(w, sample, terms)!.mm - byHand)).toBeLessThan(0.01);
    const loom = sample.routes[0]!;
    expect(routeLength(loom)).toBeCloseTo(20 + 260 + 135, 6);
  });

  it('estimates a straight line when a wire has no route', () => {
    const terms = terminals(sample, projectGeometry(sample));
    const w = sample.wires.find((x) => keyOf(x.from) === 'flarm/P1/TX')!;
    const l = wireLength(w, sample, terms)!;
    expect(l.estimated).toBe(true);
    const a = terms.get('flarm/P1/TX')!.pos;
    const b = terms.get('vario/DATA/RX')!.pos;
    expect(l.mm).toBeCloseTo(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + 100, 6);
  });
});

describe('schematic layout', () => {
  const g = projectGeometry(sample);
  const s = layoutSchematic(sample, g, terminals(sample, g));

  it('puts power flow left to right', () => {
    const col = (id: string) => s.blocks.find((b) => b.partId === id)!.col;
    expect(col('bat')).toBe(0);
    expect(col('ms')).toBe(1);
    expect(col('f1')).toBe(2);
    expect(col('vario')).toBe(3);
    expect(col('spk')).toBe(5);
  });
});

const pik20d = Project.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'projects', 'pik20d.json'), 'utf8')));

describe.each([
  ['the wiring sample', sample],
  ['the PIK-20D example', pik20d],
])('schematic of %s', (_name, doc) => {
  const g = projectGeometry(doc);
  const s = layoutSchematic(doc, g, terminals(doc, g));

  it('reads without tidying: no overlapping blocks, no line through a block, no shared track, labels clear', () => {
    for (const a of s.blocks) for (const b of s.blocks) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    const segs = s.wires.flatMap((w) => w.points.slice(1).map((p, i) => ({ a: w.points[i]!, b: p, id: w.wireId })));
    for (const sg of segs) {
      for (const bl of s.blocks) {
        // Interior of the block, shrunk by 1 so lines ending at a pin on its edge are fine.
        const ix0 = bl.x + 1, ix1 = bl.x + bl.w - 1, iy0 = bl.y + 1, iy1 = bl.y + bl.h - 1;
        const xlo = Math.min(sg.a.x, sg.b.x), xhi = Math.max(sg.a.x, sg.b.x), ylo = Math.min(sg.a.y, sg.b.y), yhi = Math.max(sg.a.y, sg.b.y);
        expect(xhi <= ix0 || xlo >= ix1 || yhi <= iy0 || ylo >= iy1, `${sg.id} crosses ${bl.label}`).toBe(true);
      }
    }
    // Vertical runs of different wires never share a track where they overlap.
    const verts = segs.filter((g) => Math.abs(g.a.x - g.b.x) < 1e-9 && Math.abs(g.a.y - g.b.y) > 1e-9);
    for (const a of verts)
      for (const b of verts) {
        if (a === b || a.id === b.id || Math.abs(a.a.x - b.a.x) > 0.5) continue;
        const overlap = Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y));
        expect(overlap, `${a.id} and ${b.id} share a track`).toBeLessThanOrEqual(0);
      }
    // Net labels: each text box, beside its pin, clear of every block and of other labels.
    const boxes = s.labels.map((l) => {
      const w = labelWidth(l.text);
      return { l, x0: l.side === 'left' ? l.x - w : l.x, x1: l.side === 'left' ? l.x : l.x + w, y0: l.y - 6, y1: l.y + 6 };
    });
    for (const b of boxes) {
      for (const bl of s.blocks) {
        // The leader starts on the block edge; shrink by 1 so touching the edge is fine.
        const clear = b.x1 <= bl.x + 1 || b.x0 >= bl.x + bl.w - 1 || b.y1 <= bl.y || b.y0 >= bl.y + bl.h;
        expect(clear, `label “${b.l.text}” over ${bl.label}`).toBe(true);
      }
      for (const o of boxes) {
        if (o === b || o.l.wireId === b.l.wireId) continue;
        const clear = b.x1 <= o.x0 || o.x1 <= b.x0 || b.y1 <= o.y0 || o.y1 <= b.y0;
        expect(clear, `labels “${b.l.text}” and “${o.l.text}” overlap`).toBe(true);
      }
    }
    // Every wire is drawn, labelled at both ends, or a ground symbol.
    const shown = new Set([...s.wires.map((w) => w.wireId), ...s.labels.map((l) => l.wireId)]);
    const grounds = new Set(s.grounds.map((g) => g.key));
    for (const w of doc.wires) expect(shown.has(w.id) || (grounds.has(keyOf(w.from)) && grounds.has(keyOf(w.to))), w.label).toBe(true);
  });
});

describe('wiring exports', () => {
  it('wire list CSV has a row per wire and tube, with lengths and sizes', async () => {
    const { wireListCsv, WIRE_LIST_COLUMNS } = await import('../src/export/wiring');
    const lines = wireListCsv(sample).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(WIRE_LIST_COLUMNS.join(','));
    expect(lines).toHaveLength(sample.wires.length + 1);
    const w2 = lines.find((l) => l.startsWith('W002,'))!;
    expect(w2).toContain(',F0 Main,T,LOAD,Master,T,1,0.383,22,,red,');
    expect(w2).toContain(',route,Main loom,1.05,');
    expect(lines.find((l) => l.startsWith('T01,'))).toContain(',4,blue tube,');
  });

  it('labels: two per wire, each page the label size', async () => {
    const { wireLabelsPdf } = await import('../src/export/wiring');
    const { parsePdf } = await import('./export-parse');
    const pdf = parsePdf(wireLabelsPdf(sample));
    expect(pdf.xrefOk).toBe(true);
    expect(pdf.pages).toHaveLength(sample.wires.length * 2);
    expect(pdf.pages[0]!.mediaBox[2]! / (72 / 25.4)).toBeCloseTo(40, 3);
    expect(pdf.pages[0]!.mediaBox[3]! / (72 / 25.4)).toBeCloseTo(12, 3);
    expect(pdf.pages[0]!.texts[0]).toBe('P01');
  });

  it('wiring diagram SVG and PDF show every block, with the stamp', async () => {
    const { wiringSvg, wiringPdf, wireListPdf } = await import('../src/export/wiring');
    const { parsePdf } = await import('./export-parse');
    const svg = wiringSvg(sample);
    for (const l of ['Battery', 'F0 Main', 'Master', 'Vario', 'FLARM', 'Flight computer', 'Pitot tee']) expect(svg).toContain(`>${l}<`);
    expect(svg).toContain('PLANNING AID');
    const pdf = parsePdf(wiringPdf(sample));
    expect(pdf.xrefOk).toBe(true);
    expect(pdf.pages[0]!.texts.join('\n')).toContain('Wiring diagram: Wiring sample panel');
    expect(parsePdf(wireListPdf(sample)).pages[0]!.texts).toContain('W001');
  });
});
