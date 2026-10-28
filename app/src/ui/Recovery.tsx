/**
 * Crash recovery in the interface: an error boundary that keeps the work and offers a way
 * out, and the Recover earlier work dialog listing snapshots.
 */
import { Component, useEffect, useState, type ReactNode } from 'react';
import { fitAll } from '../editor/commands';
import { fileStem } from '../export/drawing';
import { docs } from '../store/app';
import { listSnapshots, loadSnapshot, SNAPSHOT_LIMIT, type SnapshotInfo } from '../store/persist';
import { flushAutosave, replaceWork } from '../store/recovery';
import { ui, useUi } from '../store/ui';
import { downloadFile } from '../util/download';

/** Development builds only: arm a crash in the next render of an area, to test recovery. */
export const devCrash = { armed: '' };
function DevCrash({ area }: { area: string }) {
  useUi((s) => s.message);
  // Stays armed until the boundary catches it, so React's synchronous retry throws too.
  if (import.meta.env.DEV && devCrash.armed === area) throw new Error('Test crash (development build)');
  return null;
}

function downloadWork() {
  downloadFile({ name: `${fileStem(docs.doc)}-recovered.panel.json`, mime: 'application/json', data: JSON.stringify(docs.doc, null, 2) + '\n' });
}

interface Props {
  area: string;
  children: ReactNode;
}

/**
 * Catches a crash in one area of the app. The document is untouched by a crash in drawing
 * it, so the fallback saves it at once and offers to undo the last change, download the work,
 * pick an earlier version, or reload.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {
    if (devCrash.armed === this.props.area) devCrash.armed = '';
    void flushAutosave();
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error)
      return (
        <>
          <DevCrash area={this.props.area} />
          {this.props.children}
        </>
      );
    const canUndo = docs.past.length > 0;
    return (
      <div className="crash" role="alert" data-testid={`crash-${this.props.area}`}>
        <h2>Something went wrong here</h2>
        <p>Your work is saved in this browser. You can try again, step back one change, or download a copy before reloading.</p>
        <div className="crash-actions">
          <button className="btn primary small" onClick={this.retry}>
            Try again
          </button>
          <button
            className="btn ghost small"
            disabled={!canUndo}
            onClick={() => {
              docs.undo();
              this.retry();
            }}
          >
            Undo the last change
          </button>
          <button className="btn ghost small" onClick={downloadWork}>
            Download project file
          </button>
          <button className="btn ghost small" onClick={() => ui.set({ recoverOpen: true })}>
            Recover earlier work…
          </button>
          <button className="btn ghost small" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
        <details>
          <summary className="muted small">Details</summary>
          <pre>{error.message}</pre>
        </details>
      </div>
    );
  }
}

export function RecoverDialog() {
  const open = useUi((s) => s.recoverOpen);
  return open ? <RecoverBody /> : null;
}

function RecoverBody() {
  const [list, setList] = useState<SnapshotInfo[] | null>(null);
  useEffect(() => void listSnapshots().then(setList), []);
  const close = () => ui.set({ recoverOpen: false });
  const restore = async (s: SnapshotInfo) => {
    const snap = await loadSnapshot(s.id);
    if (!snap?.project) return;
    replaceWork(snap.project, 'recovering earlier work');
    ui.set({ recoverOpen: false, message: `Recovered “${s.name}” from ${new Date(s.savedAt).toLocaleString()}. What it replaced is kept here too.` });
    requestAnimationFrame(fitAll);
  };
  const download = async (s: SnapshotInfo) => {
    const snap = await loadSnapshot(s.id);
    if (snap) downloadFile({ name: `snapshot-${s.id}.panel.json`, mime: 'application/json', data: JSON.stringify(snap.raw, null, 2) + '\n' });
  };
  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="dialog wide"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
        role="dialog"
        aria-label="Recover earlier work"
      >
        <header className="panel-head">
          <h2>Recover earlier work</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pad">
          <p className="muted small">
            Earlier versions kept in this browser: every few minutes while you edit, and whenever a project is replaced. The newest {SNAPSHOT_LIMIT} are kept. Opening one keeps what it
            replaces.
          </p>
          {list === null ? (
            <p className="muted">Loading…</p>
          ) : list.length === 0 ? (
            <p className="muted">No earlier versions yet.</p>
          ) : (
            <ul className="export-list snapshot-list" data-testid="snapshots">
              {list.map((s) => (
                <li key={s.id}>
                  <div className="export-text">
                    <strong>{s.name}</strong>
                    <span className="muted small">
                      {new Date(s.savedAt).toLocaleString()} · {s.reason}
                      {s.readable ? ` · ${s.parts} parts, ${s.wires} wires` : ' · could not be opened'}
                    </span>
                  </div>
                  {s.readable ? (
                    <button className="btn ghost small" onClick={() => void restore(s)}>
                      Open
                    </button>
                  ) : null}
                  <button className="btn ghost small" onClick={() => void download(s)} title="Download as a file">
                    Download
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
