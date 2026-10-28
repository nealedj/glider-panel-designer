# Report: 3D view

2026-10-28

David asked for 3D rendering and chose a **read-only 3D view tab**, using **three.js loaded
lazily**. Decision record: ADR 0014. The brief keeps 3D *modelling* out of scope, and this
view does not change that: every edit still goes through the inspector and the 2D views.

## What it does

| Asked for | How it is met | Evidence |
| --- | --- | --- |
| A 3D view of the panel, parts and wiring | A **3D** tab beside Front, Rear and Schematic. It draws the plate with every cut as a hole, the bezels standing proud, the bodies through their depth bands, mounted stacks, the wires along their 3D paths, and the looms at bundle size. | `e2e/view3d.spec.ts`; `img/3d-iso.png` |
| Look from any side | Drag to orbit, right-drag to pan, wheel to zoom. Presets: **1** front, **2** rear, **3** above and behind, **F** fit. These are commands too, so they appear in the palette and the shortcut map. | `img/3d-front.png` |
| In step with the other views | Clicking a part, wire or loom selects it, and the inspector shows it. An edit in the inspector redraws the 3D view at once. Undo works from the 3D view. Clashes from the checks are drawn red. | The e2e test clicks the ASI from the front, moves it 30 mm in the inspector, clicks it again at its new place, sees the clash, and undoes; `img/3d-rear-clash.png` |
| See behind the panel | A **See-through panel** toggle, plus Wires and Looms toggles. | `img/3d-dark-see-through.png` |
| Never invent data | Unknown depth: a flat amber outline. Unknown protrusion: a flat bezel. No body outline: not drawn behind the panel. Off-panel parts: not drawn. The flange is drawn flat, since templates give no bend angle. Each case is listed by name in the view's notes. | `tests/view3d.test.ts` |
| Keep the editor light | three.js is a 153 kB gzip chunk fetched when the 3D tab first opens. The main bundle went from 206.7 to 207.2 kB gzip. | `vite build` |

## Tests

- `tests/view3d.test.ts` (7 tests) checks:
  - the plate's z band and hole count, and the cutout radius within 0.01 mm;
  - the bezel and body z bands, including a depth offset;
  - a mounted part sitting behind its parent and cutting nothing;
  - clashes marked;
  - unknown thicknesses drawn flat and named in the notes;
  - overlapping cuts left out of the plate;
  - every wire in the wiring sample drawn, with routed wires following their route.
- `e2e/view3d.spec.ts` checks, on the PIK-20D example:
  - the canvas really draws (it samples the WebGL pixels);
  - wire and loom counts match the project;
  - picking is in step with the inspector, an edit redraws the view, and undo works;
  - the theme follows;
  - the view loads again after leaving it, with no page errors.
- All suites pass: 241 unit tests and 30 Playwright flows.

## Defaults chosen (no safety or data impact)

- The camera opens **above and behind**, as a fitter would look in.
- Bodies use the rear render's near-to-far blue ramp. Clashes are red and unknown depth is amber.
- Wires are drawn at their estimated outer diameter (`outerDiameter`), and looms at the bundle
  estimate, with a 2 mm minimum so an empty route stays visible.
- Bezels and outlines of unknown thickness are drawn 0.2 mm thick, only so their faces do not
  flicker against the plate. That 0.2 mm is never reported as a value.

## Also fixed along the way

- Keyboard shortcuts were ignored after a click on any checkbox, because a focused checkbox
  counted as typing. This affected the schematic filters and the new 3D toggles. Checkboxes
  and radio buttons no longer block shortcuts.

## Limits and follow-ups

- The view shows the 2.5D model, so it has the same limits: bodies are prisms, and mounted
  children's offsets do not rotate with their parent (ADR 0007).
- Cuts that overlap another cut or the panel edge are left out of the plate and noted. Drawing
  them would need a polygon boolean (ADR 0005), and the front checks already report them.
- Parked in `docs/ideas.md`: glTF or STL export, a 3D still in the renders, folding the
  flange, a depth clip in 3D, and bracket parts.
- The local brief still lists 3D modelling as out of scope, which is still true. You may want
  to add a line there noting the read-only 3D view.
