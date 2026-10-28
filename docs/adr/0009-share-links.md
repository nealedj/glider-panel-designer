# 0009. Share links: deflated project in the URL fragment

- Status: accepted
- Date: 2026-10-11

## Context

The brief asks for designs to be shared by link with no server. Links refer to catalogue
parts and library templates by ID and version, embed custom parts and templates whole, and
never carry photos. A link that would pass a length target (default 8,000 characters) falls
back to a project file. Opening a link makes a local copy, and the sender's design never
changes.

## Decision

- **Format:** `#p=1.<payload>`.
  - `1` is the link format version.
  - The payload is the project JSON (the same document as the project file, so the
    references and embedding rules come for free), compressed with the browser's
    `CompressionStream('deflate-raw')` (raw DEFLATE, RFC 1951), then base64url-encoded
    without padding.
  - Everything sits after `#`, so it is never sent to a server.
- **Decoding** checks, in order:
  1. the link format version;
  2. whether the data inflates and parses;
  3. the project `schemaVersion` (a newer one asks the user to reload and update);
  4. the zod schema.

  Each failure has its own plain message.
- **Opening a link:**
  - The working copy it replaces is saved to a second IndexedDB record (`before-link`) and
    can be restored from **File › Restore work from before a share link**.
  - The fragment is then removed with `history.replaceState`, so a reload does not reopen
    the link over later edits.
  - A link pasted into an already open tab is handled through `hashchange`.
- **Length target:** 8,000 characters for the whole URL. It can be changed in the share
  dialog and is kept in `localStorage`, since it is a preference about the user's chat tools,
  not about the design. Over the target, the dialog offers **Save project file**, with
  **Show the long link anyway** as a secondary choice.

## Alternatives considered

- **Gzip or zlib framing** (`deflate`): adds header and checksum bytes and gains nothing,
  because the zod schema already rejects corrupted data.
- **Minifying keys or stripping defaults before compressing:** saves a little, but DEFLATE
  already removes most of the repetition, and it would make links harder to debug and the
  round trip harder to prove. The sample project's link is 739 characters, and a 200-part
  panel's is under 5,000.
- **A URL shortener or paste service:** needs a server and sends the design to a third
  party.

## Consequences

- Every fixture project round-trips through a link and through a project file unchanged
  (`tests/share.test.ts`, `tests/exports.test.ts`).
- Until wiring arrives, the designs most likely to need the file fallback are those with
  finely traced custom templates. A 1,500-point traced outline makes a link of about 16,000
  characters.
- Bumping the link format version is how the payload could change later (for example, a
  denser encoding once M6 adds wires).
