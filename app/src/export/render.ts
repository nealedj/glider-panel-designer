/**
 * Front render: the panel as the pilot sees it, for sharing a layout. Not for cutting.
 */
import { shapeBox, unionBox } from '../geom/shapes';
import { projectGeometry, resolveTemplate } from '../model/resolve';
import type { Project } from '../model/schema';
import { CAP_HEIGHT, checkSummary, NOT_APPROVAL, titleInfo } from './drawing';
import { mm, PdfWriter, PT_PER_MM } from './pdf';
import { drawScene, sceneToSvg, type PageMap, type Prim, type Scene } from './scene';

const C = {
  panel: '#d7d9dd',
  panelEdge: '#5b6068',
  bezel: '#2a2e35',
  cutout: '#121417',
  cutoutEdge: '#4a515b',
  hole: '#80858d',
  bend: '#118a3a',
  text: '#1d2025',
  muted: '#5b6068',
};

const RENDER_NOTE = 'Layout render, not to scale for cutting. Use the cut file or printable template.';

/** The front of the panel as a styled scene, world mm. */
export function frontScene(doc: Project, opts: { caption?: boolean; date?: Date } = {}): Scene {
  const template = resolveTemplate(doc);
  const geometry = projectGeometry(doc);
  const panel: Prim[] = [];
  const parts: Prim[] = [];
  const labels: Prim[] = [];
  if (template) {
    panel.push({ kind: 'shape', shape: template.outline, fill: C.panel, stroke: C.panelEdge, width: 0.6 });
    for (const b of template.bendLines) panel.push({ kind: 'line', a: b.a, b: b.b, stroke: C.bend, width: 0.4, dash: [6, 2, 1, 2] });
    for (const f of template.fixings) panel.push({ kind: 'shape', shape: { kind: 'circle', cx: f.x, cy: f.y, d: f.d }, fill: C.hole, stroke: null });
  }
  for (const pp of doc.parts) {
    const g = geometry.get(pp.id);
    if (!g || g.mounted) continue;
    if (!g.bezel && !g.cutouts.length && !g.holes.length) continue;
    if (g.bezel) parts.push({ kind: 'shape', shape: g.bezel, fill: C.bezel, stroke: null });
    for (const c of g.cutouts) parts.push({ kind: 'shape', shape: c, fill: C.cutout, stroke: C.cutoutEdge, width: 0.5 });
    for (const h of g.holes) parts.push({ kind: 'shape', shape: { kind: 'circle', cx: h.x, cy: h.y, d: h.d }, fill: C.hole, stroke: null });
    const name = pp.label || g.part.model;
    labels.push({ kind: 'text', at: { x: g.transform.x, y: g.frontBox.maxY + 1.8 }, text: name, size: 3.2 / CAP_HEIGHT, rotation: 0, anchor: 'middle', fill: C.text });
  }
  for (const t of doc.texts) {
    if (!t.text.trim()) continue;
    labels.push({ kind: 'text', at: { x: t.x, y: t.y }, text: t.text, size: t.size / CAP_HEIGHT, rotation: t.rotation, anchor: 'middle', fill: C.text });
  }
  const groups = [
    { id: 'panel', name: 'Panel', prims: panel },
    { id: 'parts', name: 'Parts', prims: parts },
    { id: 'labels', name: 'Labels', prims: labels },
  ];
  const boxes = [...panel, ...parts].map((p) => (p.kind === 'shape' ? shapeBox(p.shape) : null)).filter((b) => b !== null);
  const base = unionBox(boxes) ?? { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  const box = { ...base, maxY: base.maxY + 8 };
  if (opts.caption) {
    const t = titleInfo(doc, template, opts.date ?? new Date());
    const cap: Prim[] = [
      { kind: 'text', at: { x: base.minX, y: base.minY - 8 }, text: [t.project, t.registration, `rev ${t.revision}`, t.date].filter(Boolean).join('  ·  '), size: 4.5, rotation: 0, anchor: 'start', fill: C.text, bold: true },
      { kind: 'text', at: { x: base.minX, y: base.minY - 14 }, text: `${RENDER_NOTE} ${NOT_APPROVAL}`, size: 3.2, rotation: 0, anchor: 'start', fill: C.muted },
    ];
    groups.push({ id: 'caption', name: 'Caption', prims: cap });
    box.minY = base.minY - 18;
  }
  return { groups, box };
}

export function frontSvg(doc: Project, date = new Date()): string {
  return sceneToSvg(frontScene(doc, { caption: true, date }), { title: `${doc.name} - front`, margin: 8, background: '#ffffff' });
}

/** Front render on one A4 landscape page with a title block. */
export function frontPdf(doc: Project, date = new Date()): Uint8Array {
  const scene = frontScene(doc);
  const template = resolveTemplate(doc);
  const t = titleInfo(doc, template, date);
  const checks = checkSummary(doc);
  const W = 297;
  const H = 210;
  const M = 12;
  const TB = 30;
  const pdf = new PdfWriter({ title: `${doc.name} - front render`, author: doc.author || undefined });
  const page = pdf.addPage(mm(W), mm(H));
  const bw = scene.box.maxX - scene.box.minX;
  const bh = scene.box.maxY - scene.box.minY;
  const availW = W - 2 * M;
  const availH = H - 2 * M - TB;
  const k = Math.min(availW / bw, availH / bh);
  const map: PageMap = {
    scale: k * PT_PER_MM,
    originX: scene.box.minX,
    originY: scene.box.minY,
    offsetX: mm(M + (availW - bw * k) / 2),
    offsetY: mm(M + TB + (availH - bh * k) / 2),
  };
  drawScene(page, scene, map, 0.25);
  // Title block.
  page.save().strokeColour([0.6, 0.6, 0.6]).lineWidth(0.5).moveTo(mm(M), mm(M + TB - 4)).lineTo(mm(W - M), mm(M + TB - 4)).stroke().restore();
  page.fillColour([0.11, 0.12, 0.14]);
  page.text(mm(M), mm(M + TB - 11), [t.project, t.registration].filter(Boolean).join(' - '), 13, { bold: true });
  page.text(mm(M), mm(M + TB - 17), [t.gliderType && `Glider: ${t.gliderType}`, `Revision ${t.revision}`, `Date ${t.date}`, t.author && `Author: ${t.author}`].filter(Boolean).join('    '), 8.5);
  page.text(mm(M), mm(M + TB - 22), `Template: ${t.template} (${t.templateStatus})`, 8.5);
  page.text(mm(M), mm(M + 2), `${RENDER_NOTE} ${NOT_APPROVAL}`, 7.5);
  page.text(mm(W - M), mm(M + TB - 11), `Approx. scale 1:${(1 / k).toFixed(2)}`, 8.5, { anchor: 'end' });
  page.text(mm(W - M), mm(M + TB - 17), `${checks.errors.length} errors, ${checks.warnings.length} warnings open`, 8.5, { anchor: 'end' });
  return pdf.toBytes(date);
}

/** Rasterise the front render in the browser. */
export async function frontPng(doc: Project, longSidePx = 2400, date = new Date()): Promise<Blob> {
  const svg = frontSvg(doc, date);
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
  const w = Number(m[3]);
  const h = Number(m[4]);
  const k = longSidePx / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.width = canvas.width;
    img.height = canvas.height;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the panel image'));
      img.src = url;
    });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}
