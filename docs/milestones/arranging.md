# Report: arranging (equal-gap snapping, centring, auto-arrange)

2026-10-28

David asked for parts to auto-snap, auto-arrange and centre. Snapping to edges, centres,
guides and the grid, plus align and distribute, were already there. This adds what was
missing. Decision record: ADR 0015.

## What it does

| Asked for | How it is met | Evidence |
| --- | --- | --- |
| Auto-snap | A new **gaps** snap chip, on by default. While dragging in the front view, a part snaps to sit midway between its neighbours, or at a gap already used between other parts. Each gap is marked with its length. Alignment snaps still win when they are nearer. Alt still moves freely. | `e2e/arrange.spec.ts` drags the fuse holder until it locks to the instruments' 24 mm gap; `img/arrange-gap-snap.png` |
| Centre | Three new Arrange commands. **Centre on panel**, **Centre across, on the centreline**, and **Centre up and down, on the panel face**. The selection moves as one. Up and down uses the stretch of face the selection is on, so on the PIK-20D T-panel a part centres on the stem or above the fold. | `tests/arrange.test.ts`; the e2e test centres the ASI from the Arrange menu and undoes it |
| Auto-arrange | **Auto-arrange in rows…** opens a dialog with the gap. It starts at the project's minimum material between cuts. The selected parts are grouped into rows by height. Each row's centres are lined up, the parts spaced at the gap and the row centred on the centreline. Rows that would come too close are moved apart. All of this is one undo step. | `img/arrange-auto.png`: the sample tidied with no check errors |
| (related) | **Distribute horizontally / vertically, equal gaps**: equal edge-to-edge gaps, for instruments of different sizes. The existing distribute equals centre spacing. | `tests/arrange.test.ts` |

Every new action is a command, so it appears in the Arrange menu and the palette, and can be
given a shortcut in the shortcut map. None has a default shortcut.

## Found while testing

My first version of auto-arrange spaced parts by their bezels only. On the sample, that put
the ASI and the altimeter inside the 80 mm audio unit mounted behind the vario, and the
rear checks reported two clashes. Parts are now spaced by their bezels, their bodies, and
the bodies of anything mounted to them. The unit test checks that the arranged sample has
no check errors.

## Tests

- `tests/arrange.test.ts` (15 tests) covers:
  - gap snapping: centring between neighbours, repeating an existing gap, ignoring parts that are not side by side, and leaving out parts behind the panel;
  - the face span on the PIK-20D template, cut short at the fold;
  - grouping into rows, spacing, and moving a crowded row down;
  - equal gaps;
  - the centre actions: one part, a group, and a locked selection;
  - auto-arrange: positions, mounted parts riding along, no check errors, one undo step.
- `e2e/arrange.spec.ts` (3 flows): the gap snap during a real drag, centring from the menu with undo, and auto-arrange through its dialog. Each also checks there are no page errors.
- All suites pass: 256 unit tests and 33 Playwright flows; `npm run build` is clean.

## Defaults chosen (no safety or data impact)

- The auto-arrange gap defaults to the project's minimum material between cuts. Boxes that far apart keep at least that much material between their cuts. It falls back to 5 mm when that minimum is unset. It is a layout spacing, not a check threshold, and the checks still run on the result.
- Gap snapping is on by default and works only in the front view.
- Auto-arrange keeps each row's order and height, so it tidies a rough layout rather than inventing one. Packing into the outline is parked in `docs/ideas.md`.
