/**
 * A panel template in progress: the photo it comes from, how that photo was calibrated,
 * and the features traced on it. Drafts live in the user's browser; the finished
 * `PanelTemplate` is what projects and the library use. See ADR 0010.
 *
 * Coordinates:
 * - image: photo pixels, y down;
 * - plane: mm on the calibrated plane (the mat, or the panel itself), image-oriented, y down;
 * - feature plane: plane corrected for a template raised above it (cardboard on a mat);
 * - template: mm, y up, origin at the panel datum, as everywhere else in the app.
 * Features are stored in template coordinates; when the calibration or datum changes they
 * are carried across through the image, so nothing traced is lost.
 */
import { z } from 'zod';
import { BendLine, Hole, KeepOut, PanelTemplate, PolyVertex, Shape, TemplateInputType, Vec2 } from '../model/schema';
import { cameraFromHomography, raisedPlaneCorrection, type CameraEstimate } from './camera';
import { applyH, localScale } from './homography';
import { inv3, mul3, type Mat3 } from './linalg';
import { distort, undistort, type Mapping } from './mapping';

const Mat = z.array(z.number()).length(9);

export const MappingSchema = z.object({ H: Mat, k1: z.number(), width: z.number(), height: z.number() });

export const Calibration = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('grid'),
    mapping: MappingSchema,
    spacingMm: z.number().positive(),
    seed: z.array(z.object({ img: Vec2, i: z.number(), j: z.number() })),
    crossings: z.number().int(),
    rmsMm: z.number(),
  }),
  z.object({
    kind: z.literal('points'),
    mapping: MappingSchema,
    points: z.array(z.object({ img: Vec2, plane: Vec2 })),
    rmsMm: z.number(),
  }),
  z.object({
    kind: z.literal('circles'),
    mapping: MappingSchema,
    circles: z.array(z.object({ label: z.string(), points: z.array(Vec2), diameter: z.number().positive() })),
    model: z.enum(['affine', 'projective']),
    diameterErrors: z.array(z.number()),
    rmsMm: z.number(),
  }),
  z.object({
    // A flatbed scan or a square-on photo with a ruler: scale only.
    kind: z.literal('scale'),
    mapping: MappingSchema,
    line: z.object({ a: Vec2, b: Vec2, mm: z.number().positive() }).nullable(),
    dpi: z.number().positive().nullable(),
  }),
]);
export type Calibration = z.infer<typeof Calibration>;

export const SpanCheck = z.object({ id: z.string(), label: z.string(), a: Vec2, b: Vec2, measuredMm: z.number().positive() });
export type SpanCheck = z.infer<typeof SpanCheck>;

export const TemplateDraft = z.object({
  id: z.string(),
  name: z.string(),
  created: z.string(),
  modified: z.string(),
  photo: z.object({ key: z.string(), name: z.string(), width: z.number(), height: z.number() }).nullable(),
  inputType: TemplateInputType,
  source: z.string(),
  rights: z.string(),
  calibration: Calibration.nullable(),
  /** Height of the template's face above the calibrated plane (a card on a mat), mm. */
  raisedMm: z.number().nonnegative(),
  /** Panel datum in the feature plane, and the angle of the template's x axis there. */
  frame: z.object({ origin: Vec2, angle: z.number() }),
  outline: z.array(PolyVertex),
  bendLines: z.array(BendLine),
  fixings: z.array(Hole),
  keepOuts: z.array(KeepOut),
  checks: z.array(SpanCheck),
  thickness: z.number().positive(),
  material: z.string(),
  canopyClearance: z.number().nonnegative().nullable(),
  availableDepth: z.number().nonnegative().nullable(),
  gliderTypes: z.array(z.string()),
  status: z.enum(['draft', 'verified']),
  verifiedNote: z.string(),
  verifiedDate: z.string().nullable(),
  /**
   * The template this draft was opened from, to edit without a photo. Its provenance and
   * accuracy carry over; your own template keeps its id, a library one is saved as your copy.
   */
  basedOn: z.object({ template: PanelTemplate, own: z.boolean() }).nullable().default(null),
});
export type TemplateDraft = z.infer<typeof TemplateDraft>;

