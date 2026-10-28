import { beforeEach, describe, expect, it } from 'vitest';
import { docs, sampleProject } from '../src/store/app';
import { ui } from '../src/store/ui';
import { ops } from '../src/store/doc';
import { align, distribute, duplicateSelection, linearArray, circularArray, mirrorCopy, moveSelection, deleteSelection, setPartPosition } from '../src/editor/actions';
import { collectTargets, snapMove, snapPoint } from '../src/editor/snap';
import { projectGeometry, resolveTemplate } from '../src/model/resolve';

const part = (id: string) => docs.doc.parts.find((p) => p.id === id)!;

beforeEach(() => {
  docs.load(sampleProject());
  ui.set({ selection: [] });
});

describe('actions', () => {
  it('moves, and undo restores', () => {
    ui.set({ selection: ['p1', 'p2'] });
    moveSelection(3.25, -1);
    expect(part('p1')).toMatchObject({ x: -91.75, y: 39 });
    expect(part('p2')).toMatchObject({ x: 3.25, y: 49 });
    docs.undo();
    expect(part('p1')).toMatchObject({ x: -95, y: 40 });
  });

  it('sets exact positions', () => {
    setPartPosition('p4', 12.34, -56.78);
    expect(part('p4')).toMatchObject({ x: 12.34, y: -56.78 });
  });

  it('does not move locked parts', () => {
    docs.dispatch('lock', [ops.replace('parts', { ...part('p1'), locked: true })]);
    ui.set({ selection: ['p1'] });
    moveSelection(10, 0);
    expect(part('p1').x).toBe(-95);
  });

  it('aligns bottoms and centres', () => {
    ui.set({ selection: ['p1', 'p2', 'p3'] });
    align('bottom');
    const g = projectGeometry(docs.doc);
    const bottoms = ['p1', 'p2', 'p3'].map((id) => g.get(id)!.frontBox.minY);
    expect(new Set(bottoms.map((b) => b.toFixed(6))).size).toBe(1);
    align('centre-y');
    expect(new Set(['p1', 'p2', 'p3'].map((id) => part(id).y.toFixed(6))).size).toBe(1);
  });

  it('distributes centres evenly', () => {
    ui.set({ selection: ['p1', 'p2', 'p3'] });
    docs.dispatch('shift', [ops.replace('parts', { ...part('p2'), x: 30 })]);
    distribute('x');
    expect(part('p2').x).toBeCloseTo(0);
  });

  it('duplicates, mirrors and arrays', () => {
    ui.set({ selection: ['p4'] });
    duplicateSelection();
    expect(docs.doc.parts).toHaveLength(8);
    ui.set({ selection: ['p1'] });
    mirrorCopy();
    expect(docs.doc.parts.at(-1)).toMatchObject({ x: 95, y: 40 });
    ui.set({ selection: ['p4'] });
    linearArray(4, 15, 0);
    expect(docs.doc.parts.slice(-3).map((p) => p.x)).toEqual([-25, -10, 5]);
    circularArray(4, { x: -40, y: -50 }, 360, true);
    const last = docs.doc.parts.at(-1)!;
    expect(last.x).toBeCloseTo(-60);
    expect(last.y).toBeCloseTo(-50);
  });

  it('deletes and undo restores', () => {
    ui.set({ selection: ['p1', 'p2'] });
    const before = docs.doc;
    deleteSelection();
    // p7 is mounted to p2, so it goes too.
    expect(docs.doc.parts).toHaveLength(4);
    docs.undo();
    expect(docs.doc).toEqual(before);
  });
});

describe('snapping', () => {
  const snap = { grid: true, objects: true, guides: true, gaps: false };
  it('snaps a point to a part centre, then to alignment, then to the grid', () => {
    const t = collectTargets(projectGeometry(docs.doc), new Set(), resolveTemplate(docs.doc), [], [], snap);
    expect(snapPoint({ x: -94, y: 41 }, t, snap, 5, 2).point).toEqual({ x: -95, y: 40 });
    const aligned = snapPoint({ x: -94.5, y: 12.3 }, t, snap, 5, 1);
    expect(aligned.point.x).toBe(-95);
    expect(aligned.point.y).toBe(10);
    expect(snapPoint({ x: 61.2, y: 12.3 }, t, snap, 5, 0.5).point).toEqual({ x: 60, y: 10 });
  });

  it('snaps a moving part so its centre lines up with another', () => {
    const g = projectGeometry(docs.doc);
    const moving = g.get('p4')!;
    const t = collectTargets(g, new Set(['p4']), resolveTemplate(docs.doc), [], [], snap);
    // Drag the switch so its centre is 0.6 mm off the vario's x = 0.
    const res = snapMove({ x: 40.6, y: 3 }, moving.frontBox, { x: moving.transform.x, y: moving.transform.y }, t, snap, 5, 1);
    expect(res.delta.x).toBeCloseTo(40);
    expect(res.lines.some((l) => l.axis === 'x' && l.value === 0)).toBe(true);
  });

  it('snaps to guides', () => {
    const t = collectTargets(projectGeometry(docs.doc), new Set(), resolveTemplate(docs.doc), [{ id: 'g', axis: 'y', value: -33.3 }], [], snap);
    expect(snapPoint({ x: 61.2, y: -33.9 }, t, snap, 5, 1).point).toEqual({ x: 60, y: -33.3 });
  });
});
