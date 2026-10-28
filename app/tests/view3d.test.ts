import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTemplate } from '../src/model/resolve';
import { CataloguePart, Project, type PlacedPart } from '../src/model/schema';
import { sampleProject } from '../src/store/app';
import { buildModel3d, FLAT_GAP } from '../src/view3d/model3d';

let doc: Project;

const place = (id: string, part: string, x: number, y: number, extra: Partial<PlacedPart> = {}): PlacedPart =>
  ({ id, part: { id: part, version: 1 }, x, y, rotation: 0, label: id, mountedTo: null, depthOffset: 0, locked: false, offPanelRunMm: null, ...extra }) as PlacedPart;

// A part with nothing known about its thickness: no protrusion, no depth.
const mystery = CataloguePart.parse({
  id: 'test.mystery',
  version: 1,
  maker: 'Test',
  model: 'Mystery',
  category: 'instrument',
  front: { cutouts: [{ kind: 'circle', cx: 0, cy: 0, d: 57 }], bezel: { kind: 'circle', cx: 0, cy: 0, d: 62 }, screwHoles: [], protrusion: null },
  rear: { body: { kind: 'circle', cx: 0, cy: 0, d: 57 }, depth: null },
  weightG: null,
  review: 'unverified',
});

const solid = (m: ReturnType<typeof buildModel3d>, key: string) => m.solids.find((s) => s.key === key)!;

beforeEach(() => {
  doc = { ...sampleProject(), parts: [], wires: [], routes: [], nets: [] };
});

describe('3D model', () => {
  it('extrudes the panel plate through its thickness, with each cut as a hole', () => {
    // A 57 mm instrument has a cutout and four screw holes.
    doc.parts = [place('asi', 'generic.round-57', 0, 0)];
    const t = resolveTemplate(doc)!.thickness;
    const m = buildModel3d(doc);
    const panel = solid(m, 'panel');
    expect(panel.z0).toBe(-t);
    expect(panel.z1).toBe(0);
    expect(panel.holes).toHaveLength(1 + 4 + resolveTemplate(doc)!.fixings.length);
    // The cutout hole is the flattened 57 mm circle, within the flattening tolerance.
    const radii = panel.holes.map((h) => Math.max(...h.map((p) => Math.hypot(p.x, p.y))));
    expect(radii.some((r) => Math.abs(r - 28.5) < 0.01)).toBe(true);
  });

  it('stands the bezel proud of the face by its protrusion and runs the body through its depth band', () => {
    doc.parts = [place('asi', 'generic.round-57', 0, 0, { params: { depth: 120, protrusion: 10 }, depthOffset: 5 })];
    const t = resolveTemplate(doc)!.thickness;
    const m = buildModel3d(doc);
    expect(solid(m, 'bezel:asi')).toMatchObject({ z0: -t - 10, z1: -t, unknown: false });
    expect(solid(m, 'body:asi')).toMatchObject({ z0: 5, z1: 125, unknown: false, shade: 1 });
    expect(m.zMin).toBe(-t - 10);
    expect(m.zMax).toBe(125);
  });

  it('puts a mounted part behind its parent, cutting nothing in the panel', () => {
    doc.parts = [
      place('radio', 'generic.round-57', 0, 0, { params: { depth: 120 } }),
      place('box', 'generic.remote-unit', 0, 0, { mountedTo: { parent: 'radio', dx: 0, dy: 0, dz: 120 } }),
    ];
    const m = buildModel3d(doc);
    expect(solid(m, 'body:box')).toMatchObject({ z0: 120, z1: 160, clash: false });
    expect(m.solids.some((s) => s.key === 'bezel:box')).toBe(false);
    expect(solid(m, 'panel').holes).toHaveLength(1 + 4 + resolveTemplate(doc)!.fixings.length);
  });

  it('marks clashing bodies', () => {
    doc.parts = [place('radio', 'generic.round-57', 0, 0, { params: { depth: 120 } }), place('box', 'generic.remote-unit', 0, 0)];
    const m = buildModel3d(doc);
    expect(solid(m, 'body:radio').clash).toBe(true);
    expect(solid(m, 'body:box').clash).toBe(true);
  });

  it('draws unknown thicknesses flat and says so, never guessing a depth', () => {
    doc.customParts = [mystery];
    doc.parts = [place('m', 'test.mystery', 0, 0, { label: 'Mystery' })];
    const t = resolveTemplate(doc)!.thickness;
    const m = buildModel3d(doc);
    expect(solid(m, 'body:m')).toMatchObject({ z0: 0, z1: FLAT_GAP, unknown: true });
    expect(solid(m, 'bezel:m')).toMatchObject({ z0: -t - FLAT_GAP, z1: -t, unknown: true });
    expect(m.notes.some((n) => n.startsWith('Depth unknown') && n.includes('Mystery'))).toBe(true);
    expect(m.notes.some((n) => n.startsWith('How far the bezel stands proud is unknown') && n.includes('Mystery'))).toBe(true);
  });

  it('leaves overlapping cuts out of the plate rather than triangulating them wrongly', () => {
    doc.parts = [place('a', 'generic.round-57', 0, 0), place('b', 'generic.round-57', 30, 0)];
    const m = buildModel3d(doc);
    const panel = solid(m, 'panel');
    expect(panel.holes.length).toBeLessThan(2 * 5 + resolveTemplate(doc)!.fixings.length);
    expect(m.notes.some((n) => n.includes('overlap another cut'))).toBe(true);
  });

  it('draws every routed wire along its route, and each loom at its bundle size', () => {
    const wired = Project.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'projects', 'wiring-sample.json'), 'utf8')));
    const m = buildModel3d(wired);
    expect(m.wires.length).toBe(wired.wires.length);
    expect(m.looms.length).toBe(wired.routes.filter((r) => r.points.length >= 2).length);
    for (const l of m.looms) expect(l.diameterMm).toBeGreaterThan(0);
    // A wire on a route goes from its terminal to the route, along it, and off to the other
    // terminal (two off-panel parts at one exit are joined beyond the panel instead).
    const routed = new Set(wired.wires.filter((w) => w.route).map((w) => w.id));
    expect(routed.size).toBeGreaterThan(0);
    expect(m.wires.filter((w) => routed.has(w.id)).some((w) => w.points.length >= 4)).toBe(true);
  });
});
