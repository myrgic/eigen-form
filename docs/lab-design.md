# the eigen-form lab: the declarative app contract

Founding design, 2026-08-11. Folded into this repository 2026-08-11: the
lab was drafted in a separate checkout and merged in whole once it became
clear it was never a separate product, it is the gallery this library's
own roadmap (`ROADMAP.md`, v0.3) already called for. This document is the
contract; the reconciler enforces it.

## Layout

```
eigen-form/
  src/                      the library: dynamics/, palette/, backends/,
                             lifecycle/, figure-spec.js, eigen-form.js
  apps/<id>/
    app.json                 the declarative package (the whole contract)
    index.html                the page
    manifest.webmanifest      web app manifest (when installable)
    sw.js                     service worker, scoped to this directory
    icon.svg
    specs/                    figure specs the page can mount (optional)
    data/                     published dataset + its manifest (instrument
                              views only; vendored, hash-pinned)
  hub/
    index.html                the shell (installable)
    registry.json              GENERATED. Never hand-edited.
    manifest.webmanifest
    sw.js
    icon.svg
  tools/
    golden.js                  library op-stream regression goldens
    lab_build.js                the reconciler described below
  goldens/
    ops-v0.0.2.json             library op-stream hashes (golden.js)
    originals.txt                frozen-original content hashes (lab_build.js)
    README.md                    which file is which
  docs/
    lab-design.md                this document
    ...
  .github/workflows/            check + deploy; the only deploy
```

Everything under `apps/`, `hub/`, `tools/lab_build.js`, and
`goldens/originals.txt` used to live in a standalone repository. It does
not anymore: an app directory next to the library it draws on is a
shorter path than an app directory in a second repository that vendors
the library across a boundary, and the roadmap's v0.3 gallery was always
going to need the library's own source at hand.

## Consuming the library

An `sdk-page` app imports the library's ES-module entry point directly:

```js
import { createTrefoilMark } from '../../src/eigen-form.js';
```

No vendored copy, no bundle, no `dist/` step. This is the same
`type="module"` contract the root `README.md` already documents for
`examples/`: served over `http://` or `https://`, resolved natively by
the browser, and `file://` does not work for the same reason it never
did. An app three directories deep (`apps/<id>/index.html`) reaches the
library at `../../src/eigen-form.js`; the hub shell itself never imports
the library, it only frames apps that do.

A `dist/` snapshot, a single pinned bundle an exported experimental unit
could inline (see `docs/executable-experiments-design.md`), is a
declared future decision, not an oversight: it is deferred until the
export feature actually needs one, so it can be shaped by that feature's
real requirements (hash-pinned, inlined, replay-verified) instead of
guessed at now.

## app.json

```json
{
  "id": "welded-fields",
  "title": "Welded Fields",
  "description": "one line",
  "version": "1.0.0",
  "kind": "frozen-golden | sdk-page | instrument-view",
  "entry": "index.html",
  "provenance": { "derivesFrom": "sha256:...", "changes": [] },
  "sdk": { "eigen-form": ">=0.1.0" },
  "capabilities": { "emits": [], "accepts": [] },
  "pwa": { "installable": false }
}
```

- **kind** is the lab's whole taxonomy. `frozen-golden`: a byte-preserved
  copy of an original page, provenance hash mandatory, changes list
  exactly what differs (normally nothing, or a single vendored-dependency
  line). `sdk-page`: a thin page composed on eigen-form primitives,
  licensed by an equivalence proof against the original it re-expresses.
  `instrument-view`: a page bound to a published dataset it carries in
  its own `data/` directory, manifest and hashes included, so the figure
  can always answer where its numbers came from.
- **provenance.derivesFrom** is always a content hash, never a path.
  Hashes travel across repository boundaries; paths do not. That
  property is why the six day-one apps' provenance hashes needed no
  rewriting when the lab moved into this repository: they still point at
  the same frozen originals, wherever those originals live.
- **provenance.entryHash** (contract clarification, added when the first
  `frozen-golden` apps with declared changes landed): required whenever
  `provenance.changes` is non-empty. A frozen-golden's original file
  lives outside this repository, so the reconciler cannot diff the entry
  against it to confirm the changes list is exhaustive. `entryHash` pins
  the entry file's own content hash at the moment the changes were
  declared and verified by hand; the reconciler then only has to confirm
  the entry still hashes to that value, catching any edit made after the
  changes list was written without re-auditing it. Byte-identical apps
  (`changes: []`) don't need it: their entry hash must equal
  `derivesFrom` directly.
- **sdk** is optional. It names the version of the `eigen-form` library
  an `sdk-page` builds on. A `frozen-golden` app builds on nothing but
  its own frozen bytes, so it omits the field entirely; the reconciler
  treats a present `sdk` field on a `frozen-golden` app as a validation
  error. No `sdk-page` app exists yet, so this constraint is unexercised:
  the reconciler's version check today reads a `hub/vendor/eigen-form.json`
  manifest that this tree does not have, a leftover of the
  vendored-copy design the standalone lab shipped with. Direct
  ES-module import (see above) asks a different provenance question,
  which `src/` version, not which vendored copy, and that question stays
  open until the first `sdk-page` migration forces an answer.
- **capabilities** is the dormant socket for app-to-app messaging:
  typed envelopes on declared edges, brokered by the shell. Empty today;
  declared from day one so that wiring apps together later is an
  addition, not a migration.

## The reconciler

`tools/lab_build.js` enumerates `apps/*/app.json` and:

1. **Validates**: schema; entry file exists; provenance hash present in
   `goldens/originals.txt`; SDK constraint satisfiable (see above,
   presently unexercised); capabilities well-formed.
2. **Derives** `hub/registry.json` deterministically (sorted, stable,
   content only from manifests).
3. In `--check` mode, fails if the committed registry differs from the
   derived one. In `--write` mode, regenerates it.

The registry is a cache of `apps/`. It cannot disagree with the apps,
because disagreement is a build failure. There is no deploy verb
anywhere in the repo: CI runs `--check` (this reconciler and, since the
merge, `tools/golden.js --check` alongside it) and publishes the tree,
so "deploying an app" dissolves into "merging a directory."

## The shell

`hub/index.html` fetches the registry and renders one card per app;
selection loads the app by URL into a sandboxed iframe; every app links
out to its standalone page. The shell is installable, with a service
worker scoped to `hub/` that never intercepts `apps/` paths: each app
owns its own scope. Nested scopes are native service worker behavior;
the nesting is the architecture. That guard is a path check
(`hub/sw.js` ignores any request whose path contains `/apps/`), so it
holds regardless of which repository root the tree is served from.

## Honesty rules

- A figure rendered from data names its dataset by hash.
- An exploratory view is labeled exploratory; a measurement view carries
  a manifest.
- A frozen original is never edited; a change means a new derived app
  with a changes list.
- Counts and claims in this repo's docs should be checkable by a command
  in the repo; where they are not, they are marked as estimates.
