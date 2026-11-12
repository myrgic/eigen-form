#!/usr/bin/env node
/* =====================================================================
   tests/signal.js — unit tests for src/signal/router.js and
   src/signal/sources.js.

   Same plain-script idiom as tests/params.js: no framework, PASS/FAIL
   per case, process.exit(1) on any failure, dynamic import() because
   the modules under test are ES modules.

   Usage:
     node tests/signal.js
   ===================================================================== */
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const at = (...p) => pathToFileURL(path.join(__dirname, '..', 'src', ...p)).href;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

const SCHEMA = {
  width:  { type: 'number', min: 0, max: 100, step: 1, default: 20, group: 'g', label: 'width' },
  period: { type: 'number', min: 500, max: 30000, step: 100, unit: 'ms', default: 3000, group: 'g', label: 'period', scale: 'log' },
  p:      { type: 'number', min: 1, max: 7, step: 1, default: 2, group: 'g', label: 'p' },
  q:      { type: 'number', min: 1, max: 7, step: 1, default: 3, group: 'g', label: 'q' },
  mode:   { type: 'select', options: ['a', 'b'], default: 'a', group: 'g', label: 'mode' },
  fixed:  { type: 'number', min: 0, max: 1, step: 0.1, default: 0.5, prereg: 0.5, group: 'g', label: 'fixed' }
};
const frame = (o = {}) => ({ playing: true, bpm: 120, slot: 'A', beatPhase: 0, barPhase: 0, rms: 0, peak: 0, bands: [0, 0, 0, 0, 0], onset: false, kick: false, ...o });

async function setup(patch) {
  const { defineParams } = await import(at('params', 'define.js'));
  const { createRouter } = await import(at('signal', 'router.js'));
  const store = defineParams(SCHEMA);
  const applied = [];
  const router = createRouter({ store, apply: (k, v) => applied.push([k, v]), patch });
  return { store, router, applied, last: (k) => { const a = applied.filter((x) => x[0] === k).at(-1); return a ? a[1] : undefined; } };
}

test('a route rides on the knob: base + amount x source, in slider space', async () => {
  const { router, last, store } = await setup({ routes: [{ source: 'band.bass', target: 'width', amount: 0.5 }] });
  router.frame(frame({ bands: [0, 1, 0, 0, 0] }));
  router.tick(1000);
  assert.strictEqual(last('width'), 70);                     // 20 + 0.5 * 100
  assert.strictEqual(store.get('width'), 20);                // the store is never written by a route
  store.set('width', 40); router.tick(1016);
  assert.strictEqual(last('width'), 90);                     // moving the knob moves the base under the route
});

test('the result clamps to the declared range and snaps to the step', async () => {
  const { router, last, store } = await setup({ routes: [{ source: 'rms', target: 'width', amount: 1 }, { source: 'rms', target: 'p', amount: 0.3 }] });
  store.set('width', 90);
  router.frame(frame({ rms: 0.8 })); router.tick(0);
  assert.strictEqual(last('width'), 100);
  assert.ok(Number.isInteger(last('p')), `p should be an integer, got ${last('p')}`);
});

test('a drum hit fires at its moment, not when it arrives', async () => {
  const { router, last } = await setup({ routes: [{ source: 'hit.kick', target: 'width', amount: 0.5, release: 200 }] });
  router.frame(frame());
  router.notes([{ track: 'Kit', kind: 'drum', lane: 'kick', vel: 1, at: 1100 }]);
  router.tick(1000);
  assert.strictEqual(last('width'), 20, 'scheduled 100 ms ahead: nothing yet');
  router.tick(1090);
  assert.strictEqual(last('width'), 20);
  router.tick(1104);
  assert.strictEqual(last('width'), 70, 'attack 0: full on the first tick at or after `at`');
  router.tick(1304);                                         // one release time-constant later
  const v = last('width');
  assert.ok(v > 35 && v < 42, `after 200 ms of a 200 ms release it should be near 20 + 50/e = 38.4, got ${v}`);
  for (let t = 1320; t < 4000; t += 16) router.tick(t);
  assert.strictEqual(last('width'), 20, 'and it comes all the way home');
});

