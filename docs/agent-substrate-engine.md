# The agent-substrate engine

Design note, 2026-09-11. `apps/aquarium/engine/` is the substrate the
aquarium and every physarum/boids-family app is meant to run on: a
kernel-spec engine, built exactly to the shape
`docs/executable-experiments-design.md`'s "The shader correspondence"
calls for — primitives are kernel specs (operation, stencil, state,
parameters), the CPU path is the reference instrument, and a GPU path is
a checked projection of it, verified within a declared tolerance and
never trusted past that tolerance.

This document is the grammar, the step order, the twin protocol, the rng,
the determinism tiers, and the promotion path into `src/dynamics/`. Read
the module headers (`kernel.js`, `cpu.js`, `webgl2.js`, `twin.js`,
`rng.js`) for the implementation-level commentary; this file is the map.

## Layout

```
apps/aquarium/
  engine/
    package.json   { "type": "module" } — same trick src/package.json
                    uses, so these files can use import/export under
                    Node (tests) as well as in the browser.
    kernel.js       the spec grammar + validation (defineSubstrate)
    rng.js          counter-based hash RNG, JS + its own GLSL port
    cpu.js          the reference instrument
    webgl2.js       the projection backend
    twin.js         the twin protocol (runs both, compares)
  twin.html         runs twin.js for two real specs in a live WebGL2
                    context and reports pass/fail
```

Not registered as a lab app in this lane (see `tools/lab_build.js`'s
carve-out: a directory under `apps/` with neither `app.json` nor
`index.html` is excluded from the registry, not an error) — there is no
`index.html` here yet, on purpose. The engine and its own twin
instrument land first; a real sdk-page (`apps/aquarium/index.html`) that
actually consumes them for a rendered aquarium is a follow-up that will
add its own `app.json` when it lands.

## The kernel spec grammar

A full spec, validated and frozen by `kernel.js`'s `defineSubstrate()`:

```js
{
  width, height,              // grid dimensions, shared by every channel
  seed,                       // uint32 RNG seed
  channels: [ ChannelSpec ],
  reactions: [ ReactionSpec ],  // optional, small fixed vocabulary
  population: PopulationSpec | null,
  tolerance: { relL2, maxAbs, agentPos, earlyStep?, earlyRelL2?,
               earlyMaxAbs?, aggregate? }
}
```

**Simplification, named plainly:** every channel shares one `width x
height` grid. The welded-fields prior art (`apps/welded_fields/`) ran its
momentum and hormone fields on a coarser grid purely as a render-cost
optimization; that is a backend concern, not a semantic requirement of
the weld operator, and folding it into this first version would only
complicate the twin comparison for no scientific gain yet. A future
multi-resolution channel is a compatible extension of this same spec
shape (an explicit `resolution` field per channel), not a rewrite.

**ChannelSpec** — a named float field:

| field | meaning |
|---|---|
| `name` | unique string |
| `kind` | `'scalar'` (1 float/cell) or `'vector'` (2 floats/cell: vx, vy) |
| `diffuse` | 0..1, blend weight toward the declared 3x3 stencil average |
| `halfLife` | frames, or `Infinity` for no decay |
| `advectedBy` | another channel's name (must be `kind: 'vector'`), or `null` |
| `boundary` | `'wrap'` (toroidal), `'wall'` (reflecting/clamped), `'absorb'` (reads as 0 outside the domain, and a deposit landing outside is dropped) |
| `projection` | `{ enabled, iterations }`, vector channels only — Gauss-Seidel divergence-free pressure projection |

