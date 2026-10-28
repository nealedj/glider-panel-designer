/**
 * The drawing canvas: front view of the panel with rulers, grid, parts and tool overlays.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CAP_HEIGHT, dimensionBox, dimensionEndPoint, dimensionGeometry, textBox, textCorners, arrowStrokes, type DimensionGeometry } from '../geom/annotation';
import { boxesIntersect, boxContainsBox, distanceToSegment, holePath, pointInPolygon, pointsBox, shapeBox, shapeContains, shapePath, unionBox, type Box } from '../geom/shapes';
import { descendants, partGeometry, type PartGeometry } from '../model/resolve';
import type { Dimension, PanelTemplate, Vec2 } from '../model/schema';
import { findPart } from '../catalogue';
import { docs, useDoc, useGeometry, useTemplate } from '../store/app';
import { newId, ops } from '../store/doc';
import { ui, useUi } from '../store/ui';
import { formatLength, parseLength } from '../util/units';
import { addDimension, addKeepOut, addText, moveSelection, placePart } from './actions';
import { dimensionLabel } from '../export/drawing';
import { PartView, RearPartView } from './PartView';
import { DepthPanel, StackPanel } from './RearOverlays';
import { runChecks } from '../checks/checks';
import { collectTargets, snapMove, snapPoint, type SnapGap, type SnapLine, type SnapTargets } from './snap';
import { canvasSize, toScreen, toWorld, worldMatrix, zoomAt, type Viewport } from './viewport';
import { resolvePart } from '../model/resolve';
import { analyse } from '../wiring/circuit';
import { connectKeys, finishRoute } from '../wiring/actions';
import { hitOffPanelTerminal, hitWiring, RearWiring } from '../wiring/ui/RearWiring';

const RULER = 24;
const SNAP_PX = 8;
const DRAG_PX = 3;

type Drag =
  | { mode: 'pan'; start: Vec2; centre: Vec2 }
  | { mode: 'press'; start: Vec2; world: Vec2; hit: string }
  | { mode: 'move'; start: Vec2; world: Vec2; ids: Set<string>; box: Box; anchor: Vec2; targets: SnapTargets; delta: Vec2; lines: SnapLine[]; gaps: SnapGap[] }
  | { mode: 'window'; start: Vec2; end: Vec2; additive: boolean }
  | { mode: 'keepout'; a: Vec2; b: Vec2 }
  | { mode: 'guide'; axis: 'x' | 'y'; value: number | null };

export function Canvas() {
  const doc = useDoc();
  const geometry = useGeometry(doc);
  const template = useTemplate(doc);
  const tool = useUi((s) => s.tool);
  const view = useUi((s) => s.view);
  const zoom = useUi((s) => s.zoom);
  const centre = useUi((s) => s.centre);
  const selection = useUi((s) => s.selection);
  const layers = useUi((s) => s.layers);
  const snap = useUi((s) => s.snap);
  const placing = useUi((s) => s.placing);
  const depthClip = useUi((s) => s.depthClip);
  const stack = useUi((s) => s.stack);
  const wireStart = useUi((s) => s.wireStart);
  const routeDraft = useUi((s) => s.routeDraft);
  const units = doc.settings.units;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snapped, setSnapped] = useState<{ point: Vec2; lines: SnapLine[]; marker: Vec2 | null } | null>(null);
  const [measure, setMeasure] = useState<{ a: Vec2; b: Vec2 | null } | null>(null);
  const [dimStart, setDimStart] = useState<{ p: Vec2; end: Dimension['a'] } | null>(null);
  const [typed, setTyped] = useState('');
  const typedRef = useRef('');
  const spaceDown = useRef(false);

  const mirror = view === 'rear';
  const rear = mirror;

  // Rear view: deepest point for the shading scale, draw order, clipping and clashes.
  const maxDepth = useMemo(() => {
    let m = template?.availableDepth.default ?? 0;
    for (const g of geometry.values()) if (g.z1 !== null) m = Math.max(m, g.z1);
    return Math.max(10, Math.ceil(m / 10) * 10);
  }, [geometry, template]);
  const isClipped = useCallback(
    (g: PartGeometry) => !!depthClip && (g.z1 === null ? false : g.z1 < depthClip[0] || g.z0 > depthClip[1]),
    [depthClip],
  );
  // Further back draws on top, as the fitter sees it.
  const rearOrder = useMemo(
    () => [...geometry.values()].filter((g) => g.body).sort((a, b) => (a.z1 ?? a.z0) - (b.z1 ?? b.z0) || a.z0 - b.z0),
    [geometry],
  );
  const clashing = useMemo(() => {
    if (!rear) return new Set<string>();
    const ids = new Set<string>();
    for (const r of runChecks(doc, geometry)) if (r.key.startsWith('clash:')) r.ids.forEach((i) => ids.add(i));
    return ids;
  }, [rear, doc, geometry]);
  const vp: Viewport = useMemo(() => ({ w: size.w, h: size.h, zoom, centre, mirror }), [size, zoom, centre, mirror]);
  const selSet = useMemo(() => new Set(selection), [selection]);

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(100, r.width - RULER);
      const h = Math.max(100, r.height - RULER);
      canvasSize.w = w;
      canvasSize.h = h;
      setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset transient tool state when the tool changes.
  useEffect(() => {
    setMeasure(null);
    setDimStart(null);
    setSnapped(null);
    updateDrag(null);
    typedRef.current = '';
    setTyped('');
  }, [tool]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) spaceDown.current = true;
      if (e.key === 'Enter' && ui.state.tool === 'route' && ui.state.routeDraft.length >= 2 && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void finishRoute(ui.state.routeDraft, ui.state.routeDepth);
        return;
      }
      const d = dragRef.current;
      if (d?.mode === 'move') {
        // Dynamic input: type a distance while dragging, Enter to apply along the drag direction.
        const setT = (t: string) => {
          typedRef.current = t;
          setTyped(t);
        };
        if (/^[0-9.+\-/a-z"]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) {
          setT(typedRef.current + e.key);
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === 'Backspace') {
          setT(typedRef.current.slice(0, -1));
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const dist = parseLength(typedRef.current, docs.doc.settings.units);
          const raw = d.delta;
          const len = Math.hypot(raw.x, raw.y);
          if (dist !== null && len > 0) {
            // Lock to the dominant axis when the drag is nearly orthogonal, as CAD ortho does.
            const dir =
              Math.abs(raw.x) > 4 * Math.abs(raw.y)
                ? { x: Math.sign(raw.x), y: 0 }
                : Math.abs(raw.y) > 4 * Math.abs(raw.x)
                  ? { x: 0, y: Math.sign(raw.y) }
                  : { x: raw.x / len, y: raw.y / len };
            moveSelection(dir.x * dist, dir.y * dist, `Move ${formatLength(dist, docs.doc.settings.units)}`);
          }
          updateDrag(null);
          setT('');
        } else if (e.key === 'Escape') {
          updateDrag(null);
          setT('');
          e.stopPropagation();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const boxOf = (g: PartGeometry) => (rear ? g.rearBox : g.frontBox);
  const tolMm = SNAP_PX / zoom;
  const grid = doc.settings.gridMm;

  const pointTargets = useMemo(
    () => (tool === 'select' ? null : collectTargets(geometry, new Set(), template, doc.guides, doc.keepOuts, snap)),
    [tool, geometry, template, doc.guides, doc.keepOuts, snap],
  );

  const localPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - RULER, y: e.clientY - r.top - RULER };
  };

  /** Rear view: every part whose body is under a point, nearest the fitter (deepest) first. */
  const stackAt = useCallback(
    (w: Vec2): string[] => {
      const tol = 2 / zoom;
      return [...rearOrder].reverse().filter((g) => !isClipped(g) && shapeContains(g.body!, w, tol)).map((g) => g.id);
    },
    [rearOrder, isClipped, zoom],
  );

  const hitTest = useCallback(
    (w: Vec2): string | null => {
      const tol = 2 / zoom;
      if (rear) return stackAt(w)[0] ?? null;
      if (layers.dimensions) {
        const endAt = dimensionEndPoint(geometry);
        for (let i = docs.doc.dimensions.length - 1; i >= 0; i--) {
          const d = docs.doc.dimensions[i]!;
          const dg = dimensionGeometry(d, endAt);
          if (!dg) continue;
          if (distanceToSegment(w, dg.d1, dg.d2) <= 3 / zoom + 0.5 || pointInPolygon(w, textCorners({ x: dg.text.x, y: dg.text.y, text: dimensionLabel(dg.value, docs.doc.settings.units), size: 2.5, rotation: dg.angle }))) return d.id;
        }
      }
      if (layers.labels) {
        for (let i = docs.doc.texts.length - 1; i >= 0; i--) {
          const t = docs.doc.texts[i]!;
          if (pointInPolygon(w, textCorners(t))) return t.id;
        }
      }
      const parts = docs.doc.parts;
      for (let i = parts.length - 1; i >= 0; i--) {
        const g = geometry.get(parts[i]!.id);
        if (!g) continue;
        const shapes = g.bezel ? [g.bezel, ...g.cutouts] : g.cutouts;
        if (shapes.some((s) => shapeContains(s, w, tol))) return g.id;
        if (!shapes.length && g.holes.some((h) => Math.hypot(h.x - w.x, h.y - w.y) <= h.d / 2 + tol)) return g.id;
        if (!shapes.length && !g.holes.length && g.body && shapeContains(g.body, w, tol)) return g.id;
      }
      if (layers.keepouts && !rear) {
        for (let i = docs.doc.keepOuts.length - 1; i >= 0; i--) {
          const k = docs.doc.keepOuts[i]!;
          if (shapeContains(k.shape, w, tol)) return k.id;
        }
      }
      return null;
    },
    [geometry, zoom, layers.keepouts, layers.labels, layers.dimensions, rear, stackAt],
  );

  const snapAt = (w: Vec2) => (pointTargets ? snapPoint(w, pointTargets, snap, grid, tolMm) : { point: w, lines: [], marker: null });

  /** A dimension end: attached to a part when the point is that part's centre, else fixed. */
  const endFor = (p: Vec2): Dimension['a'] => {
    for (const g of geometry.values()) if (!g.mounted && Math.hypot(g.transform.x - p.x, g.transform.y - p.y) < 1e-6) return { part: g.id };
    return { x: p.x, y: p.y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = localPoint(e);
    const w = toWorld(vp, s);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      updateDrag({ mode: 'pan', start: s, centre });
      return;
    }
    if (e.button !== 0) return;
    if (s.x < 0 || s.y < 0) {
      // Drag from a ruler to make a guide: the top ruler gives a horizontal guide.
      if (s.x >= 0 || s.y >= 0) updateDrag({ mode: 'guide', axis: s.y < 0 ? 'y' : 'x', value: null });
      return;
    }
    if (tool === 'place' && placing) {
      const p = snapAt(w).point;
      const id = placePart(placing, p);
      ui.set({ selection: [id] });
      return;
    }
    if (tool === 'move') {
      const p = snapAt(w).point;
      if (!measure) setMeasure({ a: p, b: null });
      else {
        moveSelection(p.x - measure.a.x, p.y - measure.a.y);
        ui.set({ tool: 'select' });
      }
      return;
    }
    if (tool === 'measure') {
      const p = snapAt(w).point;
      setMeasure((m) => (!m || m.b ? { a: p, b: null } : { a: m.a, b: p }));
      return;
    }
    if (tool === 'keepout') {
      const p = snapAt(w).point;
      updateDrag({ mode: 'keepout', a: p, b: p });
      return;
    }
    if (tool === 'wire' || tool === 'route') {
      if (!rear) return ui.set({ message: 'Wiring is drawn in the rear view (V) or the schematic' });
      if (tool === 'route') {
        const p = snapAt(w).point;
        if (e.detail >= 2 && ui.state.routeDraft.length >= 2) return void finishRoute(ui.state.routeDraft, ui.state.routeDepth);
        ui.set({ routeDraft: [...ui.state.routeDraft, p], message: 'Click the next point; double-click or Enter to finish' });
        return;
      }
      const a = analyse(docs.doc);
      const key = hitOffPanelTerminal(vp, docs.doc, a, s) ?? (() => {
        const h = hitWiring(vp, docs.doc, a, s, true);
        return h?.kind === 'terminal' ? h.id : null;
      })();
      if (!key) return ui.set({ message: 'Click a pin or port (shown as dots); Esc to stop' });
      if (!ui.state.wireStart) ui.set({ wireStart: key, message: `${a.terms.get(key)?.label}: now click where it goes` });
      else {
        connectKeys(ui.state.wireStart, key);
        ui.set({ wireStart: null });
      }
      return;
    }
    if (tool === 'text') {
      if (rear) return ui.set({ message: 'Text labels go on the front; flip to the front view (V)' });
      addText(snapAt(w).point);
      ui.set({ tool: 'select' });
      // Type the label straight away.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>('[data-testid="insp-text"]');
        el?.focus();
        el?.select();
      });
      return;
    }
    if (tool === 'dimension') {
      if (rear) return ui.set({ message: 'Dimensions go on the front; flip to the front view (V)' });
      const p = snapAt(w).point;
      const end = endFor(p);
      if (!dimStart) {
        setDimStart({ p, end });
        return;
      }
      const dx = p.x - dimStart.p.x;
      const dy = p.y - dimStart.p.y;
      if (Math.hypot(dx, dy) < 1e-6) return;
      // Shift measures along the dominant axis only; otherwise point to point.
      const kind = Math.abs(dy) < 1e-6 ? 'horizontal' : Math.abs(dx) < 1e-6 ? 'vertical' : e.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical') : 'aligned';
      addDimension(dimStart.end, end, kind);
      setDimStart(null);
      return;
    }
    // Select tool.
    if (rear) {
      const h = hitWiring(vp, docs.doc, analyse(docs.doc), s, false);
      if (h && h.kind !== 'exit') {
        const sel = ui.state.selection;
        ui.set({ selection: e.shiftKey || e.ctrlKey ? [...new Set([...sel, h.id])] : [h.id], stack: null });
        return;
      }
      if (h?.kind === 'exit') {
        if (!ui.state.selection.includes(h.id)) ui.set({ selection: [h.id], stack: null });
        updateDrag({ mode: 'press', start: s, world: w, hit: h.id });
        return;
      }
      const ids = stackAt(w);
      ui.set({ stack: ids.length ? { at: w, ids } : null });
    }
    const hit = hitTest(w);
    if (hit) {
      const sel = ui.state.selection;
      if (e.ctrlKey || e.metaKey) {
        ui.set({ selection: sel.includes(hit) ? sel.filter((x) => x !== hit) : [...sel, hit] });
        return;
      }
      if (e.shiftKey) {
        if (!sel.includes(hit)) ui.set({ selection: [...sel, hit] });
      } else if (!sel.includes(hit)) {
        ui.set({ selection: [hit] });
      }
      updateDrag({ mode: 'press', start: s, world: w, hit });
    } else {
      updateDrag({ mode: 'window', start: s, end: s, additive: e.shiftKey });
    }
  };

  /** Right-click: select what is under the pointer (keeping a selection it is part of), then open the menu. */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (dragRef.current) return;
    const s = localPoint(e);
    const w = toWorld(vp, s);
    let hit: string | null = null;
    if (tool === 'select') {
      if (rear) {
        hit = hitWiring(vp, docs.doc, analyse(docs.doc), s, false)?.id ?? null;
        const ids = hit ? [] : stackAt(w);
        ui.set({ stack: ids.length ? { at: w, ids } : null });
      }
      hit ??= hitTest(w);
      if (hit && !ui.state.selection.includes(hit)) ui.set({ selection: [hit] });
    }
    ui.set({ contextMenu: { x: e.clientX, y: e.clientY, onItem: !!hit } });
  };

  const startMove = (d: Extract<Drag, { mode: 'press' }>): Drag | null => {
    const sel = ui.state.selection;
    // Parts mounted to moving parts move too, so exclude them from snap targets.
    const ids = new Set([...sel, ...descendants(docs.doc.parts, sel)]);
    const movable = docs.doc.parts.filter((p) => sel.includes(p.id) && !p.locked);
    const kos = docs.doc.keepOuts.filter((k) => sel.includes(k.id));
    const texts = docs.doc.texts.filter((t) => sel.includes(t.id));
    const endAt = dimensionEndPoint(geometry);
    const dims = docs.doc.dimensions.filter((d) => sel.includes(d.id)).map((d) => dimensionGeometry(d, endAt)).filter((d): d is DimensionGeometry => !!d);
    if (!movable.length && !kos.length && !texts.length && !dims.length) {
      ui.set({ message: 'Selection is locked' });
      return null;
    }
    const boxes = [...movable.map((p) => geometry.get(p.id)).filter((g): g is PartGeometry => !!g).map(boxOf), ...kos.map((k) => shapeBox(k.shape)), ...texts.map(textBox), ...dims.map(dimensionBox)];
    const box = unionBox(boxes)!;
    const hitGeom = geometry.get(d.hit);
    const anchor = hitGeom ? { x: hitGeom.transform.x, y: hitGeom.transform.y } : { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    // Equal gaps are kept on the panel face; behind it, bodies stack in depth instead.
    const targets = collectTargets(geometry, ids, template, docs.doc.guides, docs.doc.keepOuts.filter((k) => !ids.has(k.id)), ui.state.snap, rear ? () => null : undefined);
    return { mode: 'move', start: d.start, world: d.world, ids, box, anchor, targets, delta: { x: 0, y: 0 }, lines: [], gaps: [] };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = localPoint(e);
    const w = toWorld(vp, s);
    setCursor(w);
    ui.set({ cursor: w });
    const d = dragRef.current;
    if (!d) {
      if (tool === 'select') setHover(hitTest(w));
      else setSnapped(snapAt(w));
      return;
    }
    switch (d.mode) {
      case 'pan': {
        const sx = mirror ? -1 : 1;
        ui.set({ centre: { x: d.centre.x - (sx * (s.x - d.start.x)) / zoom, y: d.centre.y + (s.y - d.start.y) / zoom } });
        break;
      }
      case 'press': {
        if (Math.hypot(s.x - d.start.x, s.y - d.start.y) > DRAG_PX) {
          const m = startMove(d);
          updateDrag(m);
        }
        break;
      }
      case 'move': {
        const raw = { x: w.x - d.world.x, y: w.y - d.world.y };
        const res = e.altKey ? { delta: raw, lines: [], gaps: [] } : snapMove(raw, d.box, d.anchor, d.targets, ui.state.snap, grid, tolMm);
        updateDrag({ ...d, delta: res.delta, lines: res.lines, gaps: res.gaps });
        break;
      }
      case 'window':
        updateDrag({ ...d, end: s });
        break;
      case 'guide': {
        const inside = s.x >= 0 && s.y >= 0;
        const sp = snapPoint(w, collectTargets(geometry, new Set(), template, [], docs.doc.keepOuts, ui.state.snap), ui.state.snap, grid, tolMm).point;
        updateDrag({ ...d, value: inside ? sp[d.axis] : null });
        break;
      }
      case 'keepout': {
        const sp = snapAt(w);
        setSnapped(sp);
        updateDrag({ ...d, b: sp.point });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    switch (d.mode) {
      case 'press':
        // A plain click on an already-selected part narrows the selection to it.
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) ui.set({ selection: [d.hit] });
        break;
      case 'move':
        if (!typedRef.current) moveSelection(d.delta.x, d.delta.y);
        else return; // waiting for Enter on typed distance
        break;
      case 'window': {
        const a = toWorld(vp, d.start);
        const b = toWorld(vp, d.end);
        const rect = pointsBox([a, b]);
        if (Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) < DRAG_PX) {
          if (!d.additive) ui.set({ selection: [] });
          break;
        }
        // Left to right selects enclosed items; right to left selects anything touched.
        const enclosed = d.end.x >= d.start.x !== mirror;
        const test = (bx: Box) => (enclosed ? boxContainsBox(rect, bx) : boxesIntersect(rect, bx));
        const ids: string[] = [];
        for (const [id, g] of geometry) if ((!rear || (g.body && !isClipped(g))) && test(boxOf(g))) ids.push(id);
        if (layers.keepouts && !rear) for (const k of docs.doc.keepOuts) if (test(shapeBox(k.shape))) ids.push(k.id);
        if (layers.labels && !rear) for (const t of docs.doc.texts) if (test(textBox(t))) ids.push(t.id);
        if (layers.dimensions && !rear) {
          const endAt = dimensionEndPoint(geometry);
          for (const dm of docs.doc.dimensions) {
            const dg = dimensionGeometry(dm, endAt);
            if (dg && test(dimensionBox(dg))) ids.push(dm.id);
          }
        }
        ui.set({ selection: d.additive ? [...new Set([...ui.state.selection, ...ids])] : ids });
        break;
      }
      case 'guide':
        if (d.value !== null) docs.dispatch('Add guide', [ops.insert('guides', { id: newId('g'), axis: d.axis, value: d.value })]);
        break;
      case 'keepout': {
        const box = pointsBox([d.a, d.b]);
        const w = box.maxX - box.minX;
        const h = box.maxY - box.minY;
        if (w > 0.5 && h > 0.5) addKeepOut({ kind: 'rect', cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, w, h, r: 0 });
        break;
      }
    }
    updateDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = localPoint(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= 1 || e.deltaMode !== 0) {
      // Mouse wheel and trackpad pinch zoom about the cursor.
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015));
      ui.set(zoomAt(vp, s, factor));
    }
  };

  useEffect(() => {
    // React's wheel listener is passive; block page zoom on trackpad pinch.
    const el = wrapRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    const data = e.dataTransfer.getData('application/x-gpd-part');
    if (!data) return;
    e.preventDefault();
    const ref = JSON.parse(data) as { id: string; version: number };
    const w = toWorld(vp, localPoint(e));
    const targets = collectTargets(geometry, new Set(), template, doc.guides, doc.keepOuts, snap);
    const p = snapPoint(w, targets, snap, grid, tolMm).point;
    const id = placePart(ref, p);
    ui.set({ selection: [id], tool: 'select' });
  };

  // ---------------------------------------------------------------- rendering

  const moving = drag?.mode === 'move' ? drag : null;
  const ghost = useMemo((): PartGeometry | null => {
    if (tool !== 'place' || !placing || !snapped) return null;
    const part = findPart(placing, doc.customParts);
    if (!part) return null;
    const pp = { id: '__ghost', part: placing, x: snapped.point.x, y: snapped.point.y, rotation: 0, label: '', mountedTo: null, depthOffset: 0, locked: false, offPanelRunMm: null };
    return partGeometry(pp, resolvePart(pp, doc) ?? part, { x: snapped.point.x, y: snapped.point.y, rotation: 0 });
  }, [tool, placing, snapped, doc]);

  const snapLines = moving ? moving.lines : snapped && tool !== 'select' ? snapped.lines : [];
  const parentMoving = (id: string): boolean => {
    if (!moving) return false;
    return moving.ids.has(id);
  };

  const cursorScreen = cursor ? toScreen(vp, cursor) : null;
  const viewLabel = view === 'rear' ? 'Rear · viewed from behind' : 'Front · as the pilot sees it';

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap tool-${tool}${drag?.mode === 'pan' ? ' is-panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setCursor(null);
        ui.set({ cursor: null });
      }}
      onWheel={onWheel}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-gpd-part')) e.preventDefault();
      }}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      data-testid="canvas"
    >
      <Rulers vp={vp} cursor={cursorScreen} />
      <svg className="canvas" width={size.w} height={size.h} style={{ left: RULER, top: RULER }}>
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
          </pattern>
          <pattern id="hatch-unknown" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-unknown-line" />
          </pattern>
        </defs>
        {layers.grid && <Grid vp={vp} gridMm={grid} />}
        <g transform={worldMatrix(vp)}>
          {template && layers.template && <TemplateView t={template} />}
          <Centreline vp={vp} template={template} />
          {layers.guides &&
            doc.guides.map((gd) => (
              <line key={gd.id} className="guide" {...(gd.axis === 'x' ? { x1: gd.value, x2: gd.value, y1: -1e4, y2: 1e4 } : { y1: gd.value, y2: gd.value, x1: -1e4, x2: 1e4 })} />
            ))}
          {layers.keepouts &&
            !rear &&
            doc.keepOuts.map((k) => (
              <g key={k.id} transform={moving?.ids.has(k.id) ? `translate(${moving.delta.x} ${moving.delta.y})` : undefined}>
                <path className={`keepout${selSet.has(k.id) ? ' is-selected' : ''}${hover === k.id ? ' is-hovered' : ''}`} d={shapePath(k.shape)} />
              </g>
            ))}
          {!rear &&
            doc.parts.map((pp) => {
              const g = geometry.get(pp.id);
              // Off-panel parts (battery, probes, antennas) show only in the rear view, at their exit.
              if (!g || g.part.offPanel) return null;
              const off = parentMoving(pp.id) && !pp.locked;
              return (
                <g key={pp.id} transform={off ? `translate(${moving!.delta.x} ${moving!.delta.y})` : undefined}>
                  <PartView g={g} selected={selSet.has(pp.id)} hovered={hover === pp.id} locked={pp.locked} layers={layers} />
                </g>
              );
            })}
          {rear && (
            <g className="front-ghost" aria-label="Front cutouts">
              {[...geometry.values()].map((g) => (
                <g key={g.id}>
                  {g.cutouts.map((c, i) => (
                    <path key={i} d={shapePath(c)} />
                  ))}
                  {g.holes.map((h, i) => (
                    <path key={`h${i}`} d={holePath(h)} />
                  ))}
                </g>
              ))}
            </g>
          )}
          {rear &&
            rearOrder.map((g) => {
              const off = parentMoving(g.id) && !docs.doc.parts.find((p) => p.id === g.id)?.locked;
              return (
                <g key={g.id} transform={off ? `translate(${moving!.delta.x} ${moving!.delta.y})` : undefined}>
                  <RearPartView
                    g={g}
                    selected={selSet.has(g.id)}
                    hovered={hover === g.id}
                    shade={g.z1 === null ? null : Math.min(1, g.z1 / maxDepth)}
                    clipped={isClipped(g)}
                    clash={clashing.has(g.id)}
                  />
                </g>
              );
            })}
          {ghost && <PartView g={ghost} selected={false} hovered={false} locked={false} layers={layers} ghost />}
          {snapLines.map((l, i) => (
            <line key={i} className="snap-line" {...(l.axis === 'x' ? { x1: l.value, x2: l.value, y1: -1e4, y2: 1e4 } : { y1: l.value, y2: l.value, x1: -1e4, x2: 1e4 })} />
          ))}
          {drag?.mode === 'guide' && drag.value !== null && (
            <line className="guide is-draft" {...(drag.axis === 'x' ? { x1: drag.value, x2: drag.value, y1: -1e4, y2: 1e4 } : { y1: drag.value, y2: drag.value, x1: -1e4, x2: 1e4 })} />
          )}
          {drag?.mode === 'keepout' && <path className="keepout is-draft" d={boxPath(pointsBox([drag.a, drag.b]))} />}
        </g>
        {rear && (
          <RearWiring
            vp={vp}
            doc={doc}
            a={analyse(doc)}
            selection={selSet}
            hover={hover}
            wireTool={tool === 'wire'}
            wireStart={wireStart}
            showTerminals={layers.labels && zoom >= 1.5}
          />
        )}
        {rear && tool === 'route' && routeDraft.length > 0 && (
          <path
            className="route-draft"
            d={[...routeDraft, ...(cursor ? [cursor] : [])].map((p, i) => `${i ? 'L' : 'M'}${toScreen(vp, p).x} ${toScreen(vp, p).y}`).join('')}
          />
        )}
        {/* Screen-space overlays: selection boxes, labels, markers. */}
        {selection.map((id) => {
          const g = geometry.get(id);
          const k = g ? null : doc.keepOuts.find((x) => x.id === id);
          const t = g || k ? null : doc.texts.find((x) => x.id === id);
          const b = g ? boxOf(g) : rear ? null : k ? shapeBox(k.shape) : t ? textBox(t) : null;
          if (!b) return null;
          const d = moving && (moving.ids.has(id)) ? moving.delta : { x: 0, y: 0 };
          return <rect key={id} className="sel-box" {...screenRect(vp, b, d, 4)} />;
        })}
        {layers.labels &&
          doc.parts.map((pp) => {
            const g = geometry.get(pp.id);
            if (!g || !pp.label || zoom < 0.8) return null;
            const d = moving?.ids.has(pp.id) ? moving.delta : { x: 0, y: 0 };
            if (rear && (!g.body || isClipped(g))) return null;
            // Off-panel parts are labelled at their exit in the rear view. Small parts behind the
            // panel (tees) are left unlabelled on the front, where they would crowd the cutouts.
            if (g.part.offPanel) return null;
            const behind = !g.bezel && !g.cutouts.length && !g.holes.length;
            if (!rear && behind && g.rearBox.maxX - g.rearBox.minX < 30) return null;
            const top = toScreen(vp, { x: g.transform.x + d.x, y: boxOf(g).maxY + d.y });
            return (
              <text key={pp.id} className="part-label" x={top.x} y={top.y - 5} textAnchor="middle">
                {pp.label}
              </text>
            );
          })}
        {!rear && layers.labels && (
          <g className="text-labels">
            {doc.texts.map((t) => {
              const d = moving?.ids.has(t.id) ? moving.delta : { x: 0, y: 0 };
              const p = toScreen(vp, { x: t.x + d.x, y: t.y + d.y });
              return (
                <text
                  key={t.id}
                  className={`text-label is-${t.layer}${selSet.has(t.id) ? ' is-selected' : ''}${hover === t.id ? ' is-hovered' : ''}`}
                  x={p.x}
                  y={p.y}
                  fontSize={(t.size / CAP_HEIGHT) * zoom}
                  textAnchor="middle"
                  transform={t.rotation ? `rotate(${-t.rotation} ${p.x} ${p.y})` : undefined}
                  data-testid={`text-${t.id}`}
                >
                  {t.text}
                </text>
              );
            })}
          </g>
        )}
        {!rear && layers.dimensions && (
          <g className="dimensions">
            {doc.dimensions.map((dm) => {
              const endAt = (end: Dimension['a']) => {
                const p = dimensionEndPoint(geometry)(end);
                if (!p || !moving) return p;
                const follows = 'part' in end ? moving.ids.has(end.part) : false;
                return follows ? { x: p.x + moving.delta.x, y: p.y + moving.delta.y } : p;
              };
              const dg = dimensionGeometry(dm, endAt);
              if (!dg) return null;
              const shift = moving?.ids.has(dm.id) ? moving.delta : null;
              const shown = shift ? dimensionGeometry({ ...dm, offset: dm.offset + slide(dm, dg, shift) }, endAt)! : dg;
              return <DimensionView key={dm.id} vp={vp} dg={shown} label={dimensionLabel(shown.value, units)} selected={selSet.has(dm.id)} hovered={hover === dm.id} id={dm.id} />;
            })}
          </g>
        )}
        {dimStart && tool === 'dimension' && <MeasureOverlay vp={vp} a={dimStart.p} b={snapped?.point ?? dimStart.p} units={units} />}
        {snapped?.marker && tool !== 'select' && <SnapMarker p={toScreen(vp, snapped.marker)} />}
        {moving?.gaps.map((g, i) => <GapMark key={i} vp={vp} g={g} units={units} />)}
        {measure && tool === 'move' && (
          <MoveOverlay vp={vp} a={measure.a} b={snapped?.point ?? measure.a} units={units} />
        )}
        {measure && tool === 'measure' && <MeasureOverlay vp={vp} a={measure.a} b={measure.b ?? snapped?.point ?? measure.a} units={units} />}
        {drag?.mode === 'window' && <WindowRect d={drag} />}
        {moving && cursorScreen && (
          <g className="dyn-input" transform={`translate(${cursorScreen.x + 16} ${cursorScreen.y + 18})`}>
            <rect x={0} y={-13} width={typed ? 140 : 170} height={20} rx={3} />
            <text x={6} y={1}>
              {typed ? `${typed} ⏎` : `Δ ${formatLength(moving.delta.x, units)}, ${formatLength(moving.delta.y, units)}`}
            </text>
          </g>
        )}
        <OriginMarker p={toScreen(vp, { x: 0, y: 0 })} />
        <g className="view-badge" transform={`translate(${12} ${size.h - 14})`}>
          <text>{viewLabel}</text>
        </g>
        {rear && stack && <StackMarker p={toScreen(vp, stack.at)} />}
      </svg>
      {rear && <DepthPanel maxDepth={maxDepth} available={template?.availableDepth.default ?? null} />}
      {rear && stack && <StackPanel geometry={geometry} />}
    </div>
  );
}

