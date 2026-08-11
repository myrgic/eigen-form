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

An optional `display` block carries shell presentation hints:

```json
{ "display": { "order": 1, "accent": "#a78bfa", "background": "#0a0a0f" } }
```

- **order**: an integer. The reconciler sorts the registry by
  `(display.order ?? 999, id)`, so an app that declares no `display` block
  (or a `display` block without `order`) sorts alphabetically by id after
  every app that does declare one. Lower sorts first.
- **accent**: a CSS color the shell may use to theme that app's tab and
  detail view.
- **background**: a CSS color the shell surrounds that app's iframe with
  (the letterbox color), useful for a light-page app so the shell doesn't
  frame it in dark chrome that clashes on load. Defaults to the shell's
  own `--bg` token when absent.

All three keys are optional and independent; declare only the ones that
matter for a given app. The reconciler checks `order` is an integer and
that `accent`/`background`, when present, are syntactically plausible CSS
colors (a basic shape check: `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` hex, an
`rgb()`/`rgba()`/`hsl()`/`hsla()` function call, or a bare alphabetic
token standing in for a CSS color keyword). It does not validate that the
color resolves to anything, only that it isn't obviously malformed.
`display`, when present, passes through to `hub/registry.json` unchanged
except for whichever keys were actually declared.

Editing `app.json` of a `frozen-golden` app to add or change its
`display` block is allowed: the manifest is lab metadata, not frozen sim
content. Only the entry file's bytes (`entryHash` / `derivesFrom`) are
frozen; nothing in the `display` block touches them.

A native `sdk-page` (one born to the library, no frozen original to point
back at) declares `provenance` differently:

```json
{
  "provenance": { "builtOn": "eigen-form@0.1.0 491c440" },
  "sdk": { "eigen-form": ">=0.1.0" }
}
```

- **kind** is the lab's whole taxonomy. `frozen-golden`: a byte-preserved
  copy of an original page, provenance hash mandatory, changes list
  exactly what differs (normally nothing, or a single vendored-dependency
  line). `sdk-page`: a thin page composed on eigen-form primitives. Two
  ways to arrive there carry two different provenance shapes (below):
  migrated (an existing frozen page re-expressed on the library, licensed
  by an equivalence proof against the original) and native (a page
  written straight against the library, nothing to re-express). Today's
  first native `sdk-page` is `apps/mark`, the trefoil configurator.
  `instrument-view`: a page bound to a published dataset it carries in
  its own `data/` directory, manifest and hashes included, so the figure
  can always answer where its numbers came from.
- **provenance** carries exactly one of two fields, never both and never
  neither. Which one an app uses follows directly from whether it has an
  original to point back at:
  - **derivesFrom**: for a page that re-expresses something that already
    existed outside this repository: every `frozen-golden` app, and any
    `sdk-page` that migrates one. Always a content hash, never a path.
    Hashes travel across repository boundaries; paths do not. That
    property is why the six day-one apps' provenance hashes needed no
    rewriting when the lab moved into this repository: they still point
    at the same frozen originals, wherever those originals live. The
    hash must be present in `goldens/originals.txt`.
  - **builtOn**: for a page with no frozen original, a native
    `sdk-page`, born to this library rather than migrated into it. The
    "equivalence proof against the original" the older wording of this
    contract demanded doesn't apply here; there is no original. What a
    native page can honestly claim instead is which version of the
    library it was built on: `"eigen-form@<semver> <short-commit>"`. The
    reconciler checks the semver segment against this checkout's own
    `package.json` version, exactly, not a range, since `builtOn`
    states what was actually true when the page was authored. A native
    page whose `builtOn` names a version older than the checkout's
    current `package.json` version fails `--check`: the claim has gone
    stale and needs re-authoring against the version actually shipping.
    The commit segment is lineage, not re-verified against git HEAD (an
    app.json's own commit isn't knowable until after it's committed).
- **provenance.entryHash** (contract clarification, added when the first
  `frozen-golden` apps with declared changes landed): required whenever
  a `derivesFrom` provenance's `changes` is non-empty. A frozen-golden's
  original file lives outside this repository, so the reconciler cannot
  diff the entry against it to confirm the changes list is exhaustive.
  `entryHash` pins the entry file's own content hash at the moment the
  changes were declared and verified by hand; the reconciler then only
  has to confirm the entry still hashes to that value, catching any edit
  made after the changes list was written without re-auditing it.
  Byte-identical apps (`changes: []`) don't need it: their entry hash
  must equal `derivesFrom` directly. `builtOn` provenance has no
  `changes` or `entryHash` at all: there is no original to diff
  against, so the concept doesn't apply.
- **sdk** is required for `kind: sdk-page` (both migrated and native) and
  names the version of the `eigen-form` library the page builds on. A
  `frozen-golden` app builds on nothing but its own frozen bytes, so it
  omits the field entirely; the reconciler treats a present `sdk` field
  on a `frozen-golden` app as a validation error. The version check
  reads this checkout's own `package.json`, not a vendored copy: `apps/`
  imports the library's ES module directly (see "Consuming the library"
  above), so there is no vendored snapshot to check against, only the
  question of which `src/` version this tree currently is.
