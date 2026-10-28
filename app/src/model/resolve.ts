/**
 * Resolve placed parts and templates against the catalogue, and compute world geometry.
 */
import { buildGeneric, GENERIC_BY_ID } from '../catalogue/generic';
import { findPart, findTemplate } from '../catalogue';
import { holeBox, shapeBox, transformShape, unionBox, type Box, type Transform } from '../geom/shapes';
import type { CataloguePart, Hole, PanelTemplate, PlacedPart, Project, Shape } from './schema';

const genericCache = new Map<string, CataloguePart>();

/** The catalogue part for a placed part, with any parametric overrides applied. */
export function resolvePart(pp: PlacedPart, project: Pick<Project, 'customParts'>): CataloguePart | undefined {
  const base = findPart(pp.part, project.customParts);
  if (!base) return undefined;
  if (!base.generator || !pp.params || !Object.keys(pp.params).length) return base;
  const def = GENERIC_BY_ID.get(base.generator);
  if (!def) return base;
  const key = `${base.generator}:${JSON.stringify(pp.params)}`;
  let built = genericCache.get(key);
  if (!built) {
    built = buildGeneric(def, pp.params);
    genericCache.set(key, built);
  }
  return built;
}

export function resolveTemplate(project: Pick<Project, 'template'>): PanelTemplate | undefined {
  return 'embedded' in project.template ? project.template.embedded : findTemplate(project.template.ref);
}

/** Where a part sits: world transform, and the start of its depth band behind the panel. */
export interface Placement extends Transform {
  /** Depth of the part's front face behind the panel back face, mm. */
  z0: number;
  /** True when the part hangs off another part rather than the panel. */
  mounted: boolean;
}

/**
 * World placement of a part, following its mounted-to chain. Offsets are in world axes:
 * a child sits at its parent's position plus (dx, dy), and its depth band starts at the
 * parent's front face plus dz. Depth offsets add on top.
 */
export function partPlacement(pp: PlacedPart, byId: Map<string, PlacedPart>, seen = new Set<string>()): Placement {
  if (pp.mountedTo && !seen.has(pp.id)) {
    const parent = byId.get(pp.mountedTo.parent);
    if (parent) {
      seen.add(pp.id);
      const pt = partPlacement(parent, byId, seen);
      return { x: pt.x + pp.mountedTo.dx, y: pt.y + pp.mountedTo.dy, rotation: pp.rotation, z0: pt.z0 + pp.mountedTo.dz + pp.depthOffset, mounted: true };
    }
  }
  return { x: pp.x, y: pp.y, rotation: pp.rotation, z0: pp.depthOffset, mounted: false };
}

/** World position of a part, following its mounted-to chain. */
export function partTransform(pp: PlacedPart, byId: Map<string, PlacedPart>): Transform {
  const { x, y, rotation } = partPlacement(pp, byId);
  return { x, y, rotation };
}

export interface PartGeometry {
  id: string;
  part: CataloguePart;
  transform: Transform;
  /** Mounted to another part, so it cuts nothing in the panel. */
  mounted: boolean;
  cutouts: Shape[];
  bezel: Shape | null;
  holes: Hole[];
  body: Shape | null;
  /** Front footprint: bezel plus cutouts plus holes, or the body for parts behind the panel. */
  frontBox: Box;
  /** Rear footprint: the body, or the front footprint when the body is unknown. */
  rearBox: Box;
  /** Depth band behind the panel back face; z1 is null when the part's depth is unknown. */
  z0: number;
  z1: number | null;
}

export function partGeometry(pp: PlacedPart, part: CataloguePart, t: Transform | Placement): PartGeometry {
  const mounted = 'mounted' in t ? t.mounted : false;
  const z0 = 'z0' in t ? t.z0 : pp.depthOffset;
  const tr = { x: t.x, y: t.y, rotation: t.rotation };
  // A part mounted behind another does not reach the panel, so nothing of it is cut.
  const cutouts = mounted ? [] : part.front.cutouts.map((s) => transformShape(s, tr));
  const bezel = !mounted && part.front.bezel ? transformShape(part.front.bezel, tr) : null;
  const holes = mounted
    ? []
    : part.front.screwHoles.map((h) => {
        const s = transformShape({ kind: 'circle', cx: h.x, cy: h.y, d: h.d }, tr);
        return s.kind === 'circle' ? { x: s.cx, y: s.cy, d: s.d } : h;
      });
  const body = part.rear.body ? transformShape(part.rear.body, tr) : null;
  const boxes = [...cutouts.map(shapeBox), ...holes.map(holeBox)];
  if (bezel) boxes.push(shapeBox(bezel));
  const bodyBox = body ? shapeBox(body) : null;
  const fallback = { minX: t.x - 5, minY: t.y - 5, maxX: t.x + 5, maxY: t.y + 5 };
  const frontBox = unionBox(boxes) ?? bodyBox ?? fallback;
  const rearBox = bodyBox ?? frontBox;
  const z1 = part.rear.depth === null ? null : z0 + part.rear.depth;
  return { id: pp.id, part, transform: tr, mounted, cutouts, bezel, holes, body, frontBox, rearBox, z0, z1 };
}

// Unmounted parts depend only on their own record, so their geometry is cached by identity.
// This keeps per-part objects stable between edits, so unchanged parts skip re-rendering.
let geomCache = new WeakMap<PlacedPart, PartGeometry>();
let cachedCustomParts: unknown = null;

/** Geometry for every resolvable part in the project, keyed by placed-part id. */
let lastProject: Project | null = null;
let lastGeometry: Map<string, PartGeometry> | null = null;

export function projectGeometry(project: Project): Map<string, PartGeometry> {
  // Documents are immutable, so the same document always gives the same geometry; sharing
  // the map lets the canvas and the checks panel share cached check results too.
  if (project === lastProject && lastGeometry) return lastGeometry;
  const out = computeGeometry(project);
  lastProject = project;
  lastGeometry = out;
  return out;
}

function computeGeometry(project: Project): Map<string, PartGeometry> {
  if (project.customParts !== cachedCustomParts) {
    geomCache = new WeakMap();
    cachedCustomParts = project.customParts;
  }
  const byId = new Map(project.parts.map((p) => [p.id, p]));
  const out = new Map<string, PartGeometry>();
  for (const pp of project.parts) {
    let g = pp.mountedTo ? undefined : geomCache.get(pp);
    if (!g) {
      const part = resolvePart(pp, project);
      if (!part) continue;
      g = partGeometry(pp, part, partPlacement(pp, byId));
      if (!pp.mountedTo) geomCache.set(pp, g);
    }
    out.set(pp.id, g);
  }
  return out;
}

/** Ids of every part mounted, directly or through others, to any of `ids`. */
export function descendants(parts: PlacedPart[], ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const frontier = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of parts) {
      if (p.mountedTo && (frontier.has(p.mountedTo.parent) || out.has(p.mountedTo.parent)) && !out.has(p.id) && !frontier.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}
