/* =====================================================================
   apps/aquarium/surface.js — the free surface: a 1D height field on the
   tank's top row, plus the caustic ray-cast it drives.

   Deliberately NOT a kernel channel (docs/agent-substrate-engine.md's
   grammar has no 1D-on-a-2D-grid primitive, and inventing one for a
   single consumer would be exactly the kind of premature-generality
   this engine's own header warns against). Cheap enough — one array of
   length `width` — to step on the CPU every frame regardless of which
   backend (webgl2 | cpu) is running the 2D substrate: index.html reads
   the substrate's own top-row vertical velocity (from a CPU state
   directly, or a small readback when backend is webgl2) as this
   system's forcing term, and feeds bubble-pop impulses in from the
   bubble population's own per-frame bookkeeping (index.html).

   Physics: a damped, driven 1D wave equation,
     h_tt = c^2 h_xx - gamma h_t + k * v_top
   integrated explicitly (dt = 1, matching the engine's own fixed-step
   convention) — h is the surface height (deviation from rest, in grid-
   cell units), v_top is the substrate's own vertical velocity sampled
   at the surface row, and bubble pops add a direct impulse to h_t.

   Stability, named plainly (found empirically, 2026-09-11, real-time-
   driver run: surfaceRms 0.0002 -> 36.9 -> 303.6 -> 837.4 at frame one
   / 5s / 15s / 30s, unbounded, and STILL rising — not a slow approach
   to some large-but-finite steady state, checked by running the real
   engine's own momentum.y as vTop for 5000 steps, see
   tests/aquarium-app.js): this explicit scheme is symplectic Euler
   applied to the wave PDE's own first-order-in-time form (v' = c^2
   h_xx, h' = v). Per spatial Fourier mode k, the discrete Laplacian's
   eigenvalue is -4 sin^2(k/2) in [-4, 0], so the mode's own angular
   frequency is omega = 2c|sin(k/2)| <= 2c; symplectic Euler with dt = 1
   is stable exactly when omega <= 2, i.e. c <= 1 — the CFL bound this
   module now enforces by construction (see C_MAX below) rather than
   trusting the caller's panel value to stay inside it.

   That bound covers every mode's OSCILLATION — it does not mean every
   mode is well DAMPED. The uniform (k = 0, "DC") mode has NO spring at
   all (the Laplacian is exactly zero for a flat h): under a forcing
   with any persistent spatial mean, gamma's damping still lets that
   mode's velocity settle to a nonzero value, and h has nothing pulling
   it back, so it integrates that residual velocity forever. The fix,
   matching what a real tank's physics already implies (total water
   volume is conserved, so the surface's mean height can't drift): treat
   h's own mean as exactly zero every step (see the `meanH` line below).

   That alone is NOT enough once the forcing has power at very low but
   NONZERO k too (measured: the real momentum.y field does, from the
   tank's one large buoyancy-driven convection cell) — for those modes
   omega is small but not zero, and the position eigenvalue works out to
   1 - omega^2/gamma, i.e. LARGER gamma makes a weak-spring mode decay
   SLOWER (the standard overdamped-relaxation-time-is-gamma/k result),
   so no choice of gamma alone bounds this. The actual physics gap is
   that h_tt = c^2 h_xx models a membrane/string restoring force, which
   vanishes at long wavelength — a real free water surface additionally
   has gravity as a restoring force at EVERY wavelength (the shallow-
   water h_tt = -g*h limit). Adding that term (see `g` below) gives
   every mode, including k = 0, a genuine nonzero spring constant
   (omega^2 = g + 4c^2 sin^2(k/2)), which is what actually keeps
   surfaceRms bounded and quick to settle (checked: ~3.3, steady within
   ~1000 steps, against the real engine's own momentum.y).

   Caustics: parallel "rays" (this is an approximation of the true
   caustic pattern a wavy surface makes, not a physically exhaustive
   optical simulation — named plainly, see docs/aquarium-design.md)
   enter vertically from above and refract once at the surface, per
   Snell's law linearized around the local surface slope, then travel
   in a straight line to either the tank floor or the back wall,
   depositing light there. A converging bundle of rays (the surface
   curving one way over a span) brightens where they land; a diverging
   bundle dims it — the same qualitative behaviour real caustics show,
   produced here by a 1/(1+k|slope|) intensity falloff rather than a
   true ray-density Jacobian, which would need tracing neighbouring
   rays and measuring their convergence — a further-work simplification
   named in docs/aquarium-design.md, not hidden.
   ===================================================================== */

/** A fresh, flat surface: h (height) and v (h_t, vertical velocity) are
 *  both zero everywhere. */
export function createSurface(width) {
  return { h: new Float32Array(width), v: new Float32Array(width) };
}

// CFL bound for this explicit (symplectic-Euler) scheme at dt = 1,
// dx = 1 (this file's header, "Stability, named plainly"): with the
// gravity term below, a mode's own omega^2 tops out at G_DEFAULT +
// 4*c^2, and stability needs omega <= 2 — c must stay below 1 for any
// g this small to matter. 0.95 leaves a small margin rather than
// sitting exactly on the boundary.
const C_MAX = 0.95;

