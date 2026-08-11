# eigen-form

A mathematical design library for parameterized eigenform rendering. eigen-form produces scientifically accurate geometric figures from mathematical primitives — the same equations used in topology and physics research, rendered directly to canvas as brand-quality visual artifacts. It is designed to be equally ergonomic for AI agents and human developers: the data-attribute API auto-initializes with no code; the imperative API exposes every parameter for programmatic control.

> **v0.0.2**: torus-knot family only. Broader primitive families v0.2+, see `ROADMAP.md`.

Canonical home: this repository (`myrgic/eigen-form`), extracted from
`myrgic/sites` `packages/eigen-form/` on 2026-08-10. The sites checkout
remains a consumer. Showcase: https://myrgic.github.io/eigen-form/

## Quick start

```html
<!-- Auto-initialize with defaults -->
<canvas data-myrgic-mark width="1080" height="1080"></canvas>
<script src="path/to/eigen-form.js"></script>
```

```js
// Imperative control
const controller = createTrefoilMark(canvasEl, { period: 6, scale: 0.82 });
controller.setParam('halfLife', 3.5);
```

## Vision

eigen-form is the first library in a planned family of mathematical design primitives. The full vision: a library where every visual element is a rigorously defined mathematical object, parameterized at the level of its governing equations, renderable at arbitrary resolution without rasterization artifacts.

## Documentation

- `docs/api.md` — data-attribute and imperative API reference
- `docs/parameters.md` — full parameter family with ranges and visual descriptions
- `docs/construction.md` — torus knot math, hue parallax, substrate residue, compositing

## License

MIT. Copyright 2026 Myrgic Labs.
