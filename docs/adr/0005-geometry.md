# 0005. Geometry: closed-form maths and tolerance-bounded distance tests; no library yet

- Status: accepted
- Date: 2026-10-11 (updated in M2)

## Context

M1 needs transforms, bounds, point-in-shape hit tests and snap points. M2's checks need
overlap tests and distances between shapes: material between cuts, cut to edge, cut to
bend line, and bodies overlapping in plan. The brief suggests a proven geometry library for
offsets, booleans and intersections, and says never to hand-roll polygon booleans.

The shapes are circles, rounded rectangles and polygons with arc (bulge) segments. Every
check is a yes/no or a distance. None of them needs a new polygon to be built, which is what
booleans and offsets do.

## Decision

- `app/src/geom/shapes.ts` holds closed-form maths on single shapes: transforms, bounds,
  signed-distance hit tests, bulge arcs, and flattening for display.
- `app/src/geom/region.ts` holds the check geometry:
  - Circle to circle is exact.
  - Everything else is flattened to polygons whose chords stay within 0.01 mm of the true
    arc (`FLATTEN_TOL`), then measured with point-to-segment and segment-to-segment
    distances, point-in-polygon and a proper-crossing test.
  - So every reported distance is within 0.01 mm of the exact one, well inside the 0.05 mm
    the brief asks of exports.
  - Overlap means penetration deeper than the tolerance, so touching shapes are not
    flagged.
- No geometry library is added in M2. The checks need distances and overlap tests only, and
  these are short, unit-tested against closed-form answers, and have no licence or bundle
  cost.
- **No polygon booleans or offsets are hand-rolled.** When a feature needs one, such as
  merged cut outlines, kerf offsets or a flange development, add `@flatten-js/core` (MIT,
  native arcs and circles) through a new ADR.

## Consequences

- No dependency and no WASM, so the bundle stays small.
- Distances carry a stated 0.01 mm error bound. Tests pin exact cases: circles, a circle to a
  corner, rounded rects as circles, and squares overlapping along a shared edge line.
- Polygon penetration depth is approximate. It decides only whether shapes overlap, and is
  not reported as a number.
- If a later need for booleans or offsets brings in a library, the distance functions can
  move onto it behind the same API.