// Gravity restoring coefficient (this file's header, "Stability, named
// plainly"): the shallow-water h_tt = -g*h term real free-surface waves
// always have, regardless of wavelength — what the pure c^2 h_xx term
// alone is missing at long wavelength (k -> 0). Calibrated empirically
// against the real engine's own momentum.y (5000 steps, default c/
// gamma/k): 0.03 settles surfaceRms to ~3.3 grid-cell-units within
// ~1000 steps and holds it there; an order of magnitude smaller (0.005)
// still converges but to a much larger ~16; an order larger (0.3) is
// visually near-flat. 0.03 is the value tests/aquarium-app.js checks.
const G_DEFAULT = 0.03;

/** One explicit step of the damped, driven 1D wave equation.
 *  `vTop(x)` samples the substrate's own vertical velocity at column x
 *  of the surface row — a plain function so the caller can supply
 *  either a direct CPU array read or a value pulled from a GPU
 *  readback, without this module caring which. `pops` is an array of
 *  `{ x, amount }` impulses (a bubble bursting at the surface this
 *  frame) applied directly to h_t before the wave step. `params.g`
 *  (gravity restoring coefficient) is optional, defaulting to
 *  G_DEFAULT — see this file's header, "Stability, named plainly". */
export function stepSurface(surface, params, vTop, pops) {
  const { h, v } = surface;
  const W = h.length;
  // Clamp by construction (this file's header, "Stability, named
  // plainly") rather than trusting the caller's panel value to stay
  // inside the CFL bound.
  const c = Math.max(0, Math.min(C_MAX, Math.abs(params.c)));
  const { gamma, k } = params;
  const g = params.g == null ? G_DEFAULT : params.g;

  for (const { x, amount } of pops) {
    const xi = Math.max(0, Math.min(W - 1, Math.round(x)));
    v[xi] += amount;
  }

  // h_xx via a wall (reflecting) boundary — the surface doesn't wrap
  // around a tank with real walls.
  const newV = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const l = h[x > 0 ? x - 1 : 0];
    const r = h[x < W - 1 ? x + 1 : W - 1];
    const lap = l - 2 * h[x] + r;
    const forcing = k * vTop(x);
    newV[x] = v[x] + (c * c * lap - g * h[x] - gamma * v[x] + forcing);
  }
  let meanH = 0;
  for (let x = 0; x < W; x++) { h[x] += newV[x]; v[x] = newV[x]; meanH += h[x]; }
  meanH /= W;
  // Belt-and-suspenders on top of the gravity term above: a real tank's
  // water volume is conserved, so the surface's own mean height can
  // never actually drift — hold that exactly rather than trusting g's
  // (very small, nonzero) DC spring constant to converge it precisely
  // to zero on its own.
  if (meanH !== 0) { for (let x = 0; x < W; x++) h[x] -= meanH; }
}

/** Cast `rayCount` parallel rays from directly above the tank, refract
 *  each once at the surface (Snell's law, linearized: the surface's
 *  local slope stands in for the tilt of its normal, valid for the
 *  small slopes this wave equation actually produces), and trace to
 *  where each lands — the floor (`height - 1`) or, if the refracted
 *  ray would exit the right or left wall first, that wall's column at
 *  floor depth. Returns `[x, y, amount]` triples in grid space, ready
 *  for a nearest-cell scatter deposit (engine/webgl2.js's scatterAdd;
 *  engine/cpu.js's addCell) into the 'light' channel — see spec.js's
 *  header for why this is an app-level per-frame scatter rather than a
 *  declared ReactionSpec. */
export function castCaustics(surface, width, height, rayCount, refractiveIndex, intensity) {
  const hits = [];
  const n = refractiveIndex;
  for (let i = 0; i < rayCount; i++) {
    const x0 = (i + 0.5) / rayCount * width;
    const xi = Math.max(0, Math.min(width - 1, Math.round(x0)));
    const l = surface.h[xi > 0 ? xi - 1 : 0];
    const r = surface.h[xi < width - 1 ? xi + 1 : width - 1];
    const slope = (r - l) / 2;
    const thetaSurfaceTilt = Math.atan(slope);
    // Snell's law for a ray entering water from air (n_air = 1) at
    // incidence angle thetaSurfaceTilt (the local normal's own tilt,
    // since the incoming ray is vertical): sin(theta_i) = n * sin(theta_t).
    const sinRefract = Math.max(-1, Math.min(1, Math.sin(thetaSurfaceTilt) / n));
    const thetaRefract = Math.asin(sinRefract);
    const depth = Math.max(1, height - 1 - surface.h[xi]);
    let hitX = x0 + Math.tan(thetaRefract) * depth;
    let hitY = height - 1;
    if (hitX < 0) { hitX = 0; }
    else if (hitX > width - 1) { hitX = width - 1; }
    // Convergent bundles (large |slope| change concentrating rays)
    // brighten; this 1/(1+k|slope|)-style falloff is a named proxy for
    // a true ray-density Jacobian (see this file's header).
    const amount = intensity / (1 + 3 * Math.abs(slope));
    hits.push([hitX, hitY, amount]);
  }
  return hits;
}

export default { createSurface, stepSurface, castCaustics };
