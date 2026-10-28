import { useMemo } from 'react';
import { GENERIC_BY_ID } from '../catalogue/generic';
import { findPart, TEMPLATES } from '../catalogue';
import { round } from '../util/units';
import { resolveTemplate } from '../model/resolve';
import type { Dimension, KeepOut, Project, TextLabel } from '../model/schema';
import { docs, useDoc, useGeometry } from '../store/app';
import { ops } from '../store/doc';
import { ui, useUi } from '../store/ui';
import { mountTo, setDimension, setKeepOut, setMountOffset, setPartFields, setPartPosition, setText } from '../editor/actions';
import { dimensionEndPoint, dimensionGeometry } from '../geom/annotation';
import { formatLength } from '../util/units';
import { COMMAND_BY_ID, setView } from '../editor/commands';
import { GRP_SUGGESTED } from '../checks/thresholds';
import { descendants, projectGeometry } from '../model/resolve';
import { runChecks, type CheckResult } from '../checks/checks';
import { zoomToFit } from '../editor/viewport';
import { LengthField, NumberField, OptionalLengthField, TextField } from './Field';
import { Icon } from './icons';
import { useLocalTemplates } from '../template/store';
import { OffPanelFields, RouteInspector, WireInspector } from '../wiring/ui/WiringInspector';

