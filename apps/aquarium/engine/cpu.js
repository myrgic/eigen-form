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

function createState(spec) {
  const { width: W, height: H, channels, population } = spec;
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
    proj: { div: new Float32Array(n), p: new Float32Array(n) },
    agents: null
  };

  if (population) {
    const N = population.count;
    const scalarsBase = {};
    const scalars = {};
    for (const name of Object.keys(population.scalars)) {
      scalarsBase[name] = new Float32Array(N);
      scalars[name] = new Float32Array(N);
    }
    state.agents = {
      count: N,
      x: new Float32Array(N),
      y: new Float32Array(N),
      heading: new Float32Array(N),
      speed: new Float32Array(N),
      scalarsBase,
      scalars
    };
  }

  return state;
}

/* ---- agent init: pure function of spec.seed, no Math.random ---------- */
const STREAM_INIT_X = 101, STREAM_INIT_Y = 102, STREAM_INIT_HEADING = 103;

function resetAgents(spec, state) {
  const { population, width: W, height: H, seed } = spec;
  if (!population || !state.agents) return;
  const A = state.agents;
  for (let i = 0; i < A.count; i++) {
    A.x[i] = rand01(seed, i, 0, STREAM_INIT_X) * W;
    A.y[i] = rand01(seed, i, 0, STREAM_INIT_Y) * H;
    A.heading[i] = rand01(seed, i, 0, STREAM_INIT_HEADING) * Math.PI * 2;
    A.speed[i] = population.speed;
  }
  for (const [name, def] of Object.entries(population.scalars)) {
    A.scalarsBase[name].fill(def);
    A.scalars[name].fill(def);
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
      scratchH[r + x] = (l + c + rt) / 3;
    }
  }
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const u = readCell(scratchH, x, y - 1, W, H, boundary);
      const c = scratchH[r + x];
      const d = readCell(scratchH, x, y + 1, W, H, boundary);
      scratchV[r + x] = (u + c + d) / 3;
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
      const grid = state.fields[r.channel];
      for (const [cx, cy] of r.cells) grid[cy * W + cx] += r.rate;
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

function stepAgents(spec, state, stepIndex) {
  const { population, width: W, height: H, seed } = spec;
  if (!population) return;
  const A = state.agents;
  const boundary = population.boundary;
  const welds = population.welds;

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
        if (F > L && F > R) {
          // straight
        } else if (F < L && F < R) {
          const flip = rand01(seed, i, stepIndex, STREAM_TIEBREAK_BASE + w) < 0.5;
          heading += flip ? gain : -gain;
        } else if (L > R) {
          heading -= gain;
        } else if (R > L) {
          heading += gain;
        } else {
          const flip = rand01(seed, i, stepIndex, STREAM_TIEBREAK_BASE + w) < 0.5;
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
      } else { // 'level'
        const grid = state.fields[weld.channel];
        const level = bilinearSample(grid, x, y, W, H, ch.boundary);
        const scalar = weld.effect.scalar;
        const base = A.scalarsBase[scalar][i];
        A.scalars[scalar][i] = base * (1 + weld.effect.gain * (level - 1));
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

function depositAgents(spec, state) {
  const { population, width: W, height: H } = spec;
  if (!population) return;
  const A = state.agents;
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

/** One full, fixed-order step: substrate -> projection -> agents -> deposit.
 *  Mutates `state` in place; allocates nothing. */
function step(spec, state) {
  substratePass(spec, state);
  projectionPass(spec, state);
  stepAgents(spec, state, state.step);
  depositAgents(spec, state);
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
  angDiff
};
export default { createState, resetAgents, step, run, bilinearSample, meanAbsDivergence };
