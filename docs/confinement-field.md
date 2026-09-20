# Confinement Field + Energy Ledger — design doc

Status: spec (Chaz, 2026-09-20) · Target: welded_asteroids v2.11 ·
Branch: `feat/wa-confinement`

## Thesis

v2.10.x is a **closed** system: the only field agents interact through is the
one they make (trail + momentum). Real tokamak confinement is an EXTERNAL,
agent-independent field that cannot be modified by the confined population.
This build adds the external confinement field (the "coil set"), bills its
energy, measures the structure's stored energy and confinement time, and
toggles cleanly between open and closed thermodynamics. The boid_vector_field
app (the lab's one-way external-field sim) is the precedent mechanism; here it
is ported onto the quotient torus and made chargeable.

The experiment this enables, in one sentence: **the first sim where toroidal
topology, dyadic agents with memory, and a billed external field coexist —
so stigmergic bootstrap (internal information storage reducing external
confinement requirements) becomes measurable.**

## Geometry: the winding field

In (u,v) chart coordinates (u toroidal, v poloidal — same chart the trail
grid lives on), the confinement field lines are straight lines of constant
slope, exactly as in a tokamak's safety-factor description:

    q = winding ratio = toroidal turns per poloidal turn

Field-line direction at a point: fixed unit vector q̂ = normalize((1/q, 1)) in
(u,v) — proportional to (Δu, Δv) = (1/q, 1) per unit time. Rational q (p/q
with integers) closes after q poloidal turns; irrational q covers the chart
ergodically. The flat-torus chart makes the safety factor EXACTLY a slope,
which is the toy's advantage over the curved ring torus.

Physical-space caveat: the 3D view shows the base torus embedding; the field
is defined on the quotient chart and visualized as chart-space arrows (2D
overlay), not as 3D helices. The chart IS the physical surface for the agents.

## The three knobs

- **q (winding ratio)** — dial, sweepable 0.2–5.0. Rational values marked
  (1, 3/2, 2, 5/2, 3...). Default 1.
- **coupling gain κ** — how strongly each agent steers its heading toward the
  local field direction (0 = ignore field). Implemented identically to the
  existing momentum-field read (bilinear sample in the chart, fold rules
  honored), but the source is agent-independent.
- **cross-field drift ν** — small per-step random heading perturbation
  PERPENDICULAR to the field direction (the transport knob; analog of
  collisional diffusion across flux surfaces). 0 = perfectly confined.

## Energy ledger (open-system thermodynamics)

Three lines, one scalar each, read into the measure cadence:

- **P_in** — field injection: billed per step as (coupling κ) × (field
  complexity ~ 1/q or a fixed rate), i.e. stronger/more-structured
  confinement costs more. Constant while the field is on.
- **P_loss** — dissipation: (a) drift-driven leakage: total cross-field
  heading error × population, (b) trail decay: total trail mass evaporated
  per step × decay constant, (c) steering work: κ-corrected heading changes.
  Dominant terms (a) and (b).
- **W_stored** — stored structure: total trail mass in coherent regions
  (above threshold) + population momentum coherence (mean |v| alignment).

Derived readout: **τ_sim = W_stored / P_in** (the confinement time analog —
the classic definition τ_E = W/P). Measured dynamically by the field-shutoff
protocol: run with field on until steady state, switch to mode "off" (field
decays), record W_stored(t) decay envelope → τ_sim from the exponential fit.
The ledger panel shows all four numbers live.

## Three-mode toggle (the thermodynamic switch)

- **closed** — field off entirely; behavior byte-identical to v2.10.1
  (regression gate: same seed → same golden hash).
- **field on** — external field active, P_in billed, open system.
- **field decaying** — field was on, now switched off: field influence decays
  with its own τ (billable residual), letting ONE run measure τ_sim rather
  than stitching two runs.

## Stigmergic bootstrap (the target measurement)

The experiment: hold field + structure to steady state; then LOWER κ in
small steps while the trail/momentum feedback remains active. Hypothesis: a
band of κ where the structure persists even as external coupling drops —
the agents' own deposits holding the shape the field used to hold. Metric:
W_stored retained per unit κ removed; report the ratio (stigmergic
substitution fraction). This is the sim-analog of bootstrap current —
internal self-organization reducing external power demand — and it is the
result the fusion codes structurally cannot produce (no memory term).

## Rational-resonance instrumentation (q-histogram)

Per-agent winding number: each agent's recent path projected to (u,v)
accumulates (Δu, Δv); the ratio q_agent = Δv/Δu over a rolling window is its
instantaneous winding number. Histogram across the population; look for
pile-up at rationals when structures form (tokamak rational-surface analog).
Condition on regime: only meaningful when paths are field-coherent
(advection-dominated), so the histogram is displayed alongside a coherence
order parameter (mean |sin(angle between heading and local field)|).

## Scopes integration (already built)

- Slice scope ≈ soft-X-ray chord cameras (line-integral sections).
- Quadrant scope COM precession ω ≈ mode-rotation diagnostic (Mirnov coils);
  prediction: ω locks to the field's poloidal rotation at rational q.
- β₁/coverage ≈ stored-energy analogs.
- Confinement readout joins the scope stack as the fourth observer.

## Verification plan

1. Closed-mode regression: field mode=closed, fixed seed → golden hash
   identical to v2.10.1 (the toggle must not perturb closed physics).
2. Field confinement: field on, κ high, ν=0 → population collapses onto
   field-aligned bands; W_stored rises; P_loss → small.
3. τ_sim measurement: shutoff protocol → exponential W_stored decay with
   finite measurable τ_sim; τ_sim increases with κ, decreases with ν.
4. Rational locking: sweep q across [1, 3/2, 2] with field on; q-histogram
   peaks at the driving rational; ω locks at strong κ.
5. Bootstrap window: κ-reduction protocol shows a substitution band
   (hypothesis — may fail; a null result is a result and gets recorded).
6. 0 page errors; lab_build --check green; live URL 200.

## What this is NOT (honesty section)

- Not MHD: no vorticity, no helicity invariant, no reconnection, no
  pressure-gradient-driven instabilities. The field lines are kinematic
  scaffolding, not force-carrying objects with their own dynamics.
- Not energy-conserving: the ledger accounts flows but the sim's internal
  units are not joules; τ_sim is comparable only within the sim.
- Not a claim that physarum-agents are plasma: the mapping is structural
  (topology + confinement + population), the dynamics layer is different.

## Lineage

Thread 2026-09-20: toroid field → scopes as observer frames → tokamak
mapping (q = winding slope, rational surfaces = critical angles) → "the
confinement field could be simulated physically and its equivalent energy
requirements injected" → the open-system/thermodynamics question → this
spec. The boid_vector_field lab app is the mechanism precedent; the energy
ledger idea is Chaz's (open vs closed toggle).
