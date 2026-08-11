> **v0.0.1** — torus-knot family only. Broader primitive families v0.2+.

# eigen-form Construction — Mathematical Basis

eigen-form v0.0.1 renders (p,q) torus knots: the simplest family of non-trivial knots, whose geometry falls directly from two coupled oscillators.

## Torus knot equations

A point on a (p,q) torus knot traces a path defined by two simultaneous circular motions: an angular oscillation at frequency p, and a radial oscillation at frequency q. In the plane:

```
x(τ) = cx + r(τ) · cos(p · τ)
y(τ) = cy + r(τ) · sin(p · τ)
r(τ) = R₀ + ρ · cos(q · τ)
```

Where:
- `τ` — phase parameter, increasing with time
- `cx, cy` — canvas centroid (240, 240 on the logical 480×480 canvas)
- `R₀ = (2/3) × scale` — mean orbital radius
- `ρ = (1/3) × scale` — radial oscillation amplitude
- `p` — angular eigenmode (default 2)
- `q` — radial eigenmode (default 3)

At `p=2, q=3`, the curve closes after one full period and traces the trefoil knot — three crossings, each visited twice per closure. The crossing structure is purely topological; it emerges from the arithmetic relationship between p and q, not from any 3D embedding.

### Closure period

The curve closes after exactly one orbital period (one complete cycle of `τ` from 0 to 2π). With Myrgic's phase convention, `τ = 2π/period × t`, so `τ = 2π` at `t = period` ms. The entire knot is traced in one period.

### Why (2,3)?

The (2,3) torus knot is the simplest non-trivial member of the family: the smallest p and q that produce a knotted (non-self-intersecting in 3D) curve. In the plane it appears as the trefoil — three lobes, three crossings. In music, 2:3 is the perfect fifth. Both relationships arise from the same arithmetic irreducibility.

## Phase-locked hue

Hue is locked 1:1 to the orbital period:

```
u(t) = (t - HUE_START_MS) / period   (mod 1)
hue = hueStart + span × f(u)
```

Where `span = hueEnd - hueStart`. For the full spectrum (span = 360°), hue maps linearly to orbital phase. For sub-band gradients (|span| < 360°), a triangle-wave `f(u)` ping-pongs between the two endpoints, avoiding a hard seam.

Three crossings occur at equal phase intervals (1/3 period apart). With hue locked to period, the two passes through each crossing are separated by exactly one half-period — antipodal in hue (e.g. red and cyan for spectrum). Topology is recorded by the substrate as color, without 3D geometry.

## Hue parallax

Parallax detunes the hue clock from the orbit clock:

```
huePeriod = period / (1 + parallax)
u(t) = (t - HUE_START_MS) / huePeriod
```

At `parallax=0`, hue is perfectly locked (same color at every re-visit). At `parallax>0`, the hue clock runs faster than the orbit, so successive passes over the same (x,y) paint increasingly shifted hues. This accumulates visible spectral banding in the trail — leading-edge redshift, trailing-edge blueshift — depth without depth.

## Substrate memory and fade compositing

The canvas is the substrate. Every frame, the trail decays toward the background color at a rate governed by `decay` (half-life in ms).

The decay uses a two-pass compositing approach to avoid 8-bit channel rounding drift:

1. **Destination-out** — erase the trail toward transparency by `fadeAlpha = 1 - exp(-ln2 · dt / halfLife)`.
2. **Destination-over** — fill the background beneath any transparent pixels.

This converges to the exact substrate color without the systematic desaturation that occurs with a naive source-over fade (where asymmetric rounding in RGB channels accumulates a grey halo).

An additional `snapToSubstrate` pass runs every 500ms and directly drains pixels within the 8-bit rounding floor (`residue ≤ ceil(0.5 / MIN_FADE_ALPHA) ≈ 42 channels`) that the compositing fade can never reach. This prevents the "ghost ring" artifact around a settled trail.

## Precession

When `precession ≠ 0`, the entire orbit frame rotates around the centroid:

```
precessionPhase(t) = sign(precession) · (2π / |precession|) · t
localAngle(t) = angularPhase(t) + precessionPhase(t)
```

Each orbital closure lands at a slightly rotated angular offset. Over multiple periods, the single-orbit trefoil becomes a spirograph or rosette, depending on the ratio of precession period to orbital period. The substrate retains all passes with exponential weighting — older passes are dimmer, forming a natural temporal depth gradient.

## Canvas coordinate system

The logical canvas is 480×480. Coordinates are scaled to the actual canvas element size at initialization: `ctx.scale(W/480, H/480)`. This means `scale`, `ballRadius`, and `strokeWidth` are specified in logical units, independent of the actual canvas resolution. Rendering at `width="1080" height="1080"` (Myrgic standard) produces crisp output at 2.25× logical resolution.

## Emergence sequence

When `emergence: true`, four phase windows control the animation startup:

| Phase | Time range | What changes |
|---|---|---|
| Appear | 200..500ms | `ballRadius` grows 0 → target (smoothstep) |
| Translate | 500..1100ms | `orbitalRadius` grows 0 → R₀ (smoothstep) |
| Settle | 1100..2000ms | `radialAmp` grows 0 → ρ; hue begins (smoothstep) |
| Trail grow | 2000..2000+period ms | `halfLife` ramps from 800ms → target `decay` |

Before the trail phase, the canvas is cleared to background color each frame (no accumulation). After settle begins, the compositing fade takes over.

Without `emergence`, the library pre-warms by simulating the full sequence at 16ms/frame before the first real frame — the canvas is pre-filled to steady state and the animation begins in the settled, fully-trailed condition.
