/**
 * A small PDF writer: vector paths, fills, dashes, clipping and the two standard Helvetica
 * fonts. Enough for 1:1 templates and renders without a PDF library. See ADR 0008.
 *
 * Page space is PDF points with y up, which matches the drawing's world axes, so a mm
 * drawing maps to the page with a scale and an offset and no flip.
 */

/** Points per millimetre: 1 pt = 1/72 in. */
export const PT_PER_MM = 72 / 25.4;
export const mm = (v: number) => v * PT_PER_MM;

/** Helvetica advance widths for ASCII 32–126, in 1/1000 em (from the standard AFM). */
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584,
  556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278,
  469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260,
  334, 584,
];

/** Unicode characters outside Latin-1 that WinAnsiEncoding places in 0x80–0x9F. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Encode text as WinAnsi bytes (one char per byte); unmappable characters become "?". */
/** Characters outside WinAnsi with a plain stand-in. */
const SUBSTITUTE: Record<string, string> = { '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≈': '~', '−': '-', 'Ω': 'ohm', '✓': 'ok', '✗': 'x' };

export function winAnsi(text: string): string {
  let out = '';
  for (const ch of [...text].map((c) => SUBSTITUTE[c] ?? c).join('')) {
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff)) out += ch;
    else if (WIN_ANSI[ch] !== undefined) out += String.fromCharCode(WIN_ANSI[ch]);
    else out += '?';
  }
  return out;
}

/** Width of text in points, for Helvetica (bold is approximated as 5% wider). */
export function textWidthPt(text: string, sizePt: number, bold = false): number {
  let w = 0;
  for (const ch of winAnsi(text)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELV[c - 32]! : 556;
  }
  return (w / 1000) * sizePt * (bold ? 1.05 : 1);
}

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function pdfString(s: string): string {
  return '(' + winAnsi(s).replace(/[\\()]/g, (m) => '\\' + m) + ')';
}

export type Rgb = [number, number, number];

export function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

/** Bezier control points for a circular arc of up to 90°, from angle a0 sweeping s (radians). */
function arcSegment(cx: number, cy: number, r: number, a0: number, s: number): number[] {
  const k = (4 / 3) * Math.tan(s / 4);
  const a1 = a0 + s;
  const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
  return [cx + r * (c0 - k * s0), cy + r * (s0 + k * c0), cx + r * (c1 + k * s1), cy + r * (s1 - k * c1), cx + r * c1, cy + r * s1];
}

export class PdfPage {
  readonly ops: string[] = [];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  private op(s: string) {
    this.ops.push(s);
    return this;
  }
  save() {
    return this.op('q');
  }
  restore() {
    return this.op('Q');
  }
  moveTo(x: number, y: number) {
    return this.op(`${num(x)} ${num(y)} m`);
  }
  lineTo(x: number, y: number) {
    return this.op(`${num(x)} ${num(y)} l`);
  }
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    return this.op(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)} c`);
  }
  close() {
    return this.op('h');
  }
  rect(x: number, y: number, w: number, h: number) {
    return this.op(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`);
  }
  /** Arc from the current point, centred on (cx, cy), from angle a0 sweeping `sweep` radians. */
  arc(cx: number, cy: number, r: number, a0: number, sweep: number) {
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    for (let i = 0; i < n; i++) {
      const [x1, y1, x2, y2, x, y] = arcSegment(cx, cy, r, a0 + (sweep * i) / n, sweep / n);
      this.curveTo(x1!, y1!, x2!, y2!, x!, y!);
    }
    return this;
  }
  circle(cx: number, cy: number, r: number) {
    this.moveTo(cx + r, cy);
    this.arc(cx, cy, r, 0, 2 * Math.PI);
    return this.close();
  }
  stroke() {
    return this.op('S');
  }
  fill() {
    return this.op('f');
  }
  fillStroke() {
    return this.op('B');
  }
  /** Use the current path as a clip and discard it. */
  clip() {
    return this.op('W n');
  }
  lineWidth(w: number) {
    return this.op(`${num(w)} w`);
  }
  dash(pattern: number[] = []) {
    return this.op(`[${pattern.map(num).join(' ')}] 0 d`);
  }
  strokeColour([r, g, b]: Rgb) {
    return this.op(`${num(r)} ${num(g)} ${num(b)} RG`);
  }
  fillColour([r, g, b]: Rgb) {
    return this.op(`${num(r)} ${num(g)} ${num(b)} rg`);
  }
  lineCap(c: 0 | 1 | 2) {
    return this.op(`${c} J`);
  }
  /** Text at (x, y) in points, rotated counter-clockwise by `deg`. */
  text(x: number, y: number, s: string, sizePt: number, opts: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; deg?: number } = {}) {
    const w = opts.anchor && opts.anchor !== 'start' ? textWidthPt(s, sizePt, opts.bold) : 0;
    const dx = opts.anchor === 'middle' ? -w / 2 : opts.anchor === 'end' ? -w : 0;
    const a = ((opts.deg ?? 0) * Math.PI) / 180;
    const [c, sn] = [Math.cos(a), Math.sin(a)];
    const tx = x + dx * c;
    const ty = y + dx * sn;
    return this.op(`BT /${opts.bold ? 'F2' : 'F1'} ${num(sizePt)} Tf ${num(c)} ${num(sn)} ${num(-sn)} ${num(c)} ${num(tx)} ${num(ty)} Tm ${pdfString(s)} Tj ET`);
  }
}

export interface PdfInfo {
  title: string;
  author?: string;
  subject?: string;
}

export class PdfWriter {
  readonly pages: PdfPage[] = [];
  constructor(readonly info: PdfInfo) {}

  addPage(width: number, height: number): PdfPage {
    const p = new PdfPage(width, height);
    this.pages.push(p);
    return p;
  }

  /** The finished file. Streams are left uncompressed so tests can read them. */
  toBytes(created = new Date()): Uint8Array {
    const objs: string[] = [];
    const add = (body: string) => {
      objs.push(body);
      return objs.length;
    };
    const catalog = add('');
    const pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    for (const p of this.pages) {
      const content = p.ops.join('\n');
      const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    // PrintScaling /None asks viewers to default to actual size, which a 1:1 template needs.
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
    const d = created.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const info = add(
      `<< /Title ${pdfString(this.info.title)} /Producer (Glider Panel Designer) /CreationDate (D:${d}Z)${this.info.author ? ` /Author ${pdfString(this.info.author)}` : ''}${this.info.subject ? ` /Subject ${pdfString(this.info.subject)}` : ''} >>`,
    );

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
