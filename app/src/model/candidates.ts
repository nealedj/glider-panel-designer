/**
 * The candidates file written by the discovery tools (tools/discover) and opened by the
 * Review tab, and the reviewed-parts bundle the Review tab exports. See ADR 0011.
 */
import { z } from 'zod';
import { CataloguePart, PartCategory } from './schema';

export const CANDIDATES_VERSION = 1;

export const CandidateSource = z.object({
  id: z.string(),
  kind: z.enum(['retailer', 'manual', 'maker-page', 'user']),
  url: z.string(),
  title: z.string().optional(),
  fetchedAt: z.string().nullable().optional(),
  /** True when the document is on the maker's own site. */
  makerHosted: z.boolean().optional(),
});
export type CandidateSource = z.infer<typeof CandidateSource>;

export const CandidateValue = z.object({
  /** Catalogue field path, e.g. front.cutout, rear.depth, weightG, power.currentA, connectors.pinout. */
  path: z.string(),
  value: z.unknown(),
  /** The text the value was read from, verbatim. */
  snippet: z.string(),
  source: z.string(),
  url: z.string(),
  confidence: z.number().min(0).max(1),
  method: z.string(),
  unit: z.string().optional(),
  page: z.number().int().optional(),
  note: z.string().optional(),
});
export type CandidateValue = z.infer<typeof CandidateValue>;

export const CandidateProduct = z.object({
  key: z.string(),
  maker: z.string(),
  model: z.string(),
  name: z.string(),
  category: PartCategory.nullable(),
  variant: z.string().nullable().optional(),
  /** Why the discovery tools split this size variant out, quoting the manual. */
  variantNote: z.string().optional(),
  /** Part of the reference panel (M5 acceptance tracks these). */
  reference: z.boolean().default(false),
  candidates: z.array(CandidateValue),
  /** Manual pages rendered for the reviewer (data URLs; local only). */
  drawings: z.array(z.object({ source: z.string(), page: z.number().int(), kind: z.string(), image: z.string() })).default([]),
  manuals: z.array(z.object({ source: z.string(), url: z.string(), title: z.string(), pages: z.number().nullable() })).default([]),
  face: z.object({ image: z.string(), shape: z.string(), pxPerMm: z.number().nullable(), source: z.string() }).optional(),
  /** Shop page details: local only, never exported. */
  retail: z.object({ url: z.string(), price: z.number().nullable(), currency: z.string().nullable(), image: z.string().nullable() }).optional(),
});
export type CandidateProduct = z.infer<typeof CandidateProduct>;

export const CandidatesFile = z.object({
  kind: z.literal('gpd-candidates'),
  schemaVersion: z.literal(CANDIDATES_VERSION),
  generated: z.string(),
  sources: z.array(CandidateSource),
  products: z.array(CandidateProduct),
});
export type CandidatesFile = z.infer<typeof CandidatesFile>;

/** What the Review tab exports for `python -m discover import-reviewed`. */
export const ReviewedBundle = z.object({
  kind: z.literal('gpd-reviewed-parts'),
  exported: z.string(),
  parts: z.array(CataloguePart),
  /** Accepted values left out of the catalogue, and why (e.g. only the shop said so). */
  excluded: z.array(z.object({ part: z.string(), path: z.string(), reason: z.string() })),
});
export type ReviewedBundle = z.infer<typeof ReviewedBundle>;
