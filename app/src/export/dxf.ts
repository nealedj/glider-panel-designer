/**
 * DXF writer: AutoCAD R12 ASCII (AC1009), the version almost every CAM tool reads.
 * Millimetres, 1:1, one layer per drawing layer. Arcs stay exact: polylines carry DXF
 * bulges, the same convention the schema uses, and holes are true circles. See ADR 0008.
 */
import { rectToPoly } from '../geom/shapes';
import type { Shape } from '../model/schema';
import { LAYERS, type Drawing, type Entity } from './drawing';

const n = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0.0' : Number.isInteger(r) ? `${r}.0` : String(r);
};

/** Plain ASCII for R12 text, using DXF's control codes for the drawing symbols. */
export function dxfText(s: string): string {
  const map: Record<string, string> = { '°': '%%d', 'Ø': '%%c', '⌀': '%%c', '±': '%%p', '—': '-', '–': '-', '×': 'x', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' };
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += map[ch] ?? (c >= 32 && c < 127 ? ch : '?');
  }
  return out;
}

class Out {
  lines: string[] = [];
  g(code: number, value: string | number) {
    this.lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? n(value) : value);
    return this;
  }
}

function shape(o: Out, layer: string, s: Shape) {
  if (s.kind === 'circle') {
    o.g(0, 'CIRCLE').g(8, layer).g(10, s.cx).g(20, s.cy).g(30, 0).g(40, s.d / 2);
    return;
  }
  const pts = s.kind === 'rect' ? rectToPoly(s).points : s.points;
  o.g(0, 'POLYLINE').g(8, layer).g(66, '1').g(10, 0).g(20, 0).g(30, 0).g(70, '1');
  for (const p of pts) {
    o.g(0, 'VERTEX').g(8, layer).g(10, p.x).g(20, p.y).g(30, 0);
    if (p.bulge) o.g(42, p.bulge);
  }
  o.g(0, 'SEQEND').g(8, layer);
}

function entity(o: Out, e: Entity, layerName: string) {
  switch (e.kind) {
    case 'shape':
      shape(o, layerName, e.shape);
      break;
    case 'line':
      o.g(0, 'LINE').g(8, layerName).g(10, e.a.x).g(20, e.a.y).g(30, 0).g(11, e.b.x).g(21, e.b.y).g(31, 0);
      break;
    case 'text': {
      const h = e.anchor === 'middle' ? 1 : e.anchor === 'end' ? 2 : 0;
      o.g(0, 'TEXT').g(8, layerName).g(10, e.at.x).g(20, e.at.y).g(30, 0).g(40, e.size).g(1, dxfText(e.text));
      if (e.rotation) o.g(50, e.rotation);
      if (h) o.g(72, String(h)).g(11, e.at.x).g(21, e.at.y).g(31, 0);
      break;
    }
  }
}

export function drawingToDxf(d: Drawing): string {
  const o = new Out();
  const names = new Map(LAYERS.map((l) => [l.id, l.name]));
  o.g(0, 'SECTION').g(2, 'HEADER');
  o.g(9, '$ACADVER').g(1, 'AC1009');
  // 4 = millimetres; 1 = metric. Readers that ignore these assume drawing units, which are mm.
  o.g(9, '$INSUNITS').g(70, '4');
  o.g(9, '$MEASUREMENT').g(70, '1');
  o.g(9, '$EXTMIN').g(10, d.box.minX).g(20, d.box.minY).g(30, 0);
  o.g(9, '$EXTMAX').g(10, d.box.maxX).g(20, d.box.maxY).g(30, 0);
  o.g(0, 'ENDSEC');

  o.g(0, 'SECTION').g(2, 'TABLES');
  o.g(0, 'TABLE').g(2, 'LTYPE').g(70, '1');
  o.g(0, 'LTYPE').g(2, 'CONTINUOUS').g(70, '0').g(3, 'Solid line').g(72, '65').g(73, '0').g(40, 0);
  o.g(0, 'ENDTAB');
  o.g(0, 'TABLE').g(2, 'LAYER').g(70, String(LAYERS.length));
  for (const l of LAYERS) o.g(0, 'LAYER').g(2, l.name).g(70, '0').g(62, String(l.aci)).g(6, 'CONTINUOUS');
  o.g(0, 'ENDTAB');
  o.g(0, 'ENDSEC');

  o.g(0, 'SECTION').g(2, 'ENTITIES');
  for (const e of d.entities) entity(o, e, names.get(e.layer)!);
  o.g(0, 'ENDSEC');
  o.g(0, 'EOF');
  // DXF readers expect CRLF on some platforms; CRLF is safe everywhere.
  return o.lines.join('\r\n') + '\r\n';
}
