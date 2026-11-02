/**
 * Guided wires, editable routes, rounded drawing and bus bars (ADR 0017).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/checks';
import { buildGeneric, GENERIC_BY_ID } from '../src/catalogue/generic';
import { pathLength, smoothPath, type P3 } from '../src/geom/smooth';
import { projectGeometry } from '../src/model/resolve';
import { Project, type PlacedPart, type Terminal } from '../src/model/schema';
import { applyOps, ops } from '../src/store/doc';
import { analyse } from '../src/wiring/circuit';
import { controlOf, handlesOf, movePoint, setControlOps, straightenOps, withoutPoint } from '../src/wiring/guides';
import { wireLength } from '../src/wiring/length';
import { connectOps, removeWiresOps, withConnections } from '../src/wiring/ops';
import { keyOf, terminals } from '../src/wiring/terminals';
import { buildModel3d } from '../src/view3d/model3d';
import { rearScene, rearSvg } from '../src/export/rear';

const root = join(__dirname, '..', '..');
const sample = Project.parse(JSON.parse(readFileSync(join(root, 'fixtures', 'projects', 'wiring-sample.json'), 'utf8')));
const pin = (p: string, c: string, n: string): Terminal => ({ part: p, connector: c, pin: n });
const d3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('rounded paths', () => {
  it('leaves straight lines and the ends alone', () => {
    const line = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }];
    expect(smoothPath(line)).toEqual(line);
    const l = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 100, z: 10 }];
    const s = smoothPath(l);
    expect(s[0]).toEqual(l[0]);
    expect(s[s.length - 1]).toEqual(l[2]);
  });

  it('rounds a corner within the bend distance, without kinks', () => {
    const l = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 100, z: 0 }];
    const s = smoothPath(l, 30);
    // The curve leaves the first leg 30 mm before the corner and joins the second 30 mm after.
    const first = s.findIndex((p) => p.y > 1e-9);
    expect(s[first - 1]!.x).toBeCloseTo(70, 6);
    expect(s.some((p) => Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y - 30) < 1e-9)).toBe(true);
    // It stays inside the corner's triangle and never touches the corner itself.
    for (const p of s) {
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(Math.min(...s.map((p) => d3(p, l[1]!)))).toBeGreaterThan(5);
    // No sample turns more than 10°: the path has no kinks.
    for (let i = 2; i < s.length; i++) {
      const u = { x: s[i - 1]!.x - s[i - 2]!.x, y: s[i - 1]!.y - s[i - 2]!.y };
      const v = { x: s[i]!.x - s[i - 1]!.x, y: s[i]!.y - s[i - 1]!.y };
      const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
      expect(Math.acos(Math.min(1, cos)) * (180 / Math.PI)).toBeLessThan(10);
    }
    // Shorter than corner to corner, longer than the chord.
    expect(pathLength(s)).toBeLessThan(200);
    expect(pathLength(s)).toBeGreaterThan(Math.hypot(100, 100));
  });

  it('takes at most half of a short leg, so neighbouring curves meet but do not overlap', () => {
    const z = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 20, z: 0 }, { x: 200, y: 20, z: 0 }];
    const s = smoothPath(z, 30);
    // x never goes back on itself.
    for (let i = 1; i < s.length; i++) expect(s[i]!.x).toBeGreaterThanOrEqual(s[i - 1]!.x - 1e-9);
    expect(s.some((p) => Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y - 10) < 1e-9)).toBe(true);
  });
});

describe('rear drawing export', () => {
  it('draws each loom as one rounded path from its first point to its last', () => {
    const looms = rearScene(sample).groups.find((g) => g.id === 'looms')!.prims.filter((p) => p.kind === 'polyline');
    // A bundle and its dashed spine per route.
    expect(looms).toHaveLength(2 * sample.routes.length);
    const r = sample.routes[0]!.points;
    const pts = looms[0]!.kind === 'polyline' ? looms[0]!.points : [];
    expect(pts.length).toBeGreaterThan(r.length);
    // The rear drawing mirrors x.
    expect(pts[0]).toMatchObject({ x: -r[0]!.x, y: r[0]!.y });
    expect(pts[pts.length - 1]).toMatchObject({ x: -r[r.length - 1]!.x, y: r[r.length - 1]!.y });
    expect(rearSvg(sample)).toContain('stroke-linejoin="round"');
  });
});

describe('guiding a wire', () => {
  const w = sample.wires.find((x) => !x.route && !x.tubeBoreMm)!;
  const terms = terminals(sample, projectGeometry(sample));

  it('runs through its guide points, and is no longer a straight-line estimate', () => {
    expect(w.route).toBeNull();
    const straight = wireLength(w, sample, terms)!;
    expect(straight.estimated).toBe(true);
    const a = terms.get(keyOf(w.from))!.pos;
    const b = terms.get(keyOf(w.to))!.pos;
    const via = [{ x: a.x, y: b.y, z: 100 }];
    const guided = wireLength({ ...w, via }, sample, terms)!;
    expect(guided.estimated).toBe(false);
    expect(guided.path).toEqual([a, via[0], b]);
    expect(guided.mm).toBeCloseTo(d3(a, via[0]!) + d3(via[0]!, b) + 2 * sample.settings.endAllowanceMm, 6);
  });

  it('a wire on a route follows the route, so it has nothing to shape', () => {
    const onRoute = sample.wires.find((x) => x.route)!;
    expect(controlOf(sample, analyse(sample), onRoute.id)).toBeNull();
  });

  it('adds, moves and removes guide points, keeping the ends on their pins', () => {
    const c = controlOf(sample, analyse(sample), w.id)!;
    expect(c.points).toHaveLength(2);
    // Straight: one handle in the middle, none on the ends.
    expect(handlesOf(c).map((h) => [h.index, h.insert])).toEqual([[1, true]]);
    const mid = handlesOf(c)[0]!;
    const pts = movePoint(c, mid, { x: 0, y: 0 });
    expect(pts).toHaveLength(3);
    // A new point takes its depth from the middle of the leg it was dragged from.
    expect(pts[1]!.z).toBeCloseTo((c.points[0]!.z + c.points[1]!.z) / 2, 9);
    const d1 = applyOps(sample, setControlOps(sample, c.target, pts))[0];
    expect(d1.wires.find((x) => x.id === w.id)!.via).toEqual([{ x: 0, y: 0, z: Math.round(pts[1]!.z * 100) / 100 }]);

    const c1 = controlOf(d1, analyse(d1), w.id)!;
    expect(handlesOf(c1).map((h) => [h.index, h.insert])).toEqual([
      [1, true],
      [1, false],
      [2, true],
    ]);
    expect(withoutPoint(c1, 0)).toBeNull();
    expect(withoutPoint(c1, 2)).toBeNull();
    const moved = movePoint(c1, { index: 1, insert: false }, { x: 10, y: -5 });
    expect(moved[1]).toMatchObject({ x: 10, y: -5, z: c1.points[1]!.z });

    // Removing the last guide point drops the field, so the file is as it was.
    const d2 = applyOps(d1, setControlOps(d1, c1.target, withoutPoint(c1, 1)!))[0];
    expect('via' in d2.wires.find((x) => x.id === w.id)!).toBe(false);
    const d3 = applyOps(d1, straightenOps(d1, [w.id]))[0];
    expect(d3.wires.find((x) => x.id === w.id)).toEqual(sample.wires.find((x) => x.id === w.id));
  });

  it('reshapes a route, which keeps at least two points', () => {
    const r = sample.routes[0]!;
    const c = controlOf(sample, analyse(sample), r.id)!;
    expect(c.target.kind).toBe('route');
    // Every point can move, and every leg can take a new one.
    expect(handlesOf(c).filter((h) => !h.insert)).toHaveLength(r.points.length);
    expect(handlesOf(c).filter((h) => h.insert)).toHaveLength(r.points.length - 1);
    const d1 = applyOps(sample, setControlOps(sample, c.target, movePoint(c, { index: 1, insert: true }, { x: -140, y: -85 })))[0];
    expect(d1.routes[0]!.points).toHaveLength(r.points.length + 1);
    expect(d1.routes[0]!.points[1]).toEqual({ x: -140, y: -85, z: 130 });
    expect(withoutPoint({ ...c, points: c.points.slice(0, 2) }, 0)).toBeNull();
  });

  it('the 3D view draws rounded paths through the guide points', () => {
    const c = controlOf(sample, analyse(sample), w.id)!;
    const d1 = applyOps(sample, setControlOps(sample, c.target, movePoint(c, { index: 1, insert: true }, { x: 0, y: -60 })))[0];
    const path = buildModel3d(d1).wires.find((p) => p.id === w.id)!.points;
    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual(c.points[0]);
    expect(path[path.length - 1]).toEqual(c.points[1]);
  });
});

describe('bus bars', () => {
  const def = GENERIC_BY_ID.get('generic.bus-bar')!;

  it('is a strip of studs, spaced along the bar and joined inside', () => {
    const part = buildGeneric(def, { studs: 4, pitch: 10 });
    expect(part.bus).toBe(true);
    expect(part.front.cutouts).toEqual([]);
    const pins = part.connectors[0]!.pins;
    expect(pins.map((p) => [p.number, p.x])).toEqual([
      ['1', -15],
      ['2', -5],
      ['3', 5],
      ['4', 15],
    ]);
    expect(part.rear.body).toMatchObject({ kind: 'rect', w: 40 });
    expect(part.sources['connectors']!.status).toBe('unverified');
  });

  /** The sample with its power grounds taken to a bus bar instead of each to the battery. */
  function withGroundBus() {
    const loads = ['vario', 'flarm', 'fc', 'radio'];
    const direct = sample.wires.filter((x) => loads.includes(x.from.part) && 'pin' in x.from && x.from.pin === 'GND' && x.to.part === 'bat');
    expect(direct).toHaveLength(4);
    let d = applyOps(sample, removeWiresOps(sample, new Set(direct.map((x) => x.id))))[0];
    const bus: PlacedPart = { id: 'gnd', part: { id: 'generic.bus-bar', version: 1 }, x: -10, y: 0, rotation: 0, label: 'GND bus', mountedTo: null, depthOffset: 0, locked: false, offPanelRunMm: null, params: { studs: 6 } };
    d = applyOps(d, [ops.insert('parts', bus)])[0];
    return withConnections(d, [
      [pin('bat', 'T', '-'), pin('gnd', 'BUS', '1')],
      ...loads.map((p, i): [Terminal, Terminal] => [pin(p, 'PWR', 'GND'), pin('gnd', 'BUS', String(i + 2))]),
    ]);
  }

  it('puts every wire on its studs in one ground net', () => {
    const d = withGroundBus();
    const gndNets = d.nets.filter((n) => n.members.some((m) => m.part === 'gnd'));
    expect(gndNets).toHaveLength(1);
    expect(gndNets[0]!.type).toBe('ground');
    expect(gndNets[0]!.members.map(keyOf)).toEqual(expect.arrayContaining(['bat/T/-', 'vario/PWR/GND', 'gnd/BUS/1', 'gnd/BUS/5']));
    // New wires onto the bus take the ground net's colour.
    expect(d.wires.filter((x) => x.to.part === 'gnd').every((x) => x.colour === 'black')).toBe(true);
  });

  it('carries the returns: every load is grounded and the battery lead carries their sum', () => {
    const d = withGroundBus();
    const a = analyse(d);
    for (const l of a.loads) expect(l.grounded).toBe(true);
    const errors = runChecks(d, projectGeometry(d)).filter((r) => r.severity === 'error');
    expect(errors.map((r) => r.key)).toEqual([]);
    const lead = d.wires.find((x) => x.to.part === 'gnd' && 'pin' in x.to && x.to.pin === '1')!;
    const sum = ['vario', 'flarm', 'fc', 'radio'].reduce((s, id) => s + (a.loads.find((l) => l.partId === id)!.currentA ?? 0), 0);
    expect(a.wires.get(lead.id)!.currentA).toBeCloseTo(sum, 9);
    const varioLeg = d.wires.find((x) => x.from.part === 'vario' && x.to.part === 'gnd')!;
    expect(a.wires.get(varioLeg.id)!.currentA).toBeCloseTo(a.loads.find((l) => l.partId === 'vario')!.currentA!, 9);
  });

  it('studs sit where they are on the bar, and are named by number', () => {
    const d = withGroundBus();
    const t = terminals(d, projectGeometry(d));
    const s1 = t.get('gnd/BUS/1')!;
    const s6 = t.get('gnd/BUS/6')!;
    expect(s1.label).toBe('GND bus 1');
    expect(s1.placed).toBe(true);
    // Six studs at 10 mm: 50 mm end to end. The rear view mirrors x, the model does not.
    expect(s6.pos.x - s1.pos.x).toBeCloseTo(50, 9);
    expect(s1.pos.y).toBeCloseTo(0, 9);
  });

  it('a power stud and a ground stud on one bar are a short', () => {
    const d = withGroundBus();
    const r = connectOps(d, pin('f1', 'T', 'LOAD'), pin('gnd', 'BUS', '6'));
    const d1 = applyOps(d, r.ops)[0];
    expect(runChecks(d1, projectGeometry(d1)).some((x) => x.key.startsWith('short:'))).toBe(true);
  });
});
