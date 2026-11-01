# 0016. Box parts fitted any way round

- Status: accepted
- Date: 2026-11-01

## Context

Remote boxes (e.g. the LX Navigation Flarm Red Box, "84x53x30 mm") are fitted behind the
panel, often on another part, in whatever position suits the cockpit. Makers print the
housing sizes but not which face meets the panel, so one `rear.body` plus `rear.depth` in
the catalogue would be a guess.

## Decision

- A part may carry `rear.box`: its three sizes as printed, mm. `body` and `depth` stay null.
- A placed part picks which size runs rearward with `boxDepth` (0, 1 or 2; default 2). The
  other two face the panel, first across and second up; in-plane rotation swaps them.
- `resolvePart` turns the box into an ordinary rect body and depth (`fitBox`), so the rear
  view, the 3D view, clash and depth checks need no change.
- The review flow has a `rear.box` field. Overall sizes of panel instruments are still not
  depths; `rear.box` is only for housings with no panel face.
- Such parts are not `offPanel`: that flag is for parts away from the panel (battery,
  speaker), which no view draws.

## Alternatives considered

- Fixing one position in the catalogue: wrong for anyone fitting it another way.
- A full 3D orientation per part: more than the 2.5D model (ADR 0007) can use.

## Consequences

Other remote boxes (Classic FLARM, transponder units) can gain `rear.box` when a maker
document prints their sizes.
