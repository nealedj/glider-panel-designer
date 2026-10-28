import { describe, expect, it } from 'vitest';
import { flattenPoly } from '../src/geom/shapes';
import { PanelTemplate, type PolyVertex } from '../src/model/schema';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTemplate, checkResults, draftFromTemplate, draftMap, estimateAccuracy, newDraft, setDatum, withMapChange, type TemplateDraft } from '../src/template/draft';
import { bulgeThrough, ccw, insertVertex, mirrorHalf, reverse, signedArea } from '../src/template/outline';

const box = (pts: { x: number; y: number }[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

describe('outline operations', () => {
  // An asymmetric T: the left half is wider and has a rounded top corner.
  const T: PolyVertex[] = [
    { x: -40, y: -100 },
    { x: 30, y: -100 },
    { x: 30, y: 0 },
    { x: 150, y: 0 },
    { x: 150, y: 80 },
    { x: -170, y: 80, bulge: 0.2 },
    { x: -190, y: 60 },
    { x: -190, y: 0 },
    { x: -40, y: 0 },
  ];

  it('reverses winding, keeping every arc', () => {
    const r = reverse(T);
    expect(signedArea(r)).toBeCloseTo(-signedArea(T), 9);
    const a = flattenPoly(T, 0.5);
    const b = flattenPoly(r, 0.5);
    expect(box(b)).toEqual(box(a));
  });

  it('mirrors the left half, arcs included', () => {
    const m = mirrorHalf(T, 'left')!;
    const pts = flattenPoly(m, 0.2);
    const b = box(pts);
    expect(b.minX).toBeCloseTo(-190, 6);
    expect(b.maxX).toBeCloseTo(190, 6);
    expect(b.minY).toBeCloseTo(-100, 6);
    // Both top corners are rounded the same way.
    expect(m.filter((p) => p.bulge).length).toBe(2);
    for (const p of pts) expect(pts.some((q) => Math.abs(q.x + p.x) < 0.3 && Math.abs(q.y - p.y) < 0.3)).toBe(true);
    expect(signedArea(m)).toBeGreaterThan(0);
  });

  it('mirrors the right half', () => {
    const b = box(flattenPoly(mirrorHalf(T, 'right')!, 0.5));
    expect(b.minX).toBeCloseTo(-150, 6);
    expect(b.maxX).toBeCloseTo(150, 6);
    expect(b.minY).toBeCloseTo(-100, 6);
  });

  it('splits an arc without changing its shape', () => {
    const arc: PolyVertex[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0, bulge: 1 }, // a half circle up to (100, 100)... via the right
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const split = insertVertex(arc, 1, { x: 160, y: 50 });
    expect(split).toHaveLength(5);
    expect(split[2]).toMatchObject({ x: expect.closeTo(150, 6), y: expect.closeTo(50, 6) });
    expect(box(flattenPoly(split, 0.2))).toEqual(box(flattenPoly(arc, 0.2)));
  });

  it('gives the bulge of an arc through a point', () => {
    // Through (50, −20) from (0, 0) to (100, 0): below the chord, which is clockwise... going right,
    // below is on the right, so the arc is counter-clockwise: positive bulge 0.4.
    expect(bulgeThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -20 })).toBeCloseTo(0.4, 9);
    expect(ccw(reverse(T))).toEqual(T.map((p) => ({ ...p })));
  });
});

