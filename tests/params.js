#!/usr/bin/env node
/* =====================================================================
   tests/params.js — unit tests for src/params/define.js.

   Plain-script idiom, matching tools/golden.js: no test framework, a
   small local runner, PASS/FAIL lines per case, process.exit(1) on any
   failure. dynamic import() (not require()) for the same reason
   golden.js uses it — src/params/define.js is an ES module.

   Usage:
     node tests/params.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const DEFINE_PATH = path.join(__dirname, '..', 'src', 'params', 'define.js');

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

// ---- validation: type + range per param type ----

test('number: in-range set succeeds and get() reflects it', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 10, default: 5 } });
  store.set('x', 7);
  assert.strictEqual(store.get('x'), 7);
});

test('number: out-of-range set throws, value unchanged', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 10, default: 5 } });
  assert.throws(() => store.set('x', 11), /out of range/);
  assert.strictEqual(store.get('x'), 5);
});

test('number: non-numeric set throws', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 10, default: 5 } });
  assert.throws(() => store.set('x', 'nope'), /must be a finite number/);
  assert.throws(() => store.set('x', NaN), /must be a finite number/);
});

test('angle: behaves like a ranged number', async ({ defineParams }) => {
  const store = defineParams({ a: { type: 'angle', min: 2, max: 90, unit: 'deg', default: 60 } });
  store.set('a', 45);
  assert.strictEqual(store.get('a'), 45);
  assert.throws(() => store.set('a', 91), /out of range/);
});

test('boolean: type-checked, rejects non-boolean', async ({ defineParams }) => {
  const store = defineParams({ show: { type: 'boolean', default: true } });
  store.set('show', false);
  assert.strictEqual(store.get('show'), false);
  assert.throws(() => store.set('show', 'true'), /must be a boolean/);
});

test('select: membership-checked against declared options', async ({ defineParams }) => {
  const store = defineParams({
    gradient: { type: 'select', options: ['spectrum', 'cogos', 'mono'], default: 'spectrum' }
  });
  store.set('gradient', 'cogos');
  assert.strictEqual(store.get('gradient'), 'cogos');
  assert.throws(() => store.set('gradient', 'not-a-preset'), /is not one of/);
});

test('unknown key: get() and set() both throw', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 1, default: 0 } });
  assert.throws(() => store.get('ghost'), /unknown key/);
  assert.throws(() => store.set('ghost', 1), /unknown key/);
});

test('defineParams: rejects a param with neither default nor prereg', async ({ defineParams }) => {
  assert.throws(() => defineParams({ x: { type: 'number', min: 0, max: 1 } }), /needs a "default"/);
});

// ---- locks (prereg) ----

test('locked: prereg key refuses set()', async ({ defineParams }) => {
  const store = defineParams({
    evaporation: { type: 'number', min: 0.9, max: 0.999, prereg: 0.97, default: 0.97 }
  });
  assert.ok(store.locked('evaporation'));
  assert.throws(() => store.set('evaporation', 0.95), /is locked by a prereg value/);
});

test('locked: get() always returns the prereg value, ignoring default', async ({ defineParams }) => {
  const store = defineParams({
    evaporation: { type: 'number', min: 0.9, max: 0.999, prereg: 0.981, default: 0.5 }
  });
  assert.strictEqual(store.get('evaporation'), 0.981);
});

test('unlocked: locked() reports false for a plain default-only param', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 1, default: 0.2 } });
  assert.strictEqual(store.locked('x'), false);
});

// ---- subscribe / unsubscribe ----

test('subscribe: fires with (key, value) on every successful set', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 10, default: 0 } });
  const seen = [];
  store.subscribe((k, v) => seen.push([k, v]));
  store.set('x', 3);
  store.set('x', 4);
  assert.deepStrictEqual(seen, [['x', 3], ['x', 4]]);
});

test('subscribe: does not fire on a rejected (out-of-range) set', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 10, default: 0 } });
  let count = 0;
  store.subscribe(() => { count += 1; });
  assert.throws(() => store.set('x', 999));
  assert.strictEqual(count, 0);
});

test('unsubscribe: stops further events, earlier events already delivered stand', async ({ defineParams }) => {
  const store = defineParams({ x: { type: 'number', min: 0, max: 10, default: 0 } });
  const seen = [];
  const unsubscribe = store.subscribe((k, v) => seen.push(v));
  store.set('x', 1);
  unsubscribe();
  store.set('x', 2);
  assert.deepStrictEqual(seen, [1]);
});

// ---- values() snapshot ----

test('values(): plain object with every current value, independent copy', async ({ defineParams }) => {
  const store = defineParams({
    x: { type: 'number', min: 0, max: 10, default: 1 },
    show: { type: 'boolean', default: true }
  });
  const snap = store.values();
  assert.deepStrictEqual(snap, { x: 1, show: true });
  snap.x = 999; // mutating the snapshot must not touch the store
  assert.strictEqual(store.get('x'), 1);
});

// ---- serialize / hydrate round trip ----

test('serialize/hydrate: round-trips values through a fresh store of the same schema', async ({ defineParams }) => {
  const schema = {
    x: { type: 'number', min: 0, max: 10, default: 1 },
    show: { type: 'boolean', default: true },
    g: { type: 'select', options: ['a', 'b'], default: 'a' }
  };
  const a = defineParams(schema);
  a.set('x', 7);
  a.set('show', false);
  a.set('g', 'b');
  const blob = a.serialize();
  assert.strictEqual(blob.schemaHash, a.schemaHash());

  const b = defineParams(schema);
  b.hydrate(blob);
  assert.deepStrictEqual(b.values(), a.values());
});

test('hydrate: skips locked keys even when present in the incoming values', async ({ defineParams }) => {
  const schema = {
    evaporation: { type: 'number', min: 0.9, max: 0.999, prereg: 0.97, default: 0.97 },
    x: { type: 'number', min: 0, max: 10, default: 0 }
  };
  const store = defineParams(schema);
  store.hydrate({ values: { evaporation: 0.91, x: 5 } });
  assert.strictEqual(store.get('evaporation'), 0.97); // untouched
  assert.strictEqual(store.get('x'), 5);
});

test('hydrate: throws on a schema-hash mismatch', async ({ defineParams }) => {
  const a = defineParams({ x: { type: 'number', min: 0, max: 10, default: 0 } });
  const b = defineParams({ x: { type: 'number', min: 0, max: 20, default: 0 } }); // different max -> different hash
  const blob = a.serialize();
  assert.throws(() => b.hydrate(blob), /schema hash/);
});

test('schemaHash: identical schemas hash identically, a changed field changes the hash', async ({ defineParams }) => {
  const a = defineParams({ x: { type: 'number', min: 0, max: 10, default: 0 } });
  const b = defineParams({ x: { type: 'number', min: 0, max: 10, default: 0 } });
  const c = defineParams({ x: { type: 'number', min: 0, max: 11, default: 0 } });
  assert.strictEqual(a.schemaHash(), b.schemaHash());
  assert.notStrictEqual(a.schemaHash(), c.schemaHash());
});

// ---- scale mapping helpers ----

test('scale linear: valueToSlider/sliderToValue are inverse and span 0..1', async ({ defineParams, scaleToValue, scaleFromValue }) => {
  const store = defineParams({ x: { type: 'number', min: 100, max: 300, default: 200 } });
  assert.strictEqual(store.valueToSlider('x', 100), 0);
  assert.strictEqual(store.valueToSlider('x', 300), 1);
  assert.ok(Math.abs(store.valueToSlider('x', 200) - 0.5) < 1e-9);
  assert.ok(Math.abs(store.sliderToValue('x', 0.5) - 200) < 1e-9);
});

test('scale log-complement: 0.9..0.999 decay case maps endpoints exactly', async ({ defineParams }) => {
  const store = defineParams({
    evaporation: { type: 'number', min: 0.9, max: 0.999, scale: 'log-complement', default: 0.99 }
  });
  const v0 = store.sliderToValue('evaporation', 0);
  const v1 = store.sliderToValue('evaporation', 1);
  assert.ok(Math.abs(v0 - 0.9) < 1e-9, `t=0 should map to min 0.9, got ${v0}`);
  assert.ok(Math.abs(v1 - 0.999) < 1e-9, `t=1 should map to max 0.999, got ${v1}`);
});

test('scale log-complement: gives more resolution near max than a linear scale would', async ({ defineParams }) => {
  const store = defineParams({
    evaporation: { type: 'number', min: 0.9, max: 0.999, scale: 'log-complement', default: 0.99 }
  });
  // The last 1% of slider travel (t=0.99..1.0) should cover much less
  // than 1% of the linear value span near the top end — that's the
  // whole point of the complement-log mapping for a decay constant.
  const near = store.sliderToValue('evaporation', 0.99);
  const linearSpan = 0.999 - 0.9;
  const distanceFromMax = 0.999 - near;
  assert.ok(distanceFromMax < linearSpan * 0.01, `expected tight clustering near max, got distance ${distanceFromMax}`);
});

test('scale log-complement: valueToSlider/sliderToValue round-trip numerically across the range', async ({ defineParams }) => {
  const store = defineParams({
    evaporation: { type: 'number', min: 0.9, max: 0.999, scale: 'log-complement', default: 0.99 }
  });
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const v = store.sliderToValue('evaporation', t);
    const t2 = store.valueToSlider('evaporation', v);
    assert.ok(Math.abs(t2 - t) < 1e-9, `round trip drifted at t=${t}: got t2=${t2}`);
  }
});

test('scale log: geometric midpoint maps to slider fraction 0.5', async ({ defineParams }) => {
  const store = defineParams({ f: { type: 'number', min: 20, max: 20000, scale: 'log', default: 1000 } });
  const mid = Math.sqrt(20 * 20000); // geometric mean
  const t = store.valueToSlider('f', mid);
  assert.ok(Math.abs(t - 0.5) < 1e-9, `geometric midpoint should sit at t=0.5, got ${t}`);
});

// ---- runner ----

async function main() {
  const mod = await import(pathToFileURL(DEFINE_PATH).href);
  const api = mod.default || mod;

  let failures = 0;
  for (const { name, fn } of cases) {
    try {
      await fn(api);
      console.log(`PASS  ${name}`);
    } catch (err) {
      failures += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${err && err.stack ? err.stack.split('\n').join('\n      ') : err}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} passed`);
  if (failures) {
    console.error(`\ntests/params.js FAILED (${failures} failing case(s))`);
    process.exit(1);
  }
  console.log('\ntests/params.js passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
