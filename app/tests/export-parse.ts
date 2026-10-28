/**
 * Minimal readers for the exported SVG, DXF and PDF, written independently of the
 * writers, so golden tests measure what a CAM tool or printer would see.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Circle {
  cx: number;
  cy: number;
  d: number;
}

export function boxOf(pts: Pt[]): Box {
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Points along a circular arc, every 0.25°, including both ends. */
function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ((0.25 * Math.PI) / 180)));
  return Array.from({ length: n + 1 }, (_, k) => ({ x: cx + r * Math.cos(a0 + (sweep * k) / n), y: cy + r * Math.sin(a0 + (sweep * k) / n) }));
}

// ---------------------------------------------------------------- SVG

export interface SvgLayer {
  circles: Circle[];
  /** Path outlines, as points in world coordinates (y up). */
  paths: Pt[][];
  texts: string[];
  lines: [Pt, Pt][];
}

/** SVG elliptical arc (rx = ry, no rotation) as points, per SVG 1.1 F.6.5. */
function svgArc(p0: Pt, r: number, large: boolean, sweep: boolean, p1: Pt): Pt[] {
  const x1 = (p0.x - p1.x) / 2;
  const y1 = (p0.y - p1.y) / 2;
  const rr = Math.max(r, Math.hypot(x1, y1));
  const num = rr * rr * rr * rr - rr * rr * y1 * y1 - rr * rr * x1 * x1;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / (rr * rr * y1 * y1 + rr * rr * x1 * x1)));
  const cxp = coef * y1;
  const cyp = -coef * x1;
  const cx = cxp + (p0.x + p1.x) / 2;
  const cy = cyp + (p0.y + p1.y) / 2;
  const t1 = Math.atan2((y1 - cyp) / rr, (x1 - cxp) / rr);
  let dt = Math.atan2((-y1 - cyp) / rr, (-x1 - cxp) / rr) - t1;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  return arcPoints(cx, cy, rr, t1, dt);
}

function svgPathPoints(d: string): Pt[] {
  const tok = d.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi)!;
  const pts: Pt[] = [];
  let i = 0;
  let cur: Pt = { x: 0, y: 0 };
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    const c = tok[i++]!;
    if (c === 'M' || c === 'L') {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (c === 'A') {
      const r = num();
      num();
      num();
      const large = num() === 1;
      const sweep = num() === 1;
      const end = { x: num(), y: num() };
      pts.push(...svgArc(cur, r, large, sweep, end));
      cur = end;
    } else if (c !== 'Z') throw new Error(`unexpected path token ${c}`);
  }
  // SVG y runs down; the drawing's world y runs up.
  return pts.map((p) => ({ x: p.x, y: -p.y }));
}

export function parseSvg(svg: string): Map<string, SvgLayer> {
  const out = new Map<string, SvgLayer>();
  const groupRe = /<g id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g;
  for (const m of svg.matchAll(groupRe)) {
    const body = m[2]!;
    const layer: SvgLayer = { circles: [], paths: [], texts: [], lines: [] };
    for (const c of body.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)) layer.circles.push({ cx: Number(c[1]), cy: -Number(c[2]), d: 2 * Number(c[3]) });
    for (const p of body.matchAll(/<path d="([^"]+)"/g)) layer.paths.push(svgPathPoints(p[1]!));
    for (const t of body.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) layer.texts.push(t[1]!);
    for (const l of body.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g))
      layer.lines.push([
        { x: Number(l[1]), y: -Number(l[2]) },
        { x: Number(l[3]), y: -Number(l[4]) },
      ]);
    out.set(m[1]!, layer);
  }
  return out;
}

// ---------------------------------------------------------------- DXF

export interface DxfEntity {
  type: string;
  layer: string;
  /** All group codes, first value wins. */
  codes: Map<number, string>;
  vertices: { x: number; y: number; bulge: number }[];
}

export function dxfPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]!.trim()), lines[i + 1]!]);
  return pairs;
}

export function parseDxf(text: string): { layers: string[]; entities: DxfEntity[]; header: Map<string, string> } {
  const pairs = dxfPairs(text);
  const header = new Map<string, string>();
  const layers: string[] = [];
  const entities: DxfEntity[] = [];
  let section = '';
  let current: DxfEntity | null = null;
  let poly: DxfEntity | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === 'SECTION') {
      section = pairs[++i]![1];
      continue;
    }
    if (section === 'HEADER' && code === 9) header.set(value, pairs[i + 1]![1].trim());
    if (section === 'TABLES' && code === 0 && value === 'LAYER') layers.push(pairs[i + 1]![1]);
    if (section !== 'ENTITIES') continue;
    if (code === 0) {
      // Finish the entity in progress.
      if (current?.type === 'VERTEX') poly?.vertices.push({ x: Number(current.codes.get(10)), y: Number(current.codes.get(20)), bulge: Number(current.codes.get(42) ?? 0) });
      else if (current && current !== poly) entities.push(current);
      current = null;
      if (value === 'SEQEND') {
        if (poly) entities.push(poly);
        poly = null;
      } else if (value !== 'ENDSEC') {
        current = { type: value, layer: '', codes: new Map(), vertices: [] };
        if (value === 'POLYLINE') poly = current;
      }
      continue;
    }
    if (!current) continue;
    if (code === 8 && !current.layer) current.layer = value;
    if (!current.codes.has(code)) current.codes.set(code, value);
  }
  return { layers, entities, header };
}

