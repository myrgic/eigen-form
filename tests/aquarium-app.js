#!/usr/bin/env node
/* =====================================================================
   tests/aquarium-app.js — regression coverage for the three app-level
   dynamics defects found 2026-09-11 via the real-time headless driver
   (tools/headless_drive.mjs), all of which only show up after frame
   one — see docs/aquarium-design.md's "Verification" section for why
   --virtual-time-budget dump-dom can't see any of them.

   Same plain-script idiom as tests/aquarium-engine.js: no framework,
   PASS/FAIL lines, dynamic import() for the ES modules under
   apps/aquarium/ (that directory's own package.json scopes it to
   module mode), process.exit(1) on any failure.

   What this file checks:
     1. surface.js: stepSurface, run standalone for 5000 steps under a
        representative forcing amplitude (a bounded, spatially-broad
        vTop — the shape that used to integrate into unbounded height,
        see surface.js's own "Stability, named plainly"), keeps
        surfaceRms bounded and settled, not still climbing.
     2. spec.js + engine/cpu.js: a reduced-grid aquarium spec, stepped
        for 60s of real-time-equivalent frames, establishes a positive,
        growing nitrifying bacteria population and clearly positive
        nitrite — the nitrogen cycle actually starting (see spec.js's
        nitrifyHalfSat comment and seedAquarium's bootstrap comment).
     3. plants.js: stepPlants, driven by the real engine's own momentum
        field at default plantDrag, keeps the mean plant-segment tilt
        from vertical under 30 degrees through 30s of real-time-
        equivalent frames (see plants.js's "Standing up, named
        plainly").

   Usage:
     node tests/aquarium-app.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'apps', 'aquarium');
const ENGINE_DIR = path.join(APP_DIR, 'engine');

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }

// ~48fps is what the real-time headless driver measured (docs/
// aquarium-design.md's "Verification" section) — used here to convert
// "N seconds of real-time-equivalent" into an engine step count.
const FPS = 48;

/* ---- fixtures ------------------------------------------------------ */

function defaultValues(SCHEMA) {
  const values = {};
  for (const [k, v] of Object.entries(SCHEMA)) {
    values[k] = v.default !== undefined ? v.default : (v.prereg !== undefined ? v.prereg : v.options && v.options[0]);
  }
  return values;
}

/* ---- cases ----------------------------------------------------------- */

test('surface: stepSurface stays bounded for 5000 steps under a representative forcing', async ({ surface }) => {
  const W = 112;
  const s = surface.createSurface(W);
  // A bounded, spatially-broad vTop with a nonzero mean — the exact
  // shape (persistent low-wavenumber bias) that, before the gravity-
  // restoring-term fix, integrated into unbounded height (surface.js's
  // "Stability, named plainly": measured against the real engine's own
  // momentum.y, surfaceRms climbed past 900 and was still rising at
  // 5000 steps). Amplitude ~0.3-0.4 matches the per-cell velocity
  // magnitude the real momentum field's own kinetic-energy plateau
  // implies (docs/aquarium-design.md).
  const vTop = (x) => 0.3 * Math.sin(x * 0.037) + 0.12;
  const params = { c: 0.18, gamma: 0.06, k: 0.4, g: 0.03 };

  let rmsAt3000 = null;
  let maxRms = 0;
  for (let step = 1; step <= 5000; step++) {
    surface.stepSurface(s, params, vTop, []);
    let acc = 0;
    for (let x = 0; x < W; x++) acc += s.h[x] * s.h[x];
    const rms = Math.sqrt(acc / W);
    if (rms > maxRms) maxRms = rms;
    if (step === 3000) rmsAt3000 = rms;
  }
  let accFinal = 0;
  for (let x = 0; x < W; x++) accFinal += s.h[x] * s.h[x];
  const rmsFinal = Math.sqrt(accFinal / W);

  assert.ok(Number.isFinite(rmsFinal), `surfaceRms is not finite: ${rmsFinal}`);
  assert.ok(rmsFinal < 20, `surfaceRms should settle to a small, bounded value, got ${rmsFinal}`);
  // "Bounded" means SETTLED, not just "hasn't diverged yet by step
  // 5000" — check it's no longer growing (within 5%) between step
  // 3000 and step 5000, ruling out the old defect's slow-but-real climb.
  assert.ok(
    rmsFinal < rmsAt3000 * 1.05,
    `surfaceRms should have settled by step 3000, not still be rising: rms(3000)=${rmsAt3000}, rms(5000)=${rmsFinal}`
  );
});

test('surface: c is clamped by construction, even if the caller passes a value past the CFL bound', async ({ surface }) => {
  const W = 32;
  const s = surface.createSurface(W);
  const vTop = (x) => (x === 16 ? 1 : 0); // a single sharp impulse column
  // c = 5 is far past the CFL bound (c <= 1) this file's header derives
  // — stepSurface must clamp it internally rather than trust the caller.
  const params = { c: 5, gamma: 0.06, k: 0.4, g: 0.03 };
  for (let step = 1; step <= 500; step++) surface.stepSurface(s, params, vTop, []);
  for (let x = 0; x < W; x++) assert.ok(Number.isFinite(s.h[x]), `h[${x}] is not finite: ${s.h[x]}`);
});

