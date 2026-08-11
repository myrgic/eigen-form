> **v0.0.1** — torus-knot family only. Broader primitive families v0.2+.

# eigen-form Parameters

All parameters are read/write via `controller.params` and updatable at runtime via `controller.setParam(key, value)`.

## Core geometry

### `p` — angular eigenmode
- **Type:** integer
- **Default:** `2`
- **Range:** any positive integer (practical range: 1..7)
- **Visual:** number of petals / lobes in the knot. p=2, q=3 produces the trefoil (3-crossing figure-eight family). Increasing p adds angular subdivisions.

### `q` — radial eigenmode
- **Type:** integer
- **Default:** `3`
- **Range:** any positive integer (practical range: 1..7); gcd(p,q)=1 for a knot
- **Visual:** radial oscillation count per orbital period. Controls how many radial bumps appear in one orbit. q=3, p=2 is the trefoil. The closure period is lcm(p,q) × orbital period.

### `scale` — trefoil scale
- **Type:** number (logical pixels on 480×480 canvas)
- **Default:** `215`
- **Range:** 50..350 (beyond 350, corners clip the canvas)
- **Visual:** overall size of the knot. R₀ = 2/3 × scale, ρ = 1/3 × scale.

## Timing

### `period` — orbital closure period
- **Type:** number (ms)
- **Default:** `3000`
- **Range:** 500..30000
- **Visual:** time for the wavefront to complete one full orbital closure. Shorter = faster animation; longer = more trail accumulated per pass. Hue cycle is phase-locked to this period.

### `decay` — substrate memory half-life
- **Type:** number (ms)
- **Default:** `6000`
- **Range:** 500..60000
- **Visual:** how long the trail glows before fading. At half-life ms, the trail has decayed to half its original brightness. Shorter = crisp, fast-fading trail. Longer = deep ghosting, overlapping accumulation.

### `precession` — centroid rotation period
- **Type:** number (ms)
- **Default:** `0` (disabled)
- **Range:** ±1000..±100000
- **Visual:** slowly rotates the entire knot orbit around the canvas centroid. Successive revolutions land at slightly different angles, accumulating a spirograph / rosette family from the single primitive. Positive = prograde (clockwise), negative = retrograde.

## Wavefront appearance

### `ballRadius` — wavefront point radius
- **Type:** number (px on logical canvas)
- **Default:** `18`
- **Range:** 2..60
- **Visual:** the radius of the wavefront point. Larger = fatter dot; smaller = hairline wavefront. Also scales the stroke width if `strokeWidth` is not set explicitly.

### `strokeWidth` — trail stroke width
- **Type:** number (px) or `null`
- **Default:** `null` (uses `2 * ballRadius`)
- **Range:** 1..100
- **Visual:** explicit trail stroke width. Setting this independently of `ballRadius` allows a tiny point with a thick trailing stroke (brushy) or a large point with a thin stroke (hairy).

## Color

### `gradient` — color treatment
- **Type:** string name or object
- **Default:** `"spectrum"`
- **Visual:** controls how hue cycles across the trail. Named presets map to hue spans (see `api.md` for the full table). Custom objects: `{ hueStart, hueEnd, sat, light, lightEnd }`.

### `parallax` — hue-parallax strength
- **Type:** number (0..1)
- **Default:** `0`
- **Range:** 0..1
- **Visual:** detunes the hue clock from the orbit clock. At 0, hue is perfectly locked to the orbital period — every position on the knot gets the same color on every pass. At parallax > 0, the hue clock runs faster than the orbital clock, so successive passes over the same point paint different hues. This creates visible "redshift/blueshift" bands in the accumulated trail — visual depth without 3D geometry.

### `bg` — substrate color
- **Type:** hex string (`"#0a0a0f"`), `"rgb(10,10,15)"`, or `[r, g, b]` array
- **Default:** `[10, 10, 15]` (#0a0a0f — Myrgic substrate)
- **Visual:** the background color the trail fades toward. Matching your page background produces a seamless infinite-depth effect.

## Emergence

### `emergence`
- **Type:** boolean
- **Default:** `false`
- **Visual:** when true, plays the full four-phase animation sequence from a blank canvas:
  1. **Appear** (200..500ms) — ball radius grows from 0.
  2. **Translate** (500..1100ms) — orbital radius expands from center.
  3. **Settle** (1100..2000ms) — radial amplitude locks in; hue begins.
  4. **Trail grow** (2000..2000+period ms) — decay half-life ramps up to target.

  When false (default), the library pre-warms to steady state before the first frame is rendered, so the canvas shows the fully-settled knot immediately.

## Configurator

The `examples/configurator.html` provides a live interactive panel for all parameters. Use it to explore parameter combinations and find your desired visual before hardcoding values.
