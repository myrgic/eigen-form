/* =====================================================================
   apps/aquarium/engine/rng.js — counter-based hash RNG.

   No state: every draw is a pure function of (seed, index, step, stream)
   turned into a 32-bit integer, then a float in [0, 1). That means two
   runs seeded alike draw alike no matter what order the calls happen in
   or how many draws ran before, which is what "300 steps bit-identical"
   (tests/aquarium-engine.js) actually needs from an RNG: not "seeded",
   but "addressed by counter", so nothing about draw order or prior calls
   can leak into the result.

   The hash is Thomas Wang's 32-bit integer hash (public-domain, widely
   used in game and shader RNGs for exactly this reason: it is built
   entirely from 32-bit add/xor/shift/multiply, all of which wrap at
   2^32 the same way in a GLSL ES 3.0 `uint` and in JS `>>> 0` /
   `Math.imul`). That is the property this module leans on to promise a
   bit-identical GLSL port in the WebGL2 backend (engine/webgl2.js): the
   same six lines, same constants, `uint` instead of `>>> 0`.

   Four inputs are folded into one hash by repeated xor-then-rehash
   (`mix`), which is the standard way to combine independent hash lanes
   without a wider (64-bit) intermediate — this repo's GLSL ES 3.0 target
   has no 64-bit integers, so anything wider than 32 bits is off the
   table by construction, not by choice.
   ===================================================================== */

/** Thomas Wang's 32-bit integer hash. Input and output are both treated
 *  as unsigned 32-bit; callers should pass already-`>>> 0`-normalized
 *  values, and this function always returns one. */
function hash32(a) {
  a = ((a ^ 61) ^ (a >>> 16)) >>> 0;
  a = (a + (a << 3)) >>> 0;
  a = (a ^ (a >>> 4)) >>> 0;
  a = Math.imul(a, 0x27d4eb2f) >>> 0;
  a = (a ^ (a >>> 15)) >>> 0;
  return a >>> 0;
}

/** Fold a second hash lane into an accumulator: xor then rehash. */
function mix(h, v) {
  return hash32((h ^ hash32(v >>> 0)) >>> 0);
}

/** Combine (seed, index, step, stream) into one 32-bit hash. Order
 *  matters only in that it must be applied identically everywhere this
 *  module (or its GLSL port) is called — the CPU and GPU backends both
 *  hash in exactly this order: seed, then index, then step, then
 *  stream. */
function hash4(seed, index, step, stream) {
  let h = hash32(seed >>> 0);
  h = mix(h, index);
  h = mix(h, step);
  h = mix(h, stream);
  return h;
}

/** A uniform float in [0, 1) addressed by (seed, index, step, stream).
 *  `stream` distinguishes independent draws made at the same
 *  (seed, index, step) — e.g. a tie-break draw and a deposit-jitter draw
 *  in the same agent's same step use different `stream` ids so neither
 *  correlates with the other. */
function rand01(seed, index, step, stream) {
  return hash4(seed, index, step, stream) / 4294967296; // 2^32
}

/** A uniform float in [-1, 1), same addressing. */
function randSigned(seed, index, step, stream) {
  return rand01(seed, index, step, stream) * 2 - 1;
}

/** Box-Muller: two independent uniform draws (via two `stream` ids
 *  derived from `stream`) folded into one standard-normal sample.
 *  Uses Math.log/Math.sqrt/Math.cos, which is why this module — like
 *  the rest of the reference path — is tier 1 (per-engine bit-identical)
 *  rather than tier 2 (universal): a transcendental function's last bit
 *  is allowed to vary across JS engines, per
 *  docs/executable-experiments-design.md's "Determinism, honestly". */
function randNormal(seed, index, step, stream) {
  const u1 = Math.max(rand01(seed, index, step, stream * 2), 1e-9); // avoid log(0)
  const u2 = rand01(seed, index, step, stream * 2 + 1);
  const r = Math.sqrt(-2 * Math.log(u1));
  return r * Math.cos(2 * Math.PI * u2);
}

/** One Euler-Maruyama step of an Ornstein-Uhlenbeck process:
 *    dx = theta * (mu - x) * dt + sigma * sqrt(dt) * dW
 *  seeded by (seed, index, step, stream) so a run is fully reproducible
 *  from those four integers alone — no RNG object, no mutable state. */
function ouStep(x, theta, mu, sigma, dt, seed, index, step, stream) {
  const noise = randNormal(seed, index, step, stream);
  return x + theta * (mu - x) * dt + sigma * Math.sqrt(dt) * noise;
}

/* -----------------------------------------------------------------------
   The GLSL ES 3.0 port of hash32/mix/hash4/rand01, kept here as a string
   so the WebGL2 backend (engine/webgl2.js) can inline exactly this text
   into every fragment/vertex shader that needs a draw, rather than
   hand-retyping it (and risking the two copies drifting) at each call
   site. Read the two side by side: every operator below is the direct
   GLSL spelling of the JS above, `uint` standing in for `>>> 0` because
   GLSL ES 3.0 `uint` already wraps at 2^32 on every operation, same as
   JS after a `>>> 0`.
   ----------------------------------------------------------------------- */
const GLSL_HASH = `
uint efHash32(uint a) {
  a = (a ^ 61u) ^ (a >> 16u);
  a = a + (a << 3u);
  a = a ^ (a >> 4u);
  a = a * 0x27d4eb2fu;
  a = a ^ (a >> 15u);
  return a;
}
uint efMix(uint h, uint v) {
  return efHash32(h ^ efHash32(v));
}
uint efHash4(uint seed, uint index, uint step, uint stream) {
  uint h = efHash32(seed);
  h = efMix(h, index);
  h = efMix(h, step);
  h = efMix(h, stream);
  return h;
}
float efRand01(uint seed, uint index, uint step, uint stream) {
  return float(efHash4(seed, index, step, stream)) / 4294967296.0;
}
`;

export { hash32, mix, hash4, rand01, randSigned, randNormal, ouStep, GLSL_HASH };
export default { hash32, mix, hash4, rand01, randSigned, randNormal, ouStep, GLSL_HASH };
