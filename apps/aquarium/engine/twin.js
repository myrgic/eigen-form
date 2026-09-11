/* =====================================================================
   apps/aquarium/engine/twin.js — the twin protocol.

   docs/executable-experiments-design.md, "The shader correspondence":
   "a GPU path, when it arrives, is the fast projection, verified against
   the reference within a declared tolerance and never trusted past it."
   This module IS that verification: given a spec, run cpu.js as the
   reference and (when a WebGL2 context is supplied) webgl2.js as the
   projection, over the same number of steps from the same initial
   condition, and report per-channel error plus agent-position error
   against the spec's own declared tolerance (kernel.js's
   `tolerance: { relL2, maxAbs, agentPos }`).

   No DOM here either — twin.js only needs a WebGL2 rendering context,
   which apps/aquarium/twin.html supplies from a real <canvas>; a
   headless test harness could supply one from any other source.
   ===================================================================== */

import { createState as cpuCreateState, resetAgents as cpuResetAgents, step as cpuStep } from './cpu.js';
import { createGLState, uploadInitialState, stepGL, readback as glReadback, readAgents as glReadAgents } from './webgl2.js';

function flatten(fieldValue) {
  // Matches cpu.js's state.fields shape: a scalar channel is a flat
  // Float32Array; a vector channel is {x, y}. Flatten both to one
  // comparable array (vector: x then y concatenated) so relL2/maxAbs
  // are computed the same way regardless of channel kind.
  if (fieldValue instanceof Float32Array) return fieldValue;
  const out = new Float32Array(fieldValue.x.length + fieldValue.y.length);
  out.set(fieldValue.x, 0);
  out.set(fieldValue.y, fieldValue.x.length);
  return out;
}

function l2(arr) {
  let acc = 0;
  for (let i = 0; i < arr.length; i++) acc += arr[i] * arr[i];
  return Math.sqrt(acc);
}

function maxAbs(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) { const v = Math.abs(arr[i]); if (v > m) m = v; }
  return m;
}

/** Per-channel error between two flattened arrays: relative L2 (against
 *  the reference's own norm, with a small epsilon floor so an
 *  all-zero-or-tiny reference field doesn't produce a meaningless
 *  division) and max absolute error. */
function channelError(cpuFlat, gpuFlat) {
  if (cpuFlat.length !== gpuFlat.length) {
    throw new Error(`aquarium/twin: channel length mismatch (cpu ${cpuFlat.length}, gpu ${gpuFlat.length})`);
  }
  const diff = new Float32Array(cpuFlat.length);
  for (let i = 0; i < diff.length; i++) diff[i] = cpuFlat[i] - gpuFlat[i];
  const refNorm = l2(cpuFlat);
  const relL2 = l2(diff) / Math.max(refNorm, 1e-6);
  return { relL2, maxAbs: maxAbs(diff) };
}

/** Toroidal-aware Euclidean distance between a CPU and a GPU agent
 *  position: for a wrap boundary, a physically-negligible drift that
 *  happens to straddle the wrap seam would otherwise read as a huge
 *  positional error. */
function wrappedDelta(a, b, dim, wrap) {
  let d = a - b;
  if (wrap) {
    d = ((d + dim / 2) % dim + dim) % dim - dim / 2;
  }
  return d;
}

function agentPositionError(cpuAgents, gpuAgents, width, height, wrap) {
  const N = cpuAgents.x.length;
  let sum = 0, max = 0;
  for (let i = 0; i < N; i++) {
    const dx = wrappedDelta(cpuAgents.x[i], gpuAgents.x[i], width, wrap);
    const dy = wrappedDelta(cpuAgents.y[i], gpuAgents.y[i], height, wrap);
    const d = Math.hypot(dx, dy);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / N, max };
}

/** Run `spec` for `steps` on the CPU reference and, when `gl` is
 *  supplied, on the WebGL2 projection from the identical initial
 *  condition, and report the comparison. Returns:
 *    {
 *      steps, tolerance,
 *      channels: { [name]: { relL2, maxAbs, pass } },
 *      agentPos: { mean, max, pass } | null,
 *      pass: boolean   // AND of every channel's and agentPos's pass
 *    }
 *  When no `gl` is supplied, only the CPU reference runs and the
 *  function returns `{ steps, tolerance, cpuOnly: true }` — useful for
 *  exercising a spec headlessly without a WebGL2 context.
 *
 *  Two kinds of comparison, not one, because a population with a
 *  branching motor policy (steerByAngle's F/L/R decision) is a chaotic
 *  system: verified empirically (docs/agent-substrate-engine.md, "The
 *  twin protocol") that a single sensor pair landing within a few ULPs
 *  of each other compares differently on the CPU's and GPU's native
 *  cos/sin, flips one agent's turn that step, and that ONE flip's
 *  changed trajectory and deposits cascade — by 200 steps, pointwise
 *  field relL2 exceeds 50% and is not a meaningful "did the GPU backend
 *  do the right thing" signal any more, for the same reason two runs of
 *  a double pendulum from imperceptibly different starting angles are
 *  not comparable pointwise after enough time. So:
 *    - `early`: a tight pointwise comparison at `tolerance.earlyStep`
 *      (well before the chaotic divergence takes hold) — this is what
 *      actually verifies the kernel ops (diffuse, decay, motor, deposit)
 *      are faithfully ported, gated against `tolerance.earlyRelL2` /
 *      `tolerance.earlyMaxAbs`.
 *    - `aggregate`: at the full `steps` count, a statistical comparison
 *      declared per spec in `tolerance.aggregate` (variance of a scalar
 *      channel, or the order parameter of agent headings) — this is
 *      what verifies the SCIENTIFIC claim (structure forms / agents
 *      align) still holds on both backends, without asking a chaotic
 *      system's exact microstate to agree.
 *    - `final`: the same pointwise comparison as `early`, but at the
 *      full step count — reported for transparency (the honest, large
 *      numbers this file's history found), never gating `pass`.
 */