test('offsetMs shifts when notes fire', async () => {
  const { router, last } = await setup({ offsetMs: -50, routes: [{ source: 'hit.snare', target: 'width', amount: 0.5 }] });
  router.frame(frame());
  router.notes([{ track: 'Kit', kind: 'drum', lane: 'snare', vel: 1, at: 2000 }]);
  router.tick(1940); assert.strictEqual(last('width'), 20);
  router.tick(1951); assert.strictEqual(last('width'), 70, '50 ms early');
});

test('stale notes are dropped, not replayed as a burst', async () => {
  const { router, last } = await setup({ routes: [{ source: 'hit.any', target: 'width', amount: 0.5 }] });
  router.frame(frame());
  router.notes([{ track: 'Kit', kind: 'drum', lane: 'kick', vel: 1, at: 100 }, { track: 'Kit', kind: 'drum', lane: 'kick', vel: 1, at: 200 }]);
  router.tick(5000);
  assert.strictEqual(last('width'), 20);
  assert.strictEqual(router.queued, 0);
});

test('velocity scales the impulse; pitch is held', async () => {
  const { router, last } = await setup({ routes: [{ source: 'note.Lead', target: 'width', amount: 1 }, { source: 'pitch.Lead', target: 'period', amount: 0.5 }] });
  router.frame(frame());
  router.notes([{ track: 'Lead', kind: 'note', pitch: 66, vel: 0.5, at: 10 }]);
  router.tick(10);
  assert.strictEqual(last('width'), 70);                     // 20 + 1 * 0.5 * 100
  const held = last('period');
  router.tick(500); router.tick(900);
  assert.strictEqual(last('period'), held, 'pitch stays until the next note');
  assert.ok(held > 3000, 'pitch 66 is halfway up 36..96 and pushed the period up');
});

test('with no notes arriving, the frame\'s own kick detector stands in', async () => {
  const { router, last } = await setup({ routes: [{ source: 'hit.kick', target: 'width', amount: 0.5 }] });
  router.frame(frame({ kick: true })); router.tick(10000);
  assert.strictEqual(last('width'), 70);
  // ...but once the score is flowing, the detector is ignored (no double hits)
  const b = await setup({ routes: [{ source: 'hit.kick', target: 'width', amount: 0.5 }] });
  b.router.frame(frame());
  b.router.notes([{ track: 'Kit', kind: 'drum', lane: 'snare', vel: 1, at: 100 }]);
  b.router.tick(100);
  b.router.frame(frame({ kick: true })); b.router.tick(116);
  assert.strictEqual(b.last('width'), 20);
});

test('a sync pins a time knob to bars at the current tempo, and lets go without one', async () => {
  const { router, last, store } = await setup({ syncs: [{ target: 'period', bars: 2 }] });
  router.frame(frame({ bpm: 120 })); router.tick(0);
  assert.strictEqual(last('period'), 4000);                  // 2 bars at 120 bpm
  router.frame(frame({ bpm: 150 })); router.tick(16);
  assert.strictEqual(last('period'), 3200);
  router.frame(frame({ playing: false })); router.tick(32);
  assert.strictEqual(last('period'), store.get('period'), 'stopped: back to the knob');
});

test('a route rides on top of a sync', async () => {
  const { router, last } = await setup({ syncs: [{ target: 'period', bars: 2 }], routes: [{ source: 'rms', target: 'period', amount: 0.2 }] });
  router.frame(frame({ bpm: 120, rms: 1 })); router.tick(0);
  assert.ok(last('period') > 4000);
});

test('a step advances on a section change and writes the store', async () => {
  const { router, store } = await setup({ steps: [{ on: 'section', targets: ['p', 'q'], values: [[2, 3], [3, 4], [2, 5]] }] });
  router.frame(frame({ slot: 'A' })); router.tick(0);
  assert.deepStrictEqual([store.get('p'), store.get('q')], [2, 3], 'the first frame is not a change');
  router.frame(frame({ slot: 'B' })); router.tick(16);
  assert.deepStrictEqual([store.get('p'), store.get('q')], [3, 4]);
  router.frame(frame({ slot: 'B' })); router.tick(32);
  assert.deepStrictEqual([store.get('p'), store.get('q')], [3, 4], 'no change, no step');
  router.frame(frame({ slot: 'B', marker: 'Chorus' })); router.tick(48);
  assert.deepStrictEqual([store.get('p'), store.get('q')], [2, 5], 'a marker change is a section too');
});

