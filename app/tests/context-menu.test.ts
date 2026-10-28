import { beforeEach, describe, expect, it } from 'vitest';
import { docs, sampleProject } from '../src/store/app';
import { initialUi, ui } from '../src/store/ui';
import { COMMAND_BY_ID } from '../src/editor/commands';
import { contextMenuEntries, type ContextEntry } from '../src/editor/contextMenu';

const entries = (onItem: boolean) => contextMenuEntries(docs.doc, ui.state, onItem);
const flat = (es: ContextEntry[]): string[] => es.flatMap((e) => (typeof e === 'string' ? [e] : [`[${e.label}]`, ...flat(e.items)]));
const subs = (es: ContextEntry[]) => es.filter((e) => typeof e !== 'string').map((e) => (e as { label: string }).label);

beforeEach(() => {
  docs.load(sampleProject());
  ui.set({ ...initialUi });
});

describe('canvas context menu', () => {
  it('offers part actions for one part, without align or distribute', () => {
    ui.set({ selection: ['p1'] });
    const es = entries(true);
    expect(es.slice(0, 2)).toEqual(['edit.duplicate', 'edit.delete']);
    expect(flat(es)).toEqual(expect.arrayContaining(['arrange.rotate', 'arrange.lock', 'arrange.centre', 'arrange.mirror', 'view.fit-selection']));
    expect(subs(es)).toEqual(['Centre on panel']);
  });

  it('adds align with two parts, and distribute with three', () => {
    ui.set({ selection: ['p1', 'p2'] });
    expect(subs(entries(true))).toEqual(['Align', 'Centre on panel']);
    ui.set({ selection: ['p1', 'p2', 'p3'] });
    expect(subs(entries(true))).toEqual(['Align', 'Distribute', 'Centre on panel']);
    expect(flat(entries(true))).toContain('arrange.auto');
  });

  it('offers view and history actions on empty canvas', () => {
    const es = flat(entries(false));
    expect(es).toEqual(expect.arrayContaining(['edit.select-all', 'view.fit', 'view.flip']));
    // Nothing to undo yet, no guides and no depth clip: those are left out.
    expect(es).not.toContain('edit.undo');
    expect(es).not.toContain('view.clear-depth-clip');
  });

  it('offers to cancel a tool, and to finish a route in progress', () => {
    ui.set({ view: 'rear', tool: 'route', routeDraft: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(entries(false).slice(0, 2)).toEqual(['tool.finish-route', 'edit.deselect']);
  });

  it('lists only enabled commands, with no stray separators', () => {
    for (const sel of [[], ['p1'], ['p1', 'p2', 'p3', 'p4']]) {
      ui.set({ selection: sel });
      for (const onItem of [false, true]) {
        const es = flat(entries(onItem)).filter((e) => !e.startsWith('['));
        expect(es[0]).not.toBe('-');
        expect(es.at(-1)).not.toBe('-');
        es.forEach((e, i) => e === '-' && expect(es[i + 1]).not.toBe('-'));
        for (const id of es.filter((e) => e !== '-')) {
          const c = COMMAND_BY_ID.get(id)!;
          expect(!c.enabled || c.enabled()).toBe(true);
        }
      }
    }
  });

  it('locks and unlocks the selected parts as one undoable step', () => {
    ui.set({ selection: ['p1', 'p2'] });
    COMMAND_BY_ID.get('arrange.lock')!.run();
    expect(docs.doc.parts.filter((p) => p.locked).map((p) => p.id)).toEqual(['p1', 'p2']);
    COMMAND_BY_ID.get('arrange.lock')!.run();
    expect(docs.doc.parts.some((p) => p.locked)).toBe(false);
    docs.undo();
    expect(docs.doc.parts.filter((p) => p.locked)).toHaveLength(2);
  });
});
