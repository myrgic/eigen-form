/* =====================================================================
   apps/aquarium/engine/cpu.js — the reference instrument.

   docs/executable-experiments-design.md, "The shader correspondence":
   "Primitives should therefore be authored as kernel specs ... with the
   CPU reference as the semantics and any accelerated backend as a
   checked projection of it." This module IS that semantics. Every
   number webgl2.js ever produces is judged against what this file
   produces, never the other way around.

   Contract this module holds itself to:
     - Float32Array everywhere; no allocation inside step().
     - Math.random() is never called — every draw goes through
       engine/rng.js addressed by (seed, agentIndex, step, stream).
     - Math.sin/cos/atan2/hypot/sqrt/log ARE used (tier 1 determinism:
       bit-identical on one JS engine across runs, per
       docs/executable-experiments-design.md's "Determinism, honestly").
     - Step order is fixed and always: substrate pass (diffuse, decay,
       advect, then reactions) -> projection -> agent pass -> deposit
       pass. See apps/aquarium/engine/kernel.js's header for the full
       grammar this executes.

   Simplification from the prior art, named once here (see also
   docs/agent-substrate-engine.md): every channel shares one WxH grid.
   apps/welded_fields/index.html ran its momentum and hormone fields on
   a coarser grid (MS=8) purely to cut render/diffusion cost; that is a
   backend optimization, not a semantic requirement of the weld operator,
   and folding it in now would only complicate the twin comparison
   against webgl2.js for no scientific gain at this stage.
   ===================================================================== */

import { rand01 } from './rng.js';
import { STENCIL_1D } from './kernel.js';

const [ST_A, ST_B, ST_C] = STENCIL_1D; // kernel.js's declared 1D box-3 weights

/* ---- boundary-aware single-cell read/write --------------------------
   The one place every stencil, every bilinear sample, and every deposit
   scatter agrees on what "off the edge" means for a given channel's
   declared boundary mode:
     wrap   - toroidal: index modulo the grid.
     wall   - reflecting: clamp to the edge cell (zero-flux Neumann).
     absorb - the value leaving the domain is gone: reads as 0, and a
              deposit landing outside the grid is dropped, not clamped
              onto the edge. This is the one boundary mode where "wall"
              and "absorb" actually differ operationally.
   ---------------------------------------------------------------------- */
function readCell(grid, x, y, W, H, boundary) {
  if (boundary === 'wrap') {
    x = ((x % W) + W) % W;
    y = ((y % H) + H) % H;
    return grid[y * W + x];
  }
  if (x < 0 || x >= W || y < 0 || y >= H) {
    if (boundary === 'absorb') return 0;
    x = x < 0 ? 0 : (x >= W ? W - 1 : x);
    y = y < 0 ? 0 : (y >= H ? H - 1 : y);
    return grid[y * W + x];
  }
  return grid[y * W + x];
}

function addCell(grid, x, y, W, H, boundary, amount) {
  if (boundary === 'wrap') {
    x = ((x % W) + W) % W;
    y = ((y % H) + H) % H;
    grid[y * W + x] += amount;
    return;
  }
  if (x < 0 || x >= W || y < 0 || y >= H) {
    if (boundary === 'absorb') return; // lost, by design
    x = x < 0 ? 0 : (x >= W ? W - 1 : x);
    y = y < 0 ? 0 : (y >= H ? H - 1 : y);
    grid[y * W + x] += amount;
    return;
  }
  grid[y * W + x] += amount;
}

/** Bilinear sample at fractional (fx, fy), boundary-aware. Exported: this
 *  is the same primitive a weld's 'level'/'vector' read, a gradient
 *  sensor, and semi-Lagrangian advection all use, and webgl2.js's
 *  texture() calls are checked against exactly this. */
function bilinearSample(grid, fx, fy, W, H, boundary) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  const v00 = readCell(grid, x0, y0, W, H, boundary);
  const v10 = readCell(grid, x1, y0, W, H, boundary);
  const v01 = readCell(grid, x0, y1, W, H, boundary);
  const v11 = readCell(grid, x1, y1, W, H, boundary);
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
}

