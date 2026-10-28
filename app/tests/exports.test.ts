import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bomCsv, bomRows, csvCell } from '../src/export/bom';
import { buildDrawing, STAMP } from '../src/export/drawing';
import { drawingToDxf, dxfText } from '../src/export/dxf';
import { projectJson } from '../src/export/index';
import { frontPdf, frontSvg } from '../src/export/render';
import { drawingScene, sceneToSvg } from '../src/export/scene';
import { CHECK_BAR, FOOTER, MARGIN, templatePdf, tileLayout } from '../src/export/template-pdf';
import { PT_PER_MM, textWidthPt, winAnsi } from '../src/export/pdf';
import { Project } from '../src/model/schema';
import { boxOf, dxfPolylinePoints, parseDxf, parsePdf, parseSvg, pdfCircles, type Box, type Circle } from './export-parse';

const root = join(__dirname, '..', '..');
const fixture = (name: string) => Project.parse(JSON.parse(readFileSync(join(root, 'fixtures/projects', name), 'utf8')));
const golden = fixture('export-golden.json');
const DATE = new Date('2026-10-11T12:00:00Z');
const TOL = 0.05;

// Expected geometry of the golden fixture, worked out by hand from the part definitions.
const s45 = 23.5 * Math.SQRT2; // 57 mm instrument's screw offset after a 45° turn
const EXPECTED_CIRCLE_CUTOUTS: Circle[] = [
  { cx: -60, cy: 30, d: 57 },
  { cx: 60, cy: 20, d: 80 },
  { cx: -150, cy: -80, d: 12.5 },
];
const EXPECTED_HOLES: Circle[] = [
  { cx: -60, cy: 30 + s45, d: 3.5 },
  { cx: -60 - s45, cy: 30, d: 3.5 },
  { cx: -60, cy: 30 - s45, d: 3.5 },
  { cx: -60 + s45, cy: 30, d: 3.5 },
  { cx: 25, cy: -15, d: 4.2 },
  { cx: 95, cy: -15, d: 4.2 },
  { cx: 25, cy: 55, d: 4.2 },
  { cx: 95, cy: 55, d: 4.2 },
  { cx: -190, cy: -110, d: 4.2 },
  { cx: 190, cy: -110, d: 4.2 },
  { cx: -160, cy: 40, d: 3 },
];
// Rotated rounded rect: inner half-sizes 27 × 17 turned 30°, plus the 3 mm corner radius.
const hx = 27 * Math.cos(Math.PI / 6) + 17 * Math.sin(Math.PI / 6) + 3;
const hy = 27 * Math.sin(Math.PI / 6) + 17 * Math.cos(Math.PI / 6) + 3;
const EXPECTED_OUTLINE_CUTOUTS: Box[] = [
  { minX: -50, minY: -90, maxX: 50, maxY: -20 },
  { minX: 130 - hx, minY: -60 - hy, maxX: 130 + hx, maxY: -60 + hy },
  // D-shaped custom cutout: a 90° arc of radius 10√2 centred 5 mm right of the part centre.
  { minX: -165, minY: 30, maxX: -150 + 5 + 10 * Math.SQRT2, maxY: 50 },
];

function expectCircles(actual: Circle[], expected: Circle[]) {
  expect(actual).toHaveLength(expected.length);
  for (const e of expected) {
    const match = actual.find((a) => Math.hypot(a.cx - e.cx, a.cy - e.cy) < TOL);
    expect(match, `circle at (${e.cx.toFixed(3)}, ${e.cy.toFixed(3)})`).toBeDefined();
    expect(Math.abs(match!.d - e.d)).toBeLessThan(TOL);
  }
}

