/* =====================================================================
   apps/aquarium/plants.js — CPU-side Verlet chains, anchored on the
   gravel line.

   THE ONE NON-ENGINE POPULATION (spec.js's header says this too; it is
   worth saying twice, at both ends of the code that makes it true).
   Every other agent kind in this app (fish, plankton, bubbles) is a
   declared PopulationSpec the shared engine steps identically on
   either backend. A plant is not: it is a small Verlet integration
   with its own iterative constraint solve, hand-stepped by index.html
   every frame, using the engine's own read/deposit PRIMITIVES
   (bilinear sampling to read light, a scatter deposit to write oxygen/
   nitrate) rather than its declarative WeldSpec form, because a Verlet
   chain's constraint relaxation loop isn't a kernel operation this
   engine has (or, for six small plants, needs) a declarative shape
   for.

   Verlet integration (no explicit velocity — position and previous
   position ARE the velocity, this is the classic "Verlet as used in
   every cloth-sim tutorial" scheme, picked here for its unconditional
   stability with a fixed dt, which is what a fixed-step aquarium wants
   more than integration order): each free point advances by
   `x + (x - xPrev) * damping + acceleration`, then a fixed number of
   distance-constraint relaxation passes pulls each segment back toward
   its rest length, anchor point held fixed every pass.
   ===================================================================== */

/** `count` plants, each `segments` free points plus a fixed anchor,
 *  spread evenly across the gravel line (meta.gravelRow), points laid
 *  out standing straight up from rest. Deterministic in x-position
 *  (evenly spaced, not randomized) — a plant bed's positions are a
 *  layout decision, not a modeled random process. */
export function createPlants(count, segments, segLength, meta) {
  const plants = [];
  for (let p = 0; p < count; p++) {
    const anchorX = meta.width * (0.08 + 0.84 * ((p + 0.5) / Math.max(1, count)));
    const anchorY = meta.gravelRow;
    const points = [];
    for (let s = 0; s <= segments; s++) {
      const x = anchorX, y = anchorY - s * segLength;
      points.push({ x, y, px: x, py: y });
    }
    plants.push({ anchorX, anchorY, points });
  }
  return plants;
}

/** One Verlet step for every plant. `sampleMomentum(x, y) -> [vx, vy]`
 *  is a plain function (bilinearSample against either a direct CPU
 *  array or a GPU readback, index.html's choice) so this module never
 *  touches a backend directly. `damping` (< 1) bleeds a little energy
 *  each step so a plant settles rather than oscillating forever;
 *  `driftBias` is a small constant downward+sideways acceleration
 *  standing in for the plant's own slight negative buoyancy /
 *  resistance to standing bolt upright — without it every plant looks
 *  identically rigid regardless of the current. */
export function stepPlants(plants, { drag, iterations, segLength, damping = 0.985, driftBias = 0.006 }, sampleMomentum) {
  for (const plant of plants) {
    const pts = plant.points;
    for (let i = 1; i < pts.length; i++) {
      const pt = pts[i];
      const vx = (pt.x - pt.px) * damping;
      const vy = (pt.y - pt.py) * damping;
      const [mvx, mvy] = sampleMomentum(pt.x, pt.y);
      const ax = drag * mvx;
      const ay = drag * mvy + driftBias;
      const nx = pt.x + vx + ax;
      const ny = pt.y + vy + ay;
      pt.px = pt.x; pt.py = pt.y;
      pt.x = nx; pt.y = ny;
    }
    pts[0].x = plant.anchorX; pts[0].y = plant.anchorY;
    pts[0].px = plant.anchorX; pts[0].py = plant.anchorY;

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const diff = (dist - segLength) / dist;
        const corrX = dx * 0.5 * diff, corrY = dy * 0.5 * diff;
        if (i > 0) { a.x += corrX; a.y += corrY; }
        b.x -= corrX; b.y -= corrY;
      }
      pts[0].x = plant.anchorX; pts[0].y = plant.anchorY;
    }
  }
}

/** Deposit points for this frame: oxygen proportional to the light
 *  level AT each free segment's own position, and a flat nitrate
 *  uptake (negative deposit) at the same positions. `sampleLight(x, y)`
 *  is again a plain bilinear-sample function, backend-agnostic.
 *  Returns two point lists (`[x, y, amount]`), capped-per-call-size
 *  batching left to the caller (engine/webgl2.js's scatterAdd bounds a
 *  single call at MAX_SCATTER_POINTS; index.html chunks). */
export function plantDepositPoints(plants, sampleLight, oxygenRate, nitrateRate) {
  const oxygenPoints = [];
  const nitratePoints = [];
  for (const plant of plants) {
    for (let i = 1; i < plant.points.length; i++) {
      const pt = plant.points[i];
      const light = sampleLight(pt.x, pt.y);
      oxygenPoints.push([pt.x, pt.y, oxygenRate * light]);
      nitratePoints.push([pt.x, pt.y, -nitrateRate]);
    }
  }
  return { oxygenPoints, nitratePoints };
}

export default { createPlants, stepPlants, plantDepositPoints };