test('bacteria: a reduced-grid aquarium establishes a positive, growing nitrifying population within 60s', async ({ spec, cpu }) => {
  const values = defaultValues(spec.SCHEMA);
  values.backend = 'cpu';
  values.cpuGridScale = 0.5; // reduced grid, per the build brief

  const { spec: builtSpec, meta } = spec.buildAquariumSpec(values, 12345);
  const state = cpu.createState(builtSpec);
  spec.seedAquarium(builtSpec, state, meta, values);
  cpu.resetAgents(builtSpec, state);

  const CHANNELS = spec.CHANNELS;
  const STEPS = 60 * FPS;
  const HALFWAY = 30 * FPS;
  let meanBacAtHalfway = null;

  for (let step = 1; step <= STEPS; step++) {
    cpu.step(builtSpec, state);
    if (step === HALFWAY) {
      meanBacAtHalfway = mean(state.fields[CHANNELS.BACTERIA_A]) + mean(state.fields[CHANNELS.BACTERIA_B]);
    }
  }

  const bacA = state.fields[CHANNELS.BACTERIA_A];
  const bacB = state.fields[CHANNELS.BACTERIA_B];
  const nitrite = state.fields[CHANNELS.NITRITE];
  const meanBacFinal = mean(bacA) + mean(bacB);
  const nitriteSum = sum(nitrite);

  assert.ok(mean(bacA) > 0.005, `bacteriaA should be clearly established, got mean ${mean(bacA)}`);
  assert.ok(mean(bacB) > 0.005, `bacteriaB should be clearly established, got mean ${mean(bacB)}`);
  assert.ok(nitriteSum > 1, `nitrite should be clearly positive by 60s, got sum ${nitriteSum}`);
  assert.ok(
    meanBacFinal > meanBacAtHalfway,
    `bacteria should still be growing at 60s, not declining: mean(30s)=${meanBacAtHalfway}, mean(60s)=${meanBacFinal}`
  );
});

test('plants: mean segment tilt from vertical stays under 30 degrees through 30s at default params', async ({ spec, cpu, plants }) => {
  const values = defaultValues(spec.SCHEMA);
  values.backend = 'cpu';
  values.cpuGridScale = 0.5;

  const { spec: builtSpec, meta } = spec.buildAquariumSpec(values, 12345);
  const state = cpu.createState(builtSpec);
  spec.seedAquarium(builtSpec, state, meta, values);
  cpu.resetAgents(builtSpec, state);

  const plantList = plants.createPlants(values.plantCount, values.plantSegments, values.plantSegLength, meta);
  const W = builtSpec.width, H = builtSpec.height;

  function sampleMomentum(x, y) {
    const momentum = state.fields[spec.CHANNELS.MOMENTUM];
    return [
      cpu.bilinearSample(momentum.x, x, y, W, H, 'wall'),
      cpu.bilinearSample(momentum.y, x, y, W, H, 'wall')
    ];
  }

  function meanTiltDeg() {
    let sumDeg = 0, n = 0;
    for (const plant of plantList) {
      const pts = plant.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        sumDeg += Math.atan2(Math.abs(dx), Math.abs(dy)) * 180 / Math.PI;
        n++;
      }
    }
    return n ? sumDeg / n : 0;
  }

  const STEPS = 30 * FPS;
  let maxTilt = 0;
  for (let step = 1; step <= STEPS; step++) {
    cpu.step(builtSpec, state);
    plants.stepPlants(
      plantList,
      { drag: values.plantDrag, iterations: values.plantStiffIters, segLength: values.plantSegLength },
      sampleMomentum
    );
    if (step % FPS === 0) maxTilt = Math.max(maxTilt, meanTiltDeg());
  }

  const finalTilt = meanTiltDeg();
  assert.ok(finalTilt < 30, `mean plant tilt at 30s should be under 30 degrees, got ${finalTilt.toFixed(2)}`);
  assert.ok(maxTilt < 30, `mean plant tilt should stay under 30 degrees throughout, peaked at ${maxTilt.toFixed(2)}`);
});

/* ---- runner --------------------------------------------------------- */

async function main() {
  const surfaceMod = await import(pathToFileURL(path.join(APP_DIR, 'surface.js')).href);
  const surface = surfaceMod.default ? { ...surfaceMod.default, ...surfaceMod } : surfaceMod;
  const plantsMod = await import(pathToFileURL(path.join(APP_DIR, 'plants.js')).href);
  const plants = plantsMod.default ? { ...plantsMod.default, ...plantsMod } : plantsMod;
  const specMod = await import(pathToFileURL(path.join(APP_DIR, 'spec.js')).href);
  const spec = specMod.default ? { ...specMod.default, ...specMod } : specMod;
  const cpuMod = await import(pathToFileURL(path.join(ENGINE_DIR, 'cpu.js')).href);
  const cpu = cpuMod.default ? { ...cpuMod.default, ...cpuMod } : cpuMod;

  let failures = 0;
  for (const { name, fn } of cases) {
    try {
      await fn({ surface, plants, spec, cpu });
      console.log(`PASS  ${name}`);
    } catch (err) {
      failures += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${err && err.stack ? err.stack.split('\n').join('\n      ') : err}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  if (failures) {
    console.error(`\ntests/aquarium-app.js FAILED (${failures} failing case(s))`);
    process.exit(1);
  }
  console.log('\ntests/aquarium-app.js passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