/** A DXF polyline's outline, with bulged arcs sampled. */
export function dxfPolylinePoints(e: DxfEntity): Pt[] {
  const pts: Pt[] = [];
  const v = e.vertices;
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % v.length]!;
    pts.push({ x: a.x, y: a.y });
    if (!a.bulge) continue;
    const theta = 4 * Math.atan(a.bulge);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // Centre: from the chord midpoint along the left normal by the signed apothem.
    const apothem = (chord / 2) / Math.tan(theta / 2);
    const cx = (a.x + b.x) / 2 - ((b.y - a.y) / chord) * apothem;
    const cy = (a.y + b.y) / 2 + ((b.x - a.x) / chord) * apothem;
    pts.push(...arcPoints(cx, cy, r, Math.atan2(a.y - cy, a.x - cx), theta));
  }
  return pts;
}

// ---------------------------------------------------------------- PDF

export interface PdfPath {
  /** On-curve and sampled curve points, page points. */
  points: Pt[];
  ops: string[];
  paint: 'S' | 'f' | 'B' | 'clip';
}

export interface PdfPageData {
  mediaBox: number[];
  paths: PdfPath[];
  texts: string[];
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Read objects via the xref table, as a PDF reader does, and return pages in order. */
export function parsePdf(bytes: Uint8Array): { pages: PdfPageData[]; catalog: string; xrefOk: boolean } {
  const s = latin1(bytes);
  const startxref = Number(/startxref\s+(\d+)/.exec(s.slice(-64))![1]);
  const xref = s.slice(startxref);
  const m = /^xref\s+0 (\d+)\s+/.exec(xref)!;
  const count = Number(m[1]);
  const entries = xref.slice(m[0].length).split('\n').slice(0, count);
  const objects = new Map<number, string>();
  let xrefOk = true;
  entries.forEach((line, i) => {
    if (i === 0) return;
    const off = Number(line.slice(0, 10));
    const head = `${i} 0 obj`;
    if (s.slice(off, off + head.length) !== head) xrefOk = false;
    const end = s.indexOf('endobj', off);
    objects.set(i, s.slice(off + head.length, end).trim());
  });
  const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(s)![1]!;
  const root = Number(/\/Root (\d+) 0 R/.exec(trailer)![1]);
  const catalog = objects.get(root)!;
  const pagesObj = objects.get(Number(/\/Pages (\d+) 0 R/.exec(catalog)![1]))!;
  const kids = [...pagesObj.matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
  const pages = kids.map((k) => {
    const page = objects.get(k)!;
    const mediaBox = /\/MediaBox \[([^\]]+)\]/.exec(page)![1]!.trim().split(/\s+/).map(Number);
    const content = objects.get(Number(/\/Contents (\d+) 0 R/.exec(page)![1]))!;
    const len = Number(/\/Length (\d+)/.exec(content)![1]);
    const start = content.indexOf('stream\n') + 'stream\n'.length;
    return { mediaBox, ...parseContent(content.slice(start, start + len)) };
  });
  return { pages, catalog, xrefOk };
}

function bezierPoints(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt[] {
  const out: Pt[] = [];
  for (let k = 1; k <= 64; k++) {
    const t = k / 64;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

function parseContent(stream: string): { paths: PdfPath[]; texts: string[] } {
  const paths: PdfPath[] = [];
  const texts: string[] = [];
  const tokens = stream.match(/\((?:\\.|[^\\)])*\)|\[[^\]]*\]|\/?[A-Za-z*]+|-?\d*\.?\d+/g) ?? [];
  let stack: string[] = [];
  let pts: Pt[] = [];
  let ops: string[] = [];
  let cur: Pt = { x: 0, y: 0 };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const n = (k: number) => Number(stack[stack.length - k]);
    switch (t) {
      case 'm':
      case 'l':
        cur = { x: n(2), y: n(1) };
        pts.push(cur);
        ops.push(t);
        break;
      case 'c': {
        const p1 = { x: n(6), y: n(5) };
        const p2 = { x: n(4), y: n(3) };
        const p3 = { x: n(2), y: n(1) };
        pts.push(...bezierPoints(cur, p1, p2, p3));
        cur = p3;
        ops.push('c');
        break;
      }
      case 're': {
        const [x, y, w, h] = [n(4), n(3), n(2), n(1)];
        pts.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h });
        ops.push('re');
        break;
      }
      case 'h':
        ops.push('h');
        break;
      case 'S':
      case 'f':
      case 'B':
        paths.push({ points: pts, ops, paint: t });
        pts = [];
        ops = [];
        break;
      case 'W':
        // "W n": a clip; the next token ends the path.
        paths.push({ points: pts, ops, paint: 'clip' });
        pts = [];
        ops = [];
        i++;
        break;
      case 'Tj':
        texts.push(stack[stack.length - 1]!.slice(1, -1).replace(/\\(.)/g, '$1'));
        break;
    }
    stack = /^[A-Za-z*]+$/.test(t) ? [] : [...stack, t];
  }
  return { paths, texts };
}

/** Paths that are whole circles (one move, four curves, close). */
export function pdfCircles(page: PdfPageData): { cx: number; cy: number; d: number }[] {
  return page.paths
    .filter((p) => p.ops.join(' ') === 'm c c c c h' && p.paint !== 'clip')
    .map((p) => {
      const b = boxOf(p.points);
      return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, d: b.maxX - b.minX };
    });
}
