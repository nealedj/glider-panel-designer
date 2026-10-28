import { beforeEach, describe, expect, it } from 'vitest';
import { docs, pik20dProject, sampleProject } from '../src/store/app';
import { ui } from '../src/store/ui';
import { ops } from '../src/store/doc';
import { autoArrange, centreOnPanel, distributeGaps } from '../src/editor/actions';
import { arrangeRows, equalGaps, faceSpanY, groupRows } from '../src/editor/arrange';
import { boxGaps, collectTargets, snapMove, type SnapTargets } from '../src/editor/snap';
import { projectGeometry, resolveTemplate } from '../src/model/resolve';
import type { Box } from '../src/geom/shapes';
import { runChecks } from '../src/checks/checks';

const part = (id: string) => docs.doc.parts.find((p) => p.id === id)!;
const box = (minX: number, maxX: number, minY = 0, maxY = 10): Box => ({ minX, maxX, minY, maxY });
const noSnap = { grid: false, objects: false, guides: false, gaps: true };
const targetsOf = (boxes: Box[]): SnapTargets => ({ xs: [], ys: [], points: [], boxes, gaps: { x: boxGaps(boxes, 'x'), y: boxGaps(boxes, 'y') } });

beforeEach(() => {
  docs.load(sampleProject());
  ui.set({ selection: [], message: '' });
});

describe('equal-gap snapping', () => {
  it('centres a part between its neighbours', () => {
    const t = targetsOf([box(0, 10), box(50, 60)]);
    const res = snapMove({ x: 4.5, y: 0 }, box(20, 30), { x: 25, y: 5 }, t, noSnap, 5, 1);
    expect(res.delta.x).toBeCloseTo(5);
    expect(res.gaps.map((g) => g.b - g.a)).toEqual([15, 15]);
  });

  it('repeats a gap already used between other parts', () => {
    const t = targetsOf([box(0, 10), box(30, 40)]);
    const res = snapMove({ x: 4.6, y: 0 }, box(55, 65), { x: 60, y: 5 }, t, noSnap, 5, 1);
    expect(res.delta.x).toBeCloseTo(5);
    expect(res.gaps).toHaveLength(2);
    for (const g of res.gaps) expect(g.b - g.a).toBeCloseTo(20);
  });

  it('ignores parts that are not side by side, and gaps out of reach', () => {
    const t = targetsOf([box(0, 10, 100, 110), box(50, 60)]);
    const res = snapMove({ x: 2, y: 0 }, box(20, 30), { x: 25, y: 5 }, t, noSnap, 5, 1);
    expect(res.delta.x).toBe(2);
    expect(res.gaps).toEqual([]);
  });

  it('matches the gap between the sample instruments when dragging a switch', () => {
    const g = projectGeometry(docs.doc);
    const settings = { ...noSnap, objects: true };
    const t = collectTargets(g, new Set(['p5']), resolveTemplate(docs.doc), [], [], settings);
    // The ASI, vario and altimeter are 24 mm apart; the master switch ends at x = -31.
    const res = snapMove({ x: 12.6, y: 0 }, g.get('p5')!.frontBox, { x: -10, y: -70 }, t, settings, 5, 1);
    expect(res.delta.x).toBeCloseTo(12);
    expect(res.gaps.every((gap) => Math.abs(gap.b - gap.a - 24) < 1e-9)).toBe(true);
  });

  it('leaves parts behind the panel out', () => {
    const t = collectTargets(projectGeometry(docs.doc), new Set(), undefined, [], [], noSnap);
    // p7 is mounted behind the vario.
    expect(t.boxes).toHaveLength(6);
    expect(collectTargets(projectGeometry(docs.doc), new Set(), undefined, [], [], { ...noSnap, gaps: false }).boxes).toEqual([]);
  });
});