function expectBoxes(actual: Box[], expected: Box[]) {
  expect(actual).toHaveLength(expected.length);
  for (const e of expected) {
    const match = actual.find((a) => Math.abs(a.minX - e.minX) < TOL && Math.abs(a.minY - e.minY) < TOL && Math.abs(a.maxX - e.maxX) < TOL && Math.abs(a.maxY - e.maxY) < TOL);
    expect(match, `outline ${JSON.stringify(e)}; got ${JSON.stringify(actual)}`).toBeDefined();
  }
}

describe('cut file SVG', () => {
  const svg = sceneToSvg(drawingScene(buildDrawing(golden, { date: DATE })), { title: 'golden' });
  const layers = parseSvg(svg);

  it('is 1:1 in millimetres', () => {
    const m = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(m[1])).toBe(Number(m[3]));
    expect(Number(m[2])).toBe(Number(m[4]));
  });

  it('has the named layers', () => {
    expect([...layers.keys()]).toEqual(['OUTLINE', 'CUTOUTS', 'SCREW_HOLES', 'BEND_LINES', 'ENGRAVING', 'KEEP_OUTS_REFERENCE', 'DIMENSIONS_REFERENCE', 'NOTES_REFERENCE']);
  });

  it('places cutouts and holes to 0.05 mm', () => {
    const cut = layers.get('CUTOUTS')!;
    expectCircles(cut.circles, EXPECTED_CIRCLE_CUTOUTS);
    expectBoxes(cut.paths.map(boxOf), EXPECTED_OUTLINE_CUTOUTS);
    expectCircles(layers.get('SCREW_HOLES')!.circles, EXPECTED_HOLES);
  });

  it('draws the outline with its curved top, and the bend line', () => {
    const outline = boxOf(layers.get('OUTLINE')!.paths[0]!);
    // Bulge 0.05 over a 380 mm chord gives a 9.5 mm rise.
    expect(outline.maxY).toBeCloseTo(120 + 0.05 * 190, 1);
    expect(outline.minX).toBeCloseTo(-200, 3);
    expect(layers.get('BEND_LINES')!.lines).toEqual([
      [
        { x: -200, y: 100 },
        { x: 200, y: 100 },
      ],
    ]);
  });

  it('carries engraving, the dimension, the stamp and open checks', () => {
    expect(layers.get('ENGRAVING')!.texts).toEqual(['MASTER']);
    expect(layers.get('DIMENSIONS_REFERENCE')!.texts).toEqual(['120.0 mm']);
    const notes = layers.get('NOTES_REFERENCE')!.texts.join('\n');
    expect(notes).toContain(STAMP);
    expect(notes).toContain('Revision 3');
    expect(notes).toContain('Date 2026-10-11');
    expect(notes).toMatch(/Open warnings \(\d+\)/);
    // Print-layer text is not cut.
    expect(svg).not.toContain('Syndicate panel');
  });

  it('stamps an override', () => {
    const doc = { ...golden, parts: [...golden.parts, { ...golden.parts[0]!, id: 'clash', x: -50 }] };
    const d = buildDrawing(doc, { date: DATE, overridden: true });
    expect(d.checks.errors.length).toBeGreaterThan(0);
    const text = sceneToSvg(drawingScene(d), { title: 'x' });
    expect(text).toContain('ERRORS OVERRIDDEN AT EXPORT');
  });
});