function StackMarker({ p }: { p: Vec2 }) {
  return (
    <g className="stack-marker" transform={`translate(${p.x} ${p.y})`}>
      <circle r={6} />
      <line x1={-10} x2={10} y1={0} y2={0} />
      <line x1={0} x2={0} y1={-10} y2={10} />
    </g>
  );
}

function boxPath(b: Box) {
  return `M${b.minX} ${b.minY}H${b.maxX}V${b.maxY}H${b.minX}Z`;
}

function screenRect(vp: Viewport, b: Box, d: Vec2, pad: number) {
  const a = toScreen(vp, { x: b.minX + d.x, y: b.minY + d.y });
  const c = toScreen(vp, { x: b.maxX + d.x, y: b.maxY + d.y });
  return { x: Math.min(a.x, c.x) - pad, y: Math.min(a.y, c.y) - pad, width: Math.abs(c.x - a.x) + 2 * pad, height: Math.abs(c.y - a.y) + 2 * pad };
}

function TemplateView({ t }: { t: PanelTemplate }) {
  return (
    <g className="template">
      <path className="panel-outline" d={shapePath(t.outline)} />
      {t.bendLines.map((b, i) => (
        <line key={i} className="bend-line" x1={b.a.x} y1={b.a.y} x2={b.b.x} y2={b.b.y} />
      ))}
      {t.fixings.map((f, i) => (
        <path key={i} className="fixing" d={holePath(f)} />
      ))}
      {t.keepOuts.map((k) => (
        <path key={k.id} className="keepout is-template" d={shapePath(k.shape)} />
      ))}
    </g>
  );
}

