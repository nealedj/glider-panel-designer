import { describe, expect, it } from 'vitest';
import { formatLength, parseLength } from '../src/util/units';

describe('parseLength', () => {
  it.each([
    ['57', 'metric', 57],
    ['57mm', 'metric', 57],
    ['5.7 cm', 'metric', 57],
    ['2.25in', 'metric', 57.15],
    ['2.25"', 'metric', 57.15],
    ['2 1/4in', 'metric', 57.15],
    ['1/2in', 'metric', 12.7],
    ['2.25', 'imperial', 57.15],
    ['10+2.5', 'metric', 12.5],
    ['-3.2', 'metric', -3.2],
    ['10mm-2', 'metric', 8],
  ] as const)('%s (%s) = %f mm', (text, units, mm) => {
    expect(parseLength(text, units)).toBeCloseTo(mm, 9);
  });
  it.each(['', 'abc', '5 apples', '1/0x'])('rejects %j', (text) => {
    expect(parseLength(text, 'metric')).toBeNull();
  });
});

describe('formatLength', () => {
  it('formats both unit systems', () => {
    expect(formatLength(57.15, 'metric')).toBe('57.15 mm');
    expect(formatLength(57.15, 'imperial')).toBe('2.250 in');
  });
});