describe('cut file DXF', () => {
  const dxf = drawingToDxf(buildDrawing(golden, { date: DATE }));
  const { layers, entities, header } = parseDxf(dxf);
  const on = (layer: string, type: string) => entities.filter((e) => e.layer === layer && e.type === type);
  const circles = (layer: string) => on(layer, 'CIRCLE').map((e) => ({ cx: Number(e.codes.get(10)), cy: Number(e.codes.get(20)), d: 2 * Number(e.codes.get(40)) }));

  it('is R12, in millimetres, with every layer declared', () => {
    expect(header.get('$ACADVER')).toBe('AC1009');
    expect(header.get('$INSUNITS')).toBe('4');
    for (const e of entities) expect(layers).toContain(e.layer);
    expect(dxf.endsWith('EOF\r\n')).toBe(true);
  });

  it('places cutouts and holes to 0.05 mm', () => {
    expectCircles(circles('CUTOUTS'), EXPECTED_CIRCLE_CUTOUTS);
    expectBoxes(on('CUTOUTS', 'POLYLINE').map((e) => boxOf(dxfPolylinePoints(e))), EXPECTED_OUTLINE_CUTOUTS);
    expectCircles(circles('SCREW_HOLES'), EXPECTED_HOLES);
  });

  it('keeps arcs as bulges, not chords', () => {
    const outline = on('OUTLINE', 'POLYLINE')[0]!;
    expect(outline.vertices).toHaveLength(6);
    expect(outline.vertices[3]!.bulge).toBe(0.05);
    expect(outline.codes.get(70)!.trim()).toBe('1');
  });

  it('writes ASCII text with DXF symbol codes', () => {
    expect(dxfText('Ø57 ± 0.1 — 45°')).toBe('%%c57 %%p 0.1 - 45%%d');
    expect(on('ENGRAVING', 'TEXT').map((e) => e.codes.get(1))).toEqual(['MASTER']);
    expect(/[^\x00-\x7f]/.test(dxf)).toBe(false);
  });
});

describe('printable template PDF', () => {
  const { bytes, layout } = templatePdf(golden, { date: DATE });
  const pdf = parsePdf(bytes);

  it('is a well-formed PDF that asks for actual-size printing', () => {
    expect(pdf.xrefOk).toBe(true);
    expect(pdf.catalog).toContain('/PrintScaling /None');
    expect(pdf.pages.length).toBeGreaterThanOrEqual(layout.tiles.length + 1);
  });

  it('lists every open check, continuing onto notes pages when needed', () => {
    const text = pdf.pages.flatMap((p) => p.texts).join('\n');
    for (const w of buildDrawing(golden).checks.warnings) expect(text).toContain(winAnsi(w.message));
  });

  it('uses A4 pages', () => {
    const [w, h] = layout.orientation === 'portrait' ? [210, 297] : [297, 210];
    for (const p of pdf.pages) {
      expect(p.mediaBox[2]! / PT_PER_MM).toBeCloseTo(w, 3);
      expect(p.mediaBox[3]! / PT_PER_MM).toBeCloseTo(h, 3);
    }
  });

  it('puts a 100 mm check bar on every page', () => {
    for (const p of pdf.pages) {
      const bars = p.paths.filter((path) => path.paint === 'S' && path.ops.join(' ') === 'm l' && Math.abs(path.points[1]!.y - path.points[0]!.y) < 1e-6);
      const lengths = bars.map((b) => (b.points[1]!.x - b.points[0]!.x) / PT_PER_MM);
      expect(lengths.some((l) => Math.abs(l - CHECK_BAR) < 1e-3)).toBe(true);
    }
  });

  it('tiles at 1:1: every cutout and hole lands to 0.05 mm on every tile', () => {
    expect(layout.tiles.length).toBeGreaterThan(1);
    layout.tiles.forEach((t, i) => {
      const toWorld = (c: Circle): Circle => ({
        cx: (c.cx - MARGIN * PT_PER_MM) / PT_PER_MM + t.world.minX,
        cy: (c.cy - (MARGIN + FOOTER) * PT_PER_MM) / PT_PER_MM + t.world.minY,
        d: c.d / PT_PER_MM,
      });
      const circles = pdfCircles(pdf.pages[i + 1]!).map(toWorld);
      for (const e of [...EXPECTED_CIRCLE_CUTOUTS, ...EXPECTED_HOLES]) {
        const match = circles.find((a) => Math.hypot(a.cx - e.cx, a.cy - e.cy) < TOL && Math.abs(a.d - e.d) < TOL);
        expect(match, `tile ${t.name}: circle at (${e.cx}, ${e.cy})`).toBeDefined();
      }
    });
  });

  it('labels tiles and states the stamp', () => {
    const text = pdf.pages.flatMap((p) => p.texts).join('\n');
    expect(text).toContain('Tile A1');
    expect(text).toContain(STAMP);
    expect(text).toContain('Print every page at 100%');
  });

  it('overlaps neighbouring tiles and shares alignment marks between them', () => {
    const l = tileLayout({ minX: 0, minY: 0, maxX: 500, maxY: 300 });
    expect(l.tiles.length).toBeGreaterThan(2);
    const a = l.tiles[0]!;
    const b = l.tiles[1]!;
    expect(a.world.maxX - b.world.minX).toBeCloseTo(12, 6);
    const shared = l.marks.filter((m) => [a, b].every((t) => m.x >= t.world.minX && m.x <= t.world.maxX && m.y >= t.world.minY && m.y <= t.world.maxY));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });
});