function Centreline({ vp, template }: { vp: Viewport; template: PanelTemplate | undefined }) {
  const b = template ? shapeBox(template.outline) : { minY: -100, maxY: 100 };
  const ext = 12 / vp.zoom;
  return <line className="centreline" x1={0} x2={0} y1={b.minY - ext} y2={b.maxY + ext} />;
}

function niceStep(zoom: number, minPx: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  return steps.find((s) => s * zoom >= minPx) ?? 1000;
}

function Grid({ vp, gridMm }: { vp: Viewport; gridMm: number }) {
  // Draw the snap grid when it is legible, otherwise a coarser multiple of it.
  let minor = gridMm;
  while (minor * vp.zoom < 6) minor *= minor === gridMm ? 2 : 5;
  const major = minor * 5;
  const tl = toWorld(vp, { x: 0, y: 0 });
  const br = toWorld(vp, { x: vp.w, y: vp.h });
  const x0 = Math.min(tl.x, br.x);
  const x1 = Math.max(tl.x, br.x);
  const y0 = Math.min(tl.y, br.y);
  const y1 = Math.max(tl.y, br.y);
  let dMinor = '';
  let dMajor = '';
  for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) {
    const sx = Math.round(toScreen(vp, { x, y: 0 }).x) + 0.5;
    const line = `M${sx} 0V${vp.h}`;
    if (Math.abs(x / major - Math.round(x / major)) < 1e-6) dMajor += line;
    else dMinor += line;
  }
  for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) {
    const sy = Math.round(toScreen(vp, { x: 0, y }).y) + 0.5;
    const line = `M0 ${sy}H${vp.w}`;
    if (Math.abs(y / major - Math.round(y / major)) < 1e-6) dMajor += line;
    else dMinor += line;
  }
  return (
    <g className="grid">
      <path className="grid-minor" d={dMinor} />
      <path className="grid-major" d={dMajor} />
    </g>
  );
}