test('a step can count bars: every 2nd bar', async () => {
  const { router, store } = await setup({ steps: [{ on: 'bar', every: 2, targets: ['p'], values: [[2], [5]] }] });
  let t = 0; const bar = () => { router.frame(frame({ barPhase: 0.9 })); router.tick(t += 16); router.frame(frame({ barPhase: 0.02 })); router.tick(t += 16); };
  bar(); assert.strictEqual(store.get('p'), 2);
  bar(); assert.strictEqual(store.get('p'), 5);
});

test('dropping a route puts the knob back where the performer left it', async () => {
  const { router, last, store } = await setup({ routes: [{ source: 'rms', target: 'width', amount: 0.5 }] });
  router.frame(frame({ rms: 1 })); router.tick(0);
  assert.strictEqual(last('width'), 70);
  router.setPatch({ routes: [] });
  assert.strictEqual(last('width'), store.get('width'));
  assert.strictEqual(router.drives('width'), false);
});

test('a patch that cannot work is refused when it is set, not at 60 Hz', async () => {
  const { router } = await setup();
  assert.throws(() => router.setPatch({ routes: [{ source: 'rms', target: 'nope', amount: 1 }] }), /unknown param/);
  assert.throws(() => router.setPatch({ routes: [{ source: 'rms', target: 'mode', amount: 1 }] }), /use a step/);
  assert.throws(() => router.setPatch({ routes: [{ source: 'rms', target: 'fixed', amount: 1 }] }), /preregistered/);
  assert.throws(() => router.setPatch({ routes: [{ source: 'rms', target: 'width', amount: 1, curve: 'cubic' }] }), /unknown curve/);
  assert.throws(() => router.setPatch({ steps: [{ targets: ['p', 'q'], values: [[1]] }] }), /one entry per target/);
});

test('a trigger hands the simulation the event: when, how hard, and which note', async () => {
  const { defineParams } = await import(at('params', 'define.js'));
  const { createRouter } = await import(at('signal', 'router.js'));
  const fired = [];
  const router = createRouter({ store: defineParams(SCHEMA), apply: () => {}, trigger: (action, strength, meta) => fired.push([action, strength, meta]),
    patch: { triggers: [{ on: 'hit.kick', action: 'pulse', amount: 0.5 }, { on: 'note.any', action: 'seed' }, { on: 'hit.snare', action: 'scatter', every: 2 }, { on: 'section', action: 'respawn' }] } });
  router.frame(frame());
  router.notes([{ track: 'Kit', kind: 'drum', lane: 'kick', vel: 0.8, at: 100 }, { track: 'Lead', kind: 'note', pitch: 66, vel: 0.6, at: 100 }, { track: 'Kit', kind: 'drum', lane: 'snare', vel: 1, at: 100 }, { track: 'Kit', kind: 'drum', lane: 'snare', vel: 1, at: 200 }]);
  router.tick(50);
  assert.strictEqual(fired.length, 0, 'nothing before its moment');
  router.tick(100);
  assert.deepStrictEqual(fired.map((f) => f[0]), ['pulse', 'seed'], 'kick and note fire; the first snare is skipped by every: 2');
  assert.ok(Math.abs(fired[0][1] - 0.4) < 1e-9, 'strength = velocity x amount');
  assert.deepStrictEqual(fired[0][2], { track: 'Kit', lane: 'kick' });
  assert.deepStrictEqual(fired[1][2], { track: 'Lead', pitch: 0.5 });
  router.tick(116);
  assert.strictEqual(fired.length, 2, 'an impulse lasts one tick');
  router.tick(200);
  assert.strictEqual(fired.at(-1)[0], 'scatter', 'the second snare fires');
  router.frame(frame({ slot: 'B' })); router.tick(216);
  assert.strictEqual(fired.at(-1)[0], 'respawn', 'a section change is an impulse too');
  assert.throws(() => router.setPatch({ triggers: [{ on: 'hit.kick' }] }), /needs on and action/);
});

test('serialize round-trips a patch', async () => {
  const patch = { offsetMs: 12, routes: [{ source: 'hit.kick', target: 'width', amount: 0.4, attack: 0, release: 180, curve: 'sq', on: true }], syncs: [{ target: 'period', bars: 2, sign: 1, on: true }], steps: [{ on: 'section', every: 1, targets: ['p', 'q'], values: [[2, 3], [3, 4]], enabled: true }], triggers: [{ on: 'hit.kick', action: 'pulse', amount: 0.8, every: 1, enabled: true }] };
  const { router } = await setup(patch);
  assert.deepStrictEqual(router.serialize(), patch);
});

