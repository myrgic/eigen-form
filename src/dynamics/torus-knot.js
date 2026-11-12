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

// Standard (p,q) torus-knot point, projected to 2D. z = sin(radialPhase)
// is the knot's height above the projection plane (up to the factor
// radialAmp > 0); the engine uses its sign to decide which strand passes
// over at a crossing (see overStrandBands). orbitalRadius/radialAmp are
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

// Over/under at the crossings (GH #35). The trace is drawn in time: tau
// ms ago the point was at angle A + angRate*tau and radial phase
// B + radRate*tau (A, B the current phases, precession included in A and
// in angRate). It points in the current direction again at
// tau_j = -2*pi*j / angRate, j = 1, 2, ... Those earlier passes are the
// only strands the current step can cross.
//
// Without precession angRate/radRate = p/q, so pass j sits at radial
// phase B - 2*pi*j*q/p, and j = 1..p-1 are the other strands (j = p is
// this strand one lap ago). At a crossing their radii are equal, so
// cos(radial phase) agrees and sin(radial phase) has opposite sign for
// coprime (p,q): exactly one strand has z > 0. With precession the
// passes are found with the precessing angular rate, so the gap follows
// the rotated strands. Only j = 1..p-1 are used: older laps of the same
// strand (j >= p) are the rosette's own history, not a crossing of the
// knot, and gapping against them would cut the fresh stroke.
//
// For a step with z < 0, this returns the bands (closed polygons, logical
// px) of every earlier pass that is within reach of this step and had
// z > 0. The backend paints the step everywhere except inside those
// bands, which leaves a gap in the under-strand where the over-strand
// runs. A z > 0 step is simply painted on top. Everything is painted
// source-over, so a strand's newest lap covers its own older laps and the
// fresh deposit shows its own colour. Returns [] when no crossing is
// near, or when the tube radius is still too small for strands to be
// told apart (early emergence: all passes lie on one circle).
export function overStrandBands({ p, orbitalRadius, radialAmp, angularPhase, radialPhase, precessionPhase,
                                  angRate, radRate, cx, cy, width }) {
  const out = [];
  if (!(p >= 2) || !(radialAmp > width) || !(Math.abs(angRate) > 0)) return out;
  if (Math.sin(radialPhase) >= 0) return out;
  const A = angularPhase + precessionPhase;
  const r = orbitalRadius + radialAmp * Math.cos(radialPhase);
  const at = (tau) => {
    const rr = orbitalRadius + radialAmp * Math.cos(radialPhase + radRate * tau);
    const a = A + angRate * tau;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  };
  const J = p - 1;
  const reach = width + MAX_CHORD;
  for (let j = 1; j <= J; j++) {
    const tj = (-2 * Math.PI * j) / Math.abs(angRate);
    const Bj = radialPhase + radRate * tj;
    if (Math.sin(Bj) <= 0) continue;
    const rj = orbitalRadius + radialAmp * Math.cos(Bj);
    // reach: the step's stroke (half-width w/2, plus one chord) can touch
    // the other strand's band (half-width w/2) only if their distance is
    // < w + chord. The radial gap bounds that distance from ABOVE (the
    // strands cross the radial line at an angle), so the test uses a 3x
    // margin; a band that misses the stroke costs a clip, not a pixel.
    if (Math.abs(rj - r) > 3 * reach) continue;
    // band = that pass over a time window covering >= 4*(w + chord) of
    // arc on each side of the current direction
    const half = (4 * reach) / (Math.abs(angRate) * Math.max(1, Math.min(r, rj)));
    const K = 12, hw = width * 0.5 + 0.75;
    const left = [], right = [];
    for (let k = -K; k <= K; k++) {
      const tau = tj + (half * k) / K;
      const P0 = at(tau), P1 = at(tau + half * 1e-3);
      let tx = P1[0] - P0[0], ty = P1[1] - P0[1];
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      left.push([P0[0] - ty * hw, P0[1] + tx * hw]);
      right.push([P0[0] + ty * hw, P0[1] - tx * hw]);
    }
    out.push(left.concat(right.reverse()));
  }
  return out;
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
