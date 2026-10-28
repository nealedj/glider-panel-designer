/**
 * Editor UI state: tool, selection, view, layers, snapping. Not part of the document and
 * not undoable.
 */
import { useSyncExternalStore } from 'react';

export type Tool = 'select' | 'place' | 'move' | 'measure' | 'keepout' | 'text' | 'dimension' | 'wire' | 'route';
export type ViewName = 'front' | 'rear' | 'schematic' | '3d' | 'template' | 'review';
export type Layer = 'template' | 'cutouts' | 'bezels' | 'holes' | 'keepouts' | 'labels' | 'dimensions' | 'grid' | 'guides';

export interface SnapSettings {
  grid: boolean;
  objects: boolean;
  guides: boolean;
}

export interface UiState {
  tool: Tool;
  view: ViewName;
  /** Catalogue part id to place when tool is 'place'. */
  placing: { id: string; version: number } | null;
  selection: string[];
  zoom: number; // px per mm
  centre: { x: number; y: number };
  cursor: { x: number; y: number } | null;
  layers: Record<Layer, boolean>;
  snap: SnapSettings;
  message: string;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  exportOpen: boolean;
  shareOpen: boolean;
  /** New project dialog, welcome, and the recover-earlier-work dialog. */
  newOpen: boolean;
  welcomeOpen: boolean;
  recoverOpen: boolean;
  /** The first-panel walkthrough: its step (1–3, then 4 when done) and the part count it started from. */
  walkthrough: { step: 1 | 2 | 3 | 4; parts0: number } | null;
  /** The resolved theme shown; the user's choice (which may be "system") is in prefs. */
  theme: 'light' | 'dark';
  /** Rear view: only parts whose depth band meets [near, far] are shown; null shows all. */
  depthClip: [number, number] | null;
  /** Rear view: the parts under the last click, nearest the fitter (deepest) first. */
  stack: { at: { x: number; y: number }; ids: string[] } | null;
  /** Wire tool: the terminal clicked first. */
  wireStart: string | null;
  /** Route tool: points so far, and the depth new points get, mm. */
  routeDraft: { x: number; y: number }[];
  routeDepth: number;
  /** Schematic: net types hidden, and its own pan and zoom. */
  schematicHide: string[];
  schematicView: { zoom: number; centre: { x: number; y: number } };
}

export const initialUi: UiState = {
  tool: 'select',
  view: 'front',
  placing: null,
  selection: [],
  zoom: 2.5,
  centre: { x: 0, y: 0 },
  cursor: null,
  layers: { template: true, cutouts: true, bezels: true, holes: true, keepouts: true, labels: true, dimensions: true, grid: true, guides: true },
  snap: { grid: true, objects: true, guides: true },
  message: '',
  paletteOpen: false,
  shortcutsOpen: false,
  exportOpen: false,
  shareOpen: false,
  newOpen: false,
  welcomeOpen: false,
  recoverOpen: false,
  walkthrough: null,
  theme: 'light',
  depthClip: null,
  stack: null,
  wireStart: null,
  routeDraft: [],
  routeDepth: 130,
  schematicHide: [],
  schematicView: { zoom: 1, centre: { x: 500, y: -350 } },
};

type Listener = () => void;

export class Store<T> {
  private listeners = new Set<Listener>();
  constructor(public state: T) {}
  get = () => this.state;
  set = (patch: Partial<T> | ((s: T) => Partial<T>)) => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  };
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const ui = new Store<UiState>(initialUi);

export function useUi<R>(select: (s: UiState) => R): R {
  return useSyncExternalStore(ui.subscribe, () => select(ui.state));
}
