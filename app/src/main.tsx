import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { docs } from './store/app';
import { ui } from './store/ui';
import { prefs, resolveTheme } from './store/prefs';
import { devCrash } from './ui/Recovery';
import { draftMap } from './template/draft';
import { analyse } from './wiring/circuit';
import { drafts, tplUi } from './template/session';

// A handle for end-to-end tests and debugging in development builds only.
if (import.meta.env.DEV) {
  const crash = (area: string) => {
    devCrash.armed = area;
    ui.set({ message: `crash ${area}` });
  };
  Object.assign(window, { gpd: { docs, ui, prefs, drafts, tplUi, draftMap, analyse, crash } });
}

// Show the chosen theme from the first frame.
ui.set({ theme: resolveTheme(prefs.state.theme) });
document.documentElement.dataset.theme = ui.state.theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
