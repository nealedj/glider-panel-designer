/**
 * Design rule checks. Each check returns results that the checks panel lists; clicking one
 * zooms to `box` and selects `ids`.
 *
 * Geometric front and rear checks live in `geometric.ts`; the data checks are here.
 */
import type { Box } from '../geom/shapes';
import { resolveTemplate, type PartGeometry } from '../model/resolve';
import type { Project } from '../model/schema';
import { frontChecks, rearChecks } from './geometric';
import { analyse } from '../wiring/circuit';
import { bundleChecks } from '../wiring/bundles';

export type Severity = 'error' | 'warning' | 'info';

export interface CheckResult {
  key: string;
  severity: Severity;
  area: 'front' | 'rear' | 'electrical' | 'pneumatic' | 'compass' | 'data';
  message: string;
  ids: string[];
  box?: Box;
}

let last: { doc: Project; geometry: Map<string, PartGeometry>; results: CheckResult[] } | null = null;

/** Checks for a document, computed once per document version and shared by every caller. */
export function runChecks(doc: Project, geometry: Map<string, PartGeometry>): CheckResult[] {
  if (last && last.doc === doc && last.geometry === geometry) return last.results;
  const results = computeChecks(doc, geometry);
  last = { doc, geometry, results };
  return results;
}

function computeChecks(doc: Project, geometry: Map<string, PartGeometry>): CheckResult[] {
  const out: CheckResult[] = [];

  // Data: parts not resolvable at all.
  for (const pp of doc.parts) {
    if (!geometry.has(pp.id)) {
      out.push({ key: `missing:${pp.id}`, severity: 'error', area: 'data', message: `${pp.label || pp.id}: part ${pp.part.id} v${pp.part.version} is not in the catalogue`, ids: [pp.id] });
    }
  }

  // Data: unverified catalogue values, grouped by catalogue part.
  const unverified = new Map<string, { model: string; ids: string[] }>();
  for (const [id, g] of geometry) {
    if (g.part.review === 'verified') continue;
    const e = unverified.get(g.part.id) ?? { model: g.part.model, ids: [] };
    e.ids.push(id);
    unverified.set(g.part.id, e);
  }
  for (const [partId, e] of unverified) {
    out.push({
      key: `unverified:${partId}`,
      severity: 'warning',
      area: 'data',
      message: `${e.model} (${e.ids.length}×) uses unverified catalogue values`,
      ids: e.ids,
    });
  }

  const template = resolveTemplate(doc);
  if (!template) {
    out.push({ key: 'template:missing', severity: 'error', area: 'data', message: 'Panel template not found', ids: [] });
  } else if (template.status === 'draft') {
    out.push({ key: 'template:draft', severity: 'warning', area: 'data', message: `Template “${template.name}” is a draft; verify it at 1:1 before cutting`, ids: [] });
  }

  out.push(...frontChecks(doc, geometry, template), ...rearChecks(doc, geometry, template), ...analyse(doc).results, ...bundleChecks(doc, geometry));

  // Worst first; within a severity, design problems before data notes.
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const areas: Record<CheckResult['area'], number> = { front: 0, rear: 1, electrical: 2, pneumatic: 3, compass: 4, data: 5 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || areas[a.area] - areas[b.area]);
}