function Rulers({ vp, cursor }: { vp: Viewport; cursor: Vec2 | null }) {
  const step = niceStep(vp.zoom, 50);
  const minor = step / (String(step).startsWith('2') ? 4 : 5);
  const tl = toWorld(vp, { x: 0, y: 0 });
  const br = toWorld(vp, { x: vp.w, y: vp.h });
  const xs: React.ReactElement[] = [];
  const ys: React.ReactElement[] = [];
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  for (let x = Math.ceil(Math.min(tl.x, br.x) / minor) * minor; x <= Math.max(tl.x, br.x); x += minor) {
    const sx = Math.round(toScreen(vp, { x, y: 0 }).x) + 0.5;
    const isMajor = Math.abs(x / step - Math.round(x / step)) < 1e-6;
    xs.push(<line key={`t${x}`} x1={sx} x2={sx} y1={isMajor ? 8 : 17} y2={RULER} />);
    if (isMajor) xs.push(<text key={`l${x}`} x={sx + 3} y={11}>{fmt(x)}</text>);
  }
  for (let y = Math.ceil(Math.min(tl.y, br.y) / minor) * minor; y <= Math.max(tl.y, br.y); y += minor) {
    const sy = Math.round(toScreen(vp, { x: 0, y }).y) + 0.5;
    const isMajor = Math.abs(y / step - Math.round(y / step)) < 1e-6;
    ys.push(<line key={`t${y}`} y1={sy} y2={sy} x1={isMajor ? 8 : 17} x2={RULER} />);
    if (isMajor)
      ys.push(
        <text key={`l${y}`} x={11} y={sy - 3} transform={`rotate(-90 11 ${sy - 3})`}>
          {fmt(y)}
        </text>,
      );
  }
  return (
    <>
      <svg className="ruler ruler-top" width={vp.w} height={RULER} style={{ left: RULER, top: 0 }}>
        {xs}
        {cursor && <line className="ruler-cursor" x1={cursor.x} x2={cursor.x} y1={0} y2={RULER} />}
      </svg>
      <svg className="ruler ruler-left" width={RULER} height={vp.h} style={{ left: 0, top: RULER }}>
        {ys}
        {cursor && <line className="ruler-cursor" y1={cursor.y} y2={cursor.y} x1={0} x2={RULER} />}
      </svg>
      <div className="ruler-corner" title="Units: mm">mm</div>
    </>
  );
}

