import { useMemo, useState } from 'react';
import { CATALOGUE, findPart } from '../catalogue';
import type { CataloguePart, PlacedPart } from '../model/schema';
import { docs, useDoc } from '../store/app';
import { ops } from '../store/doc';
import { ui, useUi, type Layer } from '../store/ui';
import { Icon } from './icons';

const FAV_KEY = 'gpd.favourites';

function loadFavs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function iconFor(p: CataloguePart): string {
  if (p.category === 'switch') return 'switch';
  if (p.category === 'fuse' || p.category === 'breaker') return 'fuse';
  if (p.category === 'mount') return 'mount';
  if (p.category === 'placard') return 'placard';
  const c = p.front.cutouts[0];
  return c?.kind === 'circle' ? 'round' : 'rect';
}

export function Library() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [favs, setFavs] = useState(loadFavs);
  const placing = useUi((s) => s.placing);
  const tool = useUi((s) => s.tool);
  const customParts = useDoc().customParts;

  const all = useMemo(() => [...CATALOGUE, ...customParts], [customParts]);
  const categories = useMemo(() => ['all', 'favourites', ...new Set(all.map((p) => p.category))], [all]);
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (p) =>
      (category === 'all' || (category === 'favourites' ? favs.includes(p.id) : p.category === category)) &&
      (!q || `${p.maker} ${p.model} ${p.category} ${p.description ?? ''}`.toLowerCase().includes(q)),
  );

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      /* favourites are a convenience; ignore storage failures */
    }
  };

  return (
    <section className="panel library" aria-label="Parts library">
      <header className="panel-head">
        <h2>Parts</h2>
        <span className="count">{shown.length}</span>
      </header>
      <div className="library-filters">
        <label className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search parts" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="library-search" />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c[0]!.toUpperCase() + c.slice(1).replace('-', ' ')}
            </option>
          ))}
        </select>
      </div>
      <ul className="library-list">
        {shown.map((p) => {
          const active = tool === 'place' && placing?.id === p.id;
          return (
            <li
              key={`${p.id}@${p.version}`}
              className={`library-item${active ? ' is-active' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-gpd-part', JSON.stringify({ id: p.id, version: p.version }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() =>
                ui.set({
                  tool: 'place',
                  placing: { id: p.id, version: p.version },
                  message: p.offPanel ? `Click where the ${p.model.toLowerCase()}’s wiring leaves the panel (best in the rear view). Esc to finish.` : `Click to place ${p.model}. Esc to finish.`,
                })
              }
              title={p.description}
              data-testid={`lib-${p.id}`}
            >
              <span className="lib-icon">
                <Icon name={iconFor(p)} />
              </span>
              <span className="lib-text">
                <span className="lib-model">{p.model}</span>
                <span className="lib-maker">
                  {p.maker}
                  {p.offPanel && <span className="badge">off panel</span>}
                  {p.review !== 'verified' && <span className="badge badge-warn">unverified</span>}
                </span>
              </span>
              <button
                className={`icon-btn fav${favs.includes(p.id) ? ' is-on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFav(p.id);
                }}
                aria-label={favs.includes(p.id) ? 'Remove from favourites' : 'Add to favourites'}
              >
                <Icon name="star" size={14} />
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="empty">No parts match “{query}”.</li>}
      </ul>
    </section>
  );
}

const LAYER_LABELS: [Layer, string][] = [
  ['template', 'Panel template'],
  ['cutouts', 'Cutouts'],
  ['bezels', 'Bezels'],
  ['holes', 'Screw holes'],
  ['keepouts', 'Keep-outs'],
  ['labels', 'Labels and text'],
  ['dimensions', 'Dimensions'],
  ['guides', 'Guides'],
  ['grid', 'Grid'],
];

/** Parts with each mounted part listed under its parent, and its nesting level. */
function treeOrder(parts: PlacedPart[]): [PlacedPart, number][] {
  const ids = new Set(parts.map((p) => p.id));
  const children = new Map<string, PlacedPart[]>();
  for (const p of parts) {
    if (p.mountedTo && ids.has(p.mountedTo.parent)) children.set(p.mountedTo.parent, [...(children.get(p.mountedTo.parent) ?? []), p]);
  }
  const out: [PlacedPart, number][] = [];
  const seen = new Set<string>();
  const visit = (p: PlacedPart, level: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push([p, level]);
    for (const c of children.get(p.id) ?? []) visit(c, level + 1);
  };
  for (const p of parts) if (!p.mountedTo || !ids.has(p.mountedTo.parent)) visit(p, 0);
  for (const p of parts) visit(p, 0); // anything left in a mounting loop
  return out;
}

export function ObjectsTree() {
  const doc = useDoc();
  const selection = useUi((s) => s.selection);
  const layers = useUi((s) => s.layers);
  const sel = new Set(selection);

  const select = (id: string, e: React.MouseEvent) => {
    const cur = ui.state.selection;
    if (e.ctrlKey || e.metaKey) ui.set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    else if (e.shiftKey) ui.set({ selection: [...new Set([...cur, id])] });
    else ui.set({ selection: [id] });
  };

  const toggleLock = (id: string) => {
    const pp = docs.doc.parts.find((p) => p.id === id);
    if (pp) docs.dispatch(pp.locked ? 'Unlock' : 'Lock', [ops.replace('parts', { ...pp, locked: !pp.locked })]);
  };

  return (
    <section className="panel objects" aria-label="Objects and layers">
      <header className="panel-head">
        <h2>Objects</h2>
        <span className="count">{doc.parts.length + doc.keepOuts.length + doc.texts.length + doc.dimensions.length}</span>
      </header>
      <ul className="tree">
        {treeOrder(doc.parts).map(([pp, level]) => {
          const part = findPart(pp.part, doc.customParts);
          return (
            <li
              key={pp.id}
              className={`tree-item${sel.has(pp.id) ? ' is-selected' : ''}${level ? ' is-child' : ''}`}
              style={level ? { paddingLeft: 8 + 14 * level } : undefined}
              title={level ? 'Mounted to the part above' : undefined}
              data-testid={`tree-${pp.id}`}
              onClick={(e) => select(pp.id, e)}
            >
              <span className="tree-label">{pp.label || part?.model || pp.part.id}</span>
              <span className="tree-meta">{pp.label && part ? part.model : ''}</span>
              <button
                className={`icon-btn${pp.locked ? ' is-on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLock(pp.id);
                }}
                aria-label={pp.locked ? 'Unlock' : 'Lock'}
                title={pp.locked ? 'Unlock' : 'Lock'}
              >
                <Icon name={pp.locked ? 'lock' : 'unlock'} size={14} />
              </button>
            </li>
          );
        })}
        {doc.keepOuts.map((k) => (
          <li key={k.id} className={`tree-item is-keepout${sel.has(k.id) ? ' is-selected' : ''}`} onClick={(e) => select(k.id, e)}>
            <span className="tree-label">{k.label}</span>
            <span className="tree-meta">keep-out</span>
          </li>
        ))}
        {doc.texts.map((t) => (
          <li key={t.id} className={`tree-item is-text${sel.has(t.id) ? ' is-selected' : ''}`} onClick={(e) => select(t.id, e)} data-testid={`tree-${t.id}`}>
            <span className="tree-label">{t.text || '(empty text)'}</span>
            <span className="tree-meta">{t.layer === 'engrave' ? 'engraved text' : 'printed text'}</span>
          </li>
        ))}
        {doc.dimensions.map((d) => (
          <li key={d.id} className={`tree-item is-dimension${sel.has(d.id) ? ' is-selected' : ''}`} onClick={(e) => select(d.id, e)} data-testid={`tree-${d.id}`}>
            <span className="tree-label">Dimension</span>
            <span className="tree-meta">{d.kind}</span>
          </li>
        ))}
      </ul>
      <header className="panel-head sub">
        <h2>Layers</h2>
      </header>
      <ul className="layers">
        {LAYER_LABELS.map(([key, label]) => (
          <li key={key}>
            <label>
              <input type="checkbox" checked={layers[key]} onChange={() => ui.set({ layers: { ...layers, [key]: !layers[key] } })} />
              {label}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
