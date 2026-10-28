/**
 * Every user action, in one registry. Menus, the command palette and keyboard shortcuts
 * all read from it, so each action is reachable all three ways.
 */
import { shapeBox } from '../geom/shapes';
import { projectGeometry, resolveTemplate } from '../model/resolve';
import { Project, SCHEMA_VERSION } from '../model/schema';
import { blankProject, docs, pik20dProject, sampleProject, wiringSampleProject } from '../store/app';
import { loadBeforeLink } from '../store/persist';
import { prefs, resolveTheme, type ThemeChoice } from '../store/prefs';
import { replaceWork } from '../store/recovery';
import type { ExportKind } from '../export';
import { createDraft, detectGrid, drafts, editTemplate, fitPhotoView, fitPlaneView, photo, tplUi, type TplTool } from '../template/session';
import { deleteTplSelection, moveSelectedFeature } from '../template/edit';
import { assignRoute, resetSchematic } from '../wiring/actions';

const selectedWires = () => ui.state.selection.filter((id) => docs.doc.wires.some((w) => w.id === id));
const selectedRoute = () => ui.state.selection.find((id) => docs.doc.routes.some((r) => r.id === id)) ?? null;
function putOnRoute() {
  const r = selectedRoute();
  if (r) assignRoute(selectedWires(), r);
}
import { ui, type Tool, type ViewName } from '../store/ui';
import {
  align,
  deleteSelection,
  distribute,
  duplicateSelection,
  mirrorCopy,
  moveSelection,
  detachSelection,
  rotateSelection,
  selectionBox,
} from './actions';
import { zoomToFit } from './viewport';

export interface CommandDef {
  id: string;
  label: string;
  group: 'File' | 'Edit' | 'Arrange' | 'View' | 'Tools' | 'Help';
  /** Display form, e.g. "Ctrl+D". */
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
  /** Views where the command's shortcut works; omitted means the panel editor views. */
  views?: ViewName[] | 'all';
}

export const dialogs = {
  openArray: (_kind: 'linear' | 'circular') => {},
};

/** Switch view. The rear view mirrors x about the same centre, so the panel stays put on screen. */
export function setView(view: ViewName) {
  if (view === ui.state.view) return;
  ui.set({ view, stack: null, tool: ui.state.tool === 'place' ? 'select' : ui.state.tool, message: '' });
}

/** Rear view: select the next part in the stack under the last click. */
function cycleStack() {
  const st = ui.state.stack;
  if (!st || st.ids.length < 2) return;
  const cur = ui.state.selection.length === 1 ? st.ids.indexOf(ui.state.selection[0]!) : -1;
  ui.set({ selection: [st.ids[(cur + 1) % st.ids.length]!] });
}

function setTool(tool: Tool) {
  ui.set({ tool, placing: tool === 'place' ? ui.state.placing : null, message: '' });
}

export function fitAll() {
  const t = resolveTemplate(docs.doc);
  const rear = ui.state.view === 'rear';
  const boxes = [...projectGeometry(docs.doc).values()].map((g) => (rear ? g.rearBox : g.frontBox));
  if (t) boxes.push(shapeBox(t.outline));
  zoomToFit(boxes);
}

function fitSelection() {
  const b = selectionBox();
  if (b) zoomToFit([{ minX: b.minX - 20, minY: b.minY - 20, maxX: b.maxX + 20, maxY: b.maxY + 20 }]);
}

/**
 * Run one export. Fabrication exports with open errors go through the export dialog,
 * where the user can override; everything else downloads straight away. The exporters
 * load on first use, so they do not slow the first page load.
 */
export async function runExport(kind: ExportKind, overridden = false) {
  const ex = await import('../export');
  const def = ex.EXPORT_BY_KIND.get(kind)!;
  if (def.fabrication && !overridden && ex.checkSummary(docs.doc).errors.length) {
    ui.set({ exportOpen: true, message: `${def.label} is blocked by open errors. Fix them, or override in the export dialog.` });
    return;
  }
  try {
    const file = await ex.buildExport(kind, docs.doc, { overridden });
    ex.downloadFile(file);
    ui.set({ message: `Exported ${file.name}${overridden ? ' (errors overridden and stamped)' : ''}` });
    walkthroughEvent('exported');
  } catch (e) {
    ui.set({ message: `Export failed: ${(e as Error).message}` });
  }
}

