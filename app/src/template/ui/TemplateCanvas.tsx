/**
 * The template editor's canvas. In photo mode it shows the photo as taken (for calibration
 * clicks); in plane mode, the straightened photo in template mm (for tracing). Overlays are
 * drawn in screen space so lines stay crisp at any zoom.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { distanceToSegment, flattenPoly, shapeContains } from '../../geom/shapes';
import type { PolyVertex, Shape, Vec2 } from '../../model/schema';
import { toScreen, toWorld, zoomAt, type Viewport } from '../../editor/viewport';
import { draftMap } from '../draft';
import { bulgeThrough, insertVertex } from '../outline';
import { moveSelectedFeature } from '../edit';
import { addFeature, drafts, photo, setDatumAt, snapInstrument, tplUi, useDraft, useTplUi, wandOutline } from '../session';
import type { TplUi } from '../session';

const SNAP_PX = 8;

type Drag =
  | { kind: 'pan'; start: Vec2; centre: Vec2 }
  | { kind: 'vertex'; index: number }
  | { kind: 'mid'; index: number }
  | { kind: 'rect'; a: Vec2; b: Vec2; feature: 'keepout' }
  | { kind: 'move'; start: Vec2; last: Vec2 };

export function TemplateCanvas() {
  const draft = useDraft();
  const mode = useTplUi((s) => s.mode);
  const tool = useTplUi((s) => s.tool);
  const view = useTplUi((s) => (s.mode === 'photo' ? s.photoView : s.planeView));
  const pending = useTplUi((s) => s.pending);
  const crossings = useTplUi((s) => s.crossings);
  const rim = useTplUi((s) => s.rim);
  const selection = useTplUi((s) => s.selection);
  useTplUi((s) => s.rectifiedVersion);
  const busy = useTplUi((s) => s.busy);

  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const space = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(100, r.width), h: Math.max(100, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const vp: Viewport = { w: size.w, h: size.h, zoom: view.zoom, centre: view.centre, mirror: false };
  const map = useMemo(() => (draft ? draftMap(draft) : null), [draft?.calibration, draft?.raisedMm, draft?.frame]);

  // World coordinates: photo mode uses (px, −py); plane mode uses template mm.
  const toW = (p: Vec2): Vec2 => (mode === 'photo' ? { x: p.x, y: -p.y } : p);
  const fromW = (w: Vec2): Vec2 => (mode === 'photo' ? { x: w.x, y: -w.y } : w);
  const scr = (p: Vec2) => toScreen(vp, toW(p));
  /** A template-mm point on screen in either mode. */
  const tplScr = (t: Vec2): Vec2 | null => {
    if (mode === 'plane') return toScreen(vp, t);
    if (!map) return null;
    return scr(map.toImage(t));
  };

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const at = (e: { clientX: number; clientY: number }) => fromW(toWorld(vp, local(e)));

  const setView = (v: { zoom: number; centre: Vec2 }) => tplUi.set(mode === 'photo' ? { photoView: v } : { planeView: v });

  // ---------------------------------------------------------------- snapping (plane mode)

  const snap = (p: Vec2, alt: boolean, skip = -1): { p: Vec2; guides: { axis: 'x' | 'y'; v: number }[] } => {
    if (alt || mode !== 'plane' || !draft) return { p, guides: [] };
    const tol = SNAP_PX / vp.zoom;
    // Outline vertices first: an exact hit beats alignment.
    for (let i = 0; i < draft.outline.length; i++) {
      if (i === skip) continue;
      const v = draft.outline[i]!;
      if (Math.hypot(v.x - p.x, v.y - p.y) <= tol) return { p: { x: v.x, y: v.y }, guides: [{ axis: 'x', v: v.x }, { axis: 'y', v: v.y }] };
    }
    let x = p.x;
    let y = p.y;
    const guides: { axis: 'x' | 'y'; v: number }[] = [];
    const xs = [0, ...draft.outline.filter((_, i) => i !== skip).map((v) => v.x)];
    const ys = [0, ...draft.outline.filter((_, i) => i !== skip).map((v) => v.y)];
    const bx = xs.reduce((b, v) => (Math.abs(v - p.x) < Math.abs(b - p.x) ? v : b), Infinity);
    const by = ys.reduce((b, v) => (Math.abs(v - p.y) < Math.abs(b - p.y) ? v : b), Infinity);
    if (Math.abs(bx - p.x) < tol) {
      x = bx;
      guides.push({ axis: 'x', v: bx });
    }
    if (Math.abs(by - p.y) < tol) {
      y = by;
      guides.push({ axis: 'y', v: by });
    }
    return { p: { x, y }, guides };
  };
  const [guides, setGuides] = useState<{ axis: 'x' | 'y'; v: number }[]>([]);

  // ---------------------------------------------------------------- hit testing (plane mode)

  const outlinePts = draft?.outline ?? [];
  const hitVertex = (s: Vec2): number => {
    for (let i = 0; i < outlinePts.length; i++) {
      const q = tplScr(outlinePts[i]!);
      if (q && Math.hypot(q.x - s.x, q.y - s.y) <= 7) return i;
    }
    return -1;
  };
  const midOf = (i: number): Vec2 => {
    const a = outlinePts[i]!;
    const b = outlinePts[(i + 1) % outlinePts.length]!;
    if (!a.bulge) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Arc midpoint: from the chord midpoint, the sagitta (bulge × chord / 2) to the right.
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const h = (a.bulge * L) / 2;
    return { x: (a.x + b.x) / 2 + ((b.y - a.y) / L) * h, y: (a.y + b.y) / 2 - ((b.x - a.x) / L) * h };
  };
  const hitMid = (s: Vec2): number => {
    if (mode !== 'plane') return -1;
    for (let i = 0; i < outlinePts.length; i++) {
      const q = toScreen(vp, midOf(i));
      if (Math.hypot(q.x - s.x, q.y - s.y) <= 6) return i;
    }
    return -1;
  };
  const hitEdge = (w: Vec2): number => {
    const tol = 6 / vp.zoom;
    for (let i = 0; i < outlinePts.length; i++) {
      const seg = flattenPoly([outlinePts[i]!, outlinePts[(i + 1) % outlinePts.length]!], 0.5);
      const pts = seg.slice(0, seg.length - 1);
      pts.push(outlinePts[(i + 1) % outlinePts.length]!);
      for (let k = 0; k + 1 < pts.length; k++) if (distanceToSegment(w, pts[k]!, pts[k + 1]!) <= tol) return i;
    }
    return -1;
  };
  const hitFeature = (w: Vec2): TplSel | null => {
    if (!draft) return null;
    const tol = 5 / vp.zoom;
    for (let i = draft.checks.length - 1; i >= 0; i--) if (distanceToSegment(w, draft.checks[i]!.a, draft.checks[i]!.b) <= tol) return { kind: 'check', id: draft.checks[i]!.id };
    for (let i = draft.bendLines.length - 1; i >= 0; i--) if (distanceToSegment(w, draft.bendLines[i]!.a, draft.bendLines[i]!.b) <= tol) return { kind: 'bend', id: i };
    for (let i = draft.fixings.length - 1; i >= 0; i--) if (Math.hypot(w.x - draft.fixings[i]!.x, w.y - draft.fixings[i]!.y) <= draft.fixings[i]!.d / 2 + tol) return { kind: 'fixing', id: i };
    for (let i = draft.keepOuts.length - 1; i >= 0; i--) if (shapeContains(draft.keepOuts[i]!.shape, w, tol)) return { kind: 'keepout', id: draft.keepOuts[i]!.id };
    return null;
  };

  // ---------------------------------------------------------------- pointer handling

  const onPointerDown = (e: React.PointerEvent) => {
    const s = local(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      setDrag({ kind: 'pan', start: s, centre: view.centre });
      return;
    }
    if (e.button !== 0 || !draft) return;
    const p = at(e);
    const add = (q: Vec2) => tplUi.set({ pending: [...tplUi.state.pending, q] });
    if (mode === 'photo') {
      switch (tool) {
        case 'grid-seed':
        case 'ref-point':
        case 'scale-line':
          add(p);
          return;
        case 'circle': {
          const pen = tplUi.state.pending;
          if (pen.length === 0) {
            tplUi.set({ pending: [p], rim: null, message: 'Now click on the instrument’s rim' });
            return;
          }
          const snapped = snapInstrument(pen[0]!, p);
          tplUi.set({ pending: [], rim: snapped ? snapped.points : null, message: snapped ? `Rim found (${snapped.points.length} edge points). Enter its diameter in the panel.` : tplUi.state.message });
          return;
        }
        default:
          return;
      }
    }
    // Plane mode.
    const sn = snap(p, e.altKey);
    switch (tool) {
      case 'wand':
        wandOutline(p);
        return;
      case 'outline': {
        const pen = tplUi.state.pending;
        // Click the first point again to close.
        if (pen.length >= 3) {
          const f = toScreen(vp, pen[0]!);
          if (Math.hypot(f.x - s.x, f.y - s.y) < 8) {
            drafts.update((d) => ({ ...d, outline: pen.map((q) => ({ x: q.x, y: q.y })) }));
            tplUi.set({ pending: [], tool: 'select', message: 'Outline closed. Drag the ◆ on an edge to make it an arc.' });
            return;
          }
        }
        add(sn.p);
        return;
      }
      case 'bend':
      case 'check':
      case 'datum': {
        const pen = [...tplUi.state.pending, sn.p];
        if (tool === 'datum' && pen.length === 1 && e.shiftKey) {
          setDatumAt(pen[0]!);
          tplUi.set({ pending: [], message: 'Datum moved' });
          return;
        }
        if (pen.length < 2) return tplUi.set({ pending: pen });
        if (tool === 'bend') {
          addFeature('bend', { a: pen[0]!, b: pen[1]! });
          tplUi.set({ pending: [] });
        } else if (tool === 'datum') {
          // Two clicks along an edge (e.g. the bottom corners): origin halfway, x axis along it.
          const mid = { x: (pen[0]!.x + pen[1]!.x) / 2, y: (pen[0]!.y + pen[1]!.y) / 2 };
          setDatumAt(mid, { a: pen[0]!, b: pen[1]! });
          tplUi.set({ pending: [], tool: 'select', message: 'Datum set: origin halfway between the clicks, x axis along them' });
        } else tplUi.set({ pending: pen, message: 'Enter the length you measured on the real template in the panel' });
        return;
      }
      case 'fixing':
        addFeature('fixing', { shape: { kind: 'circle', cx: sn.p.x, cy: sn.p.y, d: tplUi.state.fixingD } });
        return;
      case 'keepout':
        setDrag({ kind: 'rect', a: sn.p, b: sn.p, feature: tool });
        return;
      case 'select': {
        const v = hitVertex(s);
        if (v >= 0) {
          tplUi.set({ selection: { kind: 'vertex', id: v } });
          setDrag({ kind: 'vertex', index: v });
          return;
        }
        const m = hitMid(s);
        if (m >= 0) {
          if (e.altKey) {
            drafts.update((d) => ({ ...d, outline: d.outline.map((q, i) => (i === m ? { x: q.x, y: q.y } : q)) }));
            return;
          }
          setDrag({ kind: 'mid', index: m });
          return;
        }
        const f = hitFeature(p);
        if (f) {
          tplUi.set({ selection: f });
          setDrag({ kind: 'move', start: p, last: p });
          return;
        }
        if (e.detail >= 2) {
          const edge = hitEdge(p);
          if (edge >= 0) {
            drafts.update((d) => ({ ...d, outline: insertVertex(d.outline, edge, p) }));
            return;
          }
        }
        tplUi.set({ selection: null });
        return;
      }
      default:
        return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = local(e);
    const p = at(e);
    setCursor(p);
    if (!drag) {
      if (mode === 'plane' && ['outline', 'bend', 'check', 'datum', 'fixing', 'keepout'].includes(tool)) setGuides(snap(p, e.altKey).guides);
      return;
    }
    switch (drag.kind) {
      case 'pan':
        setView({ zoom: view.zoom, centre: toWorld({ ...vp, centre: drag.centre }, { x: vp.w / 2 - (s.x - drag.start.x), y: vp.h / 2 - (s.y - drag.start.y) }) });
        break;
      case 'vertex': {
        const sn = snap(p, e.altKey, drag.index);
        setGuides(sn.guides);
        drafts.setLive((d) => ({ ...d, outline: d.outline.map((q, i) => (i === drag.index ? { ...q, x: sn.p.x, y: sn.p.y } : q)) }));
        break;
      }
      case 'mid':
        drafts.setLive((d) => {
          const a = d.outline[drag.index]!;
          const b = d.outline[(drag.index + 1) % d.outline.length]!;
          const bulge = bulgeThrough(a, b, p);
          return { ...d, outline: d.outline.map((q, i) => (i === drag.index ? (bulge ? { x: q.x, y: q.y, bulge } : { x: q.x, y: q.y }) : q)) };
        });
        break;
      case 'rect':
        setDrag({ ...drag, b: snap(p, e.altKey).p });
        break;
      case 'move': {
        const dx = p.x - drag.last.x;
        const dy = p.y - drag.last.y;
        moveSelectedFeature(dx, dy, true);
        setDrag({ ...drag, last: p });
        break;
      }
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    drafts.endLive();
    if (drag.kind === 'rect') {
      const w = Math.abs(drag.b.x - drag.a.x);
      const h = Math.abs(drag.b.y - drag.a.y);
      if (w > 1 && h > 1) {
        const shape: Shape = { kind: 'rect', cx: (drag.a.x + drag.b.x) / 2, cy: (drag.a.y + drag.b.y) / 2, w, h, r: 0 };
        addFeature(drag.feature, { shape, label: 'Keep-out' });
        const list = drafts.draft!.keepOuts;
        tplUi.set({ selection: { kind: drag.feature, id: list[list.length - 1]!.id } });
      }
    }
    setGuides([]);
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015));
    const z = zoomAt(vp, local(e), factor);
    setView({ zoom: Math.max(0.02, z.zoom), centre: z.centre });
  };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  // ---------------------------------------------------------------- drawing

  const polyScreen = (pts: PolyVertex[], closed = true): string => {
    if (pts.length < 2) return '';
    const flat = closed ? flattenPoly(pts, Math.max(0.2, 1 / vp.zoom)) : pts;
    const s = flat.map(tplScr).filter((q): q is Vec2 => !!q);
    return s.length ? `M${s.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('L')}${closed ? 'Z' : ''}` : '';
  };
  const shapeScreen = (sh: Shape): string => {
    if (sh.kind === 'circle') {
      const pts = Array.from({ length: 48 }, (_, k) => ({ x: sh.cx + (sh.d / 2) * Math.cos((k / 48) * 2 * Math.PI), y: sh.cy + (sh.d / 2) * Math.sin((k / 48) * 2 * Math.PI) }));
      return polyScreen(pts, true);
    }
    if (sh.kind === 'rect') {
      const hw = sh.w / 2;
      const hh = sh.h / 2;
      const r = Math.min(sh.r, hw, hh);
      const b = Math.tan(Math.PI / 8);
      const pts: PolyVertex[] = r > 0
        ? [
            { x: sh.cx - hw + r, y: sh.cy - hh },
            { x: sh.cx + hw - r, y: sh.cy - hh, bulge: b },
            { x: sh.cx + hw, y: sh.cy - hh + r },
            { x: sh.cx + hw, y: sh.cy + hh - r, bulge: b },
            { x: sh.cx + hw - r, y: sh.cy + hh },
            { x: sh.cx - hw + r, y: sh.cy + hh, bulge: b },
            { x: sh.cx - hw, y: sh.cy + hh - r },
            { x: sh.cx - hw, y: sh.cy - hh + r, bulge: b },
          ]
        : [
            { x: sh.cx - hw, y: sh.cy - hh },
            { x: sh.cx + hw, y: sh.cy - hh },
            { x: sh.cx + hw, y: sh.cy + hh },
            { x: sh.cx - hw, y: sh.cy + hh },
          ];
      return polyScreen(pts, true);
    }
    return polyScreen(sh.points, true);
  };
  const line = (a: Vec2, b: Vec2) => {
    // Lines map to curves under lens distortion in photo mode; sample them.
    const n = mode === 'photo' ? 16 : 2;
    const pts = Array.from({ length: n }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / (n - 1), y: a.y + ((b.y - a.y) * k) / (n - 1) }));
    return polyScreen(pts, false);
  };

  const imgTransform = (() => {
    if (mode === 'photo') {
      const o = scr({ x: 0, y: 0 });
      return `translate(${o.x} ${o.y}) scale(${vp.zoom})`;
    }
    const r = photo.rectified;
    if (!r) return '';
    const o = toScreen(vp, { x: r.box.minX, y: r.box.maxY });
    return `translate(${o.x} ${o.y}) scale(${vp.zoom / r.pxPerMm})`;
  })();
  const imgHref = mode === 'photo' ? photo.url : photo.rectifiedUrl;
  const imgSize = mode === 'photo' ? photo.raster : photo.rectified?.raster;

  const sel = selection;
  const cls = `tpl-canvas tool-${tool}${drag?.kind === 'pan' ? ' is-panning' : ''}`;
  const axisX = mode === 'plane' ? [toScreen(vp, { x: -1e4, y: 0 }), toScreen(vp, { x: 1e4, y: 0 })] : null;
  const axisY = mode === 'plane' ? [toScreen(vp, { x: 0, y: -1e4 }), toScreen(vp, { x: 0, y: 1e4 })] : null;

  return (
    <div
      ref={wrap}
      className={cls}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="tpl-canvas"
    >
      <svg width={size.w} height={size.h}>
        {imgHref && imgSize && <image href={imgHref} width={imgSize.width} height={imgSize.height} transform={imgTransform} style={{ imageRendering: vp.zoom > 3 ? 'pixelated' : 'auto' }} />}
        {axisX && axisY && (
          <g className="tpl-axes">
            <line x1={axisX[0]!.x} y1={axisX[0]!.y} x2={axisX[1]!.x} y2={axisX[1]!.y} />
            <line x1={axisY[0]!.x} y1={axisY[0]!.y} x2={axisY[1]!.x} y2={axisY[1]!.y} />
          </g>
        )}
        {mode === 'photo' &&
          crossings.map((c, i) => {
            const q = scr(c);
            return <path key={i} className="tpl-crossing" d={`M${q.x - 4} ${q.y}H${q.x + 4}M${q.x} ${q.y - 4}V${q.y + 4}`} />;
          })}
        {mode === 'photo' && draft?.calibration?.kind === 'circles' && draft.calibration.circles.map((c, i) => <g key={i}>{c.points.map((p, k) => <circle key={k} className="tpl-rim" cx={scr(p).x} cy={scr(p).y} r={2.5} />)}</g>)}
        {mode === 'photo' && rim && rim.map((p, k) => <circle key={k} className="tpl-rim is-pending" cx={scr(p).x} cy={scr(p).y} r={2.5} />)}
        {mode === 'photo' && draft?.calibration?.kind === 'points' && draft.calibration.points.map((p, i) => <circle key={i} className="tpl-ref" cx={scr(p.img).x} cy={scr(p.img).y} r={5} />)}
        {draft && (map || mode === 'plane') && (
          <g className="tpl-features">
            {draft.keepOuts.map((k) => (
              <path key={k.id} className={`tpl-keepout${sel?.kind === 'keepout' && sel.id === k.id ? ' is-selected' : ''}`} d={shapeScreen(k.shape)} />
            ))}
            <path className="tpl-outline" d={polyScreen(draft.outline)} data-testid="tpl-outline" />
            {draft.bendLines.map((b, i) => (
              <path key={i} className={`tpl-bend${sel?.kind === 'bend' && sel.id === i ? ' is-selected' : ''}`} d={line(b.a, b.b)} />
            ))}
            {draft.fixings.map((f, i) => (
              <path key={i} className={`tpl-fixing${sel?.kind === 'fixing' && sel.id === i ? ' is-selected' : ''}`} d={shapeScreen({ kind: 'circle', cx: f.x, cy: f.y, d: f.d })} />
            ))}
            {draft.checks.map((c) => {
              const a = tplScr(c.a);
              const b = tplScr(c.b);
              if (!a || !b) return null;
              return (
                <g key={c.id} className={`tpl-check${sel?.kind === 'check' && sel.id === c.id ? ' is-selected' : ''}`}>
                  <path d={line(c.a, c.b)} />
                  <circle cx={a.x} cy={a.y} r={3} />
                  <circle cx={b.x} cy={b.y} r={3} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">
                    {c.label}
                  </text>
                </g>
              );
            })}
            {mode === 'plane' &&
              tool === 'select' &&
              draft.outline.map((v, i) => {
                const q = toScreen(vp, v);
                const m = toScreen(vp, midOf(i));
                const isSel = sel?.kind === 'vertex' && sel.id === i;
                return (
                  <g key={i}>
                    <rect className={`tpl-vertex${isSel ? ' is-selected' : ''}`} x={q.x - 4} y={q.y - 4} width={8} height={8} data-testid={`tpl-v${i}`} />
                    <path className={`tpl-mid${v.bulge ? ' is-arc' : ''}`} d={`M${m.x} ${m.y - 5}L${m.x + 5} ${m.y}L${m.x} ${m.y + 5}L${m.x - 5} ${m.y}Z`} />
                  </g>
                );
              })}
          </g>
        )}
        {pending.map((p, i) => {
          const q = mode === 'photo' ? scr(p) : toScreen(vp, p);
          return <circle key={i} className="tpl-pending" cx={q.x} cy={q.y} r={4} />;
        })}
        {mode === 'plane' && tool === 'outline' && pending.length > 0 && cursor && (
          <path className="tpl-rubber" d={`M${pending.map((p) => toScreen(vp, p)).map((q) => `${q.x} ${q.y}`).join('L')}L${toScreen(vp, cursor).x} ${toScreen(vp, cursor).y}`} />
        )}
        {mode === 'plane' && ['bend', 'check', 'datum'].includes(tool) && pending.length === 1 && cursor && (
          <line className="tpl-rubber" x1={toScreen(vp, pending[0]!).x} y1={toScreen(vp, pending[0]!).y} x2={toScreen(vp, cursor).x} y2={toScreen(vp, cursor).y} />
        )}
        {mode === 'photo' && tool === 'grid-seed' && pending.length > 0 && (
          <path className="tpl-rubber" d={`M${pending.map((p) => scr(p)).map((q) => `${q.x} ${q.y}`).join('L')}${pending.length === 4 ? 'Z' : ''}`} />
        )}
        {drag?.kind === 'rect' && <path className="tpl-rubber" d={shapeScreen({ kind: 'rect', cx: (drag.a.x + drag.b.x) / 2, cy: (drag.a.y + drag.b.y) / 2, w: Math.abs(drag.b.x - drag.a.x) || 0.01, h: Math.abs(drag.b.y - drag.a.y) || 0.01, r: 0 })} />}
        {guides.map((g, i) => {
          const a = toScreen(vp, g.axis === 'x' ? { x: g.v, y: -1e4 } : { x: -1e4, y: g.v });
          const b = toScreen(vp, g.axis === 'x' ? { x: g.v, y: 1e4 } : { x: 1e4, y: g.v });
          return <line key={i} className="snap-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </svg>
      <div className="tpl-badge">
        {mode === 'photo' ? 'Photo as taken · pixels' : 'Straightened · mm, y up, origin at the datum'}
        {cursor && <span className="mono"> · {mode === 'photo' ? `${cursor.x.toFixed(0)}, ${cursor.y.toFixed(0)} px` : `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)} mm`}</span>}
      </div>
      {!draft && <div className="tpl-empty">Create a template or open a draft from the list on the left.</div>}
      {draft && mode === 'photo' && !photo.url && !busy && <div className="tpl-empty">Import a photo or scan of the panel or template (step 1).</div>}
      {busy && <div className="tpl-busy">{busy}</div>}
    </div>
  );
}

type TplSel = NonNullable<TplUi['selection']>;


