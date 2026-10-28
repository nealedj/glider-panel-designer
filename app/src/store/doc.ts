/**
 * The document store. Every edit is a command made of ops; each command records its own
 * inverse when it is created, which gives unlimited undo across all views. See ADR 0003.
 */
import type { Project } from '../model/schema';

export type Coll = 'parts' | 'keepOuts' | 'guides' | 'texts' | 'dimensions' | 'nets' | 'wires' | 'routes' | 'customParts';
export type MetaKey = 'name' | 'gliderType' | 'registration' | 'author' | 'template' | 'settings' | 'revision';

type Item<C extends Coll> = Project[C][number];

export type Op =
  | { op: 'insert'; coll: Coll; item: { id: string }; index?: number }
  | { op: 'remove'; coll: Coll; id: string }
  | { op: 'replace'; coll: Coll; item: { id: string } }
  | { op: 'set'; key: MetaKey; value: unknown };

export interface Command {
  label: string;
  ops: Op[];
  inverse: Op[];
}

function list(doc: Project, coll: Coll): { id: string }[] {
  return doc[coll] as { id: string }[];
}

/** Apply one op, returning the new document and the op that undoes it. */
export function applyOp(doc: Project, op: Op): [Project, Op] {
  switch (op.op) {
    case 'insert': {
      const items = list(doc, op.coll).slice();
      if (items.some((i) => i.id === op.item.id)) throw new Error(`duplicate id ${op.item.id} in ${op.coll}`);
      const index = op.index === undefined ? items.length : Math.max(0, Math.min(op.index, items.length));
      items.splice(index, 0, op.item);
      return [{ ...doc, [op.coll]: items }, { op: 'remove', coll: op.coll, id: op.item.id }];
    }
    case 'remove': {
      const items = list(doc, op.coll).slice();
      const index = items.findIndex((i) => i.id === op.id);
      if (index < 0) throw new Error(`no ${op.id} in ${op.coll}`);
      const [item] = items.splice(index, 1);
      return [{ ...doc, [op.coll]: items }, { op: 'insert', coll: op.coll, item: item!, index }];
    }
    case 'replace': {
      const items = list(doc, op.coll).slice();
      const index = items.findIndex((i) => i.id === op.item.id);
      if (index < 0) throw new Error(`no ${op.item.id} in ${op.coll}`);
      const old = items[index]!;
      items[index] = op.item;
      return [{ ...doc, [op.coll]: items }, { op: 'replace', coll: op.coll, item: old }];
    }
    case 'set': {
      const old = doc[op.key];
      return [{ ...doc, [op.key]: op.value }, { op: 'set', key: op.key, value: old }];
    }
  }
}

export function applyOps(doc: Project, ops: Op[]): [Project, Op[]] {
  const inverse: Op[] = [];
  let d = doc;
  for (const op of ops) {
    const [next, inv] = applyOp(d, op);
    d = next;
    inverse.unshift(inv);
  }
  return [d, inverse];
}

// Typed helpers for building ops.
export const ops = {
  insert: <C extends Coll>(coll: C, item: Item<C>, index?: number): Op => ({ op: 'insert', coll, item, index }),
  remove: (coll: Coll, id: string): Op => ({ op: 'remove', coll, id }),
  replace: <C extends Coll>(coll: C, item: Item<C>): Op => ({ op: 'replace', coll, item }),
  set: <K extends MetaKey>(key: K, value: Project[K]): Op => ({ op: 'set', key, value }),
};

type Listener = () => void;

export class DocStore {
  doc: Project;
  past: Command[] = [];
  future: Command[] = [];
  /** Increments on every change; used by autosave and memoisation. */
  version = 0;
  private listeners = new Set<Listener>();

  constructor(doc: Project) {
    this.doc = doc;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Apply ops as one undoable command. Returns false if there was nothing to do. */
  dispatch(label: string, opList: Op[]): boolean {
    if (!opList.length) return false;
    const [doc, inverse] = applyOps(this.doc, opList);
    this.doc = doc;
    this.past.push({ label, ops: opList, inverse });
    this.future = [];
    this.emit();
    return true;
  }

  undo(): string | null {
    const cmd = this.past.pop();
    if (!cmd) return null;
    this.doc = applyOps(this.doc, cmd.inverse)[0];
    this.future.push(cmd);
    this.emit();
    return cmd.label;
  }

  redo(): string | null {
    const cmd = this.future.pop();
    if (!cmd) return null;
    this.doc = applyOps(this.doc, cmd.ops)[0];
    this.past.push(cmd);
    this.emit();
    return cmd.label;
  }

  /** Replace the whole document, clearing history (open, new, import). */
  load(doc: Project) {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.emit();
  }
}

let counter = 0;
/** Short unique id for new objects. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