test('the demo loop is a pure function of time, and its notes agree with its frames', async () => {
  const { demoAt, demoNotes, demoStep } = await import(at('signal', 'sources.js'));
  assert.deepStrictEqual(demoAt(12345, 124), demoAt(12345, 124));
  const bpm = 120, barMs = 2000;
  assert.strictEqual(demoAt(0, bpm).kick, true);
  assert.strictEqual(demoAt(250, bpm).kick, false);
  assert.strictEqual(demoAt(barMs * 4, bpm).slot, 'B');
  assert.strictEqual(demoAt(barMs * 8 + 10, bpm).kick, false, 'section C is the breakdown: no kick');
  assert.ok(Math.abs(demoAt(barMs * 1.5, bpm).barPhase - 0.5) < 0.002);
  const ns = demoNotes(0, barMs, bpm, 1_000_000);
  assert.deepStrictEqual(ns.filter((n) => n.lane === 'kick').map((n) => n.at - 1_000_000), [0, 500, 1000, 1500]);
  // windows tile: no note lost or doubled across a boundary
  const whole = demoNotes(0, 8000, bpm).length;
  let parts = 0; for (let t = 0; t < 8000; t += 37) parts += demoNotes(t, Math.min(8000, t + 37), bpm).length;
  assert.strictEqual(parts, whole);
  assert.ok(demoStep(4).some((n) => n.lane === 'kick'));
});

test('demoSource schedules ahead and feeds a router end to end', async () => {
  const { demoSource } = await import(at('signal', 'sources.js'));
  const { router, last } = await setup({ routes: [{ source: 'hit.kick', target: 'width', amount: 0.5, release: 100 }] });
  let clock = 1_000_000; let fn = null;
  const src = demoSource({ bpm: 120, onFrame: router.frame, onNotes: router.notes, now: () => clock, setIntervalImpl: (f) => { fn = f; return 1; }, clearIntervalImpl: () => {} });
  const seen = [];
  for (let i = 0; i < 125; i++) { fn(); router.tick(clock); seen.push(last('width')); clock += 16; }   // 2 s = one bar
  const peaks = seen.filter((v, i) => v === 70 && seen[i - 1] !== 70).length;
  assert.strictEqual(peaks, 4, `four kicks in a bar should give four full pulses, got ${peaks}`);
  src.stop();
});

test('until.<event> rises into the event and is zero when nothing is known', async () => {
  const { router, last } = await setup({ routes: [{ source: 'until.hit.kick', target: 'width', amount: 0.5, lead: 1000 }] });
  router.frame(frame());
  router.tick(0); assert.strictEqual(last('width'), 20, 'no schedule: the source reads zero and the knob sits where it was left');
  router.ahead({ until: 60000, notes: [{ track: 'Kit', kind: 'drum', lane: 'snare', vel: 1, at: 500 }, { track: 'Kit', kind: 'drum', lane: 'kick', vel: 1, at: 3000 }] });
  router.tick(1900); assert.strictEqual(last('width'), 20, 'more than the lead away: still zero (and the snare is not a kick)');
  router.tick(2500); assert.strictEqual(last('width'), 45, 'halfway through the lead: half the amount');
  router.tick(2999); assert.ok(last('width') > 69, 'full at the moment');
  router.tick(3016); assert.strictEqual(last('width'), 20, 'past it with nothing else scheduled: back to zero');
});

