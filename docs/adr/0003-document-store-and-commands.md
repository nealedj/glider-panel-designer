# 0003. Normalised document store with invertible commands

- Status: accepted
- Date: 2026-10-11

## Context

Front, rear and schematic views are projections of one model, and undo must work across all
of them without limit.

## Decision

- One immutable `Project` document. Collections (parts, keep-outs, nets, wires, routes…)
  are arrays of objects with string ids; a few top-level fields (name, template, settings)
  are set directly.
- Every edit is a **command**: a label plus a list of ops (`insert`, `remove`, `replace`,
  `set`). Applying an op returns its inverse, so each command records its own undo when it
  is created. Undo applies the inverse list; redo re-applies the ops.
- `insert` carries an index, so undoing a delete restores the item to its original place.
- Stored coordinates from relative moves are rounded to 1 nm to stop float noise building up;
  typed positions are stored exactly.
- UI state (tool, selection, zoom, layers) lives in a separate small store and is not undoable.
- React subscribes with `useSyncExternalStore`; no state library.

## Consequences

Undo history is a list of small diffs, cheap enough to keep without limit in a session.
Commands are a natural audit log if one is wanted later. History is not persisted across
reloads; autosave restores the document only.
