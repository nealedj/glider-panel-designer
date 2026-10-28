# Glider Panel Designer

A browser-based, CAD-style 2D tool for planning glider instrument panels: the front face,
the rear of the panel (depth and stacking) and the wiring, all from one model. Its outputs
are 1:1 cutting templates, a wiring diagram, a wire list and a bill of materials.

> **Planning aid only.** Nothing this tool produces means a design is approved or airworthy.
> Panel changes go through the normal inspection and approval route (UK CAA, with EASA rules
> largely applying). Verify every dimension against the real parts before cutting.

Everything runs in your browser. There is no server, no account and no telemetry; your design
stays on your machine unless you export or share it.

## Status

| Milestone | State |
| --- | --- |
| M0 Foundations | done |
| M1 Front editor | done |
| M2 Rear and stacking | done |
| M3 Exports and sharing | done |
| M4 Panel templates | done |
| M5 Asset discovery | done (tools ready; live run and review pending) |
| M6 Wiring and pneumatics | done |
| M7 Reference panel and polish | done (in software, on placeholder parts; see `docs/questions.md`) |

## Develop

```sh
cd app
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run e2e        # browser tests (first: npx playwright install chromium)
npm run gen        # regenerate schemas/ and generic catalogue parts
```

The first visit shows a welcome and a three-step first-panel walkthrough; `?` lists every
shortcut. File › Open PIK-20D example project opens the PIK-20D re-panel this tool was built for.

See `CLAUDE.md` for the repo layout and working rules, and `docs/adr/` for design decisions.

## Licence

MIT. The catalogue holds facts (dimensions, pinouts, current draw) with links to the makers'
own documents; it does not redistribute anyone's photos.
