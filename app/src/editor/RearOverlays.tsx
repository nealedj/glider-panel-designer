/**
 * Rear-view overlays: the depth legend with its clip slider, and the stack inspector.
 */
import type { PartGeometry } from '../model/resolve';
import { useDoc } from '../store/app';
import { ui, useUi } from '../store/ui';

const fmt = (mm: number) => `${Math.round(mm)}`;

/** Depth legend and a two-ended slider that clips the view to a range of depths. */
export function DepthPanel({ maxDepth, available }: { maxDepth: number; available: number | null }) {
  const clip = useUi((s) => s.depthClip);
  const [near, far] = clip ?? [0, maxDepth];
  const set = (n: number, f: number) => {
    const lo = Math.max(0, Math.min(n, f));
    const hi = Math.min(maxDepth, Math.max(n, f));
    ui.set({ depthClip: lo <= 0 && hi >= maxDepth ? null : [lo, hi] });
  };
  return (
    <div className="canvas-card depth-panel" data-testid="depth-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="card-head">
        <span>Depth behind panel</span>
        {clip && (
          <button className="link-btn" onClick={() => ui.set({ depthClip: null })}>
            Show all
          </button>
        )}
      </div>
      <div className="depth-scale">
        <div className="depth-ramp" />
        {available !== null && available <= maxDepth && <div className="depth-available" style={{ left: `${(available / maxDepth) * 100}%` }} title={`${available} mm free behind the panel`} />}
        <div className="depth-window" style={{ left: `${(near / maxDepth) * 100}%`, width: `${((far - near) / maxDepth) * 100}%` }} />
        <input
          type="range"
          aria-label="Nearest depth shown"
          data-testid="depth-near"
          min={0}
          max={maxDepth}
          step={1}
          value={near}
          onChange={(e) => set(Number(e.target.value), far)}
        />
        <input
          type="range"
          aria-label="Deepest depth shown"
          data-testid="depth-far"
          min={0}
          max={maxDepth}
          step={1}
          value={far}
          onChange={(e) => set(near, Number(e.target.value))}
        />
      </div>
      <div className="depth-ticks">
        <span>0</span>
        <span>{clip ? `showing ${fmt(near)}–${fmt(far)} mm` : 'all depths'}</span>
        <span>{maxDepth} mm</span>
      </div>
      <div className="depth-key">
        <span className="swatch is-unknown" /> depth unknown
        {available !== null && (
          <>
            <span className="swatch is-available" /> {available} mm free
          </>
        )}
      </div>
    </div>
  );
}

/** Every part under the last click in the rear view, deepest first. Tab cycles through it. */
export function StackPanel({ geometry }: { geometry: Map<string, PartGeometry> }) {
  const doc = useDoc();
  const stack = useUi((s) => s.stack);
  const selection = useUi((s) => s.selection);
  if (!stack) return null;
  const items = stack.ids.map((id) => geometry.get(id)).filter((g): g is PartGeometry => !!g);
  return (
    <div className="canvas-card stack-panel" data-testid="stack-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="card-head">
        <span>Stack at this point</span>
        <button className="link-btn" aria-label="Close stack" onClick={() => ui.set({ stack: null })}>
          ×
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">Nothing here.</p>
      ) : (
        <ol className="stack-list">
          {items.map((g) => {
            const pp = doc.parts.find((p) => p.id === g.id);
            return (
              <li key={g.id} className={selection.includes(g.id) ? 'is-selected' : ''} onClick={() => ui.set({ selection: [g.id] })} data-testid={`stack-${g.id}`}>
                <span className="stack-name">{pp?.label || g.part.model}</span>
                <span className="stack-depth">{g.z1 === null ? `${fmt(g.z0)} mm – ?` : `${fmt(g.z0)}–${fmt(g.z1)} mm`}</span>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 1 && <p className="muted small">Tab cycles through the stack. Deepest is listed first.</p>}
    </div>
  );
}
