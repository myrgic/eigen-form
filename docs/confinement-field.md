# Confinement Field + Energy Ledger — design doc

Status: **v2 (post-experiment + Opus review, 2026-09-20)** ·
Shipped: v2.11.0 → v2.11.3 (PR #24/#25/#26/#27) ·
Branch history: `feat/wa-confinement`, `fix/wa-qhist`, `fix/wa-2112`, `fix/wa-2113`

> v1 of this doc was a pre-build spec. v2 records what was built, what the
> experiments actually returned (including the refuted claims), and the
> corrected instrument definitions. Claims that died are kept visible —
> the doc is meant to survive adversarial review, not the author's ego.

## Thesis

v2.10.x is a **closed** system: the only field agents interact through is the
one they make (trail + momentum). Real tokamak confinement is an EXTERNAL,
agent-independent field that cannot be modified by the confined population.
This build adds the external confinement field (the "coil set"), bills its
energy, and measures stored structure. Three modes toggle cleanly between
closed and open thermodynamics.

The experiment this enables, in one sentence: **the first sim where toroidal
topology, dyadic agents with memory, and a billed external field coexist —
so stigmergic bootstrap (internal information storage reducing external
confinement requirements) becomes measurable.**

**Status of that measurement after v2.11.3: NOT YET ESTABLISHED.** See
"Experiment ledger" below — two claimed signatures (rational locking, W-persist
bootstrap) were both refuted by their own controls. The discriminating
instrument set is specified and is the next build.

## Geometry: the winding field

In (u,v) chart coordinates (u toroidal, v poloidal — same chart the trail
grid lives on), the confinement field lines are straight lines of constant
slope, exactly as in a tokamak's safety-factor description:

    q = winding ratio = toroidal turns per poloidal turn

Field-line direction at a point: unit vector with slope dv/du = q exactly
(proportional to (Δu, Δv) = (1, q)). Rational q (p/q with integers) closes
after q poloidal turns; irrational q covers the chart ergodically. The
flat-torus chart makes the safety factor EXACTLY a slope, which is the toy's
advantage over the curved ring torus.

**Seam-awareness (v2.11.2).** On mirrored surfaces (Klein, projective,
Möbius) a uniform slope-q vector field is NOT globally well-defined: the
seam flip maps (vx,vy) → (−vx,vy), so slope q maps to −q across the weld.
`confDir` therefore transforms the direction through `flipV` per mirrored
image the sample point occupies — the field is uniform in the base image and
position-dependent only through the fold. Verified: Klein coherence 0.998.

Physical-space caveat: the 3D view shows the base torus embedding; the field
is defined on the quotient chart and visualized as chart-space arrows (2D
overlay), not as 3D helices. The chart IS the physical surface for the agents.

## The three knobs

- **q (winding ratio)** — dial, sweepable 0.2–5.0. Rational values marked
  (1, 3/2, 2, 5/2, 3...). Default 1.
- **coupling gain κ** — how strongly each agent steers its heading toward the
  local field direction (0 = ignore field). In field-decaying mode the
  APPLIED coupling scales as κ·√(P_in/P_in0) — coupling decays with the
  billed power (Astra finding: the mode is dishonest otherwise; a field
  steering at full strength while billing zero is a free field).
- **cross-field drift ν** — per-step heading kick toward ±90° of the field
  line (v2.11.3; transport ACROSS flux surfaces — the v2.11.0–v2.11.2
  implementation was isotropic jitter, which was the wrong physics: it is
  not a cross-field diffusion term at all).

## Energy ledger (open-system thermodynamics)

Three lines, one scalar each, computed in ALL modes as of v2.11.3 (the
v2.11.0–v2.11.2 closed-mode early-return zeroed W_stored exactly when the
shutoff experiment needed it — the instrument went blind in the one mode
built for measurement):

- **P_in** — field injection: κ·40/q per measure in field-on; carried down
  ×0.97/measure (shutdecay) in field-decaying; exactly 0 in closed.
- **P_loss** — trail evaporation (1−decay)×mass, plus cross-field leakage:
  population × mean|sin(field−heading)| × applied coupling. v2.11.3 computes
  leakage ONLY against an active field — in closed mode `confDir` is a
  phantom (a direction where no field exists), and billing leak against it
  produced the meaningless "cf = 0.65 in closed mode".
- **W_stored** — **trail structure contrast** (v2.11.3): excess trail mass
  above the uniform baseline, Σ max(0, grid[i] − mean), plus momentum
  alignment. Two prior definitions both failed:
  - v2.11.0–11.1 "coherent mass above threshold": saturated — total mass
    fills to the same ceiling for fog and for a flux band.
  - v2.11.2 first cut "contrast": correct intent but rides a coverage dome
    (zero when uniform, peak at intermediate coverage); see Experiment ledger.
- **Momentum alignment** (v2.11.3): |Σ mom| / Σ|mom| — a true order
  parameter in [0,1]. The v2.11.0–11.2 version (mean magnitude / deposit
  size) was a density proxy that latched at 1 in any non-trivial swarm.

**τ_sim = W_stored / P_loss** (v2.11.8, #39 — it was W_stored / P_in, but
P_in is the dial constant 40κ/q, so that ratio was W rescaled by q/(40κ);
τ_E divides by the power actually dissipated, and P_loss here runs far above
P_in, so the two are not interchangeable). **It is only defined at constant
P_in (field-on)** —
in decaying mode the denominator vanishes exponentially and the ratio ramps
to ~10¹⁰ then snaps to 0 (refuted convention). A decaying-mode confinement
time must come from fitting a STRUCTURE indicator's decay
(b₁ or slice-FWHM) to A + B·e^(−t/τ) after the bloom transient, not from a
denominator engineered to vanish.

## Three-mode toggle (the thermodynamic switch)

- **closed** — field off entirely; coupling block skipped; ledger read-only.
  Regression gate: same seed → same golden hash (held in CI).
- **field on** — external field active, P_in billed, open system.
- **field decaying** — field was on, now switched off: P_in and applied
  coupling decay together, letting ONE run measure the decay protocol.

## Experiment ledger (what was actually measured)

| Claim | Protocol | Result | Verdict |
|---|---|---|---|
| τ_sim vs κ | sweep κ 0.2–0.95, q=2 | W rises with κ; τ falls sub-linearly (P_in ∝ κ) | **banked under the retired τ = W/P_in**; not re-run with τ = W/P_loss (v2.11.8) |
| τ_sim vs ν | sweep ν 0–0.2 | flat — drift was billed as the dial value, ~2 orders under real transport | **instrument defect → fixed v2.11.2/3** |
| Rational locking | q-hist peak vs driving q | v2.11.0 instrument decayed onto a fixed attractor (~1.8) regardless of q — the "lock at 2.02" was the bug confirming itself | **refuted → fixed v2.11.1** |
| Rational tracking (fixed instrument) | q = 1→3: peak 1.02→2.48, monotone | tracks the field; residual ~0.83× = real cross-field advection ("effective q") | **banked** |
| Bootstrap (κ-ladder) | κ 0.9→0, W flat ~174k | old metric saturated: cold-closed control read the SAME 174k | **refuted (v2.11.3)** |
| Bootstrap (contrast metric) | shutoff W(t) vs cold-closed W(t) | 90k→138k vs 92k→145k at identical saturated coverage — contrast rides a coverage dome; cannot distinguish structure from diffusion transient | **NOT ESTABLISHED** |
| Structure persistence after shutoff | b₁ post-shutoff | b₁ stayed 0–1 (transient), not the elevated closed-loop signature a wrapped band would give | **no evidence of persistent structure** |

The pattern across every refutation this session: **the sim lies in the
direction of its own instruments.** Each dead claim was an instrument
agreeing with expectation because the quantity being read was a proxy
(mass for structure, decayed headings for winding, magnitude for alignment).
The fix each time was the same move: measure the actual quantity.

## The discriminating instrument set (next build — specified by Opus review)

W/contrast is a scalar that conflates coverage with structure. To decide
whether ANY structure persists after shutoff, read the topological and
geometric scopes at matched coverage, against the cold control:

1. **β₁ persistence** — a field-aligned band wrapping a generator is a
   closed loop → elevated b₁ after shutoff; fog collapses b₁ toward 0.
   Primary discriminator.
2. **Slice-FWHM** — chord profile through a confined band is narrow-peaked;
   fog is broad/flat. Compare shutoff-run vs cold control at matched coverage.
3. **Quadrant-ω lock** — COM precession locked to the field's rotation after
   shutoff = self-organized rotation; decorrelation = fog.
4. **Internal coherence (new readout)** — mean alignment of heading to the
   LOCAL TRAIL-MOMENTUM direction (via fieldAt), not to `confDir`. The
   existing coherence readout compares against the external field and is
   unusable in closed/decaying modes by construction.

Bootstrap would then be: b₁/FWHM/ω-hold in the shutoff run exceeding the
matched cold control by a measurable margin, as a function of the κ removed.

## Rational-resonance instrumentation (q-histogram)

Per-agent winding number: each agent's path accumulates wrap-aware,
flip-transformed chart-position DELTAS (v2.11.1 fix — v2.11.0 accumulated
heading vectors, which have the front/back degeneracy and decayed onto a
fixed attractor decoupled from q; the position-delta accumulator is the
path's true winding number). Histogram across the population; look for
pile-up at rationals when structures form (tokamak rational-surface analog).
Condition on regime: only meaningful when paths are field-coherent, so the
histogram displays alongside coherence vs the ACTIVE field (closed mode:
coherence hidden, not faked). Known v2.11.3 limitation (Opus): the rolling
window is a magnitude clip (×0.9 when |accum|² > QW²), not a time window —
the effective window varies with agent speed; queued for the next pass.

## Scopes integration (already built)

- Slice scope ≈ soft-X-ray chord cameras (line-integral sections).
- Quadrant scope COM precession ω ≈ mode-rotation diagnostic (Mirnov coils);
  prediction: ω locks to the field's poloidal rotation at rational q.
- β₁/coverage: β₁ is now the PRIMARY structure discriminator (see above);
  coverage is the control variable it must be matched against.
- Confinement readout joins the scope stack as the fourth observer.

## Verification plan (status after v2.11.3)

1. ✅ Closed-mode regression: golden hash identical (CI green all four PRs).
2. ✅ Field confinement: field-aligned bands at high κ (live screenshots).
3. ⚠️ τ_sim: definition corrected; the exponential-decay fit protocol is
   specified (fit b₁/FWHM, not W) but not yet implemented.
4. ⚠️ Rational locking: instrument fixed and tracking (v2.11.1); the
   ω-lock prediction is untested.
5. ❌ Bootstrap window: two attempts refuted by controls; waiting on the
   discriminating instrument set.
6. ✅ 0 page errors; lab_build --check green; live URL 200.

## What this is NOT (honesty section)

- Not MHD: no vorticity, no helicity invariant, no reconnection, no
  pressure-gradient-driven instabilities. The field lines are kinematic
  scaffolding, not force-carrying objects with their own dynamics.
- Not energy-conserving: the ledger accounts flows but the sim's internal
  units are not joules (and at field-on equilibrium P_loss runs 100–400× P_in — the
  books don't balance; τ_sim is comparable only within the sim, and only in
  field-on mode).
- Not a claim that physarum-agents are plasma: the mapping is structural
  (topology + confinement + population), the dynamics layer is different.
- **No bootstrap claim is currently supported.** Two prior signatures were
  artifacts of saturated instruments. The claim is not dead — it is
  unmeasured until the discriminating instrument set runs.

## Lineage

Thread 2026-09-20: toroid field → scopes as observer frames → tokamak
mapping (q = winding slope, rational surfaces = critical angles) → "the
confinement field could be simulated physically and its equivalent energy
requirements injected" → the open-system/thermodynamics question → this spec
→ build (v2.11.0) → instrument corrections (v2.11.1 q-hist, v2.11.2
no-bugs-stand) → experiments + Opus adversarial review → honest ledger
(v2.11.3). Review chain: internal audit → Astra (codex, usage-limited
mid-run, coupling-decay finding) → Opus (delegate, full verdicts C1–C5).
The boid_vector_field lab app is the mechanism precedent; the energy
ledger idea is Chaz's (open vs closed toggle).
