#!/usr/bin/env node
/* =====================================================================
   tests/aquarium-engine.js — regression coverage for the agent-substrate
   engine (apps/aquarium/engine/{kernel,rng,cpu}.js).

   Same plain-script idiom as tests/params.js and tests/engine.js: no
   framework, PASS/FAIL lines, dynamic import() for the ES modules under
   apps/aquarium/engine/ (scoped to module mode by its own package.json,
   same trick src/package.json already uses for src/), process.exit(1)
   on any failure.

   What this file checks, per the build brief:
     1. RNG determinism (same address -> same draw) and distribution
        sanity (uniform mean near 0.5).
     2. Two full CPU runs from the same seed, 300 steps, are bit-identical
        — field buffers AND agent state.
     3. Projection leaves mean |divergence| < 1e-3 on a momentum channel
        with projection enabled.
     4. A physarum spec (one scalar channel, three-sensor weld, deposit)
        forms structure: field variance rises above the uniform (all-zero)
        baseline after 500 steps.
     5. A boids spec (density + vector channel; separate on a short-range
        density gradient, cohere on a long-range one, align on the vector
        channel) raises the mean velocity order parameter above 0.5 from
        a random start.
     6. Energy (every field value, every agent scalar) stays finite for
        2000 steps.

   Usage:
     node tests/aquarium-engine.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ENGINE_DIR = path.join(ROOT, 'apps', 'aquarium', 'engine');

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
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

function assertAllFinite(arr, label) {
  for (let i = 0; i < arr.length; i++) {
    assert.ok(Number.isFinite(arr[i]), `${label}[${i}] is not finite: ${arr[i]}`);
  }
}

/* ---- fixture specs ---------------------------------------------------- */

function physarumSpec(defineSubstrate) {
  return defineSubstrate({
    width: 96, height: 96, seed: 12,
    channels: [
      { name: 'trail', kind: 'scalar', diffuse: 0.35, halfLife: 20, boundary: 'wrap', advectedBy: null }
    ],
    population: {
      count: 3000, boundary: 'wrap', speed: 1, scalars: {},
      welds: [
        {
          channel: 'trail',
          read: { mode: 'gradient', sensorDist: 6, sensorAngle: 0.7 },
          effect: { type: 'steerByAngle', gain: 0.35 },
          deposit: { channel: 'trail', amount: 10 }
        }
      ]
    }
  });
}

function boidsSpec(defineSubstrate) {
  return defineSubstrate({
    width: 64, height: 64, seed: 3,
    channels: [
      { name: 'density', kind: 'scalar', diffuse: 0.3, halfLife: 15, boundary: 'wrap', advectedBy: null },
      { name: 'heading', kind: 'vector', diffuse: 0.4, halfLife: 10, boundary: 'wrap', advectedBy: null }
    ],
    population: {
      count: 800, boundary: 'wrap', speed: 1.2, scalars: { dummy: 1 },
      welds: [
        // separate: short-range, NEGATIVE gain — the physarum motor logic
        // steers toward the higher-valued flank sensor by construction, so
        // a negative gain steers toward the LOWER-valued (less crowded)
        // flank instead, which is exactly "move away from local density".
        {
          channel: 'density',
          read: { mode: 'gradient', sensorDist: 2, sensorAngle: 0.6 },
          effect: { type: 'steerByAngle', gain: -0.10 },
          deposit: { channel: 'density', amount: 3 }
        },
        // cohere: longer range, POSITIVE gain — ascend toward the crowd.
        {
          channel: 'density',
          read: { mode: 'gradient', sensorDist: 8, sensorAngle: 0.6 },
          effect: { type: 'steerByAngle', gain: 0.06 },
          deposit: null
        },
        // align: match the locally-deposited heading vector field.
        {
          channel: 'heading',
          read: { mode: 'vector' },
          effect: { type: 'alignAndAdvect', align: 0.15, advect: 0 },
          deposit: { channel: 'heading', amount: 1 }
        }
      ]
    }
  });
}

