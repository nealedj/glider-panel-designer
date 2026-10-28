# Glider Panel Designer

A browser-only, CAD-style 2D tool for designing glider instrument panels: front face, rear
(depth and stacking) and wiring, from one project model. Static site, no server.

- Project brief: `glider-panel-designer-brief.md` (local only, not committed).
- Visual design system: `DESIGN.md`.
- Decisions: `docs/adr/`. Parked ideas: `docs/ideas.md`. Milestone reports: `docs/milestones/`.

## Layout

```
app/          TypeScript + React + Vite front end: the whole product
  src/model/    zod schemas (source of truth for file formats), part/template resolution
  src/store/    document store (undoable commands), UI state, autosave
  src/geom/     shape maths
  src/editor/   canvas, snapping, actions, command registry
  src/checks/   design rule checks
  src/export/   cut drawing, SVG/DXF/PDF writers, renders, bill of materials
  src/share/    share links (project in the URL fragment)
  src/template/ template editor: photo calibration, straightening, tracing (ADR 0010)
  src/wiring/   nets, circuit analysis and sizing (AC 43.13-1B), lengths, schematic (ADR 0012)
  src/ui/       panels and chrome
  tests/        Vitest unit tests;  e2e/  Playwright flows
tools/        Python discovery tools (maintainers only): see tools/README.md
schemas/      JSON Schemas generated from the zod schemas (`npm run gen`)
catalogue/    reviewed part data: facts and maker source links
templates/    panel template library
fixtures/     sample projects, synthetic test pages, reference-panel photos
local/ cache/ git-ignored crawler config and caches
```

## Commands (run in `app/`)

- `npm run dev` · `npm run build` · `npm test` (Vitest) · `npm run e2e` (Playwright)
- `docs/questions.md` lists open questions for the user; add to it rather than blocking.
- `npm run gen` regenerates `schemas/` and the generic parts in `catalogue/parts/`; tests fail if they are stale.
- `npm run gen:pik20d` (and `gen:wiring-sample`) rebuild the sample projects in `fixtures/projects/` through the editor's ops; a test fails if the PIK-20D example is stale.

## Working rules

1. **Work milestone by milestone.** Finish each with a short report against its acceptance criteria, with screenshots or a Playwright trace, before starting the next.
2. **Record decisions.** Any choice of framework, file format or algorithm gets an ADR in `docs/adr/`.
3. **Never invent instrument data.** Unknown values are null and flagged. Every catalogue value carries its source URL and the snippet it came from.
4. **Metric everywhere.** Store mm, mm² and g. Convert to inches or AWG only for display and export, when the user picks imperial.
5. **Keep it static.** No server, accounts or telemetry. Nothing leaves the user's browser except what they export or share.
6. **Crawl politely.** Obey robots.txt and site terms, rate-limit, cache, and identify the crawler with a contact address. Never commit scraped pages or third-party photos; the repo is public.
7. **Keep the retailer out of the repo.** Never name the retailer site in code, config, tests, fixtures, docs or commit messages. Its URL and page selectors live in a git-ignored local config read by a generic adapter. Committed catalogue values cite manufacturer documents; retailer-only provenance, prices and shop links stay in the local cache.
8. **No live network in tests.** Use synthetic fixtures.
9. **Test as you build.** Unit tests for geometry, checks and lengths; golden-file tests for exports; round-trip tests for sharing; Playwright for core flows.
10. **Keep dependencies lean.** Ask before adding anything heavy, such as a UI component suite or a CAD kernel. Every dependency must be compatible with the MIT licence.
11. **Ask on domain questions that touch safety or data,** such as a default threshold. Otherwise pick a sensible default and note it in the milestone report.
12. **Stay in scope.** Park new ideas in `docs/ideas.md` rather than building them.
13. **Never imply approval.** No UI text or export may suggest a design is approved or airworthy. Panel changes still go through the normal UK CAA inspection and approval route.

## Conventions

- Geometry in mm, y up, origin at the panel datum; rear view mirrors x; depth z is rearward from the panel back face.
- A part mounted to another part cuts nothing in the panel; its depth band starts at the parent's plus `dz` (ADR 0007).
- Check distances are within `FLATTEN_TOL` (0.01 mm) of exact; no hand-rolled polygon booleans or offsets (ADR 0005).
- Every document edit goes through `DocStore.dispatch` as ops, so it is undoable. UI state (`store/ui.ts`) is not.
- Every user action is a command in `editor/commands.ts`, so menus, palette and shortcuts stay in step.
- Every cut output (SVG, DXF, tiled PDF) is written from the one drawing in `export/drawing.ts`; drawing text sizes are cap heights (ADR 0008).
- Exports and share links never leave the browser except as a download or a URL fragment (ADR 0009).
- Nets are derived from wires after every wiring edit (`wiring/nets.ts`); never edit nets alone. Wire charts in `wiring/charts.ts` are transcribed with their source; do not add chart values without one.
- Discovery candidates keep their verbatim snippet; only reviewed, maker-sourced values reach `catalogue/` (ADR 0011). `python -m pytest` in `tools/` runs the tool tests.
- Work is autosaved and snapshotted in IndexedDB; preferences (theme, key bindings, welcome seen) are in `localStorage` via `store/prefs.ts`. Anything that replaces the working copy goes through `replaceWork` in `store/recovery.ts`, so it is kept as a snapshot first (ADR 0013).
- Templates hold only the panel: outline, bend lines, fixing holes, keep-outs, depth and clearance. Instruments and other parts belong in the project, never in a template.
- Template photos stay in the browser (IndexedDB). Traced features are stored in template mm and remapped through the photo when calibration changes (ADR 0010).
