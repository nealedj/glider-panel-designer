/**
 * From review decisions to catalogue parts. Pure functions, so the rules are testable:
 * - only accepted values are used; everything else stays null and unverified;
 * - a value whose source is the retailer (or anything hosted on its site) is left out of the
 *   catalogue export, because committed values must cite the maker's documents (rule 7);
 * - every exported value carries its source URL and snippet, marked verified.
 */
import type { CandidateProduct, CandidatesFile, CandidateSource, CandidateValue, ReviewedBundle } from '../model/candidates';
import { CataloguePart, type Connector, type FieldSource, type PartCategory, type Shape } from '../model/schema';

/** A value the reviewer typed, read from a source document (e.g. a dimension drawing). */
export interface ManualEntry {
  value: unknown;
  source: string;
  page?: number;
  /** What the reviewer read it from, e.g. "Drawing on page 12: cut-out Ø57". */
  snippet: string;
}

export interface FieldDecision {
  /** Indices into the product's candidates that were accepted (several for pinouts). */
  accepted: number[];
  /** Candidates explicitly rejected. */
  rejected: number[];
  manual?: ManualEntry;
}

export interface ProductReview {
  fields: Record<string, FieldDecision>;
  /** Identity overrides. */
  maker?: string;
  model?: string;
  category?: PartCategory | null;
  /** Set when the reviewer has been through every field. */
  done?: boolean;
}

/** Field paths in the order the reviewer sees them, with labels. */
export const FIELD_ORDER: { path: string; label: string; exported: boolean; multi?: boolean }[] = [
  { path: 'front.cutout', label: 'Panel cut-out', exported: true },
  { path: 'front.bezel', label: 'Bezel (front face)', exported: true },
  { path: 'front.screwHoles', label: 'Screw holes', exported: true },
  { path: 'front.protrusion', label: 'Stands proud of the panel', exported: true },
  { path: 'rear.depth', label: 'Depth behind the panel', exported: true },
  { path: 'rear.body', label: 'Body (rear outline)', exported: true },
  { path: 'weightG', label: 'Weight', exported: true },
  { path: 'power.currentA', label: 'Current draw', exported: true },
  { path: 'power.voltage', label: 'At voltage', exported: true },
  { path: 'connectors.pinout', label: 'Connector pinouts', exported: true, multi: true },
  { path: 'datasheet', label: 'Datasheet or manual link', exported: true },
  { path: 'connectors.types', label: 'Connector types mentioned', exported: false },
  { path: 'power.supplyV', label: 'Supply range', exported: false },
];

export function pathsOf(p: CandidateProduct): string[] {
  const present = new Set(p.candidates.map((c) => c.path));
  return FIELD_ORDER.filter((f) => present.has(f.path)).map((f) => f.path);
}

/** Has every field with candidates got a decision (accepted, rejected or entered)? */
export function isReviewed(p: CandidateProduct, r: ProductReview | undefined): boolean {
  if (!r) return false;
  if (r.done) return true;
  return pathsOf(p).every((path) => {
    const d = r.fields[path];
    if (!d) return false;
    const n = p.candidates.filter((c) => c.path === path).length;
    return d.accepted.length > 0 || !!d.manual || d.rejected.length >= n;
  });
}