export function newDraft(name = 'New template'): TemplateDraft {
  const now = new Date().toISOString();
  return {
    id: `tpl-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name,
    created: now,
    modified: now,
    photo: null,
    inputType: 'gridded-mockup',
    source: '',
    rights: 'My own photo',
    calibration: null,
    raisedMm: 0,
    frame: { origin: { x: 0, y: 0 }, angle: 0 },
    outline: [],
    bendLines: [],
    fixings: [],
    keepOuts: [],
    checks: [],
    thickness: 2,
    material: 'Glass fibre (GRP)',
    canopyClearance: null,
    availableDepth: null,
    gliderTypes: [],
    status: 'draft',
    verifiedNote: '',
    verifiedDate: null,
    basedOn: null,
  };
}

/**
 * A draft for editing an existing template: its features in template mm, no photo. A
 * library template becomes your own copy; a verified one goes back to draft, since any
 * edit needs checking again at 1:1.
 */
export function draftFromTemplate(t: PanelTemplate, own: boolean): TemplateDraft {
  const d = newDraft(own ? t.name : `${t.name} (my copy)`);
  return {
    ...d,
    inputType: t.provenance.inputType,
    source: t.provenance.source,
    rights: t.provenance.rights ?? '',
    outline: t.outline.kind === 'poly' ? t.outline.points : polyOf(t.outline),
    bendLines: t.bendLines,
    fixings: t.fixings,
    keepOuts: t.keepOuts,
    checks: t.provenance.checks.map((c, i) => ({ id: `ck-${i + 1}`, label: c.label, a: c.a, b: c.b, measuredMm: c.measuredMm })),
    thickness: t.thickness,
    material: t.material,
    canopyClearance: t.canopyClearance,
    availableDepth: t.availableDepth.default,
    gliderTypes: t.gliderTypes,
    status: 'draft',
    basedOn: { template: t, own },
  };
}

function polyOf(s: Shape): PolyVertex[] {
  if (s.kind === 'poly') return s.points;
  if (s.kind === 'rect') {
    const [hw, hh] = [s.w / 2, s.h / 2];
    return [
      { x: s.cx - hw, y: s.cy - hh },
      { x: s.cx + hw, y: s.cy - hh },
      { x: s.cx + hw, y: s.cy + hh },
      { x: s.cx - hw, y: s.cy + hh },
    ];
  }
  // A circle as two half-circle arcs.
  const r = s.d / 2;
  return [
    { x: s.cx - r, y: s.cy, bulge: 1 },
    { x: s.cx + r, y: s.cy, bulge: 1 },
  ];
}

// ---------------------------------------------------------------- the image ↔ template map

export interface DraftMap {
  toTemplate: (img: Vec2) => Vec2;
  toImage: (t: Vec2) => Vec2;
  /** Template mm per photo pixel near the middle of the photo. */
  mmPerPx: number;
  camera: CameraEstimate | null;
}

/** Feature plane (y down) → template (y up), and back. */
function frameFns(frame: TemplateDraft['frame']) {
  const c = Math.cos(frame.angle);
  const s = Math.sin(frame.angle);
  return {
    to: (p: Vec2): Vec2 => {
      const dx = p.x - frame.origin.x;
      const dy = p.y - frame.origin.y;
      return { x: c * dx + s * dy, y: -(-s * dx + c * dy) };
    },
    from: (t: Vec2): Vec2 => {
      const dx = t.x;
      const dy = -t.y;
      return { x: frame.origin.x + c * dx - s * dy, y: frame.origin.y + s * dx + c * dy };
    },
  };
}

/** Image → feature plane, including the raised-template correction. */
export function featureMapping(cal: Calibration, raisedMm: number): { mapping: Mapping; camera: CameraEstimate | null } {
  const m = cal.mapping;
  if (!raisedMm || cal.kind === 'scale') return { mapping: m, camera: null };
  const Hi = inv3(m.H);
  const camera = Hi ? cameraFromHomography(Hi, m.width, m.height) : null;
  if (!camera) return { mapping: m, camera: null };
  return { mapping: { ...m, H: mul3(raisedPlaneCorrection(camera, raisedMm), m.H) }, camera };
}

export function draftMap(d: Pick<TemplateDraft, 'calibration' | 'raisedMm' | 'frame'>): DraftMap | null {
  if (!d.calibration) return null;
  const { mapping, camera } = featureMapping(d.calibration, d.raisedMm);
  const Hi = inv3(mapping.H);
  if (!Hi) return null;
  const f = frameFns(d.frame);
  return {
    toTemplate: (img) => f.to(applyH(mapping.H, undistort(mapping, img))),
    toImage: (t) => distort(mapping, applyH(Hi, f.from(t))),
    mmPerPx: localScale(mapping.H, { x: mapping.width / 2, y: mapping.height / 2 }),
    camera,
  };
}

// ---------------------------------------------------------------- carrying features across

function mapShape(s: Shape, fn: (p: Vec2) => Vec2): Shape {
  switch (s.kind) {
    case 'circle': {
      const c = fn({ x: s.cx, y: s.cy });
      // Diameter by mapping a point on the rim; maps here are near-similarities locally.
      const e = fn({ x: s.cx + s.d / 2, y: s.cy });
      return { ...s, cx: c.x, cy: c.y, d: 2 * Math.hypot(e.x - c.x, e.y - c.y) };
    }
    case 'rect': {
      const c = fn({ x: s.cx, y: s.cy });
      const ex = fn({ x: s.cx + s.w / 2, y: s.cy });
      const ey = fn({ x: s.cx, y: s.cy + s.h / 2 });
      return { ...s, cx: c.x, cy: c.y, w: 2 * Math.hypot(ex.x - c.x, ex.y - c.y), h: 2 * Math.hypot(ey.x - c.x, ey.y - c.y) };
    }
    case 'poly':
      return { ...s, points: s.points.map((p) => ({ ...p, ...fn(p) })) };
  }
}

/** Apply a template → template map to every traced feature (after recalibrating, or moving the datum). */
export function mapFeatures(d: TemplateDraft, fn: (p: Vec2) => Vec2): TemplateDraft {
  const hole = (h: { x: number; y: number; d: number }) => {
    const s = mapShape({ kind: 'circle', cx: h.x, cy: h.y, d: h.d }, fn) as { cx: number; cy: number; d: number };
    return { x: s.cx, y: s.cy, d: s.d };
  };
  return {
    ...d,
    outline: d.outline.map((p) => ({ ...p, ...fn(p) })),
    bendLines: d.bendLines.map((b) => ({ ...b, a: fn(b.a), b: fn(b.b) })),
    fixings: d.fixings.map(hole),
    keepOuts: d.keepOuts.map((k) => ({ ...k, shape: mapShape(k.shape, fn) })),
    checks: d.checks.map((c) => ({ ...c, a: fn(c.a), b: fn(c.b) })),
  };
}

/**
 * Change calibration, raise or datum, keeping traced features on the same photo pixels.
 * With no earlier calibration, features are kept as they are.
 */
export function withMapChange(d: TemplateDraft, patch: Partial<Pick<TemplateDraft, 'calibration' | 'raisedMm' | 'frame'>>): TemplateDraft {
  const before = draftMap(d);
  const next = { ...d, ...patch };
  const after = draftMap(next);
  if (!before || !after) return next;
  return mapFeatures(next, (t) => after.toTemplate(before.toImage(t)));
}

/** Move the datum to a template point and turn the x axis to run from `a` to `b`, keeping features in place on the photo. */
export function setDatum(d: TemplateDraft, origin: Vec2, xAxis?: { a: Vec2; b: Vec2 }): TemplateDraft {
  const m = draftMap(d);
  if (!m) return d;
  // Work in the feature plane: template → image → feature plane is the inverse frame.
  const f = frameFns(d.frame);
  const o = f.from(origin);
  let angle = d.frame.angle;
  if (xAxis) {
    const a = f.from(xAxis.a);
    const b = f.from(xAxis.b);
    angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (Math.cos(angle - d.frame.angle) < 0) angle += Math.PI;
  }
  return withMapChange(d, { frame: { origin: o, angle } });
}

// ---------------------------------------------------------------- accuracy

/**
 * Error that cannot be seen in the calibration residuals: flatness of the template, how
 * well a photo edge shows the true edge, the lens model's limits. A judgement per input
 * type, recorded in the milestone report; mm.
 */
export const INPUT_BASELINE_MM: Record<TemplateDraft['inputType'], number> = {
  scan: 0.2,
  'gridded-mockup': 0.5,
  tracing: 0.5,
  'straight-photo': 1.5,
  'angled-photo': 3,
  drawn: 0,
  measured: 0.5,
};

/** Clicking or tracing an edge on the photo is good to about this many pixels. */
export const CLICK_PX = 1.5;

export interface Accuracy {
  /** Estimated error of a distance measured on the template, mm. */
  spanMm: number;
  terms: { label: string; mm: number }[];
}

export function estimateAccuracy(d: TemplateDraft): Accuracy | null {
  if (d.inputType === 'drawn' && !d.calibration) return { spanMm: 0, terms: [{ label: 'Drawn from measurements', mm: 0 }] };
  // Edited from a template, with no new photo: the original's estimate stands.
  const base = d.basedOn?.template.provenance.accuracyMm;
  if (!d.calibration && d.basedOn) return base == null ? null : { spanMm: base, terms: [{ label: `From the original template (${d.basedOn.template.provenance.method ?? d.basedOn.template.provenance.inputType})`, mm: base }] };
  const m = draftMap(d);
  if (!m || !d.calibration) return null;
  const terms: { label: string; mm: number }[] = [];
  const cal = d.calibration;
  if (cal.kind === 'grid') terms.push({ label: `Grid fit (${cal.crossings} crossings)`, mm: cal.rmsMm });
  else if (cal.kind === 'points') terms.push({ label: `Reference points (${cal.points.length})`, mm: cal.points.length > 4 ? cal.rmsMm : CLICK_PX * m.mmPerPx * 2 });
  else if (cal.kind === 'circles') {
    const mean = cal.diameterErrors.reduce((a, b) => a + Math.abs(b), 0) / cal.diameterErrors.length;
    terms.push({ label: `Round instruments (${cal.circles.length}, ${cal.model})`, mm: Math.hypot(cal.rmsMm, mean) });
  } else terms.push({ label: cal.line ? 'Scale line' : 'Scan resolution', mm: CLICK_PX * m.mmPerPx });
  terms.push({ label: 'Tracing on the photo', mm: CLICK_PX * m.mmPerPx });
  if (d.raisedMm && m.camera) {
    // Uncertainty of the camera height feeds the raised-template correction.
    const rel = m.camera.fSource === 'estimated' ? 0.15 : 0.4;
    const span = outlineSpan(d);
    terms.push({ label: `Template ${d.raisedMm} mm above the grid`, mm: (d.raisedMm / m.camera.height) * rel * span });
  }
  terms.push({ label: `Input type: ${d.inputType}`, mm: INPUT_BASELINE_MM[d.inputType] });
  // Two ends of a span each carry the point error.
  const point = Math.sqrt(terms.reduce((s, t) => s + t.mm * t.mm, 0));
  return { spanMm: Math.SQRT2 * point, terms };
}

function outlineSpan(d: TemplateDraft): number {
  if (d.outline.length < 2) return 300;
  const xs = d.outline.map((p) => p.x);
  const ys = d.outline.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export interface CheckResult {
  check: SpanCheck;
  templateMm: number;
  diffMm: number;
  withinError: boolean;
}

export function checkResults(d: TemplateDraft, acc = estimateAccuracy(d)): CheckResult[] {
  return d.checks.map((c) => {
    const templateMm = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
    const diffMm = templateMm - c.measuredMm;
    return { check: c, templateMm, diffMm, withinError: acc !== null && Math.abs(diffMm) <= acc.spanMm };
  });
}

// ---------------------------------------------------------------- the finished template

export function templateId(d: TemplateDraft): string {
  if (d.basedOn?.own) return d.basedOn.template.id;
  const slug = d.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `local.${slug || 'template'}`;
}

export function calibrationSummary(cal: Calibration | null, d?: Pick<TemplateDraft, 'raisedMm'>): string {
  if (!cal) return 'not calibrated';
  const k = cal.mapping.k1 ? `, lens distortion k1 ${cal.mapping.k1.toFixed(3)}` : '';
  const raised = d?.raisedMm ? `, corrected for a template ${d.raisedMm} mm above the grid` : '';
  switch (cal.kind) {
    case 'grid':
      return `cutting-mat grid (${cal.spacingMm} mm squares), ${cal.crossings} crossings, residual ${cal.rmsMm.toFixed(2)} mm${k}${raised}`;
    case 'points':
      return `${cal.points.length} reference points, residual ${cal.rmsMm.toFixed(2)} mm${raised}`;
    case 'circles':
      return `${cal.circles.length} round instruments (${cal.model}), residual ${cal.rmsMm.toFixed(2)} mm${raised}`;
    case 'scale':
      return cal.dpi ? `scan at ${cal.dpi} dpi` : `scale line of ${cal.line?.mm} mm`;
  }
}

export function buildTemplate(d: TemplateDraft, version = d.basedOn?.own ? d.basedOn.template.version : 1): PanelTemplate | null {
  if (d.outline.length < 3) return null;
  const acc = estimateAccuracy(d);
  // Without a new calibration, an edited template keeps where it came from and how.
  const base = !d.calibration && d.basedOn ? d.basedOn.template : null;
  return PanelTemplate.parse({
    id: templateId(d),
    version,
    name: d.name,
    outline: { kind: 'poly', closed: true, points: d.outline },
    bendLines: d.bendLines,
    thickness: d.thickness,
    material: d.material,
    keepOuts: d.keepOuts,
    canopyClearance: d.canopyClearance,
    availableDepth: { default: d.availableDepth, regions: base?.availableDepth.regions ?? [] },
    fixings: d.fixings,
    gliderTypes: d.gliderTypes,
    provenance: {
      inputType: d.inputType,
      source: d.source || (d.photo ? `Photo: ${d.photo.name}` : 'Drawn'),
      rights: d.rights || undefined,
      accuracyMm: acc ? Math.round(acc.spanMm * 100) / 100 : null,
      method: base ? `${(base.provenance.method ?? '').replace(/; edited in the template editor$/, '')}; edited in the template editor`.replace(/^; /, '') : calibrationSummary(d.calibration, d),
      checks: checkResults(d, acc).map((r) => ({ label: r.check.label, a: r.check.a, b: r.check.b, measuredMm: r.check.measuredMm, templateMm: Math.round(r.templateMm * 100) / 100 })),
    },
    status: d.status,
    ...(d.status === 'verified' ? { verifiedNote: d.verifiedNote, verifiedDate: d.verifiedDate ?? undefined } : {}),
  });
}

export type { Mat3 };
