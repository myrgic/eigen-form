# The aquarium: the agent-substrate engine's first configuration

Design note, 2026-09-11. `apps/aquarium/` is the first real consumer of
`apps/aquarium/engine/` (`docs/agent-substrate-engine.md`): a native
`sdk-page` composing the shared kernel-spec engine into a live tank —
fluid, heat, the nitrogen cycle, and three populations sharing one
substrate, plus a small hand-stepped exception (plants) and an app-level
optics layer (the free surface and its caustics).

This document is `docs/lab-design.md`'s "one parameter table" artifact's
companion: the schema itself lives in `apps/aquarium/spec.js`'s `SCHEMA`
export (read by `defineParams`, rendered by `renderPanel` — there is
exactly one copy of every number this app uses, and it is that one).
What follows is the equations each group of knobs controls, what is
kernel-declared vs. approximated vs. hand-stepped, the twin result, and
what remains an open, stated question rather than a claim.

## Layout

```
apps/aquarium/
  engine/            the agent-substrate engine (frozen prior art, this
                      delivery ADDS to it — see "Engine capabilities
                      added for this delivery" below — never rewrites
                      what already shipped)
  spec.js            SCHEMA (the one parameter table) + buildAquariumSpec()
                      (schema values -> a frozen kernel spec) +
                      seedAquarium() (the initial conditions the
                      engine's own zero-default state can't express)
  surface.js          the free surface: a 1D damped driven wave equation
                      on the top row, plus its caustic ray-cast
  plants.js            CPU-side Verlet chains — the one non-engine
                      population
  index.html            the sdk-page: panel, canvas, backend/overlay
                      selects, observables, feed/water-change/reset
  twin.html              extended (this delivery) with a reduced-grid,
                      reduced-population aquarium fixture, 100 steps
  app.json               kind sdk-page, provenance.builtOn
docs/
  aquarium-design.md      this document
```

## The equations, in words (and in channels)

