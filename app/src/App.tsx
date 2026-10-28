import { lazy, Suspense, useEffect, useState } from 'react';
import type { Project } from './model/schema';
import { Canvas } from './editor/Canvas';
import { fitAll, handleKey, openProjectFile } from './editor/commands';
import { decodeProject, linkData } from './share/link';
import { docs } from './store/app';
import { loadAutosave, saveBeforeLink } from './store/persist';
import { prefs, resolveTheme } from './store/prefs';
import { replaceWork, startRecovery } from './store/recovery';
import { ui, useUi } from './store/ui';
import { ArrangeDialog, ArrayDialog, CommandPalette, ShortcutMap, StatusBar, TopBar } from './ui/Chrome';
import { Library, ObjectsTree } from './ui/LeftPanel';
import { ChecksPanel, Inspector } from './ui/RightPanel';
import { ExportDialog, ShareDialog } from './ui/ExportShare';
import { refreshLocalTemplates } from './template/store';
import { TemplateCanvas } from './template/ui/TemplateCanvas';
import { TemplateLeft, TemplateRight } from './template/ui/TemplatePanels';
import { ReviewCentre, ReviewLeft, ReviewRight } from './review/ReviewView';
import { SchematicView } from './wiring/ui/SchematicView';
import { NewProjectDialog, Walkthrough, Welcome } from './ui/Onboarding';
import { ErrorBoundary, RecoverDialog } from './ui/Recovery';

// three.js is large, so the 3D view loads only when it is first opened.
const View3D = lazy(() => import('./view3d/View3D'));

export function App() {
  const theme = useUi((s) => s.theme);
  const view = useUi((s) => s.view);
  useEffect(() => void refreshLocalTemplates(), []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // "System" follows the operating system's light or dark setting as it changes.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => prefs.state.theme === 'system' && ui.set({ theme: resolveTheme('system') });
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, []);

  // Start-up: open a share link if the address carries one, else recover the last
  // autosaved working copy (crash recovery). A first visit shows the welcome.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadAutosave();
      if (cancelled) return;
      const opened = await openSharedLink(saved?.project ?? null);
      if (cancelled) return;
      if (!opened && saved?.project) {
        docs.load(saved.project);
        ui.set({ message: `Restored your work from ${new Date(saved.savedAt).toLocaleString()}` });
      } else if (!opened && saved?.unreadable) {
        ui.set({ message: 'Your last autosave could not be opened. It is kept: File › Recover earlier work can download it.' });
      }
      if (!opened && !saved && !prefs.state.onboarded) ui.set({ welcomeOpen: true });
      setReady(true);
      requestAnimationFrame(fitAll);
    })();
    // A link pasted into the address bar of an open tab.
    const onHash = () => void openSharedLink(docs.doc).then((ok) => ok && requestAnimationFrame(fitAll));
    window.addEventListener('hashchange', onHash);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => (ready ? startRecovery() : undefined), [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((ui.state.paletteOpen || ui.state.newOpen || ui.state.recoverOpen) && e.key !== 'Escape') return;
      handleKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drop a project file anywhere to open it.
  const onDrop = (e: React.DragEvent) => {
    const f = [...e.dataTransfer.files].find((x) => x.name.endsWith('.json') || x.type === 'application/json');
    if (!f) return;
    e.preventDefault();
    void openProjectFile(f);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <TopBar />
      {view === 'review' ? (
        <>
          <aside className="left">
            <ErrorBoundary area="left">
              <ReviewLeft />
            </ErrorBoundary>
          </aside>
          <main className="centre">
            <ErrorBoundary area="centre">
              <ReviewCentre />
            </ErrorBoundary>
          </main>
          <aside className="right">
            <ErrorBoundary area="right">
              <ReviewRight />
            </ErrorBoundary>
          </aside>
        </>
      ) : view === 'template' ? (
        <>
          <aside className="left">
            <ErrorBoundary area="left">
              <TemplateLeft />
            </ErrorBoundary>
          </aside>
          <main className="centre">
            <ErrorBoundary area="centre">
              <TemplateCanvas />
            </ErrorBoundary>
          </main>
          <aside className="right">
            <ErrorBoundary area="right">
              <TemplateRight />
            </ErrorBoundary>
          </aside>
        </>
      ) : (
        <>
          <aside className="left">
            <ErrorBoundary area="left">
              <Library />
              <ObjectsTree />
            </ErrorBoundary>
          </aside>
          <main className="centre">
            <ErrorBoundary area="centre">{ready && (view === 'schematic' ? <SchematicView /> : view === '3d' ? <Suspense fallback={<div className="view3d-loading muted">Loading the 3D view…</div>}><View3D /></Suspense> : <Canvas />)}</ErrorBoundary>
            <Walkthrough />
          </main>
          <aside className="right">
            <ErrorBoundary area="right">
              <Inspector />
              <ChecksPanel />
            </ErrorBoundary>
          </aside>
        </>
      )}
      <StatusBar />
      <CommandPalette />
      <ShortcutMap />
      <ArrayDialog />
      <ArrangeDialog />
      <ExportDialog />
      <ShareDialog />
      <NewProjectDialog />
      <RecoverDialog />
      <Welcome />
    </div>
  );
}

/**
 * Open the design in the address's share link, if any, as a local working copy. The work
 * it replaces is kept and can be restored from the File menu. Returns true if it opened.
 */
async function openSharedLink(current: Project | null): Promise<boolean> {
  const data = linkData(location.hash);
  if (data === null) return false;
  // Drop the link from the address, so a reload does not reopen it over later edits.
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const project = await decodeProject(data);
    if (current) await saveBeforeLink(current).catch(() => undefined);
    replaceWork(project, 'opening a share link');
    ui.set({
      message: `Opened the shared design “${project.name}” as your own copy.${current ? ' Your previous work is kept: File › Restore work from before a share link.' : ''}`,
    });
    return true;
  } catch (e) {
    ui.set({ message: (e as Error).message });
    return false;
  }
}