/** Bilinear scatter of `amount` into `grid` at fractional (fx, fy) — the
 *  inverse of bilinearSample's weights, and the concrete meaning of
 *  "agent deposit is scatter" (docs/executable-experiments-design.md,
 *  "The shader correspondence"). */
function bilinearDeposit(grid, fx, fy, W, H, boundary, amount) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  addCell(grid, x0, y0, W, H, boundary, amount * (1 - tx) * (1 - ty));
  addCell(grid, x1, y0, W, H, boundary, amount * tx * (1 - ty));
  addCell(grid, x0, y1, W, H, boundary, amount * (1 - tx) * ty);
  addCell(grid, x1, y1, W, H, boundary, amount * tx * ty);
}

function angDiff(target, current) {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function decayFactor(ch) {
  return ch.halfLife === Infinity ? 1 : Math.pow(0.5, 1 / ch.halfLife);
}

/* ---- state allocation: every buffer step() ever touches, once ------- */

function channelMap(spec) {
  const m = new Map();
  for (const ch of spec.channels) m.set(ch.name, ch);
  return m;
}

/** Allocate one population's agent arrays. Shared by the singular
 *  `population` field and every entry of the plural `populations` array
 *  — same shape either way, see kernel.js's "Capabilities added for the
 *  aquarium". */
function allocateAgents(popSpec) {
  const N = popSpec.count;
  const scalarsBase = {};
  const scalars = {};
  for (const name of Object.keys(popSpec.scalars)) {
    scalarsBase[name] = new Float32Array(N);
    scalars[name] = new Float32Array(N);
  }
  return {
    count: N,
    x: new Float32Array(N),
    y: new Float32Array(N),
    heading: new Float32Array(N),
    speed: new Float32Array(N),
    scalarsBase,
    scalars
  };
}

/** Every (name, spec) population pair this spec declares, in the fixed
 *  execution order both backends use: the singular `population` first
 *  (name 'default', for backward compatibility with state.agents — see
 *  below), then each named entry of `populations` in declared order.
 *  `salt` seeds this population's own RNG address space (see
 *  resetAgents/stepAgents) so two populations sharing a spec.seed don't
 *  draw identical "random" streams just because their agent indices
 *  overlap. */
function populationList(spec) {
  const list = [];
  if (spec.population) list.push({ name: 'default', spec: spec.population, salt: 0 });
  (spec.populations || []).forEach((p, i) => list.push({ name: p.name, spec: p, salt: i + 1 }));
  return list;
}

function createState(spec) {
  const { width: W, height: H, channels } = spec;
  const n = W * H;
  const fields = {};
  for (const ch of channels) {
    fields[ch.name] = ch.kind === 'scalar'
      ? new Float32Array(n)
      : { x: new Float32Array(n), y: new Float32Array(n) };
  }

  const state = {
    step: 0,
    fields,
    channelsByName: channelMap(spec),
    // scratch, reused every step/channel — nothing below is ever
    // allocated again once createState() returns
    scratchH: new Float32Array(n),
    scratchV: new Float32Array(n),
    scratchAdvect: new Float32Array(n),
    scratchReact: new Float32Array(n),
    proj: { div: new Float32Array(n), p: new Float32Array(n) },
    agents: null,
    // Named populations (kernel.js's plural `populations`), keyed by
    // name — populated below alongside the legacy singular `agents`.
    populationsByName: {}
  };

  for (const { name, spec: popSpec } of populationList(spec)) {
    const agents = allocateAgents(popSpec);
    if (name === 'default') state.agents = agents;
    state.populationsByName[name] = agents;
  }

  return state;
}

/* ---- agent init: pure function of spec.seed, no Math.random ---------- */
const STREAM_INIT_X = 101, STREAM_INIT_Y = 102, STREAM_INIT_HEADING = 103;
// Per-population salt, folded into every init/tie-break stream id so
// two populations sharing one spec.seed don't draw identical "random"
// sequences just because their agent indices both start at 0 — see
// populationList() above. 97 is arbitrary but large enough that a
// realistic weld count (<< 97) never collides with the next salt's
// tie-break stream range (STREAM_TIEBREAK_BASE + salt*97 + weldIndex).
const SALT_STRIDE = 97;

function resetAgents(spec, state) {
  const { width: W, height: H, seed } = spec;
  for (const { name, spec: popSpec, salt } of populationList(spec)) {
    const A = state.populationsByName[name];
    if (!A) continue;
    const s = salt * SALT_STRIDE;
    for (let i = 0; i < A.count; i++) {
      A.x[i] = rand01(seed, i, 0, STREAM_INIT_X + s) * W;
      A.y[i] = rand01(seed, i, 0, STREAM_INIT_Y + s) * H;
      A.heading[i] = rand01(seed, i, 0, STREAM_INIT_HEADING + s) * Math.PI * 2;
      A.speed[i] = popSpec.speed;
    }
    for (const [scalarName, def] of Object.entries(popSpec.scalars)) {
      A.scalarsBase[scalarName].fill(def);
      A.scalars[scalarName].fill(def);
    }
  }
}

/* ---- substrate pass: diffuse, decay, advect, in that order, per channel ---- */

function diffuseInPlace(grid, scratchH, scratchV, W, H, boundary, rate) {
  if (rate <= 0) return;
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const l = readCell(grid, x - 1, y, W, H, boundary);
      const c = grid[r + x];
      const rt = readCell(grid, x + 1, y, W, H, boundary);
      scratchH[r + x] = l * ST_A + c * ST_B + rt * ST_C;
    }
  }
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const u = readCell(scratchH, x, y - 1, W, H, boundary);
      const c = scratchH[r + x];
      const d = readCell(scratchH, x, y + 1, W, H, boundary);
      scratchV[r + x] = u * ST_A + c * ST_B + d * ST_C;
    }
  }
  for (let i = 0; i < grid.length; i++) {
    grid[i] = grid[i] * (1 - rate) + scratchV[i] * rate;
  }
}

