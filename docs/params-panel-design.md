# Params and panel: declared knobs, one control surface

Design sketch, 2026-08-11. Target: v0.2, alongside the first family
migrations. Prior art: Unity's shader property blocks (declare parameters,
the engine renders the inspector), and the dat.GUI / Tweakpane / Leva
lineage in JS. Both inspire the shape; neither carries the two properties
this design is actually for: declarations that live in the deployment
package, and controls that know when they are locked by a declaration.

## defineParams

A simulation declares its parameters as a typed schema:

```js
const params = defineParams({
  evaporation: { type: 'number', min: 0.9, max: 0.999, step: 0.001,
                 scale: 'log-complement', default: 0.99,
                 label: 'Evaporation', group: 'medium',
                 provenance: 'operator-measured family' },
  sensorAngle: { type: 'angle', min: 2, max: 90, unit: 'deg',
                 default: 60, group: 'agents' },
  showContours:{ type: 'boolean', default: true, group: 'view' },
});
```

The store validates on set, emits change events, and serializes. A figure
spec becomes schema plus current values: a self-describing document, not
a bag of numbers. `scale` matters more than it looks: decay constants
live in 0.9 to 0.999 where a linear slider is useless; declaring the
scale moves that knowledge out of hand-tuned page code and into the
contract.

## Three control classes

- **Knobs**: writable parameters, rendered by type (slider with live
  readout, toggle, select, angle dial).
- **Gauges**: read-only derived quantities a page registers (Betti
  numbers, measured half-life ratios, fps). Same visual family as knobs,
  never writable.
- **Locks**: a parameter marked `prereg` renders display-only, showing
  its declared value and a lock glyph. Exploration mode shows sliders;
  measurement mode shows the declaration. One page cannot quietly be
  both, because the panel will not render a writable control for a
  declared value.

## One visual language

The panel library renders every store the same way, themed by CSS custom
properties. The tokens are codified from the existing simulation pages
rather than invented: dark ground, single accent, monospace readouts,
grouped sections with small-caps headers. Color rule inherited from the
roadmap: hue is data or brand, never both in one figure; panel chrome is
brand, plotted color is data.

## Shell integration: the first envelope

Inside the lab shell, apps run in sandboxed frames. For an app that
declares its parameters in its package (a `params.json` beside
`app.json`, or inline), the shell renders the panel itself, outside the
frame, and parameter changes cross as typed messages on the declared
channel: `param-set@1` (and `param-ack@1` back). This is the
`capabilities` field's first concrete schema. The consequence is worth
stating plainly: the shell can offer a full control surface for an app
without reading a line of the app's code, and an app author gets a
finished UI by writing a schema.

Frozen-golden apps are exempt by definition: their pages are preserved
bytes, and their hand-built panels stay as shipped. Declared panels are
for sdk-pages and instrument-views.

## First consumers, in order

1. The welded-fields family migration: its 21-parameter table becomes
   the first declared schema, and the re-composed page drops every
   hand-bound slider.
2. The configurator example in this repository, currently hand-rolled.
3. Instrument-views: gauges bound to fields of a run's published
   results, locks bound to its preregistration. A measurement page whose
   panel is generated from the same declaration that gated the run.

## Non-goals

- Not a general UI toolkit. Three control classes, grouped sections,
  one theme contract. Anything fancier belongs to the page.
- No two-way magic. The store is the single source of truth; the panel
  renders it; envelopes carry deltas. No hidden binding layer.
