/**
 * The cut drawing: what every fabrication export draws, as layered entities in world mm
 * (y up, origin at the panel datum, front view). The SVG, DXF and PDF writers each turn
 * this into their own format, so they always agree. See ADR 0008.
 */
import { runChecks, type CheckResult } from '../checks/checks';
import { arrowStrokes, dimensionEndPoint, dimensionGeometry, textWidth, type DimensionGeometry } from '../geom/annotation';
export { CAP_HEIGHT } from '../geom/annotation';
import { shapeBox, unionBox, type Box } from '../geom/shapes';
import { projectGeometry, resolveTemplate } from '../model/resolve';
import type { PanelTemplate, Project, Shape, Vec2 } from '../model/schema';
import { formatLength, type Units } from '../util/units';

export type LayerId = 'outline' | 'cutouts' | 'holes' | 'bends' | 'engrave' | 'keepouts' | 'dimensions' | 'notes';

export interface LayerDef {
  id: LayerId;
  /** Layer name in SVG and DXF files. */
  name: string;
  /** True for layers a machine should cut, score or engrave; the rest are reference only. */
  machined: boolean;
  /** AutoCAD colour index for DXF. */
  aci: number;
  /** Stroke colour for SVG and PDF. */
  colour: string;
}

export const LAYERS: LayerDef[] = [
  { id: 'outline', name: 'OUTLINE', machined: true, aci: 7, colour: '#000000' },
  { id: 'cutouts', name: 'CUTOUTS', machined: true, aci: 1, colour: '#d11a1a' },
  { id: 'holes', name: 'SCREW_HOLES', machined: true, aci: 5, colour: '#1f4fd1' },
  { id: 'bends', name: 'BEND_LINES', machined: true, aci: 3, colour: '#118a3a' },
  { id: 'engrave', name: 'ENGRAVING', machined: true, aci: 6, colour: '#a01aa0' },
  { id: 'keepouts', name: 'KEEP_OUTS_REFERENCE', machined: false, aci: 8, colour: '#9a9a9a' },
  { id: 'dimensions', name: 'DIMENSIONS_REFERENCE', machined: false, aci: 8, colour: '#6b6b6b' },
  { id: 'notes', name: 'NOTES_REFERENCE', machined: false, aci: 8, colour: '#444444' },
];
export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

export type Entity =
  | { kind: 'shape'; layer: LayerId; shape: Shape }
  | { kind: 'line'; layer: LayerId; a: Vec2; b: Vec2 }
  | { kind: 'text'; layer: LayerId; at: Vec2; text: string; size: number; rotation: number; anchor: 'start' | 'middle' | 'end' };

export interface TitleInfo {
  project: string;
  registration: string;
  gliderType: string;
  revision: number;
  /** Export date, YYYY-MM-DD. */
  date: string;
  author: string;
  template: string;
  templateStatus: 'draft' | 'verified' | 'missing';
  material: string;
}

export interface CheckSummary {
  errors: CheckResult[];
  warnings: CheckResult[];
}

export interface Drawing {
  entities: Entity[];
  /** Extent of the panel itself (outline, or parts when there is no template). */
  panelBox: Box;
  /** Extent of everything, notes included. */
  box: Box;
  title: TitleInfo;
  checks: CheckSummary;
  /** True when the export went ahead despite errors; stamped on the drawing. */
  overridden: boolean;
}

export const STAMP = 'PLANNING AID - VERIFY BEFORE CUTTING';
export const NOT_APPROVAL = 'Not an approval. Panel changes still go through the normal inspection and approval route.';

/** Errors and warnings that an export must list. */
export function checkSummary(doc: Project): CheckSummary {
  const results = runChecks(doc, projectGeometry(doc));
  return { errors: results.filter((r) => r.severity === 'error'), warnings: results.filter((r) => r.severity === 'warning') };
}

export function titleInfo(doc: Project, template: PanelTemplate | undefined, date: Date): TitleInfo {
  return {
    project: doc.name,
    registration: doc.registration,
    gliderType: doc.gliderType,
    revision: doc.revision,
    date: date.toISOString().slice(0, 10),
    author: doc.author,
    template: template?.name ?? 'Template not found',
    templateStatus: template?.status ?? 'missing',
    material: template ? `${template.material}, ${template.thickness} mm` : '',
  };
}

/** Lines of the title block, notes and check list, in reading order. */
export function noteLines(d: Pick<Drawing, 'title' | 'checks' | 'overridden'>): { text: string; strong?: boolean }[] {
  const t = d.title;
  const out: { text: string; strong?: boolean }[] = [];
  out.push({ text: [t.project, t.registration].filter(Boolean).join(' - '), strong: true });
  out.push({ text: [t.gliderType && `Glider: ${t.gliderType}`, `Revision ${t.revision}`, `Date ${t.date}`, t.author && `Author: ${t.author}`].filter(Boolean).join('   ') });
  out.push({ text: `Template: ${t.template} (${t.templateStatus})${t.material ? `   Material: ${t.material}` : ''}` });
  out.push({ text: 'Scale 1:1, millimetres. Origin at the panel datum.' });
  out.push({ text: STAMP, strong: true });
  out.push({ text: NOT_APPROVAL });
  if (d.overridden && d.checks.errors.length) {
    out.push({ text: `ERRORS OVERRIDDEN AT EXPORT (${d.checks.errors.length}):`, strong: true });
    for (const e of d.checks.errors) out.push({ text: `  ${e.message}` });
  } else if (d.checks.errors.length) {
    out.push({ text: `Open errors (${d.checks.errors.length}):`, strong: true });
    for (const e of d.checks.errors) out.push({ text: `  ${e.message}` });
  }
  if (d.checks.warnings.length) {
    out.push({ text: `Open warnings (${d.checks.warnings.length}):`, strong: true });
    for (const w of d.checks.warnings) out.push({ text: `  ${w.message}` });
  } else {
    out.push({ text: 'No open warnings.' });
  }
  return out;
}


