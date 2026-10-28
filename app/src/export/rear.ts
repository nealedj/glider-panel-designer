/**
 * Rear layout: the back of the panel as the fitter sees it (mirrored), with every body
 * shaded by depth, parts mounted on others, the looms at their bundle width and the exits
 * of off-panel parts; plus a depth table. For planning the fit, not for cutting.
 */
import { mirrorShapeX, shapeBox, unionBox } from '../geom/shapes';
import { projectGeometry, resolveTemplate } from '../model/resolve';
import type { Project } from '../model/schema';
import { bundles } from '../wiring/bundles';
import { CAP_HEIGHT, checkSummary, NOT_APPROVAL, titleInfo } from './drawing';
import { hexRgb, mm, PdfWriter, PT_PER_MM } from './pdf';
import { drawScene, sceneToSvg, type PageMap, type Prim, type Scene } from './scene';

const C = {
  panel: '#eceef1',
  panelEdge: '#5b6068',
  bend: '#118a3a',
  bodyEdge: '#2a2e35',
  loom: '#7a8696',
  loomSpine: '#3c4654',
  exit: '#b0412e',
  text: '#1d2025',
  muted: '#5b6068',
};

/** Body fills from shallow to deep: deeper parts are darker, as they stand further out at the back. */
const DEPTH_FILLS = ['#dbe7f3', '#bcd3ea', '#9dbfe1', '#7eaad7', '#6496c9', '#4f82b6'];
const DEPTH_STEP_MM = 25;
const fillFor = (z1: number | null) => (z1 === null ? '#f3e6c4' : DEPTH_FILLS[Math.min(DEPTH_FILLS.length - 1, Math.floor(z1 / DEPTH_STEP_MM))]!);

export const REAR_NOTE = 'Rear view from behind (mirrored). Bodies shaded by how far back they reach. Planning aid, not to scale for cutting.';

export interface DepthRow {
  label: string;
  model: string;
  z0: number;
  z1: number | null;
  mountedTo: string;
}

/** Every part behind the panel, deepest first. */
export function depthRows(doc: Project): DepthRow[] {
  const geometry = projectGeometry(doc);
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const rows: DepthRow[] = [];
  for (const pp of doc.parts) {
    const g = geometry.get(pp.id);
    if (!g || g.part.offPanel || (!g.body && g.z1 === null)) continue;
    const parent = pp.mountedTo ? byId.get(pp.mountedTo.parent) : undefined;
    rows.push({ label: pp.label || g.part.model, model: `${g.part.maker} ${g.part.model}`, z0: g.z0, z1: g.z1, mountedTo: parent ? parent.label || parent.id : '' });
  }
  return rows.sort((a, b) => (b.z1 ?? Infinity) - (a.z1 ?? Infinity) || a.label.localeCompare(b.label));
}

const band = (r: Pick<DepthRow, 'z0' | 'z1'>) => (r.z1 === null ? `${Math.round(r.z0)} mm to unknown` : `${Math.round(r.z0)}–${Math.round(r.z1)} mm`);

