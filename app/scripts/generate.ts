/**
 * Writes generated files that are committed to the repo:
 * - schemas/*.schema.json from the zod schemas, for the Python tools
 * - catalogue/parts/generic.*.json from the generic part generators
 *
 * Run with `npm run gen`. CI checks that the committed files are up to date.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CataloguePart, PanelTemplate, Project } from '../src/model/schema';
import { CandidatesFile, ReviewedBundle } from '../src/model/candidates';
import { GENERIC_DEFS, buildGeneric } from '../src/catalogue/generic';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function write(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', path.slice(root.length + 1));
}

const schemas = { project: Project, 'panel-template': PanelTemplate, 'catalogue-part': CataloguePart, candidates: CandidatesFile, 'reviewed-parts': ReviewedBundle };
for (const [name, schema] of Object.entries(schemas)) {
  write(join(root, 'schemas', `${name}.schema.json`), z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
}

for (const def of GENERIC_DEFS) {
  write(join(root, 'catalogue', 'parts', `${def.id}.json`), buildGeneric(def));
}
