#!/usr/bin/env node
/* =====================================================================
   tests/engine.js — regression coverage for createTrefoilMark itself
   (src/eigen-form.js), as opposed to tests/params.js which only
   exercises src/params/define.js. Covers the two HIGH-severity fixes
   from the bg/audit pass:

     - the double-init dedup guard (GH #1): a canvas that already has a
       controller must get the SAME controller back from a second
       createTrefoilMark call, not a second uncontrolled instance; and
       stop() must release the canvas so the stop()-then-recreate
       pattern rebuild()-style pages already use keeps working.
     - a non-finite construction option (NaN) must fall back to the
       documented default instead of poisoning the phase integration.
     - a canvas's backing-store size (canvas.width/height) changing
       mid-session must self-heal the 2D context's transform on the
       very next frame, since assigning canvas.width/height resets it
       to identity per the canvas spec.

   Same plain-script idiom as tests/params.js and tools/golden.js: no
   framework, PASS/FAIL lines, process.exit(1) on any failure.

   Usage:
     node tests/engine.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'src', 'eigen-form.js');
const CAPTURE_PATH = path.join(ROOT, 'src', 'backends', 'capture.js');

// ---- Fixed-tick requestAnimationFrame shim (same as tools/golden.js) ----
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
function resetRaf() {
  rafQueue = [];
  rafSeq = 0;
}
function fireQueuedFrame(now) {
  const due = rafQueue;
  rafQueue = [];
  for (const entry of due) entry.cb(now);
}

function makeCanvasStub(width, height, ctx) {
  return { width, height, getContext: () => ctx };
}

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test('dedup: a second createTrefoilMark call on an already-controlled canvas returns the SAME controller', async ({ engine, capture }) => {
  resetRaf();
  const { ctx } = capture.createCaptureContext();
  const canvas = makeCanvasStub(1080, 1080, ctx);
  const a = engine.createTrefoilMark(canvas, {});
  const b = engine.createTrefoilMark(canvas, {});
  assert.strictEqual(a, b, 'expected the existing controller back, not a second one');
  a.stop();
});

test('dedup: stop() releases the canvas, a fresh createTrefoilMark call gets a new controller', async ({ engine, capture }) => {
  resetRaf();
  const { ctx } = capture.createCaptureContext();
  const canvas = makeCanvasStub(1080, 1080, ctx);
  const a = engine.createTrefoilMark(canvas, {});
  a.stop();
  const b = engine.createTrefoilMark(canvas, {});
  assert.notStrictEqual(a, b, 'expected a fresh controller after stop()');
  b.stop();
});

test('construction: non-finite opts (NaN) fall back to documented defaults instead of poisoning params', async ({ engine, capture }) => {
  resetRaf();
  const { ctx } = capture.createCaptureContext();
  const canvas = makeCanvasStub(1080, 1080, ctx);
  const mark = engine.createTrefoilMark(canvas, { period: NaN, precession: NaN, p: NaN });
  assert.strictEqual(mark.params.period, 3000, 'period should fall back to its documented default (3000ms)');
  assert.strictEqual(mark.params.precession, 0, 'precession should fall back to its documented default (0)');
  assert.strictEqual(mark.params.p, 2, 'p should fall back to its documented default (2)');
  assert.ok(Number.isFinite(mark.params.period));
  mark.stop();
});

test('resize: reassigning canvas.width/height mid-session self-heals the transform on the next frame', async ({ engine, capture }) => {
  resetRaf();
  const { ctx, ops } = capture.createCaptureContext();
  const canvas = makeCanvasStub(480, 480, ctx); // 1:1 backing store -> initial scale(1,1)
  const mark = engine.createTrefoilMark(canvas, { emergence: false });
  // Construction's own synchronous warm-up already recorded ops
  // (including the initial scale(1,1)) and start() queued exactly one
  // real frame — clear the log, this test only cares what happens next.
  ops.length = 0;

  // Simulate a host's own responsive/DPR resize handler reassigning the
  // canvas's backing-store size mid-session — per the canvas spec this
  // resets the 2D context's transform to identity, independent of
  // anything this library does.
  canvas.width = 960;
  canvas.height = 960; // 2x

  fireQueuedFrame(16);

  const scaleOps = ops.filter((o) => o.op === 'scale');
  assert.ok(scaleOps.length >= 1, 'expected the engine to re-apply ctx.scale after a width/height change');
  assert.deepStrictEqual(
    scaleOps[0].args,
    [2, 2],
    `expected scale(2,2) for a 480->960 backing-store resize, got ${JSON.stringify(scaleOps[0].args)}`
  );
  mark.stop();
});

async function main() {
  const engineMod = await import(pathToFileURL(ENGINE_PATH).href);
  const engine = engineMod.default || engineMod;
  const captureMod = await import(pathToFileURL(CAPTURE_PATH).href);
  const capture = captureMod.default || captureMod;

  let failures = 0;
  for (const { name, fn } of cases) {
    try {
      await fn({ engine, capture });
      console.log(`PASS  ${name}`);
    } catch (err) {
      failures += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${err && err.stack ? err.stack.split('\n').join('\n      ') : err}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  if (failures) {
    console.error(`\ntests/engine.js FAILED (${failures} failing case(s))`);
    process.exit(1);
  }
  console.log('\ntests/engine.js passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
