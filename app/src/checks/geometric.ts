/**
 * Geometric design rule checks: front (cuts against each other, the outline, keep-outs and
 * bend lines) and rear (clashes in plan and depth, available depth).
 */
import { FLATTEN_TOL, distanceToLine, insideMargin, separation, shapesOverlap } from '../geom/region';
import { holeBox, shapeBox, shapeContains, unionBox, type Box } from '../geom/shapes';
import type { PartGeometry } from '../model/resolve';
import type { KeepOut, PanelTemplate, Project, Shape } from '../model/schema';
import type { CheckResult } from './checks';

/** A cut feature of one part: a cutout or a screw hole, as a world shape. */
interface Cut {
  part: string;
  shape: Shape;
  kind: 'cutout' | 'hole';
}

const label = (doc: Project, id: string) => {
  const pp = doc.parts.find((p) => p.id === id);
  return pp?.label || pp?.id || id;
};

const fmt = (mm: number) => `${(Math.round(mm * 10) / 10).toFixed(1)} mm`;

function cutsOf(g: PartGeometry): Cut[] {
  return [
    ...g.cutouts.map((shape): Cut => ({ part: g.id, shape, kind: 'cutout' })),
    ...g.holes.map((h): Cut => ({ part: g.id, shape: { kind: 'circle', cx: h.x, cy: h.y, d: h.d }, kind: 'hole' })),
  ];
}

function cutBox(c: Cut): Box {
  return shapeBox(c.shape);
}

function boxesWithin(a: Box, b: Box, gap: number): boolean {
  return a.minX - gap <= b.maxX && a.maxX + gap >= b.minX && a.minY - gap <= b.maxY && a.maxY + gap >= b.minY;
}

/** Pairs of parts whose boxes come within `gap` of each other, by sweeping along x. */
function nearPairs<T>(items: T[], box: (t: T) => Box, gap: number): [T, T][] {
  const sorted = items.map((t) => ({ t, b: box(t) })).sort((a, b) => a.b.minX - b.b.minX);
  const out: [T, T][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.b.minX > a.b.maxX + gap) break;
      if (boxesWithin(a.b, b.b, gap)) out.push([a.t, b.t]);
    }
  }
  return out;
}