/** Load a project file chosen by the user or dropped on the window. */
export async function openProjectFile(f: File) {
  try {
    const json = JSON.parse(await f.text()) as { schemaVersion?: unknown };
    if (typeof json?.schemaVersion === 'number' && json.schemaVersion > SCHEMA_VERSION) {
      ui.set({ message: `${f.name} was saved by a newer version of the app. Reload the page to update, then open it again.` });
      return;
    }
    const parsed = Project.safeParse(json);
    if (!parsed.success) {
      ui.set({ message: `Not a valid project file: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}` });
      return;
    }
    replaceWork(parsed.data, `opening ${f.name}`);
    ui.set({ message: `Opened ${f.name}` });
    fitAll();
  } catch (e) {
    ui.set({ message: `Could not read ${f.name}: ${(e as Error).message}` });
  }
}

function openFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void openProjectFile(f);
  };
  input.click();
}

async function restoreBeforeLink() {
  const saved = await loadBeforeLink();
  if (!saved?.project) return ui.set({ message: 'There is no earlier work to restore' });
  replaceWork(saved.project, 'restoring work from before a share link');
  ui.set({ message: `Restored your work from before the link (${new Date(saved.savedAt).toLocaleString()})` });
  fitAll();
}

async function openBuiltIn(project: Project | Promise<Project>, name: string) {
  replaceWork(await project, `opening ${name}`);
  fitAll();
}

/** A new, empty project on a template, replacing the working copy (kept as a snapshot). */
export function createProject(fields: { name: string; registration: string; gliderType: string; template: Project['template'] }) {
  const p = blankProject();
  replaceWork({ ...p, ...fields, name: fields.name.trim() || p.name }, 'starting a new project');
  ui.set({ newOpen: false, message: 'New project. Drag parts from the library onto the panel.' });
  walkthroughEvent('created');
  requestAnimationFrame(fitAll);
}

/** The first-panel walkthrough moves on when the user does each step's action. */
export function walkthroughEvent(e: 'created' | 'exported') {
  const w = ui.state.walkthrough;
  if (!w) return;
  if (e === 'created' && w.step === 1) ui.set({ walkthrough: { step: 2, parts0: docs.doc.parts.length } });
  if (e === 'exported' && w.step === 3) ui.set({ walkthrough: { ...w, step: 4 } });
}

function setTheme(choice: ThemeChoice) {
  prefs.set({ theme: choice });
  ui.set({ theme: resolveTheme(choice), message: choice === 'system' ? 'Theme follows your system setting' : `${choice === 'dark' ? 'Dark' : 'Light'} theme` });
}

const hasSelection = () => ui.state.selection.length > 0;
const NUDGE = (dx: number, dy: number) => () => moveSelection(dx, dy, 'Nudge');

