# 0002. SVG rendering for the canvas

- Status: accepted
- Date: 2026-10-11

## Context

The canvas must be crisp at any zoom, hit-testable, and map cleanly to SVG export. The target
is smooth pan and zoom with 200 parts and 500 wires.

## Decision

Render with SVG. World geometry sits in one group with a `matrix(z, 0, 0, -z, tx, ty)`
transform (y up, mm); strokes use `vector-effect: non-scaling-stroke` so line weights stay
constant in pixels. Text, selection boxes and tool overlays are drawn in screen space so
they do not scale or mirror. The rear view reuses all of this with x mirrored.

Per-part geometry is cached by placed-part identity, and part components are memoised, so an
edit re-renders only what changed. During a drag only the moving parts get a translate.

## Measurement (M1)

With 200 parts in Chromium at 1440 × 900, wheel zoom, pan and part drag all hold a median
frame of 16.7 ms (vsync-locked 60 fps; p95 16.8 ms). See `app/e2e/m1-front-editor.spec.ts`.
Wires are not yet drawn; re-measure at M6 with 500 wires before deciding on Canvas layers.

## Alternatives considered

Canvas 2D or WebGL: faster for very large scenes but needs hand-written hit testing and a
separate export path. Kept as the fallback for busy layers if the M6 measurement misses.
