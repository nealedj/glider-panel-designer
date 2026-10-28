# 0004. Coordinates, units and the project file format

- Status: accepted
- Date: 2026-10-11

## Decision

**Coordinates.** Millimetres, x right, y up, origin at a datum on the panel (by default the
centre of the panel's bounding box), as the pilot sees it. The rear view mirrors x. Depth z
is measured rearward from the back face of the panel. Angles are degrees counter-clockwise.

**Units.** Stored in mm, mm², g and A. Imperial (inches, AWG) is a display and input setting
only. Typed lengths accept units: `57`, `57mm`, `5.7cm`, `2.25in`, `2.25"`, `2 1/4in`, and sums.

**Shapes.** Three kinds: `circle` (centre, diameter), `rect` (centre, size, corner radius) and
`poly` (closed polyline whose vertices carry a DXF-style `bulge` for arcs). Bulges map
directly to DXF LWPOLYLINE and SVG arcs, and let panel outlines carry true arcs.

**Files.** A project is one JSON document with `schemaVersion`. The zod schemas in
`app/src/model/schema.ts` are the source of truth; `npm run gen` exports JSON Schema to
`schemas/` for the Python tools, and a test fails if the committed export is stale.
Catalogue parts and templates are referenced by `{id, version}`; custom ones are embedded.

**Unknown data.** Catalogue fields that are not known are `null`, and each geometry field
records its source (`url`, `snippet`, `status`). Nothing is guessed.