export function frontChecks(doc: Project, geometry: Map<string, PartGeometry>, template: PanelTemplate | undefined): CheckResult[] {
  const out: CheckResult[] = [];
  const s = doc.settings;
  const parts = [...geometry.values()].filter((g) => !g.mounted);

  // Cuts against each other, part by part.
  const ligament = s.minLigamentMm;
  const flaggedPairs = new Set<string>();
  for (const [a, b] of nearPairs(parts, (g) => g.frontBox, ligament ?? 0)) {
    const key = [a.id, b.id].sort().join('|');
    let worst = Infinity;
    let worstBox: Box | null = null;
    for (const ca of cutsOf(a)) {
      for (const cb of cutsOf(b)) {
        if (!boxesWithin(cutBox(ca), cutBox(cb), ligament ?? 0)) continue;
        const d = separation(ca.shape, cb.shape, (ligament ?? 0) + 1);
        if (d < worst) {
          worst = d;
          worstBox = unionBox([cutBox(ca), cutBox(cb)]);
        }
      }
    }
    if (worst < -FLATTEN_TOL) {
      flaggedPairs.add(key);
      out.push({ key: `overlap:${key}`, severity: 'error', area: 'front', message: `${label(doc, a.id)} and ${label(doc, b.id)}: cutouts or screw holes overlap`, ids: [a.id, b.id], box: worstBox! });
    } else if (ligament !== null && worst < ligament - FLATTEN_TOL) {
      flaggedPairs.add(key);
      out.push({
        key: `ligament:${key}`,
        severity: 'warning',
        area: 'front',
        message: `${label(doc, a.id)} and ${label(doc, b.id)}: ${fmt(Math.max(0, worst))} of material between cuts (minimum ${fmt(ligament)})`,
        ids: [a.id, b.id],
        box: worstBox!,
      });
    }
  }

  // Bezels overlap though the cuts do not.
  for (const [a, b] of nearPairs(parts, (g) => g.frontBox, 0)) {
    const key = [a.id, b.id].sort().join('|');
    if (flaggedPairs.has(key) || !a.bezel || !b.bezel) continue;
    if (shapesOverlap(a.bezel, b.bezel, 0.05)) {
      out.push({ key: `bezel:${key}`, severity: 'warning', area: 'front', message: `${label(doc, a.id)} and ${label(doc, b.id)}: bezels overlap`, ids: [a.id, b.id], box: unionBox([shapeBox(a.bezel), shapeBox(b.bezel)])! });
    }
  }

  if (template) {
    const kos: KeepOut[] = [...template.keepOuts, ...doc.keepOuts];
    for (const g of parts) {
      const cuts = cutsOf(g);
      if (!cuts.length) continue;
      const name = label(doc, g.id);

      // Outline and edge distance.
      let margin = Infinity;
      for (const c of cuts) margin = Math.min(margin, insideMargin(c.shape, template.outline));
      if (margin < -FLATTEN_TOL) {
        out.push({ key: `outside:${g.id}`, severity: 'error', area: 'front', message: `${name}: cut outside the panel outline`, ids: [g.id], box: g.frontBox });
      } else if (s.minEdgeDistanceMm !== null && margin < s.minEdgeDistanceMm - FLATTEN_TOL) {
        out.push({
          key: `edge:${g.id}`,
          severity: 'warning',
          area: 'front',
          message: `${name}: cut ${fmt(Math.max(0, margin))} from the panel edge (minimum ${fmt(s.minEdgeDistanceMm)})`,
          ids: [g.id],
          box: g.frontBox,
        });
      }

      // Keep-out zones and existing fixings.
      for (const k of kos) {
        if (cuts.some((c) => shapesOverlap(c.shape, k.shape))) {
          out.push({ key: `keepout:${g.id}:${k.id}`, severity: 'error', area: 'front', message: `${name}: cuts into keep-out “${k.label}”`, ids: [g.id, k.id], box: unionBox([g.frontBox, shapeBox(k.shape)])! });
        }
      }
      template.fixings.forEach((f, i) => {
        const fix: Shape = { kind: 'circle', cx: f.x, cy: f.y, d: f.d };
        if (cuts.some((c) => shapesOverlap(c.shape, fix))) {
          out.push({ key: `fixing:${g.id}:${i}`, severity: 'error', area: 'front', message: `${name}: cuts into a panel fixing`, ids: [g.id], box: unionBox([g.frontBox, holeBox(f)])! });
        }
      });

      // Bend lines.
      if (s.minBendDistanceMm !== null) {
        template.bendLines.forEach((bl, i) => {
          const d = Math.min(...cuts.map((c) => distanceToLine(c.shape, bl.a, bl.b)));
          if (d < s.minBendDistanceMm! - FLATTEN_TOL) {
            out.push({
              key: `bend:${g.id}:${i}`,
              severity: 'error',
              area: 'front',
              message: `${name}: cut ${fmt(d)} from ${bl.label ? `bend “${bl.label}”` : 'a bend line'} (minimum ${fmt(s.minBendDistanceMm!)})`,
              ids: [g.id],
              box: g.frontBox,
            });
          }
        });
      }

      // Forward protrusion against canopy clearance.
      const proud = g.part.front.protrusion;
      if (template.canopyClearance !== null && proud !== null && proud > template.canopyClearance) {
        out.push({
          key: `canopy:${g.id}`,
          severity: 'warning',
          area: 'front',
          message: `${name}: stands ${fmt(proud)} proud, more than the ${fmt(template.canopyClearance)} canopy clearance`,
          ids: [g.id],
          box: g.frontBox,
        });
      }
    }
  }

  const unset: string[] = [];
  if (s.minLigamentMm === null) unset.push('material between cuts');
  if (s.minEdgeDistanceMm === null) unset.push('edge distance');
  if (s.minBendDistanceMm === null && template?.bendLines.length) unset.push('bend distance');
  if (unset.length) {
    out.push({ key: 'thresholds:unset', severity: 'info', area: 'front', message: `No minimum set for ${unset.join(', ')}, so those checks are off. Set them under Project.`, ids: [] });
  }
  return out;
}

