import { useEffect, useMemo, useRef, useState } from 'react';
import { bindShortcut, COMMANDS, COMMAND_BY_ID, DEFAULT_SHORTCUT, dialogs, eventShortcut, setView, shortcutConflicts, type CommandDef } from '../editor/commands';
import { prefs, usePrefs } from '../store/prefs';
import { circularArray, linearArray, selectionCentre } from '../editor/actions';
import { docs, useDoc, useHistory } from '../store/app';
import { ops } from '../store/doc';
import { ui, useUi, type Tool, type ViewName } from '../store/ui';
import { formatLength, parseLength, toDisplay } from '../util/units';
import { Icon } from './icons';
import { LengthField, NumberField } from './Field';

const MENUS: { name: CommandDef['group']; ids: string[] }[] = [
  { name: 'File', ids: ['file.new', 'file.open', 'file.save', '-', 'file.sample', 'file.sample-wiring', 'file.sample-pik20d', '-', 'file.export', 'file.share', '-', 'file.recover', 'file.restore-before-link'] },
  { name: 'Edit', ids: ['edit.undo', 'edit.redo', '-', 'edit.duplicate', 'edit.delete', '-', 'edit.select-all'] },
  {
    name: 'Arrange',
    ids: [
      'arrange.rotate',
      'arrange.rotate-cw',
      '-',
      'arrange.align-left',
      'arrange.align-cx',
      'arrange.align-right',
      'arrange.align-top',
      'arrange.align-cy',
      'arrange.align-bottom',
      '-',
      'arrange.distribute-x',
      'arrange.distribute-y',
      '-',
      'arrange.mirror',
      'arrange.linear-array',
      'arrange.circular-array',
      '-',
      'arrange.detach',
      '-',
      'wiring.put-on-route',
      'wiring.take-off-route',
      'schematic.reset',
    ],
  },
  { name: 'View', ids: ['view.front', 'view.rear', 'view.schematic', 'view.flip', 'view.cycle-stack', 'view.clear-depth-clip', '-', 'view.fit', 'view.fit-selection', 'view.zoom-in', 'view.zoom-out', '-', 'view.clear-guides', '-', 'view.units', 'view.theme', 'view.theme-system', 'view.palette'] },
  { name: 'Help', ids: ['help.welcome', 'help.walkthrough', 'help.shortcuts'] },
];

