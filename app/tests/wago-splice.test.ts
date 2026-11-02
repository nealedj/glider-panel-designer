/**
 * WAGO 221 lever splicing connectors: catalogue parts whose clamping units are joined inside,
 * like a bus bar (ADR 0017), with housing sizes as printed (ADR 0016).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/checks';
import { projectGeometry } from '../src/model/resolve';
import { CataloguePart, Project, type PlacedPart, type Terminal } from '../src/model/schema';
import { applyOps, ops } from '../src/store/doc';
import { analyse } from '../src/wiring/circuit';
import { removeWiresOps, withConnections } from '../src/wiring/ops';
import { keyOf } from '../src/wiring/terminals';

const root = join(__dirname, '..', '..');
const part = (id: string) => CataloguePart.parse(JSON.parse(readFileSync(join(root, 'catalogue', 'parts', `${id}.json`), 'utf8')));
const sample = Project.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'projects', 'wiring-sample.json'), 'utf8')));
const pin = (p: string, c: string, n: string): Terminal => ({ part: p, connector: c, pin: n });

describe('WAGO 221 splicing connectors', () => {
  it.each([
    ['wago.221-412', 2, [13.1, 8.3, 18.6]],
    ['wago.221-413', 3, [18.8, 8.4, 18.6]],
    ['wago.221-415', 5, [30, 8.4, 18.6]],
    ['wago.221-420', 10, [29.8, 15.8, 18.3]],
  ])('%s has %i clamping units joined inside, and its printed housing', (id, n, box) => {
    const p = part(id);
    expect(p.bus).toBe(true);
    expect(p.connectors).toHaveLength(1);
    expect(p.connectors[0]!.pins.map((x) => x.number)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
    expect(p.rear.box).toEqual(box);
    expect(p.front.cutouts).toEqual([]);
    expect(p.sources['rear.box']!.url).toMatch(/^https:\/\/www\.wago\.com\//);
  });

  it('splices the grounds of four loads to the battery: one net, every load grounded', () => {
    const loads = ['vario', 'flarm', 'fc', 'radio'];
    const direct = sample.wires.filter((x) => loads.includes(x.from.part) && 'pin' in x.from && x.from.pin === 'GND' && x.to.part === 'bat');
    expect(direct).toHaveLength(4);
    let d = applyOps(sample, removeWiresOps(sample, new Set(direct.map((x) => x.id))))[0];
    const splice: PlacedPart = { id: 'wago', part: { id: 'wago.221-415', version: 1 }, x: -10, y: 0, rotation: 0, label: 'GND splice', mountedTo: null, depthOffset: 0, locked: false, offPanelRunMm: null };
    d = applyOps(d, [ops.insert('parts', splice)])[0];
    const c = part('wago.221-415').connectors[0]!.id;
    d = withConnections(d, [
      [pin('bat', 'T', '-'), pin('wago', c, '1')],
      ...loads.map((p, i): [Terminal, Terminal] => [pin(p, 'PWR', 'GND'), pin('wago', c, String(i + 2))]),
    ]);
    const nets = d.nets.filter((n) => n.members.some((m) => m.part === 'wago'));
    expect(nets).toHaveLength(1);
    expect(nets[0]!.type).toBe('ground');
    expect(nets[0]!.members.map(keyOf)).toEqual(expect.arrayContaining(['bat/T/-', 'vario/PWR/GND', 'radio/PWR/GND']));
    const a = analyse(d);
    for (const l of a.loads) expect(l.grounded).toBe(true);
    expect(runChecks(d, projectGeometry(d)).filter((r) => r.severity === 'error').map((r) => r.key)).toEqual([]);
  });
});
