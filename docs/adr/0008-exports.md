# 0008. Exports: one drawing model, own SVG, DXF and PDF writers

- Status: accepted
- Date: 2026-10-11

## Context

M3 needs these outputs, all made in the browser:

- a cut file in SVG and DXF at 1:1, with layers;
- a printable 1:1 template tiled across A4;
- a front render as PNG and PDF;
- a bill of materials as CSV.

Every drawing must carry a title block, a "planning aid, verify before cutting" stamp and
the open checks. Golden tests must confirm cutout sizes and centres to 0.05 mm. A cut file
must never disagree with the template printed from the same design.

## Decision

- **One drawing model.** `export/drawing.ts` builds the cut drawing once: layered entities
  in world mm (shapes, lines, text). The SVG, DXF and PDF writers each convert that one
  drawing, so they cannot drift apart. The layers are:

  | Layer | Machined? |
  | --- | --- |
  | `OUTLINE` | yes |
  | `CUTOUTS` | yes |
  | `SCREW_HOLES` (part screw holes and the template's panel fixings) | yes |
  | `BEND_LINES` | yes |
  | `ENGRAVING` | yes |
  | `KEEP_OUTS_REFERENCE` | no |
  | `DIMENSIONS_REFERENCE` | no |
  | `NOTES_REFERENCE` (title block, stamp, open checks) | no |

  The non-machined layers are named `…_REFERENCE` so a CAM operator can see at a glance
  what to switch off.
- **Exact geometry.** Circles stay circles. Rounded corners and arcs stay arcs:
  - SVG arcs (`A`) in SVG;
  - bulges (code 42) in DXF, the same convention the schema uses;
  - quarter-circle Béziers in PDF, whose error is below 0.03 % of the radius.

  Nothing is flattened to chords.
- **SVG:** width and height are given in mm and the viewBox is in mm, so one user unit is
  one millimetre. Layers are `<g>` elements with Inkscape layer attributes. y is negated on
  output, and arc sweep flags are flipped to match.
- **DXF:** AutoCAD R12 ASCII (AC1009), the version almost every CAM tool reads.
  `$INSUNITS = 4` (mm). Closed `POLYLINE`s with bulges, plus `CIRCLE`, `LINE` and `TEXT`.
  Text is limited to ASCII, with `%%c`, `%%d` and `%%p` for Ø, ° and ±. Line endings are
  CRLF.
- **PDF:** a small writer of our own in `export/pdf.ts`, about 250 lines. It provides:
  - paths, fills, dashes and clipping;
  - the standard Helvetica and Helvetica-Bold fonts with WinAnsi encoding, and the AFM
    widths for centring text;
  - an xref table;
  - `/ViewerPreferences << /PrintScaling /None >>`, so viewers default to actual size.

  Page space is points with y up, the same orientation as the drawing, so 1:1 is a single
  scale factor: 72 / 25.4 points per mm. Content streams are not compressed; the files stay
  small and the tests can read them.
- **Printable template:** A4, in portrait or landscape, whichever needs fewer pages.
  - Margins are 10 mm, the footer 26 mm and the header 9 mm.
  - Neighbouring tiles overlap by 12 mm, with crosshair alignment marks in each shared strip
    and dashed lines where each neighbour starts.
  - Every page has a 100 mm check bar with 10 mm ticks, the stamp, page numbers and a
    small tile map.
  - A cover sheet shows the overview, how to print and assemble, a layer key and the title
    block. Notes and open checks that don't fit on it continue on notes pages.
- **Text size:** drawing text sizes are cap heights in mm, the usual way to specify engraving
  height. DXF `TEXT` height is the cap height; in SVG and PDF the font size is the cap
  height divided by Helvetica's 0.718.
- **Front render:** a separate styled scene (panel, bezels, cutouts, labels). SVG is the
  source; the PNG is that SVG drawn onto a canvas at 2,400 px on the long side; the PDF is
  one A4 landscape page with a title block and an approximate scale.
- **Error gate:** cut files and the template are fabrication exports. With open errors they
  are blocked unless the user ticks an override. The override is stamped:
  - on the notes layer of the SVG and DXF;
  - in red on every template page;
  - with the full error list on the cover.

  Renders, the BOM and the project file are never blocked.
- **Loading:** the exporters are code-split. They load on first export, adding about 10 kB
  gzip, and stay out of the first page load.

## Alternatives considered

- **jsPDF or pdf-lib.** Either is a sound choice, but they cost 100–350 kB, and we would
  still have to write the 1:1 mapping, tiling and arc handling ourselves. The page model we
  need is small. If we later need embedded fonts (for example, single-stroke engraving text)
  or compressed streams, pdf-lib is the one to adopt (MIT).
- **DXF R2000+ with LWPOLYLINE.** Needs handles, an OBJECTS section and more header. R12 is
  read everywhere, and ezdxf's auditor reports 0 errors on our output.
- **Flattening arcs to polylines.** Simpler writers, but laser and router software then cuts
  facets, and the golden tolerance would depend on segment count.
- **Rasterising the template.** Loses 1:1 precision and makes huge files.

## Consequences

- **Verification:** golden tests read our SVG, DXF and PDF with independent readers in
  `tests/export-parse.ts`. They check every cutout and hole centre and size to 0.05 mm, the
  outline arc, the 100 mm check bar on every page, A4 page sizes, and a valid xref. Outside
  CI, ezdxf audits the DXF with no errors, pypdf parses the PDFs in strict mode, and PDFium
  measures the bar at 100.08 mm at 300 dpi (100 mm plus tick width). The physical print still
  needs a ruler.
- **Engraving text is plain Helvetica text,** not outlines. Most engravers convert text, but
  some CAM tools need single-stroke paths. That work is parked in `docs/ideas.md`.
- **Letter paper is not offered yet;** it is parked.
