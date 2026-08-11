# Welded fields: extraction spec (v0.2 pilot family)

Working spec for the first family migration, per ROADMAP.md's recipe.
Written 2026-08-11 from a full read of the pilot sim's source (702 lines).

## Parts list

The sim decomposes into eight pieces; the first four become library
primitives, the next three become analyze-tier functions, the last is page
shell.

1. **Field, three instances of one primitive.** The sim hand-copies the
   same loop three times (separable box blur on a torus, then decay) at
   three scales: fine scalar trail, coarse two-component momentum, coarse
   scalar hormone. One `Field` primitive with (components, scale, decay,
   boundary) parameters replaces all three. The momentum instance also
   carries a running-mean normalization so gain parameters stay scale-free
   under changing agent count; that normalization is part of the primitive,
   not the page.
2. **The weld.** The coupling table between one agent population and its
   fields. Each coupling declares three things:
   - read-as: `gradient` (three-point sense, steering) | `vector`
     (bilinear sample) | `level` (scalar modulator)
   - effect: `steer` | `align` and/or `advect` (kept separate: alignment
     rotates heading, advection translates without touching heading;
     folding them into one term is a recorded failure of an earlier sim)
   - deposit-back: `scalar` (trail) | `momentum` (mass x velocity) |
     `presence` (undirected release)
   Sketch: `weld(agents, [{field, read, effect, deposit, gain}, ...])`.
   The level-read coupling rescales the agent's own turn parameters,
   a field over parameter space rather than state space.
3. **Exogenous noise source.** Procedural value noise with an explicit
   gain; gain zero closes the loop (no input from outside the system).
   Becomes `dynamics/noise` with a required explicit seed (see
   determinism, below).
4. **Agent kernel.** Sense/turn/step with explicit tie-breaks, plus the
   weld couplings. Shares its shape with the existing deposit-decay agent
   engine; the weld is what is new.
5. **Topology census (analyze-tier).** Thresholded mask, Euler
   characteristic by bit-quads, Betti numbers beta1 = beta0 - chi, with a
   history sparkline. Self-documented as verified against known shapes.
6. **Timescale readouts (analyze-tier).** Measured half-lives per field
   and their ratios, displayed live; with noise at zero the controlling
   parameter is the momentum-to-trail half-life ratio, a timescale the
   system owns.
7. **Pooled contours (analyze-tier).** Box-pool then marching squares;
   pooling is a deliberate ~10x cost reduction and a smoothing choice.
8. **Page shell.** Slider bindings (21 parameters), raster + overlay
   canvases, DPR handling, reset/resize. In the gallery page, the slider
   panel is generated from the figure spec instead of hand-bound.

## The two problems extraction must solve

**Nondeterminism.** The original seeds its noise from `Math.random()` and
uses `Math.random()` for agent init and turn tie-breaks, so the recipe's
bit-for-bit gate cannot run against it as-is. Resolution, without editing
the frozen original: the equivalence harness loads the original in a
context that installs a seeded PRNG over `Math.random` before the script
executes; the port routes all randomness through the library's seeded RNG.
Original and port then compare bit-identically on field and agent buffers
at a fixed seed.

**A fourth decay family.** Trail 0.99, momentum 0.94, hormone 0.997; the
sim's own comment marks these as measured operator settings rather than
canonical values. At extraction these become a named preset in the
property table with that provenance preserved.

## Gallery page shape

One figure spec per state, linkable: trail-only, +momentum (alignment vs
advection separately), +hormone, closed-loop (noise gain zero). The page
teaches the weld by adding one coupling at a time, with the Betti and
timescale readouts running throughout. Provenance block points at the
frozen original's content hash; changes list: composed on library
primitives, seeded RNG, no other behavior changes (proven by the
equivalence gate).

## Order of work

1. v0.1 seams land first (dynamics / palette / backends / lifecycle,
   headless backend, goldens). This spec does not start before that.
2. `Field` + `weld` + `noise` primitives, mined from the pilot source.
3. Equivalence harness with the seeded-PRNG shim; bit-identity or
   explained-to-zero.
4. Analyze-tier ports (betti, half-life, pooled contours).
5. The gallery page, spec-driven.
