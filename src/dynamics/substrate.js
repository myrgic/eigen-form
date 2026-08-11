/* =====================================================================
   src/dynamics/substrate.js — the trail's deposit-and-decay accumulator,
   as pure state. No canvas: this module decides *whether* and *by how
   much* the substrate should fade this frame; src/backends/canvas2d.js
   is the only place that turns that decision into a paint call.
   ===================================================================== */

export const DECAY_LN_HALF = Math.log(0.5);

// Minimum alpha to actually paint a fade pulse — canvas alpha is 8-bit,
// so anything smaller than ~1/255 rounds to zero and would never decay
// the trail. Below this, stepFade holds the accumulator open instead of
// spending a paint call.
export const MIN_FADE_ALPHA = 3 / 255;

// The trail's half-life ramps from a short 800ms up to the full
// params.decay over the trailGrow phase window (see torus-knot.js's
// phases()), so the very first fade pulses after trailGrow starts don't
// dump an enormous amount of decay at once.
export function halfLifeFor(decay, trailRamp) {
  return 800 + (decay - 800) * trailRamp;
}

// One accumulator step. Small per-frame dt values produce alpha too
// small to register in 8-bit, so dt keeps accumulating (nextAccum keeps
// growing, alpha stays null — "don't paint yet") until enough has built
// up to cross minFadeAlpha, at which point the accumulator resets to 0
// and alpha carries the value to paint.
export function stepFade(fadeDtAccum, dt, halfLife, minFadeAlpha = MIN_FADE_ALPHA) {
  const nextAccum = fadeDtAccum + dt;
  const fadeAlpha = 1 - Math.exp(DECAY_LN_HALF * nextAccum / halfLife);
  if (fadeAlpha >= minFadeAlpha) {
    return { alpha: fadeAlpha, nextAccum: 0 };
  }
  return { alpha: null, nextAccum };
}
