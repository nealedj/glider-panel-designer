# 0017. Guided wires, editable routes, rounded paths and bus bars

- Status: accepted
- Date: 2026-11-02

## Context

David asked for two things:

- Wires and tubes ran straight from terminal to terminal, and he wanted to guide them and
  smooth the lines.
- He wanted a bus bar for a shared ground.

Routes (ADR 0012) already let wires share a loom. But a route could not be changed once it
was drawn, and a wire that was not on a route could only be a straight line. Every path was
drawn with sharp corners. Grounds could only be joined by running every ground wire to the
battery, or by daisy-chaining pins.

## Decision

- **Guide points on a wire.** A wire has optional `via` points: x, y in plan, and z for the
  depth behind the panel. When the wire is not on a route, it runs from its first terminal,
  through its guide points in order, to its second. Its length is measured along that path
  and is no longer marked as a straight-line estimate.
- **A route wins.** A wire on a route follows the route. Its guide points are kept, but they
  are not used while it is on the route, and the inspector says so. This avoids a rule for
  joining a wire's own points to the route.
- **One way to shape both.** In the rear view, select one wire or route and use its handles:
  - drag a point to move it;
  - drag the + in the middle of a leg to add a point there;
  - double-click a point to remove it.

  A new point takes the depth of the middle of its leg, and a moved point keeps its depth.
  Points snap like other rear-view points, and Alt moves freely. A wire's ends stay on its
  pins, and a route keeps at least two points. Each change is one undo step. **Straighten
  selected wires** (Arrange menu, context menu and inspector) removes a wire's guide points.
- **Rounded corners, for drawing only** (`geom/smooth.ts`). Each interior corner becomes a
  quadratic Bézier curve:
  - it starts 30 mm before the corner and ends 30 mm after it, with the corner as its
    control point;
  - each leg gives at most half its length to a corner, so neighbouring curves meet without
    overlapping.

  The path keeps its direction where each curve joins a leg, so it has no kinks, and its
  ends never move. It is sampled every 6° or so of turn, and drawn that way:
  - in the rear view;
  - in the 3D view;
  - in the rear drawing export, where each loom is now one path with round joins (a new
    `polyline` drawing primitive, so its dashed spine runs on without restarting).
- **Lengths stay on the corner-to-corner polyline.** That is slightly longer than the
  rounded path drawn, so it errs towards a wire that is long enough. Wire lists and sizing
  do not change when a curve is redrawn.
- **Bus bars:**
  - A catalogue part can set `bus: true`, which means every pin is joined inside the part.
  - For nets, a bus works like a tube tee: wires on any of its studs are one net, and new
    wires take that net's colour.
  - In the circuit analysis, each stud is linked to the first. Feed and return paths both
    run through those links. Returns still never run back through a switch or a fuse.
- **Pins can have their own position.** A pin may now carry x, y in part coordinates. A bus
  bar's studs use this, so they sit along the bar in the rear view and lengths are measured
  from the right stud. Pins without a position stay at their connector, fanned out on screen
  as before.
- **Generic bus bar** (`generic.bus-bar`):
  - it sits behind the panel and cuts nothing;
  - the number of studs (2 to 24, default 6), their spacing, the bar width and its depth are
    parameters;
  - its studs carry signal `other`, so the net's type comes from what is wired to it. The
    same part makes a ground bus or a fused power bus. A power stud and a ground stud on one
    bar are reported as a short.
  - Like every generic value, its geometry is an unverified placeholder.

## Alternatives considered

- **Catmull-Rom splines through the points.** The curve would pass through every handle,
  but it overshoots on uneven spacing and can swing into a part's body. Rounded corners stay
  inside the corner-to-corner polyline, which the user can see as the dashed control line
  while shaping.
- **Measuring length along the curve.** That is more exact by a few millimetres per bend.
  But wire lengths would shrink whenever the drawing changed, and a wire cut short is worse
  than one cut long.
- **Guide points that also apply on a route.** This needs a rule for where the wire meets
  the route, before and after its own points. The simpler rule covers the cases asked for:
  to shape a bundle, shape its route.
- **A flag per connector instead of per part.** That would be finer, for terminal blocks
  with separate groups, but nothing in the catalogue needs it yet.
- **A ground-only bus bar.** Studs with signal `ground` would make a power bus impossible,
  and would report a short as soon as a fused feed was joined to one.

## Consequences

- Old projects open unchanged. `via`, `bus` and the pin positions are optional, and no
  sample project changes.
- The 30 mm bend distance is a drawing default, not a check. It is not the wire's minimum
  bend radius, and nothing checks bend radius yet.
- Moving a part does not move the guide points of its wires; the wire still ends on its
  pin, so the last leg stretches.
- Guide points are shaped in plan only. Their depth is set when they are added; changing it
  is by editing the route depth for routes, and is not yet offered for a wire's points
  (parked in `docs/ideas.md`).
