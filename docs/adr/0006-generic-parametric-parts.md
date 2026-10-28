# 0006. Generic parametric parts with flagged placeholder defaults

- Status: accepted
- Date: 2026-10-11

## Context

The tool has to be usable before any real instrument is catalogued, but rule 3 forbids
inventing instrument data.

## Decision

- Generic parts (57 mm and 80 mm round, rectangular display, toggle switch, breaker, fuse
  holder, phone-mount base, placard) are generated from named parameters by TypeScript
  generators (`app/src/catalogue/generic.ts`) and also written to `catalogue/parts/` so the
  catalogue is self-describing JSON.
- Their defaults are placeholders, not datasheet values. Each generated part is
  `review: unverified`, and every geometry field carries a source note saying so. The editor
  shows an "unverified data" badge, and the checks panel lists every unverified part in use.
- A placed part overrides any parameter (`params` on the placed part). The geometry is rebuilt
  from the generator, so a measured value flows through to cutouts and exports.

## Consequences

Generic defaults (cutout sizes, screw spacing, depths) must be confirmed by the user against
their real parts before cutting. The M1 report lists them for review.