export function progress(p: CandidateProduct, r: ProductReview | undefined): { done: number; total: number } {
  const paths = pathsOf(p);
  const done = paths.filter((path) => {
    const d = r?.fields[path];
    if (!d) return false;
    const n = p.candidates.filter((c) => c.path === path).length;
    return d.accepted.length > 0 || !!d.manual || d.rejected.length >= n;
  }).length;
  return { done, total: paths.length };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function partId(p: CandidateProduct, r?: ProductReview): string {
  const maker = r?.maker ?? p.maker;
  const model = r?.model ?? p.model;
  return [slug(maker), slug(model), p.variant ? slug(p.variant) : ''].filter(Boolean).join('.');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Hosts of every retailer source in the file: anything on them is retailer provenance. */
export function retailerHosts(file: Pick<CandidatesFile, 'sources'>): Set<string> {
  return new Set(file.sources.filter((s) => s.kind === 'retailer').map((s) => hostOf(s.url)));
}

export function isRetailerUrl(url: string, hosts: Set<string>): boolean {
  return hosts.has(hostOf(url));
}

function shapeOf(v: unknown): Shape | null {
  const o = v as { kind?: string; d?: number; w?: number; h?: number; r?: number };
  if (o?.kind === 'circle' && typeof o.d === 'number' && o.d > 0) return { kind: 'circle', cx: 0, cy: 0, d: o.d };
  if (o?.kind === 'rect' && typeof o.w === 'number' && typeof o.h === 'number' && o.w > 0 && o.h > 0) return { kind: 'rect', cx: 0, cy: 0, w: o.w, h: o.h, r: o.r ?? 0 };
  return null;
}

const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Square pattern of `count` holes (4) on `spacing`, diameter `d`. */
function holesOf(v: unknown): { x: number; y: number; d: number }[] {
  const o = v as { spacing?: number; d?: number };
  if (typeof o?.spacing !== 'number' || typeof o?.d !== 'number') return [];
  const s = o.spacing / 2;
  return [
    { x: -s, y: s, d: o.d },
    { x: s, y: s, d: o.d },
    { x: -s, y: -s, d: o.d },
    { x: s, y: -s, d: o.d },
  ];
}

const CONNECTOR_TYPES = /RJ-?45|RJ-?12|RJ-?11|D-?Sub\s?\d+|DB-?\d+|Mini-?USB|USB-?C|SMA|BNC|Molex/i;

export interface BuiltPart {
  part: CataloguePart;
  excluded: { path: string; reason: string }[];
}

/** One accepted value with where it came from. */
interface Chosen {
  value: unknown;
  url: string;
  snippet: string;
  page?: number;
  note?: string;
}

function chosenFor(p: CandidateProduct, r: ProductReview, path: string, sources: Map<string, CandidateSource>): Chosen[] {
  const d = r.fields[path];
  if (!d) return [];
  const out: Chosen[] = d.accepted.map((i) => p.candidates[i]!).map((c: CandidateValue) => ({ value: c.value, url: c.url, snippet: c.snippet, page: c.page, note: c.note }));
  if (d.manual) {
    const src = sources.get(d.manual.source);
    if (src) out.push({ value: d.manual.value, url: src.url, snippet: d.manual.snippet, page: d.manual.page, note: 'Entered by the reviewer from the source document.' });
  }
  return out;
}

export function buildPart(file: CandidatesFile, p: CandidateProduct, r: ProductReview): BuiltPart {
  const sources = new Map(file.sources.map((s) => [s.id, s]));
  const hosts = retailerHosts(file);
  const excluded: BuiltPart['excluded'] = [];
  const fieldSources: Record<string, FieldSource> = {};

  /** The accepted value for a single-valued path, if it may go in the catalogue. */
  const take = (path: string): Chosen | null => {
    const all = chosenFor(p, r, path, sources);
    const ok = all.filter((c) => !isRetailerUrl(c.url, hosts));
    if (all.length && !ok.length) excluded.push({ path, reason: 'Only the shop page gives this value; the catalogue needs a maker document.' });
    const c = ok[0];
    if (!c) return null;
    fieldSources[path] = { url: c.url, snippet: c.snippet, status: 'verified', ...(c.page ? { note: `Page ${c.page}.${c.note ? ' ' + c.note : ''}` } : c.note ? { note: c.note } : {}) };
    return c;
  };

  const cutout = take('front.cutout');
  const bezel = take('front.bezel');
  const holes = take('front.screwHoles');
  const protrusion = take('front.protrusion');
  const depth = take('rear.depth');
  const body = take('rear.body');
  const weight = take('weightG');
  const current = take('power.currentA');
  const voltage = take('power.voltage');
  const datasheet = take('datasheet');

  const connectors: Connector[] = [];
  for (const c of chosenFor(p, r, 'connectors.pinout', sources)) {
    if (isRetailerUrl(c.url, hosts)) {
      excluded.push({ path: 'connectors.pinout', reason: 'A pinout from the shop page; the catalogue needs a maker document.' });
      continue;
    }
    const v = c.value as { name?: string | null; pins?: Connector['pins'] };
    if (!v?.pins?.length) continue;
    const id = slug(v.name ?? '') || `x${connectors.length + 1}`;
    connectors.push({ id, type: (v.name && CONNECTOR_TYPES.exec(v.name)?.[0]) || v.name || 'unknown', x: 0, y: 0, face: 'rear', clearance: null, pins: v.pins });
    fieldSources[`connectors.${id}`] = { url: c.url, snippet: c.snippet, status: 'verified', ...(c.page ? { note: `Page ${c.page}.` } : {}) };
  }

  const cutShape = cutout ? shapeOf(cutout.value) : null;
  const part = CataloguePart.parse({
    id: partId(p, r),
    version: 1,
    maker: r.maker ?? p.maker,
    model: [r.model ?? p.model, p.variant].filter(Boolean).join(' '),
    category: r.category ?? p.category ?? 'other',
    front: {
      cutouts: cutShape ? [cutShape] : [],
      bezel: bezel ? shapeOf(bezel.value) : null,
      screwHoles: holes ? holesOf(holes.value) : [],
      protrusion: protrusion ? asNumber(protrusion.value) : null,
    },
    rear: { body: body ? shapeOf(body.value) : null, depth: depth ? asNumber(depth.value) : null },
    connectors,
    power: current || voltage ? { currentA: current ? asNumber(current.value) : null, voltage: voltage ? asNumber(voltage.value) : null } : null,
    weightG: weight ? asNumber(weight.value) : null,
    datasheet: datasheet && typeof datasheet.value === 'string' ? datasheet.value : null,
    sources: fieldSources,
    review: Object.keys(fieldSources).length ? 'verified' : 'unverified',
  });
  return { part, excluded };
}

export function buildBundle(file: CandidatesFile, reviews: Record<string, ProductReview>, onlyReviewed = true): ReviewedBundle {
  const parts: CataloguePart[] = [];
  const excluded: ReviewedBundle['excluded'] = [];
  for (const p of file.products) {
    const r = reviews[p.key];
    if (!r || (onlyReviewed && !isReviewed(p, r))) continue;
    const b = buildPart(file, p, r);
    if (!Object.keys(b.part.sources).length) continue;
    parts.push(b.part);
    for (const e of b.excluded) excluded.push({ part: b.part.id, ...e });
  }
  return { kind: 'gpd-reviewed-parts', exported: new Date().toISOString(), parts, excluded };
}
