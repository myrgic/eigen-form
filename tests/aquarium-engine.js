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
