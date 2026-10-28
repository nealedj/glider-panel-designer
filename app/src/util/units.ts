/**
 * Length formatting and parsing. Storage is always mm; imperial is display only.
 */
export type Units = 'metric' | 'imperial';

export const MM_PER_IN = 25.4;

export function formatLength(mm: number, units: Units, digits?: number): string {
  if (units === 'imperial') return `${(mm / MM_PER_IN).toFixed(digits ?? 3)} in`;
  return `${mm.toFixed(digits ?? 2)} mm`;
}

/** Plain number in display units, for numeric inputs. */
export function toDisplay(mm: number, units: Units): number {
  return units === 'imperial' ? round(mm / MM_PER_IN, 4) : round(mm, 3);
}

export function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

const UNIT_FACTORS: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: MM_PER_IN,
  '"': MM_PER_IN,
  inch: MM_PER_IN,
  inches: MM_PER_IN,
};

/**
 * Parse a typed length. Accepts plain numbers (in the current display units), units
 * (`57mm`, `2.25in`, `2.25"`), simple fractions (`1/2in`, `2 1/4in`) and sums (`10+2.5`).
 * Returns mm, or null if the text is not a length.
 */
export function parseLength(text: string, units: Units): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const terms = s.split(/(?=[+-])/).map((t) => t.trim()).filter(Boolean);
  let total = 0;
  for (const term of terms) {
    const v = parseTerm(term, units);
    if (v === null) return null;
    total += v;
  }
  return total;
}

function parseTerm(term: string, units: Units): number | null {
  const m = /^([+-])?\s*(\d+(?:\.\d*)?|\.\d+)?(?:\s+(\d+)\/(\d+)|\/(\d+))?\s*(mm|cm|m|in|inch|inches|")?$/.exec(term);
  if (!m) return null;
  const [, sign, num, fNum, fDen, sDen, unit] = m;
  if (num === undefined && fNum === undefined) return null;
  let value: number;
  if (sDen !== undefined) {
    // "1/2"
    if (num === undefined) return null;
    value = Number(num) / Number(sDen);
  } else {
    value = num === undefined ? 0 : Number(num);
    if (fNum !== undefined && fDen !== undefined) value += Number(fNum) / Number(fDen);
  }
  if (!Number.isFinite(value)) return null;
  const factor = unit ? UNIT_FACTORS[unit]! : units === 'imperial' ? MM_PER_IN : 1;
  return (sign === '-' ? -1 : 1) * value * factor;
}

/** Parse an angle in degrees; accepts a trailing `deg` or `°`. */
export function parseAngle(text: string): number | null {
  const m = /^\s*([+-]?\d+(?:\.\d*)?|[+-]?\.\d+)\s*(deg|°)?\s*$/.exec(text.toLowerCase());
  return m ? Number(m[1]) : null;
}
