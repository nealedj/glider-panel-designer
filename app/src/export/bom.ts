/**
 * Bill of materials as CSV. One row per distinct part (catalogue part plus parameters),
 * with the labels of every placed copy. Unknown values stay blank and are counted in the
 * totals row; nothing is estimated.
 */
import { projectGeometry, resolvePart } from '../model/resolve';
import type { CataloguePart, Project } from '../model/schema';

export const BOM_COLUMNS = [
  'Item',
  'Quantity',
  'Maker',
  'Model',
  'Category',
  'Labels',
  'Parameters',
  'Source link',
  'Price',
  'Unit weight (g)',
  'Total weight (g)',
  'Unit current (A)',
  'Total current (A)',
  'Data',
] as const;

export interface BomRow {
  part: CataloguePart;
  params: Record<string, number>;
  quantity: number;
  labels: string[];
}

export function bomRows(doc: Project): BomRow[] {
  const rows = new Map<string, BomRow>();
  const geometry = projectGeometry(doc);
  for (const pp of doc.parts) {
    const part = geometry.get(pp.id)?.part ?? resolvePart(pp, doc);
    if (!part) continue;
    const params = Object.fromEntries(Object.entries(pp.params ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const key = `${pp.part.id}@${pp.part.version}:${JSON.stringify(params)}`;
    let row = rows.get(key);
    if (!row) {
      row = { part, params, quantity: 0, labels: [] };
      rows.set(key, row);
    }
    row.quantity++;
    if (pp.label) row.labels.push(pp.label);
  }
  return [...rows.values()];
}

/** Quote a CSV cell when needed, and defuse cells a spreadsheet would run as a formula. */
export function csvCell(v: string | number | null): string {
  if (v === null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function bomCsv(doc: Project): string {
  const rows = bomRows(doc);
  const lines: string[] = [BOM_COLUMNS.join(',')];
  let weight = 0;
  let current = 0;
  let unknownWeight = 0;
  let unknownCurrent = 0;
  rows.forEach((r, i) => {
    const p = r.part;
    const unitCurrent = p.power?.currentA ?? null;
    if (p.weightG === null) unknownWeight += r.quantity;
    else weight += p.weightG * r.quantity;
    // No current figure is counted as unknown, not as zero: many generic parts may be powered.
    if (unitCurrent === null) unknownCurrent += r.quantity;
    else current += unitCurrent * r.quantity;
    const cells = [
      i + 1,
      r.quantity,
      p.maker,
      p.model,
      p.category,
      r.labels.join('; '),
      Object.entries(r.params)
        .map(([k, v]) => `${p.params?.[k]?.label ?? k} ${v}${p.params?.[k]?.unit && p.params[k]!.unit !== 'count' ? ` ${p.params[k]!.unit}` : ''}`)
        .join('; '),
      p.datasheet ?? '',
      '',
      p.weightG === null ? '' : r3(p.weightG),
      p.weightG === null ? '' : r3(p.weightG * r.quantity),
      unitCurrent === null ? '' : r3(unitCurrent),
      unitCurrent === null ? '' : r3(unitCurrent * r.quantity),
      p.review === 'verified' ? 'verified' : 'unverified',
    ];
    lines.push(cells.map(csvCell).join(','));
  });
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const note = [unknownWeight && `weight unknown for ${unknownWeight}`, unknownCurrent && `current unknown for ${unknownCurrent}`].filter(Boolean).join('; ');
  lines.push(['', total, '', 'Total', '', '', note ? `Totals exclude parts with unknown values (${note})` : '', '', '', '', r3(weight), '', r3(current), ''].map(csvCell).join(','));
  // A byte-order mark lets spreadsheet apps detect UTF-8.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
