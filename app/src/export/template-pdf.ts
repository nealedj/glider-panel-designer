/**
 * Printable 1:1 cut template: the cut drawing tiled across A4 pages, with overlap,
 * alignment marks, a 100 mm check bar on every page and a cover sheet.
 */
import type { Box } from '../geom/shapes';
import type { Project } from '../model/schema';
import { buildDrawing, LAYERS, noteLines, NOT_APPROVAL, STAMP, type Drawing } from './drawing';
import { hexRgb, mm, PdfWriter, PT_PER_MM, type PdfPage } from './pdf';
import { drawingScene, drawScene, type PageMap, type Scene } from './scene';

export const A4 = { w: 210, h: 297 };
/** Page margin, mm; most printers cannot print the outer 4–6 mm. */
export const MARGIN = 10;
/** Footer height (check bar and stamp) and header height, mm. */
export const FOOTER = 26;
export const HEADER = 9;
/** Neighbouring tiles share this much of the drawing, mm, so they can be aligned and taped. */
export const OVERLAP = 12;
/** Length of the check bar, mm. */
export const CHECK_BAR = 100;

export interface Tile {
  col: number;
  row: number;
  name: string;
  /** The part of the drawing on this tile, world mm. */
  world: Box;
}

export interface TileLayout {
  orientation: 'portrait' | 'landscape';
  page: { w: number; h: number };
  /** Printable drawing area per page, mm. */
  content: { w: number; h: number };
  cols: number;
  rows: number;
  tiles: Tile[];
  /** World positions of the alignment marks. */
  marks: { x: number; y: number }[];
}

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function layoutFor(area: Box, orientation: 'portrait' | 'landscape'): TileLayout {
  const page = orientation === 'portrait' ? A4 : { w: A4.h, h: A4.w };
  const content = { w: page.w - 2 * MARGIN, h: page.h - 2 * MARGIN - FOOTER - HEADER };
  const aw = area.maxX - area.minX;
  const ah = area.maxY - area.minY;
  const stepW = content.w - OVERLAP;
  const stepH = content.h - OVERLAP;
  const cols = Math.max(1, Math.ceil((aw - OVERLAP) / stepW - 1e-9));
  const rows = Math.max(1, Math.ceil((ah - OVERLAP) / stepH - 1e-9));
  // Centre the tiled region on the drawing.
  const totalW = cols * stepW + OVERLAP;
  const totalH = rows * stepH + OVERLAP;
  const x0 = area.minX - (totalW - aw) / 2;
  const yTop = area.maxY + (totalH - ah) / 2;
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const minX = x0 + c * stepW;
      const maxY = yTop - r * stepH;
      tiles.push({ col: c, row: r, name: `${COLS[c % 26]}${r + 1}`, world: { minX, maxX: minX + content.w, maxY, minY: maxY - content.h } });
    }
  }
  // Two marks per seam per tile, in the middle of the shared strip, plus one where seams cross.
  const marks: { x: number; y: number }[] = [];
  const seamX = Array.from({ length: cols - 1 }, (_, c) => x0 + (c + 1) * stepW + OVERLAP / 2);
  const seamY = Array.from({ length: rows - 1 }, (_, r) => yTop - (r + 1) * stepH - OVERLAP / 2);
  for (const x of seamX) {
    for (let r = 0; r < rows; r++) {
      const cy = yTop - r * stepH - content.h / 2;
      marks.push({ x, y: cy + content.h / 4 }, { x, y: cy - content.h / 4 });
    }
  }
  for (const y of seamY) {
    for (let c = 0; c < cols; c++) {
      const cx = x0 + c * stepW + content.w / 2;
      marks.push({ x: cx - content.w / 4, y }, { x: cx + content.w / 4, y });
    }
  }
  for (const x of seamX) for (const y of seamY) marks.push({ x, y });
  return { orientation, page, content, cols, rows, tiles, marks };
}

/** Tile the area in whichever orientation needs fewer pages (portrait on a tie). */
export function tileLayout(area: Box): TileLayout {
  const p = layoutFor(area, 'portrait');
  const l = layoutFor(area, 'landscape');
  return l.tiles.length < p.tiles.length ? l : p;
}

