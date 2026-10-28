/**
 * The template editor's working state: the open draft (with undo), its decoded photo, the
 * straightened image, and the actions behind each step of the pipeline.
 */
import { useSyncExternalStore } from 'react';
import { PanelTemplate, type PolyVertex, type Shape, type Vec2 } from '../model/schema';
import { newId } from '../store/doc';
import { Store } from '../store/ui';
import { buildTemplate, draftFromTemplate, draftMap, estimateAccuracy, newDraft, setDatum, withMapChange, type Calibration, type TemplateDraft } from './draft';
import { planeFromCircles, type KnownCircle } from './fit';
import { autoSeed, fitGrid, type GridSeed } from './grid';
import { robustHomography } from './homography';
import { ridges, type Raster } from './raster';
import { mmToPx, photoExtent, pxToMm, rectify, type Rectified } from './rectify';
import { deleteDraft, deletePhoto, getPhoto, listDrafts, putDraft, putLibraryTemplate, putPhoto, refreshLocalTemplates } from './store';
import { ccw, mirrorHalf } from './outline';
import { snapRim, suggestOutline } from './trace';

export type TplTool =
  | 'select'
  | 'grid-seed'
  | 'ref-point'
  | 'circle'
  | 'scale-line'
  | 'wand'
  | 'outline'
  | 'bend'
  | 'fixing'
  | 'keepout'
  | 'datum'
  | 'check';

export type TplStep = 'photo' | 'calibrate' | 'outline' | 'features' | 'accuracy' | 'save';

export interface TplUi {
  step: TplStep;
  tool: TplTool;
  /** Which picture the canvas shows: the photo as taken, or straightened in template mm. */
  mode: 'photo' | 'plane';
  photoView: { zoom: number; centre: Vec2 };
  planeView: { zoom: number; centre: Vec2 };
  /** Clicks collected by the current tool. */
  pending: Vec2[];
  selection: { kind: 'vertex' | 'bend' | 'fixing' | 'keepout' | 'check'; id: string | number } | null;
  message: string;
  busy: string;
  /** Detected grid crossings, for the overlay (photo pixels). */
  crossings: Vec2[];
  /** Pending circle in the instruments method: snapped rim points. */
  rim: Vec2[] | null;
  /** Grid spacing the user chose, mm. */
  gridSpacing: number;
  wandTolerance: number;
  /** Largest gap allowed between the suggested outline and the traced edge, mm. */
  simplifyMm: number;
  fixingD: number;
  /** Version of the straightened image, to refresh its URL. */
  rectifiedVersion: number;
}

export const tplUi = new Store<TplUi>({
  step: 'photo',
  tool: 'select',
  mode: 'photo',
  photoView: { zoom: 0.5, centre: { x: 600, y: -800 } },
  planeView: { zoom: 1.5, centre: { x: 0, y: 0 } },
  pending: [],
  selection: null,
  message: '',
  busy: '',
  crossings: [],
  rim: null,
  gridSpacing: 12.7,
  wandTolerance: 28,
  simplifyMm: 1.5,
  fixingD: 4.2,
  rectifiedVersion: 0,
});

export function useTplUi<R>(select: (s: TplUi) => R): R {
  return useSyncExternalStore(tplUi.subscribe, () => select(tplUi.state));
}

// ---------------------------------------------------------------- the draft, with undo