/** The rear of the panel as a styled scene, world mm with x mirrored. */
export function rearScene(doc: Project): Scene {
  const template = resolveTemplate(doc);
  const geometry = projectGeometry(doc);
  const mx = (p: { x: number; y: number }) => ({ x: -p.x, y: p.y });
  const panel: Prim[] = [];
  const bodies: Prim[] = [];
  const looms: Prim[] = [];
  const labels: Prim[] = [];
  if (template) {
    panel.push({ kind: 'shape', shape: mirrorShapeX(template.outline), fill: C.panel, stroke: C.panelEdge, width: 0.6 });
    for (const b of template.bendLines) panel.push({ kind: 'line', a: mx(b.a), b: mx(b.b), stroke: C.bend, width: 0.4, dash: [6, 2, 1, 2] });
  }
  const size = 2.6 / CAP_HEIGHT;
  // Shallow first, so deeper bodies (nearer the viewer at the back) draw on top.
  const order = [...doc.parts].map((pp) => ({ pp, g: geometry.get(pp.id) })).filter((x) => x.g && !x.g.part.offPanel);
  order.sort((a, b) => (a.g!.z1 ?? 0) - (b.g!.z1 ?? 0));
  for (const { pp, g } of order) {
    const shape = g!.body ?? g!.bezel;
    if (!shape) continue;
    const m = mirrorShapeX(shape);
    bodies.push({ kind: 'shape', shape: m, fill: fillFor(g!.z1), stroke: C.bodyEdge, width: 0.35, dash: g!.mounted ? [2, 1.2] : undefined });
    const box = shapeBox(m);
    const cx = (box.minX + box.maxX) / 2;
    const name = pp.label || g!.part.model;
    const small = box.maxX - box.minX < 30;
    // A mounted part's label sits along its lower edge, clear of its parent's in the middle.
    const nameY = g!.mounted ? box.minY + 3 + size * CAP_HEIGHT * 1.6 : (box.minY + box.maxY) / 2 + (small ? 0 : 1.5);
    const bandY = g!.mounted ? box.minY + 3 : (box.minY + box.maxY) / 2 - 3;
    labels.push({ kind: 'text', at: { x: cx, y: nameY }, text: name, size: small ? size * 0.75 : size, rotation: 0, anchor: 'middle', fill: C.text, bold: !small });
    if (!small) labels.push({ kind: 'text', at: { x: cx, y: bandY }, text: band(g!), size: size * 0.85, rotation: 0, anchor: 'middle', fill: C.muted });
  }
  for (const b of bundles(doc)) {
    const pts = b.route.points.map(mx);
    for (let i = 1; i < pts.length; i++) {
      looms.push({ kind: 'line', a: pts[i - 1]!, b: pts[i]!, stroke: C.loom, width: Math.max(1.5, b.diameterMm) });
      looms.push({ kind: 'line', a: pts[i - 1]!, b: pts[i]!, stroke: C.loomSpine, width: 0.3, dash: [3, 1.5] });
    }
    // Label along the longest segment, just off the bundle, reading left to right.
    const z = b.route.points[0]?.z ?? 0;
    let best = 1;
    for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y) > Math.hypot(pts[best]!.x - pts[best - 1]!.x, pts[best]!.y - pts[best - 1]!.y)) best = i;
    const [p, q] = [pts[best - 1], pts[best]];
    if (p && q) {
      let deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg <= -90) deg += 180;
      const a = (deg * Math.PI) / 180;
      const off = Math.max(1.5, b.diameterMm) / 2 + 1.5;
      const at = { x: (p.x + q.x) / 2 - Math.sin(a) * off, y: (p.y + q.y) / 2 + Math.cos(a) * off };
      labels.push({ kind: 'text', at, text: `${b.route.label || 'Loom'} · ${b.wires.length} wires · Ø${b.diameterMm.toFixed(1)} mm · ${Math.round(z)} mm back`, size: size * 0.75, rotation: deg, anchor: 'middle', fill: C.loomSpine });
    }
  }
  // Off-panel parts: where their wiring leaves the panel, stacked by exit.
  const exits: { at: { x: number; y: number }; names: string[] }[] = [];
  for (const pp of doc.parts) {
    const g = geometry.get(pp.id);
    if (!g?.part.offPanel) continue;
    const at = mx(pp);
    const e = exits.find((x) => Math.hypot(x.at.x - at.x, x.at.y - at.y) < 1);
    if (e) e.names.push(pp.label || g.part.model);
    else exits.push({ at, names: [pp.label || g.part.model] });
  }
  for (const e of exits) {
    looms.push({ kind: 'shape', shape: { kind: 'circle', cx: e.at.x, cy: e.at.y, d: 5 }, fill: '#ffffff', stroke: C.exit, width: 0.6 });
    labels.push({ kind: 'text', at: { x: e.at.x + 4.5, y: e.at.y - 1 }, text: `Exit: ${e.names.join(', ')}`, size: size * 0.75, rotation: 0, anchor: 'start', fill: C.exit });
  }
  const groups = [
    { id: 'panel', name: 'Panel', prims: panel },
    { id: 'bodies', name: 'Bodies', prims: bodies },
    { id: 'looms', name: 'Looms and exits', prims: looms },
    { id: 'labels', name: 'Labels', prims: labels },
  ];
  const boxes = [...panel, ...bodies, ...looms].map((p) => (p.kind === 'shape' ? shapeBox(p.shape) : p.kind === 'line' ? { minX: Math.min(p.a.x, p.b.x), maxX: Math.max(p.a.x, p.b.x), minY: Math.min(p.a.y, p.b.y), maxY: Math.max(p.a.y, p.b.y) } : null));
  const box = unionBox(boxes.filter((b) => b !== null)) ?? { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  return { groups, box: { ...box, maxY: box.maxY + 6 } };
}

export function rearSvg(doc: Project): string {
  return sceneToSvg(rearScene(doc), { title: `${doc.name} - rear layout`, description: `${REAR_NOTE} ${NOT_APPROVAL}`, margin: 8, background: '#ffffff' });
}