const GREY: [number, number, number] = [0.45, 0.45, 0.45];
const BLACK: [number, number, number] = [0, 0, 0];

/** The 100 mm check bar, with 10 mm ticks, its left end at (x, y) in page mm. */
export function drawCheckBar(page: PdfPage, x: number, y: number) {
  page.save().strokeColour(BLACK).fillColour(BLACK).lineWidth(0.6).lineCap(0);
  page.moveTo(mm(x), mm(y)).lineTo(mm(x + CHECK_BAR), mm(y)).stroke();
  for (let i = 0; i <= 10; i++) {
    const t = i % 5 === 0 ? 3 : 1.6;
    page.moveTo(mm(x + i * 10), mm(y)).lineTo(mm(x + i * 10), mm(y + t)).stroke();
  }
  page.text(mm(x), mm(y + 4), '0', 6, { anchor: 'middle' });
  page.text(mm(x + 50), mm(y + 4), '50', 6, { anchor: 'middle' });
  page.text(mm(x + CHECK_BAR), mm(y + 4), '100 mm', 6, { anchor: 'middle' });
  page.text(mm(x), mm(y - 3.5), 'Check: this bar must measure exactly 100 mm. If not, print again at 100% (Actual size).', 6.5);
  page.restore();
}

function drawMark(page: PdfPage, p: { x: number; y: number }) {
  const r = mm(3);
  page.save().strokeColour(BLACK).lineWidth(0.4);
  page.circle(p.x, p.y, r).stroke();
  page.moveTo(p.x - r * 1.7, p.y).lineTo(p.x + r * 1.7, p.y).stroke();
  page.moveTo(p.x, p.y - r * 1.7).lineTo(p.x, p.y + r * 1.7).stroke();
  page.restore();
}

function tileMap(page: PdfPage, layout: TileLayout, current: Tile | null, x: number, y: number, cell: number) {
  page.save().lineWidth(0.4).strokeColour(GREY);
  for (const t of layout.tiles) {
    const cx = x + t.col * cell;
    const cy = y + (layout.rows - 1 - t.row) * cell;
    page.rect(mm(cx), mm(cy), mm(cell), mm(cell));
    if (current && t === current) page.fillColour([0.75, 0.75, 0.75]).fillStroke();
    else page.stroke();
    page.fillColour(BLACK).text(mm(cx + cell / 2), mm(cy + cell / 2 - 1), t.name, Math.min(7, cell * 1.6), { anchor: 'middle' });
  }
  page.restore();
}

function footer(page: PdfPage, d: Drawing, layout: TileLayout, current: Tile | null, pageNo: number, pages: number) {
  const w = layout.page.w;
  drawCheckBar(page, MARGIN + 2, MARGIN + 14);
  page.fillColour(BLACK);
  page.text(mm(MARGIN), mm(MARGIN + 2), STAMP, 8, { bold: true });
  page.text(mm(w - MARGIN), mm(MARGIN + 2), `Rev ${d.title.revision}  ${d.title.date}  page ${pageNo} of ${pages}`, 7, { anchor: 'end' });
  if (d.overridden) page.fillColour([0.75, 0, 0]).text(mm(w - MARGIN), mm(MARGIN + 7), 'EXPORTED WITH ERRORS OVERRIDDEN - see page 1', 7, { anchor: 'end', bold: true });
  const cell = Math.min(5, 16 / Math.max(layout.cols, layout.rows));
  tileMap(page, layout, current, w - MARGIN - layout.cols * cell, MARGIN + 12, cell);
}

/** Cut layers plus reference keep-outs and dimensions; notes go on the cover sheet instead. */
function tileScene(d: Drawing): Scene {
  return drawingScene(d, { only: (l) => l !== 'notes' });
}

type NoteLine = ReturnType<typeof noteLines>[number];

function noteLine(page: PdfPage, l: NoteLine, y: number) {
  const red = l.text.startsWith('ERRORS OVERRIDDEN') || l.text.startsWith('Open errors');
  page.fillColour(red ? [0.75, 0, 0] : BLACK).text(mm(MARGIN), mm(y), l.text, 7.5, { bold: l.strong });
}