class DraftStore {
  draft: TemplateDraft | null = null;
  past: TemplateDraft[] = [];
  future: TemplateDraft[] = [];
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.draft;
  private saving: Promise<unknown> = Promise.resolve();
  private emit() {
    for (const l of this.listeners) l();
    clearTimeout(this.saveTimer);
    if (this.draft) this.saveTimer = setTimeout(() => this.flush(), 250);
  }
  /** Save now. Saves run one after another, so an older copy never lands last. */
  flush() {
    clearTimeout(this.saveTimer);
    const d = this.draft;
    if (!d) return this.saving;
    this.saving = this.saving.then(() => putDraft(d)).catch(() => tplUi.set({ message: 'Could not save the draft in this browser' }));
    return this.saving;
  }
  load(d: TemplateDraft | null) {
    this.draft = d;
    this.past = [];
    this.future = [];
    this.emit();
  }
  /** Apply a change as one undoable step. */
  update(fn: (d: TemplateDraft) => TemplateDraft) {
    if (!this.draft) return;
    const next = { ...fn(this.draft), modified: new Date().toISOString() };
    this.past.push(this.draft);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.draft = next;
    this.emit();
  }
  /** Start a drag: record one undo step for the whole drag. */
  beginLive() {
    if (!this.draft || this.live) return;
    this.live = true;
    this.past.push(this.draft);
    this.future = [];
  }
  /** Update during a drag, without new undo steps. */
  setLive(fn: (d: TemplateDraft) => TemplateDraft) {
    if (!this.draft) return;
    if (!this.live) this.beginLive();
    this.draft = fn(this.draft);
    this.emit();
  }
  endLive() {
    if (!this.live) return;
    this.live = false;
    if (this.draft) this.draft = { ...this.draft, modified: new Date().toISOString() };
    this.emit();
  }
  private live = false;
  undo() {
    const prev = this.past.pop();
    if (!prev || !this.draft) return false;
    this.future.push(this.draft);
    this.draft = prev;
    this.emit();
    return true;
  }
  redo() {
    const next = this.future.pop();
    if (!next || !this.draft) return false;
    this.past.push(this.draft);
    this.draft = next;
    this.emit();
    return true;
  }
}

export const drafts = new DraftStore();

// Leaving or hiding the page saves straight away rather than after the pause.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void drafts.flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void drafts.flush());
}

export function useDraft(): TemplateDraft | null {
  return useSyncExternalStore(drafts.subscribe, drafts.get);
}

// ---------------------------------------------------------------- photo and straightened image

interface PhotoState {
  raster: Raster | null;
  url: string | null;
  ridge: ReturnType<typeof ridges> | null;
  rectified: Rectified | null;
  rectifiedUrl: string | null;
}

export const photo: PhotoState = { raster: null, url: null, ridge: null, rectified: null, rectifiedUrl: null };

/** Longest photo side we work at; larger photos are scaled down on import. */
export const MAX_PHOTO_SIDE = 2400;

async function decode(blob: Blob): Promise<Raster> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

function rasterUrl(r: Raster): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(URL.createObjectURL(b!)), 'image/png'));
}

async function loadPhoto(d: TemplateDraft) {
  if (photo.url) URL.revokeObjectURL(photo.url);
  Object.assign(photo, { raster: null, url: null, ridge: null });
  if (!d.photo) return;
  const blob = await getPhoto(d.photo.key);
  if (!blob) {
    tplUi.set({ message: 'The photo for this draft is no longer in this browser' });
    return;
  }
  photo.raster = await decode(blob);
  // Show the scaled working copy, so its pixels match every stored coordinate.
  photo.url = await rasterUrl(photo.raster);
}

/** Rebuild the straightened image after the map changes. */
export async function refreshRectified() {
  const d = drafts.draft;
  const map = d && draftMap(d);
  if (photo.rectifiedUrl) URL.revokeObjectURL(photo.rectifiedUrl);
  Object.assign(photo, { rectified: null, rectifiedUrl: null });
  if (!d || !map || !photo.raster) return tplUi.set((s) => ({ rectifiedVersion: s.rectifiedVersion + 1 }));
  const focus = d.outline.length > 2 ? boxOf(d.outline) : undefined;
  const r = rectify(photo.raster, map, photoExtent(map, photo.raster.width, photo.raster.height, focus));
  photo.rectified = r;
  photo.rectifiedUrl = await rasterUrl(r.raster);
  tplUi.set((s) => ({ rectifiedVersion: s.rectifiedVersion + 1 }));
}

function boxOf(pts: Vec2[]) {
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
}

// ---------------------------------------------------------------- drafts

export async function openDraft(d: TemplateDraft) {
  drafts.load(d);
  // A template opened for editing has its features already, in mm, and may have no photo.
  const inMm = !!d.calibration || (!d.photo && d.outline.length > 0);
  tplUi.set({ busy: 'Loading photo…', crossings: [], rim: null, pending: [], selection: null, step: inMm ? (d.outline.length ? 'features' : 'outline') : d.photo ? 'calibrate' : 'photo' });
  await loadPhoto(d);
  if (photo.raster) tplUi.set({ photoView: fitPhotoView(photo.raster) });
  await refreshRectified();
  tplUi.set({ busy: '', mode: inMm ? 'plane' : 'photo', tool: 'select' });
  if (inMm) fitPlaneView();
}