export const COMMANDS: CommandDef[] = [
  { id: 'file.new', label: 'New project…', group: 'File', run: () => ui.set({ newOpen: true }) },
  { id: 'file.sample', label: 'Open sample project', group: 'File', run: () => void openBuiltIn(sampleProject(), 'the sample project') },
  { id: 'file.sample-wiring', label: 'Open wiring sample project', group: 'File', run: () => void openBuiltIn(wiringSampleProject(), 'the wiring sample') },
  { id: 'file.sample-pik20d', label: 'Open PIK-20D example project', group: 'File', run: () => void openBuiltIn(pik20dProject(), 'the PIK-20D example') },
  { id: 'file.recover', label: 'Recover earlier work…', group: 'File', run: () => ui.set({ recoverOpen: true }) },
  { id: 'file.open', label: 'Open project file…', group: 'File', shortcut: 'Ctrl+O', run: openFile },
  { id: 'file.save', label: 'Save project file', group: 'File', shortcut: 'Ctrl+S', run: () => void runExport('project-json') },
  { id: 'file.export', label: 'Export…', group: 'File', shortcut: 'Ctrl+E', run: () => ui.set({ exportOpen: true }) },
  { id: 'file.share', label: 'Share link…', group: 'File', run: () => ui.set({ shareOpen: true }) },
  { id: 'file.restore-before-link', label: 'Restore work from before a share link', group: 'File', run: () => void restoreBeforeLink() },
  { id: 'export.cut-svg', label: 'Export cut file (SVG)', group: 'File', run: () => void runExport('cut-svg') },
  { id: 'export.cut-dxf', label: 'Export cut file (DXF)', group: 'File', run: () => void runExport('cut-dxf') },
  { id: 'export.template-pdf', label: 'Export printable template (PDF)', group: 'File', run: () => void runExport('template-pdf') },
  { id: 'export.render-png', label: 'Export front render (PNG)', group: 'File', run: () => void runExport('render-png') },
  { id: 'export.render-pdf', label: 'Export front render (PDF)', group: 'File', run: () => void runExport('render-pdf') },
  { id: 'export.rear-pdf', label: 'Export rear layout (PDF)', group: 'File', run: () => void runExport('rear-pdf') },
  { id: 'export.bom-csv', label: 'Export bill of materials (CSV)', group: 'File', run: () => void runExport('bom-csv') },

  { id: 'edit.undo', label: 'Undo', group: 'Edit', shortcut: 'Ctrl+Z', run: () => ui.set({ message: docs.undo() ? `Undid ${docs.future.at(-1)!.label}` : 'Nothing to undo' }), enabled: () => docs.past.length > 0 },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', shortcut: 'Ctrl+Shift+Z', run: () => ui.set({ message: docs.redo() ? `Redid ${docs.past.at(-1)!.label}` : 'Nothing to redo' }), enabled: () => docs.future.length > 0 },
  { id: 'edit.redo-y', label: 'Redo', group: 'Edit', shortcut: 'Ctrl+Y', run: () => docs.redo() },
  { id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', shortcut: 'Ctrl+D', run: () => duplicateSelection(), enabled: hasSelection },
  { id: 'edit.delete', label: 'Delete', group: 'Edit', shortcut: 'Delete', run: deleteSelection, enabled: hasSelection },
  { id: 'edit.delete-bs', label: 'Delete', group: 'Edit', shortcut: 'Backspace', run: deleteSelection, enabled: hasSelection },
  {
    id: 'edit.select-all',
    label: 'Select all',
    group: 'Edit',
    shortcut: 'Ctrl+A',
    run: () => ui.set({ selection: [...docs.doc.parts.map((p) => p.id), ...docs.doc.keepOuts.map((k) => k.id), ...docs.doc.texts.map((t) => t.id), ...docs.doc.dimensions.map((d) => d.id)] }),
  },
  {
    id: 'edit.deselect',
    label: 'Cancel / select tool',
    group: 'Edit',
    shortcut: 'Escape',
    run: () =>
      ui.set({ tool: 'select', placing: null, wireStart: null, routeDraft: [], selection: ui.state.tool === 'select' ? [] : ui.state.selection, paletteOpen: false, shortcutsOpen: false, exportOpen: false, shareOpen: false, message: '' }),
  },

  { id: 'arrange.rotate', label: 'Rotate 90°', group: 'Arrange', shortcut: 'R', run: () => rotateSelection(90), enabled: hasSelection },
  { id: 'arrange.rotate-cw', label: 'Rotate −90°', group: 'Arrange', shortcut: 'Shift+R', run: () => rotateSelection(-90), enabled: hasSelection },
  { id: 'arrange.nudge-left', label: 'Nudge left 1 mm', group: 'Arrange', shortcut: 'ArrowLeft', run: NUDGE(-1, 0), enabled: hasSelection },
  { id: 'arrange.nudge-right', label: 'Nudge right 1 mm', group: 'Arrange', shortcut: 'ArrowRight', run: NUDGE(1, 0), enabled: hasSelection },
  { id: 'arrange.nudge-up', label: 'Nudge up 1 mm', group: 'Arrange', shortcut: 'ArrowUp', run: NUDGE(0, 1), enabled: hasSelection },
  { id: 'arrange.nudge-down', label: 'Nudge down 1 mm', group: 'Arrange', shortcut: 'ArrowDown', run: NUDGE(0, -1), enabled: hasSelection },
  { id: 'arrange.nudge-left-10', label: 'Nudge left 10 mm', group: 'Arrange', shortcut: 'Shift+ArrowLeft', run: NUDGE(-10, 0), enabled: hasSelection },
  { id: 'arrange.nudge-right-10', label: 'Nudge right 10 mm', group: 'Arrange', shortcut: 'Shift+ArrowRight', run: NUDGE(10, 0), enabled: hasSelection },
  { id: 'arrange.nudge-up-10', label: 'Nudge up 10 mm', group: 'Arrange', shortcut: 'Shift+ArrowUp', run: NUDGE(0, 10), enabled: hasSelection },
  { id: 'arrange.nudge-down-10', label: 'Nudge down 10 mm', group: 'Arrange', shortcut: 'Shift+ArrowDown', run: NUDGE(0, -10), enabled: hasSelection },
  { id: 'arrange.nudge-left-01', label: 'Nudge left 0.1 mm', group: 'Arrange', shortcut: 'Alt+ArrowLeft', run: NUDGE(-0.1, 0), enabled: hasSelection },
  { id: 'arrange.nudge-right-01', label: 'Nudge right 0.1 mm', group: 'Arrange', shortcut: 'Alt+ArrowRight', run: NUDGE(0.1, 0), enabled: hasSelection },
  { id: 'arrange.nudge-up-01', label: 'Nudge up 0.1 mm', group: 'Arrange', shortcut: 'Alt+ArrowUp', run: NUDGE(0, 0.1), enabled: hasSelection },
  { id: 'arrange.nudge-down-01', label: 'Nudge down 0.1 mm', group: 'Arrange', shortcut: 'Alt+ArrowDown', run: NUDGE(0, -0.1), enabled: hasSelection },
  { id: 'arrange.align-left', label: 'Align left edges', group: 'Arrange', run: () => align('left') },
  { id: 'arrange.align-cx', label: 'Align centres vertically (same x)', group: 'Arrange', run: () => align('centre-x') },
  { id: 'arrange.align-right', label: 'Align right edges', group: 'Arrange', run: () => align('right') },
  { id: 'arrange.align-top', label: 'Align top edges', group: 'Arrange', run: () => align('top') },
  { id: 'arrange.align-cy', label: 'Align centres horizontally (same y)', group: 'Arrange', run: () => align('centre-y') },
  { id: 'arrange.align-bottom', label: 'Align bottom edges', group: 'Arrange', run: () => align('bottom') },
  { id: 'arrange.distribute-x', label: 'Distribute horizontally', group: 'Arrange', run: () => distribute('x') },
  { id: 'arrange.distribute-y', label: 'Distribute vertically', group: 'Arrange', run: () => distribute('y') },
  { id: 'arrange.mirror', label: 'Mirror copy about centreline', group: 'Arrange', run: mirrorCopy, enabled: hasSelection },
  { id: 'arrange.detach', label: 'Detach from parent part', group: 'Arrange', run: detachSelection, enabled: () => docs.doc.parts.some((p) => p.mountedTo && ui.state.selection.includes(p.id)) },
  { id: 'arrange.linear-array', label: 'Linear array…', group: 'Arrange', run: () => dialogs.openArray('linear'), enabled: hasSelection },
  { id: 'arrange.circular-array', label: 'Circular array…', group: 'Arrange', run: () => dialogs.openArray('circular'), enabled: hasSelection },

  { id: 'tool.select', label: 'Select tool', group: 'Tools', shortcut: 'S', run: () => setTool('select') },
  { id: 'tool.move', label: 'Move by base point', group: 'Tools', shortcut: 'M', run: () => (hasSelection() ? setTool('move') : ui.set({ message: 'Select something to move first' })) },
  { id: 'tool.measure', label: 'Measure tool', group: 'Tools', shortcut: 'Shift+M', run: () => setTool('measure') },
  { id: 'tool.keepout', label: 'Keep-out tool', group: 'Tools', shortcut: 'K', run: () => setTool('keepout') },
  { id: 'tool.text', label: 'Text tool', group: 'Tools', shortcut: 'T', run: () => setTool('text') },
  {
    id: 'tool.wire',
    label: 'Wire tool (pin to pin, port to port)',
    group: 'Tools',
    shortcut: 'W',
    views: ['front', 'rear', 'schematic'],
    run: () => {
      // Wiring happens in the rear view or the schematic; from the front, go to the rear.
      if (ui.state.view === 'front') setView('rear');
      ui.set({ tool: 'wire', wireStart: null, placing: null, message: 'Click a pin or port, then the one it connects to' });
    },
  },
  {
    id: 'tool.route',
    label: 'Route tool (draw a loom path)',
    group: 'Tools',
    shortcut: 'L',
    views: ['front', 'rear'],
    run: () => {
      if (ui.state.view !== 'rear') setView('rear');
      ui.set({ tool: 'route', routeDraft: [], placing: null, message: `Click points along the loom at ${ui.state.routeDepth} mm deep; double-click or Enter to finish` });
    },
  },
  { id: 'wiring.put-on-route', label: 'Put selected wires on selected route', group: 'Arrange', views: ['rear', 'schematic'], run: putOnRoute, enabled: () => selectedRoute() !== null && selectedWires().length > 0 },
  { id: 'wiring.take-off-route', label: 'Take selected wires off their route', group: 'Arrange', views: ['rear', 'schematic'], run: () => assignRoute(selectedWires(), null), enabled: () => selectedWires().some((id) => docs.doc.wires.find((w) => w.id === id)?.route) },
  { id: 'view.schematic', label: 'Schematic view', group: 'View', views: 'all', run: () => setView('schematic') },
  { id: 'schematic.reset', label: 'Reset schematic layout', group: 'View', views: ['schematic'], run: resetSchematic, enabled: () => docs.doc.parts.some((p) => p.schematic) },
  { id: 'tool.dimension', label: 'Dimension tool', group: 'Tools', shortcut: 'D', run: () => setTool('dimension') },

  {
    id: 'view.clear-guides',
    label: 'Clear guides',
    group: 'View',
    run: () => docs.dispatch('Clear guides', docs.doc.guides.map((g) => ({ op: 'remove', coll: 'guides', id: g.id }))),
    enabled: () => docs.doc.guides.length > 0,
  },
  { id: 'view.front', label: 'Front view', group: 'View', run: () => setView('front') },
  { id: 'view.rear', label: 'Rear view', group: 'View', run: () => setView('rear') },
  { id: 'view.flip', label: 'Flip front / rear', group: 'View', shortcut: 'V', run: () => setView(ui.state.view === 'rear' ? 'front' : 'rear') },
  { id: 'view.cycle-stack', label: 'Cycle through stacked parts', group: 'View', shortcut: 'Tab', run: cycleStack, enabled: () => ui.state.view === 'rear' && (ui.state.stack?.ids.length ?? 0) > 1 },
  { id: 'view.clear-depth-clip', label: 'Show all depths', group: 'View', run: () => ui.set({ depthClip: null }), enabled: () => ui.state.depthClip !== null },
  { id: 'view.fit', label: 'Zoom to fit', group: 'View', shortcut: 'F', run: fitAll },
  { id: 'view.fit-selection', label: 'Zoom to selection', group: 'View', shortcut: 'Shift+F', run: fitSelection, enabled: hasSelection },
  { id: 'view.zoom-in', label: 'Zoom in', group: 'View', shortcut: '=', run: () => ui.set({ zoom: Math.min(80, ui.state.zoom * 1.25) }) },
  { id: 'view.zoom-out', label: 'Zoom out', group: 'View', shortcut: '-', run: () => ui.set({ zoom: Math.max(0.2, ui.state.zoom / 1.25) }) },
  { id: 'view.units', label: 'Toggle metric / imperial', group: 'View', shortcut: 'U', run: toggleUnits },
  { id: 'view.theme', label: 'Toggle light / dark theme', group: 'View', shortcut: 'Shift+T', run: () => setTheme(ui.state.theme === 'light' ? 'dark' : 'light') },
  { id: 'view.theme-system', label: 'Theme: follow system setting', group: 'View', run: () => setTheme('system'), enabled: () => prefs.state.theme !== 'system' },
  { id: 'view.palette', label: 'Command palette', group: 'View', shortcut: 'Ctrl+K', run: () => ui.set({ paletteOpen: true }) },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Help', shortcut: '?', run: () => ui.set({ shortcutsOpen: true }) },
  { id: 'help.walkthrough', label: 'First panel walkthrough', group: 'Help', run: () => ui.set({ walkthrough: { step: 1, parts0: docs.doc.parts.length }, welcomeOpen: false }) },
  { id: 'help.welcome', label: 'Welcome screen', group: 'Help', run: () => ui.set({ welcomeOpen: true }) },
  ...templateCommands(),
];

function toggleUnits() {
  const s = docs.doc.settings;
  // A display preference stored with the project; still undoable so nothing is lost by accident.
  docs.dispatch('Change units', [{ op: 'set', key: 'settings', value: { ...s, units: s.units === 'metric' ? 'imperial' : 'metric' } }]);
}

export const COMMAND_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

/** Normalise a keyboard event to the shortcut string form used above. */
export function eventShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  // Shift is implied by the character for symbols like "?".
  if (e.shiftKey && (key.length > 1 || /[A-Z]/.test(key))) parts.push('Shift');
  if (key === 'Del') key = 'Delete';
  if (key === 'Esc') key = 'Escape';
  if (key === '+') key = '=';
  parts.push(key);
  return parts.join('+');
}