function runTwin(spec, steps, gl) {
  const cpuState = cpuCreateState(spec);
  cpuResetAgents(spec, cpuState);

  if (!gl) {
    for (let i = 0; i < steps; i++) cpuStep(spec, cpuState);
    return { steps, tolerance: spec.tolerance, cpuOnly: true };
  }

  // Snapshot the identical initial condition before either backend
  // steps, so both start from exactly the same state (see webgl2.js's
  // uploadInitialState: initial state is a pure function of the spec's
  // seed, so this costs nothing in fidelity).
  const glState = createGLState(gl, spec);
  uploadInitialState(gl, glState, cpuState);

  const tolerance = spec.tolerance;
  let early = null;

  for (let i = 0; i < steps; i++) {
    cpuStep(spec, cpuState);
    stepGL(gl, glState);
    if (tolerance.earlyStep && i + 1 === tolerance.earlyStep) {
      early = snapshotComparison(spec, gl, glState, cpuState, tolerance.earlyRelL2, tolerance.earlyMaxAbs);
    }
  }

  const final = snapshotComparison(spec, gl, glState, cpuState, tolerance.relL2, tolerance.maxAbs);

  let aggregate = null;
  if (tolerance.aggregate) {
    aggregate = tolerance.aggregate.map((check) => evaluateAggregate(check, spec, gl, glState, cpuState));
  }

  const pass = (early ? early.pass : true) && (aggregate ? aggregate.every((a) => a.pass) : true);

  return { steps, tolerance, early, final, aggregate, pass };
}

function snapshotComparison(spec, gl, glState, cpuState, relL2Bound, maxAbsBound) {
  const channels = {};
  let allPass = true;
  for (const ch of spec.channels) {
    const cpuFlat = flatten(cpuState.fields[ch.name]);
    const gpuFlat = flatten(glReadback(gl, glState, ch.name));
    const err = channelError(cpuFlat, gpuFlat);
    const pass = err.relL2 <= relL2Bound && err.maxAbs <= maxAbsBound;
    channels[ch.name] = { ...err, pass };
    if (!pass) allPass = false;
  }

  let agentPos = null;
  if (spec.population) {
    const gpuAgents = glReadAgents(gl, glState);
    const wrap = spec.population.boundary === 'wrap';
    const err = agentPositionError(cpuState.agents, gpuAgents, spec.width, spec.height, wrap);
    const pass = err.max <= spec.tolerance.agentPos;
    agentPos = { ...err, pass };
    if (!pass) allPass = false;
  }

  return { channels, agentPos, pass: allPass };
}

function variance(arr) {
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean /= arr.length;
  let acc = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - mean; acc += d * d; }
  return acc / arr.length;
}

function orderParameter(headings) {
  let sx = 0, sy = 0;
  for (let i = 0; i < headings.length; i++) { sx += Math.cos(headings[i]); sy += Math.sin(headings[i]); }
  return Math.hypot(sx, sy) / headings.length;
}

/** One declared aggregate check: either `{ metric: 'variance', field }`
 *  (compares Var(cpuField) to Var(gpuField), scalar channels only) or
 *  `{ metric: 'orderParameter' }` (compares the alignment of cpu vs gpu
 *  agent headings). Bound the gap with `maxAbsDiff` (absolute) or
 *  `maxRelDiff` (relative to the CPU reference value — the right choice
 *  when the statistic's own scale depends on grid size or units, e.g.
 *  field variance); declare whichever one is meaningful for that metric.
 *  `minValue`, if given, additionally requires BOTH backends' statistic
 *  to have cleared that bar (did the phenomenon actually happen, on both
 *  backends, not just "did they agree while both doing nothing"). */
function evaluateAggregate(check, spec, gl, glState, cpuState) {
  let cpuValue, gpuValue;
  if (check.metric === 'variance') {
    cpuValue = variance(cpuState.fields[check.field]);
    gpuValue = variance(glReadback(gl, glState, check.field));
  } else if (check.metric === 'orderParameter') {
    cpuValue = orderParameter(cpuState.agents.heading);
    gpuValue = orderParameter(glReadAgents(gl, glState).heading);
  } else {
    throw new Error(`aquarium/twin: unknown aggregate metric "${check.metric}"`);
  }
  const absDiff = Math.abs(cpuValue - gpuValue);
  const relDiff = absDiff / Math.max(Math.abs(cpuValue), 1e-6);
  let pass = true;
  if (check.maxAbsDiff != null) pass = pass && absDiff <= check.maxAbsDiff;
  if (check.maxRelDiff != null) pass = pass && relDiff <= check.maxRelDiff;
  if (check.minValue != null) pass = pass && cpuValue >= check.minValue && gpuValue >= check.minValue;
  return { metric: check.metric, field: check.field, cpuValue, gpuValue, absDiff, relDiff, pass };
}

export { runTwin, channelError, agentPositionError, variance, orderParameter };
export default { runTwin, channelError, agentPositionError, variance, orderParameter };
