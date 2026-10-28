/**
 * The Review tab: go through the discovery tools' candidate values product by product,
 * accept or reject each against its source snippet and the rendered manual pages, type in
 * values read from drawings, and export the reviewed set for the catalogue.
 */
import { useEffect, useMemo, useState } from 'react';
import { holePath, shapePath, shapeBox, unionBox } from '../geom/shapes';
import type { CandidateProduct, CandidateSource, CandidateValue, CandidatesFile } from '../model/candidates';
import { PartCategory, type CataloguePart } from '../model/schema';
import { Icon } from '../ui/icons';
import { downloadFile } from '../util/download';
import { buildBundle, buildPart, FIELD_ORDER, isRetailerUrl, isReviewed, pathsOf, progress, retailerHosts, type FieldDecision, type ProductReview } from './build';
import { accept, markDone, openCandidates, reject, restoreReview, select, setFilter, setIdentity, setManual, setQuery, undecide, useReview } from './store';

// ---------------------------------------------------------------- formatting

function fmtShape(v: unknown): string {
  const o = v as { kind?: string; d?: number; w?: number; h?: number; r?: number };
  if (o?.kind === 'circle') return `Ø${o.d} mm`;
  if (o?.kind === 'rect') return `${o.w} × ${o.h} mm${o.r ? `, corners r${o.r}` : ''}`;
  return JSON.stringify(v);
}

export function fmtValue(path: string, v: unknown, unit?: string): string {
  switch (path) {
    case 'front.cutout':
    case 'front.bezel':
    case 'rear.body':
      return fmtShape(v);
    case 'front.screwHoles': {
      const o = v as { spacing: number; d: number };
      return `4 × Ø${o.d} mm on a ${o.spacing} mm square`;
    }
    case 'power.currentA':
      return `${Math.round((v as number) * 1000)} mA`;
    case 'power.supplyV': {
      const o = v as { min: number; max: number };
      return `${o.min}–${o.max} V`;
    }
    case 'connectors.types':
      return (v as string[]).join(', ');
    case 'connectors.pinout': {
      const o = v as { name?: string | null; pins: unknown[] };
      return `${o.name ?? 'Unnamed connector'}: ${o.pins.length} pins`;
    }
    case 'datasheet':
      return String(v);
    default:
      return `${v}${unit ? ` ${unit}` : ''}`;
  }
}

