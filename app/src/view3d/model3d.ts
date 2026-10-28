/**
 * The 3D view's scene, built from the project with no renderer attached: every solid is an
 * outline (with holes) extruded through a depth band, and every wire or loom is a 3D path.
 * The view only looks; nothing here is edited. See ADR 0014.
 *
 * Depth z is rearward from the panel back face (ADR 0004), so the panel plate spans
 * [-thickness, 0] and bezels stand proud in front of it, at negative z.
 */
import { runChecks } from '../checks/checks';
import { FLATTEN_TOL, insideMargin, shapesOverlap, toPolygon } from '../geom/region';
import { boxesIntersect, shapeBox, type Box } from '../geom/shapes';
import { projectGeometry, resolveTemplate } from '../model/resolve';
import type { BendLine, Project, Shape, Vec2 } from '../model/schema';
import { bundles } from '../wiring/bundles';
import { analyse } from '../wiring/circuit';
import { cssColour } from '../wiring/nets';
import { outerDiameter } from '../wiring/length';
import { partLabel, type Vec3 } from '../wiring/terminals';

export type SolidRole = 'panel' | 'bezel' | 'body';

export interface Solid {
  key: string;
  role: SolidRole;
  /** The placed part this belongs to; null for the panel. */
  partId: string | null;
  outline: Vec2[];
  holes: Vec2[][];
  /** Depth band, mm rearward from the panel back face. Equal ends mean a flat outline. */
  z0: number;
  z1: number;
  /** Drawn flat because the real thickness is unknown (null in the catalogue). */
  unknown: boolean;
  /** Bodies: depth shade from near (0) to far (1). */
  shade: number;
  clash: boolean;
}

export interface Path3 {
  key: string;
  /** The wire or route this draws. */
  id: string;
  points: Vec3[];
  diameterMm: number;
  colour: string;
}

export interface Model3D {
  solids: Solid[];
  bends: BendLine[];
  wires: Path3[];
  looms: Path3[];
  /** Plan extent of everything drawn, and its depth range. */
  box: Box;
  zMin: number;
  zMax: number;
  /** What could not be drawn as it really is, for the view's notes. */
  notes: string[];
  labels: Map<string, string>;
}

/** Bezels and outlines with no known thickness are drawn this far apart, so faces do not fight. */
export const FLAT_GAP = 0.2;

const pts = (s: Shape) => toPolygon(s).pts;