/**
 * Edit an existing template: a library template as your own copy, your own in place (saved
 * under its own id). Opens a draft with its features in mm; a photo can still be added.
 */
export async function editTemplate(t: PanelTemplate, own: boolean) {
  const d = draftFromTemplate(t, own);
  await putDraft(d).catch(() => undefined);
  await openDraft(d);
  tplUi.set({
    message: own
      ? `Editing “${t.name}”. Save to update it in your library.`
      : `Editing a copy of “${t.name}”. Saving puts the copy in your library; the shipped template stays as it is.${t.status === 'verified' ? ' Verify it again at 1:1 after editing.' : ''}`,
  });
}

export async function createDraft(name?: string) {
  const d = newDraft(name);
  await putDraft(d).catch(() => undefined);
  await openDraft(d);
}

export async function removeDraft(d: TemplateDraft) {
  await deleteDraft(d.id);
  if (d.photo) await deletePhoto(d.photo.key).catch(() => undefined);
  if (drafts.draft?.id === d.id) drafts.load(null);
}

export async function allDrafts() {
  return listDrafts().catch(() => [] as TemplateDraft[]);
}

export async function importPhoto(file: File) {
  const d = drafts.draft;
  if (!d) return;
  tplUi.set({ busy: 'Reading photo…' });
  try {
    const key = `photo-${d.id}-${Date.now().toString(36)}`;
    await putPhoto(key, file);
    const raster = await decode(file);
    const old = d.photo?.key;
    drafts.update((x) => ({ ...x, photo: { key, name: file.name, width: raster.width, height: raster.height }, source: x.source || `Photo: ${file.name}`, calibration: null }));
    if (old) await deletePhoto(old).catch(() => undefined);
    await loadPhoto(drafts.draft!);
    tplUi.set({ photoView: fitPhotoView(raster), mode: 'photo', step: 'calibrate', crossings: [], message: `Imported ${file.name} (${raster.width} × ${raster.height} px)` });
    await refreshRectified();
  } catch (e) {
    tplUi.set({ message: `Could not read the photo: ${(e as Error).message}` });
  } finally {
    tplUi.set({ busy: '' });
  }
}

export function fitPhotoView(r: Raster, w = 900, h = 700) {
  const zoom = Math.min((w - 40) / r.width, (h - 40) / r.height);
  // Photo view uses world (x, −y) so the shared viewport maths (y up) applies.
  return { zoom, centre: { x: r.width / 2, y: -r.height / 2 } };
}

export function fitPlaneView(w = 900, h = 700) {
  const d = drafts.draft;
  const pts = d?.outline.length ? d.outline : photo.rectified ? [{ x: photo.rectified.box.minX, y: photo.rectified.box.minY }, { x: photo.rectified.box.maxX, y: photo.rectified.box.maxY }] : null;
  if (!pts) return;
  const b = boxOf(pts);
  const zoom = Math.min((w - 60) / Math.max(10, b.maxX - b.minX), (h - 60) / Math.max(10, b.maxY - b.minY));
  tplUi.set({ planeView: { zoom, centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } } });
}

// ---------------------------------------------------------------- calibration

function setCalibration(cal: Calibration, msg: string) {
  drafts.update((d) => {
    const next = withMapChange(d, { calibration: cal });
    // First calibration: centre the datum on the calibrated area, so the template starts near 0, 0.
    if (!d.calibration) {
      const m = draftMap(next);
      if (m && photo.raster) {
        const c = m.toTemplate({ x: photo.raster.width / 2, y: photo.raster.height / 2 });
        return setDatum(next, c);
      }
    }
    return next;
  });
  tplUi.set({ message: msg, pending: [], rim: null });
  void refreshRectified();
}