export function Inspector() {
  const doc = useDoc();
  const selection = useUi((s) => s.selection);
  const geometry = useGeometry(doc);
  const units = doc.settings.units;

  if (selection.length === 0) return <ProjectInspector doc={doc} />;
  if (selection.length > 1) {
    return (
      <section className="panel inspector" aria-label="Properties">
        <header className="panel-head">
          <h2>Properties</h2>
        </header>
        <p className="muted pad">{selection.length} objects selected. Use Arrange for align, distribute, mirror and arrays.</p>
      </section>
    );
  }
  const id = selection[0]!;
  const ko = doc.keepOuts.find((k) => k.id === id);
  if (ko) return <KeepOutInspector k={ko} units={units} />;
  const wire = doc.wires.find((w) => w.id === id);
  if (wire) return <WireInspector doc={doc} w={wire} />;
  const route = doc.routes.find((r) => r.id === id);
  if (route) return <RouteInspector doc={doc} r={route} />;
  const tx = doc.texts.find((t) => t.id === id);
  if (tx) return <TextInspector t={tx} units={units} />;
  const dm = doc.dimensions.find((d) => d.id === id);
  if (dm) return <DimensionInspector d={dm} doc={doc} />;
  const pp = doc.parts.find((p) => p.id === id);
  const g = geometry.get(id);
  if (!pp || !g) return null;
  const part = g.part;
  const base = findPart(pp.part, doc.customParts);
  const def = base?.generator ? GENERIC_BY_ID.get(base.generator) : undefined;

  return (
    <section className="panel inspector" aria-label="Properties" data-testid="inspector">
      <header className="panel-head">
        <h2>Properties</h2>
      </header>
      <div className="pad">
        <div className="part-title">
          <strong>{part.model}</strong>
          <span className="muted">{part.maker}</span>
          {part.review !== 'verified' && (
            <span className="badge badge-warn" title="Catalogue values have not been checked against a datasheet">
              unverified data
            </span>
          )}
        </div>
        <TextField label="Label" value={pp.label} onCommit={(label) => setPartFields(id, { label }, 'Rename')} testId="insp-label" />
        <div className="field-row">
          <LengthField label="X" mm={g.transform.x} units={units} onCommit={(x) => setPartPosition(id, x, g.transform.y)} disabled={pp.locked} testId="insp-x" />
          <LengthField label="Y" mm={g.transform.y} units={units} onCommit={(y) => setPartPosition(id, g.transform.x, y)} disabled={pp.locked} testId="insp-y" />
        </div>
        <NumberField label="Rotation" value={pp.rotation} unit="°" onCommit={(r) => setPartFields(id, { rotation: ((r % 360) + 360) % 360 }, 'Rotate')} disabled={pp.locked} testId="insp-rot" />
        <label className="check-field">
          <input type="checkbox" checked={pp.locked} onChange={() => setPartFields(id, { locked: !pp.locked }, pp.locked ? 'Unlock' : 'Lock')} />
          Locked
        </label>
        {part.offPanel && (
          <>
            <h3 className="sub-head">Off the panel</h3>
            <p className="muted small">Its position in the rear view is where the loom leaves the panel for it.</p>
            <OffPanelFields doc={doc} partId={id} />
          </>
        )}
        <h3 className="sub-head">Mounting and depth</h3>
        <label className="field">
          <span className="field-label">Mounted to</span>
          <select
            value={pp.mountedTo?.parent ?? ''}
            data-testid="insp-mount"
            disabled={pp.locked}
            onChange={(e) => mountTo(id, e.target.value || null)}
          >
            <option value="">Panel</option>
            {doc.parts
              .filter((o) => o.id !== id && !descendants(doc.parts, [id]).has(o.id))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label || geometry.get(o.id)?.part.model || o.id}
                </option>
              ))}
          </select>
        </label>
        {pp.mountedTo && (
          <>
            <p className="muted small">Offset from the parent part. It moves with its parent and cuts nothing in the panel.</p>
            <div className="field-row three">
              <LengthField label="dx" mm={pp.mountedTo.dx} units={units} onCommit={(dx) => setMountOffset(id, { dx })} testId="insp-dx" />
              <LengthField label="dy" mm={pp.mountedTo.dy} units={units} onCommit={(dy) => setMountOffset(id, { dy })} testId="insp-dy" />
              <LengthField label="dz" mm={pp.mountedTo.dz} units={units} onCommit={(dz) => setMountOffset(id, { dz })} testId="insp-dz" />
            </div>
          </>
        )}
        <LengthField label="Extra depth offset" mm={pp.depthOffset} units={units} onCommit={(depthOffset) => setPartFields(id, { depthOffset }, 'Set depth offset')} disabled={pp.locked} testId="insp-depth-offset" />
        {def && (
          <>
            <h3 className="sub-head">Parameters</h3>
            <p className="note warn">
              <Icon name="warn" size={14} /> Generic defaults, not datasheet values. Check each against your instrument before cutting.
            </p>
            {Object.entries(def.params).map(([key, prm]) =>
              prm.unit === 'mm' ? (
                <LengthField
                  key={key}
                  label={prm.label}
                  mm={pp.params?.[key] ?? prm.value}
                  units={units}
                  onCommit={(v) => setPartFields(id, { params: { ...pp.params, [key]: Math.max(prm.min ?? 0, v) } }, `Set ${prm.label.toLowerCase()}`)}
                  testId={`param-${key}`}
                />
              ) : (
                <NumberField
                  key={key}
                  label={prm.label}
                  value={pp.params?.[key] ?? prm.value}
                  unit={prm.unit}
                  parse={(s) => (Number.isFinite(Number(s)) && s.trim() !== '' ? Number(s) : null)}
                  onCommit={(v) => setPartFields(id, { params: { ...pp.params, [key]: v } }, `Set ${prm.label.toLowerCase()}`)}
                  testId={`param-${key}`}
                />
              ),
            )}
          </>
        )}
        <h3 className="sub-head">Footprint</h3>
        <dl className="facts">
          <dt>Front</dt>
          <dd>
            {round(g.frontBox.maxX - g.frontBox.minX, 2)} × {round(g.frontBox.maxY - g.frontBox.minY, 2)} mm
          </dd>
          <dt>Depth</dt>
          <dd>{part.rear.depth === null ? <span className="badge badge-warn">unknown</span> : `${part.rear.depth} mm`}</dd>
          <dt>Depth band</dt>
          <dd data-testid="insp-band">{g.z1 === null ? `from ${round(g.z0, 1)} mm` : `${round(g.z0, 1)} to ${round(g.z1, 1)} mm behind panel`}</dd>
          <dt>Protrudes</dt>
          <dd>{part.front.protrusion === null ? <span className="badge badge-warn">unknown</span> : `${part.front.protrusion} mm`}</dd>
          {part.datasheet && (
            <>
              <dt>Datasheet</dt>
              <dd>
                <a href={part.datasheet} target="_blank" rel="noreferrer">
                  link
                </a>
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

function KeepOutInspector({ k, units }: { k: KeepOut; units: 'metric' | 'imperial' }) {
  const s = k.shape;
  return (
    <section className="panel inspector" aria-label="Properties">
      <header className="panel-head">
        <h2>Keep-out zone</h2>
      </header>
      <div className="pad">
        <p className="muted">Nothing may be cut here.</p>
        <TextField label="Label" value={k.label} onCommit={(label) => setKeepOut({ ...k, label })} />
        {s.kind === 'rect' && (
          <>
            <div className="field-row">
              <LengthField label="Centre X" mm={s.cx} units={units} onCommit={(cx) => setKeepOut({ ...k, shape: { ...s, cx } })} />
              <LengthField label="Centre Y" mm={s.cy} units={units} onCommit={(cy) => setKeepOut({ ...k, shape: { ...s, cy } })} />
            </div>
            <div className="field-row">
              <LengthField label="Width" mm={s.w} units={units} onCommit={(w) => w > 0 && setKeepOut({ ...k, shape: { ...s, w } })} />
              <LengthField label="Height" mm={s.h} units={units} onCommit={(h) => h > 0 && setKeepOut({ ...k, shape: { ...s, h } })} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function TextInspector({ t, units }: { t: TextLabel; units: 'metric' | 'imperial' }) {
  return (
    <section className="panel inspector" aria-label="Properties" data-testid="inspector">
      <header className="panel-head">
        <h2>Text label</h2>
      </header>
      <div className="pad">
        <TextField label="Text" value={t.text} onCommit={(text) => setText({ ...t, text }, 'Edit text')} testId="insp-text" />
        <div className="field-row">
          <LengthField label="X" mm={t.x} units={units} onCommit={(x) => setText({ ...t, x }, 'Move text')} testId="insp-x" />
          <LengthField label="Y" mm={t.y} units={units} onCommit={(y) => setText({ ...t, y }, 'Move text')} testId="insp-y" />
        </div>
        <div className="field-row">
          <LengthField label="Letter height" mm={t.size} units={units} onCommit={(size) => size > 0 && setText({ ...t, size }, 'Set text height')} testId="insp-text-size" />
          <NumberField label="Rotation" value={t.rotation} unit="°" onCommit={(r) => setText({ ...t, rotation: ((r % 360) + 360) % 360 }, 'Rotate text')} />
        </div>
        <label className="field">
          <span className="field-label">Layer</span>
          <select value={t.layer} onChange={(e) => setText({ ...t, layer: e.target.value as TextLabel['layer'] }, 'Change text layer')} data-testid="insp-text-layer">
            <option value="engrave">Engrave (in the cut file)</option>
            <option value="print">Print only (renders, not cut)</option>
          </select>
        </label>
        <p className="muted small">Letter height is the height of a capital letter. Engraved text goes in the cut file as plain text in Helvetica; check your engraver handles it.</p>
      </div>
    </section>
  );
}

function DimensionInspector({ d, doc }: { d: Dimension; doc: Project }) {
  const geometry = projectGeometry(doc);
  const dg = dimensionGeometry(d, dimensionEndPoint(geometry));
  const units = doc.settings.units;
  const endName = (e: Dimension['a']) => ('part' in e ? doc.parts.find((p) => p.id === e.part)?.label || geometry.get(e.part)?.part.model || 'part' : `(${formatLength(e.x, units)}, ${formatLength(e.y, units)})`);
  return (
    <section className="panel inspector" aria-label="Properties" data-testid="inspector">
      <header className="panel-head">
        <h2>Dimension</h2>
      </header>
      <div className="pad">
        <dl className="facts">
          <dt>Measures</dt>
          <dd data-testid="insp-dim-value">{dg ? formatLength(dg.value, units) : 'a deleted part'}</dd>
          <dt>From</dt>
          <dd>{endName(d.a)}</dd>
          <dt>To</dt>
          <dd>{endName(d.b)}</dd>
        </dl>
        <label className="field">
          <span className="field-label">Direction</span>
          <select value={d.kind} onChange={(e) => setDimension({ ...d, kind: e.target.value as Dimension['kind'] }, 'Change dimension direction')} data-testid="insp-dim-kind">
            <option value="aligned">Point to point</option>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
        </label>
        <LengthField label="Offset from the points" mm={d.offset} units={units} onCommit={(offset) => setDimension({ ...d, offset }, 'Set dimension offset')} testId="insp-dim-offset" />
        <p className="muted small">Ends placed on a part centre follow the part. Drag the dimension to slide its line. Dimensions export as reference, not cut.</p>
      </div>
    </section>
  );
}

function ProjectInspector({ doc }: { doc: Project }) {
  const template = resolveTemplate(doc);
  const local = useLocalTemplates();
  const set = <K extends 'name' | 'registration' | 'gliderType' | 'author'>(key: K, label: string) => (v: string) => docs.dispatch(label, [ops.set(key, v)]);
  return (
    <section className="panel inspector" aria-label="Properties">
      <header className="panel-head">
        <h2>Project</h2>
      </header>
      <div className="pad">
        <TextField label="Name" value={doc.name} onCommit={set('name', 'Rename project')} />
        <div className="field-row">
          <TextField label="Registration" value={doc.registration} onCommit={set('registration', 'Set registration')} />
          <TextField label="Glider type" value={doc.gliderType} onCommit={set('gliderType', 'Set glider type')} />
        </div>
        <div className="field-row">
          <TextField label="Author" value={doc.author} onCommit={set('author', 'Set author')} />
          <NumberField
            label="Revision"
            unit="#"
            value={doc.revision}
            parse={(s) => (/^\d+$/.test(s.trim()) ? Number(s) : null)}
            onCommit={(r) => docs.dispatch('Set revision', [ops.set('revision', r)])}
            testId="set-revision"
          />
        </div>
        <label className="field">
          <span className="field-label">Panel template</span>
          <select
            value={'ref' in doc.template ? `${doc.template.ref.id}@${doc.template.ref.version}` : 'embedded'}
            onChange={(e) => {
              const t = TEMPLATES.find((x) => `${x.id}@${x.version}` === e.target.value);
              if (t) docs.dispatch('Change template', [ops.set('template', { ref: { id: t.id, version: t.version } })]);
              // Your own templates are embedded whole, so files and links carry them.
              const l = local.find((x) => `local:${x.id}@${x.version}` === e.target.value);
              if (l) docs.dispatch('Change template', [ops.set('template', { embedded: l })]);
            }}
          >
            {'embedded' in doc.template && <option value="embedded">{doc.template.embedded.name} (in this project)</option>}
            {local.map((t) => (
              <option key={`local:${t.id}@${t.version}`} value={`local:${t.id}@${t.version}`}>
                {t.name} (yours{t.status === 'draft' ? ', draft' : ''})
              </option>
            ))}
            {TEMPLATES.map((t) => (
              <option key={`${t.id}@${t.version}`} value={`${t.id}@${t.version}`}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {template && (
          <button className="btn ghost small" onClick={() => COMMAND_BY_ID.get('template.edit-current')!.run()} data-testid="edit-template">
            {'embedded' in doc.template ? 'Edit template' : 'Edit a copy of this template'}
          </button>
        )}
        {template && (
          <dl className="facts">
            <dt>Material</dt>
            <dd>
              {template.material}, {template.thickness} mm
            </dd>
            <dt>Status</dt>
            <dd>{template.status === 'verified' ? 'Verified' : <span className="badge badge-warn">draft</span>}</dd>
            <dt>Depth free</dt>
            <dd>{template.availableDepth.default === null ? 'unknown' : `${template.availableDepth.default} mm`}</dd>
          </dl>
        )}
        <LengthField
          label="Grid"
          mm={doc.settings.gridMm}
          units={doc.settings.units}
          onCommit={(g) => g > 0 && docs.dispatch('Set grid', [ops.set('settings', { ...doc.settings, gridMm: g })])}
        />
        <h3 className="sub-head">Check thresholds</h3>
        <p className="muted small">Leave a field empty to turn its check off. Confirm these for your panel's material and thickness.</p>
        <OptionalLengthField label="Material between cuts" mm={doc.settings.minLigamentMm} units={doc.settings.units} onCommit={(v) => setSetting(doc, 'minLigamentMm', v)} testId="set-ligament" />
        <OptionalLengthField label="Cut to panel edge" mm={doc.settings.minEdgeDistanceMm} units={doc.settings.units} onCommit={(v) => setSetting(doc, 'minEdgeDistanceMm', v)} testId="set-edge" />
        <OptionalLengthField label="Cut to bend line" mm={doc.settings.minBendDistanceMm} units={doc.settings.units} onCommit={(v) => setSetting(doc, 'minBendDistanceMm', v)} testId="set-bend" />
        <button className="btn ghost small" onClick={() => docs.dispatch('Use suggested GRP thresholds', [ops.set('settings', { ...doc.settings, ...GRP_SUGGESTED })])}>
          Use suggested values for glass fibre
        </button>
        <p className="muted small">
          Suggested: {GRP_SUGGESTED.minLigamentMm} mm between cuts, {GRP_SUGGESTED.minEdgeDistanceMm} mm to the edge and {GRP_SUGGESTED.minBendDistanceMm} mm to a bend. These are starting points, not values from a standard.
        </p>
        <h3 className="sub-head">Wiring</h3>
        <div className="field-row">
          <NumberField label="Voltage drop limit" value={doc.settings.voltageDropLimitV} unit="V" parse={(v) => (Number(v) > 0 ? Number(v) : null)} onCommit={(v) => docs.dispatch('Set voltage drop limit', [ops.set('settings', { ...doc.settings, voltageDropLimitV: v })])} testId="set-drop" />
          <LengthField label="End allowance" mm={doc.settings.endAllowanceMm} units={doc.settings.units} onCommit={(v) => v >= 0 && docs.dispatch('Set end allowance', [ops.set('settings', { ...doc.settings, endAllowanceMm: v })])} testId="set-end-allowance" />
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Wire rated</span>
            <select value={doc.settings.wireTempRatingC} onChange={(e) => docs.dispatch('Set wire rating', [ops.set('settings', { ...doc.settings, wireTempRatingC: Number(e.target.value) as 105 | 150 | 200 })])} data-testid="set-wire-temp">
              <option value={105}>105 °C</option>
              <option value={150}>150 °C</option>
              <option value={200}>200 °C</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Smallest wire</span>
            <select value={doc.settings.minWireAwg} onChange={(e) => docs.dispatch('Set smallest wire', [ops.set('settings', { ...doc.settings, minWireAwg: Number(e.target.value) })])}>
              {[24, 22, 20, 18].map((a) => (
                <option key={a} value={a}>
                  AWG {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        <NumberField label="Fuse load limit" value={Math.round(doc.settings.protectorDerating * 100)} unit="% of rating" parse={(v) => (Number(v) > 0 && Number(v) <= 100 ? Number(v) : null)} onCommit={(v) => docs.dispatch('Set fuse load limit', [ops.set('settings', { ...doc.settings, protectorDerating: v / 100 })])} />
        <p className="muted small">Wire ratings and resistance from FAA AC 43.13-1B table 11-9 (wires in bundles); fuse sizes per wire from table 11-3; 0.5 V drop is table 11-6's figure for a 14 V system.</p>
        <p className="muted small">Select a part to edit it. Click a part in the library, then click the panel to place it, or drag it on.</p>
      </div>
    </section>
  );
}

function setSetting(doc: Project, key: 'minLigamentMm' | 'minEdgeDistanceMm' | 'minBendDistanceMm', value: number | null) {
  docs.dispatch('Set check threshold', [ops.set('settings', { ...doc.settings, [key]: value })]);
}

const SEVERITY_ICON = { error: 'error', warning: 'warn', info: 'info' } as const;

export function ChecksPanel() {
  const doc = useDoc();
  const geometry = useGeometry(doc);
  const results = useMemo(() => runChecks(doc, geometry), [doc, geometry]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const r of results) counts[r.severity]++;

  const focus = (r: CheckResult) => {
    // Rear problems are easiest to see from behind; front ones from the front.
    if (r.area === 'rear') setView('rear');
    else if (r.area === 'front') setView('front');
    if (r.box) zoomToFit([{ minX: r.box.minX - 30, minY: r.box.minY - 30, maxX: r.box.maxX + 30, maxY: r.box.maxY + 30 }]);
    if (r.area === 'electrical' || r.area === 'pneumatic') setView(ui.state.view === 'front' ? 'rear' : ui.state.view);
    if (r.ids.length) ui.set({ selection: r.ids.filter((i) => doc.parts.some((p) => p.id === i) || doc.keepOuts.some((k) => k.id === i) || doc.wires.some((w) => w.id === i) || doc.routes.some((x) => x.id === i)) });
  };

  return (
    <section className="panel checks" aria-label="Checks" data-testid="checks">
      <header className="panel-head">
        <h2>Checks</h2>
        <span className="check-counts">
          <span className="sev-error">{counts.error}</span>
          <span className="sev-warning">{counts.warning}</span>
          <span className="sev-info">{counts.info}</span>
        </span>
      </header>
      <ul className="check-list">
        {results.map((r) => (
          <li key={r.key} className={`check sev-${r.severity}`} data-check={r.key} onClick={() => focus(r)} title="Click to zoom to it">
            <Icon name={SEVERITY_ICON[r.severity]} size={14} />
            <span>{r.message}</span>
          </li>
        ))}
        {!results.length && (
          <li className="check ok">
            <Icon name="check" size={14} /> No problems found.
          </li>
        )}
      </ul>
      <p className="disclaimer">Planning aid only. Checks do not make a design approved or airworthy.</p>
    </section>
  );
}
