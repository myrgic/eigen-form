# eigen-form roadmap

eigen-form renders mathematical objects, not sprites. Every visual element is
a rigorously defined mathematical object, parameterized at the level of its
governing equations, renderable at arbitrary resolution. v0.0.2 ships one
family: the (p, q) torus knot, drawn as a wavefront tracing its orbit against
a fading substrate. This roadmap is the path from that single primitive to a
library of families with a public gallery.

## Design principles

These hold at every version below.

1. **Equations first.** A primitive is its governing equations plus a
   parameter table. The renderer is downstream of the math, never the other
   way around.
2. **Process-honest rendering.** Steady states are reached by running the
   dynamics, not by painting a stored picture of them. The reduced-motion
   fallback is the real system stopped, not a reconstruction. Depth and
   crossing order emerge from the drawing process itself.
3. **One source of truth for parameters.** Every tunable lives in one table
   per primitive, serializable, with documented ranges. No magic numbers in
   the draw loop.
4. **Hue is data or brand, never both at once.** Brand palettes color marks.
   When a primitive renders measured quantities, color maps are chosen for
   perceptual honesty (uniform cyclic maps for phases, monotone ramps for
   magnitudes) and the two modes are never mixed in one figure.
5. **Figures can answer for themselves.** A rendered figure binds to its
   inputs: which primitive, which parameters, which data, which version.
   Reproducibility is a rendering feature.

## v0.1 - seams

Split the single-file engine along its natural joints. No new capability,
strictly a re-architecture, proven by the existing examples rendering
identically.

- `dynamics/`: the parametrizations and the substrate model (deposit, decay,
  half-life). Pure functions of time and parameters. No canvas, no DOM.
- `palette/`: gradients and color sampling, including perceptually uniform
  cyclic maps alongside the brand bands.
- `backends/`: canvas 2D first, then a headless raster backend that runs
  without a browser. Headless rendering enables golden-image regression
  tests: reference renders committed with hashes, so any change to output is
  a loud, reviewed event.
- `lifecycle/`: page integration. Auto-init, animation loop, visibility
  pausing, reduced motion. The only layer that knows a DOM exists.
- Figure specs: a primitive instance exports its full parameter state as a
  small versioned document, and can be reconstructed from one.

## v0.2 - families

New primitive families, each earning its place by the same standard as the
torus knot: defined by governing equations, parameterized at that level.

- **Field substrates.** The trail fade in v0.0.2 is a deposit-and-decay
  process rendered in canvas alpha. Promote it to a first-class field
  primitive with an explicit grid, so the substrate a wavefront writes into
  can also be measured, seeded, and rendered on its own.
- **Contours.** Iso-line rendering over any field primitive: nested
  topographical rings, computed by marching squares, that merge and split
  with the field.
- **Phase fields.** Complex-valued fields rendered by domain coloring:
  magnitude as brightness, phase as hue on a uniform cyclic map. Windings
  and defects become visible, countable objects.
- **Curves and flows.** Streamlines, tracers, and closed-orbit detection
  over vector fields. A tracer that closes on its own path is promoted to a
  persistent loop. The torus knot becomes a special case of a closed orbit.

## v0.3 - the gallery

The GitHub Pages site grows from a showcase into a hub.

- One page per family, rendered by the library itself. The page about
  contours draws its own diagrams with the contour primitive.
- Study pages on the great visualization libraries and what eigen-form
  learned from each, demonstrated in that library's own idiom: pipeline
  architecture, grammar-of-graphics specs, derived fields, backend seams,
  orthogonal micro-modules.
- Real data. Gallery figures bind to published datasets through a small
  manifest (source, parameters, content hashes), so any figure can answer
  where its numbers came from. Toy data is labeled as toy data.

## Non-goals

- Not a charting library. Axes, legends, and dashboards belong to other
  tools; eigen-form supplies primitives those tools can host.
- Not a 3D engine. Depth stays emergent (paint order, parallax) until an
  honest need for real geometry arrives, and then it arrives as its own
  backend, not a rewrite.
- No hidden global state. Anything that changes a render is in the parameter
  table.

## Origin

The library began as the engine for the Myrgic mark: a (2, 3) torus knot
whose crossings emerge from its own maintenance. That origin sets the bar
for everything that follows. The mark is not a logo drawn once; it is a
process kept alive, and the library exists to render more objects with that
kind of honesty.
