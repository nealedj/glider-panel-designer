/**
 * Wiring outputs: the wire list (CSV and PDF), wire labels for a label printer (PDF, one
 * label per page at the label's size), and the wiring diagram (SVG and PDF) from the same
 * schematic layout the app shows.
 */
import { projectGeometry } from '../model/resolve';
import type { Project } from '../model/schema';
import { analyse } from '../wiring/circuit';
import { cssColour } from '../wiring/nets';
import { layoutSchematic } from '../wiring/schematic';
import { chartRow } from '../wiring/sizing';
import { keyOf, type TerminalInfo } from '../wiring/terminals';
import { csvCell } from './bom';
import { NOT_APPROVAL, STAMP, titleInfo } from './drawing';
import { resolveTemplate } from '../model/resolve';
import { mm, PdfWriter, PT_PER_MM } from './pdf';
import { drawScene, sceneToSvg, type PageMap, type Prim, type Scene } from './scene';

export const WIRE_LIST_COLUMNS = [
  'Wire',
  'Net',
  'Type',
  'From part',
  'From connector',
  'From pin',
  'To part',
  'To connector',
  'To pin',
  'Size (mm²)',
  'AWG (chart)',
  'Tube bore (mm)',
  'Colour',
  'Length (mm)',
  'Length basis',
  'Route',
  'Current (A)',
  'Protection',
] as const;

export interface WireRow {
  cells: (string | number | null)[];
}

function end(t: TerminalInfo | undefined, doc: Project) {
  if (!t) return ['?', '', ''];
  const pp = doc.parts.find((p) => p.id === t.partId);
  const part = pp?.label || t.partId;
  return t.pin ? [part, t.connector!.id, t.pin.number] : [part, '', t.port!.id];
}

export function wireRows(doc: Project): (string | number | null)[][] {
  const a = analyse(doc);
  const rows = doc.wires.map((w) => {
    const c = a.wires.get(w.id);
    const net = doc.nets.find((n) => n.id === w.net);
    const route = doc.routes.find((r) => r.id === w.route);
    const len = c?.length;
    const size = c?.sizeMm2 ?? null;
    return [
      w.label,
      net?.name ?? '',
      net?.type ?? '',
      ...end(a.terms.get(keyOf(w.from)), doc),
      ...end(a.terms.get(keyOf(w.to)), doc),
      size === null ? '' : Math.round(size * 1000) / 1000,
      size === null ? '' : (chartRow(size)?.awg ?? ''),
      w.tubeBoreMm ?? '',
      w.colour,
      len ? Math.ceil(len.mm) : '',
      len ? (len.estimated ? 'straight-line estimate' : 'route') + (len.missingOffPanel ? '; off-panel run not set' : '') : '',
      route?.label ?? '',
      c && !c.isTube ? Math.round(c.currentA * 1000) / 1000 : '',
      c?.protector ? `${doc.parts.find((p) => p.id === c.protector!.partId)?.label || c.protector.partId} ${c.protector.ratingA} A ${c.protector.kind}` : '',
    ];
  });
  return rows.sort((x, y) => String(x[0]).localeCompare(String(y[0]), 'en', { numeric: true }));
}