/** Commands whose shortcuts work in every view. */
const GLOBAL = new Set(['file.new', 'file.sample', 'file.sample-wiring', 'file.sample-pik20d', 'file.open', 'file.save', 'file.export', 'file.share', 'file.recover', 'view.units', 'view.theme', 'view.theme-system', 'view.palette', 'help.shortcuts', 'help.walkthrough', 'help.welcome']);

// ---------------------------------------------------------------- key bindings

/** Each command's shipped shortcut; the user's overrides (prefs.keymap) replace it. */
export const DEFAULT_SHORTCUT = new Map(COMMANDS.map((c) => [c.id, c.shortcut]));

const BY_SHORTCUT = new Map<string, CommandDef[]>();

function applyKeymap() {
  const km = prefs.state.keymap;
  BY_SHORTCUT.clear();
  for (const c of COMMANDS) {
    const sc = c.id in km ? km[c.id] || undefined : DEFAULT_SHORTCUT.get(c.id);
    c.shortcut = sc;
    if (!sc) continue;
    const k = sc.toUpperCase();
    BY_SHORTCUT.set(k, [...(BY_SHORTCUT.get(k) ?? []), c]);
  }
}
applyKeymap();
let appliedKeymap = prefs.state.keymap;
prefs.subscribe(() => {
  if (prefs.state.keymap === appliedKeymap) return;
  appliedKeymap = prefs.state.keymap;
  applyKeymap();
});

