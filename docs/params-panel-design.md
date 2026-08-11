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

`src/panel/tokens.css` is the canonical token file: the palette, spacing,
and `.grp`/`.hd`/`.read` primitives described above, codified from
`apps/welded_fields/index.html`'s `:root` block. It lives in the SDK
rather than the hub shell — `hub/index.html` links it at `../src/panel/
tokens.css` — so an app that renders its own panel via
`src/panel/render.js` gets the same theme by construction, with no
shell-relative path to reach across.

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

## Lessons from the shader inspectors

Source-level review of Unity's material editor and the avatar-shader
inspectors built on it (Poiyomi's Thry editor, lilToon), distilled to
what the panel adopts and what it deliberately rejects:

- **Progressive disclosure is a per-parameter declaration, not a
  global mode.** A param may declare `level: 'advanced'`; the panel
  renders the simple surface by default with the full table one
  disclosure away. State lives per page instance — never editor-wide
  (lilToon stores its Simple/Advanced mode globally, and switching it
  on one material changes every other material's inspector; a known
  usability trap, rejected here).
- **Disclosure and search are independent predicates** over the same
  schema; a filter never mutates the disclosure level.
- **Dependent parameters are declared edges.** When changing one param
  must adjust another (a rendering-mode enum flipping blend state, in
  shader terms), that coupling belongs in the schema as a declared
  action, not in ad hoc panel code. Unity's drawer-attribute system
  and Poiyomi's `on_value_actions` both converge here; ours stays a
  closed set, per the non-goals.
- **Compute units and display units are a declared pair.** Store and
  compute in the natural unit (radians, normalized fractions); present
  the friendly unit (degrees, percent) only at the control's render
  boundary. lilToon does this inside each drawer; here it is a schema
  field, so every renderer converts identically.
- **A modifier key reveals the raw key.** Holding Alt shows each row's
  underlying schema key instead of its label — a debugging affordance
  that costs nothing and pays for itself the first time a preset and a
  panel disagree.
- **Convergent validation:** Unity's `PowerSlider` drawer is our
  `scale` field with an arbitrary exponent; its Properties block is a
  typed schema the default inspector renders with zero custom code —
  the defineParams → renderPanel path, twenty years senior. The closed
  type/scale sets remain the right call against Unity's open
  reflection registry: that registry exists to serve thousands of
  third-party shaders; this panel serves one lab.
