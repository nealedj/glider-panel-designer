/**
 * The right-click menu on the panel canvas. It lists commands from the registry, picked for
 * what was clicked and what is selected, so it never offers anything the menus cannot do.
 */
import type { Project } from '../model/schema';
import type { UiState } from '../store/ui';
import { COMMAND_BY_ID } from './commands';

export type ContextEntry = string | '-' | { label: string; items: string[] };

const ALIGN = ['arrange.align-left', 'arrange.align-cx', 'arrange.align-right', '-', 'arrange.align-top', 'arrange.align-cy', 'arrange.align-bottom'];
const DISTRIBUTE = ['arrange.distribute-x', 'arrange.distribute-y', '-', 'arrange.distribute-gaps-x', 'arrange.distribute-gaps-y'];
const CENTRE = ['arrange.centre', 'arrange.centre-x', 'arrange.centre-y'];

export function contextMenuEntries(doc: Project, s: Pick<UiState, 'selection' | 'tool' | 'view' | 'routeDraft'>, onItem: boolean): ContextEntry[] {
  const out: ContextEntry[] = [];
  const sel = new Set(s.selection);
  const parts = doc.parts.filter((p) => sel.has(p.id));
  const placed = parts.length + doc.keepOuts.filter((k) => sel.has(k.id)).length + doc.texts.filter((t) => sel.has(t.id)).length;
  const rear = s.view === 'rear';

  if (s.tool === 'route' && s.routeDraft.length >= 2) out.push('tool.finish-route');
  if (s.tool !== 'select') out.push('edit.deselect', '-');

  if (onItem && sel.size) {
    out.push(placed ? 'edit.duplicate' : '-', 'edit.delete', '-');
    if (parts.length) out.push('arrange.rotate', 'arrange.rotate-cw', 'arrange.lock', '-');
    if (placed >= 2) out.push({ label: 'Align', items: ALIGN });
    if (placed >= 3) out.push({ label: 'Distribute', items: DISTRIBUTE });
    if (placed) out.push({ label: 'Centre on panel', items: CENTRE });
    if (placed >= 2) out.push('arrange.auto');
    if (parts.length) out.push('-', 'arrange.mirror', 'arrange.linear-array', 'arrange.circular-array');
    if (parts.some((p) => p.mountedTo)) out.push('arrange.detach');
    if (rear) out.push('-', 'view.cycle-stack', 'wiring.put-on-route', 'wiring.take-off-route');
    out.push('-', 'view.fit-selection');
  } else {
    out.push('edit.undo', 'edit.redo', '-', 'edit.select-all', '-', 'view.fit', 'view.flip', 'view.clear-depth-clip', 'view.clear-guides');
  }
  return tidy(out);
}

/** Drop commands that do not apply now, and separators left leading, trailing or doubled. */
function tidy(entries: ContextEntry[]): ContextEntry[] {
  const usable = (id: string) => {
    const c = COMMAND_BY_ID.get(id);
    return !!c && (!c.enabled || c.enabled());
  };
  const kept = entries.flatMap((e): ContextEntry[] => {
    if (e === '-') return [e];
    if (typeof e === 'string') return usable(e) ? [e] : [];
    const items = e.items.filter((i) => i === '-' || usable(i));
    return items.some((i) => i !== '-') ? [{ ...e, items: tidy(items) as string[] }] : [];
  });
  return kept.filter((e, i) => e !== '-' || (i > 0 && i < kept.length - 1 && kept[i - 1] !== '-'));
}