const ALL_VIEWS: ViewName[] = ['front', 'rear', 'schematic', 'template', 'review'];

/** Commands that already answer to a shortcut in any view where `id` would. */
export function shortcutConflicts(id: string, shortcut: string): CommandDef[] {
  const c = COMMAND_BY_ID.get(id);
  if (!c) return [];
  const views = ALL_VIEWS.filter((v) => activeIn(c, v));
  return (BY_SHORTCUT.get(shortcut.toUpperCase()) ?? []).filter((o) => o.id !== id && o.label !== c.label && views.some((v) => activeIn(o, v)));
}

/** Bind a command to a shortcut (null restores the default; '' unbinds it). */
export function bindShortcut(id: string, shortcut: string | null) {
  const km = { ...prefs.state.keymap };
  if (shortcut === null || shortcut === DEFAULT_SHORTCUT.get(id)) delete km[id];
  else km[id] = shortcut;
  prefs.set({ keymap: km });
}

/** Panel-editor commands that also make sense in the schematic. */
const SCHEMATIC_TOO = new Set(['edit.undo', 'edit.redo', 'edit.redo-y', 'edit.delete', 'edit.delete-bs', 'edit.deselect', 'tool.select', 'view.flip']);

function activeIn(c: CommandDef, view: ViewName): boolean {
  if (GLOBAL.has(c.id) || c.views === 'all') return true;
  if (c.views) return c.views.includes(view);
  return view === 'front' || view === 'rear' || (view === 'schematic' && SCHEMATIC_TOO.has(c.id));
}

