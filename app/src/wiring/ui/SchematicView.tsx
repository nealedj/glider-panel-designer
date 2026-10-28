/**
 * The schematic: an automatic block diagram of the wiring. Drag blocks to tidy (positions
 * are saved apart from physical ones); the wire tool joins pins or ports; filters hide net
 * types. Editing a wire here edits the same wire as the rear view.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toScreen, toWorld, zoomAt, type Viewport } from '../../editor/viewport';
import type { Net } from '../../model/schema';
import { useDoc, useGeometry } from '../../store/app';
import { ui, useUi } from '../../store/ui';
import { analyse } from '../circuit';
import { cssColour } from '../nets';
import { BLOCK_W, HEAD_H, layoutSchematic, type SchemBlock } from '../schematic';
import { sizeLabel } from '../sizing';
import { connectKeys, moveBlock } from '../actions';

const NET_TYPES: { type: Net['type'] | 'pneumatic'; label: string }[] = [
  { type: 'power', label: 'Power' },
  { type: 'ground', label: 'Ground' },
  { type: 'data', label: 'Data' },
  { type: 'audio', label: 'Audio' },
  { type: 'rf', label: 'RF' },
  { type: 'switch', label: 'Switch' },
  { type: 'pneumatic', label: 'Pneumatic' },
];
const PNEUMATIC: Net['type'][] = ['pitot', 'static', 'te'];

export function SchematicView() {
  const doc = useDoc();
  const geometry = useGeometry(doc);
  const hide = useUi((s) => s.schematicHide);
  const view = useUi((s) => s.schematicView);
  const selection = useUi((s) => s.selection);
  const tool = useUi((s) => s.tool);
  const wireStart = useUi((s) => s.wireStart);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  const [drag, setDrag] = useState<{ kind: 'pan'; start: { x: number; y: number }; centre: { x: number; y: number } } | { kind: 'block'; id: string; grab: { x: number; y: number }; at: { x: number; y: number } } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const space = useRef(false);

  const hidden = useMemo(() => new Set<Net['type']>(hide.flatMap((h) => (h === 'pneumatic' ? PNEUMATIC : [h as Net['type']]))), [hide]);
  const analysis = analyse(doc);
  const s = useMemo(() => layoutSchematic(doc, geometry, analysis.terms, { hide: hidden }), [doc, geometry, analysis, hidden]);
  const vp: Viewport = { w: size.w, h: size.h, zoom: view.zoom, centre: view.centre, mirror: false };
  // Schematic units are y down; the shared viewport is y up.
  const scr = (p: { x: number; y: number }) => toScreen(vp, { x: p.x, y: -p.y });
  const world = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    const w = toWorld(vp, { x: e.clientX - r.left, y: e.clientY - r.top });
    return { x: w.x, y: -w.y };
  };

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
    const el = wrap.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    const down = (e: KeyboardEvent) => e.code === 'Space' && !(e.target instanceof HTMLInputElement) && (space.current = true);
    const up = (e: KeyboardEvent) => e.code === 'Space' && (space.current = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      el.removeEventListener('wheel', block);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const fit = () => {
    const zoom = Math.min((size.w - 40) / s.width, (size.h - 40) / s.height, 2);
    ui.set({ schematicView: { zoom, centre: { x: s.width / 2, y: -s.height / 2 } } });
  };
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && s.blocks.length && size.w > 100) {
      fitted.current = true;
      fit();
    }
  });

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const r = wrap.current!.getBoundingClientRect();
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      setDrag({ kind: 'pan', start: sp, centre: view.centre });
      return;
    }
    if (e.button !== 0) return;
    const target = (e.target as Element).closest('[data-pin],[data-block],[data-wire]');
    if (!target) {
      ui.set({ selection: [], wireStart: null });
      return;
    }
    const pinKey = target.getAttribute('data-pin');
    const blockId = target.getAttribute('data-block');
    const wireId = target.getAttribute('data-wire');
    if (pinKey && (tool === 'wire' || e.altKey)) {
      if (!wireStart) ui.set({ wireStart: pinKey, message: 'Now click the pin or port to connect to (Esc to cancel)' });
      else {
        connectKeys(wireStart, pinKey);
        ui.set({ wireStart: null });
      }
      return;
    }
    if (wireId) {
      ui.set({ selection: e.shiftKey ? [...new Set([...ui.state.selection, wireId])] : [wireId] });
      return;
    }
    if (blockId) {
      ui.set({ selection: [blockId] });
      const b = s.blocks.find((x) => x.partId === blockId)!;
      const w = world(e);
      setDrag({ kind: 'block', id: blockId, grab: { x: w.x - b.x, y: w.y - b.y }, at: { x: b.x, y: b.y } });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const r = wrap.current!.getBoundingClientRect();
      const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
      ui.set({ schematicView: { zoom: view.zoom, centre: { x: drag.centre.x - (sp.x - drag.start.x) / view.zoom, y: drag.centre.y + (sp.y - drag.start.y) / view.zoom } } });
    } else {
      const w = world(e);
      // Snap to a 10-unit grid so moved blocks line up.
      setDrag({ ...drag, at: { x: Math.round((w.x - drag.grab.x) / 10) * 10, y: Math.round((w.y - drag.grab.y) / 10) * 10 } });
    }
  };
  const onUp = () => {
    if (drag?.kind === 'block') {
      const b = s.blocks.find((x) => x.partId === drag.id)!;
      if (Math.hypot(drag.at.x - b.x, drag.at.y - b.y) > 2) moveBlock(drag.id, drag.at);
    }
    setDrag(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const z = zoomAt(vp, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    ui.set({ schematicView: { zoom: Math.max(0.1, Math.min(6, z.zoom)), centre: z.centre } });
  };

  const sel = new Set(selection);
  const z = view.zoom;
  const offset = (b: SchemBlock) => (drag?.kind === 'block' && drag.id === b.partId ? { x: drag.at.x - b.x, y: drag.at.y - b.y } : { x: 0, y: 0 });
  const moved = new Map(s.blocks.map((b) => [b.partId, offset(b)]));
  const pinOffset = (key: string) => moved.get(key.split('/')[0]!) ?? { x: 0, y: 0 };

  return (
    <div ref={wrap} className={`schematic tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} data-testid="schematic">
      <div className="schematic-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="muted small">Show</span>
        {NET_TYPES.map((t) => (
          <label key={t.type} className="chip-check">
            <input
              type="checkbox"
              checked={!hide.includes(t.type)}
              onChange={() => ui.set({ schematicHide: hide.includes(t.type) ? hide.filter((h) => h !== t.type) : [...hide, t.type] })}
              data-testid={`schem-filter-${t.type}`}
            />
            {t.label}
          </label>
        ))}
        <button className="btn ghost small" onClick={fit}>
          Fit
        </button>
      </div>
      <svg width={size.w} height={size.h}>
        <defs>
          <pattern id="offpanel-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="offpanel-hatch" />
          </pattern>
        </defs>
        {s.wires.map((w) => {
          // While a block is dragged, its wires follow: the end on it moves, the track stays.
          const oa = pinOffset(w.startKey);
          const ob = pinOffset(w.endKey);
          const pts = w.points.map((p, i) => {
            const o = i <= 1 ? (i === 0 ? oa : { x: 0, y: oa.y }) : i >= w.points.length - 2 ? (i === w.points.length - 1 ? ob : { x: 0, y: ob.y }) : { x: 0, y: 0 };
            return scr({ x: p.x + o.x, y: p.y + o.y });
          });
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
          const calc = analysis.wires.get(w.wireId);
          const isSel = sel.has(w.wireId);
          return (
            <g key={w.wireId} className={`schem-wire net-${w.netType}${isSel ? ' is-selected' : ''}${hover === w.wireId ? ' is-hovered' : ''}`} data-wire={w.wireId} onPointerEnter={() => setHover(w.wireId)} onPointerLeave={() => setHover(null)}>
              <path className="hit" d={d} />
              <path className="line" d={d} style={{ stroke: cssColour(w.colour) }} />
              {(isSel || hover === w.wireId) && calc && (
                <text x={(pts[1]!.x + pts[2]!.x) / 2 + 4} y={(pts[1]!.y + pts[2]!.y) / 2} className="wire-tag">
                  {calc.wire.label}
                  {calc.sizeMm2 ? ` · ${sizeLabel(calc.sizeMm2)}` : ''}
                </text>
              )}
            </g>
          );
        })}
        {s.blocks.map((b) => {
          const o = offset(b);
          const p = scr({ x: b.x + o.x, y: b.y + o.y });
          const w = b.w * z;
          const h = b.h * z;
          return (
            <g key={b.partId} className={`schem-block${sel.has(b.partId) ? ' is-selected' : ''}${b.offPanel ? ' is-offpanel' : ''}`} data-block={b.partId} data-testid={`schem-${b.partId}`}>
              <rect x={p.x} y={p.y} width={w} height={h} rx={4} />
              {b.offPanel && <rect x={p.x} y={p.y} width={w} height={h} rx={4} className="hatch" />}
              <Symbol kind={b.symbol} x={p.x + w - 22 * z} y={p.y + 14 * z} z={z} />
              <text x={p.x + 8 * z} y={p.y + 15 * z} className="title" style={{ fontSize: 12 * z }}>
                {b.label}
              </text>
              {b.sub && (
                <text x={p.x + 8 * z} y={p.y + 25 * z} className="sub" style={{ fontSize: 9 * z }}>
                  {b.sub}
                  {b.offPanel ? ' · off panel' : ''}
                </text>
              )}
              {b.pins.map((pin) => {
                const q = scr({ x: pin.x + o.x, y: pin.y + o.y });
                const isStart = wireStart === pin.key;
                return (
                  <g key={pin.key} className={`schem-pin sig-${pin.signal}${isStart ? ' is-start' : ''}`} data-pin={pin.key} data-testid={`pin-${pin.key}`}>
                    <circle cx={q.x} cy={q.y} r={Math.max(3, 3.5 * z)} />
                    <text x={pin.side === 'left' ? q.x + 7 * z : q.x - 7 * z} y={q.y + 3.5 * z} textAnchor={pin.side === 'left' ? 'start' : 'end'} style={{ fontSize: 10 * z }}>
                      {pin.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        {s.labels.map((l) => {
          const o = pinOffset(l.key);
          const q = scr({ x: l.x + o.x, y: l.y + o.y });
          const dir = l.side === 'left' ? -1 : 1;
          const x2 = q.x + dir * 16 * z;
          return (
            <g key={`${l.wireId}${l.key}`} className={`net-label net-${l.netType}${sel.has(l.wireId) ? ' is-selected' : ''}`} data-wire={l.wireId}>
              <line x1={q.x} y1={q.y} x2={x2} y2={q.y} />
              <text x={x2 + dir * 3} y={q.y + 3.5 * z} textAnchor={dir < 0 ? 'end' : 'start'} style={{ fontSize: 9.5 * z }}>
                {l.text}
              </text>
            </g>
          );
        })}
        {s.grounds.map((g) => {
          const o = pinOffset(g.key);
          const q = scr({ x: g.x + o.x, y: g.y + o.y });
          const dir = g.side === 'left' ? -1 : 1;
          const x = q.x + dir * 14 * z;
          return (
            <g key={g.key} className="ground-sym">
              <path d={`M${q.x} ${q.y}H${x}V${q.y + 6 * z}M${x - 7 * z} ${q.y + 6 * z}H${x + 7 * z}M${x - 4.5 * z} ${q.y + 9 * z}H${x + 4.5 * z}M${x - 2 * z} ${q.y + 12 * z}H${x + 2 * z}`} />
            </g>
          );
        })}
      </svg>
      <div className="tpl-badge">Schematic · logical, not to scale · drag blocks to tidy · W wire tool</div>
      {!s.blocks.length && <div className="tpl-empty">Place parts with pins or ports (radios, varios, fuses, a battery) to see their wiring here.</div>}
    </div>
  );
}

function Symbol({ kind, x, y, z }: { kind: SchemBlock['symbol']; x: number; y: number; z: number }) {
  if (!kind) return null;
  const s = z;
  const d: Record<string, string> = {
    battery: `M${x - 8 * s} ${y}H${x - 3 * s}M${x - 3 * s} ${y - 7 * s}V${y + 7 * s}M${x + 1 * s} ${y - 4 * s}V${y + 4 * s}M${x + 1 * s} ${y}H${x + 8 * s}`,
    switch: `M${x - 9 * s} ${y + 3 * s}H${x - 4 * s}L${x + 4 * s} ${y - 4 * s}M${x + 4 * s} ${y + 3 * s}H${x + 9 * s}`,
    fuse: `M${x - 9 * s} ${y}H${x + 9 * s}M${x - 5 * s} ${y - 3 * s}H${x + 5 * s}V${y + 3 * s}H${x - 5 * s}Z`,
    breaker: `M${x - 9 * s} ${y + 2 * s}H${x - 5 * s}Q${x} ${y - 7 * s} ${x + 5 * s} ${y + 2 * s}H${x + 9 * s}`,
    antenna: `M${x} ${y + 6 * s}V${y - 6 * s}M${x - 6 * s} ${y - 6 * s}L${x} ${y}L${x + 6 * s} ${y - 6 * s}`,
    speaker: `M${x - 7 * s} ${y - 3 * s}H${x - 3 * s}L${x + 3 * s} ${y - 7 * s}V${y + 7 * s}L${x - 3 * s} ${y + 3 * s}H${x - 7 * s}Z`,
    tee: `M${x - 7 * s} ${y}H${x + 7 * s}M${x} ${y}V${y + 7 * s}`,
    source: `M${x - 6 * s} ${y}A${6 * s} ${6 * s} 0 1 0 ${x + 6 * s} ${y}A${6 * s} ${6 * s} 0 1 0 ${x - 6 * s} ${y}M${x} ${y - 3 * s}V${y + 3 * s}`,
  };
  return <path className="schem-symbol" d={d[kind]} />;
}

export { BLOCK_W, HEAD_H };