function decayInPlace(grid, factor) {
  if (factor === 1) return;
  for (let i = 0; i < grid.length; i++) grid[i] *= factor;
}

function advectInPlace(grid, scratch, W, H, boundary, vx, vy) {
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const idx = r + x;
      const sx = x - vx[idx];
      const sy = y - vy[idx];
      scratch[idx] = bilinearSample(grid, sx, sy, W, H, boundary);
    }
  }
  grid.set(scratch);
}

function substratePass(spec, state) {
  const { width: W, height: H, channels } = spec;
  for (const ch of channels) {
    const field = state.fields[ch.name];
    if (ch.kind === 'scalar') {
      diffuseInPlace(field, state.scratchH, state.scratchV, W, H, ch.boundary, ch.diffuse);
      decayInPlace(field, decayFactor(ch));
      if (ch.advectedBy) {
        const mom = state.fields[ch.advectedBy];
        advectInPlace(field, state.scratchAdvect, W, H, ch.boundary, mom.x, mom.y);
      }
    } else {
      diffuseInPlace(field.x, state.scratchH, state.scratchV, W, H, ch.boundary, ch.diffuse);
      diffuseInPlace(field.y, state.scratchH, state.scratchV, W, H, ch.boundary, ch.diffuse);
      const factor = decayFactor(ch);
      decayInPlace(field.x, factor);
      decayInPlace(field.y, factor);
      if (ch.advectedBy) {
        const mom = state.fields[ch.advectedBy];
        advectInPlace(field.x, state.scratchAdvect, W, H, ch.boundary, mom.x, mom.y);
        advectInPlace(field.y, state.scratchAdvect, W, H, ch.boundary, mom.x, mom.y);
      }
    }
  }
  applyReactions(spec, state);
}

/* ---- reactions: the small fixed chemistry vocabulary ------------------ */

