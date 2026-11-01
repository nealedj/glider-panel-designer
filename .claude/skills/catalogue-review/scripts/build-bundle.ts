// Build a reviewed-parts bundle from reviewer decisions with the app's own buildBundle, so the
// Review tab's export rules (retailer exclusion, provenance) apply unchanged.
// Usage (from app/): npx tsx <this> <candidates.json> <review dir> <out.json>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CandidatesFile } from '../../../../app/src/model/candidates';
import { buildBundle, isReviewed, type ProductReview } from '../../../../app/src/review/build';

const [candPath, dir, out] = process.argv.slice(2);
if (!candPath || !dir || !out) throw new Error('usage: build-bundle.ts <candidates.json> <review dir> <out.json>');
const file = CandidatesFile.parse(JSON.parse(readFileSync(candPath, 'utf8')));
const sourceIds = new Set(file.sources.map((s) => s.id));
const reviews: Record<string, ProductReview> = {};
for (const slug of readdirSync(dir)) {
  const f = join(dir, slug, 'decision.json');
  if (!existsSync(f)) continue;
  const key = JSON.parse(readFileSync(join(dir, slug, 'product.json'), 'utf8')).key as string;
  const r = JSON.parse(readFileSync(f, 'utf8')) as ProductReview;
  for (const [path, d] of Object.entries(r.fields)) {
    if (d.manual && !sourceIds.has(d.manual.source)) console.warn(`${key}: ${path} cites unknown source ${d.manual.source}; it would be dropped`);
  }
  reviews[key] = r;
}
for (const p of file.products) {
  const r = reviews[p.key];
  if (r) console.log(`${p.key}: ${isReviewed(p, r) ? 'reviewed' : 'NOT reviewed'}`);
}
const bundle = buildBundle(file, reviews);
const NOTE = 'Reviewed by an AI subagent against the cached maker document, not by a person.';
for (const part of bundle.parts) for (const s of Object.values(part.sources)) s.note = s.note ? `${s.note} ${NOTE}` : NOTE;
writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n');
console.log(`${bundle.parts.length} parts, ${bundle.excluded.length} excluded values -> ${out}`);
for (const e of bundle.excluded) console.log(`excluded ${e.part} ${e.path}: ${e.reason}`);
