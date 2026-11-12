# Villarceau Scope — design doc

Status: revised v2 (2026-09-20) after adversarial review (GPT-6 Astra via Codex;
prior independent review; both instrument records preserved) ·
Target: welded_asteroids v2.10.1 · Branch: `fix/wa-vill-solver`

## Thesis

The app's scope stack currently carries two of the three slice families of the
torus: the **slice scope** (equatorial planes, concentric pair) and the
**quadrant scope** (axial/meridian planes, offset pair). The third family —
**Villarceau planes**, the oblique tangent cuts whose section circles cross —
is the instrument this doc specifies. The scope is a **multidimensional
oscilloscope**: the obliquity angle of the slicing plane is itself a probe
coordinate, and the readout is topological, not just amplitude.

## Trigonometric core (the ladder)

Parametrize the slice plane by tilt α from the equatorial plane (α=0
equatorial, α=90° axial). For torus (R, r), the section character changes at
the unique critical angle:

    sin α* = r / R

- α < α*  → **nested disjoint loops** (concentric-type pair)
- α = α*  → **Villarceau plane**: the section is two exact circles that CROSS
  TRANSVERSELY at two points. "Tangent" describes the plane's contact with the
  torus, NOT circle-circle tangency. Crossing angle: 53.49° on the sim torus
  (R=1, r=0.45); orthogonal on the Clifford image (R=√2, r=1).
- α > α*  → **non-nested disjoint loops** (the loops separate again)

Canonical Clifford-image torus (R=√2, r=1): α* = arcsin(1/√2) = **45°** — the
self-dual angle. Sim torus (R=1, r=0.45): α* = **26.744°**.

> v2 correction: an earlier version of this doc claimed the same-plane pair
> was "linked" and the post-critical regime "interlaced". Both wrong. Same-plane
> sections are COPLANAR: linking number is 0 (disjoint cases) or undefined
> (at α* the circles intersect). The famous linked Villarceau pair consists of
> same-handed circles from DIFFERENT rotated critical planes — verified
> numerically (Gauss linking number −1 for a pair with plane azimuths 60°
> apart). Conjugate (opposite-obliquity) planes are sufficient for linkage
> only when the two circles do not intersect.

The coupling-ratio ellipse from the Genesis-and-Diffs artifact shares the same
diagonal: tan θ = r (correlation) sweeps 0→45° as r→1; maximal observer
coupling = maximal obliquity = the critical plane. At r = r* (FEP equilibrium)
current is zero; at r = 1 (eigenform) current is irreducible. The scope
operationalizes the geometric side of this on the live field.

## Closed-form section circles (Clifford image, R=√2, r=1)

Villarceau circles are stereographic images of Hopf circles — exact, not
fitted. With w(t) = √2 − sin t, the two circles of the canonical tangent plane:

    C±(t) = ( cos t, ±sin t, cos t ) / w(t)     crossing orthogonally

Numerically verified this session: torus residual ≤ 3.6e-14 (tmp/villarceau.py,
session 2026-09-20). NOTE: this closed form is specific to R=√2, r=1; the
sim's torus (R=1, r=0.45) has its own Villarceau circles with the same
qualitative properties (crossing at α*, transversely) and the solver is
checked against the general analytic condition, not this special formula.

### General obliquity α — sweeping the ladder

For a plane with unit normal n̂ = (sin α, 0, cos α) and offset d, the section
condition on the sim torus is

    A(v)·cos u + B(v) = d,   A = sinα(1 + r cos v),  B = cosα·r·sin v

(v2.10.1 FIX: the z-term B is CONSTANT in u — the v2.10.0 solver wrongly
treated it as a sin-u coefficient and sampled near-misses of the plane,
residual up to ~0.7 tube radii at α=45°.) Correct roots:

    u = ±arccos((d − B)/A)  when |d − B| ≤ A, none otherwise

Regime classification is analytic in α vs α* (exact, no root-counting
ambiguity on the VN grid). The d=0 family is the shipped instrument; d≠0
families (critical heights d = ±R sinα ± r) are future work — at fixed α≠0
with varying d the classification is no longer angle-only.

## The instrument

New panel group "Villarceau scope", mirroring the existing slice scope UI:

- **Obliquity dial**: slider α ∈ [0°, 90°), free sweep. The exact critical
  angle α* is marked; a ±0.5° band around it reads 'near α*' and the dial
  SNAPS to α* within that band so the crossing configuration is exactly
  reachable. Live regime label (separate / near α* / separated).
- **Per-v traces** on the two branch curves (loop A/loop B) + difference.
- **Readouts** (v2.10.1): Δ̄ (mean difference, valid samples only), norm
  (Δ̄/ρ-equivalent), amp/phase (first harmonic of the difference),
  **agree** (uncentered cosine similarity of the two traces — explicitly NOT
  a linking number; baseline-shift sensitive; scene-dependent), and
  **sep** (minimum 3D distance between the branch curves — geometric
  proximity; the honest substitute for a linkage meter on coplanar curves).
- α = 0 degeneracy handled: the centered section reduces to the equatorial
  pair and villSample(α=0) must equal sliceSample(c=0).

## What this scope is NOT (honesty section, post-review)

- It does not measure linking number. Coplanar curves have linking number 0
  or undefined. A true linkage readout requires tracking same-handed
  Villarceau circles across plane azimuths — a different instrument.
- 'agree' is a field statistic: it answers "do the two loops read the same
  field", not "are the loops linked". Its sweep behavior is scene-dependent.
- The 3D relief view is a normal-offset projection; the v2.10 claims that it
  "folds at the inner equator first" were inverted — for the app's OUTWARD
  relief the first singularity of the offset family sits at the inner equator
  at t = R−r = 0.55 (inward offsets collapse the tube at t = r = 0.45
  instead), and the relief slider caps at 0.28, below both. A fold-margin
  detector remains future work.

## Verification plan (implementable versions)

1. α=0 agreement: villSample(α=0) equals sliceSample(c=0) on mean/norm/amp/phase
   (v2.10.0 FAILED this — mean diff 2 vs 0 on a 1+cos v field; fixed in
   v2.10.1 via the degenerate-section reduction).
2. Plane residual: for sampled points of the corrected solver,
   |sinα·x + cosα·z − d| ≤ 1e-9 (v2.10.0 failed at up to ~0.7).
3. Regime snap: dial within ±0.5° of α* snaps exactly to α*.
4. Sweep sanity: regime labels flip at α*; agree/sep finite across 0–90°;
   0 page errors.
5. (Deferred) linking-number instrument across plane azimuths; fold-margin
   detector for the relief projection.

## Lineage note

Conversation thread 2026-09-20 (#cog/continuity): toroid field → board as
projection plane → two crossing planes at the centroid → the third family
(Villarceau) → "multidimensional oscilloscope". The artifact
(Genesis-and-Diffs, coupling ratio → ellipse tilt) is the conceptual source of
the obliquity dial. This scope is the third observer frame. The v2 revision
exists because two independent adversarial reviews executed the math and the
code and found the v1 semantics wrong in four places — the instrument's core
theorem (sin α* = r/R, the three-family chart) survived both.
