/**
 * First run: the welcome, the three-step "first panel" walkthrough, and the New project
 * dialog (where the walkthrough's first step happens: picking a template).
 */
import { useEffect, useState } from 'react';
import { TEMPLATES } from '../catalogue';
import { COMMAND_BY_ID, createProject } from '../editor/commands';
import { shapeBox, shapePath } from '../geom/shapes';
import type { PanelTemplate, Project } from '../model/schema';
import { docs, useDoc } from '../store/app';
import { prefs } from '../store/prefs';
import { ui, useUi } from '../store/ui';
import { useLocalTemplates } from '../template/store';

const run = (id: string) => COMMAND_BY_ID.get(id)!.run();

function finishWelcome() {
  prefs.set({ onboarded: true });
  ui.set({ welcomeOpen: false });
}

export function Welcome() {
  const open = useUi((s) => s.welcomeOpen);
  if (!open) return null;
  const choose = (id: string) => {
    finishWelcome();
    run(id);
  };
  return (
    <div className="overlay" onMouseDown={finishWelcome}>
      <div className="dialog wide welcome" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Welcome">
        <header className="panel-head">
          <h2>Welcome</h2>
          <button className="icon-btn" onClick={finishWelcome} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pad">
          <p className="welcome-lead">Glider Panel Designer lays out an instrument panel front and rear, plans its wiring, and makes 1:1 cut files from one project.</p>
          <p className="muted small">
            Everything stays in this browser: your work is saved here as you go, and leaves only when you export a file or share a link. It is a planning aid: panel changes still go through the
            normal inspection and approval route.
          </p>
          <div className="welcome-choices">
            <button className="welcome-choice is-primary" onClick={() => choose('help.walkthrough')} data-testid="welcome-walkthrough">
              <strong>Make your first panel</strong>
              <span>Three steps: pick a template, place instruments, check and export.</span>
            </button>
            <button className="welcome-choice" onClick={() => choose('file.sample')}>
              <strong>Explore the sample</strong>
              <span>A small rectangular panel, open now.</span>
            </button>
            <button className="welcome-choice" onClick={() => choose('file.sample-pik20d')}>
              <strong>Open the PIK-20D example</strong>
              <span>A PIK-20D re-panel with rear layout, wiring and tubing.</span>
            </button>
          </div>
          <p className="muted small">
            Press <kbd>?</kbd> for every shortcut, <kbd>Ctrl K</kbd> for any command. Help › Welcome screen brings this back.
          </p>
        </div>
      </div>
    </div>
  );
}

const STEPS: { title: string; body: React.ReactNode; action?: { label: string; id: string } }[] = [
  {
    title: 'Pick a panel template',
    body: 'Start a new project on your glider’s panel shape. Make your own from a photo or scan in the Template tab.',
    action: { label: 'Choose a template…', id: 'file.new' },
  },
  {
    title: 'Place instruments',
    body: (
      <>
        Drag a part from the <b>Parts</b> library on the left onto the panel, or click it and then click the panel.
      </>
    ),
  },
  {
    title: 'Check, then export',
    body: (
      <>
        The <b>Checks</b> panel on the right lists problems; click one to zoom to it. Then export a cut file or a printable 1:1 template.
      </>
    ),
    action: { label: 'Export…', id: 'file.export' },
  },
];

