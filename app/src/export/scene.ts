/**
 * Styled drawing primitives in world mm, grouped into named layers. The SVG and PDF
 * writers draw scenes; the cut drawing and the front render each build one.
 */
import { arcCentre, rectToPoly, type Box } from '../geom/shapes';
import type { Shape, Vec2 } from '../model/schema';
import { CAP_HEIGHT, LAYER_BY_ID, type Drawing } from './drawing';
import { hexRgb, type PdfPage } from './pdf';

export interface Style {
  fill?: string | null;
  stroke?: string | null;
  /** Stroke width, mm. */
  width?: number;
  /** Dash pattern, mm. */
  dash?: number[];
}

export type Prim =
  | ({ kind: 'shape'; shape: Shape } & Style)
  | ({ kind: 'line'; a: Vec2; b: Vec2 } & Style)
  /** `size` is the font size (em), mm. */
  | { kind: 'text'; at: Vec2; text: string; size: number; rotation: number; anchor: 'start' | 'middle' | 'end'; fill: string; bold?: boolean };

export interface SceneGroup {
  id: string;
  name: string;
  prims: Prim[];
}

export interface Scene {
  groups: SceneGroup[];
  box: Box;
}

/** Cut lines are drawn as hairlines; CAM tools follow the path, not the stroke. */
export const CUT_STROKE = 0.1;

/** The cut drawing as a scene: one group per layer, outlines only. */
export function drawingScene(d: Drawing, opts: { only?: (layer: string) => boolean } = {}): Scene {
  const groups = new Map<string, SceneGroup>();
  for (const e of d.entities) {
    if (opts.only && !opts.only(e.layer)) continue;
    const def = LAYER_BY_ID.get(e.layer)!;
    let g = groups.get(e.layer);
    if (!g) {
      g = { id: e.layer, name: def.name, prims: [] };
      groups.set(e.layer, g);
    }
    const dash = e.layer === 'bends' ? [6, 2, 1, 2] : e.layer === 'keepouts' ? [3, 2] : undefined;
    if (e.kind === 'text') g.prims.push({ kind: 'text', at: e.at, text: e.text, size: e.size / CAP_HEIGHT, rotation: e.rotation, anchor: e.anchor, fill: def.colour });
    else if (e.kind === 'line') g.prims.push({ kind: 'line', a: e.a, b: e.b, stroke: def.colour, width: CUT_STROKE, dash });
    else g.prims.push({ kind: 'shape', shape: e.shape, fill: null, stroke: def.colour, width: CUT_STROKE, dash });
  }
  // Keep layer order stable, as listed in LAYERS.
  const order = [...LAYER_BY_ID.keys()];
  return { groups: [...groups.values()].sort((a, b) => order.indexOf(a.id as never) - order.indexOf(b.id as never)), box: d.box };
}

// ---------------------------------------------------------------- SVG