test('a lead acts before the event, once, and falls back to acting on time when the future is not known', async () => {
  const mk = () => setup({ routes: [{ source: 'hit.kick', target: 'width', amount: 0.5, lead: 300 }] });
  const kick = { track: 'Kit', kind: 'drum', lane: 'kick', vel: 1, at: 2000 };
  // known: fires 300 ms early, and NOT again when the note itself comes due
  const a = await mk(); a.router.frame(frame()); a.router.tick(1000);
  a.router.ahead({ until: 10000, notes: [kick] }); a.router.notes([kick]);
  a.router.tick(1690); assert.strictEqual(a.last('width'), 20);
  a.router.tick(1705); assert.strictEqual(a.last('width'), 70, 'acted 295 ms before the kick');
  a.router.tick(1720); assert.strictEqual(a.last('width'), 20);
  a.router.tick(2001); assert.strictEqual(a.last('width'), 20, 'the kick itself does not fire the leading route a second time');
  // not known that far: acts when it happens
  const b = await mk(); b.router.frame(frame()); b.router.tick(1000);
  b.router.ahead({ until: 1900, notes: [kick] }); b.router.notes([kick]);
  b.router.tick(1705); assert.strictEqual(b.last('width'), 20, 'the schedule ends before the kick: no early action');
  b.router.tick(2001); assert.strictEqual(b.last('width'), 70, 'so it reacts, as it always did');
  // a level cannot be known ahead: a lead on it is ignored, not turned into silence
  const c = await setup({ routes: [{ source: 'band.bass', target: 'width', amount: 0.5, lead: 300 }] });
  c.router.ahead({ until: 1e9, notes: [] }); c.router.frame(frame({ bands: [0, 1, 0, 0, 0] })); c.router.tick(0); c.router.tick(16);
  assert.strictEqual(c.last('width'), 70);
});

test('leadBars follows the tempo, and a trigger gets the note behind an early event', async () => {
  const { defineParams } = await import(at('params', 'define.js'));
  const { createRouter } = await import(at('signal', 'router.js'));
  const fired = [];
  const router = createRouter({ store: defineParams(SCHEMA), apply() {}, trigger: (action, v, meta) => fired.push([action, v, meta]), patch: { triggers: [{ on: 'note.Lead', action: 'seed', leadBars: 1 }, { on: 'section', action: 'bloom', leadBars: 1 }] } });
  router.frame(frame({ bpm: 120 })); router.tick(0);                                  // one bar = 2000 ms
  router.ahead({ until: 60000, notes: [{ track: 'Lead', kind: 'note', pitch: 66, vel: 0.5, at: 5000 }], sections: [{ at: 8000, index: 3, name: 'D' }] });
  router.tick(2990); assert.strictEqual(fired.length, 0);
  router.tick(3005); assert.deepStrictEqual(fired[0], ['seed', 0.5, { track: 'Lead', lane: undefined, pitch: 0.5 }]);
  router.tick(6005); assert.deepStrictEqual(fired[1], ['bloom', 1, { index: 3, name: 'D' }], 'a section change one bar out, with where the song is going');
  assert.strictEqual(fired.length, 2);
  assert.ok(router.knownAheadMs > 50000);
});

test('a section step goes where the song is going: early with a lead, and to the right entry from anywhere', async () => {
  const { router, store } = await setup({ steps: [{ on: 'section', leadBars: 1, targets: ['p', 'q'], values: [[1, 2], [2, 3], [3, 4], [4, 5]] }] });
  router.frame(frame({ bpm: 120, slot: 'C' })); router.tick(0);
  router.ahead({ until: 60000, section: { index: 2 }, sections: [{ at: 10000, index: 3 }, { at: 20000, index: 0 }] });
  assert.deepStrictEqual([store.get('p'), store.get('q')], [3, 4], 'starting in the third section selects the third entry at once');
  router.tick(7990); assert.deepStrictEqual([store.get('p'), store.get('q')], [3, 4]);
  router.tick(8005); assert.deepStrictEqual([store.get('p'), store.get('q')], [4, 5], 'one bar before the boundary the knobs are already the next section\'s');
  // the boundary arrives: the source re-sends the schedule, the frame reports the new slot. Nothing moves twice.
  router.ahead({ until: 70000, section: { index: 3 }, sections: [{ at: 20000, index: 0 }] });
  router.frame(frame({ bpm: 120, slot: 'D' })); router.tick(10005);
  assert.deepStrictEqual([store.get('p'), store.get('q')], [4, 5]);
  router.tick(18005); assert.deepStrictEqual([store.get('p'), store.get('q')], [1, 2], 'and round to the first');
  // the future is withdrawn (paused, or a live source): the step counts again, on time
  const b = await setup({ steps: [{ on: 'section', leadBars: 1, targets: ['p'], values: [[1], [2], [3]] }] });
  b.router.frame(frame({ slot: 'A' })); b.router.tick(0); b.router.frame(frame({ slot: 'B' })); b.router.tick(16);
  assert.strictEqual(b.store.get('p'), 2, 'no schedule at all: the old behaviour');
});