/** The walkthrough card, docked over the canvas; each step moves on when its action is done. */
export function Walkthrough() {
  const w = useUi((s) => s.walkthrough);
  const doc = useDoc();
  useEffect(() => {
    if (w?.step === 2 && doc.parts.length > w.parts0) ui.set({ walkthrough: { ...w, step: 3 } });
  }, [w, doc.parts.length]);
  if (!w) return null;
  const close = () => ui.set({ walkthrough: null });
  return (
    <section className="walkthrough" aria-label="First panel walkthrough" data-testid="walkthrough">
      <header>
        <span className="muted small">First panel {w.step < 4 ? `· step ${w.step} of 3` : '· done'}</span>
        <button className="icon-btn" onClick={close} aria-label="Close walkthrough">
          ×
        </button>
      </header>
      <ol className="walk-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i + 1 < w.step ? 'is-done' : i + 1 === w.step ? 'is-current' : ''}>
            <span className="walk-num">{i + 1 < w.step ? '✓' : i + 1}</span>
            <div>
              <strong>{s.title}</strong>
              {i + 1 === w.step && (
                <>
                  <p>{s.body}</p>
                  {s.action && (
                    <button className="btn primary small" onClick={() => run(s.action!.id)}>
                      {s.action.label}
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {w.step === 4 && (
        <div className="walk-done">
          <p>
            That’s a first panel. Next: <kbd>V</kbd> flips to the rear to check depth and stacking, <kbd>W</kbd> wires pins together and builds the schematic, and <kbd>?</kbd> lists every shortcut.
          </p>
          <button className="btn ghost small" onClick={close}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- new project

type Choice = { key: string; template: PanelTemplate; source: Project['template']; own: boolean };

export function NewProjectDialog() {
  const open = useUi((s) => s.newOpen);
  return open ? <NewProjectBody /> : null;
}

function NewProjectBody() {
  const local = useLocalTemplates();
  const choices: Choice[] = [
    ...TEMPLATES.map((t) => ({ key: `${t.id}@${t.version}`, template: t, source: { ref: { id: t.id, version: t.version } }, own: false })),
    // Your own templates are embedded whole, so files and links carry them.
    ...local.map((t) => ({ key: `own:${t.id}@${t.version}`, template: t, source: { embedded: t }, own: true })),
  ];
  // Start on the current project's template: a new project is usually for the same glider.
  const current = docs.doc.template;
  const currentKey = 'ref' in current ? `${current.ref.id}@${current.ref.version}` : `own:${current.embedded.id}@${current.embedded.version}`;
  const [key, setKey] = useState(choices.find((c) => c.key === currentKey)?.key ?? choices[0]?.key ?? '');
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [gliderType, setGliderType] = useState('');
  const chosen = choices.find((c) => c.key === key);
  const close = () => ui.set({ newOpen: false });
  const pick = (c: Choice) => {
    setKey(c.key);
    if (!gliderType && c.template.gliderTypes.length) setGliderType(c.template.gliderTypes[0]!);
  };
  const create = () => chosen && createProject({ name, registration, gliderType, template: chosen.source });
  const hasWork = docs.doc.parts.length > 0;
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
        aria-label="New project"
      >
        <header className="panel-head">
          <h2>New project</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pad">
          <span className="field-label">Panel template</span>
          <ul className="template-choices" role="radiogroup" aria-label="Panel template">
            {choices.map((c) => (
              <li key={c.key}>
                <button role="radio" aria-checked={c.key === key} className={`template-choice${c.key === key ? ' is-active' : ''}`} onClick={() => pick(c)} onDoubleClick={create}>
                  <TemplateThumb t={c.template} />
                  <span className="template-text">
                    <strong>{c.template.name}</strong>
                    <span className="muted small">
                      {[c.template.gliderTypes.join(', '), `${c.template.material}, ${c.template.thickness} mm`, c.own ? 'your template' : null].filter(Boolean).join(' · ')}
                    </span>
                    <span className="small">
                      {c.template.status === 'verified' ? <span className="badge badge-ok">verified</span> : <span className="badge badge-warn">draft</span>}
                      {c.template.provenance.accuracyMm != null && <span className="muted"> ±{c.template.provenance.accuracyMm} mm</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Project name</span>
              <input value={name} placeholder="Untitled panel" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus data-testid="new-name" />
            </label>
            <label className="field">
              <span className="field-label">Registration</span>
              <input value={registration} placeholder="G-XXXX" onChange={(e) => setRegistration(e.target.value)} data-testid="new-registration" />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Glider type</span>
            <input value={gliderType} onChange={(e) => setGliderType(e.target.value)} />
          </label>
          {hasWork && <p className="muted small">The current project is replaced. It is kept: File › Recover earlier work brings it back.</p>}
          <div className="dialog-actions">
            <button className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" onClick={create} disabled={!chosen} data-testid="new-create">
              Create project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The template's outline, small. */
function TemplateThumb({ t }: { t: PanelTemplate }) {
  const box = shapeBox(t.outline);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const pad = Math.max(w, h) * 0.06;
  return (
    <svg className="template-thumb" viewBox={`${box.minX - pad} ${-box.maxY - pad} ${w + 2 * pad} ${h + 2 * pad}`} aria-hidden>
      <path d={shapePath(t.outline)} transform="scale(1 -1)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