/** The snippet with the figures of the value highlighted. */
function Snippet({ text, value }: { text: string; value: unknown }) {
  const nums = new Set<string>();
  const walk = (x: unknown) => {
    if (typeof x === 'number') {
      nums.add(String(x));
      if (x < 1) nums.add(String(Math.round(x * 1000)));
    } else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(value);
  const parts = text.split(/(\d+(?:[.,]\d+)?)/g);
  return (
    <blockquote className="snippet">
      {parts.map((p, i) => (nums.has(p.replace(',', '.')) || nums.has(String(Number(p.replace(',', '.')))) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </blockquote>
  );
}

function sourceLabel(s: CandidateSource | undefined, page?: number): string {
  if (!s) return 'unknown source';
  if (s.kind === 'retailer') return 'Shop page (stays local)';
  const where = s.kind === 'manual' ? (s.makerHosted ? 'Maker manual' : 'Manual, not on the maker’s site') : s.kind === 'maker-page' ? 'Maker web page' : 'Entered';
  return `${where}${page ? ` · page ${page}` : ''}`;
}

// ---------------------------------------------------------------- left: products

export function ReviewLeft() {
  const file = useReview((s) => s.file);
  const reviews = useReview((s) => s.reviews);
  const selected = useReview((s) => s.selected);
  const filter = useReview((s) => s.filter);
  const query = useReview((s) => s.query);
  useEffect(() => void restoreReview(), []);
  const list = useMemo(() => {
    if (!file) return [];
    const q = query.toLowerCase();
    return file.products.filter((p) => {
      if (q && !`${p.maker} ${p.model} ${p.name}`.toLowerCase().includes(q)) return false;
      const done = isReviewed(p, reviews[p.key]);
      return filter === 'all' || (filter === 'reference' && p.reference) || (filter === 'todo' && !done) || (filter === 'done' && done);
    });
  }, [file, reviews, filter, query]);
  const done = file ? file.products.filter((p) => isReviewed(p, reviews[p.key])).length : 0;
  const g = file ? file.products.filter((p) => p.reference) : [];
  const gDone = g.filter((p) => isReviewed(p, reviews[p.key])).length;
  return (
    <section className="panel review-list" aria-label="Products to review">
      <header className="panel-head">
        <h2>Review</h2>
        <label className="btn small primary file-btn">
          Open…
          <input
            type="file"
            accept=".json,application/json"
            data-testid="review-open"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openCandidates(f, f.name);
              e.target.value = '';
            }}
          />
        </label>
      </header>
      {file ? (
        <>
          <div className="review-summary" data-testid="review-summary">
            <span>
              <strong>{done}</strong> of {file.products.length} reviewed
            </span>
            {g.length > 0 && (
              <span>
                Reference panel <strong>{gDone}</strong>/{g.length}
              </span>
            )}
          </div>
          <div className="pad-x">
            <input className="review-search" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="seg small">
              {(['all', 'reference', 'todo', 'done'] as const).map((f) => (
                <button key={f} className={`seg-btn${filter === f ? ' is-active' : ''}`} onClick={() => setFilter(f)}>
                  {{ all: 'All', reference: 'Reference panel', todo: 'To do', done: 'Done' }[f]}
                </button>
              ))}
            </div>
          </div>
          <ul className="tree review-products">
            {list.map((p) => {
              const pr = progress(p, reviews[p.key]);
              const ok = isReviewed(p, reviews[p.key]);
              return (
                <li key={p.key} className={`tree-item${selected === p.key ? ' is-selected' : ''}`} onClick={() => select(p.key)} data-testid={`review-p-${p.key}`}>
                  <span className="tree-label">
                    {p.maker} {p.model}
                    {p.variant ? ` (${p.variant})` : ''}
                  </span>
                  {p.reference && <span className="badge">reference panel</span>}
                  <span className={`review-progress${ok ? ' is-done' : ''}`}>{ok ? '✓' : `${pr.done}/${pr.total}`}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="pad muted small">
          Open a candidates file made by the discovery tools: <code>cd tools && .venv/bin/python -m discover run</code> writes <code>cache/review/candidates.json</code>.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- centre: one product

export function ReviewCentre() {
  const file = useReview((s) => s.file);
  const selected = useReview((s) => s.selected);
  const reviews = useReview((s) => s.reviews);
  const message = useReview((s) => s.message);
  const [zoom, setZoom] = useState<string | null>(null);
  const p = file?.products.find((x) => x.key === selected);
  if (!file || !p) {
    return (
      <div className="review-centre">
        <div className="tpl-empty">{message || 'Open a candidates file to start reviewing.'}</div>
      </div>
    );
  }
  const r = reviews[p.key] ?? { fields: {} };
  const sources = new Map(file.sources.map((s) => [s.id, s]));
  const paths = pathsOf(p);
  // Fields with no candidates can still be entered from the drawings.
  const enterable = FIELD_ORDER.filter((f) => f.exported && !paths.includes(f.path) && f.path !== 'connectors.pinout' && f.path !== 'datasheet');
  return (
    <div className="review-centre" data-testid="review-product">
      <div className="review-head">
        <div>
          <h2>
            {p.maker} {p.model}
            {p.variant ? ` (${p.variant})` : ''}
          </h2>
          <p className="muted small">
            {p.name} · key <code>{p.key}</code>
            {p.retail && (
              <>
                {' '}
                · shop price {p.retail.price ?? '?'} {p.retail.currency ?? ''} (local only)
              </>
            )}
          </p>
        </div>
        <IdentityEditor p={p} r={r} />
      </div>
      {message && <p className="note tpl-message">{message}</p>}
      {p.variantNote && (
        <p className="note" data-testid="review-variant-note">
          {p.variantNote}
        </p>
      )}
      {paths.map((path) => (
        <FieldCard key={path} file={file} p={p} path={path} d={r.fields[path]} sources={sources} />
      ))}
      {enterable.length > 0 && (
        <details className="review-enter">
          <summary>Enter a value from the drawings ({enterable.map((f) => f.label.toLowerCase()).join(', ')})</summary>
          {enterable.map((f) => (
            <FieldCard key={f.path} file={file} p={p} path={f.path} d={r.fields[f.path]} sources={sources} empty />
          ))}
        </details>
      )}
      {p.drawings.length > 0 && (
        <>
          <h3 className="sub-head">Manual pages</h3>
          <div className="drawings">
            {p.drawings.map((d, i) => (
              <figure key={i} onClick={() => setZoom(d.image)} data-testid="review-drawing">
                <img src={d.image} alt={`${d.kind}, page ${d.page}`} />
                <figcaption>
                  {sources.get(d.source)?.title ?? 'Manual'} · page {d.page} · {d.kind}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
      {zoom && (
        <div className="overlay" onMouseDown={() => setZoom(null)}>
          <div className="drawing-zoom" onMouseDown={(e) => e.stopPropagation()}>
            <img src={zoom} alt="Manual page" />
            <button className="btn ghost small" onClick={() => setZoom(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IdentityEditor({ p, r }: { p: CandidateProduct; r: ProductReview }) {
  return (
    <div className="identity">
      <label>
        Maker <input defaultValue={r.maker ?? p.maker} onBlur={(e) => e.target.value !== (r.maker ?? p.maker) && setIdentity(p.key, { maker: e.target.value.trim() })} />
      </label>
      <label>
        Model <input defaultValue={r.model ?? p.model} onBlur={(e) => e.target.value !== (r.model ?? p.model) && setIdentity(p.key, { model: e.target.value.trim() })} />
      </label>
      <label>
        Category
        <select value={(r.category ?? p.category) || 'other'} onChange={(e) => setIdentity(p.key, { category: e.target.value as CataloguePart['category'] })}>
          {PartCategory.options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function FieldCard({ file, p, path, d, sources, empty }: { file: CandidatesFile; p: CandidateProduct; path: string; d: FieldDecision | undefined; sources: Map<string, CandidateSource>; empty?: boolean }) {
  const def = FIELD_ORDER.find((f) => f.path === path)!;
  const cands = p.candidates.map((c, i) => [c, i] as const).filter(([c]) => c.path === path);
  const hosts = retailerHosts(file);
  const [entering, setEntering] = useState(false);
  const state = d?.manual ? 'manual' : d?.accepted.length ? 'accepted' : cands.length && d && d.rejected.length >= cands.length ? 'rejected' : 'open';
  return (
    <section className={`field-card is-${state}`} data-testid={`review-f-${path}`}>
      <header>
        <h3>{def.label}</h3>
        {!def.exported && <span className="muted small">for reference, not exported</span>}
        <span className="field-state">{state === 'open' ? (empty ? '' : 'to review') : state === 'manual' ? 'entered' : state}</span>
      </header>
      {cands.map(([c, i]) => (
        <CandidateRow key={i} c={c} i={i} p={p} path={path} d={d} multi={!!def.multi} src={sources.get(c.source)} retailer={isRetailerUrl(c.url, hosts)} />
      ))}
      {d?.manual && (
        <div className="cand is-accepted">
          <div className="cand-main">
            <strong className="cand-value">{fmtValue(path, d.manual.value)}</strong>
            <span className="muted small">entered from {sources.get(d.manual.source)?.title ?? 'a source'}{d.manual.page ? `, page ${d.manual.page}` : ''}</span>
            <button className="btn ghost small" onClick={() => setManual(p.key, path, undefined)}>
              Remove
            </button>
          </div>
          <blockquote className="snippet">{d.manual.snippet}</blockquote>
        </div>
      )}
      {def.exported && path !== 'connectors.pinout' && (
        entering ? (
          <ManualForm p={p} path={path} sources={sources} onDone={() => setEntering(false)} />
        ) : (
          <button className="link-btn small" onClick={() => setEntering(true)} data-testid={`review-enter-${path}`}>
            {cands.length ? 'None is right: enter the value from the source' : 'Enter from a manual page'}
          </button>
        )
      )}
    </section>
  );
}

function CandidateRow({ c, i, p, path, d, multi, src, retailer }: { c: CandidateValue; i: number; p: CandidateProduct; path: string; d: FieldDecision | undefined; multi: boolean; src: CandidateSource | undefined; retailer: boolean }) {
  const accepted = d?.accepted.includes(i);
  const rejected = d?.rejected.includes(i);
  const [open, setOpen] = useState(false);
  const pins = path === 'connectors.pinout' ? (c.value as { pins: { number: string; function: string; signal: string; direction?: string }[] }).pins : null;
  return (
    <div className={`cand${accepted ? ' is-accepted' : ''}${rejected ? ' is-rejected' : ''}`} data-testid={`review-c-${i}`}>
      <div className="cand-main">
        <strong className="cand-value">{fmtValue(path, c.value, c.unit)}</strong>
        <span className={`conf conf-${c.confidence >= 0.75 ? 'high' : c.confidence >= 0.45 ? 'mid' : 'low'}`} title="Extraction confidence">
          {Math.round(c.confidence * 100)}%
        </span>
        <a className="src" href={c.url} target="_blank" rel="noreferrer">
          {sourceLabel(src, c.page)}
        </a>
        <span className="cand-actions">
          {accepted || rejected ? (
            <button className="btn ghost small" onClick={() => undecide(p.key, path, i)}>
              Undo
            </button>
          ) : (
            <>
              <button className="btn small primary" onClick={() => accept(p.key, path, i, multi)} data-testid={`review-accept-${i}`}>
                Accept
              </button>
              <button className="btn ghost small" onClick={() => reject(p.key, path, i)} data-testid={`review-reject-${i}`}>
                Reject
              </button>
            </>
          )}
        </span>
      </div>
      <Snippet text={c.snippet} value={c.value} />
      {c.note && (
        <p className={`cand-note${c.confidence < 0.3 ? ' is-warn' : ''}`}>
          <Icon name={c.confidence < 0.3 ? 'warn' : 'info'} size={13} /> {c.note}
        </p>
      )}
      {retailer && accepted && <p className="cand-note is-warn">Only the shop says this: it is kept for your own use but left out of the catalogue export.</p>}
      {pins && (
        <>
          <button className="link-btn small" onClick={() => setOpen(!open)}>
            {open ? 'Hide pins' : 'Show pins'}
          </button>
          {open && (
            <table className="pin-table">
              <tbody>
                {pins.map((pin) => (
                  <tr key={pin.number}>
                    <td className="mono">{pin.number}</td>
                    <td>{pin.function}</td>
                    <td className="muted">{pin.signal}</td>
                    <td className="muted">{pin.direction ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function ManualForm({ p, path, sources, onDone }: { p: CandidateProduct; path: string; sources: Map<string, CandidateSource>; onDone: () => void }) {
  const docs = [...new Set([...p.manuals.map((m) => m.source), ...p.candidates.map((c) => c.source)])].map((id) => sources.get(id)).filter((s): s is CandidateSource => !!s && s.kind !== 'retailer');
  const [src, setSrc] = useState(docs[0]?.id ?? '');
  const [page, setPage] = useState('');
  const [kind, setKind] = useState<'circle' | 'rect'>('circle');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [snippet, setSnippet] = useState('');
  const shape = path === 'front.cutout' || path === 'front.bezel' || path === 'rear.body';
  const value = (): unknown => {
    const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
    if (shape) return kind === 'circle' ? { kind, d: n(a) } : { kind, w: n(a), h: n(b), ...(c ? { r: n(c) } : {}) };
    if (path === 'front.screwHoles') return { spacing: n(a), d: n(b) };
    if (path === 'power.currentA') return n(a) / 1000;
    if (path === 'datasheet') return a.trim();
    return n(a);
  };
  const ok = () => {
    const v = value();
    const nums: number[] = [];
    const walk = (x: unknown) => (typeof x === 'number' ? nums.push(x) : x && typeof x === 'object' && Object.values(x).forEach(walk));
    walk(v);
    return src && snippet.trim().length >= 6 && nums.every((x) => Number.isFinite(x) && x > 0);
  };
  if (!docs.length) return <p className="muted small">No maker document for this product yet; values need a source.</p>;
  return (
    <div className="manual-form" data-testid={`review-form-${path}`}>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Source</span>
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title ?? d.url}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Page</span>
          <input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      {shape && (
        <div className="seg small">
          {(['circle', 'rect'] as const).map((k) => (
            <button key={k} className={`seg-btn${kind === k ? ' is-active' : ''}`} onClick={() => setKind(k)}>
              {k === 'circle' ? 'Round' : 'Rectangular'}
            </button>
          ))}
        </div>
      )}
      <div className="field-row three">
        <label className="field">
          <span className="field-label">{shape ? (kind === 'circle' ? 'Diameter mm' : 'Width mm') : path === 'front.screwHoles' ? 'Square side mm' : path === 'power.currentA' ? 'Current mA' : path === 'weightG' ? 'Weight g' : path === 'power.voltage' ? 'Volts' : path === 'datasheet' ? 'URL' : 'mm'}</span>
          <input value={a} onChange={(e) => setA(e.target.value)} data-testid="review-form-a" />
        </label>
        {((shape && kind === 'rect') || path === 'front.screwHoles') && (
          <label className="field">
            <span className="field-label">{path === 'front.screwHoles' ? 'Hole Ø mm' : 'Height mm'}</span>
            <input value={b} onChange={(e) => setB(e.target.value)} data-testid="review-form-b" />
          </label>
        )}
        {shape && kind === 'rect' && (
          <label className="field">
            <span className="field-label">Corner r mm</span>
            <input value={c} onChange={(e) => setC(e.target.value)} />
          </label>
        )}
      </div>
      <label className="field">
        <span className="field-label">What you read it from (quoted or described)</span>
        <input value={snippet} onChange={(e) => setSnippet(e.target.value)} placeholder="Drawing on page 12: panel cut-out Ø57, 4 × M4 on 47 mm" data-testid="review-form-snippet" />
      </label>
      <div className="row-actions">
        <button
          className="btn primary small"
          disabled={!ok()}
          data-testid="review-form-save"
          onClick={() => {
            setManual(p.key, path, { value: value(), source: src, page: page ? Number(page) : undefined, snippet: snippet.trim() });
            onDone();
          }}
        >
          Use this value
        </button>
        <button className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- right: preview and export

export function ReviewRight() {
  const file = useReview((s) => s.file);
  const selected = useReview((s) => s.selected);
  const reviews = useReview((s) => s.reviews);
  const p = file?.products.find((x) => x.key === selected);
  const r = p ? (reviews[p.key] ?? { fields: {} }) : null;
  const built = file && p && r ? buildPart(file, p, r) : null;
  const reviewedCount = file ? file.products.filter((x) => isReviewed(x, reviews[x.key])).length : 0;
  const exportAll = () => {
    if (!file) return;
    const bundle = buildBundle(file, reviews);
    downloadFile({ name: `reviewed-parts-${new Date().toISOString().slice(0, 10)}.json`, mime: 'application/json', data: JSON.stringify(bundle, null, 2) + '\n' });
  };
  return (
    <section className="panel inspector" aria-label="Catalogue preview" data-testid="review-preview">
      <header className="panel-head">
        <h2>Catalogue entry</h2>
      </header>
      <div className="pad">
        {built && p && r ? (
          <>
            <PartSketch part={built.part} />
            <dl className="facts">
              <dt>Id</dt>
              <dd className="mono small">{built.part.id}</dd>
              <dt>Cut-out</dt>
              <dd>{built.part.front.cutouts[0] ? fmtShape(built.part.front.cutouts[0]) : '—'}</dd>
              <dt>Bezel</dt>
              <dd>{built.part.front.bezel ? fmtShape(built.part.front.bezel) : '—'}</dd>
              <dt>Screws</dt>
              <dd>{built.part.front.screwHoles.length ? `${built.part.front.screwHoles.length} × Ø${built.part.front.screwHoles[0]!.d}` : '—'}</dd>
              <dt>Depth</dt>
              <dd>{built.part.rear.depth ?? '—'}</dd>
              <dt>Weight</dt>
              <dd>{built.part.weightG ?? '—'}</dd>
              <dt>Current</dt>
              <dd>{built.part.power?.currentA != null ? `${Math.round(built.part.power.currentA * 1000)} mA${built.part.power.voltage ? ` at ${built.part.power.voltage} V` : ''}` : '—'}</dd>
              <dt>Connectors</dt>
              <dd>{built.part.connectors.map((c) => `${c.type} (${c.pins.length})`).join(', ') || '—'}</dd>
            </dl>
            {built.excluded.length > 0 && (
              <div className="note warn block">
                <p>Left out of the catalogue export:</p>
                <ul>
                  {built.excluded.map((e) => (
                    <li key={e.path}>
                      {FIELD_ORDER.find((f) => f.path === e.path)?.label ?? e.path}: {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="check-field">
              <input type="checkbox" checked={isReviewed(p, r)} onChange={(e) => markDone(p.key, e.target.checked)} data-testid="review-done" />
              Reviewed: every value here is checked against its source
            </label>
          </>
        ) : (
          <p className="muted small">Select a product.</p>
        )}
        <h3 className="sub-head">Export</h3>
        <p className="small">
          {reviewedCount} reviewed product{reviewedCount === 1 ? '' : 's'}. Export them, then run <code>python -m discover import-reviewed &lt;file&gt;</code> to add them to <code>catalogue/parts/</code> for a pull request.
        </p>
        <button className="btn primary small" disabled={!reviewedCount} onClick={exportAll} data-testid="review-export">
          Export reviewed parts
        </button>
        <p className="muted small">Only values from the makers’ documents are exported, each with its source and snippet. Prices, shop links and photos never are.</p>
      </div>
    </section>
  );
}

/** A small front-face drawing of the catalogue entry. */
function PartSketch({ part }: { part: CataloguePart }) {
  const shapes = [...part.front.cutouts, ...(part.front.bezel ? [part.front.bezel] : [])];
  const boxes = [...shapes.map(shapeBox), ...part.front.screwHoles.map((h) => ({ minX: h.x - h.d, minY: h.y - h.d, maxX: h.x + h.d, maxY: h.y + h.d }))];
  const b = unionBox(boxes);
  if (!b) return <div className="part-sketch empty">No geometry accepted yet</div>;
  const pad = 6;
  return (
    <svg className="part-sketch" viewBox={`${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`} data-testid="review-sketch">
      <g transform="scale(1 -1)">
        {part.front.bezel && <path className="bezel" d={shapePath(part.front.bezel)} />}
        {part.front.cutouts.map((s, i) => (
          <path key={i} className="cutout" d={shapePath(s)} />
        ))}
        {part.front.screwHoles.map((h, i) => (
          <path key={i} className="hole" d={holePath(h)} />
        ))}
      </g>
    </svg>
  );
}
