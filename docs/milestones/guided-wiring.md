# Report: guided wires, smooth paths and bus bars

2026-11-02

David asked for two things:

1. Wires and plumbing ran straight between components. He wanted to guide them and smooth
   the lines.
2. He wanted a bus bar for a shared ground.

Decision record: ADR 0017.

## What it does

| Asked for | How it is met | Evidence |
| --- | --- | --- |
| Guide wires and tubes | In the rear view, select a wire or tube that is not on a route and use its handles. Drag the **+** in the middle of a leg to add a bend, drag a point to move it, and double-click a point to remove it. Points snap like other rear-view points; Alt moves freely. The wire's length follows its guide points and is no longer marked as a straight-line estimate. **Straighten** (inspector, Arrange menu, context menu) puts a wire back to straight. Each change is one undo step. | `e2e/guided-wiring.spec.ts`; `img/guided-wire.png` |
| Guide looms | Routes can now be reshaped after they are drawn, with the same handles. Before this, a route was fixed once drawn. A wire on a route follows the route; its inspector says so and shows no handles. | `e2e/guided-wiring.spec.ts`; `img/guided-route.png` |
| Smooth the lines | Every wire, tube and loom is drawn with rounded corners in the rear view, the 3D view and the rear drawing export. Each corner rounds over the last 30 mm before it and the first 30 mm after it, or over less on short legs. The ends stay on their pins. | `tests/guided-wiring.test.ts` (no kinks, stays inside the corner, ends fixed); all four images |
| Bus bar for a shared ground | New generic **Bus bar** in the library. It mounts behind the panel and cuts nothing. You set the number of studs (2–24, default 6), their spacing, the bar width and its depth. The studs sit along the bar and are named by number ("GND bus 3"). Every wire on its studs is one net. The circuit analysis carries return currents through it, so the battery lead to the bar carries the sum of the loads. The same part works as a fused power bus. A power stud and a ground stud on one bar are reported as a short. | `tests/guided-wiring.test.ts`; `e2e/guided-wiring.spec.ts` rewires two instruments' grounds through a bar; `img/bus-bar.png`, `img/bus-bar-schematic.png` |

## Tests

- `tests/guided-wiring.test.ts` (14 tests) covers:
  - **rounding:** ends fixed, the curve inside the corner, no kinks, and short legs;
  - **the rear export:** each loom as one rounded path;
  - **guide points:** length and estimate flag, adding, moving and removing, ends kept on their pins, and straightening giving back the original wire;
  - **routes:** reshaping, keeping at least two points, and routed wires having no handles;
  - **3D:** rounded paths in the model;
  - **bus bars:** stud layout, one net, return currents through the bar, stud positions and labels, and a short between power and ground.
- `e2e/guided-wiring.spec.ts` (2 flows):
  - shape a wire by dragging (add, move, double-click to remove, undo, straighten), then reshape the route;
  - place a bus bar from the library, wire the battery and two instruments to it with the wire tool, and check the open-ground errors clear.

  Both check for page errors.
- All suites pass: 306 unit tests and 39 Playwright flows; `npm run build` is clean; the
  Python tool tests pass.

## Defaults chosen (no safety or data impact)

- **The 30 mm rounding is a drawing setting only.** It is not a bend radius, and nothing
  checks one. A bend-radius check is parked.
- **Wire lengths are measured corner to corner, not along the rounded curve.** This errs a
  few millimetres long per bend, so a wire is never cut short because the drawing changed.
- **A new guide point takes the depth of the middle of its leg.** It cannot yet be set by
  hand; this is parked.
- **The generic bus bar's sizes are unverified placeholders,** like every generic part: 10 mm
  stud spacing, a 12 mm bar and 15 mm behind the panel. Its studs carry no signal of their
  own, so a bar takes its type from what is wired to it.

## Limits

- **Guide points do not follow a part when it moves.** The wire still ends on its pin, so its
  last leg stretches.
- **A bus bar shows a ground symbol on every stud in the schematic.** This reads correctly
  but is busy; a bus symbol is parked in `docs/ideas.md`.
