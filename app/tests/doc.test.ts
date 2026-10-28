import { describe, expect, it } from 'vitest';
import { DocStore, ops } from '../src/store/doc';
import { Project } from '../src/model/schema';
import sample from '../../fixtures/projects/sample.json';

const fresh = () => new DocStore(Project.parse(sample));

describe('DocStore', () => {
  it('undoes and redoes every kind of op back to identical documents', () => {
    const s = fresh();
    const snapshots = [s.doc];
    const p = s.doc.parts[0]!;
    s.dispatch('move', [ops.replace('parts', { ...p, x: p.x + 5 })]);
    snapshots.push(s.doc);
    s.dispatch('add', [ops.insert('parts', { ...p, id: 'new' }, 0)]);
    snapshots.push(s.doc);
    s.dispatch('remove', [ops.remove('parts', 'p3')]);
    snapshots.push(s.doc);
    s.dispatch('rename', [ops.set('name', 'Renamed')]);
    snapshots.push(s.doc);
    s.dispatch('multi', [ops.remove('parts', 'p1'), ops.insert('keepOuts', { id: 'k', label: 'k', shape: { kind: 'circle', cx: 0, cy: 0, d: 5 } })]);
    snapshots.push(s.doc);

    for (let i = snapshots.length - 2; i >= 0; i--) {
      s.undo();
      expect(s.doc).toEqual(snapshots[i]);
    }
    expect(s.undo()).toBeNull();
    for (let i = 1; i < snapshots.length; i++) {
      s.redo();
      expect(s.doc).toEqual(snapshots[i]);
    }
  });

  it('restores removed items at their original index', () => {
    const s = fresh();
    const before = s.doc.parts.map((p) => p.id);
    s.dispatch('remove', [ops.remove('parts', 'p2')]);
    s.undo();
    expect(s.doc.parts.map((p) => p.id)).toEqual(before);
  });

  it('clears redo after a new edit', () => {
    const s = fresh();
    s.dispatch('a', [ops.set('name', 'a')]);
    s.undo();
    s.dispatch('b', [ops.set('name', 'b')]);
    expect(s.redo()).toBeNull();
  });

  it('rejects duplicate ids', () => {
    const s = fresh();
    expect(() => s.dispatch('dup', [ops.insert('parts', s.doc.parts[0]!)])).toThrow();
  });
});