/** The cover sheet; returns the note lines that did not fit, for the notes pages. */
function coverPage(pdf: PdfWriter, d: Drawing, layout: TileLayout, scene: Scene, tilePages: number): NoteLine[] {
  const { w, h } = layout.page;
  const page = pdf.addPage(mm(w), mm(h));
  let y = h - MARGIN - 6;
  page.fillColour(BLACK).text(mm(MARGIN), mm(y), 'Printable cut template, 1:1', 14, { bold: true });
  y -= 7;
  const lines = noteLines(d);
  page.text(mm(MARGIN), mm(y), lines[0]!.text, 11, { bold: true });
  y -= 6;
  // Overview of the tiles, scaled to fit.
  const boxH = Math.min(95, h * 0.35);
  const boxW = w - 2 * MARGIN;
  const tw = layout.tiles.reduce((m, t) => Math.max(m, t.world.maxX), -Infinity) - layout.tiles[0]!.world.minX;
  const th = layout.tiles[0]!.world.maxY - layout.tiles.reduce((m, t) => Math.min(m, t.world.minY), Infinity);
  const s = Math.min(boxW / tw, boxH / th) * PT_PER_MM;
  const left = layout.tiles[0]!.world.minX;
  const bottom = layout.tiles.reduce((m, t) => Math.min(m, t.world.minY), Infinity);
  const map: PageMap = { scale: s, originX: left, originY: bottom, offsetX: mm(MARGIN + (boxW - (tw * s) / PT_PER_MM) / 2), offsetY: mm(y - boxH) };
  drawScene(page, scene, map, 0.3);
  page.save().strokeColour(GREY).lineWidth(0.5).dash([3, 2]);
  for (const t of layout.tiles) {
    const x0 = (t.world.minX - left) * s + map.offsetX;
    const y0 = (t.world.minY - bottom) * s + map.offsetY;
    page.rect(x0, y0, (t.world.maxX - t.world.minX) * s, (t.world.maxY - t.world.minY) * s).stroke();
    page.fillColour(GREY).text(x0 + 3, y0 + (t.world.maxY - t.world.minY) * s - 10, t.name, 9, { bold: true });
  }
  page.restore();
  y -= boxH + 8;

  page.fillColour(BLACK).text(mm(MARGIN), mm(y), 'How to use', 10, { bold: true });
  y -= 5;
  const steps = [
    `1. Print every page at 100% (Actual size), not "fit to page". ${tilePages} tile page${tilePages === 1 ? '' : 's'}, ${layout.cols} across by ${layout.rows} down.`,
    '2. Measure the check bar on each page. It must be exactly 100 mm.',
    `3. Tiles overlap by ${OVERLAP} mm. Trim one edge, line up the alignment marks and the drawing, and tape.`,
    '4. Check the template against the real panel and each instrument before cutting anything.',
  ];
  for (const s2 of steps) {
    page.text(mm(MARGIN), mm(y), s2, 8);
    y -= 4.5;
  }
  y -= 3;
  page.text(mm(MARGIN), mm(y), 'Layers', 10, { bold: true });
  y -= 5;
  let lx = MARGIN;
  for (const l of LAYERS.filter((x) => x.id !== 'notes')) {
    page.save().fillColour(hexRgb(l.colour)).rect(mm(lx), mm(y - 0.5), mm(3), mm(3)).fill().restore();
    const label = l.machined ? l.name : `${l.name} (not cut)`;
    page.fillColour(BLACK).text(mm(lx + 4), mm(y), label, 7);
    lx += 4 + label.length * 1.45 + 4;
    if (lx > w - MARGIN - 40) {
      lx = MARGIN;
      y -= 4.5;
    }
  }
  y -= 8;
  // Title block details, notes and open checks; the rest continue on notes pages.
  const rest = lines.slice(1);
  let i = 0;
  for (; i < rest.length && y > NOTES_BOTTOM; i++, y -= 4) noteLine(page, rest[i]!, y);
  if (i < rest.length) page.fillColour(BLACK).text(mm(MARGIN), mm(y), 'Continued on the notes page at the end.', 7.5);
  return rest.slice(i);
}

const NOTES_BOTTOM = MARGIN + FOOTER + 6;

