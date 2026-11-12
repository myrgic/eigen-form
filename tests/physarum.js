#!/usr/bin/env node
/* =====================================================================
   tests/physarum.js — unit tests for src/dynamics/physarum.js.
   Same plain-script idiom as tests/params.js.

   Usage:
     node tests/physarum.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const MOD = pathToFileURL(path.join(__dirname, '..', 'src', 'dynamics', 'physarum.js')).href;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const P = { sa: 0.5, ra: 0.4, sensorDist: 9, speed: 1.2, deposit: 1, diffuse: 0.7, decay: 0.9, attract: 3, wander: 0 };
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

test('a seeded run is reproducible', async () => {
  const { createPhysarum } = await import(MOD);
  const run = () => { const s = createPhysarum({ width: 96, height: 64, agents: 2000, seed: 7 }); for (let i = 0; i < 40; i++) s.step(P); return Array.from(s.trail.subarray(3000, 3040)); };
  assert.deepStrictEqual(run(), run());
  const other = createPhysarum({ width: 96, height: 64, agents: 2000, seed: 8 }); for (let i = 0; i < 40; i++) other.step(P);
  assert.notDeepStrictEqual(run(), Array.from(other.trail.subarray(3000, 3040)));
});

test('the field stays finite, non-negative and bounded: deposit balances decay', async () => {
  const { createPhysarum } = await import(MOD);
  const s = createPhysarum({ width: 96, height: 64, agents: 3000, seed: 1 });
  for (let i = 0; i < 300; i++) s.step(P);
  let ok = true; for (const v of s.trail) if (!(v >= 0) || !Number.isFinite(v)) { ok = false; break; }
  assert.ok(ok, 'no NaN / negative cells');
  // steady state of total mass: agents * deposit * decay / (1 - decay)
  const expect = 3000 * 1 * 0.9 / (1 - 0.9), total = sum(s.trail);
  assert.ok(Math.abs(total - expect) / expect < 0.02, `mass ${total.toFixed(0)} should settle near ${expect}`);
});

test('agents stay on the grid (edges wrap)', async () => {
  const { createPhysarum } = await import(MOD);
  const s = createPhysarum({ width: 40, height: 30, agents: 500, seed: 3, spawn: 'scatter' });
  for (let i = 0; i < 200; i++) s.step({ ...P, speed: 3.7 });
  for (let i = 0; i < s.agents; i++) assert.ok(s.ax[i] >= 0 && s.ax[i] < 40 && s.ay[i] >= 0 && s.ay[i] < 30 && s.aa[i] >= 0 && s.aa[i] < Math.PI * 2 + 1e-6);
});

test('structure emerges: the trail concentrates onto a minority of cells', async () => {
  const { createPhysarum } = await import(MOD);
  const s = createPhysarum({ width: 128, height: 96, agents: 6000, seed: 5, spawn: 'scatter' });
  for (let i = 0; i < 400; i++) s.step(P);
  const sorted = Array.from(s.trail).sort((a, b) => b - a), total = sum(s.trail);
  let top = 0; for (let i = 0; i < sorted.length * 0.2; i++) top += sorted[i];
  assert.ok(top / total > 0.5, `the brightest 20% of cells should hold most of the trail, got ${(top / total).toFixed(2)}`);
});

test('crowding limit + spores keep a disturbed colony spread out', async () => {
  const { createPhysarum } = await import(MOD);
  const cover = (extra) => {
    const W = 240, H = 160, s = createPhysarum({ width: W, height: H, agents: 14000, seed: 3, spawn: 'scatter' });
    for (let i = 1; i <= 900; i++) { if (i % 29 === 0) s.pulse(1); if (i % 58 === 29) s.scatter(0.22); if (i % 7 === 0) s.seed(W / 2 + 50 * Math.cos(i), H / 2 + 40 * Math.sin(i * 1.3), 0.6); s.step({ ...P, sensorDist: 8, attract: 1.2, wander: 0.06, ...extra }); }
    let blocks = 0, total = 0;
    for (let by = 0; by < H; by += 16) for (let bx = 0; bx < W; bx += 16) { total++; let m = 0; for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) m = Math.max(m, s.trail[y * W + x]); if (m > 4) blocks++; }
    return blocks / total;
  };
  const bare = cover({}), kept = cover({ crowd: 10, spores: 0.005 });
  assert.ok(kept > bare + 0.1 && kept > 0.5, `mesh coverage should hold with them: bare ${bare.toFixed(2)}, kept ${kept.toFixed(2)}`);
});

test('seed() puts food where it is asked, and agents sense it', async () => {
  const { createPhysarum } = await import(MOD);
  const s = createPhysarum({ width: 96, height: 64, agents: 10, seed: 1 });
  const before = s.trail[10 * 96 + 20];
  s.seed(20, 10, 1);
  assert.ok(s.glow[10 * 96 + 20] > 5 && s.glow[40 * 96 + 70] === 0);
  assert.strictEqual(s.trail[10 * 96 + 20], before, 'food is transient: it never lands in the trail');
  s.seed(-2, 0, 1);                                        // wraps instead of throwing
  assert.ok(s.glow[0 * 96 + 94] > 0);
});

test('pulse() is a ring that travels outward and then ends', async () => {
  const { createPhysarum } = await import(MOD);
  const s = createPhysarum({ width: 120, height: 120, agents: 1, seed: 1 });
  s.pulse(1);
  const radiusOfMax = () => { let m = 0, at = 0; for (let x = 60; x < 120; x++) { const v = s.glow[60 * 120 + x]; if (v > m) { m = v; at = x - 60; } } return at; };
  for (let i = 0; i < 4; i++) s.step(P); const r1 = radiusOfMax();
  for (let i = 0; i < 6; i++) s.step(P); const r2 = radiusOfMax();
  assert.ok(r2 > r1 && r1 > 5, `ring should move out: ${r1} -> ${r2}`);
  for (let i = 0; i < 200; i++) s.step(P);
  assert.strictEqual(s.rings, 0, 'it ends');
  for (let i = 0; i < 40; i++) s.pulse(1);
  assert.ok(s.rings <= 25, 'a burst of pulses cannot pile up without bound');
});

test('scatter() turns about the asked fraction of agents', async () => {
  const { createPhysarum } = await import(MOD);
  const s = createPhysarum({ width: 96, height: 64, agents: 4000, seed: 2 });
  const before = Float32Array.from(s.aa);
  s.scatter(0.25);
  let changed = 0; for (let i = 0; i < 4000; i++) if (s.aa[i] !== before[i]) changed++;
  assert.ok(changed > 800 && changed < 1200, `expected ~1000 of 4000, got ${changed}`);
});

test('respawn modes place agents differently, and paint() fills an RGBA buffer', async () => {
  const { createPhysarum, buildLut, accentFor, SPAWNS } = await import(MOD);
  const s = createPhysarum({ width: 80, height: 60, agents: 1000, seed: 4 });
  const spreadOf = () => { let v = 0; for (let i = 0; i < 1000; i++) v += Math.hypot(s.ax[i] - 40, s.ay[i] - 30); return v / 1000; };
  const spreads = {}; for (const m of SPAWNS) { s.respawn(m); spreads[m] = spreadOf(); }
  assert.ok(spreads.core < spreads.disc && spreads.disc < spreads.ring, JSON.stringify(spreads));
  for (let i = 0; i < 30; i++) s.step(P);
  const out = new Uint8ClampedArray(80 * 60 * 4), lut = buildLut(150, 60);
  assert.strictEqual(lut.length, 768);
  assert.deepStrictEqual([lut[0], lut[1], lut[2]], [0, 0, 0], 'an empty cell is black');
  s.paint(out, lut, accentFor(150));
  let lit = 0; for (let i = 0; i < out.length; i += 4) { assert.strictEqual(out[i + 3], 255); if (out[i] + out[i + 1] + out[i + 2] > 30) lit++; }
  assert.ok(lit > 50, `some cells are lit: ${lit}`);
});

(async () => {
  let failed = 0;
  for (const c of cases) {
    try { await c.fn(); console.log(`PASS  ${c.name}`); }
    catch (err) { failed++; console.log(`FAIL  ${c.name}\n      ${err && err.message}`); }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
  console.log('\ntests/physarum.js passed.');
})();