describe('front render', () => {
  it('SVG shows labels and print text, and says it is not for cutting', () => {
    const svg = frontSvg(golden, DATE);
    expect(svg).toContain('Flight computer');
    expect(svg).toContain('Syndicate panel — 2026');
    expect(svg).toContain('Master, &quot;main&quot;');
    expect(svg).toContain('not to scale for cutting');
    // Mounted parts sit behind the panel and are not drawn.
    expect(svg).not.toContain('Behind ASI');
  });

  it('PDF is one landscape A4 page with a title block', () => {
    const pdf = parsePdf(frontPdf(golden, DATE));
    expect(pdf.xrefOk).toBe(true);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0]!.mediaBox[2]! / PT_PER_MM).toBeCloseTo(297, 3);
    const text = pdf.pages[0]!.texts.join('\n');
    expect(text).toContain('Export golden panel - G-TEST');
    expect(text).toContain('Revision 3');
    // WinAnsi em dash survives.
    expect(text).toContain('Syndicate panel \x97 2026');
  });

  it('measures text in Helvetica widths', () => {
    expect(textWidthPt('MM', 10)).toBeCloseTo(16.66, 2);
    expect(winAnsi('Ø57 – 2·3 ✓ → ☃')).toBe('\xd857 \x96 2\xb73 ok -> ?');
  });
});

describe('bill of materials', () => {
  it('groups identical parts and keeps parameter variants apart', () => {
    const rows = bomRows(golden);
    const displays = rows.filter((r) => r.part.id === 'generic.rect-display');
    expect(displays.map((r) => r.quantity)).toEqual([1, 1]);
    const sample = bomRows(fixture('sample.json'));
    const round80 = sample.find((r) => r.part.id === 'generic.round-80')!;
    expect(round80.quantity).toBe(2);
    expect(round80.labels).toEqual(['ASI', 'Altimeter']);
  });

  it('writes CSV with known values only and safe cells', () => {
    const csv = bomCsv(golden);
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Item,Quantity,Maker,Model,Category,Labels,Parameters,Source link,Price,Unit weight (g),Total weight (g),Unit current (A),Total current (A),Data');
    const custom = lines.find((l) => l.includes('Box with D cutout'))!;
    expect(custom).toContain(',85,85,0.12,0.12,unverified');
    expect(lines.at(-1)).toMatch(/^,7,,Total,,,"?Totals exclude parts with unknown values \(weight unknown for 6; current unknown for 6\)"?,,,,85,,0.12,$/);
    expect(lines.find((l) => l.includes('Master'))).toContain('"Master, ""main"""');
  });

  it('defuses formula-like cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5V supply')).toBe("'-5V supply");
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('project files round-trip unchanged', () => {
  const files = readdirSync(join(root, 'fixtures/projects')).filter((f) => f.endsWith('.json'));
  it.each(files)('%s', (f) => {
    const doc = fixture(f);
    expect(Project.parse(JSON.parse(projectJson(doc)))).toEqual(doc);
  });
});