function notesPages(pdf: PdfWriter, layout: TileLayout, lines: NoteLine[]) {
  const { w, h } = layout.page;
  while (lines.length) {
    const page = pdf.addPage(mm(w), mm(h));
    let y = h - MARGIN - 6;
    page.fillColour(BLACK).text(mm(MARGIN), mm(y), 'Notes and open checks (continued)', 12, { bold: true });
    y -= 8;
    while (lines.length && y > NOTES_BOTTOM) {
      noteLine(page, lines.shift()!, y);
      y -= 4;
    }
  }
}

export interface TemplatePdf {
  bytes: Uint8Array;
  layout: TileLayout;
}

export function templatePdf(doc: Project, opts: { date?: Date; overridden?: boolean } = {}): TemplatePdf {
  const d = buildDrawing(doc, { ...opts, notes: false });
  const scene = tileScene(d);
  const layout = tileLayout({ minX: scene.box.minX - 5, minY: scene.box.minY - 5, maxX: scene.box.maxX + 5, maxY: scene.box.maxY + 5 });
  const pdf = new PdfWriter({ title: `${d.title.project} - cut template`, author: d.title.author || undefined, subject: `${STAMP}. ${NOT_APPROVAL}` });
  const overflow = coverPage(pdf, d, layout, scene, layout.tiles.length);
  layout.tiles.forEach((t) => {
    const { w, h } = layout.page;
    const page = pdf.addPage(mm(w), mm(h));
    const frame = { x: MARGIN, y: MARGIN + FOOTER, w: layout.content.w, h: layout.content.h };
    const map: PageMap = { scale: PT_PER_MM, originX: t.world.minX, originY: t.world.minY, offsetX: mm(frame.x), offsetY: mm(frame.y) };
    page.save();
    page.rect(mm(frame.x), mm(frame.y), mm(frame.w), mm(frame.h)).clip();
    drawScene(page, scene, map);
    for (const m of layout.marks) {
      if (m.x < t.world.minX || m.x > t.world.maxX || m.y < t.world.minY || m.y > t.world.maxY) continue;
      drawMark(page, { x: mm(frame.x + m.x - t.world.minX), y: mm(frame.y + m.y - t.world.minY) });
    }
    // Where each neighbour's tile begins, so the overlap is visible.
    page.strokeColour(GREY).lineWidth(0.3).dash([2, 2]);
    if (t.col > 0) page.moveTo(mm(frame.x + OVERLAP), mm(frame.y)).lineTo(mm(frame.x + OVERLAP), mm(frame.y + frame.h)).stroke();
    if (t.col < layout.cols - 1) page.moveTo(mm(frame.x + frame.w - OVERLAP), mm(frame.y)).lineTo(mm(frame.x + frame.w - OVERLAP), mm(frame.y + frame.h)).stroke();
    if (t.row > 0) page.moveTo(mm(frame.x), mm(frame.y + frame.h - OVERLAP)).lineTo(mm(frame.x + frame.w), mm(frame.y + frame.h - OVERLAP)).stroke();
    if (t.row < layout.rows - 1) page.moveTo(mm(frame.x), mm(frame.y + OVERLAP)).lineTo(mm(frame.x + frame.w), mm(frame.y + OVERLAP)).stroke();
    page.restore();
    page.save().strokeColour(GREY).lineWidth(0.4).rect(mm(frame.x), mm(frame.y), mm(frame.w), mm(frame.h)).stroke().restore();
    page.fillColour(BLACK).text(mm(MARGIN), mm(h - MARGIN - 5), `Tile ${t.name}`, 12, { bold: true });
    page.text(mm(MARGIN + 22), mm(h - MARGIN - 5), `column ${COLS[t.col]} of ${layout.cols}, row ${t.row + 1} of ${layout.rows}. Overlap ${OVERLAP} mm; line up the alignment marks.`, 8);
    page.text(mm(w - MARGIN), mm(h - MARGIN - 5), [d.title.project, d.title.registration].filter(Boolean).join(' - '), 8, { anchor: 'end' });
  });
  notesPages(pdf, layout, overflow);
  // Footers go on last, once the page count is known. Page 1 is the cover; tiles follow.
  pdf.pages.forEach((page, i) => footer(page, d, layout, layout.tiles[i - 1] ?? null, i + 1, pdf.pages.length));
  return { bytes: pdf.toBytes(opts.date), layout };
}
