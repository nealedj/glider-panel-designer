# 0007. Depth bands, mounting and the clash rule (2.5D)

- Status: accepted
- Date: 2026-10-11

## Context

The rear view has to show stacking and catch clashes without a 3D model. The brief
describes:

- **Depth bands:** each part occupies a range of depth behind the panel.
- **Mounting:** a part can be mounted to another with an x, y, z offset.
- **The clash rule:** parts clash only if they overlap both in plan and in depth.

## Decision

- **Depth band.** A part's band is `[z0, z1]`, with z measured rearward from the panel back
  face.
  - On the panel: `z0` is the part's `depthOffset`.
  - Mounted to a parent: `z0 = parent.z0 + mountedTo.dz + depthOffset`.
  - In both cases `z1 = z0 + rear.depth`. When the depth is unknown, `z1` is null, and the
    part is listed as skipped by the depth checks rather than guessed.
- **Mounting.**
  - A mounted part's world position is its parent's plus `(dx, dy)`, in world axes. Its
    rotation stays its own.
  - Mounting keeps the part where it is in plan. The default `dz` is the parent's depth, so
    the part sits just behind the parent's rear face.
  - Moving the parent carries its children through the whole chain. Moving a child alone
    changes its offset.
  - Deleting the parent deletes its children, with a status-bar note; undo restores both.
  - **A mounted part cuts nothing in the panel.** The front view shows it as a dashed
    hidden outline.
- **Clash.**
  - Two bodies clash when their outlines overlap in plan by more than 0.01 mm, and their
    depth bands share more than 0.01 mm of depth.
  - Touching in either plan or depth is legal, so a unit mounted flush behind a radio
    (`dz` equal to the radio's depth) does not clash with it.
- **Available depth.** A part's free depth is the shallowest template depth region its body
  touches, or the template default otherwise. It needs `z1` plus the largest clearance of
  its rear-face connectors. A connector clearance that is unknown counts as 0, and stays
  flagged by the data checks as unverified.
- **Rear view.**
  - It mirrors x.
  - Bodies are drawn deepest last, so they appear on top, as a fitter sees them, and are
    shaded by `z1` on a near-to-far ramp with a legend.
  - Front cuts show as a dashed ghost layer.
  - Clicking lists every body under the point, deepest first, and Tab cycles through
    them.
  - A depth slider clips the view to a band; parts outside it are dimmed and cannot be
    clicked.

## Consequences

- Clash and depth checks are 2D overlap tests plus interval tests. At 200 parts, an edit
  (checks plus redraw) reaches the screen in under 50 ms, and pan, zoom and drag in the rear
  view hold 60 fps.
- Offsets in world axes are simple, but a rotated parent does not rotate its children's
  offsets. That is parked in `docs/ideas.md`, to revisit if a real case needs it.
- Bracket parts (`mountedTo.bracket`) are carried in the file format but not yet drawn or
  checked.