function applyReactions(spec, state) {
  const { width: W } = spec;
  for (const r of spec.reactions) {
    if (r.type === 'source') {
      if (r.vector) {
        // Aquarium addition: a source on a vector channel (filter jet /
        // intake) — add a fixed direction*rate at each declared cell.
        const vec = state.fields[r.channel];
        const [rx, ry] = r.vector;
        for (const [cx, cy] of r.cells) {
          const idx = cy * W + cx;
          vec.x[idx] += rx * r.rate;
          vec.y[idx] += ry * r.rate;
        }
      } else {
        const grid = state.fields[r.channel];
        for (const [cx, cy] of r.cells) grid[cy * W + cx] += r.rate;
      }
    } else if (r.type === 'sink') {
      const grid = state.fields[r.channel];
      for (let i = 0; i < grid.length; i++) {
        grid[i] -= grid[i] * r.rate;
        if (grid[i] < 0) grid[i] = 0;
      }
    } else if (r.type === 'decay') {
      const grid = state.fields[r.channel];
      const keep = 1 - r.rate;
      for (let i = 0; i < grid.length; i++) grid[i] *= keep;
    } else if (r.type === 'monod') {
      const A = state.fields[r.from], B = state.fields[r.to];
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        const delta = r.rate * a / (a + r.halfSaturation + 1e-12);
        A[i] = Math.max(0, a - delta);
        B[i] += delta;
      }
    } else if (r.type === 'product') {
      const A = state.fields[r.a], B = state.fields[r.b], into = state.fields[r.into];
      for (let i = 0; i < into.length; i++) into[i] += r.rate * A[i] * B[i];
    } else if (r.type === 'buoyancy') {
      // Boussinesq: velocity.y -= beta * (T - reference). Purely local,
      // no neighbour reads — see kernel.js's grammar addendum.
      const vec = state.fields[r.velocity], T = state.fields[r.temperature];
      for (let i = 0; i < T.length; i++) vec.y[i] -= r.beta * (T[i] - r.reference);
    } else if (r.type === 'relax') {
      // channel += rate * mask * (target - channel). Newton cooling is
      // this with mask = 1 at the surface row, 0 elsewhere.
      const grid = state.fields[r.channel], mask = state.fields[r.mask];
      for (let i = 0; i < grid.length; i++) grid[i] += r.rate * mask[i] * (r.target - grid[i]);
    } else if (r.type === 'exchange') {
      // Like `relax`, but the rate is additionally scaled by a vector
      // channel's local magnitude ("agitation") — surface gas exchange
      // is faster where the flow is more turbulent.
      const grid = state.fields[r.channel], driver = state.fields[r.driver], mask = state.fields[r.mask];
      for (let i = 0; i < grid.length; i++) {
        const agitation = Math.hypot(driver.x[i], driver.y[i]);
        grid[i] += r.rate * mask[i] * agitation * (r.target - grid[i]);
      }
    } else if (r.type === 'nitrify') {
      // Monod uptake of `substrate` into `product` by a spatial
      // `bacteria` population that grows logistically on that same
      // substrate, both gated by a static `mask` (filter media
      // occupancy). See kernel.js's grammar addendum for the derivation.
      const S = state.fields[r.substrate], P = state.fields[r.product];
      const B = state.fields[r.bacteria], mask = state.fields[r.mask];
      for (let i = 0; i < S.length; i++) {
        const m = mask[i];
        if (m <= 0) continue;
        const s = S[i], b = B[i];
        const mu = r.growthRate * s / (s + r.halfSaturation + 1e-12);
        const uptake = mu * b * m;
        S[i] = Math.max(0, s - uptake);
        P[i] += uptake * r.yieldFactor;
        const growth = (mu * (1 - b / r.carryingCapacity) - r.deathRate) * b * m;
        B[i] = Math.max(0, b + growth);
      }
    }
  }
}