**ReactionSpec** — the small fixed chemistry vocabulary (declared, not
coded, per the roadmap's "one source of truth" principle):

```
{ type: 'source', channel, rate, cells: [[x,y], ...] }
{ type: 'sink',   channel, rate }                       // rate in (0,1]
{ type: 'decay',  channel, rate }                       // rate in (0,1]
{ type: 'monod',  from, to, rate, halfSaturation }       // A -> B
{ type: 'product', a, b, into, rate }                    // into += rate*A*B
```

**PopulationSpec** — N agents with `(x, y, heading, speed)` plus free
named scalars, and a declared list of **welds**:

```
{
  count, boundary, speed,
  scalars: { name: defaultValue, ... },
  welds: [ WeldSpec ]
}
```

**WeldSpec** — the pilot's own distinctive primitive (roadmap v0.2, "the
weld"): one coupling between a population and a channel, declaring how
the field is read, what it does to the agent, and what the agent writes
back:

```js
{
  channel,
  read:   { mode: 'gradient', sensorDist, sensorAngle }  // 3-sensor F/L/R
        | { mode: 'vector' }                              // bilinear (vx,vy)
        | { mode: 'level' },                                // bilinear scalar
  effect: { type: 'steerByAngle', gain }                    // needs 'gradient'
        | { type: 'alignAndAdvect', align, advect }          // needs 'vector'
        | { type: 'rescale', scalar, gain },                 // needs 'level'
  deposit: { channel, amount } | null   // vector channel: amount is
                                        // scaled by the agent's own
                                        // velocity (mass x velocity, in
                                        // the direction it actually
                                        // travelled), per weld
}
```

`steerByAngle`'s motor logic is the physarum reference rule
(`apps/physarum/index.html`'s cogdoc calls it "hysteresis"): go straight
if the forward sensor is strictly highest; turn toward whichever flank
sensor is higher; a genuine three-way tie (or an all-lower forward
reading) draws a coin flip. See "The twin protocol" below for
`TIE_EPS`, the deadband both backends apply to every one of those
comparisons.

## Step order (fixed, always)

1. **Substrate pass**, per channel, **in declared order**: diffuse (2-pass
   separable 3x3 tent stencil, weights `[1,2,1]/4` each pass — see
   `kernel.js`'s `STENCIL_1D`), decay (multiplicative, from `halfLife`),
   advect (semi-Lagrangian: sample the declared momentum channel
   grid-aligned at the destination cell, trace back, bilinear-sample the
   source). Then **reactions**, in declared order, once all channels have
   finished their own diffuse/decay/advect.
2. **Projection**: for each vector channel with `projection.enabled`,
   Gauss-Seidel pressure solve + gradient correction (see "Projection"
   below for why this is Gauss-Seidel and not Jacobi, and why divergence
   uses backward differences).
3. **Agent pass**, agents in index order: for each agent, for each weld
   in declared order — read, apply effect, accumulating heading change
   and any `alignAndAdvect` displacement — then integrate position
   (`x += cos(heading)*speed + dx`, boundary-handled).
4. **Deposit pass**, agents in index order: for each weld with a
   `deposit`, bilinear-scatter `amount` (or `amount * velocity` for a
   vector channel) into the target channel.

Both `cpu.js`'s `step()` and `webgl2.js`'s `stepGL()` implement exactly
this order; `tests/aquarium-engine.js`'s bit-identical-run case exercises
the CPU side of it, and the twin protocol below exercises cross-backend
agreement.

## The RNG

`rng.js` is stateless: every draw is `rand01(seed, agentIndex, step,
stream)`, a pure function built from Thomas Wang's 32-bit integer hash
(`hash32`) folded four ways (`hash4`). No RNG object, no draw-order
dependence — two runs seeded alike draw alike regardless of what else
happened first, which is what "300 steps bit-identical" actually needs
from an RNG (`tests/aquarium-engine.js`'s determinism case).

The hash is built entirely from add/xor/shift/multiply at 32 bits, which
wrap identically in JS (`>>> 0`, `Math.imul`) and in GLSL ES 3.0 (`uint`,
which wraps at 2^32 on every operation by the language's own spec).
`rng.js` exports the GLSL text (`GLSL_HASH`) as a string precisely so
`webgl2.js` inlines the same six lines rather than hand-retyping them —
one hash, two host languages, verified to agree by construction (the
operations are the same operations) rather than by hoping a second
transcription matches.

`ouStep` (a seeded Ornstein-Uhlenbeck step) is the one piece of `rng.js`
that reaches for `Math.log`/`Math.sqrt`/`Math.cos` (Box-Muller) and is
therefore tier 1, not tier 2 — see "Determinism tiers" below. No kernel
spec in this delivery uses it yet; it exists for a future chemistry
reaction or noise channel.

## Determinism tiers

Per `docs/executable-experiments-design.md`'s "Determinism, honestly":

- **Tier 1 (per-engine, what this delivery is).** `cpu.js` uses
  `Math.sin`/`cos`/`atan2`/`sqrt`/`log` freely. IEEE-754 arithmetic for a
  fixed operation order is bit-identical on one JS engine run to run —
  verified directly (`tests/aquarium-engine.js`'s "two runs from the
  same seed, 300 steps, are bit-identical" case) — but a transcendental
  function's last bit is allowed to vary across engines (V8 vs
  SpiderMonkey vs a GPU driver's shader compiler), so cross-engine or
  cross-backend replay is tier 1, verified within a declared tolerance,
  never bit-for-bit.
- **Tier 2 (universal)** would require the SDK's own deterministic
  transcendental implementations reaching every trig/log/sqrt call in
  both `cpu.js` and the GLSL this file's shaders generate — not attempted
  here. Named as the gate for calling this engine's primitives tier 2 in
  the future, same as the design doc already states for the rest of the
  library.

## Projection: two real bugs, fixed, with the mechanism named

`cpu.js`'s divergence-free projection (`project()`) is a Gauss-Seidel
solve, not the double-buffered Jacobi a naive port of Stam's reference
fluid solver would produce, and its divergence/gradient stencils are a
matched backward/forward pair rather than the more common centered-
difference form. Both changes were forced by a measured failure, not
chosen up front:

1. **Double-buffered (ping-ponged) Jacobi never damps the grid's Nyquist
   ("checkerboard") frequency** — its eigenvalue there is exactly -1, so
   that mode neither grows nor decays no matter how many iterations run.
   Measured: mean |divergence| plateaued around 0.06 past a few hundred
   iterations regardless of iteration count. Fixed by switching to
   in-place Gauss-Seidel (spectral radius < 1 at every frequency,
   including Nyquist) — the CPU path can do this because a `for` loop's
   sweep order is sequential and deterministic by construction; a GPU
   fragment pass cannot (every pixel's shader invocation can't read
   another invocation's in-progress write in the same pass), so
   `webgl2.js`'s projection is still double-buffered Jacobi and carries
   this same limitation, undemonstrated by either twin spec in this
   delivery (neither physarum nor boids enables `projection`).
2. **Centered differences for both the divergence forcing term and the
   velocity correction are not adjoint operators.** Composing them (the
   divergence of a centered gradient) produces a Laplacian over every
   OTHER grid point — `p[x+2], p[x-2], ...` — not the compact 5-point
   stencil `p[x+1]+p[x-1]+p[y+1]+p[y-1]-4p[x,y]` the pressure solve
   assumes. That is the classic collocated-grid "checkerboard" problem
   (the textbook reason real CFD codes stagger velocity and pressure onto
   different grid points): the odd- and even-indexed sub-grids decouple,
   and no amount of solver iteration removes the residual it leaves.
   Fixed by using a **backward** difference for divergence and the
   matching **forward** difference for the correction, which collapses
   `div(grad(p))` exactly to the compact 5-point Laplacian. Verified:
   mean |divergence| on a previously-stuck field (plateaued at ~0.0022)
   fell to `5.9e-8` after the fix, given enough iterations (`tests/
   aquarium-engine.js`'s projection case uses a localized, mixed-
   frequency seed and 150 iterations, converging to `< 1e-3` comfortably;
   a single domain-spanning low-frequency mode converges far more slowly
   under plain Gauss-Seidel — see the comment at that test's fixture for
   why a "realistic" field, not an adversarial global sinusoid, is the
   honest thing to test against a bounded iteration count).

## The twin protocol

`twin.js`'s `runTwin(spec, steps, gl)` runs `cpu.js` as the reference and
`webgl2.js` as the projection from the identical initial condition (the
initial state is a pure function of `spec.seed`, computed once on the
CPU and uploaded into both backends — see `webgl2.js`'s
`uploadInitialState` — so t=0 is never itself a source of drift), then
reports:

- **`early`**: a tight pointwise comparison (`channelError`:
  relative-L2 and max-abs per channel; `agentPositionError`: toroidal-
  aware Euclidean distance) at `tolerance.earlyStep`, gated against
  `tolerance.earlyRelL2` / `tolerance.earlyMaxAbs` / `tolerance.agentPos`.
- **`final`**: the same pointwise comparison at the full step count —
  reported for transparency, **never gating `pass`**.
- **`aggregate`**: a statistical comparison declared per spec
  (`tolerance.aggregate`, an array of `{ metric: 'variance', field,
  maxRelDiff?, maxAbsDiff?, minValue? }` or `{ metric: 'orderParameter',
  ... }`), evaluated at the full step count, gating `pass`.

### Why two kinds of check, not one

`apps/aquarium/twin.html` runs both the physarum spec and the boids spec
for the requested 200 steps in a real headless-Chromium WebGL2 context.
The first version of this file gated pass/fail on the pointwise
comparison at the full 200 steps, with a declared tolerance of `relL2:
0.05`. It failed — badly (`relL2` over 0.5 for every channel in both
specs) — and the investigation (kept as the empirical record here rather
than silently patched away) found why:

`steerByAngle`'s motor logic is a **branch** on three bilinear-sampled
sensor readings. A CPU-vs-GPU difference of a few ULPs in native
`cos`/`sin` (both backends use their own, tier 1 by design) can put a
near-tied sensor pair on opposite sides of a `>` comparison. `TIE_EPS`
(a `0.001` deadband added to every one of those comparisons, in both
`cpu.js` and `webgl2.js`, constants kept equal by comment cross-
reference) absorbs a *pure floating-point coincidence* — the same
tie the reference motor logic already hysteresis-handles for an exact
match, widened slightly — but it cannot and should not absorb a
genuinely close call in the DATA itself. When one does occur, the
flip is **discrete, not small**: that one agent's whole future
trajectory and every deposit it makes from that step forward diverges;
nearby agents then sense a measurably different trail and can flip too.
Measured on the physarum spec: 0 agents' headings had diverged by step
2, 89 by step 20, 2453 of 3000 by step 200. This is sensitive dependence
on initial conditions — the same property any branching dynamical system
with feedback has (a flock, a market, a double pendulum) — not an engine
bug, and not fixable by a tighter deadband, a better RNG, or a different
bilinear implementation: the two backends are two independent
floating-point computations of a chaotic map, and asking them to agree
on exact microstate after 200 steps is asking the wrong question.

So `early` asks the right question — did the kernel ops (diffuse, decay,
motor, deposit) get faithfully ported? — in the window before that
cascade has had time to spread (step 5: physarum `relL2 = 0.0108`,
`maxAbs = 7.80`; boids `relL2 = 0.0074`/`0.0044`, `maxAbs = 0.155`/
`0.519`), and `aggregate` asks the other right question — does the same
*phenomenon* still emerge on both backends? — at the full 200 steps
(physarum: field variance cpu `18702.6` vs gpu `19979.1`, 6.8% relative
difference, both far above the "structure formed" bar of 100 from
`tests/aquarium-engine.js`; boids: velocity order parameter cpu `0.9367`
vs gpu `0.9146`, both far above the "aligned" bar of 0.5). Both specs
`pass: true` under this protocol; the full numbers, including the
expected-to-fail `final` block, are in the JSON `twin.html` renders, not
hidden.

### Which op is the source of drift, ranked

1. **The `steerByAngle` branch itself** — by far the dominant source, for
   the reason above. This is a property of *any* branch-on-noisy-input
   motor policy, not specific to this kernel.
2. **Bilinear sampling** — exact, identical-weight arithmetic on both
   backends (both compute the same 4-tap weighted sum); it contributes
   negligible drift on its own. It matters only because it's what feeds
   the branch in (1) — a slightly different sample is what occasionally
   crosses the `TIE_EPS` deadband.
3. **Deposit blend order / texture filtering** — verified NOT a
   meaningful source here: `.scratch/debug3.html` (not committed; the
   finding is recorded here) pinned four agents at known fractional
   positions with `gain: 0` (no motor branching at all) and found the
   CPU and GPU deposited fields agreed to `2.5e-7` absolute — deposit
   scatter and diffuse/decay both reproduce almost exactly given no
   branch to diverge on.

## Promotion path into `src/dynamics/`

This engine is deliberately NOT wired into `src/dynamics/` or any
`app.json` yet — the migration recipe (`ROADMAP.md`, "Where families
come from") is: freeze what exists, extract primitives, compose a thin
page, prove equivalence headlessly, publish with provenance. Concretely,
for this engine:

1. **Freeze**: this delivery — `apps/aquarium/engine/{kernel,rng,cpu,
   webgl2,twin}.js`, `apps/aquarium/twin.html`, `tests/
   aquarium-engine.js` — is the frozen reference. `docs/executable-
   experiments-design.md`'s twin pattern IS the "prove equivalence
   headlessly" step, done up front rather than after the fact, because
   this engine was built as a library primitive from the start rather
   than migrated from a standalone sim.
2. **Extract into `src/dynamics/`**: once a first consuming app
   (`apps/aquarium/index.html`, an sdk-page) needs it, `kernel.js`,
   `rng.js`, and `cpu.js` move to `src/dynamics/substrate-kernel.js` (or
   similar), imported the same way `src/dynamics/substrate.js` already
   is. `webgl2.js` and `twin.js` likely stay page-adjacent or move to
   `src/backends/` alongside `src/backends/canvas2d.js` and `src/
   backends/capture.js` — the exact seam is a decision for that lane,
   made against that app's real import graph rather than guessed here.
3. **Compose the page**: `apps/aquarium/index.html` becomes a thin
   `defineParams` + `renderPanel` page over the promoted primitives
   (`apps/mark/index.html`'s idiom), gets its own `app.json` with
   `provenance.builtOn: "eigen-form@<semver> <short-commit>"` (native
   sdk-page, no frozen original to point back at — see `docs/
   lab-design.md`'s provenance rules), and only then is added to `hub/
   registry.json` via `tools/lab_build.js --write`.
4. **Reactions and the deferred GPU paths** (`'rescale'`, `advectedBy`,
   projection) get their own twin coverage the first time a spec
   actually needs them on GPU — see `webgl2.js`'s header for the full
   list of what throws today rather than silently drifting.