export function detectGrid(spacingMm: number, seedPoints?: Vec2[]) {
  const r = photo.raster;
  if (!r) return tplUi.set({ message: 'Import a photo first' });
  tplUi.set({ busy: 'Finding the grid…' });
  setTimeout(() => {
    try {
      photo.ridge ??= ridges(r);
      let seed: GridSeed | null;
      if (seedPoints) {
        // Four clicks round one square: top-left, top-right, bottom-right, bottom-left.
        const idx = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
        seed = { points: seedPoints.slice(0, 4).map((p, k) => ({ img: p, i: idx[k]![0]!, j: idx[k]![1]! })) };
      } else seed = autoSeed(r, photo.ridge);
      if (!seed) return tplUi.set({ message: 'No grid found. Use “Click one square” and click the four corners of one grid square.' });
      const fit = fitGrid(r, seed, spacingMm, { ridge: photo.ridge });
      if (!fit) return tplUi.set({ message: 'The grid could not be followed from that square. Try another square near the template.' });
      tplUi.set({ crossings: fit.crossings.map((c) => c.img) });
      setCalibration(
        { kind: 'grid', mapping: { H: fit.H, k1: fit.k1, width: r.width, height: r.height }, spacingMm, seed: seed.points, crossings: fit.crossings.length, rmsMm: fit.rms },
        `Grid found: ${fit.crossings.length} crossings, residual ${fit.rms.toFixed(2)} mm${fit.k1 ? `, lens distortion corrected (k1 ${fit.k1.toFixed(3)})` : ''}`,
      );
    } finally {
      tplUi.set({ busy: '' });
    }
  }, 20);
}

export function calibrateFromPoints(points: { img: Vec2; plane: Vec2 }[]) {
  const r = photo.raster;
  if (!r || points.length < 4) return tplUi.set({ message: 'Click at least four points with known positions' });
  // Plane coordinates are given y up (as measured); the pipeline's plane is y down.
  const fit = robustHomography(points.map((p) => ({ src: p.img, dst: { x: p.plane.x, y: -p.plane.y } })), 4);
  if (!fit) return tplUi.set({ message: 'Those points do not define a plane; spread them out' });
  setCalibration({ kind: 'points', mapping: { H: fit.H, k1: 0, width: r.width, height: r.height }, points, rmsMm: fit.rms }, `Calibrated from ${points.length} points, residual ${fit.rms.toFixed(2)} mm`);
}

export function calibrateFromCircles(circles: (KnownCircle & { label: string })[]) {
  const r = photo.raster;
  if (!r || !circles.length) return;
  const fit = planeFromCircles(circles);
  if (!fit) return tplUi.set({ message: 'Could not fit those instruments; check each rim was found' });
  setCalibration(
    { kind: 'circles', mapping: { H: fit.H, k1: 0, width: r.width, height: r.height }, circles, model: fit.model, diameterErrors: fit.diameterErrors, rmsMm: fit.rms },
    `Calibrated from ${circles.length} instruments (${fit.model === 'projective' ? 'perspective' : 'square-on'} model), residual ${fit.rms.toFixed(2)} mm`,
  );
}

export function calibrateFromScale(line: { a: Vec2; b: Vec2; mm: number } | null, dpi: number | null) {
  const r = photo.raster;
  if (!r) return;
  const k = dpi ? 25.4 / dpi : line ? line.mm / Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) : 0;
  if (!k) return;
  setCalibration({ kind: 'scale', mapping: { H: [k, 0, 0, 0, k, 0, 0, 0, 1], k1: 0, width: r.width, height: r.height }, line, dpi }, `Scale set: ${k.toFixed(4)} mm per pixel`);
}

/** Snap a clicked rim for the instruments method. */
export function snapInstrument(centre: Vec2, rimClick: Vec2) {
  const r = photo.raster;
  if (!r) return null;
  const s = snapRim(r, centre, rimClick);
  if (!s) tplUi.set({ message: 'No clear rim there. Click nearer the edge, or add points by hand.' });
  return s;
}

export function setRaised(mm: number) {
  drafts.update((d) => withMapChange(d, { raisedMm: Math.max(0, mm) }));
  void refreshRectified();
}

// ---------------------------------------------------------------- outline and features

