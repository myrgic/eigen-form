# eigen-form

A mathematical design library for parameterized eigenform rendering. eigen-form produces scientifically accurate geometric figures from mathematical primitives — the same equations used in topology and physics research, rendered directly to canvas as brand-quality visual artifacts. It is designed to be equally ergonomic for AI agents and human developers: the data-attribute API auto-initializes with no code; the imperative API exposes every parameter for programmatic control.

> **v0.1**: torus-knot family, now split along its dynamics/palette/backends/lifecycle seams with headless golden-op regression tests. Broader primitive families v0.2+, see `ROADMAP.md`.

Canonical home: this repository (`myrgic/eigen-form`), extracted from
`myrgic/sites` `packages/eigen-form/` on 2026-08-10. The sites checkout
remains a consumer. Showcase: https://myrgic.github.io/eigen-form/

## Quick start

```html
<!-- Auto-initialize with defaults -->
<canvas data-myrgic-mark width="1080" height="1080"></canvas>
<script type="module" src="path/to/eigen-form.js"></script>
```

```js
// Imperative control
const controller = createTrefoilMark(canvasEl, { period: 6, scale: 0.82 });
controller.setParam('halfLife', 3.5);
```

### A note on `type="module"`

As of v0.1, `src/eigen-form.js` is a thin ES-module assembly over the
seams below: it `import`s from them directly, resolved natively by the
browser, with no bundler. That means the script tag needs
`type="module"`, and it means opening an HTML page straight from disk
(`file://...`) generally will not load the mark, since browsers block
ES module fetches across the `file:` origin. Serve the page over
`http://` during local development instead (any static file server
works, for example `python3 -m http.server` from the repo root), and
everything works the same as before. Production is unaffected: GitHub
Pages (and any other static host) serves over `https://`, where this
restriction doesn't apply. This is the honest tradeoff of keeping the
library dependency-free and build-step-free while still splitting it
into real files: native browser module resolution instead of a
bundler, at the cost of `file://` convenience during local development.

## Seams (v0.1)

The engine is split along its natural joints, a re-architecture with no
new rendering capability, proven by every example still rendering
identically (see Goldens, below):

- `src/dynamics/torus-knot.js`: the (p, q) torus-knot parametrization,
  phase windows, smoothstep, and arc-length-bounded stepping. Pure
  functions of parameters and time; no canvas, no DOM.
- `src/dynamics/substrate.js`: the trail's deposit-and-decay fade
  accumulator, as pure state.
- `src/palette/gradients.js`: the named gradient bands, hue/lightness
  sampling along the closure cycle, and color-string parsing.
- `src/backends/canvas2d.js`: every `ctx` call the engine makes, named.
  Agnostic to whether `ctx` is a real `CanvasRenderingContext2D` or the
  capture stand-in below; the same calls either paint pixels or get
  recorded for hashing.
- `src/backends/capture.js`: a stand-in for `CanvasRenderingContext2D`
  that records every call and property set into an ordered op list
  instead of painting, so the engine can run headlessly under Node and
  be hashed for regression. Node-only (uses `node:crypto`); never
  imported by the browser-facing assembly.
- `src/lifecycle/mount.js`: the only file that touches `document`,
  `window`, `requestAnimationFrame`, or `IntersectionObserver`:
  data-attribute auto-init, the animation loop, off-screen pausing, and
  the reduced-motion check.
- `src/figure-spec.js`: a mark's full parameter state as a small
  versioned document (`exportSpec()` / `fromSpec()`), new in v0.1.
- `src/eigen-form.js`: the thin assembly, composing the above into the
  same `createTrefoilMark` public API v0.0.2 shipped. The split changed
  nothing observable.

## Goldens

`tools/golden.js` drives `createTrefoilMark()` headlessly under Node,
with a fixed virtual clock (no real timers, no reduced-motion query) and
the capture backend standing in for the canvas, across six scenarios
(default settle, the first 3000ms of the emergence sequence, a custom
gradient, precession, parallax, and a non-default (p, q)). Each
scenario's op stream is hashed with sha256; the hashes are committed to
`goldens/ops-v0.0.2.json`.

```sh
node tools/golden.js          # regenerate the golden file
node tools/golden.js --check  # compare against it; exits 1 on any drift
```

Any change to what the engine paints, intentional or not, moves a hash.
That's the point: a rendering change becomes a loud, reviewed event
instead of a silent visual drift.

## The lab

`hub/` is the eigen-form lab: a gallery of simulations, each packaged as
its own installable web app under `apps/`, served from one hub page that
is generated rather than written. Live: https://myrgic.com/eigen-form/hub/

Three rules hold the contract together, detailed in `docs/lab-design.md`:

1. **An app is a directory with a manifest.** `apps/<id>/app.json`
   declares what an app is, where it came from (content hashes, always),
   and what it builds on. Nothing outside the directory needs to know
   how the app works.
2. **The hub is a build artifact.** `hub/registry.json` is derived from
   the app manifests by `tools/lab_build.js` and checked in CI; hand-
   editing it is a build failure.
3. **CI is the only deploy.** Every push runs both reconcilers, this
   library's op-stream goldens and the lab's provenance check, before
   publishing to Pages.

Status: seven apps are live under `apps/` (`node tools/lab_build.js
--write` derives `hub/registry.json`, and its app count is the source of
truth for this line). Six are frozen goldens: five byte-identical to
their originals, one (the AST diffusion study) vendoring its single
external dependency. The seventh, `mark`, is the lab's first native
`sdk-page`: no frozen original, built straight against the library and
provenanced by the `eigen-form` version it was built on
(`docs/lab-design.md`, "app.json"). Every app's provenance is checked,
by hash against `goldens/originals.txt` for the frozen goldens or by
version against this checkout's `package.json` for the native page, and
the hub's registry is checked against the app manifests, on every push,
so `main` can't drift from what it claims to serve.

## Vision

eigen-form is the first library in a planned family of mathematical design primitives. The full vision: a library where every visual element is a rigorously defined mathematical object, parameterized at the level of its governing equations, renderable at arbitrary resolution without rasterization artifacts.

## Documentation

- `docs/api.md` — data-attribute and imperative API reference
- `docs/parameters.md` — full parameter family with ranges and visual descriptions
- `docs/construction.md` — torus knot math, hue parallax, substrate residue, compositing

## License

MIT. Copyright 2026 Myrgic Labs.
