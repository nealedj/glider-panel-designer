/**
 * Crash recovery (ADR 0013): autosave after every edit, snapshots every few minutes and
 * before the working copy is replaced, and a flush when the page is hidden or an error
 * escapes, so the last edit is not lost.
 */
import type { Project } from '../model/schema';
import { docs } from './app';
import { addSnapshot, saveAutosave, saveUnloadCopy } from './persist';
import { ui } from './ui';

export const AUTOSAVE_MS = 600;
/** Snapshot the working copy at most this often while editing. */
export const SNAPSHOT_EVERY_MS = 3 * 60_000;

let lastSnapshot = 0;

const hasWork = (d: Project) => d.parts.length + d.keepOuts.length + d.texts.length + d.dimensions.length + d.wires.length > 0;

/** Keep a snapshot of the working copy now, if it holds anything. */
export function snapshotNow(reason: string): Promise<void> {
  if (!hasWork(docs.doc)) return Promise.resolve();
  lastSnapshot = Date.now();
  return addSnapshot(docs.doc, reason).catch(() => undefined);
}

/**
 * Replace the working copy with another project, keeping a snapshot of the old one first
 * so it can be recovered (File › Recover earlier work).
 */
export function replaceWork(project: Project, reason: string) {
  void snapshotNow(`Before ${reason}`);
  docs.load(project);
  ui.set({ selection: [], wireStart: null, routeDraft: [], stack: null });
}

export function flushAutosave(): Promise<void> {
  return saveAutosave(docs.doc).catch(() => ui.set({ message: 'Autosave failed: browser storage unavailable' }));
}

/** Start autosave and snapshots; returns a function that stops them. */
export function startRecovery(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const unsub = docs.subscribe(() => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      dirty = false;
      void flushAutosave();
    }, AUTOSAVE_MS);
    if (Date.now() - lastSnapshot >= SNAPSHOT_EVERY_MS) void snapshotNow('Every few minutes while editing');
  });
  // Save at once when the tab is hidden or closed, or an error escapes, rather than wait.
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    clearTimeout(timer);
    void flushAutosave();
  };
  // Leaving the page: a synchronous copy too, since the page may be gone before IndexedDB finishes.
  const onHide = () => {
    if (dirty) saveUnloadCopy(docs.doc);
    flush();
  };
  const onVisibility = () => document.visibilityState === 'hidden' && onHide();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('error', flush);
  window.addEventListener('unhandledrejection', flush);
  void snapshotNow('Start of session');
  return () => {
    unsub();
    clearTimeout(timer);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('error', flush);
    window.removeEventListener('unhandledrejection', flush);
  };
}
