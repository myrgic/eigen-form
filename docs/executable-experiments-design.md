# Executable experimental units

Design sketch, 2026-08-11. This is the destination the library and the
lab are pointed at: not only a visualization library, but a scientific
instrument, where a simulation page is a fully enclosed executable
experimental unit. Configure broadly; lock what you settle on; export
the locked state as a standalone simulation that anyone can replay
deterministically.

## The lifecycle

1. **Explore.** A page built on the SDK, knobs live in the panel,
   labeled exploratory. Nothing about this state is a claim.
2. **Lock.** The current parameter state, the seed, and the SDK version
   freeze into a figure spec. Locked parameters render with the lock
   glyph; the page is now showing a declaration, not a playground.
3. **Export.** The locked state becomes a standalone unit: a
   self-contained app directory (or single file) carrying the inlined,
   hash-pinned SDK, the locked spec, and a verification stamp.
4. **Replay.** Anyone opens the unit and watches the same world unfold,
   or runs its verifier and confirms the stamp.

## The verification stamp

Every exported unit carries its own expected result: the hash of its
deterministic draw-command stream over a declared number of fixed-dt
frames (the same capture backend that guards this library's own
regression goldens). Verification is: run headless, hash, compare.
The experiment does not ask to be trusted; it asks to be executed.
A unit whose stamp no longer matches its own replay is broken, loudly,
by its own declaration.

## Determinism, honestly

Replay determinism has two tiers, and the contract declares which one a
unit meets:

- **Tier 1, per-engine.** IEEE-754 arithmetic is deterministic for a
  fixed operation order, so a unit replays bit-identically on the same
  JavaScript engine family. Across engines, the built-in transcendental
  functions (sin, cos, exp) may differ in the last bits, so cross-engine
  replay is verified within a declared tolerance instead.
- **Tier 2, universal.** The SDK provides its own deterministic
  transcendental implementations (the established move from lockstep
  simulation in games), and a unit built exclusively on them replays
  bit-identically on any engine. This is instrument grade, and it is
  the target for every dynamics primitive the SDK ships.

Randomness is seeded everywhere by contract; wall-clock time never
enters the computation (virtual time only, fixed dt; rendering is
playback, not simulation).

## Relationship to the lab

An exported unit is packaged exactly like a lab app: manifest,
provenance (derived from parent app at spec hash such-and-such), entry
page, verification stamp. Sharing an experiment is sending a directory;
importing one is a registry entry; the hub renders its provenance like
any other app. Review becomes replay: run it, compare the stamp, read
the declared changes.

## Order of arrival

1. Figure specs already exist (v0.1). Seeded randomness and fixed-dt
   virtual time are already the discipline.
2. The panel's lock semantics arrive with the params work (see
   docs/params-panel-design.md).
3. Export = spec + inlined pinned SDK + stamp, first implemented for
   the welded-fields family migration.
4. The deterministic math module is its own contained work item and
   the gate for calling any unit tier-2.

## The shader correspondence

These units are, almost literally, shaders in practice. The dictionary,
stated once so the architecture can lean on it:

| this design            | the shader world                          |
|------------------------|-------------------------------------------|
| dynamics kernel        | the shader program                         |
| defineParams schema    | the properties block                       |
| panel                  | the material inspector                     |
| locked figure spec     | a material: program plus bound values      |
| exported unit          | the asset bundle                           |
| param-set envelope     | setting a uniform across the boundary      |
| shell                  | the engine editor                          |

The correspondence is technical, not decorative: field grids are
floating-point textures, the diffuse-and-decay pass is the classic
separable blur, deposit is additive blending, and the agent families are
routinely implemented as GPU compute in practice. One divergence must be
respected: agent deposit is scatter, not gather, so the GPU expression
of these kernels is compute (storage buffers, atomics), not fragment
shading.

The deep consequence: GPU parallelism breaks bit-determinism by default
(atomic ordering, reduction order), which collides with the verification
stamp. The resolution is the twin pattern: the CPU path is the reference
instrument, bit-identical and stamp-verified; a GPU path, when it
arrives, is the fast projection, verified against the reference within a
declared tolerance and never trusted past it. Primitives should
therefore be authored as kernel specs (operation, stencil, state,
parameters) with the CPU reference as the semantics and any accelerated
backend as a checked projection of it.

