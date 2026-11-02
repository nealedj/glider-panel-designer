/**
 * Wiring in the rear view: routes drawn as bundles at their estimated diameter, wires along
 * their paths, pins and ports to click with the wire tool, and the exit points of off-panel
 * parts. Paths are drawn with rounded corners. A selected wire or route shows handles to shape
 * it (ADR 0017). Drawn in screen space so lines stay crisp; hit testing helpers for the canvas.
 */
import { memo } from 'react';
import { distanceToSegment } from '../../geom/shapes';
import { smoothPath } from '../../geom/smooth';
import { toScreen, type Viewport } from '../../editor/viewport';
import type { Project } from '../../model/schema';
import type { Analysis } from '../circuit';
import { bundles } from '../bundles';
import { cssColour } from '../nets';
import { handlesOf, type Control, type Handle } from '../guides';
import { keyOf, type TerminalInfo, type Vec3 } from '../terminals';

const plan = (vp: Viewport, p: { x: number; y: number }) => toScreen(vp, p);

/** Pins of one connector share its position; on screen they are fanned out in a row, 10 px apart. */
const FAN_PX = 10;
export function terminalScreen(vp: Viewport, t: TerminalInfo): { x: number; y: number } {
  const q = plan(vp, t.pos);
  if (t.placed || !t.connector || t.connector.pins.length < 2) return q;
  const i = t.connector.pins.findIndex((p) => p.number === t.pin!.number);
  return { x: q.x + (i - (t.connector.pins.length - 1) / 2) * FAN_PX, y: q.y };
}

/** A path with rounded corners, in screen space. */
const smoothScreen = (vp: Viewport, pts: Vec3[]) => smoothPath(pts).map((p) => plan(vp, p));

/** A wire's path in plan, screen space; `override` is its control points while being shaped. */
function wirePath(vp: Viewport, a: Analysis, id: string, override?: Vec3[]): { x: number; y: number }[] {
  const c = a.wires.get(id);
  if (!c?.length) return [];
  const pts = smoothScreen(vp, override ?? c.length.path);
  // Start and end at the pin's dot, which is fanned out from the connector's centre.
  const ta = a.terms.get(keyOf(c.wire.from));
  const tb = a.terms.get(keyOf(c.wire.to));
  if (ta && !ta.offPanel) pts[0] = terminalScreen(vp, ta);
  if (tb && !tb.offPanel) pts[pts.length - 1] = terminalScreen(vp, tb);
  return pts;
}

export interface RearHit {
  kind: 'terminal' | 'wire' | 'route' | 'exit';
  id: string;
}

/** What is under a screen point: exit markers, then terminals (with the wire tool), wires, routes. */
export function hitWiring(vp: Viewport, doc: Project, a: Analysis, s: { x: number; y: number }, wireTool: boolean): RearHit | null {
  for (const pp of doc.parts) {
    const t = [...a.terms.values()].find((x) => x.partId === pp.id && x.offPanel);
    if (!t) continue;
    const q = plan(vp, pp);
    if (Math.hypot(q.x - s.x, q.y - s.y) <= 9) {
      if (wireTool) {
        // With the wire tool, an exit point picks the nearest of its part's terminals by order.
        const ts = [...a.terms.values()].filter((x) => x.partId === pp.id);
        if (ts.length === 1) return { kind: 'terminal', id: ts[0]!.key };
      }
      return { kind: 'exit', id: pp.id };
    }
  }
  if (wireTool) {
    let best: { key: string; d: number } | null = null;
    for (const t of a.terms.values()) {
      if (t.offPanel) continue;
      const q = terminalScreen(vp, t);
      const d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d <= 6 && (!best || d < best.d)) best = { key: t.key, d };
    }
    if (best) return { kind: 'terminal', id: best.key };
  }
  for (const w of doc.wires) {
    const pts = wirePath(vp, a, w.id);
    for (let i = 1; i < pts.length; i++) if (distanceToSegment(s, pts[i - 1]!, pts[i]!) <= 4) return { kind: 'wire', id: w.id };
  }
  for (const b of bundles(doc)) {
    const pts = smoothScreen(vp, b.route.points);
    const tol = Math.max(5, (b.diameterMm / 2) * vp.zoom);
    for (let i = 1; i < pts.length; i++) if (distanceToSegment(s, pts[i - 1]!, pts[i]!) <= tol) return { kind: 'route', id: b.route.id };
  }
  return null;
}

