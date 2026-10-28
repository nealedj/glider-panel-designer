/**
 * Editing the selected template feature: move and delete. Shared by the canvas, the panels
 * and keyboard commands.
 */
import type { Shape, Vec2 } from '../model/schema';
import { drafts, tplUi } from './session';

/** Move the selected feature by (dx, dy) template mm. Live moves skip the undo history. */
export function moveSelectedFeature(dx: number, dy: number, live = false) {
  const sel = tplUi.state.selection;
  const d = drafts.draft;
  if (!sel || !d) return;
  const mv = (p: Vec2) => ({ x: p.x + dx, y: p.y + dy });
  const mvShape = (s: Shape): Shape => (s.kind === 'poly' ? { ...s, points: s.points.map((p) => ({ ...p, ...mv(p) })) } : { ...s, cx: s.cx + dx, cy: s.cy + dy });
  const apply = (x: typeof d) => {
    switch (sel.kind) {
      case 'vertex':
        return { ...x, outline: x.outline.map((p, i) => (i === sel.id ? { ...p, ...mv(p) } : p)) };
      case 'bend':
        return { ...x, bendLines: x.bendLines.map((b, i) => (i === sel.id ? { ...b, a: mv(b.a), b: mv(b.b) } : b)) };
      case 'fixing':
        return { ...x, fixings: x.fixings.map((f, i) => (i === sel.id ? { ...f, ...mv(f) } : f)) };
      case 'keepout':
        return { ...x, keepOuts: x.keepOuts.map((k) => (k.id === sel.id ? { ...k, shape: mvShape(k.shape) } : k)) };
      case 'check':
        return { ...x, checks: x.checks.map((c) => (c.id === sel.id ? { ...c, a: mv(c.a), b: mv(c.b) } : c)) };
    }
  };
  if (live) drafts.setLive(apply);
  else drafts.update(apply);
}


/** Delete the selected vertex or feature. */
export function deleteTplSelection() {
  const sel = tplUi.state.selection;
  if (!sel) return;
  drafts.update((x) => {
    switch (sel.kind) {
      case 'vertex':
        return x.outline.length > 3 ? { ...x, outline: x.outline.filter((_, i) => i !== sel.id).map((p, i, arr) => (i === ((sel.id as number) - 1 + arr.length) % arr.length ? { x: p.x, y: p.y } : p)) } : x;
      case 'bend':
        return { ...x, bendLines: x.bendLines.filter((_, i) => i !== sel.id) };
      case 'fixing':
        return { ...x, fixings: x.fixings.filter((_, i) => i !== sel.id) };
      case 'keepout':
        return { ...x, keepOuts: x.keepOuts.filter((k) => k.id !== sel.id) };
      case 'check':
        return { ...x, checks: x.checks.filter((c) => c.id !== sel.id) };
    }
  });
  tplUi.set({ selection: null });
}