describe('layout helpers', () => {
  it('finds the panel face at a point, cut short by the fold', async () => {
    const t = resolveTemplate(await pik20dProject())!;
    const stem = faceSpanY(t, 0, 20)!;
    const top = faceSpanY(t, 0, 100)!;
    expect(stem[0]).toBeCloseTo(-0.65, 1);
    // The fold runs from (-68.52, 44.35) to (68.74, 43.2).
    expect(stem[1]).toBeCloseTo(43.78, 1);
    expect(top[0]).toBeCloseTo(stem[1], 9);
    expect(top[1]).toBeGreaterThan(200);
    expect(faceSpanY(t, 0, -50)).toBeNull();
  });

  it('groups boxes into rows and spaces them evenly about the centreline', () => {
    const items = [
      { id: 'a', box: box(-100, -80, 0, 20) },
      { id: 'b', box: box(10, 40, 5, 25) },
      { id: 'c', box: box(-20, 0, -60, -40) },
    ];
    expect(groupRows(items).map((r) => r.map((i) => i.id))).toEqual([['a', 'b'], ['c']]);
    const m = arrangeRows(items, 5);
    // Row 1 is 20 + 5 + 30 wide, so it runs from -27.5 to 27.5; centres meet at y = 12.5.
    expect(m.get('a')).toEqual({ x: 72.5, y: 2.5 });
    expect(m.get('b')).toEqual({ x: -12.5, y: -2.5 });
    expect(m.get('c')).toEqual({ x: 10, y: 0 });
  });

  it('moves a row down when it would crowd the row above', () => {
    const items = [
      { id: 'a', box: box(0, 10, 0, 20) },
      { id: 'b', box: box(0, 10, -24, -4) },
    ];
    const m = arrangeRows(items, 5);
    // b's top would be 1 mm under a's bottom; it moves down to leave 5.
    expect(m.get('b')!.y).toBeCloseTo(-1);
  });

  it('spaces boxes of different sizes with equal gaps', () => {
    const s = equalGaps([{ id: 'a', box: box(0, 10) }, { id: 'b', box: box(12, 42) }, { id: 'c', box: box(90, 100) }], 'x');
    expect(s.get('a')).toBe(0);
    expect(s.get('b')).toBe(23);
    expect(s.get('c')).toBe(0);
  });
});

describe('arrange actions', () => {
  it('centres one part on the centreline and the panel face', () => {
    ui.set({ selection: ['p1'] });
    centreOnPanel('x');
    expect(part('p1')).toMatchObject({ x: 0, y: 40 });
    centreOnPanel('y');
    expect(part('p1')).toMatchObject({ x: 0, y: 0 });
    docs.undo();
    expect(part('p1')).toMatchObject({ x: 0, y: 40 });
  });

  it('centres a group as one, keeping its spacing', () => {
    ui.set({ selection: ['p4', 'p5'] });
    centreOnPanel('both');
    expect(part('p4')).toMatchObject({ x: -15, y: 0 });
    expect(part('p5')).toMatchObject({ x: 15, y: 0 });
  });

  it('does not centre a locked selection', () => {
    docs.dispatch('lock', [ops.replace('parts', { ...part('p1'), locked: true })]);
    ui.set({ selection: ['p1', 'p2'] });
    centreOnPanel('x');
    expect(part('p2').x).toBe(0);
    expect(part('p1').x).toBe(-95);
    expect(ui.state.message).toBe('Selection is locked');
  });

  it('distributes with equal gaps', () => {
    docs.dispatch('shift', [ops.replace('parts', { ...part('p2'), x: 30 })]);
    ui.set({ selection: ['p1', 'p2', 'p3'] });
    distributeGaps('x');
    expect(part('p2').x).toBeCloseTo(0);
  });

  it('auto-arranges rows, in one undoable step, with mounted parts riding along', () => {
    ui.set({ selection: ['p1', 'p2', 'p3', 'p4', 'p5'] });
    const before = docs.doc;
    autoArrange(5);
    // The vario is spaced by the 80 mm audio unit behind it, so nothing clashes behind the panel.
    expect(part('p1').x).toBeCloseTo(-85.5);
    expect(part('p2').x).toBeCloseTo(0);
    expect(part('p3').x).toBeCloseTo(85.5);
    expect(runChecks(docs.doc, projectGeometry(docs.doc)).filter((c) => c.severity === 'error')).toEqual([]);
    expect(new Set(['p1', 'p2', 'p3'].map((id) => part(id).y.toFixed(6))).size).toBe(1);
    expect(part('p4')).toMatchObject({ x: -11.5, y: -70 });
    expect(part('p5')).toMatchObject({ x: 11.5, y: -70 });
    // The audio unit is mounted to the vario, so it keeps its offset.
    expect(part('p7').mountedTo).toEqual(before.parts.find((p) => p.id === 'p7')!.mountedTo);
    expect(ui.state.message).toMatch(/^Arranged 5 parts in 2 rows, 5.00 mm apart/);
    docs.undo();
    expect(docs.doc).toEqual(before);
  });

  it('needs two parts on the panel to arrange', () => {
    ui.set({ selection: ['p7'] });
    autoArrange(5);
    expect(ui.state.message).toMatch(/two or more/);
  });
});
