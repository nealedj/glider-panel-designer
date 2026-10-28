# 0013. Onboarding, crash recovery, preferences and the rear layout

- Status: accepted
- Date: 2026-10-14

## Context

M7 asks for onboarding, a shortcut map, themes and crash recovery, and proves the tool on
the reference panel (a PIK-20D re-panel). The brief lists these:

- a first-run sample project and a three-step "first panel" walkthrough;
- a shortcut map on `?`, with every default control rebindable;
- light and dark themes;
- unlimited undo, autosave and crash recovery.

It also lists the outputs David must produce, which include a rear layout. That needs a
rear-layout export, which did not yet exist.

The app is static. Nothing leaves the browser, so all of this must live in browser storage.

## Decision

- **Storage:**

  | Store | What it holds | Notes |
  | --- | --- | --- |
  | `localStorage` key `gpd.prefs` | Preferences: theme choice (`light`, `dark` or `system`), the "welcome seen" flag, and key binding overrides by command id | Kept apart from projects. |
  | IndexedDB `glider-panel-designer` | Work: the `autosave` store (unchanged) and a new `snapshots` store (database version 2) | |

  Every read and write tolerates storage being unavailable. If it is, the defaults apply
  and work lasts for the session only.
- **Autosave:**
  - Saved 600 ms after each edit, as before.
  - Also flushed at once when the tab is hidden or closed, or when an error escapes.
  - An IndexedDB write started during unload may never finish. So on page hide a
    synchronous copy also goes to `localStorage` (`gpd.unload-copy`). On start, the newer of
    the two copies wins. A completed IndexedDB autosave clears the copy.
- **Snapshots:**
  - **When:** one every three minutes while editing, one at the start of a session, and
    one before anything replaces the working copy. That covers a new project, opening a file,
    a sample or a share link, and recovering a snapshot.
  - **How many:** the newest 30 are kept. A snapshot identical to the newest replaces it
    (new time and reason), so reloads do not fill the list.
  - **Unreadable autosave:** one that no longer parses (damaged, or saved by a newer version)
    is moved whole into the snapshots before anything can overwrite it. It can be downloaded
    from File › Recover earlier work.
- **Error boundaries:**
  - The left panel, the centre and the right panel each have a React error boundary, so a
    crash in one leaves the others working.
  - The fallback offers: try again, undo the last change, download the project file,
    recover earlier work, or reload.
  - A crash in drawing never changes the document, so the work shown is the work saved.
- **Key bindings:**
  - Commands keep their shipped shortcut. An override replaces it in the registry, so menus,
    the palette and the shortcut map all show the binding in use.
  - A new key is refused if another command answers to it in any view where this one is
    active. The template editor's own `F`, `S` and `W` therefore do not clash with the panel
    editor's.
- **Onboarding:**
  - **When:** the welcome shows only on a first visit, meaning no autosave, no link and the
    flag not set.
  - **The walkthrough:** a card docked over the canvas, not a modal. Each step moves on when
    the user does it: creating a project on a template, placing a part, running an export.
  - **New project:** File › New project now opens a dialog that picks the template. It
    starts on the current project's template.
- **Open pins before wiring:** until the first electrical wire exists, open power and ground
  pins are one note ("Wiring not started"), not an error per pin. The same applies to
  pressure ports before the first tube. Without this, a front layout alone would raise
  errors that block the cut file. Once wiring starts, every open pin is an error again.
- **Off-panel parts in the library:** the battery, inline fuse, speaker, antennas, PTT and
  pressure sources are now in the parts library, marked "off panel":
  - they are placed where their wiring leaves the panel, at the loom depth;
  - they are hidden in the front view;
  - they are needed to wire a panel without editing the file.
- **Rear layout export** (`export/rear.ts`):
  - The back of the panel, mirrored as the fitter sees it.
  - Bodies are shaded in 25 mm depth steps; mounted parts are dashed.
  - Looms are drawn at their bundle width and named, and exits are listed.
  - A depth table (deepest first) gives each part's band and what it is mounted on.
  - Outputs are A3 PDF and layered SVG, from the same scene.

## Alternatives considered

- **Everything in IndexedDB.** It cannot be written reliably while the page unloads, and
  preferences are needed before the first frame (to avoid flashing the wrong theme). So
  preferences and the unload copy go in `localStorage`, which is synchronous.
- **Undo history persisted across reloads.** That would mean a growing store and schema
  migrations for old operations. Snapshots give most of the safety for much less.
- **A modal tour that highlights each control.** It blocks the canvas the user is meant to
  use, and breaks when the layout changes. A docked card that reacts to what the user does
  is simpler and never traps them.
- **Errors for every open pin from the start.** It is honest but noisy, and blocks the cut
  file before wiring is even begun. One note is just as visible and keeps the export usable.

## Consequences

- **Two tabs.** Two tabs on the same origin still autosave over each other; the snapshots
  make that recoverable. Parked in `docs/ideas.md`.
- **Lost history.** A crash loses the undo history. Snapshots and the unload copy keep the
  work itself.
- **Browser tests.** They start as a returning user (`e2e/onboarded.json` presets the
  welcome flag). The onboarding test clears it.