export function dimensionLabel(value: number, units: Units): string {
  return formatLength(value, units, units === 'imperial' ? 3 : 1);
}

/** Lines and text for one dimension, in world mm. */
export function dimensionEntities(dg: DimensionGeometry, units: Units, size = 2.5): Entity[] {
  const out: Entity[] = [];
  const layer: LayerId = 'dimensions';
  out.push({ kind: 'line', layer, a: dg.d1, b: dg.d2 });
  for (const [a, b] of dg.ext) out.push({ kind: 'line', layer, a, b });
  const back = { x: -dg.dir.x, y: -dg.dir.y };
  for (const [a, b] of [...arrowStrokes(dg.d1, back), ...arrowStrokes(dg.d2, dg.dir)]) out.push({ kind: 'line', layer, a, b });
  out.push({ kind: 'text', layer, at: dg.text, text: dimensionLabel(dg.value, units), size, rotation: dg.angle, anchor: 'middle' });
  return out;
}

export interface DrawingOptions {
  date?: Date;
  overridden?: boolean;
  /** Include the title block and check list on the notes layer (SVG and DXF). */
  notes?: boolean;
}

const NOTE_SIZE = 3;
const NOTE_LEADING = 5;

export function buildDrawing(doc: Project, opts: DrawingOptions = {}): Drawing {
  const template = resolveTemplate(doc);
  const geometry = projectGeometry(doc);
  const entities: Entity[] = [];

  if (template) {
    entities.push({ kind: 'shape', layer: 'outline', shape: template.outline });
    for (const b of template.bendLines) entities.push({ kind: 'line', layer: 'bends', a: b.a, b: b.b });
    for (const f of template.fixings) entities.push({ kind: 'shape', layer: 'holes', shape: { kind: 'circle', cx: f.x, cy: f.y, d: f.d } });
    for (const k of template.keepOuts) entities.push({ kind: 'shape', layer: 'keepouts', shape: k.shape });
  }
  for (const k of doc.keepOuts) entities.push({ kind: 'shape', layer: 'keepouts', shape: k.shape });

  // Parts in document order; mounted parts have no cutouts or holes.
  for (const pp of doc.parts) {
    const g = geometry.get(pp.id);
    if (!g) continue;
    for (const c of g.cutouts) entities.push({ kind: 'shape', layer: 'cutouts', shape: c });
    for (const h of g.holes) entities.push({ kind: 'shape', layer: 'holes', shape: { kind: 'circle', cx: h.x, cy: h.y, d: h.d } });
  }

  for (const t of doc.texts) {
    if (t.layer !== 'engrave' || !t.text.trim()) continue;
    entities.push({ kind: 'text', layer: 'engrave', at: { x: t.x, y: t.y }, text: t.text, size: t.size, rotation: t.rotation, anchor: 'middle' });
  }

  const endAt = dimensionEndPoint(geometry);
  for (const dim of doc.dimensions) {
    const dg = dimensionGeometry(dim, endAt);
    if (dg) entities.push(...dimensionEntities(dg, doc.settings.units));
  }

  const panelBox =
    (template ? shapeBox(template.outline) : unionBox([...geometry.values()].map((g) => g.frontBox))) ?? { minX: -100, minY: -100, maxX: 100, maxY: 100 };

  const drawing: Drawing = {
    entities,
    panelBox,
    box: panelBox,
    title: titleInfo(doc, template, opts.date ?? new Date()),
    checks: checkSummary(doc),
    overridden: !!opts.overridden,
  };

  if (opts.notes !== false) {
    // Title block and notes sit below the panel, left-aligned with it.
    let y = panelBox.minY - 15;
    for (const l of noteLines(drawing)) {
      entities.push({ kind: 'text', layer: 'notes', at: { x: panelBox.minX, y }, text: l.text, size: l.strong ? NOTE_SIZE * 1.2 : NOTE_SIZE, rotation: 0, anchor: 'start' });
      y -= NOTE_LEADING;
    }
  }
  drawing.box = entitiesBox(entities) ?? panelBox;
  return drawing;
}


export function entitiesBox(entities: Entity[]): Box | null {
  const boxes: Box[] = [];
  for (const e of entities) {
    if (e.kind === 'shape') boxes.push(shapeBox(e.shape));
    else if (e.kind === 'line') boxes.push({ minX: Math.min(e.a.x, e.b.x), minY: Math.min(e.a.y, e.b.y), maxX: Math.max(e.a.x, e.b.x), maxY: Math.max(e.a.y, e.b.y) });
    else {
      const w = textWidth(e.text, e.size);
      const x0 = e.anchor === 'start' ? e.at.x : e.anchor === 'middle' ? e.at.x - w / 2 : e.at.x - w;
      boxes.push({ minX: x0, minY: e.at.y - e.size * 0.3, maxX: x0 + w, maxY: e.at.y + e.size });
    }
  }
  return unionBox(boxes);
}

/** A file-name stem for exports: registration or project name. */
export function fileStem(doc: Project): string {
  return (doc.registration || doc.name || 'panel').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'panel';
}
