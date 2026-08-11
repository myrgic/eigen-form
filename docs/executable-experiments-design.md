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