function OriginMarker({ p }: { p: Vec2 }) {
  return (
    <g className="origin" transform={`translate(${p.x} ${p.y})`}>
      <line x1={-10} x2={10} y1={0} y2={0} />
      <line x1={0} x2={0} y1={-10} y2={10} />
      <circle r={4} />
    </g>
  );
}

/** An equal gap while dragging: a span with end ticks and its length. */
function GapMark({ vp, g, units }: { vp: Viewport; g: SnapGap; units: 'metric' | 'imperial' }) {
  const pt = (v: number) => toScreen(vp, g.axis === 'x' ? { x: v, y: g.at } : { x: g.at, y: v });
  const a = pt(g.a);
  const b = pt(g.b);
  const t = 5;
  const tick = (p: Vec2) => (g.axis === 'x' ? { x1: p.x, x2: p.x, y1: p.y - t, y2: p.y + t } : { x1: p.x - t, x2: p.x + t, y1: p.y, y2: p.y });
  return (
    <g className="snap-gap" data-testid="snap-gap">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <line {...tick(a)} />
      <line {...tick(b)} />
      <text x={(a.x + b.x) / 2 + (g.axis === 'y' ? 8 : 0)} y={(a.y + b.y) / 2 - (g.axis === 'x' ? 8 : 0)} textAnchor={g.axis === 'x' ? 'middle' : 'start'}>
        {formatLength(g.b - g.a, units)}
      </text>
    </g>
  );
}