/* ---- projection: Gauss-Seidel divergence-free pressure solve ----------

   Two bugs, found empirically (mean |divergence| plateaued at ~0.06,
   provably not still-converging, then at a smaller but still-above-
   tolerance fixed point) and fixed in order:

   1. Double-buffered (ping-ponged) Jacobi has eigenvalue exactly -1 at
      the grid's Nyquist ("checkerboard") frequency, which never damps no
      matter how many iterations run. Fix: in-place Gauss-Seidel (below),
      which reads already-updated neighbours within the same sweep (west
      and north are this sweep's new values, east and south are last
      sweep's) — Stam's reference `lin_solve`, spectral radius < 1 at
      every frequency including Nyquist.

   2. Centered differences for BOTH the divergence forcing term and the
      velocity correction are not adjoint operators: composing them
      (div of a centered gradient) produces a Laplacian over every-OTHER
      grid point (p[x+2], p[x-2], ...), not the compact 5-point stencil
      the pressure solve actually assumes. That mismatch is the classic
      collocated-grid "checkerboard" problem (why real CFD codes stagger
      velocity and pressure onto different grid points): the two
      interleaved (odd/even) sub-grids decouple, and no amount of solver
      iteration removes the residual it leaves. Fix: divergence uses a
      BACKWARD difference and the correction uses the matching FORWARD
      difference, so div(grad(p)) collapses exactly to the compact
      5-point Laplacian p[x+1]+p[x-1]+p[y+1]+p[y-1]-4p[x,y] — verified
      below by driving mean |divergence| to machine precision on a
      previously-stuck field. This makes divergenceField's convention
      forward/backward rather than the more common centered form; every
      caller (this file, tests, twin.js) goes through this one function,
      so the convention only has to be right once. */

function divergenceField(vec, out, W, H, boundary) {
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const l = readCell(vec.x, x - 1, y, W, H, boundary);
      const u = readCell(vec.y, x, y - 1, W, H, boundary);
      out[r + x] = (vec.x[r + x] - l) + (vec.y[r + x] - u);
    }
  }
  return out;
}

function project(vec, proj, W, H, boundary, iterations) {
  divergenceField(vec, proj.div, W, H, boundary);
  proj.p.fill(0);
  const p = proj.p;
  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        const l = readCell(p, x - 1, y, W, H, boundary);
        const rt = readCell(p, x + 1, y, W, H, boundary);
        const u = readCell(p, x, y - 1, W, H, boundary);
        const d = readCell(p, x, y + 1, W, H, boundary);
        p[r + x] = (l + rt + u + d - proj.div[r + x]) / 4;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const rt = readCell(proj.p, x + 1, y, W, H, boundary);
      const d = readCell(proj.p, x, y + 1, W, H, boundary);
      vec.x[r + x] -= (rt - proj.p[r + x]);
      vec.y[r + x] -= (d - proj.p[r + x]);
    }
  }
}

function projectionPass(spec, state) {
  for (const ch of spec.channels) {
    if (ch.kind === 'vector' && ch.projection && ch.projection.enabled) {
      project(state.fields[ch.name], state.proj, spec.width, spec.height, ch.boundary, ch.projection.iterations);
    }
  }
}

/** Mean absolute divergence of a vector channel — the acceptance metric
 *  tests/aquarium-engine.js checks projection against ("< 1e-3"). Exposed
 *  so a test (or a future page) never has to reimplement the divergence
 *  stencil to ask "did the projection work?". */
function meanAbsDivergence(spec, state, channelName) {
  const ch = state.channelsByName.get(channelName);
  const vec = state.fields[channelName];
  const out = new Float32Array(spec.width * spec.height); // measurement call, not per-step path
  divergenceField(vec, out, spec.width, spec.height, ch.boundary);
  let acc = 0;
  for (let i = 0; i < out.length; i++) acc += Math.abs(out[i]);
  return acc / out.length;
}

/* ---- agent pass: welds, then integrate; deposit pass follows separately ---- */

const STREAM_TIEBREAK_BASE = 5000; // + weld index
// Deadband on the gradient-weld's F/L/R sensor comparisons — see the
// comment at its use site in stepAgents for why this exists and what it
// costs. Must match webgl2.js's GLSL constant of the same name exactly:
// this is the one number both backends agree the reference kernel means
// by "close enough to call a tie".
const TIE_EPS = 1e-3;

