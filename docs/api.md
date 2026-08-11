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
- `bg` — accepts a hex string (`"#0a0a0f"`), `rgb(...)` string, or `[r, g, b]` array.

All other keys map directly to `params.*`.

## Gradients

Named gradients available via `data-gradient` or `opts.gradient`:

| Name | Hue range | Notes |
|---|---|---|
| `spectrum` | 0..360° | Default. Full rainbow, locked to closure period. |
| `cogos` | 240..285° | Violet/indigo — CogOS sub-brand. |
| `mod3` | 165..210° | Cyan/teal — mod3 voice sub-brand. |
| `research` | 28..58° | Amber/gold — research sub-brand. |
| `constellation` | 305..340° | Magenta — constellation trust sub-brand. |
| `duotone` | 260..190° | Violet → cyan two-tone. |
| `mono` | 260°, lightEnd 95% | Accent → white luminance ramp. |

Custom gradient objects:
```js
createTrefoilMark(el, {
  gradient: { hueStart: 120, hueEnd: 180, sat: 65, light: 58 }
});
```

Fields: `hueStart`, `hueEnd` (degrees), `sat` (%, default 70), `light` (%, default 60), `lightEnd` (% at hueEnd, defaults to `light`).

## Window globals

The library exposes two globals when loaded in a browser:
- `window.createTrefoilMark` — the imperative constructor.
- `window.MYRGIC_GRADIENTS` — the named gradient table.

## CommonJS

```js
const { createTrefoilMark } = require('./eigen-form.js');
```

Note: `createTrefoilMark` requires a DOM canvas element at call time. In server-side contexts, the module loads without error but `createTrefoilMark` will need a canvas implementation (e.g. `node-canvas`).