## Presets, distinctly

A preset and an export are different artifact classes and the contract
keeps them apart:

- A **preset** is a declaration that conforms a live lab store: a small
  JSON document of values plus the schema hash of the store it targets.
  Applying one is `hydrate()`, which refuses on schema-hash mismatch,
  so a preset can never silently misconfigure the wrong simulation.
  Application is **partial by construction**: a preset touches only the
  keys it declares and leaves the rest of the live store as found.
  Presets may also be **scoped to a group** (save or apply just the
  `medium` section), which makes them composable: layer a field preset
  under an agents preset. A preset has no independent existence; it
  requires a lab with the SDK present.
- An **export** is an image: the locked spec closed over its
  dependencies. It bakes the values together with the SDK modules the
  spec actually reaches, its own web manifest and service worker, and
  the verification stamp, into a standalone installable PWA. It does
  not ask the environment to conform; it ships the environment.

## The lock boundary, refined

The free list — which parameters stay live in an exported unit — has
two tiers, declared at different times by different parties:

1. **Schema-level** (author-time): a parameter declared view-only
   (`viewOnly: true`) never enters the verification stamp; palette,
   contour toggles, playback speed. The stamp is defined over
   sim-affecting parameters only.
2. **Per-export** (lock-time): the exporter may opt specific writable
   parameters into remaining live, recorded in the exported spec's own
   free list. Everything not freed is baked.

One mechanism per intent. Locks are always explicit declarations;
a lock is never inferred from observed agreement across live state.

## The tree-shake rule

What the export step may cut, stated with engine precedent (Unity's
variant model): a **locked parameter tree-shakes like
`shader_feature`** — code reachable only through values not taken may
be stripped, because no replay can reach it. A **free parameter keeps
every branch like `multi_compile`** — its full declared range must ship
uncut, because the panel can hit any of it at runtime. Reachability is
computed by walking the real import graph from the entry module, never
a hand-maintained manifest. The export emits a provenance report:
which parameter pulled in which module, and why. Exports are
deduplicated by a config hash over baked values (free parameters
contribute a marker, not a value), so re-exporting an identical
configuration reuses the prior unit.

## Prior-art notes: the avatar-shader lineage

Poiyomi and lilToon (reviewed at source level) ship this lifecycle in
production for Unity avatars, and the correspondence table above holds
against their code. What their structure confirms, and what it warns:

- Poiyomi's lock-in bakes properties to constants, strips dead passes,
  and writes the result to a **new self-contained folder** referenced
  by the material — the export-as-separate-artifact shape. Its
  `Animated` per-material tags are the per-export free list; its
  config-hash shader cache is the dedup above.
- lilToon derives its shipped shaders from packed containers plus a
  feature-flag header, scoped by what the build actually uses — the
  reachability tree-shake, with a log naming which asset demanded
  which feature.
- The warning, from the same code: lilToon's optimizer **mutates the
  shared live source in place** and restores it after the build. An
  export must never touch the live lab; it writes a new directory or
  it does not run. And both shaders accreted several overlapping
  no-lock mechanisms over the years; this design keeps exactly one
  mechanism per intent, on purpose.

## Export targets beyond the browser

An exported unit's spec is engine-agnostic by construction (kernel
identity, typed parameters, declared topology), which opens translation
targets where the browser SDK never runs. The first named one: a Unity
shader for VRChat. The mapping is mechanical at every layer — the field
pass is a CustomRenderTexture whose fragment shader reads its own
previous state; the declared topology becomes the sampler's wrap mode
(Repeat is the torus, Clamp the bounded plane, Mirror the reflecting
boundary); agents follow the established state-texture pattern (one
texel per agent, gather-update, then a point-render pass scatters
deposits into the field); the defineParams schema emits the ShaderLab
Properties block, and a locked spec emits a material. One declaration
is honest and mandatory: such an export is an artistic projection, not
an instrument. It carries the spec hash of the experiment it projects,
but variable framerate and GPU arithmetic put it outside the
verification stamp, in the twin pattern's terms: a projection with its
tolerance loosened to taste. The science stays in the lab; the effect
ships.