function SnapMarker({ p }: { p: Vec2 }) {
  return <rect className="snap-marker" x={p.x - 5} y={p.y - 5} width={10} height={10} />;
}

function WindowRect({ d }: { d: Extract<Drag, { mode: 'window' }> }) {
  const crossing = d.end.x < d.start.x;
  return (
    <rect
      className={`window-select${crossing ? ' is-crossing' : ''}`}
      x={Math.min(d.start.x, d.end.x)}
      y={Math.min(d.start.y, d.end.y)}
      width={Math.abs(d.end.x - d.start.x)}
      height={Math.abs(d.end.y - d.start.y)}
    />
  );
}

function MeasureOverlay({ vp, a, b, units }: { vp: Viewport; a: Vec2; b: Vec2; units: 'metric' | 'imperial' }) {
  const sa = toScreen(vp, a);
  const sb = toScreen(vp, b);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
  return (
    <g className="measure" data-testid="measure">
      <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} />
      <circle cx={sa.x} cy={sa.y} r={3} />
      <circle cx={sb.x} cy={sb.y} r={3} />
      <g transform={`translate(${mid.x + 10} ${mid.y - 10})`}>
        <rect x={-4} y={-14} width={190} height={36} rx={3} />
        <text y={0}>{formatLength(dist, units)}</text>
        <text y={15} className="sub">
          Δx {formatLength(b.x - a.x, units)} Δy {formatLength(b.y - a.y, units)}
        </text>
      </g>
    </g>
  );
}