function stepOnePopulation(spec, state, stepIndex, population, A, salt) {
  const { width: W, height: H, seed } = spec;
  const boundary = population.boundary;
  const welds = population.welds;
  const tieBase = STREAM_TIEBREAK_BASE + salt * SALT_STRIDE;

  for (let i = 0; i < A.count; i++) {
    let heading = A.heading[i];
    const x = A.x[i], y = A.y[i];
    const speed = A.speed[i];
    let dx = 0, dy = 0;

    for (let w = 0; w < welds.length; w++) {
      const weld = welds[w];
      const ch = state.channelsByName.get(weld.channel);

      if (weld.read.mode === 'gradient') {
        const grid = state.fields[weld.channel];
        const so = weld.read.sensorDist, sa = weld.read.sensorAngle;
        const F = bilinearSample(grid, x + Math.cos(heading) * so, y + Math.sin(heading) * so, W, H, ch.boundary);
        const L = bilinearSample(grid, x + Math.cos(heading - sa) * so, y + Math.sin(heading - sa) * so, W, H, ch.boundary);
        const R = bilinearSample(grid, x + Math.cos(heading + sa) * so, y + Math.sin(heading + sa) * so, W, H, ch.boundary);
        const gain = weld.effect.gain;
        // TIE_EPS: a deadband around every comparison, not just the exact
        // F===L===R tie the physarum reference motor logic already
        // hysteresis-handles. Verified empirically (.scratch/debug4.html,
        // not committed): without it, a sensor pair within a few ULPs of
        // each other can compare > on the CPU and <= on the GPU (native
        // cos/sin differ in their last bit between backends per docs/
        // executable-experiments-design.md's tier-1 "Determinism,
        // honestly"), flipping which way that one agent turns that step.
        // That is a discrete branch flip, not a small numeric one, and it
        // compounds: a flipped agent's whole future trajectory and
        // deposits diverge, other agents sense its now-different trail
        // and can flip too, and by 200 steps by field mean |divergence|
        // was over 50% relL2 (2171/3000 agents' headings had diverged).
        // TIE_EPS trades a small amount of motor sensitivity (a sensor
        // pair within TIE_EPS of each other now reads as a tie, same as
        // the reference already treats an exact tie) for removing that
        // ULP-driven coin flip at its source — see
        // docs/agent-substrate-engine.md, "The twin protocol".
        if (F > L + TIE_EPS && F > R + TIE_EPS) {
          // straight
        } else if (F < L - TIE_EPS && F < R - TIE_EPS) {
          const flip = rand01(seed, i, stepIndex, tieBase + w) < 0.5;
          heading += flip ? gain : -gain;
        } else if (L > R + TIE_EPS) {
          heading -= gain;
        } else if (R > L + TIE_EPS) {
          heading += gain;
        } else {
          const flip = rand01(seed, i, stepIndex, tieBase + w) < 0.5;
          heading += flip ? gain : -gain;
        }
      } else if (weld.read.mode === 'vector') {
        const vec = state.fields[weld.channel];
        const vx = bilinearSample(vec.x, x, y, W, H, ch.boundary);
        const vy = bilinearSample(vec.y, x, y, W, H, ch.boundary);
        const mag = Math.hypot(vx, vy);
        if (mag > 1e-9) {
          heading += angDiff(Math.atan2(vy, vx), heading) * weld.effect.align;
        }
        dx += vx * weld.effect.advect;
        dy += vy * weld.effect.advect;
      } else if (weld.read.mode === 'level') {
        const grid = state.fields[weld.channel];
        const level = bilinearSample(grid, x, y, W, H, ch.boundary);
        const scalar = weld.effect.scalar;
        const base = A.scalarsBase[scalar][i];
        A.scalars[scalar][i] = base * (1 + weld.effect.gain * (level - 1));
      } else { // 'none' + effect 'wobble' — pure RNG, no field read at all
        const draw = rand01(seed, i, stepIndex, tieBase + w) * 2 - 1; // signed [-1, 1)
        heading += draw * weld.effect.amount;
      }
    }

    let vx = Math.cos(heading) * speed + dx;
    let vy = Math.sin(heading) * speed + dy;
    let nx = x + vx;
    let ny = y + vy;

    if (boundary === 'wrap') {
      nx = ((nx % W) + W) % W;
      ny = ((ny % H) + H) % H;
    } else if (boundary === 'wall') {
      if (nx < 0) { nx = -nx; vx = -vx; } else if (nx >= W) { nx = 2 * W - nx; vx = -vx; }
      if (ny < 0) { ny = -ny; vy = -vy; } else if (ny >= H) { ny = 2 * H - ny; vy = -vy; }
      heading = Math.atan2(vy, vx);
    } else { // absorb: clamp in place, no bounce
      if (nx < 0) nx = 0; else if (nx >= W) nx = W - 1e-6;
      if (ny < 0) ny = 0; else if (ny >= H) ny = H - 1e-6;
    }

    A.x[i] = nx;
    A.y[i] = ny;
    A.heading[i] = heading;
  }
}

