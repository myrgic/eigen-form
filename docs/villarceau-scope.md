# Villarceau Scope — design doc

Status: approved (Chaz, 2026-09-20) · Target: welded_asteroids v2.10 ·
Branch: `feat/wa-villarceau-scope`

## Thesis

The app's scope stack currently carries two of the three slice families of the
torus: the **slice scope** (equatorial planes, concentric pair) and the
**quadrant scope** (axial/meridian planes, offset pair). The third family —
**Villarceau planes**, the oblique tangent cuts whose two section circles are
*linked* — is missing. This doc specifies the instrument that completes the
chart. The scope is a **multidimensional oscilloscope**: the obliquity angle of
the slicing plane is itself a probe coordinate, and the readout is topological
(separate / tangent / interlaced), not just amplitude.

## Trigonometric core (the ladder)

Parametrize the slice plane by tilt α from the equatorial plane (α=0
equatorial, α=90° axial). For torus (R, r), the section character changes at
the unique critical angle:

    sin α* = r / R

- α < α*  → two **separate** loops (concentric-type pair)
- α = α*  → **tangent**: Villarceau plane, two *linked* exact circles
- α > α*  → two **interlacing** loops (crossing sections)

Canonical Clifford-image torus (R=√2, r=1): α* = arcsin(1/√2) = **45°** — the
self-dual angle. The three families are the three special slopes of the square
flat torus's chart (0, 1, ∞), and 0°/45°/90° are exactly where its geodesics
close simply. Trig and topology agree on which angles are special.

The coupling-ratio ellipse from the Genesis-and-Diffs artifact shares the same
diagonal: tan θ = r (correlation) sweeps 0→45° as r→1; maximal observer
coupling = maximal obliquity = the linked pair. At r = r* (FEP equilibrium)
current is zero (unlinked loops); at r = 1 (eigenform) current is irreducible
(linked pair). The scope operationalizes this on the live field.

## Closed-form section circles (Clifford image, R=√2, r=1)

Villarceau circles are stereographic images of Hopf circles — exact, not
fitted. With w(t) = √2 − sin t:

    plane x = z (the α*=45° canonical Villarceau plane):
      C±(t) = ( cos t, ±sin t, cos t ) / w(t)     centers (0, ±1, 0), radius √2

Numerically verified this session: torus residual ≤ 3.6e-14, radius constant
to 1e-15 (tmp/villarceau.py, session 2026-09-20).

### General obliquity α — sweeping the ladder

For α ∈ [0, 90°), tilt the slice plane about the torus's z-axis in the x–z
plane containing the y=0 meridian... concretely, use the standard torus
section family: a plane with unit normal making angle α with the torus axis,
offset d from the center. Section of torus (R,r) by plane n̂·p = d:

    parametrize the section as the set of (u,v) with
      n̂ · torusXYZ(u,v) = d,  torusXYZ(u,v) = ((R+r cos v)cos u, (R+r cos v)sin u, r sin v)

Implementation path: for each θ_tube = v on a fine grid, solve for u — the
section condition is linear in cos u, sin u, so each v gives 0/1/2 solutions
u(v) via atan2 after projecting onto the plane's in-plane axes. Sample the
trail grid at (u,v) for both solution branches → the two section loops in
(u,v) chart coordinates (which is where the trail lives). This is the SAME
shape as `sliceSample()` (which is the special case n̂ = ẑ, d = c).

Regime classification per α: count solutions per v —
  - 2 solutions for all v   → separate pair   (α < α*)
  - double root at v-vertex → tangent         (α = α*, Villarceau)
  - solutions appear/disappear in v-intervals → interlaced (α > α*)
The tangent case is detected exactly at α* = arcsin(r/R) (r=1, R=√2 → 45°).

At α = 45° (Clifford torus) the sampled loops must reproduce the closed-form
C± above — that's the unit test.

## The instrument

New panel group "Villarceau scope", mirroring the existing slice scope UI:

- **Obliquity dial**: slider α ∈ [0°, 90°), free sweep (operator decision:
  a multidimensional scope does not get its dimensions clipped). Critical
  angle α* = arcsin(r/R) rendered as a marked line on the dial; live regime
  label (separate / tangent / interlaced) computed from the classification
  above.
- **Per-θ traces** on the two section loops (hi/lo style, like drawSlice):
  trail sampled along loop A and loop B, plus the difference trace.
- **Linkage readout** (the new scalar): cross-correlation phase between the
  two loop traces — sub-critical it is the familiar first-harmonic phase;
  past tangency it becomes the *linking phase* between interlaced loops.
  Δ̄/ρ-style normalization retained (BPM rule: normalize by geometry, not
  raw mass).
- **Transition detection**: when α crosses α* while the field holds a band,
  the scope flags the regime flip in the readout line (the scope *detects the
  Villarceau transition in the live field*).

## Integration

- `VLS = { on:false, alpha:45 }` next to `SL`/`QS`; `villSample()`,
  `drawVill()`, `stepVill()` in the same block; wired into the measure
  cadence (`frame%20`) like the other scopes.
- Port exposure: `window.__welded.vill = () => villSample()` plus `VLS` for
  headless probes.
- 3D panel (stretch, not gating): draw the current section plane + section
  loops on the mesh so the operator sees the plane slicing the surface live.

## Verification plan

1. Port probe: `villSample()` at α=0 must agree with `sliceSample()` at c=0
   (same section, same readouts within grid-sampling tolerance).
2. Port probe: α=45° on the Clifford torus — sampled points satisfy the
   closed-form C± within grid resolution; classification reads `tangent`.
3. Regime sweep headless: classification flips separate→tangent→interlaced
   exactly at α* (within numeric tolerance).
4. Field test: spawn a tilted band (level with structured spawn), confirm
   amp/phase respond and transition flag fires on sweep.
5. 0 pageerror, lab_build --check green, live URL 200.

## Lineage note

Conversation thread 2026-09-20 (#cog/continuity): toroid field → board as
projection plane → two crossing planes at the centroid → the third family
(Villarceau) → "multidimensional oscilloscope". The artifact
(Genesis-and-Diffs, coupling ratio → ellipse tilt) is the conceptual source of
the obliquity dial. This scope is the third observer frame: equatorial and
axial observers see their own sections; the oblique observer sees linkage
directly.
