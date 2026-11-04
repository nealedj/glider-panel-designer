import { describe, expect, it } from 'vitest';
import { fitLabel, LABEL_MAX_MM, LABEL_MIN_MM, LINE_HEIGHT, type Measure } from '../src/view3d/labels';
import type { Vec2 } from '../src/model/schema';

// A stand-in for a font: every character is 0.6 em wide.
const measure: Measure = (t) => 0.6 * t.length;

const rect = (w: number, h: number, cx = 0, cy = 0): Vec2[] => [
  { x: cx - w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 },
  { x: cx - w / 2, y: cy + h / 2 },
];
const circle = (d: number): Vec2[] => Array.from({ length: 64 }, (_, i) => ({ x: (d / 2) * Math.cos((i / 64) * 2 * Math.PI), y: (d / 2) * Math.sin((i / 64) * 2 * Math.PI) }));

describe('3D face labels', () => {
  it('writes a short name at the largest size on a roomy face, centred', () => {
    const f = fitLabel(rect(80, 60, 10, 20), 'ASI', measure)!;
    expect(f).toMatchObject({ lines: ['ASI'], x: 10, y: 20, size: LABEL_MAX_MM });
  });

  it('shrinks the text to fit, and keeps it inside the face', () => {
    const d = 57;
    const f = fitLabel(circle(d), 'Altimeter and variometer combined', measure)!;
    expect(f.size).toBeGreaterThanOrEqual(LABEL_MIN_MM);
    expect(f.size).toBeLessThan(LABEL_MAX_MM);
    const w = Math.max(...f.lines.map(measure)) * f.size;
    const h = f.lines.length * LINE_HEIGHT * f.size;
    expect(Math.hypot(w / 2, h / 2)).toBeLessThan(d / 2);
  });

  it('splits over two lines when that gives clearly larger text', () => {
    const f = fitLabel(rect(40, 40), 'Long instrument name here', measure)!;
    expect(f.lines).toHaveLength(2);
  });

  it('leaves a face plain when there is no room for legible text', () => {
    expect(fitLabel(rect(8, 3), 'Switch', measure)).toBeNull();
    expect(fitLabel(rect(80, 60), '  ', measure)).toBeNull();
  });
});
