# 0001. Static TypeScript app with React and Vite

- Status: accepted
- Date: 2026-10-11

## Context

The brief requires a browser-only tool with no server, accounts or telemetry, deployed from
an open-source repo. Users are on desktop browsers; the editor needs a rich, stateful UI.

## Decision

- TypeScript (strict), React 19, Vite 8. Build is a static bundle with a relative base path,
  so it can be served from any static host or sub-path.
- Vitest for unit tests, Playwright (Chromium) for flows.
- GitHub Actions runs typecheck, unit tests, e2e and build on every push and PR. CI does not
  deploy anywhere; there is no hosted copy (amended 2026-10-28, GitHub Pages dropped).
- No UI component suite. A small hand-written set of panels and fields keeps the bundle lean
  and lets the drafting style of DESIGN.md come through.
- No external fonts or CDNs at runtime: the font stack falls back to system fonts, so the app
  makes no third-party requests.

## Alternatives considered

- Svelte or Solid: smaller runtimes, but React's ecosystem (elkjs bindings, testing) and the
  brief's recommendation tip it.
- Electron or Tauri: out of scope by decision.

## Consequences

Everything, including exports and template image processing, must run in the browser.
