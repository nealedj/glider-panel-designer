/**
 * Template drafts, their photos and the user's own template library, kept in the browser
 * (IndexedDB). Photos never leave it: they are not in share links, exports or the repo.
 */
import { useSyncExternalStore } from 'react';
import { PanelTemplate } from '../model/schema';
import { TemplateDraft } from './draft';

const DB = 'gpd-templates';
const PHOTOS = 'photos';
const DRAFTS = 'drafts';
const LIBRARY = 'library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of [PHOTOS, DRAFTS, LIBRARY]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const putPhoto = (key: string, blob: Blob) => tx(PHOTOS, 'readwrite', (s) => s.put(blob, key));
export const getPhoto = (key: string) => tx<Blob>(PHOTOS, 'readonly', (s) => s.get(key));
export const deletePhoto = (key: string) => tx(PHOTOS, 'readwrite', (s) => s.delete(key));

export const putDraft = (d: TemplateDraft) => tx(DRAFTS, 'readwrite', (s) => s.put(d, d.id));
export const deleteDraft = (id: string) => tx(DRAFTS, 'readwrite', (s) => s.delete(id));
export async function listDrafts(): Promise<TemplateDraft[]> {
  const all = (await tx<unknown[]>(DRAFTS, 'readonly', (s) => s.getAll())) ?? [];
  return all.flatMap((d) => {
    const p = TemplateDraft.safeParse(d);
    return p.success ? [p.data] : [];
  });
}

export const putLibraryTemplate = (t: PanelTemplate) => tx(LIBRARY, 'readwrite', (s) => s.put(t, `${t.id}@${t.version}`));
export const deleteLibraryTemplate = (t: PanelTemplate) => tx(LIBRARY, 'readwrite', (s) => s.delete(`${t.id}@${t.version}`));
export async function listLibrary(): Promise<PanelTemplate[]> {
  const all = (await tx<unknown[]>(LIBRARY, 'readonly', (s) => s.getAll())) ?? [];
  return all.flatMap((t) => {
    const p = PanelTemplate.safeParse(t);
    return p.success ? [p.data] : [];
  });
}

// ---------------------------------------------------------------- live library for the UI

/** A value with change notification, for React's useSyncExternalStore. */
export class Value<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set = (v: T) => {
    this.value = v;
    for (const l of this.listeners) l();
  };
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

/** The user's own templates, loaded once and kept in step with saves. */
export const localTemplates = new Value<PanelTemplate[]>([]);

export async function refreshLocalTemplates() {
  try {
    localTemplates.set(await listLibrary());
  } catch {
    // IndexedDB unavailable (private mode in some browsers): no local library.
  }
}

export function useLocalTemplates(): PanelTemplate[] {
  return useSyncExternalStore(localTemplates.subscribe, localTemplates.get);
}