test('with a schedule a section change is read from it even with no lead, including the section just starting', async () => {
  const { defineParams } = await import(at('params', 'define.js'));
  const { createRouter } = await import(at('signal', 'router.js'));
  const fired = [];
  const router = createRouter({ store: defineParams(SCHEMA), apply() {}, trigger: (action, v, meta) => fired.push([action, meta.index]), patch: { triggers: [{ on: 'section', action: 'bloom' }] } });
  router.frame({ playing: true, bpm: 120, slot: 0 }); router.tick(1000);
  router.ahead({ section: { index: 2, name: 'C', at: 1100 }, sections: [{ at: 3100, index: 3, name: 'D' }], notes: [], until: 9000 });
  router.tick(1050); assert.deepStrictEqual(fired, [], 'published before it is heard: nothing yet');
  router.tick(1110); assert.deepStrictEqual(fired, [['bloom', 2]], 'the section that was about to start');
  router.frame({ playing: true, bpm: 120, slot: 5 }); router.tick(1500); assert.strictEqual(fired.length, 1, 'the slot changing in a frame adds nothing: the schedule is the authority');
  router.tick(3090); router.tick(3105); assert.deepStrictEqual(fired[1], ['bloom', 3]);
  router.ahead({ section: { index: 3, name: 'D', at: 3100 }, sections: [], notes: [], until: 9000 });
  router.tick(3120); assert.strictEqual(fired.length, 2, 're-sending a start that has passed does not fire it again');
});

test('leads survive a save and reload of the patch, and are absent when not set', async () => {
  const { router } = await setup({ routes: [{ source: 'until.section', target: 'width', amount: 0.3, leadBars: 2 }, { source: 'rms', target: 'width', amount: 0.1 }], triggers: [{ on: 'hit.kick', action: 'x', lead: 120 }], steps: [{ on: 'section', leadBars: 1, targets: ['p'], values: [[1], [2]] }] });
  const out = router.serialize();
  assert.strictEqual(out.routes[0].leadBars, 2); assert.ok(!('lead' in out.routes[1]) && !('leadBars' in out.routes[1]));
  assert.strictEqual(out.triggers[0].lead, 120); assert.strictEqual(out.steps[0].leadBars, 1);
});