/** Free depth behind the panel at a part: the shallowest depth region its body touches, else the template default. */
export function availableDepthAt(template: PanelTemplate, g: PartGeometry): number | null {
  let best: number | null = null;
  const footprint: Shape = g.body ?? { kind: 'rect', cx: (g.rearBox.minX + g.rearBox.maxX) / 2, cy: (g.rearBox.minY + g.rearBox.maxY) / 2, w: g.rearBox.maxX - g.rearBox.minX, h: g.rearBox.maxY - g.rearBox.minY, r: 0 };
  for (const r of template.availableDepth.regions) {
    const touches = shapesOverlap(footprint, r.shape) || shapeContains(r.shape, { x: g.transform.x, y: g.transform.y });
    if (touches && (best === null || r.depth < best)) best = r.depth;
  }
  return best ?? template.availableDepth.default;
}

/** Clearance a part needs behind its rear face for plugs and cable bends. */
export function rearClearance(g: PartGeometry): number {
  let c = 0;
  for (const con of g.part.connectors) if (con.face === 'rear' && con.clearance !== null) c = Math.max(c, con.clearance);
  return c;
}

/** True if two depth bands share more than a hair of depth. */
export function depthsOverlap(a: PartGeometry, b: PartGeometry, tol = FLATTEN_TOL): boolean {
  if (a.z1 === null || b.z1 === null) return false;
  return Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > tol;
}

export function rearChecks(doc: Project, geometry: Map<string, PartGeometry>, template: PanelTemplate | undefined): CheckResult[] {
  const out: CheckResult[] = [];
  const bodies = [...geometry.values()].filter((g) => g.body);

  // Clash: overlap in plan and in depth.
  for (const [a, b] of nearPairs(bodies, (g) => g.rearBox, 0)) {
    if (!depthsOverlap(a, b)) continue;
    if (!shapesOverlap(a.body!, b.body!)) continue;
    const zFrom = Math.max(a.z0, b.z0);
    const zTo = Math.min(a.z1!, b.z1!);
    out.push({
      key: `clash:${[a.id, b.id].sort().join('|')}`,
      severity: 'error',
      area: 'rear',
      message: `${label(doc, a.id)} and ${label(doc, b.id)} clash behind the panel (depth ${fmt(zFrom)} to ${fmt(zTo)})`,
      ids: [a.id, b.id],
      box: unionBox([a.rearBox, b.rearBox])!,
    });
  }

  // Available depth.
  const unknown: string[] = [];
  for (const g of bodies) {
    if (g.z1 === null) {
      unknown.push(g.id);
      continue;
    }
    if (!template) continue;
    const free = availableDepthAt(template, g);
    if (free === null) continue;
    const clearance = rearClearance(g);
    const need = g.z1 + clearance;
    if (need > free + FLATTEN_TOL) {
      out.push({
        key: `depth:${g.id}`,
        severity: 'error',
        area: 'rear',
        message: `${label(doc, g.id)} needs ${fmt(need)} behind the panel${clearance ? ` with ${fmt(clearance)} connector clearance` : ''}; ${fmt(free)} is free there`,
        ids: [g.id],
        box: g.rearBox,
      });
    }
  }
  if (unknown.length) {
    out.push({ key: 'depth:unknown', severity: 'warning', area: 'rear', message: `${unknown.length} part(s) have unknown depth, so clash and depth checks skip them`, ids: unknown });
  }
  if (template && template.availableDepth.default === null && !template.availableDepth.regions.length) {
    out.push({ key: 'depth:template', severity: 'info', area: 'rear', message: `Template “${template.name}” gives no free depth, so the depth check is off`, ids: [] });
  }
  return out;
}
