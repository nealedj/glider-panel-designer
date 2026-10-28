/**
 * Bundles: the wires and tubes sharing a route, their estimated diameter, and the check
 * that a bundle does not pass through a part's body at the same depth.
 */
import type { CheckResult } from '../checks/checks';
import { shapeContains } from '../geom/shapes';
import type { PartGeometry } from '../model/resolve';
import type { Project, Route } from '../model/schema';
import { analyse } from './circuit';
import { bundleDiameter, outerDiameter } from './length';

export interface Bundle {
  route: Route;
  wires: string[];
  diameterMm: number;
}

export function bundles(doc: Project): Bundle[] {
  const a = analyse(doc);
  return doc.routes.map((route) => {
    const ws = doc.wires.filter((w) => w.route === route.id);
    const ods = ws.map((w) => outerDiameter(w, a.wires.get(w.id)?.sizeMm2 ?? null));
    return { route, wires: ws.map((w) => w.id), diameterMm: bundleDiameter(ods) };
  });
}

export function bundleChecks(doc: Project, geometry: Map<string, PartGeometry>): CheckResult[] {
  const out: CheckResult[] = [];
  for (const b of bundles(doc)) {
    if (!b.wires.length) continue;
    const r = b.diameterMm / 2;
    const hit = new Set<string>();
    const pts = b.route.points;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      const n = Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const s = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
        for (const g of geometry.values()) {
          if (!g.body || g.part.offPanel || hit.has(g.id)) continue;
          const z1 = g.z1 ?? g.z0;
          if (s.z + r <= g.z0 || s.z - r >= z1) continue;
          if (shapeContains(g.body, s, r)) hit.add(g.id);
        }
      }
    }
    for (const id of hit) {
      const pp = doc.parts.find((p) => p.id === id)!;
      out.push({
        key: `bundle:${b.route.id}|${id}`,
        severity: 'warning',
        area: 'rear',
        message: `${b.route.label || 'A route'} (bundle about ${b.diameterMm.toFixed(1)} mm) passes through ${pp.label || geometry.get(id)!.part.model} at the same depth`,
        ids: [id, b.route.id],
      });
    }
  }
  return out;
}
