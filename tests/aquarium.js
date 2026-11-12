#!/usr/bin/env node
/* =====================================================================
   tests/aquarium.js — regression checks for the three aquarium defects
   fixed on 2026-09-24 (CPU reference engine, apps/aquarium/engine/cpu.js):

     1. walls: a uniform flow in a closed 'wall' box projects to ~0
        (before: it passed through unchanged, mean v_y stayed -1), and
        uniformly warm water does not lift the whole tank.
     2. nitrogen: total N in the water never exceeds the ammonia the fish
        deposited (before: 205-250x at the defaults).
     3. bubbles: with the page's own setup (spec.js setupState) bubbles
        start with a rise speed and move up (before: speed 0, no rise).

   Same plain-script idiom as tests/params.js: PASS/FAIL lines, exit 1 on
   any failure. Usage: node tests/aquarium.js
   ===================================================================== */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', 'apps', 'aquarium');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failed++;
}

(async () => {
  const { defineSubstrate } = await imp('engine/kernel.js');
  const cpu = await imp('engine/cpu.js');
  const specMod = await imp('spec.js');
  const { SCHEMA, buildAquariumSpec } = specMod;
  // Older trees have no setupState; fall back to the order their
  // index.html used (seed, then reset) so this file doubles as the
  // negative control against origin/main.
  const setupState = specMod.setupState || ((sp, st, meta, v, eng) => { specMod.seedAquarium(sp, st, meta, v); eng.resetAgents(sp, st); });
  const tol = { relL2: 0.1, maxAbs: 1, agentPos: 1, earlyStep: 1, earlyRelL2: 0.1, earlyMaxAbs: 1 };

  // 1a. uniform flow projects to ~0
  {
    const W = 40, H = 30;
    const spec = defineSubstrate({ width: W, height: H, seed: 1, reactions: [], tolerance: tol,
      channels: [{ name: 'm', kind: 'vector', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null, projection: { enabled: true, iterations: 2000 } }] });
    const st = cpu.createState(spec);
    st.fields.m.y.fill(-1);
    cpu.step(spec, st);
    let ke = 0; for (let i = 0; i < W * H; i++) ke += st.fields.m.x[i] ** 2 + st.fields.m.y[i] ** 2;
    const rms = Math.sqrt(ke / (W * H));
    check('walls: uniform v_y=-1 projects to ~0', rms < 1e-3, `rms |v| after = ${rms.toExponential(2)} (was 1.0)`);
  }
  // 1b. uniformly warm water stays still
  {
    const W = 40, H = 30;
    const spec = defineSubstrate({ width: W, height: H, seed: 1, tolerance: tol,
      channels: [
        { name: 'm', kind: 'vector', diffuse: 0.14, halfLife: 220, boundary: 'wall', advectedBy: null, projection: { enabled: true, iterations: 44 } },
        { name: 'T', kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null }],
      reactions: [{ type: 'buoyancy', velocity: 'm', temperature: 'T', beta: 0.012, reference: 20 }] });
    const st = cpu.createState(spec);
    st.fields.T.fill(21);
    for (let i = 0; i < 500; i++) cpu.step(spec, st);
    const meanVy = sum(st.fields.m.y) / (W * H);
    check('walls: uniform warm water does not lift the tank', Math.abs(meanVy) < 0.1, `mean v_y after 500 steps = ${meanVy.toFixed(4)} (was about -3.8)`);
  }

  // 2 + 3. the real aquarium spec with the page's setup
  const values = {};
  for (const [k, d] of Object.entries(SCHEMA)) values[k] = d.default ?? d.prereg;
  Object.assign(values, { backend: 'cpu', cpuGridScale: 0.5 });
  const { spec, meta } = buildAquariumSpec(values, 104736);
  const st = cpu.createState(spec);
  setupState(spec, st, meta, values, cpu);

  const B = st.populationsByName.bubbles;
  const speed0 = sum(B.speed) / B.count, y0 = sum(B.y) / B.count;
  check('bubbles: page setup gives a rise speed', speed0 > 0.05, `mean speed at start = ${speed0.toFixed(3)} (was 0)`);

  const steps = 400;
  for (let s = 0; s < steps; s++) cpu.step(spec, st);
  const y1 = sum(B.y) / B.count;
  check('bubbles: they move up (row 0 is the surface)', y1 < y0 - 5, `mean y ${y0.toFixed(1)} -> ${y1.toFixed(1)}`);

  const F = st.fields;
  const nTotal = sum(F.ammonia) + sum(F.nitrite) + sum(F.nitrate);
  const added = values.fishCount * values.fishAmmoniaRate * steps;
  const ratio = nTotal / added;
  check('nitrogen: total N <= ammonia added (+5% for advection)', ratio <= 1.05, `total/added = ${ratio.toFixed(4)} (was 205-250)`);

  const mdiv = cpu.meanAbsDivergence(spec, st, 'momentum');
  const meanVy = sum(F.momentum.y) / (spec.width * spec.height);
  check('walls: half-grid tank does not drift', Math.abs(meanVy) < 0.1, `mean v_y = ${meanVy.toFixed(4)}, mean |div| = ${mdiv.toExponential(2)} (was about -6.3, 2.7e-2)`);

  if (failed) { console.log(`\n${failed} aquarium check(s) failed`); process.exit(1); }
  console.log('\naquarium checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