/** Rear layout on one A3 landscape page: the view, a depth table and a title block. */
export function rearPdf(doc: Project, date = new Date()): Uint8Array {
  const scene = rearScene(doc);
  const template = resolveTemplate(doc);
  const t = titleInfo(doc, template, date);
  const checks = checkSummary(doc);
  const rows = depthRows(doc);
  const W = 420;
  const H = 297;
  const M = 12;
  const TB = 26;
  const TABLE_W = 112;
  const pdf = new PdfWriter({ title: `${doc.name} - rear layout`, author: doc.author || undefined });
  const page = pdf.addPage(mm(W), mm(H));
  const availW = W - 2 * M - TABLE_W - 8;
  const availH = H - 2 * M - TB;
  const bw = scene.box.maxX - scene.box.minX;
  const bh = scene.box.maxY - scene.box.minY;
  const k = Math.min(availW / bw, availH / bh);
  const map: PageMap = {
    scale: k * PT_PER_MM,
    originX: scene.box.minX,
    originY: scene.box.minY,
    offsetX: mm(M + (availW - bw * k) / 2),
    offsetY: mm(M + TB + (availH - bh * k) / 2),
  };
  drawScene(page, scene, map, 0.25);

  // Depth table, top right.
  const x0 = W - M - TABLE_W;
  let y = H - M - 4;
  page.fillColour([0.11, 0.12, 0.14]).text(mm(x0), mm(y), 'Depth behind the panel', 10, { bold: true });
  y -= 5;
  const avail = template?.availableDepth.default;
  page.text(mm(x0), mm(y), `Free depth: ${avail == null ? 'unknown (not in the template)' : `${avail} mm`}`, 7.5);
  y -= 6;
  const cols = [0, 46, 72];
  page.text(mm(x0 + cols[0]!), mm(y), 'Part', 7.5, { bold: true });
  page.text(mm(x0 + cols[1]!), mm(y), 'Depth band', 7.5, { bold: true });
  page.text(mm(x0 + cols[2]!), mm(y), 'Mounted on', 7.5, { bold: true });
  page.save().strokeColour([0.6, 0.6, 0.6]).lineWidth(0.4).moveTo(mm(x0), mm(y - 1.5)).lineTo(mm(x0 + TABLE_W), mm(y - 1.5)).stroke().restore();
  y -= 5;
  for (const r of rows) {
    if (y < M + TB + 8) {
      page.text(mm(x0), mm(y), `… and ${rows.length - rows.indexOf(r)} more`, 7);
      break;
    }
    const sw = r.z1 === null ? fillFor(null) : fillFor(r.z1);
    page.save().fillColour(hexRgb(sw)).rect(mm(x0 - 4), mm(y - 0.6), mm(2.6), mm(2.6)).fill().restore();
    page.fillColour([0.11, 0.12, 0.14]);
    page.text(mm(x0 + cols[0]!), mm(y), clip(r.label, 30), 7.5);
    page.text(mm(x0 + cols[1]!), mm(y), band(r), 7.5);
    page.text(mm(x0 + cols[2]!), mm(y), clip(r.mountedTo, 26), 7.5);
    y -= 4.2;
  }

  // Title block.
  page.save().strokeColour([0.6, 0.6, 0.6]).lineWidth(0.5).moveTo(mm(M), mm(M + TB - 4)).lineTo(mm(W - M), mm(M + TB - 4)).stroke().restore();
  page.fillColour([0.11, 0.12, 0.14]);
  page.text(mm(M), mm(M + TB - 11), `Rear layout: ${[t.project, t.registration].filter(Boolean).join(' - ')}`, 13, { bold: true });
  page.text(mm(M), mm(M + TB - 17), [t.gliderType && `Glider: ${t.gliderType}`, `Revision ${t.revision}`, `Date ${t.date}`, t.author && `Author: ${t.author}`, `Template: ${t.template} (${t.templateStatus})`].filter(Boolean).join('    '), 8.5);
  page.text(mm(M), mm(M + 2), `${REAR_NOTE} ${NOT_APPROVAL}`, 7.5);
  page.text(mm(W - M), mm(M + TB - 11), `Approx. scale 1:${(1 / k).toFixed(2)}`, 8.5, { anchor: 'end' });
  page.text(mm(W - M), mm(M + TB - 17), `${checks.errors.length} errors, ${checks.warnings.length} warnings open`, 8.5, { anchor: 'end' });
  return pdf.toBytes(date);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