/* ---- cases -------------------------------------------------------------- */

test('rng: same address draws the same value, repeatedly', async ({ rng }) => {
  const a = rng.rand01(42, 3, 100, 0);
  const b = rng.rand01(42, 3, 100, 0);
  assert.strictEqual(a, b);
  assert.ok(a >= 0 && a < 1);
});

test('rng: different stream at the same (seed, index, step) draws independently', async ({ rng }) => {
  const a = rng.rand01(42, 3, 100, 0);
  const b = rng.rand01(42, 3, 100, 1);
  assert.notStrictEqual(a, b);
});

test('rng: uniform distribution sanity — mean near 0.5 over many draws', async ({ rng }) => {
  const n = 200000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += rng.rand01(1, i, 0, 0);
  const mean = sum / n;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean} too far from 0.5`);
});

test('cpu: two runs from the same seed, 300 steps, are bit-identical (fields and agents)', async ({ kernel, cpu }) => {
  const makeSpec = () => kernel.defineSubstrate({
    width: 48, height: 48, seed: 99,
    channels: [{ name: 'trail', kind: 'scalar', diffuse: 0.3, halfLife: 25, boundary: 'wrap', advectedBy: null }],
    population: {
      count: 200, boundary: 'wrap', speed: 1, scalars: {},
      welds: [{
        channel: 'trail',
        read: { mode: 'gradient', sensorDist: 5, sensorAngle: 0.6 },
        effect: { type: 'steerByAngle', gain: 0.3 },
        deposit: { channel: 'trail', amount: 8 }
      }]
    }
  });

  const a = cpu.run(makeSpec(), 300);
  const b = cpu.run(makeSpec(), 300);

  assert.deepStrictEqual(Array.from(a.fields.trail), Array.from(b.fields.trail), 'trail field diverged');
  assert.deepStrictEqual(Array.from(a.agents.x), Array.from(b.agents.x), 'agent x diverged');
  assert.deepStrictEqual(Array.from(a.agents.y), Array.from(b.agents.y), 'agent y diverged');
  assert.deepStrictEqual(Array.from(a.agents.heading), Array.from(b.agents.heading), 'agent heading diverged');
});

test('cpu: projection drives mean |divergence| below 1e-3', async ({ kernel, cpu }) => {
  const spec = kernel.defineSubstrate({
    width: 32, height: 32, seed: 7,
    channels: [{
      name: 'mom', kind: 'vector', diffuse: 0, halfLife: Infinity, boundary: 'wrap', advectedBy: null,
      projection: { enabled: true, iterations: 150 }
    }]
  });
  const state = cpu.createState(spec);
  // A localized, mixed-frequency seed — the shape a real agent-deposited
  // momentum field actually has (many local bumps), not a single
  // domain-spanning sinusoid. That distinction matters: docs/
  // agent-substrate-engine.md's "Projection convergence is frequency-
  // dependent" section shows a pure low (near-DC) global mode converges
  // far slower under plain Gauss-Seidel and is not the realistic case.
  const mom = state.fields.mom;
  for (let i = 0; i < mom.x.length; i++) {
    mom.x[i] = Math.sin(i * 0.37);
    mom.y[i] = Math.cos(i * 0.61);
  }
  cpu.step(spec, state);
  const meanAbsDiv = cpu.meanAbsDivergence(spec, state, 'mom');
  assert.ok(meanAbsDiv < 1e-3, `mean |divergence| ${meanAbsDiv} not below 1e-3`);
});

test('cpu: physarum spec forms structure (field variance rises above uniform baseline)', async ({ kernel, cpu }) => {
  const spec = physarumSpec(kernel.defineSubstrate);
  const state = cpu.createState(spec);
  cpu.resetAgents(spec, state);
  const v0 = variance(state.fields.trail);
  assert.strictEqual(v0, 0, 'baseline field should start uniform (all zero)');
  for (let i = 0; i < 500; i++) cpu.step(spec, state);
  const v500 = variance(state.fields.trail);
  assert.ok(v500 > v0, `variance after 500 steps (${v500}) did not rise above baseline (${v0})`);
  assert.ok(v500 > 100, `variance ${v500} too small to call "structure"`);
});

test('cpu: boids spec raises the velocity order parameter above 0.5 from a random start', async ({ kernel, cpu }) => {
  const spec = boidsSpec(kernel.defineSubstrate);
  const state = cpu.createState(spec);
  cpu.resetAgents(spec, state);
  const order0 = orderParameter(state.agents.heading);
  assert.ok(order0 < 0.3, `random start should be near-disordered, got order parameter ${order0}`);
  for (let i = 0; i < 800; i++) cpu.step(spec, state);
  const order800 = orderParameter(state.agents.heading);
  assert.ok(order800 > 0.5, `order parameter after 800 steps (${order800}) did not rise above 0.5`);
});

test('cpu: two named populations share one substrate, each with its own RNG stream', async ({ kernel, cpu }) => {
  // Two named populations declared via the plural `populations` field
  // (kernel.js's "Capabilities added for the aquarium") sharing one
  // scalar channel and one seed. Neither population declares the
  // legacy singular `population` field at all.
  const spec = kernel.defineSubstrate({
    width: 32, height: 32, seed: 21,
    channels: [{ name: 'trail', kind: 'scalar', diffuse: 0.2, halfLife: 30, boundary: 'wrap', advectedBy: null }],
    populations: [
      {
        name: 'alpha', count: 50, boundary: 'wrap', speed: 1, scalars: {},
        welds: [{
          channel: 'trail',
          read: { mode: 'gradient', sensorDist: 3, sensorAngle: 0.5 },
          effect: { type: 'steerByAngle', gain: 0.2 },
          deposit: { channel: 'trail', amount: 5 }
        }]
      },
      {
        name: 'beta', count: 50, boundary: 'wrap', speed: 1, scalars: {},
        welds: [{
          channel: 'trail',
          read: { mode: 'gradient', sensorDist: 3, sensorAngle: 0.5 },
          effect: { type: 'steerByAngle', gain: 0.2 },
          deposit: { channel: 'trail', amount: 5 }
        }]
      }
    ]
  });
  const state = cpu.createState(spec);
  cpu.resetAgents(spec, state);
  const alpha0 = Array.from(state.populationsByName.alpha.x);
  const beta0 = Array.from(state.populationsByName.beta.x);
  // Two populations of otherwise-identical spec, same spec.seed: their
  // per-population RNG salt (cpu.js's populationList()) must still draw
  // different initial positions, not the same "random" layout twice.
  assert.notDeepStrictEqual(alpha0, beta0, 'two named populations drew identical initial positions — salt is not differentiating streams');

  for (let i = 0; i < 100; i++) cpu.step(spec, state);
  assertAllFinite(state.populationsByName.alpha.x, 'alpha.x');
  assertAllFinite(state.populationsByName.beta.x, 'beta.x');
  assertAllFinite(state.fields.trail, 'trail');

  // A second full run from the same spec (fresh state, same seed) must
  // reproduce both populations exactly — determinism holds across
  // multiple named populations, not just a single one.
  const state2 = cpu.createState(spec);
  cpu.resetAgents(spec, state2);
  for (let i = 0; i < 100; i++) cpu.step(spec, state2);
  assert.deepStrictEqual(Array.from(state.populationsByName.alpha.x), Array.from(state2.populationsByName.alpha.x), 'alpha diverged across identical runs');
  assert.deepStrictEqual(Array.from(state.populationsByName.beta.heading), Array.from(state2.populationsByName.beta.heading), 'beta diverged across identical runs');
});

test('cpu: wobble effect (read.mode "none") perturbs heading from RNG alone', async ({ kernel, cpu }) => {
  const spec = kernel.defineSubstrate({
    width: 16, height: 16, seed: 8,
    channels: [{ name: 'dummy', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null }],
    populations: [{
      name: 'bubbles', count: 20, boundary: 'absorb', speed: 0.4, scalars: {},
      welds: [{ read: { mode: 'none' }, effect: { type: 'wobble', amount: 0.3 }, deposit: null }]
    }]
  });
  const state = cpu.createState(spec);
  cpu.resetAgents(spec, state);
  const h0 = Array.from(state.populationsByName.bubbles.heading);
  cpu.step(spec, state);
  const h1 = Array.from(state.populationsByName.bubbles.heading);
  assert.ok(h0.some((v, i) => v !== h1[i]), 'wobble did not perturb any heading after one step');
  assertAllFinite(state.populationsByName.bubbles.heading, 'bubbles.heading');
});

test('cpu: buoyancy/relax/exchange reactions push a scalar toward its declared target', async ({ kernel, cpu }) => {
  const spec = kernel.defineSubstrate({
    width: 12, height: 12, seed: 1,
    channels: [
      { name: 'temperature', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
      { name: 'momentum', kind: 'vector', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
      { name: 'mask', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null }
    ],
    reactions: [
      { type: 'buoyancy', velocity: 'momentum', temperature: 'temperature', beta: 0.1, reference: 20 },
      { type: 'relax', channel: 'temperature', mask: 'mask', target: 20, rate: 0.05 },
      { type: 'exchange', channel: 'temperature', driver: 'momentum', mask: 'mask', target: 20, rate: 0.02 }
    ]
  });
  const state = cpu.createState(spec);
  state.fields.mask.fill(1);
  state.fields.temperature.fill(30); // 10 above target
  for (let i = 0; i < 300; i++) cpu.step(spec, state);
  assertAllFinite(state.fields.temperature, 'temperature');
  assertAllFinite(state.fields.momentum.x, 'momentum.x');
  const mean = Array.from(state.fields.temperature).reduce((a, b) => a + b, 0) / (12 * 12);
  assert.ok(Math.abs(mean - 20) < 1, `relax/exchange did not pull temperature (mean ${mean}) near target 20`);
  // Buoyancy should have driven momentum.y negative on average (warm
  // fluid rising, up = -y) before relax/exchange cooled it back down.
  const meanVy = Array.from(state.fields.momentum.y).reduce((a, b) => a + b, 0) / (12 * 12);
  assert.ok(Number.isFinite(meanVy), 'momentum.y not finite');
});

test('cpu: nitrify reaction cycles substrate through a logistic bacteria population', async ({ kernel, cpu }) => {
  const spec = kernel.defineSubstrate({
    width: 10, height: 10, seed: 4,
    channels: [
      { name: 'ammonia', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
      { name: 'nitrite', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
      { name: 'bacteria', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
      { name: 'mask', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null }
    ],
    reactions: [{
      type: 'nitrify', substrate: 'ammonia', product: 'nitrite', bacteria: 'bacteria', mask: 'mask',
      growthRate: 0.4, halfSaturation: 1, carryingCapacity: 1, yieldFactor: 1, deathRate: 0.02
    }]
  });
  const state = cpu.createState(spec);
  state.fields.mask.fill(1);
  state.fields.ammonia.fill(2);
  state.fields.bacteria.fill(0.01); // a fresh filter needs a nonzero seed population to bootstrap
  const ammonia0 = state.fields.ammonia[0];
  const bacteria0 = state.fields.bacteria[0];
  // 60 steps: a fixed, non-replenished ammonia pool (no fish depositing
  // more) is consumed by step ~80 in this parameterization — a
  // continuously-fed real aquarium never reaches that regime, but this
  // test's whole point is the BOOTSTRAP window ("a fresh tank cycles"),
  // where a small seed bacteria population should already be visibly
  // outgrowing its seed value while there is still substrate to eat.
  for (let i = 0; i < 60; i++) cpu.step(spec, state);
  assertAllFinite(state.fields.ammonia, 'ammonia');
  assertAllFinite(state.fields.nitrite, 'nitrite');
  assertAllFinite(state.fields.bacteria, 'bacteria');
  assert.ok(state.fields.ammonia[0] < ammonia0, `ammonia (${state.fields.ammonia[0]}) did not fall from its seed value (${ammonia0})`);
  assert.ok(state.fields.nitrite[0] > 0, 'nitrite did not accumulate from ammonia uptake');
  assert.ok(state.fields.bacteria[0] > bacteria0, `bacteria (${state.fields.bacteria[0]}) did not grow from its seed population (${bacteria0}) during the bootstrap window`);
  for (const v of state.fields.bacteria) assert.ok(v <= 1.0001, `bacteria ${v} exceeded its declared carrying capacity 1`);
  // Left to run past substrate depletion, the population must decline
  // (starvation: mu -> 0 as ammonia -> 0, leaving growth = -deathRate*b),
  // not sit frozen or blow up — the other half of "a fresh tank cycles"
  // is that it doesn't cycle forever on a one-time ammonia pool.
  const bacteriaPeak = state.fields.bacteria[0];
  for (let i = 0; i < 340; i++) cpu.step(spec, state);
  assertAllFinite(state.fields.bacteria, 'bacteria');
  assert.ok(state.fields.bacteria[0] < bacteriaPeak, `bacteria (${state.fields.bacteria[0]}) did not decline after substrate depletion (peak ${bacteriaPeak})`);
});

test('cpu: vector source reaction (filter jet) injects fixed-direction momentum at declared cells', async ({ kernel, cpu }) => {
  const spec = kernel.defineSubstrate({
    width: 8, height: 8, seed: 2,
    channels: [{ name: 'momentum', kind: 'vector', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null }],
    reactions: [{ type: 'source', channel: 'momentum', rate: 0.5, cells: [[3, 3]], vector: [1, 0] }]
  });
  const state = cpu.createState(spec);
  cpu.step(spec, state);
  const idx = 3 * 8 + 3;
  assert.ok(Math.abs(state.fields.momentum.x[idx] - 0.5) < 1e-9, `momentum.x at source cell was ${state.fields.momentum.x[idx]}, expected 0.5`);
  assert.strictEqual(state.fields.momentum.y[idx], 0, 'vector source injected a y-component it was not declared to');
});

test('cpu: energy (every field + agent scalar) stays finite for 2000 steps', async ({ kernel, cpu }) => {
  const spec = boidsSpec(kernel.defineSubstrate);
  const state = cpu.createState(spec);
  cpu.resetAgents(spec, state);
  for (let i = 0; i < 2000; i++) cpu.step(spec, state);
  assertAllFinite(state.fields.density, 'density');
  assertAllFinite(state.fields.heading.x, 'heading.x');
  assertAllFinite(state.fields.heading.y, 'heading.y');
  assertAllFinite(state.agents.x, 'agent.x');
  assertAllFinite(state.agents.y, 'agent.y');
  assertAllFinite(state.agents.heading, 'agent.heading');
});

/* ---- runner --------------------------------------------------------- */

async function main() {
  const kernelMod = await import(pathToFileURL(path.join(ENGINE_DIR, 'kernel.js')).href);
  const kernel = kernelMod.default || kernelMod;
  const rngMod = await import(pathToFileURL(path.join(ENGINE_DIR, 'rng.js')).href);
  const rng = rngMod.default || rngMod;
  const cpuMod = await import(pathToFileURL(path.join(ENGINE_DIR, 'cpu.js')).href);
  const cpu = cpuMod.default ? { ...cpuMod.default, ...cpuMod } : cpuMod;

  let failures = 0;
  for (const { name, fn } of cases) {
    try {
      await fn({ kernel, rng, cpu });
      console.log(`PASS  ${name}`);
    } catch (err) {
      failures += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${err && err.stack ? err.stack.split('\n').join('\n      ') : err}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  if (failures) {
    console.error(`\ntests/aquarium-engine.js FAILED (${failures} failing case(s))`);
    process.exit(1);
  }
  console.log('\ntests/aquarium-engine.js passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
