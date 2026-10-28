# 0010. Panel templates from photos: calibration, straightening and tracing

- Status: accepted
- Date: 2026-10-11

## Context

M4 turns a scan or photo into a panel template in the browser. The inputs, from most to
least accurate:

- a flatbed scan;
- a template on a gridded cutting mat;
- a tracing;
- a square-on photo with a known reference;
- an angled photo of a fitted panel.

The acceptance test is two photos of the reference panel (a PIK-20D):

- a cardboard mock-up on an A3 imperial mat;
- the current panel as fitted, taken at an angle.

The result must state its own error honestly, because people will cut from it. No
computer-vision library is in the stack, and OpenCV.js alone is about 8 MB.

## Decision

**One map from photo to template.** Each photo pixel goes through four steps, in
`template/mapping.ts`, `camera.ts` and `draft.ts`:

1. **Lens distortion**, one radial term: `u = c + (d − c)(1 + k1·r²/R²)`, about the image
   centre, with `R` the half-diagonal.
2. **A homography** to the calibrated plane, in mm.
3. **A raised-template correction**, when the template sits above that plane (card on a
   mat). The camera's height and nadir are recovered from the homography: Zhang's
   constraints give the focal length, with a 75° diagonal field of view assumed when the
   photo is too square-on to tell. Features are then shrunk towards the nadir by
   `(D − h) / D`.
4. **The datum frame:** origin, rotation, and y flipped to the app's y-up convention.

Traced features are stored in template mm. When the calibration or datum changes, they are
carried across through the photo, so tracing never has to be redone.

**Calibration methods:**

| Method | How it works | Fit |
| --- | --- | --- |
| Mat grid | The grid is found automatically: a ridge filter, line directions by Hough peakiness on mat-coloured pixels, the step by normalised autocorrelation, then a seed cell. "Click one square" is the fallback. The grid then grows ring by ring. Each crossing is placed by locating both lines near the prediction, and kept only if all four arms are clearly visible, so crossings under the template are skipped. | Homography by normalised DLT plus Gauss–Newton, with robust outlier trimming; `k1` by golden-section search. `k1` is kept only if it lowers the residual by at least 15 %. |
| Instruments | Click a centre and the rim; the rim edge is found along 48 rays and fitted as an ellipse. | One or two instruments give an affine map, recovered from the common ellipse shape. Three or more give a full homography: Levenberg–Marquardt makes every edge point lie on a circle of its stated diameter. |
| Points | Four or more points with known positions. | Homography. |
| Scale | Scan resolution, or a line of known length. | Scale only. |

**Straightened view.** The photo is resampled through the inverse map onto a mm raster
(capped at 4 Mpx), so tracing happens square-on and at true scale, with distortion removed.
CSS `matrix3d` alone could not do this, because it cannot undo lens distortion.

**Tracing tools:**

- **Wand.** A flood fill against a running mean colour, morphological closing and hole
  filling, a boundary trace on the pixel-corner lattice, and Douglas–Peucker. Then runs of
  vertices whose original boundary lies on one circle (within the smoothing tolerance)
  become a single arc (a bulge).
- **Editing.** Vertex drag with snapping to vertices, alignment and the centreline; drag an
  edge's handle to make it an arc; double-click an edge to add a vertex; delete a vertex.
- **Mirroring.** "Mirror left/right half" clips the outline at x = 0 and reflects it,
  keeping arcs.
- **Features.** Bend lines, fixing holes and keep-outs. (Reserved areas and existing
  cutouts were removed later; see the second addendum.)

The schema stores arcs as bulges, not Béziers, so the editor offers lines and arcs.

**Accuracy estimate.** The point errors below are combined in quadrature, then multiplied
by √2 for a distance, which has two ends:

- the calibration residual;
- 1.5 px of tracing at the photo's mm-per-pixel;
- for a raised template: 15 % uncertainty in camera height (40 % when assumed), applied to
  the outline span;
- a baseline per input type, a judgement recorded in the M4 report.

Check spans measured on the real thing are compared against this estimate.

**Storage.** Drafts, their photos and the user's own library live in IndexedDB
(`gpd-templates`). Photos never leave the browser. A user template chosen for a project is
embedded whole, so files and share links carry it.

## Alternatives considered

- **OpenCV.js:** a much heavier dependency, and we would still need our own calibration
  model and UI.
- **Fully automatic outline detection.** It works for card on a mat (the wand), but a fitted
  panel against clutter needs a person. The wand is a suggestion, and every vertex can be
  edited.
- **A full camera calibration with k1, k2 and tangential terms.** One term already cut the
  mock-up's grid residual from 0.46 mm to 0.12 mm. More terms would fit noise on 180
  points.
- **Storing traced geometry in photo pixels.** It makes recalibration free, but arcs are not
  arcs in pixel space. Storing mm and remapping through the photo gets the same benefit.

## Consequences

- The mock-up calibrates from its mat to a 0.12 mm residual over 182 crossings, with
  `k1 = −0.032`.
- The fitted-panel photo calibrates from seven instruments with a 0.5 mm residual and
  diameters within 0.7 mm. That depends on the diameters the user states for the rims they
  click.
- Photo-derived templates stay drafts until checked at 1:1. The editor prints the outline
  with the M3 template exporter and records a verification note and date.
- Parked: a Bézier editor, lens models with more terms, and depth regions. See
  `docs/ideas.md`.

## Addendum (2026-10-14): editing existing templates

Any template in the library, or the one a project uses, can be opened for editing. It opens
as a draft with its features in template mm and no photo, so the editor starts on Features
in the straightened view. A photo can still be added and calibrated.

- **Shipped templates are edited as your own copy,** named "… (my copy)", under a `local.`
  id. The shipped file in the repo is never changed from the browser.
- **Your own templates are edited in place,** keeping their id and version.
- **Provenance:** while no new calibration is made, the copy keeps the original's source,
  input type, accuracy and method, with "edited in the template editor" added.
- **Verification:** a verified template goes back to draft when edited, because any change
  must be checked again at 1:1.

## Addendum (2026-10-14): templates hold only the panel

Reserved areas (component footprints traced from a mock-up) and existing cutouts are
removed from the template format, the editor and the panel editor's snapping. A template
describes the panel only: its outline, bend lines, fixing holes, keep-outs, free depth and
canopy clearance. Instruments and other parts belong in the project, placed in the panel
editor. Older files that still carry `reservedAreas` load, and the field is dropped.