test('the schedule ahead: notes and section changes at their times, far enough, honouring a queued jump', async () => {
  const { scheduleAhead } = await import(at('signal', 'embedded.js'));
  const project = { bpm: 120, tracks: [{ id: 'k', name: 'Kit' }, { id: 'l', name: 'Lead' }],
    slots: [{ name: 'A', bars: 1, patterns: { k: { steps: { kick: [1, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } }, l: { notes: [{ start: 1.5, pitch: 60, vel: 0.7 }, { start: 9, pitch: 61, vel: 0.7 }] } } },
            { name: 'B', bars: 2, patterns: { k: { steps: { snare: [0, 0, 0, 0, 1] } } } }] };
  const a = scheduleAhead(project, [0, 1], 0, 100000, 7000);
  assert.deepStrictEqual(a.section, { index: 0, name: 'A', at: 100000 });
  assert.deepStrictEqual(a.notes.filter((n) => n.lane === 'kick').map((n) => [n.at - 100000, n.vel]).slice(0, 4), [[0, 1], [500, 0.5], [1000, 1], [1500, 1]]);
  assert.deepStrictEqual(a.notes.filter((n) => n.kind === 'note').map((n) => n.at - 100000)[0], 750, 'a note at beat 1.5 is 750 ms in at 120 bpm');
  assert.ok(!a.notes.some((n) => n.pitch === 61 && n.at < 106000), 'a note past the end of a one-bar slot is not played in that pass');
  assert.deepStrictEqual(a.sections.slice(0, 3).map((s) => [s.at - 100000, s.index, s.name]), [[2000, 1, 'B'], [6000, 0, 'A'], [8000, 1, 'B']], 'A is one bar, B is two, then round again');
  assert.ok(a.until - 100000 >= 7000, 'it reaches at least the horizon');
  assert.ok(a.notes.some((n) => n.lane === 'snare' && n.at === 102500), 'the next section\'s notes are in it');
  const j = scheduleAhead(project, [0, 1], 0, 100000, 3000, 0);
  assert.deepStrictEqual(j.sections[0], { at: 102000, index: 0, name: 'A' }, 'a queued jump changes what comes next');
  for (let i = 1; i < a.notes.length; i++) assert.ok(a.notes[i].at >= a.notes[i - 1].at, 'sorted by time');
});

test('the song driver walks the sequence, wraps, and counts times round', async () => {
  const { createSongDriver, startIndex } = await import(at('signal', 'embedded.js'));
  const d = createSongDriver([0, 1, 1, 3]);
  assert.strictEqual(d.slot, 0); assert.strictEqual(d.queued(), 1);
  const played = [d.slot]; for (let i = 0; i < 8; i++) { d.crossed(); played.push(d.slot); }
  assert.deepStrictEqual(played, [0, 1, 1, 3, 0, 1, 1, 3, 0], 'a repeated section repeats, and after the last comes the first');
  assert.strictEqual(d.loops, 2);
  assert.strictEqual(d.crossed(), 1, 'crossed() answers with the slot to queue next');     // now at index 1, next is index 2 (slot 1)
  d.jumpTo(3); assert.strictEqual(d.queued(), 3); d.crossed(); assert.strictEqual(d.slot, 3, 'a jump lands at the next boundary');
  d.jumpTo(-1); d.crossed(); assert.strictEqual(d.index, 3, 'jumps wrap');
  const one = createSongDriver([5]); one.crossed(); assert.strictEqual(one.slot, 5, 'a one-section song just loops');
  assert.strictEqual(createSongDriver(undefined).slot, 0);
  const project = { song: [0, 1, 2, 6], slots: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, {}, {}, {}, { name: 'Drop' }] };
  assert.strictEqual(startIndex(project, 'c'), 2);
  assert.strictEqual(startIndex(project, 'drop'), 3);
  assert.strictEqual(startIndex(project, '3'), 3);
  assert.strictEqual(startIndex(project, 'zzz'), 0);
  assert.strictEqual(startIndex(project, null), 0);
});

test('oscineSource: hello, frames and notes reach the callbacks; a closed socket retries', async () => {
  const { oscineSource } = await import(at('signal', 'sources.js'));
  const socks = [];
  class FakeWS { constructor(url) { this.url = url; socks.push(this); } close() { this.onclose && this.onclose(); } }
  const got = { frames: 0, notes: 0, status: [] };
  const realSet = global.setTimeout; const timers = [];
  global.setTimeout = (f) => { timers.push(f); return timers.length; };
  try {
    const src = oscineSource({ WebSocketImpl: FakeWS, onFrame: () => got.frames++, onNotes: (n) => { got.notes += n.length; }, onStatus: (s) => got.status.push(s) });
    assert.ok(/ws:\/\/127\.0\.0\.1:7321\/signal\?hz=60/.test(socks[0].url));
    socks[0].onmessage({ data: JSON.stringify({ type: 'hello', server: 'oscine', app: true, project: 'Night Drive' }) });
    assert.strictEqual(src.connected, true);
    assert.strictEqual(src.project, 'Night Drive');
    socks[0].onmessage({ data: JSON.stringify({ type: 'frame', seq: 1 }) });
    socks[0].onmessage({ data: JSON.stringify({ type: 'notes', notes: [{}, {}] }) });
    socks[0].onmessage({ data: 'not json' });
    assert.deepStrictEqual([got.frames, got.notes], [1, 2]);
    socks[0].close();
    assert.strictEqual(src.connected, false);
    timers.shift()();
    assert.strictEqual(socks.length, 2, 'it dials again');
    assert.ok(socks[1].url.includes(':7321/'), 'same port after a real connection');
    socks[1].close(); timers.shift()();
    assert.ok(socks[2].url.includes(':7322/'), 'nothing answered: walk to the next port');
    src.stop(); const n = socks.length; while (timers.length) timers.shift()();
    assert.strictEqual(socks.length, n, 'stopped: no more dialing');
  } finally { global.setTimeout = realSet; }
});

(async () => {
  let failed = 0;
  for (const c of cases) {
    try { await c.fn(); console.log(`PASS  ${c.name}`); }
    catch (err) { failed++; console.log(`FAIL  ${c.name}\n      ${err && err.message}`); }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
  console.log('\ntests/signal.js passed.');
})();
