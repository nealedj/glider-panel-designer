/**
 * Review state: the open candidates file and the reviewer's decisions, kept in the browser
 * (IndexedDB) so a review can stop and pick up again. Nothing here leaves the browser except
 * the exported reviewed-parts bundle.
 */
import { useSyncExternalStore } from 'react';
import { CandidatesFile } from '../model/candidates';
import type { PartCategory } from '../model/schema';
import { Value } from '../template/store';
import type { FieldDecision, ManualEntry, ProductReview } from './build';

const DB = 'gpd-review';
const FILES = 'files';
const REVIEWS = 'reviews';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of [FILES, REVIEWS]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(store: string, key: string, value: unknown) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  const v = await new Promise<T | undefined>((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return v;
}

export interface ReviewState {
  file: CandidatesFile | null;
  /** Identifies the file, so decisions are kept per candidates file. */
  fileId: string;
  reviews: Record<string, ProductReview>;
  selected: string | null;
  filter: 'all' | 'reference' | 'todo' | 'done';
  query: string;
  message: string;
}

export const review = new Value<ReviewState>({ file: null, fileId: '', reviews: {}, selected: null, filter: 'all', query: '', message: '' });

export function useReview<R>(select: (s: ReviewState) => R): R {
  return useSyncExternalStore(review.subscribe, () => select(review.get()));
}

const set = (patch: Partial<ReviewState>) => review.set({ ...review.get(), ...patch });

// Every decision is saved at once (decisions are small), one write after another, so a
// reload straight after a click loses nothing and an older copy never lands last.
let saving: Promise<unknown> = Promise.resolve();
function saveReviews() {
  const { fileId, reviews } = review.get();
  saving = saving.then(() => put(REVIEWS, fileId, reviews)).catch(() => set({ message: 'Could not save the review in this browser' }));
}

const fileIdOf = (f: CandidatesFile) => `${f.generated}:${f.products.length}`;

/** Load a candidates file chosen by the user. */
export async function openCandidates(f: File | Blob, name = 'candidates file') {
  try {
    const parsed = CandidatesFile.safeParse(JSON.parse(await f.text()));
    if (!parsed.success) return set({ message: `Not a candidates file: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` });
    const file = parsed.data;
    const fileId = fileIdOf(file);
    const reviews = (await get<Record<string, ProductReview>>(REVIEWS, fileId).catch(() => undefined)) ?? {};
    set({ file, fileId, reviews, selected: file.products[0]?.key ?? null, message: `Opened ${name}: ${file.products.length} products` });
    await put(FILES, 'current', file).catch(() => undefined);
  } catch (e) {
    set({ message: `Could not read ${name}: ${(e as Error).message}` });
  }
}

/** Reopen the last candidates file and its decisions after a reload. */
export async function restoreReview() {
  if (review.get().file) return;
  const raw = await get<unknown>(FILES, 'current').catch(() => undefined);
  const parsed = raw ? CandidatesFile.safeParse(raw) : null;
  if (!parsed?.success) return;
  const fileId = fileIdOf(parsed.data);
  const reviews = (await get<Record<string, ProductReview>>(REVIEWS, fileId).catch(() => undefined)) ?? {};
  set({ file: parsed.data, fileId, reviews, selected: parsed.data.products[0]?.key ?? null });
}

function update(key: string, fn: (r: ProductReview) => ProductReview) {
  const s = review.get();
  const cur = s.reviews[key] ?? { fields: {} };
  set({ reviews: { ...s.reviews, [key]: fn(cur) } });
  saveReviews();
}

function field(r: ProductReview, path: string): FieldDecision {
  return r.fields[path] ?? { accepted: [], rejected: [] };
}

/** Accept a candidate. Single-valued fields keep one accepted value; pinouts can keep several. */
export function accept(key: string, path: string, index: number, multi = false) {
  update(key, (r) => {
    const f = field(r, path);
    const accepted = multi ? [...new Set([...f.accepted, index])] : [index];
    return { ...r, done: false, fields: { ...r.fields, [path]: { ...f, accepted, rejected: f.rejected.filter((i) => i !== index), manual: multi ? f.manual : undefined } } };
  });
}

export function reject(key: string, path: string, index: number) {
  update(key, (r) => {
    const f = field(r, path);
    return { ...r, done: false, fields: { ...r.fields, [path]: { ...f, accepted: f.accepted.filter((i) => i !== index), rejected: [...new Set([...f.rejected, index])] } } };
  });
}

export function undecide(key: string, path: string, index: number) {
  update(key, (r) => {
    const f = field(r, path);
    return { ...r, fields: { ...r.fields, [path]: { ...f, accepted: f.accepted.filter((i) => i !== index), rejected: f.rejected.filter((i) => i !== index) } } };
  });
}

export function setManual(key: string, path: string, entry: ManualEntry | undefined) {
  update(key, (r) => {
    const f = field(r, path);
    return { ...r, done: false, fields: { ...r.fields, [path]: { ...f, manual: entry, accepted: entry ? [] : f.accepted } } };
  });
}

export function setIdentity(key: string, patch: { maker?: string; model?: string; category?: PartCategory | null }) {
  update(key, (r) => ({ ...r, ...patch }));
}

export function markDone(key: string, done: boolean) {
  update(key, (r) => ({ ...r, done }));
}

export const select = (key: string) => set({ selected: key });
export const setFilter = (filter: ReviewState['filter']) => set({ filter });
export const setQuery = (query: string) => set({ query });
export const setMessage = (message: string) => set({ message });