Every channel below shares one `width x height` grid (`spec.js`'s
`BASE_WIDTH`/`BASE_HEIGHT`, scaled down for the `cpu` backend by the
view group's `cpuGridScale`).

- **momentum** (vector, projected divergence-free every step,
  `water` group's `projectionIters`) — the incompressible velocity
  field. Advects temperature, nutrient, oxygen, ammonia, nitrite,
  nitrate, and the fish schooling pair. Sourced by the filter jet and
  intake (`filter` group), fish wake thrust and bubble rise (deposits,
  below), and Boussinesq buoyancy (a declared `buoyancy` reaction:
  `momentum.y -= beta * (temperature - reference)`, up is `-y`).
- **temperature** (scalar, advected by momentum) — heated at a fixed
  cell (`heater` group's `heaterRate`, a declared `source` reaction),
  cooled toward room temperature at the surface (a declared `relax`
  reaction, masked to the top rows).
- **oxygen** (scalar, advected) — exchanged toward saturation at a rate
  proportional to local flow agitation at the surface (a declared
  `exchange` reaction: `oxygen += rate * mask * |momentum| *
  (saturation - oxygen)`), consumed by fish, produced by plants
  proportional to local light.
- **ammonia -> nitrite -> nitrate** (three scalars, advected) — fish
  deposit ammonia; two declared `nitrify` reactions (Monod uptake by a
  spatial, logistically-growing bacteria population, masked to the
  filter media) carry it through nitrite to nitrate; plants consume
  nitrate. `chemistry` group's `chemistrySpeed` scales the bacteria
  growth/death rates so the cycle plays out in minutes, not weeks — a
  declared multiplier, not a different model.
- **nutrient** (scalar, advected) — plankton's own physarum-style
  growth deposit; fish graze it down (a negative deposit on the same
  weld that senses it).
- **light** (scalar, fast diffuse+decay, NOT advected) — caustic ray
  hits scattered in every rendered frame (`surface.js`); the back-
  wall/floor illumination the renderer reads.
- **filterMask / surfaceMask** (static scalars, diffuse 0, halfLife
  Infinity) — seeded once (`seedAquarium`), never written again by any
  reaction; the spatial gates the nitrify/relax/exchange reactions use.
- **fishDensity / fishVelocity** (scalar + vector) — fish's own
  schooling substrate: the boid weld pair (separate/cohere on density,
  align on velocity) the brief calls for.

## Three populations, one non-engine exception

`fish`, `plankton`, and `bubbles` are three NAMED `PopulationSpec`s
(`kernel.js`'s plural `populations` — see "Engine capabilities added"
below) sharing this one substrate:

- **fish** — rheotaxis (a negative `alignAndAdvect` gain anti-aligns to
  the local current — see "A named simplification" below), food-seeking
  + grazing on nutrient, schooling (density + velocity welds), a
  wobble-carried wake-thrust deposit (negative momentum in the fish's
  own direction of travel — Newton's third law), and two inert-wobble-
  carrier welds depositing ammonia and consuming oxygen.
- **plankton** — the physarum reference motor rule applied to nutrient:
  they ARE the field's own writers (positive deposit), fish graze it
  down. Speed is rescaled by the local light level — an APP-LEVEL
  per-frame adjustment (`index.html`'s `stepAppPhysics`), not a
  declared weld; see "A named simplification" below for why.
- **bubbles** — heading forced "up" at spawn/recycle, perturbed only by
  a `wobble` weld (RNG, no field read); horizontal (and slight
  vertical) advection by the local current via `alignAndAdvect`
  (`align: 0`, so heading never re-orients toward the flow); the same
  weld's deposit sends momentum upward. Recycled (not truly destroyed —
  the engine's population count is fixed) at the surface, imparting a
  surface impulse.
- **plants** — the one non-engine population, named as such in
  `plants.js`'s own header: small CPU-side Verlet chains, anchored on
  the gravel line, hand-stepped every rendered frame, coupled to the
  substrate through the engine's own primitives (`bilinearSample` to
  read momentum/light, a nearest-cell scatter to deposit oxygen/
  consume nitrate) rather than a declared `WeldSpec`, because a Verlet
  chain's iterative constraint solve isn't a kernel operation this
  engine has (or, for a handful of small plants, needs) a declarative
  shape for.

## Engine capabilities added for this delivery

Per `docs/agent-substrate-engine.md`'s own promotion path ("Reactions
and the deferred GPU paths get their own twin coverage the first time a
spec actually needs them on GPU" — this IS that first time), this
delivery adds, additively, to BOTH `cpu.js` and `webgl2.js`, with
coverage in `tests/aquarium-engine.js`:

- **`populations`** (plural, named) — three heterogeneous agent kinds
  sharing one substrate; the singular `population` field is untouched.
- **`read.mode: 'none'` + `effect.type: 'wobble'`** — heading perturbed
  by a signed hash-RNG draw, no field read (bubbles' upward drift).
- **Four reaction types** — `buoyancy`, `relax`, `exchange`, `nitrify`
  (grammar in `kernel.js`'s "Capabilities added for the aquarium").
- **A vector-channel `source`** — the filter jet/intake, fixed-
  direction momentum injection.
- **`engine/webgl2.js`'s `scatterAdd`/`uploadChannel`/`uploadPopulation`**
  — NOT kernel-spec primitives (no `ReactionSpec` needed a nearest-cell
  scatter from a position that changes every frame) but the GPU-side
  read-modify-write seam `index.html`'s app-level physics (caustics,
  plant deposits, bubble recycling, plankton speed) needs to stay
  backend-agnostic. `engine/cpu.js`'s `bilinearDeposit`/`addCell`
  (already exported) are the CPU-side equivalent.
- **A pre-existing bug this work newly exercised, found and fixed**:
  a channel with `halfLife: Infinity` made its GPU decay factor exactly
  the JS integer `1`, and `webgl2.js`'s `runFullscreen` uniform dispatch
  (which routes a bare JS number to `gl.uniform1i` or `gl.uniform1f`
  by `Number.isInteger()`) silently misrouted it — neither the
  physarum nor boids twin spec has an `Infinity`-halfLife channel, so
  it never fired before this delivery's `temperature`/`oxygen`/etc.
  channels did. Fixed with a `floatVal` wrapper (`webgl2.js`).

## Process-honest: what is declared, what is approximated

- **Declared, kernel-level**: every channel's diffuse/decay/advect/
  projection; every reaction (`source`, `buoyancy`, `relax`,
  `exchange`, `nitrify`); every population's welds. These run
  identically (within the twin protocol's declared tolerance) on both
  backends.
- **App-level, backend-agnostic by construction**: the free surface and
  its caustic ray-cast (`surface.js`), plant Verlet chains
  (`plants.js`), bubble surface recycling, plankton's light-speed
  coupling. Each uses the engine's own read/deposit primitives
  (`bilinearSample`, `bilinearDeposit`/`scatterAdd`) rather than
  reimplementing sampling or scatter — see each module's header for
  why it is app-level rather than a declared kernel primitive.
- **A named simplification: rheotaxis as anti-alignment.** The engine's
  `alignAndAdvect` effect turns a heading TOWARD the sensed vector's own
  direction (downstream) when `align > 0`. True rheotaxis is "face
  into the current" (upstream), which is not simply "the exact
  opposite direction" after one integration step — a negative `align`
  turns AWAY from downstream, which stabilizes toward facing upstream
  over several steps under a locally-consistent current, but is not a
  from-first-principles rheotaxis model. Named here rather than
  claimed as more than it is.
- **A named simplification: caustics.** `surface.js`'s ray-cast
  refracts once (linearized Snell's law from local surface slope) and
  brightens/dims by a `1/(1+k|slope|)` proxy for ray convergence,
  not a true ray-density Jacobian (which would need tracing
  neighbouring rays and measuring how close together they land). The
  qualitative behaviour (converging rays over a trough brighten,
  diverging rays over a crest dim) is real; the exact intensity curve
  is a stand-in.
- **A named simplification: bubble terminal speed.** Linear in radius
  (`0.12 + 0.35 * normalized radius`), not Stokes' drag (`~radius^2`),
  because true Stokes scaling at this grid's cells-per-step budget
  makes the largest bubbles unrealistically fast relative to the tank
  height — a deliberate, named departure from physical accuracy for
  visual plausibility at this scale.
- **A named simplification: the filter intake.** Declared as a second
  vector `source` (pulling water toward the filter box), which is a
  momentum injection, not a true sink. A real intake removes fluid
  volume; this engine has no divergence SINK primitive (only
  `sink`/`decay` for scalar channels). Named, not hidden — see
  `spec.js`'s `intakeVector` comment.
- **A named limitation: unclamped consumption.** Fish oxygen
  consumption and fish/plankton nutrient grazing remain fixed-rate
  deposits (matching the engine's own agent-deposit primitive, which
  has never clamped either — `cpu.js`'s `depositOnePopulation` adds
  without a floor); a chemistry channel driven that way can still read
  transiently negative very near a heavy, under-supplied consumer. Not
  gated by any acceptance check in this delivery; a future pass could
  rate-limit consumption to locally-available supply the same way
  `nitrify`'s Monod term already self-limits uptake. Plant nitrate
  uptake was the one case this DID surface as a correctness bug rather
  than a transient (`nitrate` reading negative from a fresh tank's
  very first frame, before any nitrogen cycle had produced nitrate to
  consume), and is fixed: `index.html`'s `stepAppPhysics` floors the
  `nitrate` channel at zero right after the plant scatter deposit
  (`clampFieldFloor`, CPU-direct on the reference instrument;
  `webgl2.js`'s `clampChannelFloor` fullscreen pass on the GPU
  projection), the same `max(0, ...)` discipline `nitrify`'s own
  substrate/bacteria outputs already use.
- **Verification: `--virtual-time-budget` dump-dom only ever sees frame
  one, stated plainly, not softened.** headless Chromium
  (`chrome-headless-shell`) under `--virtual-time-budget` has no real
  compositor to pace `requestAnimationFrame` against, and this page's
  own rAF loop does not advance under it regardless of the budget value
  (confirmed 2026-09-11 against a trivial rAF-counter fixture with no
  simulation at all: the counter never got past frame one, for budgets
  from 1s to 15s, with or without
  `--run-all-compositor-stages-before-draw`). Every dynamics defect
  that only shows up after frame one is therefore invisible to a
  `--dump-dom`-based check no matter how the budget is tuned. Three
  such defects (surface height integrating without bound, the
  nitrifying bacteria bootstrap dying before the cycle could start,
  plant chains dragged flat by the current) shipped in this delivery
  undetected until driven in real time (2026-09-11).

  The real recipe, promoted into the repo as `tools/headless_drive.mjs`
  (`npm run aquarium:drive`) rather than left as a one-off: launch
  `chrome-headless-shell --headless --no-sandbox
  --remote-debugging-port=<port> about:blank`, serve this repo with
  `python3 -m http.server <port>`, `Page.navigate` to
  `/apps/aquarium/`, connect over the DevTools protocol (plain
  `WebSocket`/`fetch`, no packages), sleep in real wall-clock seconds,
  and `Runtime.evaluate` the page's own `#observables` panel text at
  each declared sample time, the same panel a human watching the page
  would read. Measured (2026-09-11, this delivery, default params,
  `webgl2` backend, software/SwiftShader GPU): about 1350 engine steps
  at 47-50 fps over 30 real seconds. A `Page.captureScreenshot` at the
  end gives a visual check (plants upright, floor caustics present,
  fish and plankton visible) alongside the numbers. See
  `tools/headless_drive.mjs`'s own header for the full option list; it
  exits non-zero if `#observables` is ever missing or unparsable, or if
  the engine's own step counter never advances, treating either as the
  instrument itself being broken rather than a finding about the app.
- **A genuine per-frame cost, named**: when `backend` is `webgl2`, the
  app-level physics/render layer reads a handful of channels/agent
  states back from the GPU every rendered frame (`index.html`'s
  `refreshFrameCache`) and a wider set every 10th frame
  (`refreshSlowCache`) — a two-tier cache added specifically because
  reading everything every frame measurably dominated real wall-clock
  time under a software (SwiftShader) WebGL implementation, the only
  kind available in this project's headless verification environment.
  A GPU-accelerated browser would not need this tiering as urgently,
  but the tiering is honest either way: none of the slow-tier data
  (chemistry fields, fish-schooling density) changes meaningfully
  frame-to-frame at a fixed reaction rate.

## The twin result

`apps/aquarium/twin.html` now runs three fixtures against
`engine/twin.js`'s protocol: the pre-existing physarum and boids specs
(unchanged), and a new aquarium fixture — `buildAquariumSpec()` at
`cpuGridScale: 0.22` (a 25x16 grid) with population counts shrunk to 6
fish / 30 plankton / 6 bubbles / 0 plants (plants are the declared
non-engine population — nothing here for the twin protocol to compare),
100 steps.

- **`early`** (step 5): momentum relL2 0.040, temperature 3.2e-6,
  nutrient 0.023, oxygen 1.2e-4 — tight. `ammonia` (0.245),
  `fishDensity` (0.260), and `fishVelocity` (0.413) are NOT tight: the
  SAME branching-motor-policy sensitivity `docs/agent-substrate-
  engine.md`'s "The twin protocol" documents for physarum/boids,
  amplified here because these three fields are sparse (near-zero
  except at the handful of cells 6 fish actually occupy), so one
  flipped agent's relative error dominates. `earlyRelL2` is declared at
  `0.45` to fit the measured worst case with margin — a looser bound
  than physarum/boids' `0.02`, reflecting a real difference (few
  agents, sparse fields) rather than a hidden tightening of what
  "early" is supposed to verify.
- **`aggregate`**: nutrient field variance, cpu `1.497` vs. gpu
  `1.205` (19.5% relative difference, within the declared `35%` bound;
  both comfortably above the declared "structure formed" floor of
  `0.01`).
- **`final`**: reported for transparency, not gating `pass` — same
  convention as physarum/boids, for the same reason (a chaotic system's
  exact microstate is not a meaningful comparison after 100 steps of
  three branching-motor populations).
- **Overall**: `pass: true` (physarum, boids, and aquarium all pass).

**A separate, longer-run verification** (not the twin protocol —
correctness/stability, not cross-backend agreement): `engine/cpu.js`
and `engine/webgl2.js` each ran the FULL live-page spec (112x70,
default population counts, all reactions) for 900 steps
(~15s at 60fps) directly, seeded via `seedAquarium`. Both backends
finished with every field finite, `meanAbsDivergence` under `1e-3`
(CPU Gauss-Seidel: `4.2e-4`; GPU Jacobi: `7.5e-4` — see
`docs/agent-substrate-engine.md`'s "Projection: two real bugs" for why
GPU Jacobi's undamped Nyquist mode makes this the harder case, and
`spec.js`'s `softCells` for the mitigation — spreading the heater/jet/
intake point sources over a small soft cluster — this delivery needed
to actually clear `1e-3` under GPU Jacobi), all 16 fish inside bounds,
and `nh3 > 0`.

## What would be measured to test a fish thrust-gain variance-ratio operating point

Left as a **stated follow-up, not a claim**: whether `fishThrustGain`
(the wake-thrust deposit's magnitude) has a variance-ratio operating
point — a value where the ratio of some measure of school-formation
variance to individual-fish trajectory variance is extremized, the way
`docs/...` other Reynolds-number-flavored explorations in this repo
(`ROADMAP.md`'s vortex/boid-drafting lineage) have looked for elsewhere
— has NOT been investigated in this delivery. What that measurement
would need: (1) a declared school-order metric (this app's own
`fishVelocity` field's own order parameter, `engine/twin.js`'s
`orderParameter` already computes the right shape of number off agent
headings), (2) a sweep of `fishThrustGain` at fixed everything else,
holding `fishCount` and `fishSchoolGain`/`fishSchoolAlign` constant,
(3) enough steps per sample for the order parameter to reach a
statistical steady state (this delivery's own boids twin fixture uses
800 steps to cross the 0.5 threshold from a random start — a
comparable order would be needed here), and (4) a repeat count per
`fishThrustGain` value (multiple seeds) to distinguish a genuine
extremum from single-seed noise, given how sensitive this engine's
branching motor policies already are to seed (`agentPositionError`
across even a single flipped tie-break, per the twin protocol notes
above). None of this is built; the parameter (`fishThrustGain`) and
the metric it would be measured against (`orderParameter` on
`fishVelocity`) both already exist in this delivery, ready for that
follow-up to consume without new engine work.
