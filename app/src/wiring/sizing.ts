/**
 * Wire sizing from the AC 43.13-1B charts, in mm².
 *
 * Wire is chosen from the chart's AWG sizes, expressed in mm². A size given in metric is
 * rated as the largest chart size not bigger than it, for both current and resistance, so a
 * metric wire is never rated above the chart.
 */
import type { ProjectSettings } from '../model/schema';
import { awgArea, TABLE_11_3, TABLE_11_9, type CopperWireRow } from './charts';

const FT_PER_M = 1 / 0.3048;

/** The chart sizes, smallest first, with their areas. */
export const CHART_SIZES = [...TABLE_11_9.rows].sort((a, b) => a.circMils - b.circMils).map((r) => ({ awg: r.awg, mm2: Math.round(awgArea(r) * 1000) / 1000, row: r }));

/** Display: "0.62 mm² (AWG 20)". */
export function sizeLabel(mm2: number): string {
  const r = chartRow(mm2);
  const exact = r && Math.abs(awgArea(r) - mm2) < 0.005;
  return `${mm2.toFixed(2)} mm²${r ? (exact ? ` (AWG ${r.awg})` : ` (rated as AWG ${r.awg})`) : ''}`;
}

/** The chart row a wire is rated by: the largest size whose area is not above it. */
export function chartRow(mm2: number): CopperWireRow | null {
  let best: CopperWireRow | null = null;
  for (const r of TABLE_11_9.rows) if (awgArea(r) <= mm2 * 1.005 && (!best || r.circMils > best.circMils)) best = r;
  return best;
}

export function ampacity(mm2: number, tempC: 105 | 150 | 200): number {
  return chartRow(mm2)?.amps[tempC] ?? 0;
}

/** Resistance, ohms per metre (tin-plated copper at 20 °C, chart maximum). */
export function ohmsPerM(mm2: number): number {
  const r = chartRow(mm2);
  return r ? r.ohmsPer1000ft / 1000 * FT_PER_M : Infinity;
}

/** The largest fuse or breaker the chart allows for a wire, A; 0 if the wire is below the chart. */
export function maxProtector(mm2: number, kind: 'fuse' | 'breaker'): number {
  const r = chartRow(mm2);
  const row = r && TABLE_11_3.rows.find((x) => x.awg === r.awg);
  return row ? row[kind] : 0;
}

export interface SizeRequest {
  currentA: number;
  lengthMm: number;
  /** Voltage drop this wire may use, V. */
  dropBudgetV: number;
  /** Protection upstream of it, if any. */
  protector?: { kind: 'fuse' | 'breaker'; ratingA: number } | null;
}

export interface SizeChoice {
  mm2: number;
  awg: string;
  /** What decided the size. */
  reason: 'minimum' | 'current' | 'voltage drop' | 'protection';
  ok: boolean;
}

/**
 * The smallest chart size that carries the current, keeps within its share of the voltage
 * drop, is protected by the fuse or breaker upstream, and is no smaller than the minimum.
 */
export function chooseSize(req: SizeRequest, settings: Pick<ProjectSettings, 'wireTempRatingC' | 'minWireAwg'>): SizeChoice {
  const minRow = TABLE_11_9.rows.find((r) => r.awg === String(settings.minWireAwg));
  const minArea = minRow ? awgArea(minRow) : 0;
  let reason: SizeChoice['reason'] = 'minimum';
  for (const s of CHART_SIZES) {
    if (awgArea(s.row) < minArea - 1e-9) continue;
    const okCurrent = s.row.amps[settings.wireTempRatingC] >= req.currentA;
    const drop = req.currentA * ohmsPerM(s.mm2) * (req.lengthMm / 1000);
    const okDrop = drop <= req.dropBudgetV + 1e-12;
    const okProt = !req.protector || maxProtector(s.mm2, req.protector.kind) >= req.protector.ratingA;
    if (okCurrent && okDrop && okProt) return { mm2: s.mm2, awg: s.awg, reason, ok: true };
    reason = !okCurrent ? 'current' : !okProt ? 'protection' : 'voltage drop';
  }
  const last = CHART_SIZES[CHART_SIZES.length - 1]!;
  return { mm2: last.mm2, awg: last.awg, reason, ok: false };
}
