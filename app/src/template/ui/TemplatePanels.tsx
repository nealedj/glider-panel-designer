/**
 * Template editor side panels: the drafts and library list (left), and the pipeline steps
 * with their tools and results (right).
 */
import { useEffect, useMemo, useState } from 'react';
import { TEMPLATES } from '../../catalogue';
import { downloadFile } from '../../util/download';
import { Project, type PanelTemplate } from '../../model/schema';
import { docs } from '../../store/app';
import { ops } from '../../store/doc';
import { ui } from '../../store/ui';
import { LengthField, NumberField, OptionalLengthField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/icons';
import { formatLength } from '../../util/units';
import { buildTemplate, calibrationSummary, checkResults, draftMap, estimateAccuracy, type TemplateDraft } from '../draft';
import {
  addFeature,
  allDrafts,
  calibrateFromCircles,
  calibrateFromPoints,
  calibrateFromScale,
  createDraft,
  detectGrid,
  drafts,
  fitPlaneView,
  importPhoto,
  markDraft,
  markVerified,
  mirrorOutline,
  openDraft,
  photo,
  removeDraft,
  saveToLibrary,
  editTemplate,
  setRaised,
  tplUi,
  useDraft,
  useTplUi,
  type TplStep,
  type TplTool,
} from '../session';
import { deleteLibraryTemplate, refreshLocalTemplates, useLocalTemplates } from '../store';
import { deleteTplSelection } from '../edit';


// ---------------------------------------------------------------- left: drafts and library

export function TemplateLeft() {
  const draft = useDraft();
  const [list, setList] = useState<TemplateDraft[]>([]);
  const local = useLocalTemplates();
  useEffect(() => {
    void allDrafts().then(setList);
  }, [draft?.id, draft?.name]);
  return (
    <>
      <section className="panel tpl-list" aria-label="Template drafts">
        <header className="panel-head">
          <h2>Template drafts</h2>
          <button className="btn small primary" onClick={() => void createDraft()} data-testid="tpl-new">
            New
          </button>
        </header>
        <ul className="tree">
          {list.map((x) => (x.id === draft?.id ? draft : x)).map((d) => (
            <li key={d.id} className={`tree-item${draft?.id === d.id ? ' is-selected' : ''}`} onClick={() => void openDraft(d)}>
              <span className="tree-label">{d.name}</span>
              <span className="tree-meta">{d.status}</span>
              <button
                className="icon-btn"
                aria-label={`Delete ${d.name}`}
                title="Delete draft and its photo"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete the draft “${d.name}” and its photo from this browser?`)) void removeDraft(d).then(() => allDrafts().then(setList));
                }}
              >
                ×
              </button>
            </li>
          ))}
          {!list.length && <li className="muted small pad">No drafts yet. Press New to start from a photo or scan.</li>}
        </ul>
      </section>
      <section className="panel tpl-library" aria-label="Template library">
        <header className="panel-head">
          <h2>Template library</h2>
        </header>
        <ul className="tree">
          {local.map((t) => (
            <LibraryRow key={`${t.id}@${t.version}`} t={t} local />
          ))}
          {TEMPLATES.map((t) => (
            <LibraryRow key={`${t.id}@${t.version}`} t={t} />
          ))}
        </ul>
        <p className="muted small pad">Yours are kept in this browser. Export one as JSON to share it or propose it for the shared library.</p>
      </section>
    </>
  );
}

function LibraryRow({ t, local }: { t: PanelTemplate; local?: boolean }) {
  return (
    <li className="tree-item lib-template" data-testid={`lib-tpl-${t.id}`}>
      <span className="tree-label">{t.name}</span>
      <span className={`badge ${t.status === 'verified' ? 'badge-ok' : 'badge-warn'}`}>{t.status}</span>
      <button
        className="icon-btn"
        title={local ? 'Edit' : 'Edit a copy (the shipped template stays as it is)'}
        aria-label={`Edit ${t.name}`}
        onClick={() => void editTemplate(t, !!local)}
        data-testid={`tpl-edit-${t.id}`}
      >
        <Icon name="edit" size={14} />
      </button>
      <button className="icon-btn" title="Use in the current project" aria-label={`Use ${t.name}`} onClick={() => applyTemplateToProject(t, !!local)}>
        <Icon name="check" size={14} />
      </button>
      {local && (
        <>
          <button className="icon-btn" title="Export as JSON" aria-label={`Export ${t.name}`} onClick={() => exportTemplateJson(t)}>
            <Icon name="export" size={14} />
          </button>
          <button
            className="icon-btn"
            title="Remove from your library"
            aria-label={`Remove ${t.name}`}
            onClick={() => {
              if (confirm(`Remove “${t.name}” from your library? Projects that use it keep their own copy.`)) void deleteLibraryTemplate(t).then(refreshLocalTemplates);
            }}
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}

/** Library templates go by reference; your own are embedded whole, so links and files carry them. */
export function applyTemplateToProject(t: PanelTemplate, local: boolean) {
  docs.dispatch(`Use template ${t.name}`, [ops.set('template', local ? { embedded: t } : { ref: { id: t.id, version: t.version } })]);
  ui.set({ message: `The project now uses “${t.name}”${t.status === 'draft' ? ' (draft: verify it before cutting)' : ''}` });
}

export function exportTemplateJson(t: PanelTemplate) {
  downloadFile({ name: `${t.id}.template.json`, mime: 'application/json', data: JSON.stringify(t, null, 2) + '\n' });
}

// ---------------------------------------------------------------- right: the steps

const STEPS: { step: TplStep; label: string }[] = [
  { step: 'photo', label: '1 Photo' },
  { step: 'calibrate', label: '2 Calibrate' },
  { step: 'outline', label: '3 Outline' },
  { step: 'features', label: '4 Features' },
  { step: 'accuracy', label: '5 Accuracy' },
  { step: 'save', label: '6 Save and verify' },
];

export function TemplateRight() {
  const draft = useDraft();
  const step = useTplUi((s) => s.step);
  const message = useTplUi((s) => s.message);
  if (!draft) {
    return (
      <section className="panel inspector" aria-label="Template steps">
        <header className="panel-head">
          <h2>Template editor</h2>
        </header>
        <div className="pad">
          <p>Make a panel template from a scan, a photo of a template on a cutting mat, or a photo of a fitted panel.</p>
          <ol className="small">
            <li>Import the picture.</li>
            <li>Calibrate: the mat grid, round instruments, known points or a scale.</li>
            <li>Trace the outline and features on the straightened picture.</li>
            <li>Check spans against the real thing, save, print 1:1 and verify.</li>
          </ol>
          <p className="note warn">
            <Icon name="warn" size={14} /> Photo templates are approximate. They stay drafts until checked against the real panel at 1:1.
          </p>
          <button className="btn primary" onClick={() => void createDraft()}>
            New template
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="panel inspector tpl-steps" aria-label="Template steps" data-testid="tpl-steps">
      <header className="panel-head">
        <h2>{draft.name}</h2>
        <span className={`badge ${draft.status === 'verified' ? 'badge-ok' : 'badge-warn'}`}>{draft.status}</span>
      </header>
      <nav className="step-tabs">
        {STEPS.map((s) => (
          <button
            key={s.step}
            className={`step-tab${step === s.step ? ' is-active' : ''}`}
            onClick={() => tplUi.set({ step: s.step, pending: [], mode: s.step === 'photo' || (s.step === 'calibrate' && !draft.calibration) ? 'photo' : s.step === 'calibrate' ? tplUi.state.mode : 'plane' })}
            data-testid={`tpl-step-${s.step}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="pad tpl-step-body">
        {step === 'photo' && <PhotoStep d={draft} />}
        {step === 'calibrate' && <CalibrateStep d={draft} />}
        {step === 'outline' && <OutlineStep d={draft} />}
        {step === 'features' && <FeaturesStep d={draft} />}
        {step === 'accuracy' && <AccuracyStep d={draft} />}
        {step === 'save' && <SaveStep d={draft} />}
        {message && (
          <p className="note tpl-message" data-testid="tpl-message">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

function ToolButton({ tool, label, hint }: { tool: TplTool; label: string; hint?: string }) {
  const cur = useTplUi((s) => s.tool);
  return (
    <button className={`tool-btn small${cur === tool ? ' is-active' : ''}`} title={hint} onClick={() => tplUi.set({ tool, pending: [], rim: null })} data-testid={`tpl-tool-${tool}`}>
      {label}
    </button>
  );
}

const INPUT_TYPES: { v: TemplateDraft['inputType']; label: string }[] = [
  { v: 'scan', label: 'Flatbed scan of the panel or a blank (most accurate)' },
  { v: 'gridded-mockup', label: 'Template on a gridded cutting mat, from above' },
  { v: 'tracing', label: 'Paper tracing, scanned or photographed flat' },
  { v: 'straight-photo', label: 'Square-on photo with a ruler or known instrument' },
  { v: 'angled-photo', label: 'Angled photo of a fitted panel (layout ideas only)' },
  { v: 'measured', label: 'Measured by hand' },
  { v: 'drawn', label: 'Drawn from a drawing' },
];

function PhotoStep({ d }: { d: TemplateDraft }) {
  const set = (patch: Partial<TemplateDraft>) => drafts.update((x) => ({ ...x, ...patch }));
  return (
    <>
      <TextField label="Template name" value={d.name} onCommit={(name) => set({ name })} testId="tpl-name" />
      <label className="field">
        <span className="field-label">What is the picture?</span>
        <select value={d.inputType} onChange={(e) => set({ inputType: e.target.value as TemplateDraft['inputType'] })} data-testid="tpl-input-type">
          {INPUT_TYPES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {(d.inputType === 'angled-photo' || d.inputType === 'straight-photo') && (
        <p className="note warn">
          <Icon name="warn" size={14} /> For a template you will cut from, a scan or a template on a cutting mat is far more accurate.
        </p>
      )}
      <label className="btn ghost file-btn">
        {d.photo ? 'Replace photo…' : 'Import photo or scan…'}
        <input
          type="file"
          accept="image/*"
          data-testid="tpl-photo-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importPhoto(f);
            e.target.value = '';
          }}
        />
      </label>
      {d.photo && (
        <p className="muted small">
          {d.photo.name}, {d.photo.width} × {d.photo.height} px. Kept in this browser only.
        </p>
      )}
      <TextField label="Source" value={d.source} onCommit={(source) => set({ source })} />
      <TextField label="Rights" value={d.rights} onCommit={(rights) => set({ rights })} />
      <p className="muted small">Use your own photos. Pictures from sales listings or forums are for layout ideas, not for templates you share.</p>
    </>
  );
}

const SPACINGS = [
  { mm: 12.7, label: '½ inch (12.7 mm)' },
  { mm: 25.4, label: '1 inch (25.4 mm)' },
  { mm: 10, label: '10 mm' },
  { mm: 5, label: '5 mm' },
];

function CalibrateStep({ d }: { d: TemplateDraft }) {
  const [method, setMethod] = useState<'grid' | 'circles' | 'points' | 'scale'>(d.calibration?.kind ?? (d.inputType === 'scan' ? 'scale' : d.inputType === 'gridded-mockup' ? 'grid' : 'circles'));
  const spacing = useTplUi((s) => s.gridSpacing);
  const pending = useTplUi((s) => s.pending);
  const rim = useTplUi((s) => s.rim);
  const [circles, setCircles] = useState<{ label: string; points: { x: number; y: number }[]; diameter: number }[]>(d.calibration?.kind === 'circles' ? d.calibration.circles : []);
  const [rimD, setRimD] = useState(80);
  const [rimLabel, setRimLabel] = useState('');
  const [pts, setPts] = useState<{ img: { x: number; y: number }; plane: { x: number; y: number } }[]>(d.calibration?.kind === 'points' ? d.calibration.points : []);
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(0);
  const [lineMm, setLineMm] = useState(100);
  const [dpi, setDpi] = useState<number | null>(null);
  const units = docs.doc.settings.units;
  const cal = d.calibration;
  const map = useMemo(() => draftMap(d), [d]);

  const tools: Record<typeof method, TplTool> = { grid: 'grid-seed', circles: 'circle', points: 'ref-point', scale: 'scale-line' };
  useEffect(() => {
    tplUi.set({ mode: 'photo', tool: tools[method], pending: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  return (
    <>
      <div className="seg" role="tablist">
        {(['grid', 'circles', 'points', 'scale'] as const).map((m) => (
          <button key={m} className={`seg-btn${method === m ? ' is-active' : ''}`} onClick={() => setMethod(m)} data-testid={`tpl-method-${m}`}>
            {{ grid: 'Mat grid', circles: 'Instruments', points: 'Points', scale: 'Scale' }[m]}
          </button>
        ))}
      </div>

      {method === 'grid' && (
        <>
          <p className="small">For a template photographed on a cutting mat. The grid straightens the photo, sets its scale and corrects lens distortion.</p>
          <label className="field">
            <span className="field-label">One square of the detected grid is</span>
            <select value={spacing} onChange={(e) => tplUi.set({ gridSpacing: Number(e.target.value) })} data-testid="tpl-grid-spacing">
              {SPACINGS.map((s) => (
                <option key={s.mm} value={s.mm}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Count by the finest lines, dashed ones included. Check the crosses on the photo afterwards: there should be one at every line crossing.</p>
          <div className="row-actions">
            <button className="btn primary small" onClick={() => detectGrid(spacing)} data-testid="tpl-detect-grid">
              Find grid
            </button>
            <button className="btn ghost small" onClick={() => tplUi.set({ tool: 'grid-seed', pending: [], message: 'Click the four corners of one grid square: top-left, top-right, bottom-right, bottom-left' })}>
              Click one square
            </button>
          </div>
          {pending.length === 4 && tplUi.state.tool === 'grid-seed' && (
            <button className="btn primary small" onClick={() => detectGrid(spacing, pending)}>
              Follow the grid from this square
            </button>
          )}
          <OptionalLengthField
            label="Template thickness above the mat"
            mm={d.raisedMm || null}
            units={units}
            onCommit={(v) => setRaised(v ?? 0)}
            testId="tpl-raised"
          />
          <p className="muted small">A card template sits above the grid, nearer the camera, so it looks slightly large. Enter its thickness to correct for it.</p>
        </>
      )}

      {method === 'circles' && (
        <>
          <p className="small">For a photo of a fitted panel. Click an instrument’s centre, then its rim; the rim is found and fitted. Give the rim’s true diameter. Three or more instruments correct for an angled photo.</p>
          {rim && (
            <div className="tpl-form">
              <TextField label="Instrument" value={rimLabel} onCommit={setRimLabel} testId="tpl-rim-label" />
              <LengthField label="Diameter of the rim you clicked" mm={rimD} units={units} onCommit={setRimD} testId="tpl-rim-d" />
              <button
                className="btn primary small"
                data-testid="tpl-rim-add"
                onClick={() => {
                  setCircles([...circles, { label: rimLabel || `Instrument ${circles.length + 1}`, points: rim, diameter: rimD }]);
                  setRimLabel('');
                  tplUi.set({ rim: null, message: '' });
                }}
              >
                Add instrument
              </button>
            </div>
          )}
          <ul className="tpl-refs">
            {circles.map((c, i) => (
              <li key={i}>
                {c.label}: Ø{c.diameter} mm, {c.points.length} points
                {cal?.kind === 'circles' && cal.diameterErrors[i] !== undefined && <span className="muted"> · fit {cal.diameterErrors[i]! >= 0 ? '+' : ''}{cal.diameterErrors[i]!.toFixed(2)} mm</span>}
                <button className="icon-btn" aria-label="Remove" onClick={() => setCircles(circles.filter((_, k) => k !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button className="btn primary small" disabled={!circles.length} onClick={() => calibrateFromCircles(circles)} data-testid="tpl-calibrate-circles">
            Calibrate from {circles.length} instrument{circles.length === 1 ? '' : 's'}
          </button>
        </>
      )}

      {method === 'points' && (
        <>
          <p className="small">Click a point in the panel’s plane whose position you know (e.g. a corner of a ruler or a rectangle), then enter it. Four or more, spread out.</p>
          {pending.length > 0 && (
            <div className="tpl-form">
              <div className="field-row">
                <LengthField label="X" mm={px} units={units} onCommit={setPx} />
                <LengthField label="Y" mm={py} units={units} onCommit={setPy} />
              </div>
              <button
                className="btn primary small"
                onClick={() => {
                  setPts([...pts, { img: pending[pending.length - 1]!, plane: { x: px, y: py } }]);
                  tplUi.set({ pending: [] });
                }}
              >
                Add point
              </button>
            </div>
          )}
          <ul className="tpl-refs">
            {pts.map((p, i) => (
              <li key={i}>
                ({formatLength(p.plane.x, units)}, {formatLength(p.plane.y, units)})
                <button className="icon-btn" aria-label="Remove" onClick={() => setPts(pts.filter((_, k) => k !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button className="btn primary small" disabled={pts.length < 4} onClick={() => calibrateFromPoints(pts)}>
            Calibrate from {pts.length} points
          </button>
        </>
      )}

      {method === 'scale' && (
        <>
          <p className="small">For a flatbed scan (give its resolution) or a square-on photo with a ruler (click two marks and give the distance).</p>
          <NumberField label="Scan resolution" value={dpi ?? 0} unit="dpi" parse={(s) => (Number(s) > 0 ? Number(s) : null)} onCommit={setDpi} />
          <button className="btn primary small" disabled={!dpi} onClick={() => calibrateFromScale(null, dpi)}>
            Use scan resolution
          </button>
          <LengthField label="Distance between the two clicked marks" mm={lineMm} units={units} onCommit={setLineMm} />
          <button className="btn primary small" disabled={pending.length < 2} onClick={() => calibrateFromScale({ a: pending[0]!, b: pending[1]!, mm: lineMm }, null)}>
            Set scale from line
          </button>
        </>
      )}

      {cal && (
        <div className="tpl-result" data-testid="tpl-calibration">
          <strong>Calibrated:</strong> {calibrationSummary(cal, d)}.
          {map?.camera && (
            <span className="muted small">
              {' '}
              Camera about {Math.round(map.camera.height)} mm above the grid ({map.camera.fSource === 'estimated' ? 'from the perspective' : 'assumed field of view'}).
            </span>
          )}
          <div className="row-actions">
            <button className="btn small primary" onClick={() => (tplUi.set({ mode: 'plane', step: 'outline', tool: 'wand' }), fitPlaneView())} data-testid="tpl-to-outline">
              Straightened view: trace the outline
            </button>
          </div>
        </div>
      )}
      {!photo.raster && <p className="note warn">Import a photo first (step 1).</p>}
    </>
  );
}

function OutlineStep({ d }: { d: TemplateDraft }) {
  const tol = useTplUi((s) => s.wandTolerance);
  const simplify = useTplUi((s) => s.simplifyMm);
  return (
    <>
      <p className="small">Click inside the panel with the wand for a suggested outline, or draw one. Then drag vertices to the true edge; drag an edge’s ◆ to make it an arc (Alt-click ◆ straightens it); double-click an edge to add a vertex; Delete removes one.</p>
      <div className="tool-grid">
        <ToolButton tool="wand" label="Wand" hint="Click inside the panel (W)" />
        <ToolButton tool="outline" label="Draw" hint="Click points; click the first to close (O)" />
        <ToolButton tool="select" label="Edit" hint="Drag vertices and arcs (S)" />
        <ToolButton tool="datum" label="Datum" hint="Click two points along an edge, left then right: the origin goes halfway, the x axis along them. Shift-click moves the origin only (D)" />
      </div>
      <div className="field-row">
        <NumberField label="Wand colour tolerance" value={tol} unit="" parse={(s) => (Number(s) > 0 ? Math.min(120, Number(s)) : null)} onCommit={(v) => tplUi.set({ wandTolerance: v })} testId="tpl-wand-tol" />
        <LengthField label="Smoothing" mm={simplify} units={docs.doc.settings.units} onCommit={(v) => v > 0 && tplUi.set({ simplifyMm: v })} testId="tpl-simplify" />
      </div>
      <p className="muted small">The datum is the origin of the panel’s coordinates. With the Datum tool, click the two bottom corners (left, then right): the origin goes to the middle of the bottom edge and the panel is levelled on it. Symmetric panels can then be mirrored.</p>
      <div className="row-actions">
        <button className="btn ghost small" onClick={() => mirrorOutline('left')} disabled={d.outline.length < 3} data-testid="tpl-mirror-left">
          Mirror left half
        </button>
        <button className="btn ghost small" onClick={() => mirrorOutline('right')} disabled={d.outline.length < 3}>
          Mirror right half
        </button>
      </div>
      <p className="muted small">{d.outline.length ? `${d.outline.length} vertices, ${d.outline.filter((p) => p.bulge).length} arcs.` : 'No outline yet.'}</p>
    </>
  );
}

function FeaturesStep({ d }: { d: TemplateDraft }) {
  const sel = useTplUi((s) => s.selection);
  const fixingD = useTplUi((s) => s.fixingD);
  const units = docs.doc.settings.units;
  const set = (patch: Partial<TemplateDraft>) => drafts.update((x) => ({ ...x, ...patch }));
  return (
    <>
      <div className="tool-grid">
        <ToolButton tool="select" label="Select" hint="Select and drag features (S)" />
        <ToolButton tool="bend" label="Bend line" hint="Click both ends of the fold (B)" />
        <ToolButton tool="fixing" label="Fixing hole" hint="Click each fixing hole’s centre (H)" />
        <ToolButton tool="keepout" label="Keep-out" hint="Drag a zone where nothing may be cut (K)" />
      </div>
      <LengthField label="Fixing hole diameter" mm={fixingD} units={units} onCommit={(v) => v > 0 && tplUi.set({ fixingD: v })} />
      {sel && <SelectionEditor d={d} />}
      <h3 className="sub-head">Panel details</h3>
      <div className="field-row">
        <TextField label="Material" value={d.material} onCommit={(material) => set({ material })} />
        <LengthField label="Thickness" mm={d.thickness} units={units} onCommit={(thickness) => thickness > 0 && set({ thickness })} testId="tpl-thickness" />
      </div>
      <OptionalLengthField label="Free depth behind the panel" mm={d.availableDepth} units={units} onCommit={(availableDepth) => set({ availableDepth })} testId="tpl-depth" />
      <OptionalLengthField label="Canopy clearance in front" mm={d.canopyClearance} units={units} onCommit={(canopyClearance) => set({ canopyClearance })} />
      <TextField label="Glider types (comma separated)" value={d.gliderTypes.join(', ')} onCommit={(v) => set({ gliderTypes: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
      <p className="muted small">
        {d.bendLines.length} bend lines, {d.fixings.length} fixing holes, {d.keepOuts.length} keep-outs. Instruments and other parts belong in the project, not the template.
      </p>
    </>
  );
}

function SelectionEditor({ d }: { d: TemplateDraft }) {
  const sel = useTplUi((s) => s.selection)!;
  const units = docs.doc.settings.units;
  const remove = () => {
    deleteTplSelection();
  };
  if (sel.kind === 'keepout') {
    const item = d.keepOuts.find((x) => x.id === sel.id);
    if (!item) return null;
    const s = item.shape;
    const update = (patch: Partial<typeof item>) =>
      drafts.update((x) => ({ ...x, keepOuts: x.keepOuts.map((k) => (k.id === sel.id ? { ...k, ...patch } : k)) }));
    return (
      <div className="tpl-form" data-testid="tpl-selection">
        <TextField label="Label" value={item.label} onCommit={(label) => update({ label })} testId="tpl-sel-label" />
        {s.kind === 'rect' && (
          <>
            <div className="field-row">
              <LengthField label="Width" mm={s.w} units={units} onCommit={(w) => w > 0 && update({ shape: { ...s, w } })} />
              <LengthField label="Height" mm={s.h} units={units} onCommit={(h) => h > 0 && update({ shape: { ...s, h } })} />
            </div>
            <LengthField label="Corner radius" mm={s.r} units={units} onCommit={(r) => r >= 0 && update({ shape: { ...s, r } })} />
          </>
        )}
        {s.kind === 'circle' && <LengthField label="Diameter" mm={s.d} units={units} onCommit={(dd) => dd > 0 && update({ shape: { ...s, d: dd } })} />}
        <button className="btn ghost small" onClick={remove}>
          Delete
        </button>
      </div>
    );
  }
  if (sel.kind === 'fixing') {
    const f = d.fixings[sel.id as number];
    if (!f) return null;
    return (
      <div className="tpl-form">
        <LengthField label="Hole diameter" mm={f.d} units={units} onCommit={(dd) => dd > 0 && drafts.update((x) => ({ ...x, fixings: x.fixings.map((h, i) => (i === sel.id ? { ...h, d: dd } : h)) }))} />
        <button className="btn ghost small" onClick={remove}>
          Delete
        </button>
      </div>
    );
  }
  if (sel.kind === 'bend' || sel.kind === 'check' || sel.kind === 'vertex') {
    return (
      <div className="tpl-form">
        <span className="muted small">{sel.kind === 'vertex' ? `Vertex ${Number(sel.id) + 1}` : sel.kind === 'bend' ? 'Bend line' : 'Check span'} selected. Arrow keys nudge 0.5 mm.</span>
        <button className="btn ghost small" onClick={remove}>
          Delete
        </button>
      </div>
    );
  }
  return null;
}

function AccuracyStep({ d }: { d: TemplateDraft }) {
  const acc = estimateAccuracy(d);
  const results = checkResults(d, acc);
  const pending = useTplUi((s) => s.pending);
  const tool = useTplUi((s) => s.tool);
  const [measured, setMeasured] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const units = docs.doc.settings.units;
  const span = pending.length === 2 ? Math.hypot(pending[1]!.x - pending[0]!.x, pending[1]!.y - pending[0]!.y) : null;
  return (
    <>
      {acc ? (
        <div className="tpl-result" data-testid="tpl-accuracy">
          <strong>Estimated error on any distance: ±{acc.spanMm.toFixed(1)} mm</strong>
          <table className="acc-terms">
            <tbody>
              {acc.terms.map((t) => (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td className="mono">{t.mm.toFixed(2)} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Each term is an error at one point; a distance has two ends. This is an estimate, not a guarantee.</p>
        </div>
      ) : (
        <p className="note warn">Calibrate first.</p>
      )}
      <h3 className="sub-head">Check spans</h3>
      <p className="small">Measure a few spans on the real panel or template with a rule, click their ends here and enter what you measured. Each should agree within the estimated error.</p>
      <ToolButton tool="check" label="Add a check span" hint="Click both ends (C)" />
      {tool === 'check' && span !== null && (
        <div className="tpl-form" data-testid="tpl-check-form">
          <p className="small">
            Template: <strong className="mono">{span.toFixed(1)} mm</strong>
          </p>
          <TextField label="What is it?" value={label} onCommit={setLabel} testId="tpl-check-label" />
          <OptionalLengthField label="Measured on the real thing" mm={measured} units={units} onCommit={setMeasured} testId="tpl-check-measured" />
          <button
            className="btn primary small"
            disabled={!measured}
            data-testid="tpl-check-add"
            onClick={() => {
              addFeature('check', { a: pending[0]!, b: pending[1]!, measuredMm: measured!, label: label || undefined });
              tplUi.set({ pending: [] });
              setMeasured(null);
              setLabel('');
            }}
          >
            Add check
          </button>
        </div>
      )}
      <table className="check-table" data-testid="tpl-checks">
        <thead>
          <tr>
            <th>Span</th>
            <th>Measured</th>
            <th>Template</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.check.id} className={r.withinError ? 'ok' : 'bad'}>
              <td>{r.check.label}</td>
              <td className="mono">{r.check.measuredMm.toFixed(1)}</td>
              <td className="mono">{r.templateMm.toFixed(1)}</td>
              <td className="mono">
                {r.diffMm >= 0 ? '+' : ''}
                {r.diffMm.toFixed(1)} {r.withinError ? '✓' : '✗'}
              </td>
            </tr>
          ))}
          {!results.length && (
            <tr>
              <td colSpan={4} className="muted small">
                No check spans yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function SaveStep({ d }: { d: TemplateDraft }) {
  const [note, setNote] = useState(d.verifiedNote);
  const printOutline = () => {
    const t = buildTemplateOrWarn(d);
    if (!t) return;
    // A project with this template and nothing else prints just the outline and features.
    const p = Project.parse({ schemaVersion: 1, id: 'template-check', name: `${t.name} (outline check)`, created: new Date().toISOString(), modified: new Date().toISOString(), template: { embedded: t } });
    void import('../../export/template-pdf').then(({ templatePdf }) => downloadFile({ name: `${t.id}-outline-A4.pdf`, mime: 'application/pdf', data: templatePdf(p).bytes }));
  };
  return (
    <>
      <p className="small">Save the template to your library, then print its outline at 1:1, hold it against the real panel and, if it fits, mark it verified.</p>
      <div className="row-actions">
        <button className="btn primary small" onClick={() => void saveToLibrary()} data-testid="tpl-save">
          Save to library
        </button>
        <button
          className="btn ghost small"
          onClick={() => void saveToLibrary().then((t) => t && applyTemplateToProject(t, true))}
          data-testid="tpl-use"
        >
          Save and use in project
        </button>
      </div>
      <div className="row-actions">
        <button className="btn ghost small" onClick={printOutline} data-testid="tpl-print">
          Print outline 1:1 (PDF)
        </button>
        <button
          className="btn ghost small"
          onClick={() => {
            const t = buildTemplateOrWarn(d);
            if (t) exportTemplateJson(t);
          }}
        >
          Export JSON
        </button>
      </div>
      <h3 className="sub-head">Verify</h3>
      {d.status === 'verified' ? (
        <>
          <p className="note ok">
            Verified {d.verifiedDate}: {d.verifiedNote}
          </p>
          <button className="btn ghost small" onClick={markDraft}>
            Back to draft
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">How you checked it</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Printed 1:1, check bar 100 mm; held against the panel: all edges within 1 mm" data-testid="tpl-verify-note" />
          </label>
          <button className="btn ghost small" onClick={() => markVerified(note)} data-testid="tpl-verify">
            Mark verified
          </button>
          <p className="muted small">Verified means the outline matched the real panel. It says nothing about approval: panel changes still go through the normal inspection route.</p>
        </>
      )}
    </>
  );
}

function buildTemplateOrWarn(d: TemplateDraft): PanelTemplate | null {
  const t = buildTemplate(d);
  if (!t) tplUi.set({ message: 'Trace the outline first' });
  return t;
}
