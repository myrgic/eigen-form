> **v0.0.1** — torus-knot family only. Broader primitive families v0.2+.

# eigen-form API Reference

## Data-attribute API (auto-init)

Place a `<canvas>` with the `data-myrgic-mark` attribute anywhere in your document. The library auto-initializes all matching canvases on `DOMContentLoaded` (or immediately if the document is already loaded).

```html
<canvas data-myrgic-mark width="1080" height="1080"></canvas>
<script src="path/to/eigen-form.js"></script>
```

All options can be set via `data-*` attributes on the canvas element:

| Attribute | Type | Default | Description |
|---|---|---|---|
| `data-emergence` | `"true"` | — | If `"true"`, plays the full appear→translate→settle→trail-grow sequence. Omit for steady state. |
| `data-period` | number (ms) | `3000` | Orbital closure period. |
| `data-scale` | number (px) | `215` | Trefoil scale on the logical 480×480 canvas. |
| `data-ball-radius` | number (px) | `18` | Wavefront point radius. |
| `data-stroke-width` | number (px) | `2 * ballRadius` | Trail stroke width. |
| `data-decay` | number (ms) | `6000` | Substrate memory half-life. |
| `data-precession` | number (ms) | `0` | Centroid rotation period. Positive = prograde, negative = retrograde, 0 = disabled. |
| `data-parallax` | number (0..1) | `0` | Hue-parallax strength. 0 = hue locked to orbit; 1 = ±1 orbit shift per closure. |
| `data-gradient` | string | `"spectrum"` | Named gradient. See Gradients section below. |
| `data-p` | integer | `2` | Angular eigenmode integer. |
| `data-q` | integer | `3` | Radial eigenmode integer. (p=2, q=3 → trefoil) |

## Imperative API

```js
const controller = createTrefoilMark(canvasEl, opts);
```

- `canvasEl` — a DOM canvas element, or a string ID.
- `opts` — options object (same keys as data attributes, camelCase).

Returns a controller object, or `null` if the canvas is not found.

### Controller

| Property / Method | Description |
|---|---|
| `controller.params` | Live parameter object. Read to inspect current values. |
| `controller.setParam(key, value)` | Update a single parameter at runtime. |
| `controller.reset()` | Reset canvas to substrate color and restart the animation. |
| `controller.stop()` | Cancel the animation frame loop. |
| `controller.time` (getter) | Current virtual time in milliseconds. |

#### `setParam` special keys

- `gradient` — accepts a named string or custom object; automatically resolved through `resolveGradient`.

All other keys map directly to `params.*`.

## The host owns the ground

The mark owns no background/reference color, at any layer: no construction
option, no `setParam` key, no `data-*` attribute. The canvas is always
transparent and composites onto whatever the host page renders behind it —
that's the host's call, not the engine's. This is the same module boundary
`src/panel` already follows (the panel never carries its own color
default; the host page's `tokens.css` supplies `--bg` and every other
token). If your page wants a seamless backdrop, set it on the host element
that contains the canvas (`body { background: ... }`, or a wrapping `.stage`
element's own background) — see `examples/basic.html` for the plain case.

## Gradients

The color band is a fully configurable set of panel parameters, not a
menu of named presets: `hueStart`, `hueEnd` (degrees, 0..360), `sat`
(%), `light` (%), and `lightEnd` (%, at `hueEnd`, defaults to `light`).
`data-gradient` / `opts.gradient` accepts either a custom object with
those fields, or the one surviving named preset:

| Name | Hue range | Notes |
|---|---|---|
| `spectrum` | 0..360° | Default. Full rainbow, locked to closure period. Also the values a fully-open band settles to (`hueStart:0, hueEnd:360, sat:70, light:60`). |

The org sub-brand rows (`cogos`, `mod3`, `research`, `constellation`)
and the ad hoc `duotone`/`mono`/`madder` variants that used to live
here as named presets are retired (v0.3) — every look they produced is
reachable by dialing the same knobs directly (e.g. `hueStart: 240,
hueEnd: 285` for the old `cogos` band, or `hueStart: hueEnd` for a
monochrome ramp).

Custom gradient objects:
```js
createTrefoilMark(el, {
  gradient: { hueStart: 120, hueEnd: 180, sat: 65, light: 58 }
});
```

Fields: `hueStart`, `hueEnd` (degrees), `sat` (%, default 70), `light` (%, default 60), `lightEnd` (% at hueEnd, defaults to `light`).

A locked or exported figure spec (`exportSpec()`, see `docs/parameters.md`
and `src/figure-spec.js`) carries whatever band values were in effect
at export time directly — clamped band values travel with the spec by
construction, the same as every other tunable, with no special-casing.

## Woven mark: stills and the animated pen

`createTrefoilMark` is built for live motion: it stamps short chords and fades
the canvas every frame. Frozen (an icon, a screenshot, a recording) that shows
as scalloped edges and stepped colour bands. `src/render/knot-pen.js` draws the
same (p,q) knot, from the same `knotPoint` geometry and `colorFor` palette, as a
woven object instead. Each frame is painted from scratch, back to front by the
knot's height, and every crossing leaves a gap in the strand beneath.

```js
import { createKnotPen, createKnotPenMark } from 'eigen-form';

const pen = createKnotPen({ p: 2, q: 3, size: 1024 });
pen.drawStill(ctx);          // the woven still: colour fixed to position, no pen
pen.drawFrame(ctx, t);       // t in laps; the pen is at t mod 1 and rewrites the
                             // knot over its older paint, casting the same gap

createKnotPenMark(canvas, { p: 3, q: 4, stroke: 0.065, lapMs: 3000 }); // animated
```

| Option | Default | Meaning |
|---|---|---|
| `p`, `q` | 2, 3 | knot. The diagram has `q*(p-1)` crossings (`diagramCrossings`) |
| `size` | 1024 | square output, px |
| `fill` | 0.80 | knot diameter (incl. stroke) / size |
| `stroke` | 0.10 | stroke width / size (0.065 suits (3,4), (2,5)) |
| `gap` | 0.5 | crossing gap each side, in stroke widths |
| `ground` | `#070707` | ground colour; `null` = transparent (gaps erased) |
| `gradient` | `spectrum` | same band objects as `createTrefoilMark` |
| `hueRatio` | 4/3 | hue period / lap. 1 = colour locked to position. The loop is seamless after `laps` with `laps / hueRatio` whole |
| `fadeMin` | 0.4 | brightness of the oldest paint |
| `ball` | 0.9 | pen ball diameter in stroke widths; 0 = none |

The pen is painted at the depth of its own stretch of curve, so a strand that
truly passes over it hides it, and its own fresh trail never does. It passes
under exactly `q*(p-1)` crossings per lap, which `tests/knot-pen.js` checks.

Export: `apps/woven_mark/` is the interactive page (still / frame PNG
downloads). `tools/knot_pen_export.py` writes a still PNG, a frame sequence, an
MP4 and a GIF through headless Chromium plus ffmpeg:

```sh
uv run --no-project --with playwright python tools/knot_pen_export.py --p 3 --q 4 --seconds 12 --out out/four
```

## Window globals

The library exposes two globals when loaded in a browser:
- `window.createTrefoilMark` — the imperative constructor.
- `window.MYRGIC_GRADIENTS` — the named gradient table.

## CommonJS

```js
const { createTrefoilMark } = require('./eigen-form.js');
```

Note: `createTrefoilMark` requires a DOM canvas element at call time. In server-side contexts, the module loads without error but `createTrefoilMark` will need a canvas implementation (e.g. `node-canvas`).