function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useHistory();
  useUi((s) => s.selection);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="menubar" ref={ref} role="menubar">
      {MENUS.map((m) => (
        <div key={m.name} className={`menu${open === m.name ? ' is-open' : ''}`}>
          <button className="menu-title" onClick={() => setOpen(open === m.name ? null : m.name)} onMouseEnter={() => open && setOpen(m.name)}>
            {m.name}
          </button>
          {open === m.name && (
            <div className="menu-items" role="menu">
              {m.ids.map((id, i) => {
                if (id === '-') return <hr key={i} />;
                const c = COMMAND_BY_ID.get(id)!;
                const enabled = !c.enabled || c.enabled();
                return (
                  <button
                    key={id}
                    role="menuitem"
                    disabled={!enabled}
                    onClick={() => {
                      setOpen(null);
                      c.run();
                    }}
                  >
                    <span>{c.label}</span>
                    {c.shortcut && <kbd>{c.shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const TOOLS: { tool: Tool; label: string; icon: string; key: string }[] = [
  { tool: 'select', label: 'Select', icon: 'select', key: 'S' },
  { tool: 'move', label: 'Move', icon: 'move', key: 'M' },
  { tool: 'measure', label: 'Measure', icon: 'measure', key: 'Shift+M' },
  { tool: 'keepout', label: 'Keep-out', icon: 'keepout', key: 'K' },
  { tool: 'text', label: 'Text', icon: 'text', key: 'T' },
  { tool: 'dimension', label: 'Dimension', icon: 'dimension', key: 'D' },
  { tool: 'wire', label: 'Wire', icon: 'wire', key: 'W' },
  { tool: 'route', label: 'Route', icon: 'route', key: 'L' },
];

const VIEWS: { view: ViewName; label: string; ready: boolean; note?: string }[] = [
  { view: 'front', label: 'Front', ready: true, note: 'Front view, as the pilot sees it (V)' },
  { view: 'rear', label: 'Rear', ready: true, note: 'Rear view, as the fitter sees it from behind (V)' },
  { view: 'schematic', label: 'Schematic', ready: true, note: 'Wiring as a block diagram, laid out automatically' },
  { view: 'template', label: 'Template', ready: true, note: 'Make a panel template from a scan or photo' },
  { view: 'review', label: 'Review', ready: true, note: 'Review catalogue values found by the discovery tools' },
];

export function TopBar() {
  const tool = useUi((s) => s.tool);
  const view = useUi((s) => s.view);
  const { canUndo, canRedo } = useHistory();
  const doc = useDoc();
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
            <rect x="2" y="6" width="28" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="11" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="22" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <span>Glider Panel Designer</span>
        </div>
        <MenuBar />
        <div className="doc-title" title="Project name">
          {doc.registration ? `${doc.registration} · ` : ''}
          {doc.name}
        </div>
        <button className="palette-hint" onClick={() => ui.set({ paletteOpen: true })}>
          Commands <kbd>Ctrl K</kbd>
        </button>
      </div>
      <div className="topbar-row toolbar-row">
        {view === 'review' ? (
          <div className="toolbar tpl-toolbar-hint" role="toolbar" aria-label="Tools">
            <span className="muted small">Review · accept each value only if its source says so · values only the shop gives stay out of the catalogue</span>
          </div>
        ) : view === 'template' ? (
          <div className="toolbar tpl-toolbar-hint" role="toolbar" aria-label="Tools">
            <span className="muted small">Template editor · tools are in the panel on the right · V switches photo and straightened views</span>
          </div>
        ) : (
          <div className="toolbar" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                className={`tool-btn${tool === t.tool ? ' is-active' : ''}`}
                onClick={() => COMMAND_BY_ID.get(`tool.${t.tool}`)!.run()}
                title={`${t.label} (${t.key})`}
                data-testid={`tool-${t.tool}`}
              >
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
            <span className="sep" />
            <button className="tool-btn" disabled={!canUndo} onClick={() => COMMAND_BY_ID.get('edit.undo')!.run()} title="Undo (Ctrl+Z)">
              <Icon name="undo" />
            </button>
            <button className="tool-btn" disabled={!canRedo} onClick={() => COMMAND_BY_ID.get('edit.redo')!.run()} title="Redo (Ctrl+Shift+Z)">
              <Icon name="redo" />
            </button>
          </div>
        )}
        <nav className="view-tabs" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.view} className={`view-tab${view === v.view ? ' is-active' : ''}`} disabled={!v.ready} title={v.note} onClick={() => setView(v.view)}>
              {v.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

const HINTS: Record<Tool, string> = {
  select: 'Click to select · drag to move · drag empty space to window-select · Space+drag or middle-drag to pan',
  place: 'Click to place · Esc to finish',
  move: 'Click a base point, then the target point · Esc to cancel',
  measure: 'Click two points to measure · Esc to finish',
  keepout: 'Drag a rectangle where nothing may be cut · Esc to finish',
  text: 'Click to place a text label, then type it in Properties · engraved text goes in the cut file',
  dimension: 'Click two points; part centres attach the dimension to the part · Shift for horizontal or vertical · Esc to finish',
  wire: 'Click a pin or port, then the one it connects to · same kind only (pins to pins, ports to ports) · Esc to finish',
  route: 'Click points along the loom path; double-click or Enter to finish · selected wires go onto it',
};

export function StatusBar() {
  const doc = useDoc();
  const cursor = useUi((s) => s.cursor);
  const zoom = useUi((s) => s.zoom);
  const snap = useUi((s) => s.snap);
  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const message = useUi((s) => s.message);
  const units = doc.settings.units;
  const [gridText, setGridText] = useState(String(toDisplay(doc.settings.gridMm, units)));
  useEffect(() => setGridText(String(toDisplay(doc.settings.gridMm, units))), [doc.settings.gridMm, units]);

  const setGrid = () => {
    const g = parseLength(gridText, units);
    if (g && g > 0) docs.dispatch('Set grid', [ops.set('settings', { ...doc.settings, gridMm: g })]);
  };

  return (
    <footer className="statusbar">
      <span className="coords mono" data-testid="cursor">
        {cursor ? `X ${formatLength(cursor.x, units)}   Y ${formatLength(cursor.y, units)}` : '—'}
      </span>
      <button className="chip" onClick={() => COMMAND_BY_ID.get('view.units')!.run()} title="Switch units (U)">
        {units === 'metric' ? 'Metric' : 'Imperial'}
      </button>
      <span className="snaps">
        Snap
        {(['grid', 'objects', 'guides'] as const).map((k) => (
          <button key={k} className={`chip${snap[k] ? ' is-on' : ''}`} onClick={() => ui.set({ snap: { ...snap, [k]: !snap[k] } })}>
            {k}
          </button>
        ))}
      </span>
      <label className="grid-size">
        Grid
        <input value={gridText} onChange={(e) => setGridText(e.target.value)} onBlur={setGrid} onKeyDown={(e) => e.key === 'Enter' && setGrid()} />
        {units === 'metric' ? 'mm' : 'in'}
      </label>
      <span className="mono">{Math.round(zoom * 100) / 100} px/mm</span>
      <span>{selection.length} selected</span>
      <span className="hint">{message || HINTS[tool]}</span>
    </footer>
  );
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  // Mounted fresh on each open, so the query and highlight start empty.
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const list = useMemo(() => {
    const seen = new Set<string>();
    const ql = q.toLowerCase().split(/\s+/).filter(Boolean);
    return COMMANDS.filter((c) => {
      if (seen.has(c.label)) return false;
      seen.add(c.label);
      const hay = `${c.group} ${c.label}`.toLowerCase();
      return ql.every((w) => hay.includes(w));
    });
  }, [q]);
  const run = (c: CommandDef | undefined) => {
    if (!c || (c.enabled && !c.enabled())) return;
    ui.set({ paletteOpen: false });
    c.run();
  };
  return (
    <div className="overlay" onMouseDown={() => ui.set({ paletteOpen: false })}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Type a command"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(list.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
            else if (e.key === 'Enter') run(list[index]);
            else if (e.key === 'Escape') ui.set({ paletteOpen: false });
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <ul>
          {list.map((c, i) => {
            const enabled = !c.enabled || c.enabled();
            return (
              <li key={c.id} className={`${i === index ? 'is-active' : ''}${enabled ? '' : ' is-disabled'}`} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                <span className="muted">{c.group}</span>
                <span>{c.label}</span>
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const MOUSE: [string, string][] = [
  ['Pan', 'Middle-drag, or Space + drag'],
  ['Zoom', 'Mouse wheel, centred on the cursor'],
  ['Select / add / toggle', 'Click / Shift-click / Ctrl-click'],
  ['Window select', 'Drag left→right: enclosed · right→left: touched'],
  ['Move', 'Drag, or M then base point then target'],
  ['Exact move while dragging', 'Type a distance, then Enter'],
  ['Free move (no snapping)', 'Hold Alt while dragging'],
  ['Typed values', 'Accept units: 57, 57mm, 2.25in, 2 1/4in'],
];

const SECTIONS: { name: string; match: (c: CommandDef) => boolean }[] = [
  { name: 'File', match: (c) => c.group === 'File' && !c.id.startsWith('export.') },
  { name: 'Export', match: (c) => c.id.startsWith('export.') },
  { name: 'Edit', match: (c) => c.group === 'Edit' },
  { name: 'Tools', match: (c) => c.group === 'Tools' && !c.id.startsWith('template.') },
  { name: 'Arrange', match: (c) => c.group === 'Arrange' },
  { name: 'View', match: (c) => c.group === 'View' && c.id !== 'view.template' },
  { name: 'Template editor', match: (c) => c.id.startsWith('template.') || c.id === 'view.template' },
  { name: 'Help', match: (c) => c.group === 'Help' },
];

export function ShortcutMap() {
  const open = useUi((s) => s.shortcutsOpen);
  return open ? <ShortcutBody /> : null;
}

/** Every command and its keys, by section; click a key to rebind it (saved in this browser). */
function ShortcutBody() {
  const keymap = usePrefs((p) => p.keymap);
  const [q, setQ] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const close = () => ui.set({ shortcutsOpen: false });
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  // One row per label: alternates (Delete and Backspace, Ctrl+Y) share a row.
  const sections = SECTIONS.map((sec) => {
    const rows = new Map<string, CommandDef[]>();
    for (const c of COMMANDS) {
      if (!sec.match(c)) continue;
      if (words.length && !hit(`${sec.name} ${c.label} ${c.shortcut ?? ''}`)) continue;
      rows.set(c.label, [...(rows.get(c.label) ?? []), c]);
    }
    return { name: sec.name, rows: [...rows.entries()] };
  }).filter((s) => s.rows.length);
  const mouse = MOUSE.filter(([a, b]) => !words.length || hit(`${a} ${b}`));

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (!capturing) {
      if (e.key === 'Escape') close();
      return;
    }
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') {
      setCapturing(null);
      setNote('');
      return;
    }
    const sc = eventShortcut(e.nativeEvent);
    const clash = shortcutConflicts(capturing, sc);
    if (clash.length) {
      setNote(`${sc} is already used by “${clash[0]!.label}”. Choose another key, or clear that one first.`);
      return;
    }
    bindShortcut(capturing, sc);
    setNote(`${COMMAND_BY_ID.get(capturing)!.label}: ${sc}`);
    setCapturing(null);
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog shortcuts" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown} role="dialog" aria-label="Keyboard shortcuts">
        <header className="panel-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pad-x shortcut-tools">
          <input autoFocus placeholder="Search commands and keys" value={q} onChange={(e) => setQ(e.target.value)} data-testid="shortcut-search" />
          {Object.keys(keymap).length > 0 && (
            <button className="btn ghost small" onClick={() => (prefs.set({ keymap: {} }), setNote('All shortcuts back to their defaults'))}>
              Reset all
            </button>
          )}
        </div>
        <p className={`shortcut-note small${capturing ? ' is-capturing' : ''}`} aria-live="polite">
          {note || (capturing ? `Press the new keys for “${COMMAND_BY_ID.get(capturing)!.label}” · Esc to cancel` : 'Click a key to change it. Changes are kept in this browser.')}
        </p>
        <div className="shortcut-scroll">
          {mouse.length > 0 && (
            <section>
              <h3>Mouse</h3>
              <table>
                <tbody>
                  {mouse.map(([a, b]) => (
                    <tr key={a}>
                      <td>{a}</td>
                      <td>
                        <kbd>{b}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {sections.map((sec) => (
            <section key={sec.name}>
              <h3>{sec.name}</h3>
              <table>
                <tbody>
                  {sec.rows.map(([label, cmds]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="keys">
                        {cmds.map((c) => {
                          const changed = c.id in keymap;
                          return (
                            <span key={c.id} className="key-cell">
                              <button
                                className={`key-btn${capturing === c.id ? ' is-capturing' : ''}${changed ? ' is-changed' : ''}`}
                                onClick={() => (setCapturing(c.id), setNote(''))}
                                title={changed ? `Changed from ${DEFAULT_SHORTCUT.get(c.id) ?? 'none'}` : 'Change'}
                                data-testid={`key-${c.id}`}
                              >
                                {capturing === c.id ? '…' : c.shortcut ? <kbd>{c.shortcut}</kbd> : <span className="muted">add</span>}
                              </button>
                              {changed && (
                                <button className="icon-btn small" onClick={() => bindShortcut(c.id, null)} title={`Reset to ${DEFAULT_SHORTCUT.get(c.id) ?? 'none'}`} aria-label="Reset">
                                  ↺
                                </button>
                              )}
                              {!changed && c.shortcut && (
                                <button className="icon-btn small" onClick={() => bindShortcut(c.id, '')} title="Clear this shortcut" aria-label="Clear">
                                  ×
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ArrayDialog() {
  const [kind, setKind] = useState<'linear' | 'circular' | null>(null);
  const doc = useDoc();
  const units = doc.settings.units;
  const [count, setCount] = useState(4);
  const [dx, setDx] = useState(25);
  const [dy, setDy] = useState(0);
  const [cx, setCx] = useState(0);
  const [cy, setCy] = useState(0);
  const [angle, setAngle] = useState(360);
  const [rotate, setRotate] = useState(true);
  useEffect(() => {
    dialogs.openArray = (k) => {
      const c = selectionCentre();
      if (c) {
        setCx(Math.round(c.x));
        setCy(Math.round(c.y - 50));
      }
      setKind(k);
    };
  }, []);
  if (!kind) return null;
  const apply = () => {
    if (kind === 'linear') linearArray(count, dx, dy);
    else circularArray(count, { x: cx, y: cy }, angle, rotate);
    setKind(null);
  };
  return (
    <div className="overlay" onMouseDown={() => setKind(null)}>
      <div
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setKind(null);
          e.stopPropagation();
        }}
        role="dialog"
        aria-label={kind === 'linear' ? 'Linear array' : 'Circular array'}
      >
        <header className="panel-head">
          <h2>{kind === 'linear' ? 'Linear array' : 'Circular array'}</h2>
        </header>
        <div className="pad">
          <NumberField label="Count (including original)" value={count} unit="×" parse={(s) => (/^\d+$/.test(s.trim()) ? Math.max(2, Math.min(100, Number(s))) : null)} onCommit={setCount} />
          {kind === 'linear' ? (
            <div className="field-row">
              <LengthField label="Step X" mm={dx} units={units} onCommit={setDx} />
              <LengthField label="Step Y" mm={dy} units={units} onCommit={setDy} />
            </div>
          ) : (
            <>
              <div className="field-row">
                <LengthField label="Centre X" mm={cx} units={units} onCommit={setCx} />
                <LengthField label="Centre Y" mm={cy} units={units} onCommit={setCy} />
              </div>
              <NumberField label="Total angle" value={angle} unit="°" onCommit={setAngle} />
              <label className="check-field">
                <input type="checkbox" checked={rotate} onChange={() => setRotate(!rotate)} /> Rotate copies
              </label>
            </>
          )}
          <p className="muted small">
            {kind === 'linear'
              ? `Makes ${count - 1} copies, each ${formatLength(Math.hypot(dx, dy), units)} on from the last.`
              : `Makes ${count - 1} copies around (${formatLength(cx, units)}, ${formatLength(cy, units)}).`}
          </p>
          <div className="dialog-actions">
            <button className="btn ghost" onClick={() => setKind(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={apply}>
              Make array
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
