/**
 * Local storage of work, for crash recovery (ADR 0013), all in IndexedDB:
 *
 * - `autosave`: the working copy, saved shortly after every edit, and the working copy from
 *   before a share link replaced it.
 * - `snapshots`: earlier versions, kept every few minutes and before anything replaces the
 *   working copy (a new project, an opened file or link). The newest are kept; an autosave
 *   that no longer reads is kept here whole, so it can still be downloaded.
 */
import { Project } from '../model/schema';

const DB = 'glider-panel-designer';
const STORE = 'autosave';
const SNAPSHOTS = 'snapshots';
const KEY = 'current';
const BEFORE_LINK = 'before-link';
/** How many snapshots to keep. */
export const SNAPSHOT_LIMIT = 30;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAutosave(project: Project, key = KEY): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ savedAt: new Date().toISOString(), project }, key);
  await done(tx);
  db.close();
  // The autosave is now at least as new as any copy made on the way out.
  if (key === KEY) clearUnloadCopy();
}

/**
 * A synchronous copy for the moment the page goes away: an IndexedDB write started while
 * the page unloads may never finish, but localStorage writes at once. Whichever of the two
 * copies is newer wins on the next start.
 */
const UNLOAD_KEY = 'gpd.unload-copy';

export function saveUnloadCopy(project: Project) {
  try {
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ savedAt: new Date().toISOString(), project }));
  } catch {
    // Storage full or unavailable: the IndexedDB autosave is all there is.
  }
}

function loadUnloadCopy(): { savedAt: string; project: unknown } | null {
  try {
    const raw = localStorage.getItem(UNLOAD_KEY);
    return raw ? (JSON.parse(raw) as { savedAt: string; project: unknown }) : null;
  } catch {
    return null;
  }
}

function clearUnloadCopy() {
  try {
    localStorage.removeItem(UNLOAD_KEY);
  } catch {
    // Nothing to clear.
  }
}

export type Loaded = { savedAt: string; project: Project; unreadable?: false } | { savedAt: string; project?: undefined; unreadable: true } | null;

/**
 * The saved working copy. One that no longer reads as a project (damaged, or from a newer
 * version) is moved to the snapshots whole, so it is not overwritten, and `unreadable` is set.
 */
export async function loadAutosave(key = KEY): Promise<Loaded> {
  try {
    const db = await open();
    let rec = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(key))) as { savedAt: string; project: unknown } | undefined;
    db.close();
    if (key === KEY) {
      const copy = loadUnloadCopy();
      if (copy && (!rec || copy.savedAt > rec.savedAt)) rec = copy;
    }
    if (!rec || typeof rec !== 'object') return null;
    const r = rec;
    const parsed = Project.safeParse(r.project);
    if (parsed.success) return { savedAt: r.savedAt, project: parsed.data };
    await addSnapshot(r.project, 'Autosave that could not be opened', r.savedAt).catch(() => undefined);
    return { savedAt: r.savedAt, unreadable: true };
  } catch {
    return null;
  }
}

/** Keep the working copy that a share link is about to replace. */
export const saveBeforeLink = (project: Project) => saveAutosave(project, BEFORE_LINK);
export const loadBeforeLink = () => loadAutosave(BEFORE_LINK);

export interface SnapshotInfo {
  id: number;
  savedAt: string;
  reason: string;
  name: string;
  parts: number;
  wires: number;
  /** False when the stored data no longer reads as a project; it can still be downloaded. */
  readable: boolean;
}

interface SnapshotRecord {
  id?: number;
  savedAt: string;
  reason: string;
  project: unknown;
}

/**
 * Store a snapshot and drop the oldest beyond the limit. One the same as the newest replaces
 * it with the new time and reason, so reloads do not fill the list with copies.
 */
export async function addSnapshot(project: unknown, reason: string, savedAt = new Date().toISOString()): Promise<void> {
  const db = await open();
  const tx = db.transaction(SNAPSHOTS, 'readwrite');
  const store = tx.objectStore(SNAPSHOTS);
  const newest = (await request(store.openCursor(null, 'prev')))?.value as SnapshotRecord | undefined;
  const same = newest && JSON.stringify(newest.project) === JSON.stringify(project);
  store.put(same ? { ...newest, savedAt, reason } : ({ savedAt, reason, project } satisfies SnapshotRecord));
  const keys = (await request(store.getAllKeys())) as number[];
  for (const k of keys.sort((a, b) => a - b).slice(0, Math.max(0, keys.length - SNAPSHOT_LIMIT))) store.delete(k);
  await done(tx);
  db.close();
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  try {
    const db = await open();
    const all = (await request(db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).getAll())) as SnapshotRecord[];
    db.close();
    return all
      .map((r) => {
        const p = Project.safeParse(r.project);
        const raw = (r.project ?? {}) as { name?: unknown };
        return {
          id: r.id!,
          savedAt: r.savedAt,
          reason: r.reason,
          name: p.success ? p.data.name : typeof raw.name === 'string' ? raw.name : 'Unknown',
          parts: p.success ? p.data.parts.length : 0,
          wires: p.success ? p.data.wires.length : 0,
          readable: p.success,
        };
      })
      .sort((a, b) => b.id - a.id);
  } catch {
    return [];
  }
}

/** A snapshot's stored data: the project when it reads, and the raw data either way. */
export async function loadSnapshot(id: number): Promise<{ project: Project | null; raw: unknown; savedAt: string } | null> {
  const db = await open();
  const rec = (await request(db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(id))) as SnapshotRecord | undefined;
  db.close();
  if (!rec) return null;
  const p = Project.safeParse(rec.project);
  return { project: p.success ? p.data : null, raw: rec.project, savedAt: rec.savedAt };
}