export function buildModel3d(doc: Project): Model3D {
  const template = resolveTemplate(doc);
  const geometry = projectGeometry(doc);
  const t = template?.thickness ?? 0;
  const solids: Solid[] = [];
  const notes: string[] = [];
  const labels = new Map<string, string>();
  const boxes: Box[] = [];
  let zMin = -t;
  let zMax = 0;

  const clash = new Set<string>();
  for (const r of runChecks(doc, geometry)) if (r.key.startsWith('clash:')) r.ids.forEach((i) => clash.add(i));

  // The panel plate, with the cuts through it. Cuts that overlap one another or cross the
  // outline cannot be triangulated as holes without a polygon boolean (ADR 0005); the checks
  // already flag them, so they are left out of the plate and noted here.
  if (template) {
    const cuts: Shape[] = [...template.fixings.map((f) => ({ kind: 'circle', cx: f.x, cy: f.y, d: f.d }) as Shape)];
    for (const g of geometry.values()) {
      if (g.mounted || g.part.offPanel) continue;
      cuts.push(...g.cutouts, ...g.holes.map((h) => ({ kind: 'circle', cx: h.x, cy: h.y, d: h.d }) as Shape));
    }
    const kept: { shape: Shape; box: Box }[] = [];
    let dropped = 0;
    for (const c of cuts) {
      const box = shapeBox(c);
      const bad = insideMargin(c, template.outline) <= FLATTEN_TOL || kept.some((k) => boxesIntersect(k.box, box) && shapesOverlap(k.shape, c));
      if (bad) dropped++;
      else kept.push({ shape: c, box });
    }
    if (dropped) notes.push(`${dropped} cut(s) overlap another cut or the panel edge and are not shown as holes; see the checks`);
    solids.push({ key: 'panel', role: 'panel', partId: null, outline: pts(template.outline), holes: kept.map((k) => pts(k.shape)), z0: -t, z1: 0, unknown: false, shade: 0, clash: false });
    boxes.push(shapeBox(template.outline));
    if (template.bendLines.length) notes.push('The panel is shown flat (developed); the template gives no bend angles');
  } else notes.push('No template, so no panel plate is drawn');

  const maxDepth = Math.max(1, ...[...geometry.values()].map((g) => g.z1 ?? 0));
  const unknownDepth: string[] = [];
  const noBody: string[] = [];
  const unknownProud: string[] = [];
  let offPanel = 0;
  for (const pp of doc.parts) {
    const g = geometry.get(pp.id);
    if (!g) continue;
    const name = partLabel(pp, g);
    labels.set(pp.id, name);
    if (g.part.offPanel) {
      offPanel++;
      continue;
    }
    if (g.bezel) {
      const proud = g.part.front.protrusion;
      if (proud === null) unknownProud.push(name);
      const z0 = -t - (proud || FLAT_GAP);
      solids.push({ key: `bezel:${pp.id}`, role: 'bezel', partId: pp.id, outline: pts(g.bezel), holes: [], z0, z1: -t, unknown: proud === null, shade: 0, clash: false });
      boxes.push(shapeBox(g.bezel));
      zMin = Math.min(zMin, z0);
    }
    if (!g.body) {
      if (g.z1 !== null && g.z1 > g.z0) noBody.push(name);
      continue;
    }
    if (g.z1 === null) unknownDepth.push(name);
    // A body with unknown depth is drawn as its outline at the front of its band, no deeper.
    const z1 = g.z1 ?? g.z0 + FLAT_GAP;
    solids.push({ key: `body:${pp.id}`, role: 'body', partId: pp.id, outline: pts(g.body), holes: [], z0: g.z0, z1, unknown: g.z1 === null, shade: g.z1 === null ? 0 : Math.min(1, g.z1 / maxDepth), clash: clash.has(pp.id) });
    boxes.push(shapeBox(g.body));
    zMax = Math.max(zMax, z1);
  }
  if (unknownDepth.length) notes.push(`Depth unknown, drawn as a flat outline: ${unknownDepth.join(', ')}`);
  if (noBody.length) notes.push(`No body outline, so not drawn behind the panel: ${noBody.join(', ')}`);
  if (unknownProud.length) notes.push(`How far the bezel stands proud is unknown, drawn flat: ${unknownProud.join(', ')}`);
  if (offPanel) notes.push(`${offPanel} off-panel part(s) are not drawn; their wires run to where they are placed`);

  const a = analyse(doc);
  const wires: Path3[] = [];
  for (const w of doc.wires) {
    const c = a.wires.get(w.id);
    if (!c?.length || c.length.path.length < 2) continue;
    wires.push({ key: `wire:${w.id}`, id: w.id, points: c.length.path, diameterMm: outerDiameter(w, c.sizeMm2), colour: cssColour(w.colour) });
  }
  const looms: Path3[] = [];
  for (const b of bundles(doc)) {
    if (b.route.points.length < 2) continue;
    looms.push({ key: `loom:${b.route.id}`, id: b.route.id, points: b.route.points, diameterMm: Math.max(b.diameterMm, 2), colour: '' });
  }
  for (const p of [...wires, ...looms].flatMap((w) => w.points)) {
    zMin = Math.min(zMin, p.z);
    zMax = Math.max(zMax, p.z);
  }

  const box = boxes.length ? boxes.reduce((u, b) => ({ minX: Math.min(u.minX, b.minX), minY: Math.min(u.minY, b.minY), maxX: Math.max(u.maxX, b.maxX), maxY: Math.max(u.maxY, b.maxY) })) : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  return { solids, bends: template?.bendLines ?? [], wires, looms, box, zMin, zMax, notes, labels };
}