- **capabilities** is the dormant socket for app-to-app messaging:
  typed envelopes on declared edges, brokered by the shell. Empty today;
  declared from day one so that wiring apps together later is an
  addition, not a migration.

## The reconciler

`tools/lab_build.js` enumerates `apps/*/app.json` and:

1. **Validates**: schema; entry file exists; provenance shape (exactly
   one of `derivesFrom` or `builtOn`) with a `derivesFrom` hash present
   in `goldens/originals.txt` or a `builtOn` version matching this
   checkout's `package.json`; SDK constraint satisfiable for every
   `sdk-page`; capabilities well-formed. Failure modes worth naming
   because they're easy to hit while authoring a native app: a
   `builtOn` string in the wrong shape (`--check` demands
   `eigen-form@<semver> <short-commit>` exactly); a `builtOn` version
   that doesn't match `package.json` (stale claim, most often from
   bumping the library version and forgetting the apps that name it);
   `derivesFrom` and `builtOn` both present or both absent (the
   reconciler refuses to guess which provenance story is true); a
   `display.order` that isn't an integer, or a `display.accent` /
   `display.background` that isn't a syntactically plausible CSS color.
2. **Derives** `hub/registry.json` deterministically (sorted by
   `(display.order ?? 999, id)`, stable, content only from manifests).
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

## Sandbox policy by kind

The shell frames every app in a sandboxed iframe, but not with the same
sandbox value: `hub/index.html` reads `app.kind` from the registry and
picks between two tokens.

- **frozen-golden**: `sandbox="allow-scripts"`. These pages are
  preserved bytes from an original outside this repository; nothing
  about them needs, or should get, access to the shell's own origin.
- **sdk-page** (and, once one exists, **instrument-view**):
  `sandbox="allow-scripts allow-same-origin"`. These pages are
  first-party code that `import`s this repository's own `src/*.js`
  module entry directly (see "Consuming the library" above). That
  matters because of how `<script type="module">` loads: a module
  fetch always runs through the CORS algorithm, comparing the
  *document's* origin against the *resource's* origin. A sandboxed
  iframe with only `allow-scripts` has a unique, opaque origin —
  `null` — regardless of which host actually served it, so even a
  module import of a file on the exact same host as the iframe's own
  `src` is treated as cross-origin. A static file server that sends no
  `Access-Control-Allow-Origin` header (this repo's dev server, and
  GitHub Pages by default) then fails that CORS check. The failure is
  silent to the page: the browser blocks the module load with a
  console error in the shape of "Access to script at '.../src/
  eigen-form.js' from origin 'null' has been blocked by CORS policy: no
  'Access-Control-Allow-Origin' header is present on the requested
  resource," the `<script type="module">` tag never runs, and the app
  renders as a blank frame with no other symptom — this was a
  pre-existing bug the uniform `allow-scripts`-only sandbox produced
  for `apps/mark` the moment it was loaded through the shell rather
  than opened directly. `allow-same-origin` gives the iframe back its
  real origin (the page's own serving host), so the module fetch reads
  as same-origin and loads normally. `allow-scripts` plus
  `allow-same-origin` together is the standard, intentional relaxation
  for first-party sandboxed content — it is not equivalent to dropping
  the sandbox, since the frame still cannot navigate the top window,
  spawn new windows without `allow-popups`, or submit forms without
  `allow-forms`.

## Honesty rules

- A figure rendered from data names its dataset by hash.
- An exploratory view is labeled exploratory; a measurement view carries
  a manifest.
- A frozen original is never edited; a change means a new derived app
  with a changes list.
- Counts and claims in this repo's docs should be checkable by a command
  in the repo; where they are not, they are marked as estimates.
