/**
 * The export dialog (every output, with the error gate and override) and the share-link
 * dialog (link, or a project file when the link would be too long).
 */
import { useEffect, useMemo, useState } from 'react';
import { runChecks } from '../checks/checks';
import { runExport } from '../editor/commands';
import { EXPORTS, type ExportKind } from '../export/kinds';
import { DEFAULT_LINK_LIMIT, encodeProject, shareUrl } from '../share/link';
import { useDoc, useGeometry } from '../store/app';
import { ui, useUi } from '../store/ui';
import { Icon } from './icons';

function Dialog({ title, onClose, children, testId, wide }: { title: string; onClose: () => void; children: React.ReactNode; testId: string; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={`dialog${wide ? ' wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          e.stopPropagation();
        }}
        role="dialog"
        aria-label={title}
        data-testid={testId}
      >
        <header className="panel-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen);
  // Mounted fresh on each open, so the override starts unticked every time.
  return open ? <ExportBody /> : null;
}

function ExportBody() {
  const doc = useDoc();
  const geometry = useGeometry(doc);
  const results = useMemo(() => runChecks(doc, geometry), [doc, geometry]);
  const errors = results.filter((r) => r.severity === 'error');
  const warnings = results.filter((r) => r.severity === 'warning');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const close = () => ui.set({ exportOpen: false });

  const go = async (kind: ExportKind) => {
    setBusy(kind);
    await runExport(kind, override && errors.length > 0);
    setBusy(null);
  };

  return (
    <Dialog title="Export" onClose={close} testId="export-dialog" wide>
      <div className="pad">
        {errors.length > 0 ? (
          <div className="note error" data-testid="export-errors">
            <p>
              <Icon name="error" size={14} /> <strong>{errors.length === 1 ? '1 error is' : `${errors.length} errors are`} open.</strong> Cut files and the printable template are blocked until you fix{' '}
              {errors.length === 1 ? 'it' : 'them'} or override.
            </p>
            <ul className="export-errors">
              {errors.slice(0, 4).map((e) => (
                <li key={e.key}>{e.message}</li>
              ))}
              {errors.length > 4 && <li>… and {errors.length - 4} more in the checks panel</li>}
            </ul>
            <label className="check-field">
              <input type="checkbox" checked={override} onChange={() => setOverride(!override)} data-testid="export-override" />
              Override: export anyway and stamp the overridden errors on every cut file and template page
            </label>
          </div>
        ) : (
          <p className="note ok">
            <Icon name="check" size={14} /> No errors open.
          </p>
        )}
        {warnings.length > 0 && <p className="muted small">{warnings.length === 1 ? '1 open warning' : `${warnings.length} open warnings`} will be listed on the drawings.</p>}
        <ul className="export-list">
          {EXPORTS.map((e) => {
            const blocked = e.fabrication && errors.length > 0 && !override;
            return (
              <li key={e.kind} className={blocked ? 'is-blocked' : ''}>
                <div className="export-text">
                  <span className="export-name">
                    {e.label} <span className="format-chip">{e.format}</span>
                    {e.fabrication && <span className="fab-chip">for cutting</span>}
                  </span>
                  <span className="muted small">{e.description}</span>
                </div>
                <button className="btn ghost small" disabled={blocked || busy !== null} onClick={() => void go(e.kind)} data-testid={`export-${e.kind}`} title={blocked ? 'Blocked by open errors' : undefined}>
                  {busy === e.kind ? 'Working…' : 'Export'}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="disclaimer">Every drawing carries a "planning aid, verify before cutting" stamp. Exports do not make a design approved or airworthy.</p>
      </div>
    </Dialog>
  );
}

const LIMIT_KEY = 'gpd.linkLimit';

function storedLimit(): number {
  try {
    const v = Number(localStorage.getItem(LIMIT_KEY));
    return Number.isFinite(v) && v >= 500 ? v : DEFAULT_LINK_LIMIT;
  } catch {
    return DEFAULT_LINK_LIMIT;
  }
}

export function ShareDialog() {
  const open = useUi((s) => s.shareOpen);
  return open ? <ShareBody /> : null;
}

function ShareBody() {
  const doc = useDoc();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(storedLimit);
  const [limitText, setLimitText] = useState(String(storedLimit()));
  const [showLong, setShowLong] = useState(false);
  const close = () => ui.set({ shareOpen: false });

  useEffect(() => {
    let live = true;
    encodeProject(doc)
      .then((data) => live && setUrl(shareUrl(location.href, data)))
      .catch((e: Error) => live && setError(`Could not make a link: ${e.message}`));
    return () => {
      live = false;
    };
  }, [doc]);

  const commitLimit = () => {
    const v = Math.round(Number(limitText));
    if (!Number.isFinite(v) || v < 500) return setLimitText(String(limit));
    setLimit(v);
    try {
      localStorage.setItem(LIMIT_KEY, String(v));
    } catch {
      // Storage may be unavailable; the limit still applies for this session.
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      ui.set({ message: 'Share link copied' });
    } catch {
      ui.set({ message: 'Could not copy; select the link and copy it' });
    }
  };

  const tooLong = url !== null && url.length > limit;
  return (
    <Dialog title="Share link" onClose={close} testId="share-dialog" wide>
      <div className="pad">
        {error && <p className="note error">{error}</p>}
        {!url && !error && <p className="muted">Packing the design…</p>}
        {url && tooLong && !showLong && (
          <div className="note warn block" data-testid="share-too-long">
            <p>
              This design needs a link of <strong>{url.length.toLocaleString()}</strong> characters, longer than the {limit.toLocaleString()} that reliably survive chat and email. Send a project file instead.
            </p>
            <div className="dialog-actions start">
              <button
                className="btn primary"
                data-testid="share-save-file"
                onClick={() => {
                  void runExport('project-json');
                  close();
                }}
              >
                Save project file
              </button>
              <button className="btn ghost" onClick={() => setShowLong(true)}>
                Show the long link anyway
              </button>
            </div>
          </div>
        )}
        {url && (!tooLong || showLong) && (
          <>
            <div className="share-row">
              <input readOnly value={url} onFocus={(e) => e.target.select()} data-testid="share-url" aria-label="Share link" />
              <button className="btn primary" onClick={() => void copy()} data-testid="share-copy">
                Copy link
              </button>
            </div>
            <p className="muted small" data-testid="share-length">
              {url.length.toLocaleString()} characters{tooLong ? `, over the ${limit.toLocaleString()} limit; some apps may cut it short` : ''}.
            </p>
          </>
        )}
        <ul className="share-notes muted small">
          <li>The design travels inside the link, after the #, so it is never sent to a server.</li>
          <li>Catalogue parts and library templates go by name and version; custom parts and templates go in whole. Photos are never included.</li>
          <li>Opening the link gives the recipient their own copy. Your design does not change.</li>
        </ul>
        <label className="field inline">
          <span className="field-label">Longest link to offer</span>
          <input value={limitText} onChange={(e) => setLimitText(e.target.value)} onBlur={commitLimit} onKeyDown={(e) => e.key === 'Enter' && commitLimit()} data-testid="share-limit" />
          <span className="muted small">characters</span>
        </label>
      </div>
    </Dialog>
  );
}
