#!/usr/bin/env node
/* =====================================================================
   tests/knot-pen.js — src/render/knot-pen.js against answers known
   exactly, not against how it looks:

     - the pen passes under a crossing exactly diagramCrossings(p,q)
       times per lap, i.e. q*(p-1): 3 for the trefoil, 8 for (3,4),
       5 for (2,5). A sort bug that lets the pen's own trail paint over
       the ball, or lets the pen float over a true over-strand, changes
       the count.
     - a frame's op stream is deterministic (same t -> same hash) and
       the animation loops: t and t+laps produce the same frame when the
       hue period divides the loop.
     - the still paints every segment exactly once (N strokes of colour,
       N halo cuts) and only uses the documented ctx surface.

   Plain-script idiom as tests/engine.js. Usage: node tests/knot-pen.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const PEN = pathToFileURL(path.join(ROOT, 'src', 'render', 'knot-pen.js')).href;
const CAPTURE = pathToFileURL(path.join(ROOT, 'src', 'backends', 'capture.js')).href;

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// Count maximal runs of occluded pen positions over one lap.
function underPasses(pen, steps) {
  const occ = [];
  for (let f = 0; f < steps; f++) occ.push(pen.penOccluded(f / steps));
  let runs = 0;
  for (let f = 0; f < steps; f++) if (occ[f] && !occ[(f - 1 + steps) % steps]) runs++;
  return { runs, hidden: occ.filter(Boolean).length };
}

for (const [p, q] of [[2, 3], [3, 4], [2, 5]]) {
  test(`pen passes under exactly q*(p-1) crossings per lap for (${p},${q})`, async ({ kp }) => {
    const pen = kp.createKnotPen({ p, q, size: 512, samples: 3000, stroke: p === 2 && q === 3 ? 0.10 : 0.065 });
    const { runs, hidden } = underPasses(pen, 720);
    assert.strictEqual(runs, kp.diagramCrossings(p, q), `expected ${kp.diagramCrossings(p, q)} under-passes, got ${runs}`);
    // and the pen is visible most of the lap (not buried under its own trail)
    assert.ok(hidden / 720 < 0.35, `pen hidden ${(100 * hidden / 720).toFixed(1)}% of the lap`);
  });
}

test('frames are deterministic and the animation loops when the hue period divides it', async ({ kp, cap }) => {
  const pen = kp.createKnotPen({ size: 256, samples: 1500, hueRatio: 4 / 3 });
  const hash = (t) => { const c = cap.createCaptureContext(); pen.drawFrame(c.ctx, t); return c.opsHash(); };
  assert.strictEqual(hash(0.37), hash(0.37), 'same t must give the same op stream');
  // 4 laps = 3 hue periods: frame at t and t+4 are identical
  assert.strictEqual(hash(0.37), hash(4.37), 'expected a seamless 4-lap loop at hueRatio 4/3');
  assert.notStrictEqual(hash(0.37), hash(1.37), 'consecutive laps should differ in colour at hueRatio 4/3');
});

test('still paints each segment once: N halo cuts + N colour strokes, no pen', async ({ kp, cap }) => {
  const N = 1200;
  const pen = kp.createKnotPen({ size: 256, samples: N });
  const c = cap.createCaptureContext();
  pen.drawStill(c.ctx);
  const strokes = c.ops.filter((o) => o.op === 'stroke').length;
  const arcs = c.ops.filter((o) => o.op === 'arc').length;
  assert.strictEqual(strokes, 2 * N, `expected ${2 * N} strokes, got ${strokes}`);
  assert.strictEqual(arcs, 0, 'a still has no pen');
  const used = new Set(c.ops.map((o) => o.op || o.set));
  const allowed = new Set(['fillStyle', 'fillRect', 'strokeStyle', 'lineCap', 'lineWidth', 'beginPath', 'moveTo', 'lineTo', 'stroke']);
  for (const u of used) assert.ok(allowed.has(u), `unexpected ctx use: ${u}`);
});

test('transparent ground cuts gaps with destination-out and restores the composite op', async ({ kp, cap }) => {
  const pen = kp.createKnotPen({ size: 128, samples: 600, ground: null });
  const c = cap.createCaptureContext();
  c.ctx.globalCompositeOperation = 'source-over';
  pen.drawFrame(c.ctx, 0.2);
  const sets = c.ops.filter((o) => o.set === 'globalCompositeOperation').map((o) => o.value);
  assert.ok(sets.includes('destination-out'), 'expected destination-out cuts');
  assert.strictEqual(sets[sets.length - 1], 'source-over', 'composite op must be restored');
});

test('non-finite options fall back to defaults', async ({ kp }) => {
  const pen = kp.createKnotPen({ p: NaN, q: 'x', size: 64, samples: NaN });
  assert.strictEqual(pen.options.p, 2);
  assert.strictEqual(pen.options.q, 3);
  assert.strictEqual(pen.samples, kp.KNOT_PEN_DEFAULTS.samples);
});

(async () => {
  const kp = await import(PEN);
  const cap = await import(CAPTURE);
  let failures = 0;
  for (const { name, fn } of cases) {
    try { await fn({ kp, cap }); console.log(`PASS  ${name}`); }
    catch (err) { failures++; console.log(`FAIL  ${name}\n      ${err.message}`); }
  }
  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  process.exit(failures ? 1 : 0);
})();