/** The handle of the shaped wire or route under a screen point, points before leg middles. */
export function hitHandle(vp: Viewport, c: Control, s: { x: number; y: number }): Handle | null {
  let best: { h: Handle; d: number } | null = null;
  for (const h of handlesOf(c)) {
    const q = plan(vp, h.at);
    const d = Math.hypot(q.x - s.x, q.y - s.y) + (h.insert ? 0.5 : 0);
    if (d <= 7 && (!best || d < best.d)) best = { h, d };
  }
  return best?.h ?? null;
}

const pathD = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');

/** Off-panel parts grouped by exit point, so parts sharing an exit stack their labels. */
function exitGroups(doc: Project, a: Analysis): { at: { x: number; y: number }; parts: string[] }[] {
  const groups: { at: { x: number; y: number }; parts: string[] }[] = [];
  for (const pp of doc.parts) {
    if (![...a.terms.values()].some((x) => x.partId === pp.id && x.offPanel)) continue;
    const g = groups.find((x) => Math.hypot(x.at.x - pp.x, x.at.y - pp.y) < 1);
    if (g) g.parts.push(pp.id);
    else groups.push({ at: { x: pp.x, y: pp.y }, parts: [pp.id] });
  }
  return groups;
}

/** Off-panel parts' terminals, fanned out in a row beside the exit point, one row per part. */
function offPanelTerminals(vp: Viewport, doc: Project, a: Analysis): { t: TerminalInfo; at: { x: number; y: number }; row: number }[] {
  const out: { t: TerminalInfo; at: { x: number; y: number }; row: number }[] = [];
  for (const g of exitGroups(doc, a)) {
    const q = plan(vp, g.at);
    g.parts.forEach((id, row) => {
      const ts = [...a.terms.values()].filter((x) => x.partId === id && x.offPanel);
      ts.forEach((t, i) => out.push({ t, row, at: { x: q.x - 14 - i * 12, y: q.y + row * 16 } }));
    });
  }
  return out;
}

/** The terminal under a point among fanned-out off-panel terminals. */
export function hitOffPanelTerminal(vp: Viewport, doc: Project, a: Analysis, s: { x: number; y: number }): string | null {
  for (const { t, at } of offPanelTerminals(vp, doc, a)) if (Math.hypot(at.x - s.x, at.y - s.y) <= 6) return t.key;
  return null;
}

interface Props {
  vp: Viewport;
  doc: Project;
  a: Analysis;
  selection: Set<string>;
  hover: string | null;
  wireTool: boolean;
  wireStart: string | null;
  showTerminals: boolean;
  /** The selected wire or route that can be shaped, with its handles. */
  edit: Control | null;
  /** Its control points while a handle is being dragged. */
  preview: Vec3[] | null;
}