/** Run every declared population's agent pass, in populationList()'s
 *  fixed order (singular `population` first, then `populations` in
 *  declared order) — see kernel.js's "Capabilities added for the
 *  aquarium". A later population's welds read channels as of AFTER an
 *  earlier population's deposit pass has already run for this step
 *  (depositOnePopulation is interleaved the same way, below), a
 *  declared, backend-identical ordering choice, not an incidental one. */
function stepAgents(spec, state, stepIndex) {
  for (const { name, spec: popSpec, salt } of populationList(spec)) {
    const A = state.populationsByName[name];
    if (!A) continue;
    stepOnePopulation(spec, state, stepIndex, popSpec, A, salt);
    depositOnePopulation(spec, state, popSpec, A);
  }
}

function depositOnePopulation(spec, state, population, A) {
  const { width: W, height: H } = spec;
  const welds = population.welds;

  for (let i = 0; i < A.count; i++) {
    const x = A.x[i], y = A.y[i], heading = A.heading[i], speed = A.speed[i];
    for (let w = 0; w < welds.length; w++) {
      const weld = welds[w];
      if (!weld.deposit) continue;
      const ch = state.channelsByName.get(weld.deposit.channel);
      const amount = weld.deposit.amount;
      if (ch.kind === 'scalar') {
        bilinearDeposit(state.fields[weld.deposit.channel], x, y, W, H, ch.boundary, amount);
      } else {
        const vec = state.fields[weld.deposit.channel];
        const vx = Math.cos(heading) * speed, vy = Math.sin(heading) * speed;
        bilinearDeposit(vec.x, x, y, W, H, ch.boundary, amount * vx);
        bilinearDeposit(vec.y, x, y, W, H, ch.boundary, amount * vy);
      }
    }
  }
}

/** One full, fixed-order step: substrate -> projection -> (agents ->
 *  deposit) per population, in populationList() order. For a spec with
 *  at most one population (every physarum/boids spec, and every spec
 *  from before this file's aquarium additions) this is byte-identical
 *  to the original two-top-level-calls form: stepAgents() below folds
 *  the deposit pass into the per-population loop instead of running it
 *  as a second top-level pass, but with one population there is nothing
 *  in between the two calls either way. Mutates `state` in place;
 *  allocates nothing. */
function step(spec, state) {
  substratePass(spec, state);
  projectionPass(spec, state);
  stepAgents(spec, state, state.step);
  state.step += 1;
}

/** Run `n` steps from a freshly created+reset state and return it — the
 *  convenience twin.js and the tests both call instead of hand-rolling
 *  the create/reset/loop boilerplate every time. */
function run(spec, n) {
  const state = createState(spec);
  resetAgents(spec, state);
  for (let i = 0; i < n; i++) step(spec, state);
  return state;
}

export {
  createState,
  resetAgents,
  step,
  run,
  bilinearSample,
  bilinearDeposit,
  readCell,
  addCell,
  divergenceField,
  meanAbsDivergence,
  decayFactor,
  angDiff,
  populationList,
  SALT_STRIDE,
  STREAM_TIEBREAK_BASE
};
export default { createState, resetAgents, step, run, bilinearSample, meanAbsDivergence, populationList };