const n = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** SVG path data with y negated (SVG y runs down). */
export function svgPathData(shape: Shape): string {
  if (shape.kind === 'circle') {
    const r = shape.d / 2;
    return `M${n(shape.cx - r)} ${n(-shape.cy)}A${n(r)} ${n(r)} 0 1 0 ${n(shape.cx + r)} ${n(-shape.cy)}A${n(r)} ${n(r)} 0 1 0 ${n(shape.cx - r)} ${n(-shape.cy)}Z`;
  }
  const pts = shape.kind === 'rect' ? rectToPoly(shape).points : shape.points;
  let d = `M${n(pts[0]!.x)} ${n(-pts[0]!.y)}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (a.bulge) {
      const { r } = arcCentre(a, b, a.bulge);
      // Negating y reverses the turning direction, so a counter-clockwise arc sweeps the other way.
      d += `A${n(r)} ${n(r)} 0 ${Math.abs(a.bulge) > 1 ? 1 : 0} ${a.bulge > 0 ? 0 : 1} ${n(b.x)} ${n(-b.y)}`;
    } else if (i < pts.length - 1) d += `L${n(b.x)} ${n(-b.y)}`;
  }
  return d + 'Z';
}

function styleAttrs(p: Style): string {
  const parts = [`fill="${p.fill ?? 'none'}"`, `stroke="${p.stroke ?? 'none'}"`];
  if (p.stroke) parts.push(`stroke-width="${n(p.width ?? CUT_STROKE)}"`);
  if (p.dash?.length) parts.push(`stroke-dasharray="${p.dash.map(n).join(' ')}"`);
  return parts.join(' ');
}

function svgPrim(p: Prim): string {
  switch (p.kind) {
    case 'shape':
      if (p.shape.kind === 'circle') return `<circle cx="${n(p.shape.cx)}" cy="${n(-p.shape.cy)}" r="${n(p.shape.d / 2)}" ${styleAttrs(p)}/>`;
      return `<path d="${svgPathData(p.shape)}" ${styleAttrs(p)}/>`;
    case 'line':
      return `<line x1="${n(p.a.x)}" y1="${n(-p.a.y)}" x2="${n(p.b.x)}" y2="${n(-p.b.y)}" ${styleAttrs(p)}/>`;
    case 'text': {
      const rot = p.rotation ? ` transform="rotate(${n(-p.rotation)} ${n(p.at.x)} ${n(-p.at.y)})"` : '';
      return `<text x="${n(p.at.x)}" y="${n(-p.at.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(p.size)}"${p.bold ? ' font-weight="bold"' : ''} text-anchor="${p.anchor}" fill="${p.fill}"${rot}>${escapeXml(p.text)}</text>`;
    }
  }
}

export interface SvgOptions {
  title: string;
  description?: string;
  /** Margin around the scene, mm. */
  margin?: number;
  background?: string;
}

/** A standalone SVG at 1:1: width and height in mm, one user unit per mm. */
export function sceneToSvg(scene: Scene, opts: SvgOptions): string {
  const m = opts.margin ?? 5;
  const x = scene.box.minX - m;
  const y = -scene.box.maxY - m;
  const w = scene.box.maxX - scene.box.minX + 2 * m;
  const h = scene.box.maxY - scene.box.minY + 2 * m;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${n(w)}mm" height="${n(h)}mm" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}">`,
  );
  out.push(`<title>${escapeXml(opts.title)}</title>`);
  if (opts.description) out.push(`<desc>${escapeXml(opts.description)}</desc>`);
  if (opts.background) out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${opts.background}"/>`);
  for (const g of scene.groups) {
    out.push(`<g id="${escapeXml(g.name)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(g.name)}">`);
    for (const p of g.prims) out.push(svgPrim(p));
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- PDF

/** Maps world mm to page points: page = (world - origin) * scale + offset. */
export interface PageMap {
  scale: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
}

export const toPage = (m: PageMap, p: Vec2): Vec2 => ({ x: (p.x - m.originX) * m.scale + m.offsetX, y: (p.y - m.originY) * m.scale + m.offsetY });

function pdfShapePath(page: PdfPage, m: PageMap, shape: Shape) {
  if (shape.kind === 'circle') {
    const c = toPage(m, { x: shape.cx, y: shape.cy });
    page.circle(c.x, c.y, (shape.d / 2) * m.scale);
    return;
  }
  const pts = shape.kind === 'rect' ? rectToPoly(shape).points : shape.points;
  const p0 = toPage(m, pts[0]!);
  page.moveTo(p0.x, p0.y);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (a.bulge) {
      const { cx, cy, r } = arcCentre(a, b, a.bulge);
      const a0 = Math.atan2(a.y - cy, a.x - cx);
      const c = toPage(m, { x: cx, y: cy });
      page.arc(c.x, c.y, r * m.scale, a0, 4 * Math.atan(a.bulge));
    } else if (i < pts.length - 1) {
      const q = toPage(m, b);
      page.lineTo(q.x, q.y);
    }
  }
  page.close();
}

/**
 * Draw a scene onto a page. Stroke widths scale with the drawing but never fall below
 * `minStrokePt`, so hairlines stay visible when printed.
 */
export function drawScene(page: PdfPage, scene: Scene, m: PageMap, minStrokePt = 0.35) {
  for (const g of scene.groups) {
    for (const p of g.prims) {
      if (p.kind === 'text') {
        const at = toPage(m, p.at);
        page.fillColour(hexRgb(p.fill)).text(at.x, at.y, p.text, p.size * m.scale, { anchor: p.anchor, deg: p.rotation, bold: p.bold });
        continue;
      }
      const stroke = p.stroke ?? null;
      const fill = p.fill ?? null;
      if (!stroke && !fill) continue;
      page.save();
      if (stroke) page.strokeColour(hexRgb(stroke)).lineWidth(Math.max(minStrokePt, (p.width ?? CUT_STROKE) * m.scale)).dash((p.dash ?? []).map((d) => d * m.scale));
      if (fill) page.fillColour(hexRgb(fill));
      if (p.kind === 'line') {
        const a = toPage(m, p.a);
        const b = toPage(m, p.b);
        page.moveTo(a.x, a.y).lineTo(b.x, b.y);
      } else pdfShapePath(page, m, p.shape);
      if (stroke && fill) page.fillStroke();
      else if (fill) page.fill();
      else page.stroke();
      page.restore();
    }
  }
}