export const RearWiring = memo(function RearWiring({ vp, doc, a, selection, hover, wireTool, wireStart, showTerminals, edit, preview }: Props) {
  const bs = bundles(doc);
  const shaping = edit && preview ? { ...edit, points: preview } : edit;
  const over = (kind: 'wire' | 'route', id: string) => (shaping && preview && shaping.target.kind === kind && shaping.target.id === id ? preview : undefined);
  return (
    <g className="rear-wiring">
      {bs.map((b) => {
        const control = over('route', b.route.id) ?? b.route.points;
        const d = pathD(smoothScreen(vp, control));
        return (
          <g key={b.route.id} className={`route${selection.has(b.route.id) ? ' is-selected' : ''}${hover === b.route.id ? ' is-hovered' : ''}`} data-route={b.route.id}>
            <path className="bundle" d={d} style={{ strokeWidth: Math.max(4, b.diameterMm * vp.zoom) }} />
            <path className="spine" d={d} />
            {control.map((p, i) => {
              const q = plan(vp, p);
              return <circle key={i} cx={q.x} cy={q.y} r={2.5} className="route-pt" />;
            })}
          </g>
        );
      })}
      {doc.wires.map((w) => {
        const pts = wirePath(vp, a, w.id, over('wire', w.id));
        if (pts.length < 2) return null;
        const d = pathD(pts);
        const tube = !!w.tubeBoreMm;
        return (
          <path
            key={w.id}
            className={`wire${tube ? ' is-tube' : ''}${selection.has(w.id) ? ' is-selected' : ''}${hover === w.id ? ' is-hovered' : ''}`}
            d={d}
            style={{ stroke: cssColour(w.colour) }}
            data-wire={w.id}
          />
        );
      })}
      {shaping && !wireTool && (
        <g className="guide-handles" data-guide={shaping.target.id}>
          <path className="guide-control" d={pathD(shaping.points.map((p) => plan(vp, p)))} />
          {handlesOf(shaping).map((h) => {
            const q = plan(vp, h.at);
            return h.insert ? (
              <g key={`i${h.index}`} className="guide-insert" data-handle={`insert-${h.index}`} transform={`translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`}>
                <circle r={4.5} />
                <path d="M-2.5 0H2.5M0 -2.5V2.5" />
                <title>Drag to add a bend here</title>
              </g>
            ) : (
              <rect key={`p${h.index}`} className="guide-point" data-handle={`point-${h.index}`} x={q.x - 4} y={q.y - 4} width={8} height={8}>
                <title>Drag to move; double-click to remove</title>
              </rect>
            );
          })}
        </g>
      )}
      {(showTerminals || wireTool) &&
        [...a.terms.values()]
          .filter((t) => !t.offPanel)
          .map((t) => {
            const q = terminalScreen(vp, t);
            const cls = `terminal ${t.kind === 'port' ? `port-${t.port!.kind}` : `sig-${t.pin!.signal}`}${wireStart === t.key ? ' is-start' : ''}`;
            return t.kind === 'port' ? (
              <rect key={t.key} className={cls} x={q.x - 3.5} y={q.y - 3.5} width={7} height={7} data-terminal={t.key}>
                <title>{t.label}</title>
              </rect>
            ) : (
              <g key={t.key}>
                <circle className={cls} cx={q.x} cy={q.y} r={3.5} data-terminal={t.key}>
                  <title>{t.label}</title>
                </circle>
                {wireTool && vp.zoom >= 2 && (
                  <text className="terminal-label" x={q.x} y={q.y + 11} textAnchor="middle">
                    {t.pin!.number}
                  </text>
                )}
              </g>
            );
          })}
      {exitGroups(doc, a).map((g) => {
        const q = plan(vp, g.at);
        return (
          <g key={g.parts.join()} className={`exit${g.parts.some((id) => selection.has(id)) ? ' is-selected' : ''}`} data-exit={g.parts[0]}>
            <circle cx={q.x} cy={q.y} r={7} />
            <path d={`M${q.x - 4} ${q.y + 4}L${q.x + 4} ${q.y - 4}M${q.x} ${q.y - 4}H${q.x + 4}V${q.y}`} />
            {g.parts.map((id, row) => {
              const pp = doc.parts.find((p) => p.id === id)!;
              return (
                <text key={id} x={q.x + 12} y={q.y + 4 + row * 16} className={selection.has(id) ? 'is-selected' : ''}>
                  {pp.label || id}
                  {pp.offPanelRunMm != null ? ` · ${pp.offPanelRunMm} mm` : ' · run not set'}
                </text>
              );
            })}
          </g>
        );
      })}
      {(showTerminals || wireTool) &&
        offPanelTerminals(vp, doc, a).map(({ t, at }) => (
          <g key={t.key} className={`terminal-fan${wireStart === t.key ? ' is-start' : ''}`}>
            <circle className={`terminal ${t.kind === 'port' ? `port-${t.port!.kind}` : `sig-${t.pin!.signal}`}`} cx={at.x} cy={at.y} r={4.5} data-terminal={t.key}>
              <title>{t.label}</title>
            </circle>
          </g>
        ))}
    </g>
  );
});
