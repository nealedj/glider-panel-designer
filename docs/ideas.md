# Parked ideas

Ideas that came up while building and are out of the current milestone's scope.

- Show a part's imperial equivalent on hover anywhere a length is drawn, including dimension text.
- Snap-target highlighting for bezel arcs (nearest point on a circle), not just extreme points.
- Rotate mounted children's offsets with their parent's rotation (offsets are in world axes for now; see ADR 0007).
- Draw and check bracket parts named in `mountedTo.bracket`.
- Depth regions for the available-depth check are in the template format but have no editor yet (not in M4's scope; entered as one free depth for now).
- Label placement in the rear view avoids overlaps when parts stack (labels currently sit at each body's top edge).
- Engraving text as single-stroke paths (a public-domain Hershey font), for engravers whose CAM software does not convert text (ADR 0008).
- US Letter as a printable-template paper size, and a choice of tile overlap.
- Dimensions between part edges (bezel or cutout edge), not only centres and fixed points; radius and diameter dimensions.
- A QR code of the share link on the front render, for pinning a printout in the hangar.
- Compressed PDF streams (FlateDecode) once files grow, e.g. with wiring diagrams.
- Template editor: Bézier curves in outlines (the schema stores lines and arcs; Béziers would need a schema change and conversion for DXF).
- Template editor: stitch several flatbed scan sections into one template.
- Template editor: lens models with k2 and tangential terms, and distortion from EXIF lens data.
- Template editor: lazy-load the editor so the panel editor's first load stays smaller (about 29 kB gzip).
- Discovery: an optional LLM fallback for spec text the rules miss, still keeping the snippet (ADR 0011).
- Discovery: a local catalogue overlay, so reviewed parts can be used in the editor before they are merged into `catalogue/`.
- Discovery: a photo-face display mode in the editor using the maintainer's local face crops (never shipped).
- Discovery: read dimension figures from drawing pages (OCR or vector text near dimension lines), not only from prose and tables.
- Wiring: auto-route (shortest path avoiding part bodies) as a starting route the user edits (optional in the brief).
- Wiring: manufacturer cables modelled as cables with their own conductor colours, and multi-conductor cable runs in the wire list.
- Wiring: AC 43.13-1B par. 11-69 corrections (single wire in free air, bundle size, altitude) for less conservative ampacity; intermittent loads against the 1 V intermittent drop limit.
- Wiring: multi-pole and changeover switches, relays and diodes in the circuit analysis (switches are 2-pin and taken as closed for now).
- Schematic: route long nets through a bus line rather than net labels when they share a column gap; a printable multi-page diagram for large panels.
- Wire labels: a sheet layout (many labels per A4 page) for printers that take sheets.
- Two tabs on the same origin: detect a second tab and warn, or keep one working copy per tab, so they do not autosave over each other (ADR 0013; snapshots make it recoverable for now).
- Schematic: wire numbers on short lines between neighbouring columns can overlap at a busy pin (as at the PIK-20D example's master switch); stagger or drop them where they collide.
- Objects tree: list wires and routes too, so they can be found and selected without the schematic.
- Front view: labels for small parts behind the panel (tees) on hover only; they are hidden on the front for now.
