#!/usr/bin/env node
/* =====================================================================
   tools/golden.js — headless determinism harness for the eigen-form
   engine.

   Drives createTrefoilMark() under a fixed virtual clock (no real
   requestAnimationFrame, no Date.now, no reduced-motion query) with the
   capture backend (src/backends/capture.js) standing in for
   CanvasRenderingContext2D, and hashes the resulting op stream per
   scenario. Two runs of the same engine against the same scenario set
   must produce identical hashes; any change to what the engine paints —
   intentional or not — changes a hash.

   Usage:
     node tools/golden.js            regenerate goldens/ops-v0.0.2.json
     node tools/golden.js --check    compare against the committed file,
                                      exit 1 on any mismatch

   Module-system note: the engine and capture backend are loaded with a
   dynamic import() rather than require(), so this file does not need to
   change between the pre-split monolith (which exports CommonJS-style
   via `module.exports`) and the post-split assembly (an ES module) —
   dynamic import() interoperates with both, and both engine shapes
   expose a `default` export with the same {createTrefoilMark, GRADIENTS}
   shape for this harness to destructure. See docs/families or ROADMAP.md
   v0.1 for why the split moved src/ to ES modules.

   requestAnimationFrame shim: the engine's start()/frame() call
   requestAnimationFrame unconditionally once reducedMotion is false (no
   typeof guard on that one call site — every other browser touch point
   in the engine *is* typeof-guarded). This is the one global this
   harness must provide. window and document are deliberately left
   undefined: passing the canvas as an object literal (never a string
   id) means document.getElementById is never reached, and the
   reduced-motion check's own typeof guard makes an absent window
   evaluate to "not reduced motion", which is what these scenarios want.
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'src', 'eigen-form.js');
const CAPTURE_PATH = path.join(ROOT, 'src', 'backends', 'capture.js');
const GOLDEN_PATH = path.join(ROOT, 'goldens', 'ops-v0.0.2.json');

// ---- Fixed-tick requestAnimationFrame shim ----
let rafQueue = [];
let rafSeq = 0;
global.requestAnimationFrame = (cb) => {
  const id = ++rafSeq;
  rafQueue.push({ id, cb });
  return id;
};
global.cancelAnimationFrame = (id) => {
  rafQueue = rafQueue.filter((entry) => entry.id !== id);
};

function fireQueuedFrame(now) {
  const due = rafQueue;
  rafQueue = [];
  for (const entry of due) entry.cb(now);
}

// Ticks the fake rAF clock in fixed dtStep increments until the
// controller's own virtual-time counter reaches targetMs. This is the
// same fixed-dt discipline the engine's internal warmTo() already uses
// (16ms steps), just driven from outside via the fake scheduler instead
// of a real one.
function tickTo(controller, targetMs, dtStep = 16) {
  let now = 0;
  let guard = 0;
  while (controller.time < targetMs && guard < 10000) {
    now += dtStep;
    fireQueuedFrame(now);
    guard += 1;
  }
}

function makeCanvasStub(width, height, ctx) {
  return { width, height, getContext: () => ctx };
}

// ---- Scenario declarations ----
// Scenarios that leave emergence off reach their steady state
// synchronously inside the constructor (the engine warms itself to the
// living steady state by tracing — see warmTo() in src/eigen-form.js),
// so capturing immediately after construction is already "settled".
// Only the emergence scenario needs post-construction ticking, since
// emergence:true skips that automatic warm-up specifically so the
// appear -> translate -> settle -> trailGrow sequence can be watched.
const SCENARIOS = [
  { name: 'default-settle', opts: {} },
  { name: 'emergence-3000ms', opts: { emergence: true }, tickToMs: 3000 },
  { name: 'custom-gradient', opts: { gradient: { hueStart: 10, hueEnd: 50, sat: 80, light: 55 } } },
  { name: 'precession', opts: { precession: 15000 } },
  { name: 'parallax', opts: { parallax: 0.6 } },
  { name: 'pq-3-2', opts: { p: 3, q: 2 } }
];

async function loadModule(absPath) {
  const mod = await import(pathToFileURL(absPath).href);
  return mod.default || mod;
}

async function runScenario(engine, capture, scenario) {
  rafQueue = [];
  rafSeq = 0;
  const { ctx, ops, opsHash } = capture.createCaptureContext();
  const canvas = makeCanvasStub(1080, 1080, ctx);
  const controller = engine.createTrefoilMark(canvas, scenario.opts);
  if (scenario.tickToMs) tickTo(controller, scenario.tickToMs);
  controller.stop();
  return { hash: opsHash(), count: ops.length };
}

async function computeAll() {
  const engine = await loadModule(ENGINE_PATH);
  const capture = await loadModule(CAPTURE_PATH);
  const results = {};
  for (const scenario of SCENARIOS) {
    results[scenario.name] = await runScenario(engine, capture, scenario);
  }
  return results;
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const results = await computeAll();

  if (checkMode) {
    if (!fs.existsSync(GOLDEN_PATH)) {
      console.error(`No golden file at ${path.relative(ROOT, GOLDEN_PATH)} to check against.`);
      process.exit(1);
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
    let ok = true;
    for (const scenario of SCENARIOS) {
      const want = golden.scenarios[scenario.name];
      const got = results[scenario.name];
      const pass = !!want && want.opsHash === got.hash && want.opCount === got.count;
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${scenario.name}  ${got.hash}  (${got.count} ops)`);
      if (!pass) ok = false;
    }
    if (!ok) {
      console.error('\ngolden check FAILED — op stream diverged from goldens/ops-v0.0.2.json');
      process.exit(1);
    }
    console.log('\ngolden check passed — every scenario reproduced its committed opsHash exactly.');
  } else {
    const out = { engine: 'eigen-form', scenarioSet: 'v0.0.2', precision: 6, scenarios: {} };
    for (const scenario of SCENARIOS) {
      out.scenarios[scenario.name] = {
        opsHash: results[scenario.name].hash,
        opCount: results[scenario.name].count
      };
    }
    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(out, null, 2) + '\n');
    for (const scenario of SCENARIOS) {
      console.log(`${scenario.name}  ${results[scenario.name].hash}  (${results[scenario.name].count} ops)`);
    }
    console.log(`\nWrote ${path.relative(process.cwd(), GOLDEN_PATH)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
