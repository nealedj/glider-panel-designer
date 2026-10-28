import { beforeEach, describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/checks';
import { projectGeometry, resolveTemplate } from '../src/model/resolve';
import { Project, type PanelTemplate, type PlacedPart } from '../src/model/schema';
import { sampleProject } from '../src/store/app';

let doc: Project;

const place = (id: string, part: string, x: number, y: number, extra: Partial<PlacedPart> = {}): PlacedPart => ({
  id,
  part: { id: part, version: 1 },
  x,
  y,
  rotation: 0,
  label: id,
  mountedTo: null,
  depthOffset: 0,
  locked: false,
  offPanelRunMm: null,
  ...extra,
} as PlacedPart);

// The tests edit `doc` in place, but checks and geometry are cached per document
// identity, as the app's documents are immutable; a shallow copy is a new version.
function check(d: Project = doc) {
  const v = { ...d };
  return runChecks(v, projectGeometry(v));
}

function keys(d: Project = doc) {
  return check(d).map((r) => r.key.split(':')[0]);
}

function withTemplate(patch: Partial<PanelTemplate>): Project {
  const t = resolveTemplate(doc)!;
  return { ...doc, template: { embedded: { ...t, ...patch } } };
}

beforeEach(() => {
  doc = { ...sampleProject(), parts: [] };
});

describe('sample project', () => {
  it('has no geometric errors or warnings', () => {
    const geo = check(sampleProject()).filter((r) => r.area === 'front' || r.area === 'rear');
    expect(geo.filter((r) => r.severity !== 'info')).toEqual([]);
  });
});

describe('front checks', () => {
  it('flags overlapping cutouts as an error', () => {
    doc.parts = [place('a', 'generic.round-57', 0, 0), place('b', 'generic.round-57', 50, 0)];
    const r = check().find((x) => x.key.startsWith('overlap:'));
    expect(r).toMatchObject({ severity: 'error', ids: ['a', 'b'] });
    expect(r!.box).toBeDefined();
  });

  it('warns on thin material between cutouts, and not when there is enough', () => {
    // 57 mm cutouts 60 mm apart leave 3 mm, below the 5 mm minimum. The bezels overlap too,
    // but the ligament warning already covers the pair.
    doc.parts = [place('a', 'generic.round-57', 0, 0, { params: { screwSpacing: 10 } }), place('b', 'generic.round-57', 60, 0, { params: { screwSpacing: 10 } })];
    expect(keys()).toContain('ligament');
    expect(keys()).not.toContain('bezel');
    doc.parts[1] = { ...doc.parts[1]!, x: 62.5 };
    expect(keys()).not.toContain('ligament');
  });

  it('ligament check counts screw holes', () => {
    // 80 mm instrument holes on a 66 mm square: corner hole at (33, 33), Ø4.2.
    // A toggle hole Ø12.5 at (33, 43) leaves 10 - 2.1 - 6.25 = 1.65 mm, shown as 1.7.
    doc.parts = [place('a', 'generic.round-80', 0, 0), place('b', 'generic.toggle-switch', 33, 43)];
    const r = check().find((x) => x.key.startsWith('ligament:'));
    expect(r?.message).toContain('1.7 mm');
  });

  it('warns when bezels overlap though cuts do not', () => {
    doc.settings = { ...doc.settings, minLigamentMm: null };
    doc.parts = [place('a', 'generic.round-57', 0, 0, { params: { screwSpacing: 10 } }), place('b', 'generic.round-57', 60, 0, { params: { screwSpacing: 10 } })];
    expect(keys()).toContain('bezel');
  });

  it('flags cuts outside the outline and close to the edge', () => {
    doc.parts = [place('a', 'generic.round-80', -130, 0)];
    expect(keys()).toContain('outside');
    // Cutout edge 5 mm in from the left edge, and 8 mm minimum.
    doc.parts = [place('a', 'generic.round-80', -105, 0, { params: { screwSpacing: 10 } })];
    expect(keys()).toContain('edge');
    expect(keys()).not.toContain('outside');
  });

  it('flags cuts in keep-outs and panel fixings', () => {
    doc.keepOuts = [{ id: 'k1', label: 'Canopy frame', shape: { kind: 'rect', cx: 0, cy: 90, w: 300, h: 20, r: 0 } }];
    doc.parts = [place('a', 'generic.round-57', 0, 60)];
    const r = check().find((x) => x.key.startsWith('keepout:'));
    expect(r?.message).toContain('Canopy frame');
    expect(r?.severity).toBe('error');
    doc.keepOuts = [];
    doc.parts = [place('a', 'generic.toggle-switch', -140, 90)];
    expect(keys()).toContain('fixing');
  });

  it('flags cuts near a bend line', () => {
    const d = withTemplate({ bendLines: [{ a: { x: -150, y: 80 }, b: { x: 150, y: 80 }, label: 'flange' }] });
    d.parts = [place('a', 'generic.toggle-switch', 0, 65)];
    const r = check(d).find((x) => x.key.startsWith('bend:'));
    expect(r?.severity).toBe('error');
    expect(r?.message).toContain('8.8 mm');
    d.parts = [place('a', 'generic.toggle-switch', 0, 60)];
    expect(keys(d)).not.toContain('bend');
  });

  it('warns when a part stands proud of the canopy clearance', () => {
    const d = withTemplate({ canopyClearance: 100 });
    d.parts = [place('a', 'generic.phone-mount-base', 0, 0)];
    expect(keys(d)).toContain('canopy');
  });

  it('turns threshold checks off and says so when no minimum is set', () => {
    doc.settings = { ...doc.settings, minLigamentMm: null, minEdgeDistanceMm: null };
    doc.parts = [place('a', 'generic.round-57', 0, 0, { params: { screwSpacing: 10 } }), place('b', 'generic.round-57', 60, 0, { params: { screwSpacing: 10 } })];
    expect(keys()).not.toContain('ligament');
    expect(check().find((r) => r.key === 'thresholds:unset')?.message).toContain('material between cuts, edge distance');
  });
});

describe('rear checks', () => {
  it('flags parts overlapping in plan and depth', () => {
    doc.parts = [place('radio', 'generic.round-57', 0, 0, { params: { depth: 120 } }), place('box', 'generic.remote-unit', 0, 0)];
    const r = check().find((x) => x.key.startsWith('clash:'));
    expect(r).toMatchObject({ severity: 'error', area: 'rear' });
    expect(r!.ids.sort()).toEqual(['box', 'radio']);
  });

  it('allows a unit mounted behind a long radio', () => {
    doc.parts = [
      place('radio', 'generic.round-57', 0, 0, { params: { depth: 120 } }),
      place('box', 'generic.remote-unit', 0, 0, { mountedTo: { parent: 'radio', dx: 0, dy: 0, dz: 120 } }),
    ];
    expect(keys()).not.toContain('clash');
    const g = projectGeometry({ ...doc }).get('box')!;
    expect([g.z0, g.z1]).toEqual([120, 160]);
    expect(g.cutouts).toEqual([]);
  });

  it('moves mounted parts with their parent', () => {
    doc.parts = [
      place('radio', 'generic.round-57', 10, 20),
      place('box', 'generic.remote-unit', 0, 0, { mountedTo: { parent: 'radio', dx: 5, dy: -5, dz: 100 } }),
    ];
    expect(projectGeometry({ ...doc }).get('box')!.transform).toMatchObject({ x: 15, y: 15 });
  });

  it('checks parts against the free depth, including connector clearance and regions', () => {
    // Free depth is 180 in the sample template.
    doc.parts = [place('a', 'generic.round-80', 0, 0, { params: { depth: 190 } })];
    expect(keys()).toContain('depth');
    doc.parts = [place('a', 'generic.round-80', 0, 0)];
    expect(keys()).not.toContain('depth');
    const d = withTemplate({ availableDepth: { default: 180, regions: [{ shape: { kind: 'rect', cx: 0, cy: 80, w: 300, h: 40, r: 0 }, depth: 60 }] } });
    d.parts = [place('a', 'generic.round-80', 0, 30)];
    expect(check(d).find((r) => r.key.startsWith('depth:'))?.message).toContain('60.0 mm is free');
  });
});
