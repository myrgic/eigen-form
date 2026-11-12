#!/usr/bin/env node
/* =====================================================================
   tests/gl.js — what can be checked about the GPU layer without a GPU:
   the signal texture's layout and encodings (src/gl/signal-texture.js)
   and that every sim in the deck is well-formed (src/gl/sims).
   Shader COMPILATION is not covered here: that needs a browser.
   Same plain-script idiom as tests/params.js.

   Usage:
     node tests/gl.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const at = (...p) => pathToFileURL(path.join(__dirname, '..', 'src', ...p)).href;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const frame = (o = {}) => ({ playing: true, bpm: 120, slot: 'A', beatPhase: 0.25, barPhase: 0.5, rms: 0.4, peak: 0.6, bands: [0.1, 0.8, 0.3, 0.5, 0.2], onset: false, kick: false, ...o });
const W = 128;
const at4 = (d, x, y) => Array.from(d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
// AudioLink.cginc: rpx.x + rpx.y*1024 + rpx.z*1048576 + rpx.w*1073741824
const decode = (d, x, y) => { const [r, g, b, a] = at4(d, x, y); return r + g * 1024 + b * 1048576 + a * 1073741824; };

test('the texture is AudioLink\'s size and the four bands sit where AudioLink puts them', async () => {
  const { createSignalTexture, SIGNAL_WIDTH, SIGNAL_HEIGHT } = await import(at('gl', 'signal-texture.js'));
  assert.deepStrictEqual([SIGNAL_WIDTH, SIGNAL_HEIGHT], [128, 64]);
  const t = createSignalTexture(), d = t.update(frame(), 1 / 60, 1e6);
  assert.ok(Math.abs(at4(d, 0, 0)[0] - 0.8) < 1e-6, 'bass (row 0) = max(sub, bass)');
  assert.ok(Math.abs(at4(d, 0, 1)[0] - 0.3) < 1e-6 && Math.abs(at4(d, 0, 2)[0] - 0.5) < 1e-6 && Math.abs(at4(d, 0, 3)[0] - 0.2) < 1e-6, 'low mids, high mids, treble');
});

test('history cascades right: the newest value is at x = 0', async () => {
  const { createSignalTexture } = await import(at('gl', 'signal-texture.js'));
  const t = createSignalTexture(); let d;
  for (const v of [0.1, 0.2, 0.3]) d = t.update(frame({ bands: [0, v, 0, 0, 0] }), 1 / 60, 1e6);
  assert.deepStrictEqual([0, 1, 2].map((x) => +at4(d, x, 0)[0].toFixed(3)), [0.3, 0.2, 0.1]);
  for (let i = 0; i < 200; i++) d = t.update(frame({ bands: [0, 0.9, 0, 0, 0] }), 1 / 60, 1e6);
  assert.ok(Math.abs(at4(d, 127, 0)[0] - 0.9) < 1e-6, 'and it fills all 128 columns');
});

test('integers survive AudioLink\'s 10-bit packing, including past 2^30', async () => {
  const { createSignalTexture } = await import(at('gl', 'signal-texture.js'));
  const t = createSignalTexture(), d = t.update(frame(), 1 / 60, 1e6 + 123456);
  assert.strictEqual(decode(d, 2, 22), 0, 'instance time starts at zero');
  const d2 = t.update(frame(), 1 / 60, 1e6 + 123456 + 3_000_000_000);
  assert.strictEqual(decode(d2, 2, 22), 3_000_000_000);
  for (const c of at4(d2, 2, 22).slice(0, 3)) assert.ok(c >= 0 && c < 1024 && Number.isInteger(c));
});

test('chronotensity: fixed speed when the band is dark, stationary when it is full', async () => {
  const { createSignalTexture, CHRONO_RATE } = await import(at('gl', 'signal-texture.js'));
  const run = (level) => { const t = createSignalTexture(); let d; for (let i = 0; i < 60; i++) d = t.update(frame({ bands: [0, level, 0, 0, 0] }), 1 / 60, 1e6); return (x) => decode(d, 16 + x, 28); };
  const dark = run(0), loud = run(1);
  assert.ok(Math.abs(dark(4) - CHRONO_RATE) / CHRONO_RATE < 0.01, `index 4, dark, one second: ${dark(4)} should be about ${CHRONO_RATE.toFixed(0)} (628319 units per 2.8 s)`);
  assert.strictEqual(loud(4), 0, 'index 4 stands still when the band is full');
  assert.strictEqual(dark(0), 0, 'index 0 does not move in silence');
  assert.ok(loud(0) > CHRONO_RATE, 'index 0 runs with intensity');
  assert.ok(loud(6) > 2 ** 31, 'index 6 runs backwards when light: a negative count wraps as a uint');
});

test('filtered bands: sixteen levels, the most smoothed at x = 0', async () => {
  const { createSignalTexture } = await import(at('gl', 'signal-texture.js'));
  const t = createSignalTexture(); let d;
  for (let i = 0; i < 6; i++) d = t.update(frame({ bands: [0, 1, 0, 0, 0] }), 1 / 60, 1e6);
  const lv = Array.from({ length: 16 }, (_, x) => at4(d, x, 28)[0]);
  for (let x = 1; x < 16; x++) assert.ok(lv[x] > lv[x - 1], `level ${x} should have risen further than level ${x - 1}`);
  assert.ok(lv[0] < 0.1 && lv[15] > 0.9);
});

test('the score rows: notes newest-first with age, drums by lane, chroma by pitch class', async () => {
  const { createSignalTexture } = await import(at('gl', 'signal-texture.js'));
  const t = createSignalTexture();
  t.noteOn({ track: 'Lead', kind: 'note', pitch: 66, vel: 0.6 });
  t.noteOn({ track: 'Bass', kind: 'note', pitch: 36, vel: 0.9 });
  t.noteOn({ track: 'Kit', kind: 'drum', lane: 'snare', vel: 0.7 });
  t.noteOn({ track: 'Kit', kind: 'drum', lane: 'hat', vel: 0.4 });
  t.noteOn({ track: 'Kit', kind: 'drum', lane: 'cowbell', vel: 0.5 });
  let d; for (let i = 0; i < 30; i++) d = t.update(frame({ tracks: { Lead: 0.3, Bass: 0.7 } }), 1 / 60, 1e6);
  const n0 = at4(d, 0, 34), n1 = at4(d, 1, 34);
  assert.ok(Math.abs(n0[0] - 0) < 1e-6 && Math.abs(n0[1] - 0.9) < 1e-6 && n0[3] === 1, 'newest note: Bass, pitch 36 -> 0, track 1');
  assert.ok(Math.abs(n1[0] - 0.5) < 1e-6 && n1[3] === 0, 'then Lead, pitch 66 -> 0.5, track 0');
  assert.ok(Math.abs(n0[2] - 0.5) < 0.01, `age counts up in seconds: ${n0[2]}`);
  assert.ok(at4(d, 2, 34)[2] > 1000, 'an empty slot reads as long ago, not as "now"');
  assert.ok(at4(d, 1, 33)[0] > 0 && at4(d, 1, 33)[0] < 0.7 && at4(d, 1, 33)[3] === 1, 'snare is lane 1, its envelope decaying');
  assert.ok(at4(d, 3, 33)[3] === 1 && at4(d, 5, 33)[3] === 1 && at4(d, 0, 33)[3] === 0, 'hat is lane 3, an unknown lane is 5, no kick');
  assert.ok(at4(d, 6, 36)[3] === 1 && at4(d, 0, 36)[3] === 1, 'pitch classes: 66 is F#, 36 is C');
  assert.ok(Math.abs(at4(d, 1, 35)[0] - 0.7) < 1e-6 && Math.abs(at4(d, 0, 35)[1] - 0.5) < 1e-6, 'track row: level and last pitch');
  assert.deepStrictEqual(at4(d, 0, 32).map((v) => +v.toFixed(3)), [0.25, 0.5, 120, 1], 'transport');
});

test('a section change is counted, and silence empties the bands', async () => {
  const { createSignalTexture } = await import(at('gl', 'signal-texture.js'));
  const t = createSignalTexture();
  t.update(frame({ slot: 'A' }), 1 / 60, 1e6); t.update(frame({ slot: 'B' }), 1 / 60, 1e6 + 16);
  let d = t.update(frame({ slot: 'B' }), 1 / 60, 1e6 + 2016);
  assert.strictEqual(at4(d, 1, 32)[2], 1);
  assert.ok(Math.abs(at4(d, 1, 32)[3] - 2) < 0.01);
  d = t.update(null, 1 / 60, 1e6 + 3000);
  assert.strictEqual(at4(d, 0, 0)[0], 0);
  assert.strictEqual(at4(d, 0, 32)[3], 0, 'not playing');
});

test('theme colours land on row 23', async () => {
  const { createSignalTexture } = await import(at('gl', 'signal-texture.js'));
  const { themeFrom } = await import(at('gl', 'runtime.js'));
  const t = createSignalTexture(); t.setTheme(themeFrom(0, 90));
  const d = t.update(frame(), 1 / 60, 1e6);
  const cols = [0, 1, 2, 3].map((x) => at4(d, x, 23));
  for (const c of cols) { assert.strictEqual(c[3], 1); assert.ok(c.slice(0, 3).every((v) => v >= 0 && v <= 1)); }
  assert.notDeepStrictEqual(cols[0], cols[2]);
});

test('every sim in the deck is well-formed: knobs, a patch the router accepts, passes that fit its buffers', async () => {
  const { SIMS, byId } = await import(at('gl', 'sims', 'index.js'));
  const { defineParams } = await import(at('params', 'define.js'));
  const { createRouter } = await import(at('signal', 'router.js'));
  assert.ok(SIMS.length >= 6);
  assert.strictEqual(new Set(SIMS.map((s) => s.id)).size, SIMS.length, 'ids are unique');
  for (const s of SIMS) {
    assert.strictEqual(byId(s.id), s);
    assert.ok(s.title && s.about, `${s.id}: says what it is and where it comes from`);
    const store = defineParams(s.schema);
    for (const k of ['hue', 'spread', 'gain']) assert.ok(k in s.schema, `${s.id}: shares the colour knob "${k}"`);
    createRouter({ store, apply() {}, trigger() {}, patch: s.patch });           // throws on a route to a knob that is not there
    assert.ok(/vec4\s+pass\s*\(\s*vec2\s+uv\s*\)/.test(s.draw), `${s.id}: draw defines pass(uv)`);
    for (const p of s.passes || []) {
      assert.ok(s.buffers && s.buffers[p.target], `${s.id}: pass writes to a declared buffer (${p.target})`);
      assert.ok(/vec4\s+pass\s*\(\s*vec2\s+uv\s*\)/.test(p.src), `${s.id}: pass defines pass(uv)`);
    }
    for (const name of Object.keys(s.init || {})) assert.ok(s.buffers[name], `${s.id}: init names a declared buffer`);
    // a knob the shaders never read is a dead control
    const glsl = [s.common || '', s.draw, ...(s.passes || []).map((p) => p.src)].join('\n'), js = String(s.uniforms || '') + String(s.actions || '') + (s.passes || []).map((p) => String(p.iterations || '')).join('');
    for (const k of Object.keys(s.schema)) if (!['hue', 'spread'].includes(k)) assert.ok(glsl.includes(`u_${k}`) || js.includes(`'${k}'`), `${s.id}: knob "${k}" is used`);
    if (s.actions) {
      const calls = [], trig = s.actions({ splat: (x) => calls.push(x), reset() {}, value: (k) => store.get(k), set: (k, v) => store.set(k, v), aspect: () => 16 / 9 });
      for (const t of s.patch.triggers || []) trig(t.action, 0.8, { track: 'Lead', pitch: 0.5 });
      for (const c of calls) assert.ok(c.x >= -0.2 && c.x <= 1.2 && c.y >= -0.2 && c.y <= 1.2 && c.r > 0, `${s.id}: a splat lands on the stage`);
    }
  }
});

(async () => {
  let failed = 0;
  for (const c of cases) {
    try { await c.fn(); console.log(`PASS  ${c.name}`); }
    catch (err) { failed++; console.log(`FAIL  ${c.name}\n      ${err && err.message}`); }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
  console.log('\ntests/gl.js passed.');
})();