function MoveOverlay({ vp, a, b, units }: { vp: Viewport; a: Vec2; b: Vec2; units: 'metric' | 'imperial' }) {
  const sa = toScreen(vp, a);
  const sb = toScreen(vp, b);
  return (
    <g className="measure is-move">
      <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} />
      <circle cx={sa.x} cy={sa.y} r={3} />
      <text x={sb.x + 12} y={sb.y - 8}>
        Δ {formatLength(b.x - a.x, units)}, {formatLength(b.y - a.y, units)}
      </text>
    </g>
  );
}

/** How far a drag slides a dimension's line, along its offset direction. */
function slide(dm: Dimension, dg: DimensionGeometry, d: Vec2): number {
  if (dm.kind === 'horizontal') return d.y;
  if (dm.kind === 'vertical') return d.x;
  const len = Math.hypot(dg.p2.x - dg.p1.x, dg.p2.y - dg.p1.y) || 1;
  return (d.x * -(dg.p2.y - dg.p1.y) + d.y * (dg.p2.x - dg.p1.x)) / len;
}

function DimensionView({ vp, dg, label, selected, hovered, id }: { vp: Viewport; dg: DimensionGeometry; label: string; selected: boolean; hovered: boolean; id: string }) {
  const s = (p: Vec2) => toScreen(vp, p);
  const seg = (a: Vec2, b: Vec2) => {
    const [p, q] = [s(a), s(b)];
    return `M${p.x} ${p.y}L${q.x} ${q.y}`;
  };
  // Arrowheads keep a constant on-screen size.
  const arrow = 9 / vp.zoom;
  const back = { x: -dg.dir.x, y: -dg.dir.y };
  const d = [seg(dg.d1, dg.d2), ...dg.ext.map(([a, b]) => seg(a, b)), ...[...arrowStrokes(dg.d1, back, arrow), ...arrowStrokes(dg.d2, dg.dir, arrow)].map(([a, b]) => seg(a, b))].join('');
  const t = s(dg.text);
  // The view may mirror x, which flips the apparent angle.
  const ang = vp.mirror ? dg.angle : -dg.angle;
  return (
    <g className={`dimension${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`} data-testid={`dim-${id}`}>
      <path d={d} />
      <text x={t.x} y={t.y - 2} textAnchor="middle" transform={`rotate(${ang} ${t.x} ${t.y})`}>
        {label}
      </text>
    </g>
  );
}