export function wandOutline(atMm: Vec2) {
  const r = photo.rectified;
  if (!r) return tplUi.set({ message: 'Calibrate first' });
  tplUi.set({ busy: 'Tracing…' });
  setTimeout(() => {
    try {
      const px = mmToPx(r, atMm);
      const poly = suggestOutline(r.raster, px, { tolerance: tplUi.state.wandTolerance, simplifyPx: Math.max(1, tplUi.state.simplifyMm * r.pxPerMm) });
      if (poly.length < 3) return tplUi.set({ message: 'Nothing to trace there; click inside the panel' });
      // Pixels run y down and mm y up: the reflection flips each arc's direction.
      const outline: PolyVertex[] = poly.map((p) => ({ ...pxToMm(r, p), ...(p.bulge ? { bulge: -p.bulge } : {}) }));
      drafts.update((d) => ({ ...d, outline: ccw(outline) }));
      tplUi.set({ message: `Outline suggested with ${outline.length} vertices. Drag vertices to correct it.`, tool: 'select' });
      void refreshRectified();
    } finally {
      tplUi.set({ busy: '' });
    }
  }, 20);
}

/** Mirror one half of the outline about x = 0 onto the other. */
export function mirrorOutline(keep: 'left' | 'right') {
  const d = drafts.draft;
  if (!d || d.outline.length < 3) return;
  const out = mirrorHalf(d.outline, keep);
  if (!out) return tplUi.set({ message: 'The outline must cross the centreline (x = 0) exactly twice. Set the datum on the centreline first.' });
  drafts.update((x) => ({ ...x, outline: out }));
  tplUi.set({ message: `Mirrored the ${keep} half onto the ${keep === 'left' ? 'right' : 'left'}` });
}

export function setOutline(outline: PolyVertex[], label = 'Edit outline') {
  void label;
  drafts.update((d) => ({ ...d, outline }));
}

export function addFeature(kind: 'bend' | 'fixing' | 'keepout' | 'check', data: { a?: Vec2; b?: Vec2; shape?: Shape; label?: string; measuredMm?: number }) {
  drafts.update((d) => {
    switch (kind) {
      case 'bend':
        return { ...d, bendLines: [...d.bendLines, { a: data.a!, b: data.b!, label: data.label ?? 'Fold' }] };
      case 'fixing': {
        const s = data.shape as Extract<Shape, { kind: 'circle' }>;
        return { ...d, fixings: [...d.fixings, { x: s.cx, y: s.cy, d: s.d }] };
      }
      case 'keepout':
        return { ...d, keepOuts: [...d.keepOuts, { id: newId('tk'), label: data.label ?? 'Keep-out', shape: data.shape! }] };
      case 'check':
        return { ...d, checks: [...d.checks, { id: newId('ck'), label: data.label ?? `Span ${d.checks.length + 1}`, a: data.a!, b: data.b!, measuredMm: data.measuredMm! }] };
    }
  });
}

export function setDatumAt(origin: Vec2, axis?: { a: Vec2; b: Vec2 }) {
  drafts.update((d) => setDatum(d, origin, axis));
  void refreshRectified().then(() => fitPlaneView());
}

// ---------------------------------------------------------------- save, use, verify

export async function saveToLibrary(): Promise<PanelTemplate | null> {
  const d = drafts.draft;
  if (!d) return null;
  const t = buildTemplate(d);
  if (!t) {
    tplUi.set({ message: 'Trace the outline before saving' });
    return null;
  }
  await putLibraryTemplate(t);
  await refreshLocalTemplates();
  const acc = estimateAccuracy(d);
  tplUi.set({ message: `Saved “${t.name}” to your template library${acc ? ` (±${acc.spanMm.toFixed(1)} mm estimated)` : ''}` });
  return t;
}

export function markVerified(note: string) {
  if (!note.trim()) return tplUi.set({ message: 'Write how you checked it, e.g. “Printed 1:1 and held against the panel; all edges within 1 mm”' });
  drafts.update((d) => ({ ...d, status: 'verified', verifiedNote: note.trim(), verifiedDate: new Date().toISOString().slice(0, 10) }));
}

export function markDraft() {
  drafts.update((d) => ({ ...d, status: 'draft', verifiedDate: null }));
}