describe('template drafts', () => {
  // A photo calibrated by a simple scale: 0.5 mm per pixel, 1000 × 800 px.
  const scaled = (): TemplateDraft => ({
    ...newDraft('Test'),
    inputType: 'scan',
    photo: { key: 'k', name: 'scan.png', width: 1000, height: 800 },
    calibration: { kind: 'scale', mapping: { H: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1], k1: 0, width: 1000, height: 800 }, line: null, dpi: 50.8 },
    frame: { origin: { x: 250, y: 200 }, angle: 0 },
  });

  it('maps photo pixels to template mm with y up about the datum', () => {
    const m = draftMap(scaled())!;
    expect(m.toTemplate({ x: 500, y: 400 })).toEqual({ x: 0, y: -0 });
    expect(m.toTemplate({ x: 600, y: 300 })).toEqual({ x: 50, y: 50 });
    const p = m.toImage({ x: -20, y: 10 });
    expect(p.x).toBeCloseTo(460, 9);
    expect(p.y).toBeCloseTo(380, 9);
  });

  it('keeps traced features on the same photo pixels when the datum moves', () => {
    let d = { ...scaled(), outline: [{ x: -100, y: -50 }, { x: 100, y: -50 }, { x: 100, y: 50 }, { x: -100, y: 50 }], fixings: [{ x: 90, y: -40, d: 4.2 }] };
    const before = draftMap(d)!.toImage(d.fixings[0]!);
    d = setDatum(d, { x: -100, y: -50 }, { a: { x: -100, y: -50 }, b: { x: 100, y: 50 } });
    expect(d.outline[0]!.x).toBeCloseTo(0, 9);
    expect(d.outline[0]!.y).toBeCloseTo(0, 9);
    // The x axis now runs along the diagonal.
    expect(d.outline[2]!.y).toBeCloseTo(0, 9);
    const after = draftMap(d)!.toImage(d.fixings[0]!);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(d.fixings[0]!.d).toBeCloseTo(4.2, 9);
  });

  it('keeps features when recalibrating, rescaling them', () => {
    const d = { ...scaled(), outline: [{ x: -100, y: -50 }, { x: 100, y: -50 }, { x: 100, y: 50 }] };
    const re = withMapChange(d, { calibration: { ...d.calibration!, mapping: { ...d.calibration!.mapping, H: [0.25, 0, 0, 0, 0.25, 0, 0, 0, 1] } } as TemplateDraft['calibration'] });
    // Same pixels, half the scale.
    expect(Math.hypot(re.outline[1]!.x - re.outline[0]!.x, re.outline[1]!.y - re.outline[0]!.y)).toBeCloseTo(100, 9);
  });

  it('estimates accuracy from its parts and judges check spans against it', () => {
    const d = { ...scaled(), outline: [{ x: -100, y: -50 }, { x: 100, y: -50 }, { x: 100, y: 50 }], checks: [] as TemplateDraft['checks'] };
    const acc = estimateAccuracy(d)!;
    // Scan baseline 0.2 mm, scale line 1.5 px × 0.5 mm, tracing the same: √2 × √(0.2² + 0.75² + 0.75²).
    expect(acc.spanMm).toBeCloseTo(Math.SQRT2 * Math.sqrt(0.04 + 2 * 0.75 ** 2), 9);
    d.checks = [
      { id: 'c1', label: 'Width', a: { x: -100, y: -50 }, b: { x: 100, y: -50 }, measuredMm: 200.8 },
      { id: 'c2', label: 'Off', a: { x: -100, y: -50 }, b: { x: 100, y: -50 }, measuredMm: 205 },
    ];
    const res = checkResults(d, acc);
    expect(res.map((r) => r.withinError)).toEqual([true, false]);
  });

  it('builds a valid library template with its provenance', () => {
    const d = { ...scaled(), name: 'DG-300 panel', outline: [{ x: -100, y: -50 }, { x: 100, y: -50 }, { x: 100, y: 50 }, { x: -100, y: 50 }] };
    const t = buildTemplate(d)!;
    expect(() => PanelTemplate.parse(t)).not.toThrow();
    expect(t.id).toBe('local.dg-300-panel');
    expect(t.status).toBe('draft');
    expect(t.provenance.method).toBe('scan at 50.8 dpi');
    expect(t.provenance.accuracyMm).toBeGreaterThan(0);
  });
});

describe('editing an existing template', () => {
  const shipped = PanelTemplate.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', 'templates', 'pik20d.t-panel-mockup.json'), 'utf8')));

  it('round-trips through a draft with no photo, keeping provenance and accuracy', () => {
    const d = draftFromTemplate(shipped, false);
    expect(d.photo).toBeNull();
    expect(estimateAccuracy(d)!.spanMm).toBe(shipped.provenance.accuracyMm);
    const t = buildTemplate(d)!;
    // A shipped template becomes your own copy under a new id.
    expect(t.id).toBe('local.pik-20d-t-panel-cardboard-mock-up-my-copy');
    expect(t.provenance.method).toBe(`${shipped.provenance.method}; edited in the template editor`);
    const same = (x: PanelTemplate) => ({ ...x, id: '', name: '', provenance: { ...x.provenance, method: '' } });
    expect(same(t)).toEqual(same(shipped));
    // Editing again does not repeat the note.
    expect(buildTemplate(draftFromTemplate(t, true))!.provenance.method).toBe(t.provenance.method);
  });

  it('keeps your own template’s id and version, and clears a verification', () => {
    const mine = { ...shipped, id: 'local.mine', version: 3, status: 'verified' as const, verifiedNote: 'Held against the panel', verifiedDate: '2026-10-01' };
    const t = buildTemplate(draftFromTemplate(mine, true))!;
    expect([t.id, t.version, t.name, t.status]).toEqual(['local.mine', 3, shipped.name, 'draft']);
  });
});
