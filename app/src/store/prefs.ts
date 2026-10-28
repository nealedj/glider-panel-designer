/**
 * Per-browser preferences: theme, key bindings and whether the welcome has been seen.
 * Kept in localStorage, apart from projects; every read and write tolerates storage being
 * unavailable (private windows, blocked site data), when the defaults apply.
 */
import { useSyncExternalStore } from 'react';
import { Store } from './ui';

export type ThemeChoice = 'light' | 'dark' | 'system';

export interface Prefs {
  theme: ThemeChoice;
  /** The welcome has been shown (or dismissed) once. */
  onboarded: boolean;
  /** Shortcut overrides by command id; an empty string unbinds the command. */
  keymap: Record<string, string>;
}

const KEY = 'gpd.prefs';
const DEFAULTS: Prefs = { theme: 'system', onboarded: false, keymap: {} };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? p.theme : DEFAULTS.theme,
      onboarded: p.onboarded === true,
      keymap: p.keymap && typeof p.keymap === 'object' ? Object.fromEntries(Object.entries(p.keymap).filter(([, v]) => typeof v === 'string')) : {},
    };
  } catch {
    return DEFAULTS;
  }
}

export const prefs = new Store<Prefs>(read());

prefs.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs.state));
  } catch {
    // Storage unavailable: preferences last for this session only.
  }
});

/** The theme to show for a choice: "system" follows the operating system's setting. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function usePrefs<R>(select: (p: Prefs) => R): R {
  return useSyncExternalStore(prefs.subscribe, () => select(prefs.state));
}