export function handleKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
  const sc = eventShortcut(e).toUpperCase();
  if (typing && sc !== 'CTRL+K' && sc !== 'ESCAPE' && sc !== 'CTRL+S') return false;
  const view = ui.state.view;
  const cmd = BY_SHORTCUT.get(sc)?.find((c) => activeIn(c, view) && (!c.enabled || c.enabled()));
  if (!cmd) return false;
  e.preventDefault();
  cmd.run();
  return true;
}

// ---------------------------------------------------------------- template editor

function templateCommands(): CommandDef[] {
  const inTpl = () => ui.state.view === 'template';
  const tool = (t: TplTool) => () => tplUi.set({ tool: t, pending: [], rim: null, mode: ['grid-seed', 'ref-point', 'circle', 'scale-line'].includes(t) ? 'photo' : 'plane' });
  const T = (id: string, label: string, run: () => void, shortcut?: string, enabled?: () => boolean): CommandDef => ({
    id: `template.${id}`,
    label,
    group: 'Tools',
    shortcut,
    run,
    views: ['template'],
    enabled: () => inTpl() && (!enabled || enabled()),
  });
  const hasDraft = () => !!drafts.draft;
  const nudge = (dx: number, dy: number) => () => moveSelectedFeature(dx, dy);
  return [
    { id: 'view.template', label: 'Template editor', group: 'View', run: () => setView('template'), views: 'all' },
    {
      id: 'template.edit-current',
      label: 'Edit this project’s panel template',
      group: 'Tools',
      views: 'all',
      run: () => {
        const t = resolveTemplate(docs.doc);
        if (!t) return ui.set({ message: 'This project’s template is not in the library' });
        setView('template');
        // A template embedded in the project is your own; a library one is edited as a copy.
        void editTemplate(t, 'embedded' in docs.doc.template);
      },
    },
    T('new', 'New template from a photo or scan', () => void createDraft(), undefined, () => true),
    T('undo', 'Undo (template)', () => void drafts.undo(), 'Ctrl+Z', () => drafts.past.length > 0),
    T('redo', 'Redo (template)', () => void drafts.redo(), 'Ctrl+Shift+Z', () => drafts.future.length > 0),
    T('redo-y', 'Redo (template)', () => void drafts.redo(), 'Ctrl+Y', () => drafts.future.length > 0),
    T('toggle-mode', 'Template: switch photo / straightened view', () => tplUi.set({ mode: tplUi.state.mode === 'photo' ? 'plane' : 'photo', pending: [] }), 'V', hasDraft),
    T('fit', 'Template: zoom to fit', () => (tplUi.state.mode === 'plane' ? fitPlaneView() : photo.raster && tplUi.set({ photoView: fitPhotoView(photo.raster) })), 'F', hasDraft),
    T('find-grid', 'Template: find the mat grid', () => detectGrid(tplUi.state.gridSpacing), 'G', () => !!photo.raster),
    T('tool-select', 'Template: edit tool', tool('select'), 'S', hasDraft),
    T('tool-wand', 'Template: wand (suggest outline)', tool('wand'), 'W', hasDraft),
    T('tool-outline', 'Template: draw outline', tool('outline'), 'O', hasDraft),
    T('tool-datum', 'Template: set datum', tool('datum'), 'D', hasDraft),
    T('tool-bend', 'Template: bend line', tool('bend'), 'B', hasDraft),
    T('tool-fixing', 'Template: fixing hole', tool('fixing'), 'H', hasDraft),
    T('tool-keepout', 'Template: keep-out', tool('keepout'), 'K', hasDraft),
    T('tool-check', 'Template: check span', tool('check'), 'C', hasDraft),
    T('tool-circle', 'Template: instrument rim', tool('circle'), 'I', hasDraft),
    T('cancel', 'Template: cancel', () => tplUi.set({ pending: [], rim: null, tool: 'select', selection: null }), 'Escape', () => true),
    T('delete', 'Template: delete selection', () => deleteTplSelection(), 'Delete', () => !!tplUi.state.selection),
    T('delete-bs', 'Template: delete selection', () => deleteTplSelection(), 'Backspace', () => !!tplUi.state.selection),
    T('nudge-left', 'Template: nudge left', nudge(-0.5, 0), 'ArrowLeft', () => !!tplUi.state.selection),
    T('nudge-right', 'Template: nudge right', nudge(0.5, 0), 'ArrowRight', () => !!tplUi.state.selection),
    T('nudge-up', 'Template: nudge up', nudge(0, 0.5), 'ArrowUp', () => !!tplUi.state.selection),
    T('nudge-down', 'Template: nudge down', nudge(0, -0.5), 'ArrowDown', () => !!tplUi.state.selection),
    T('nudge-left-5', 'Template: nudge left 5 mm', nudge(-5, 0), 'Shift+ArrowLeft', () => !!tplUi.state.selection),
    T('nudge-right-5', 'Template: nudge right 5 mm', nudge(5, 0), 'Shift+ArrowRight', () => !!tplUi.state.selection),
    T('nudge-up-5', 'Template: nudge up 5 mm', nudge(0, 5), 'Shift+ArrowUp', () => !!tplUi.state.selection),
    T('nudge-down-5', 'Template: nudge down 5 mm', nudge(0, -5), 'Shift+ArrowDown', () => !!tplUi.state.selection),
  ];
}