export function wireListCsv(doc: Project): string {
  const lines = [WIRE_LIST_COLUMNS.join(','), ...wireRows(doc).map((r) => r.map((c) => csvCell(c === '' ? null : c)).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The wire list as an A4 landscape table, repeating its header on every page. */
export function wireListPdf(doc: Project, date = new Date()): Uint8Array {
  const t = titleInfo(doc, resolveTemplate(doc), date);
  const pdf = new PdfWriter({ title: `${doc.name} - wire list`, author: doc.author || undefined });
  const cols: { i: number; label: string; w: number }[] = [
    { i: 0, label: 'Wire', w: 14 },
    { i: 1, label: 'Net', w: 18 },
    { i: 3, label: 'From', w: 34 },
    { i: 4, label: 'Conn', w: 11 },
    { i: 5, label: 'Pin', w: 11 },
    { i: 6, label: 'To', w: 34 },
    { i: 7, label: 'Conn', w: 11 },
    { i: 8, label: 'Pin', w: 11 },
    { i: 9, label: 'mm²', w: 12 },
    { i: 10, label: 'AWG', w: 10 },
    { i: 12, label: 'Colour', w: 22 },
    { i: 13, label: 'Length', w: 15 },
    { i: 15, label: 'Route', w: 20 },
    { i: 16, label: 'A', w: 11 },
    { i: 17, label: 'Protection', w: 39 },
  ];
  const rows = wireRows(doc);
  const W = 297;
  const H = 210;
  const M = 12;
  const rowH = 5.2;
  const top = H - M - 16;
  const perPage = Math.floor((top - M - 14) / rowH);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage(mm(W), mm(H));
    page.fillColour([0, 0, 0]).text(mm(M), mm(H - M - 5), `Wire list: ${[t.project, t.registration].filter(Boolean).join(' - ')}`, 12, { bold: true });
    page.text(mm(W - M), mm(H - M - 5), `Rev ${t.revision}  ${t.date}  page ${p + 1} of ${pages}`, 8, { anchor: 'end' });
    let x = M;
    for (const c of cols) {
      page.text(mm(x), mm(top), c.label, 7.5, { bold: true });
      x += c.w;
    }
    page.save().strokeColour([0.5, 0.5, 0.5]).lineWidth(0.5).moveTo(mm(M), mm(top - 1.5)).lineTo(mm(W - M), mm(top - 1.5)).stroke().restore();
    rows.slice(p * perPage, (p + 1) * perPage).forEach((r, k) => {
      const y = top - (k + 1) * rowH;
      let cx = M;
      for (const c of cols) {
        const v = r[c.i];
        const s = v === null || v === undefined ? '' : String(v);
        // Clip long text to the column.
        const max = Math.floor(c.w / 1.45);
        page.text(mm(cx), mm(y), s.length > max ? s.slice(0, max - 1) + '…' : s, 7);
        cx += c.w;
      }
    });
    page.text(mm(M), mm(M), `${STAMP}. ${NOT_APPROVAL} Lengths include ${doc.settings.endAllowanceMm} mm per end; sizes from FAA AC 43.13-1B tables 11-9 and 11-3.`, 6.5);
  }
  return pdf.toBytes(date);
}

/** One label per wire end, each a page the size of the label (most label printers take this). */
export function wireLabelsPdf(doc: Project, date = new Date()): Uint8Array {
  const a = analyse(doc);
  const w = doc.settings.labelWidthMm;
  const h = doc.settings.labelHeightMm;
  const pdf = new PdfWriter({ title: `${doc.name} - wire labels` });
  const rows = [...doc.wires].sort((x, y) => x.label.localeCompare(y.label, 'en', { numeric: true }));
  for (const wire of rows) {
    const from = a.terms.get(keyOf(wire.from));
    const to = a.terms.get(keyOf(wire.to));
    for (const [here, there] of [
      [from, to],
      [to, from],
    ] as const) {
      const page = pdf.addPage(mm(w), mm(h));
      // The wire id large (cap height about half the label), its ends small underneath.
      const idPt = mm(Math.min(h * 0.5, 9)) / 0.718;
      const subPt = mm(Math.min(h * 0.18, 3)) / 0.718;
      page.fillColour([0, 0, 0]).text(mm(1.5), mm(h - 1.5) - idPt * 0.718, wire.label, idPt, { bold: true });
      page.text(mm(w - 1.5), mm(1.5), `${here?.label ?? '?'} → ${there?.label ?? '?'}`, subPt, { anchor: 'end' });
    }
  }
  return pdf.toBytes(date);
}

/** The schematic as a scene (y up for the shared writers). */
export function wiringScene(doc: Project): Scene {
  const g = projectGeometry(doc);
  const a = analyse(doc);
  const s = layoutSchematic(doc, g, a.terms);
  const flip = (p: { x: number; y: number }) => ({ x: p.x, y: -p.y });
  const prims: Prim[] = [];
  const text: Prim[] = [];
  for (const b of s.blocks) {
    prims.push({ kind: 'shape', shape: { kind: 'rect', cx: b.x + b.w / 2, cy: -(b.y + b.h / 2), w: b.w, h: b.h, r: 4 }, fill: '#ffffff', stroke: '#555555', width: 1, dash: b.offPanel ? [5, 3] : undefined });
    text.push({ kind: 'text', at: flip({ x: b.x + 8, y: b.y + 15 }), text: b.label, size: 11, rotation: 0, anchor: 'start', fill: '#111111', bold: true });
    if (b.sub || b.offPanel) text.push({ kind: 'text', at: flip({ x: b.x + 8, y: b.y + 25 }), text: [b.sub, b.offPanel ? 'off panel' : ''].filter(Boolean).join(' · '), size: 8, rotation: 0, anchor: 'start', fill: '#666666' });
    for (const p of b.pins) {
      prims.push({ kind: 'shape', shape: { kind: 'circle', cx: p.x, cy: -p.y, d: 6 }, fill: p.signal === 'ground' ? '#222222' : '#ffffff', stroke: '#222222', width: 0.8 });
      text.push({ kind: 'text', at: flip({ x: p.side === 'left' ? p.x + 7 : p.x - 7, y: p.y + 3.5 }), text: p.label, size: 9, rotation: 0, anchor: p.side === 'left' ? 'start' : 'end', fill: '#222222' });
    }
  }
  for (const w of s.wires) {
    const pts = w.points.map(flip);
    for (let i = 1; i < pts.length; i++) prims.push({ kind: 'line', a: pts[i - 1]!, b: pts[i]!, stroke: cssColour(w.colour), width: w.netType === 'pitot' || w.netType === 'static' || w.netType === 'te' ? 2.2 : 1.4 });
    const c = a.wires.get(w.wireId);
    if (c) {
      const m = flip({ x: (w.points[1]!.x + w.points[2]!.x) / 2 + 3, y: Math.min(w.points[1]!.y, w.points[2]!.y) + 9 });
      text.push({ kind: 'text', at: m, text: c.wire.label, size: 7, rotation: 0, anchor: 'start', fill: '#333333' });
    }
  }
  for (const l of s.labels) {
    const dir = l.side === 'left' ? -1 : 1;
    prims.push({ kind: 'line', a: flip(l), b: flip({ x: l.x + dir * 16, y: l.y }), stroke: '#222222', width: 1 });
    text.push({ kind: 'text', at: flip({ x: l.x + dir * 19, y: l.y + 3.5 }), text: l.text, size: 8.5, rotation: 0, anchor: dir < 0 ? 'end' : 'start', fill: '#222222' });
  }
  for (const gr of s.grounds) {
    const dir = gr.side === 'left' ? -1 : 1;
    const x = gr.x + dir * 14;
    for (const [a1, b1] of [
      [{ x: gr.x, y: gr.y }, { x, y: gr.y }],
      [{ x, y: gr.y }, { x, y: gr.y + 6 }],
      [{ x: x - 7, y: gr.y + 6 }, { x: x + 7, y: gr.y + 6 }],
      [{ x: x - 4.5, y: gr.y + 9 }, { x: x + 4.5, y: gr.y + 9 }],
      [{ x: x - 2, y: gr.y + 12 }, { x: x + 2, y: gr.y + 12 }],
    ] as const)
      prims.push({ kind: 'line', a: flip(a1), b: flip(b1), stroke: '#222222', width: 1 });
  }
  return {
    groups: [
      { id: 'diagram', name: 'Diagram', prims },
      { id: 'text', name: 'Text', prims: text },
    ],
    box: { minX: 0, minY: -s.height, maxX: s.width, maxY: 0 },
  };
}

export function wiringSvg(doc: Project): string {
  return sceneToSvg(wiringScene(doc), { title: `${doc.name} - wiring diagram`, description: `${STAMP}. ${NOT_APPROVAL}`, margin: 10, background: '#ffffff' });
}

export function wiringPdf(doc: Project, date = new Date()): Uint8Array {
  const scene = wiringScene(doc);
  const t = titleInfo(doc, resolveTemplate(doc), date);
  const W = 420; // A3 landscape: a diagram needs the room
  const H = 297;
  const M = 12;
  const TB = 18;
  const pdf = new PdfWriter({ title: `${doc.name} - wiring diagram`, author: doc.author || undefined });
  const page = pdf.addPage(mm(W), mm(H));
  const bw = scene.box.maxX - scene.box.minX;
  const bh = scene.box.maxY - scene.box.minY;
  const k = Math.min((W - 2 * M) / bw, (H - 2 * M - TB) / bh);
  const map: PageMap = { scale: k * PT_PER_MM, originX: scene.box.minX, originY: scene.box.minY, offsetX: mm(M), offsetY: mm(M + TB + (H - 2 * M - TB - bh * k)) };
  drawScene(page, scene, map, 0.3);
  page.fillColour([0.1, 0.1, 0.1]).text(mm(M), mm(M + 8), `Wiring diagram: ${[t.project, t.registration].filter(Boolean).join(' - ')}`, 12, { bold: true });
  page.text(mm(M), mm(M + 2), `Revision ${t.revision}   ${t.date}${t.author ? `   ${t.author}` : ''}   ${STAMP}. ${NOT_APPROVAL}`, 7.5);
  return pdf.toBytes(date);
}
