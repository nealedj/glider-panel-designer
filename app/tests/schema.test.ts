import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CataloguePart, PanelTemplate, Project } from '../src/model/schema';
import { CandidatesFile, ReviewedBundle } from '../src/model/candidates';
import { GENERIC_DEFS, buildGeneric } from '../src/catalogue/generic';

const root = join(__dirname, '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const jsonIn = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, readJson(join(root, dir, f))] as const);

describe('committed data validates', () => {
  it.each(jsonIn('catalogue/parts'))('catalogue part %s', (_f, json) => {
    expect(() => CataloguePart.parse(json)).not.toThrow();
  });
  it.each(jsonIn('templates'))('template %s', (_f, json) => {
    expect(() => PanelTemplate.parse(json)).not.toThrow();
  });
  it.each(jsonIn('fixtures/projects'))('project %s', (_f, json) => {
    expect(() => Project.parse(json)).not.toThrow();
  });
});

describe('generated files are up to date', () => {
  it.each(GENERIC_DEFS.map((d) => [d.id, d] as const))('generic part %s', (id, def) => {
    expect(readJson(join(root, 'catalogue/parts', `${id}.json`))).toEqual(JSON.parse(JSON.stringify(buildGeneric(def))));
  });
  it.each([
    ['project', Project],
    ['panel-template', PanelTemplate],
    ['catalogue-part', CataloguePart],
    ['candidates', CandidatesFile],
    ['reviewed-parts', ReviewedBundle],
  ] as const)('JSON Schema %s', (name, schema) => {
    const committed = readJson(join(root, 'schemas', `${name}.schema.json`));
    expect(committed).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }))));
  });
});

describe('catalogue data rules', () => {
  it('generic parts are unverified and say so on every geometry field', () => {
    for (const def of GENERIC_DEFS) {
      const part = buildGeneric(def);
      expect(part.review).toBe('unverified');
      for (const k of ['front.cutouts', 'front.bezel', 'front.screwHoles', 'rear.depth']) {
        expect(part.sources[k]?.status).toBe('unverified');
      }
    }
  });
  it('param overrides change geometry', () => {
    const def = GENERIC_DEFS.find((d) => d.id === 'generic.round-57')!;
    const part = buildGeneric(def, { cutoutD: 58 });
    expect(part.front.cutouts[0]).toMatchObject({ kind: 'circle', d: 58 });
  });
});
