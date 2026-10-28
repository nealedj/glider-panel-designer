# 0015. Equal-gap snapping, centring and auto-arrange

- Status: accepted
- Date: 2026-10-28

## Context

Snapping lined parts up on edges, centres, guides and the grid, and Arrange could align
and distribute centres. Laying out a row of instruments of different sizes still took
hand work: spacing them evenly, centring a group on the panel, and tidying a rough layout.

## Decision

All three work on axis-aligned boxes. A box is a conservative stand-in for a part: when two
boxes are a gap apart, the cuts inside them are at least that far apart. So among the parts
it arranges, auto-arrange never leaves less material between cuts than the gap asked for.
Unselected parts are not considered.

- **Equal-gap snapping** (`editor/snap.ts`, the *gaps* snap chip, front view only). A part
  being moved has the nearest part on each side of it, among the parts it sits side by side
  with (their boxes overlap across the axis). It snaps to either of two spots:
  - midway between those two neighbours;
  - one of the gaps already used between other neighbouring parts, measured from either
    neighbour.

  A gap snap wins only when it is nearer than every alignment snap, so the existing snapping
  behaves as before. The gaps are drawn while dragging, with their lengths. The rear view
  leaves gaps out, since bodies there stack in depth and a gap in plan means little.
- **Centre on panel** (`centreOnPanel`). The selection moves as one, so its spacing is
  kept:
  - Across: onto the centreline, x = 0, the same line that mirror copy and snapping use.
  - Up and down: to the middle of the stretch of panel face it sits in. That stretch runs
    along a vertical line through the selection. It is bounded by the outline (flattened to
    0.5 mm chords) and cut short at any bend line that crosses it. On a T-panel, for
    example, a part on the stem centres between the bottom edge and the fold.
  - One part centres by its own centre (the instrument axis); several centre by their bounds.
- **Distribute with equal gaps** (`equalGaps`). Edge-to-edge gaps are made equal and the
  two outermost parts stay put. This sits beside the existing centre-to-centre distribute.
- **Auto-arrange** (`arrangeRows`), in one undoable step:
  - Sort the selected parts into rows. Going from the top, a part joins the current row
    when its centre lies within the row's height so far.
  - In each row, line the centres up on the row's mean height.
  - Space the parts by the chosen gap, left to right in their current order, with the row
    centred on the centreline.
  - Keep each row at its height, unless it would come closer than the gap to the row above;
    then move it down just enough to clear.

  Each part is spaced by its front box together with its body and the bodies of the parts
  mounted to it. Parts mounted to others, and off-panel parts, are left where they are; the
  mounted ones still ride along with their parent. The gap starts at the project's minimum
  material between cuts (5 mm when that is unset), and the user can change it.

## Alternatives considered

- **Exact shape spacing** (the cut-to-cut separation the checks use). This would pack round
  instruments a little tighter at the diagonals. But it needs an iterative search on every
  pointer move, and the result would be harder to predict than box edges, which are what the
  user sees.
- **Packing into the outline** (bin packing that avoids keep-outs and fixings). That would
  place parts for the user rather than tidy what they chose, and gives poor results on
  curved, folded panels. It is parked in `docs/ideas.md`. The checks still flag anything
  that ends up too near an edge, fold or keep-out.
- **Centring on the outline's bounding box.** This is wrong for T-panels and folded panels,
  where the bounding box spans faces the part is not on.

## Consequences

- Auto-arrange can push a row past the outline or into a keep-out. The checks report it, and
  the status message points there.
- Spacing by body and mounted units is conservative. Parts whose bodies sit at different
  depths may end up further apart than they need to be.
