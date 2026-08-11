/* =====================================================================
   src/dynamics/torus-knot.js — the (p, q) torus-knot parametrization,
   its emergence phase windows, and arc-length-bounded stepping.

   Everything here is a pure function of its arguments: no canvas, no
   DOM, no mutable module state. The engine (src/eigen-form.js) owns the
   only mutable state that belongs to a live mark — angularPhase and
   radialPhase, the running orbital integration — and threads it through
   stepPhases() each substep.
   ===================================================================== */

// Max chord length (logical px) for curve sampling — keeps the polyline
// smooth regardless of frame rate / dropped frames.
export const MAX_CHORD = 3;

// Phase windows for the emergence sequence, in ms from mark creation.
export function phases(period) {
  return {
    appear:    [200,  500],
    translate: [500,  1100],
    settle:    [1100, 2000],
    trailGrow: [2000, 2000 + period]
  };
}

export function smoothstep(x, e0, e1) {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

// The two torus-knot radii (orbital radius, tube radius) at a given
// scale. R0 + RHO*cos(radialPhase) is the standard (p,q) torus-knot
// radial term; R0/RHO are ramped independently during emergence (see
// orbitalRadiusFactor/radialAmpFactor in the engine) before settling to
// their full value here.
export function torusKnotRadii(scale) {
  return { R0: scale * 2 / 3, RHO: scale * 1 / 3 };
}

// Standard (p,q) torus-knot point, projected to 2D with the suppressed
// axis z = sin(radialPhase) kept purely as a depth proxy (over/under
// crossing order), not literal 3D rendering. orbitalRadius/radialAmp are
// passed in already emergence-ramped; passing the full R0/RHO from
// torusKnotRadii() reproduces the closed-form steady state.
export function knotPoint({ orbitalRadius, radialAmp, angularPhase, radialPhase, precessionPhase, cx, cy }) {
  const r = orbitalRadius + radialAmp * Math.cos(radialPhase);
  const localAngle = angularPhase + precessionPhase;
  const x = cx + r * Math.cos(localAngle);
  const y = cy + r * Math.sin(localAngle);
  const z = Math.sin(radialPhase);
  return { x, y, z };
}

// One Euler step of the running angular/radial phase integration.
export function stepPhases({ angularPhase, radialPhase, angularOmega, radialOmega, subDt }) {
  return {
    angularPhase: angularPhase + angularOmega * subDt,
    radialPhase: radialPhase + radialOmega * subDt
  };
}

// Arc-length-bounded sampling: subdivide a frame's phase step into
// enough sub-steps that no chord exceeds maxChord logical px, independent
// of frame rate. Avoids the kinked-polyline effect of a single long
// chord after a dropped frame.
export function computeSubstepPlan({ R0, RHO, orbitalRadiusFactor, radialAmpFactor, angularOmega, radialOmega, dt, maxChord = MAX_CHORD }) {
  const rApprox = (R0 + RHO) * Math.max(orbitalRadiusFactor, radialAmpFactor, 0.01);
  const speedApprox = rApprox * Math.max(angularOmega, radialOmega, 1e-6);
  const frameArc = speedApprox * dt;
  const steps = Math.max(1, Math.min(64, Math.ceil(frameArc / maxChord)));
  const subDt = dt / steps;
  return { steps, subDt };
}
