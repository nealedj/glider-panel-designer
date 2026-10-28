import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CandidatesFile, ReviewedBundle } from '../src/model/candidates';
import { CataloguePart } from '../src/model/schema';
import { buildBundle, buildPart, isReviewed, pathsOf, progress, type ProductReview } from '../src/review/build';

const file = CandidatesFile.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'discovery', 'candidates.synthetic.json'), 'utf8')));
const s100 = file.products.find((p) => p.key === 'lxnav.s100-vario.57-mm')!;
const kind = (sid: string) => file.sources.find((s) => s.id === sid)!.kind;
const idx = (pred: (c: (typeof s100.candidates)[number]) => boolean) => s100.candidates.findIndex(pred);

describe('candidates file from the tools', () => {
  it('validates, with the S100 trap flagged', () => {
    expect(file.products.map((p) => p.key)).toEqual(['tq.krt2-radio', 'lxnav.s100-vario.57-mm', 'lxnav.s80-vario.80-mm']);
    const trap = s100.candidates.filter((c) => c.path === 'power.currentA' && kind(c.source) === 'retailer');
    expect(trap.length).toBe(2);
    for (const c of trap) {
      expect(c.confidence).toBeLessThan(0.3);
      expect(c.note).toContain('not S100');
    }
  });
});

describe('building catalogue parts from a review', () => {
  // The reviewer takes the manual's figures, and the shop's weight (the manual has none).
  const review: ProductReview = {
    fields: {
      'front.cutout': { accepted: [idx((c) => c.path === 'front.cutout' && kind(c.source) === 'manual' && (c.value as { d: number }).d === 57)], rejected: [] },
      'rear.depth': { accepted: [idx((c) => c.path === 'rear.depth' && kind(c.source) === 'manual' && c.value === 98)], rejected: [] },
      'power.currentA': { accepted: [idx((c) => c.path === 'power.currentA' && c.value === 0.165)], rejected: [] },
      'power.voltage': { accepted: [idx((c) => c.path === 'power.voltage' && kind(c.source) === 'manual' && c.value === 12)], rejected: [] },
      weightG: { accepted: [idx((c) => c.path === 'weightG')], rejected: [] },
      'connectors.pinout': { accepted: [idx((c) => c.path === 'connectors.pinout')], rejected: [] },
      datasheet: { accepted: [idx((c) => c.path === 'datasheet')], rejected: [] },
      'front.screwHoles': {
        accepted: [],
        rejected: [],
        manual: { value: { spacing: 47, d: 3.5 }, source: s100.manuals[0]!.source, page: 2, snippet: 'Drawing on page 2: four M4 screws on a 47 mm square' },
      },
    },
  };

  it('uses accepted values with their sources, and leaves the shop-only weight out', () => {
    for (const k of Object.keys(review.fields)) if (k !== 'front.screwHoles') expect(review.fields[k]!.accepted[0]).toBeGreaterThanOrEqual(0);
    const { part, excluded } = buildPart(file, s100, review);
    expect(() => CataloguePart.parse(part)).not.toThrow();
    expect(part.id).toBe('lxnav.s100-vario.57-mm');
    expect(part.model).toBe('S100 Vario 57 mm');
    expect(part.front.cutouts).toEqual([{ kind: 'circle', cx: 0, cy: 0, d: 57 }]);
    expect(part.front.screwHoles).toHaveLength(4);
    expect(part.front.screwHoles[0]).toEqual({ x: -23.5, y: 23.5, d: 3.5 });
    expect(part.rear.depth).toBe(98);
    expect(part.power).toEqual({ currentA: 0.165, voltage: 12 });
    expect(part.weightG).toBeNull();
    expect(excluded).toEqual([{ path: 'weightG', reason: expect.stringContaining('Only the shop page') }]);
    expect(part.connectors).toHaveLength(1);
    expect(part.connectors[0]!.type).toBe('RJ45');
    expect(part.connectors[0]!.pins.map((p) => p.signal)).toEqual(['power', 'power', 'serial', 'serial', 'ground', 'ground']);
    // Every value says where it came from, and none cites the shop.
    for (const [path, src] of Object.entries(part.sources)) {
      expect(src.status, path).toBe('verified');
      expect(src.snippet, path).toBeTruthy();
      expect(src.url, path).not.toContain('shop.test');
    }
    expect(part.sources['front.cutout']!.note).toContain('Page 2');
    expect(part.datasheet).toContain('gliding.lxnav.com');
  });

  it('tracks progress and exports only reviewed products', () => {
    expect(pathsOf(s100)).toContain('connectors.pinout');
    expect(isReviewed(s100, review)).toBe(false);
    const p = progress(s100, review);
    expect(p.done).toBeLessThan(p.total);
    const all: ProductReview = { ...review, done: true };
    const bundle = buildBundle(file, { [s100.key]: all, 'lxnav.s80-vario.80-mm': { fields: {} } });
    expect(() => ReviewedBundle.parse(bundle)).not.toThrow();
    expect(bundle.parts.map((x) => x.id)).toEqual(['lxnav.s100-vario.57-mm']);
    expect(bundle.excluded).toEqual([{ part: 'lxnav.s100-vario.57-mm', path: 'weightG', reason: expect.any(String) }]);
  });
});
