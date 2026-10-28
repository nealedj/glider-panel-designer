/**
 * Properties of a selected wire or tube, or a route: identity, size (automatic or fixed),
 * colour, what it carries, its length and voltage drop, and its protection.
 */
import { setPartFields } from '../../editor/actions';
import type { Project, Route, Wire } from '../../model/schema';
import { LengthField, NumberField, TextField } from '../../ui/Field';
import { formatLength } from '../../util/units';
import { assignRoute, setNet, setRoute, setWire } from '../actions';
import { bundles } from '../bundles';
import { analyse } from '../circuit';
import { CSS_COLOUR, cssColour } from '../nets';
import { CHART_SIZES, sizeLabel } from '../sizing';
import { keyOf } from '../terminals';
import { routeLength } from '../length';

const REASON: Record<string, string> = {
  minimum: 'smallest allowed size',
  current: 'sized for its current',
  'voltage drop': 'sized for voltage drop',
  protection: 'sized to be protected by its fuse or breaker',
};

export function WireInspector({ doc, w }: { doc: Project; w: Wire }) {
  const a = analyse(doc);
  const c = a.wires.get(w.id);
  const net = doc.nets.find((n) => n.id === w.net);
  const from = a.terms.get(keyOf(w.from));
  const to = a.terms.get(keyOf(w.to));
  const tube = !!w.tubeBoreMm || 'port' in w.from;
  const units = doc.settings.units;
  return (
    <section className="panel inspector" aria-label="Properties" data-testid="inspector">
      <header className="panel-head">
        <h2>{tube ? 'Tube' : 'Wire'}</h2>
        <span className="swatch-wire" style={{ background: cssColour(w.colour) }} />
      </header>
      <div className="pad">
        <TextField label="Label (printed at both ends)" value={w.label} onCommit={(label) => setWire({ ...w, label }, 'Relabel wire')} testId="insp-wire-label" />
        <dl className="facts">
          <dt>From</dt>
          <dd>{from?.label ?? keyOf(w.from)}</dd>
          <dt>To</dt>
          <dd>{to?.label ?? keyOf(w.to)}</dd>
        </dl>
        {net && <TextField label={`Net (${net.type})`} value={net.name} onCommit={(name) => name.trim() && setNet({ ...net, name: name.trim() })} testId="insp-net-name" />}
        <label className="field">
          <span className="field-label">Colour</span>
          <select value={w.colour} onChange={(e) => setWire({ ...w, colour: e.target.value }, 'Change colour')} data-testid="insp-wire-colour">
            {[...new Set([w.colour, ...Object.keys(CSS_COLOUR)])].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {tube ? (
          <LengthField label="Tube bore" mm={w.tubeBoreMm ?? 0} units={units} onCommit={(b) => b > 0 && setWire({ ...w, tubeBoreMm: b }, 'Set tube bore')} />
        ) : (
          <>
            <label className="field">
              <span className="field-label">Size</span>
              <select
                value={w.sizeAuto ? 'auto' : String(w.sizeMm2)}
                onChange={(e) => (e.target.value === 'auto' ? setWire({ ...w, sizeAuto: true }, 'Size wire automatically') : setWire({ ...w, sizeAuto: false, sizeMm2: Number(e.target.value) }, 'Set wire size'))}
                data-testid="insp-wire-size"
              >
                <option value="auto">Automatic{c?.auto ? `: ${sizeLabel(c.auto.mm2)}` : ''}</option>
                {CHART_SIZES.map((s) => (
                  <option key={s.awg} value={String(s.mm2)}>
                    {sizeLabel(s.mm2)}
                  </option>
                ))}
                {[0.5, 0.75, 1, 1.5, 2.5].map((m) => (
                  <option key={m} value={String(m)}>
                    {sizeLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            {c?.auto && <p className="muted small">{REASON[c.auto.reason]}, from AC 43.13-1B tables 11-9, 11-3 and 11-6.</p>}
          </>
        )}
        <h3 className="sub-head">Run</h3>
        <dl className="facts" data-testid="insp-wire-facts">
          <dt>Length</dt>
          <dd>
            {c?.length ? `${formatLength(c.length.mm, units, units === 'metric' ? 0 : 1)}${c.length.estimated ? ' (straight-line estimate)' : ''}` : '—'}
            {c?.length?.missingOffPanel && <span className="badge badge-warn">off-panel run not set</span>}
          </dd>
          {!tube && (
            <>
              <dt>Current</dt>
              <dd>{c ? `${c.currentA.toFixed(2)} A` : '—'}</dd>
              <dt>Rating</dt>
              <dd>{c?.sizeMm2 ? `${c.ampacityA} A (${doc.settings.wireTempRatingC} °C wire, in a bundle)` : '—'}</dd>
              <dt>Drop</dt>
              <dd>{c ? `${c.dropV.toFixed(3)} V` : '—'}</dd>
              <dt>Protected by</dt>
              <dd>{c?.protector ? `${doc.parts.find((p) => p.id === c.protector!.partId)?.label || c.protector.partId} (${c.protector.ratingA} A ${c.protector.kind})` : 'nothing upstream'}</dd>
            </>
          )}
        </dl>
        <label className="field">
          <span className="field-label">Route</span>
          <select value={w.route ?? ''} onChange={(e) => assignRoute([w.id], e.target.value || null)} data-testid="insp-wire-route">
            <option value="">None (straight-line estimate)</option>
            {doc.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || r.id}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

export function RouteInspector({ doc, r }: { doc: Project; r: Route }) {
  const b = bundles(doc).find((x) => x.route.id === r.id);
  const a = analyse(doc);
  const units = doc.settings.units;
  const depth = r.points[r.points.length - 1]?.z ?? 0;
  return (
    <section className="panel inspector" aria-label="Properties" data-testid="inspector">
      <header className="panel-head">
        <h2>Route</h2>
      </header>
      <div className="pad">
        <TextField label="Name" value={r.label} onCommit={(label) => setRoute({ ...r, label })} testId="insp-route-label" />
        <LengthField label="Depth behind the panel (all points)" mm={depth} units={units} onCommit={(z) => z >= 0 && setRoute({ ...r, points: r.points.map((p) => ({ ...p, z })) }, 'Set route depth')} testId="insp-route-depth" />
        <dl className="facts">
          <dt>Length</dt>
          <dd>{formatLength(routeLength(r), units, 0)}</dd>
          <dt>Carries</dt>
          <dd>{b?.wires.length ?? 0} wires and tubes</dd>
          <dt>Bundle</dt>
          <dd>about Ø{(b?.diameterMm ?? 0).toFixed(1)} mm (estimate)</dd>
        </dl>
        <span className="field-label">Wires and tubes on this route</span>
        <ul className="route-wires" data-testid="route-wires">
          {doc.wires.map((w) => {
            const other = w.route && w.route !== r.id ? doc.routes.find((x) => x.id === w.route) : null;
            const t = a.terms;
            const ends = [t.get(keyOf(w.from))?.label, t.get(keyOf(w.to))?.label].filter(Boolean).join(' → ');
            return (
              <li key={w.id} title={ends}>
                <label>
                  <input type="checkbox" checked={w.route === r.id} onChange={(e) => assignRoute([w.id], e.target.checked ? r.id : null)} data-testid={`route-wire-${w.id}`} />
                  <span className="swatch-wire" style={{ background: cssColour(w.colour) }} /> {w.label}
                  {other && <span className="muted"> ({other.label || 'other route'})</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Tick a wire to put it on this route (it leaves any other). Or select wires with the route and use Arrange › Put selected wires on selected route.</p>
      </div>
    </section>
  );
}

export function OffPanelFields({ doc, partId }: { doc: Project; partId: string }) {
  const pp = doc.parts.find((p) => p.id === partId)!;
  return (
    <NumberField
      label="Loom run beyond the panel exit"
      value={pp.offPanelRunMm ?? 0}
      unit="mm"
      parse={(s) => (s.trim() === '' ? null : Number(s) >= 0 ? Number(s) : null)}
      onCommit={(v) => setPartFields(pp.id, { offPanelRunMm: v }, 'Set off-panel run')}
      testId="insp-offpanel-run"
    />
  );
}
