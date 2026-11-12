/* =====================================================================
   src/signal/router.js — the modulation router: music in, parameters out.

   A simulation declares its knobs as a schema (src/params/define.js).
   The store holds where the performer LEFT each knob. This module holds
   a patch — a list of routes from musical sources to those knobs — and
   every tick computes, per routed key:

       effective = base knob position  +  sum(route amount × source)

   in the store's own normalized slider space (0..1, scale-aware), then
   hands the resulting VALUE to `apply(key, value)`. The store is never
   written by a route: the panel keeps showing the performer's hand, the
   modulation rides on top of it, and removing a route puts the knob
   back exactly where it was left.

   NO DOM, NO SOCKETS, NO CLOCK. Frames and notes are pushed in
   (frame(), notes()), time is passed in (tick(nowMs)). Same split as
   the rest of the library: this file is pure state and arithmetic, so
   tests/signal.js drives it with synthetic music.

   The signal it consumes is Oscine's (ws://127.0.0.1:<port>/signal;
   see sources.js), but nothing here knows that: a frame is
   { playing, bpm, slot, marker, beatPhase, barPhase, rms, peak,
     bands:[sub,bass,lowmid,mid,high], onset, kick, tracks:{name:level} }
   and a note is { track, kind:'drum'|'note', lane?, pitch?, vel, at }
   with `at` in epoch milliseconds — the moment it is HEARD. Notes
   arrive ahead of time and wait in a queue until their moment.

   Sources (strings a route names):
     rms  peak                         master level, 0..1
     band.sub .bass .lowmid .mid .high band level, 0..1
     beat.phase  bar.phase             sawtooth 0..1 across a beat / bar
     beat.pulse  bar.pulse             1 at the top of a beat / bar, falling to 0 across it
     track.<name>                      that track's level, 0..1
     hit.<lane>                        impulse = velocity when that drum lane sounds (hit.kick, hit.snare, ...)
     hit.any                           any drum hit
     note.<track>                      impulse = velocity when that track plays a note
     note.any                          any pitched note
     pitch.<track>  pitch.any          last pitch played, 0..1 over MIDI 36..96 (held)
     onset                             impulse when the audio itself has an onset
   With no notes arriving (an audio-clip arrangement, a line input),
   hit.kick falls back to the frame's own kick detector and hit.any /
   note.any to its onset detector, so a patch still moves.

   A route:  { source, target, amount, attack, release, curve }
     amount   -1..1, in slider units: 1 sweeps the knob's whole travel
     attack   ms to rise toward the source  (0 = instant)
     release  ms to fall back               (0 = instant)
     curve    'lin' (default) | 'sq' (emphasise peaks) | 'sqrt' (lift quiet)
   An impulse lasts one tick; attack 0 + release 200 turns it into the
   familiar decaying hit envelope.

   A sync:   { target, bars }   pins a time-valued knob (ms) to a whole
             number of bars at the current tempo, as the base its routes
             then ride on. Released when the tempo is unknown.

   A step:   { on, every, targets:[key,...], values:[[...],...] }
             on 'section' (slot or marker changed), 'bar', 'beat' or any
             impulse source, advance through `values` and SET the store
             (a step is the performer's hand moved for them: the panel
             should show it).
   ===================================================================== */

const PITCH_LO = 36, PITCH_HI = 96;
const BAND_NAMES = ['sub', 'bass', 'lowmid', 'mid', 'high'];
const NOTE_FALLBACK_MS = 2500;   // no notes for this long -> lean on the frame's detectors

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const CURVES = {
  lin: (x) => x,
  sq: (x) => x * x,
  sqrt: (x) => Math.sqrt(x)
};

function follow(y, x, dt, attack, release) {
  const tau = x > y ? attack : release;
  if (!(tau > 0)) return x;
  return y + (x - y) * (1 - Math.exp(-dt / tau));
}

// Snap to the declared step so an integer knob never receives 2.37.
function quantize(def, v) {
  if (def.step && def.step > 0) {
    v = def.min + Math.round((v - def.min) / def.step) * def.step;
    // undo binary noise from the multiply (0.1 steps and the like)
    const decimals = (String(def.step).split('.')[1] || '').length;
    v = Number(v.toFixed(Math.min(decimals + 2, 10)));
  }
  return Math.min(def.max, Math.max(def.min, v));
}

function createRouter({ store, apply, patch } = {}) {
  if (!store || typeof store.get !== 'function') throw new Error('router: needs a params store');
  if (typeof apply !== 'function') throw new Error('router: needs apply(key, value)');

  let routes = [], syncs = [], steps = [];
  let offsetMs = 0;                     // + = act later (compensate a fast display), - = earlier

  let frame = null;
  let queue = [];                       // notes waiting for their moment, ascending by `at`
  let lastNoteSeen = -Infinity;
  let lastTick = null;
  let section = null;
  let prevBeatPhase = null, prevBarPhase = null;
  const pitches = new Map();            // track -> 0..1
  const applied = new Map();            // key -> last value handed to apply()
  let impulses = new Map();             // this tick only

  function validateRoute(r) {
    if (!r || typeof r.source !== 'string') throw new Error('router: a route needs a source');
    const def = store.schema[r.target];
    if (!def) throw new Error(`router: route targets unknown param "${r.target}"`);
    if (def.type !== 'number' && def.type !== 'angle') throw new Error(`router: "${r.target}" is ${def.type}; routes drive numbers (use a step for discrete values)`);
    if (store.locked(r.target)) throw new Error(`router: "${r.target}" is preregistered and cannot be modulated`);
    if (r.curve && !CURVES[r.curve]) throw new Error(`router: unknown curve "${r.curve}"`);
    return { source: r.source, target: r.target, amount: Number(r.amount) || 0, attack: Math.max(0, Number(r.attack) || 0), release: Math.max(0, Number(r.release) || 0), curve: r.curve || 'lin', y: 0, on: r.on !== false };
  }

  function setPatch(p = {}) {
    const nextRoutes = (p.routes || []).map(validateRoute);
    const nextSyncs = (p.syncs || []).map((s) => {
      if (!store.schema[s.target]) throw new Error(`router: sync targets unknown param "${s.target}"`);
      if (!(Number(s.bars) > 0)) throw new Error('router: a sync needs bars > 0');
      return { target: s.target, bars: Number(s.bars), sign: s.sign < 0 ? -1 : 1, on: s.on !== false };
    });
    const nextSteps = (p.steps || []).map((s) => {
      if (!Array.isArray(s.targets) || !Array.isArray(s.values) || !s.values.length) throw new Error('router: a step needs targets and values');
      for (const k of s.targets) if (!store.schema[k]) throw new Error(`router: step targets unknown param "${k}"`);
      for (const v of s.values) if (!Array.isArray(v) || v.length !== s.targets.length) throw new Error('router: each step value must give one entry per target');
      return { on: s.on || 'section', every: Math.max(1, Math.round(s.every || 1)), targets: [...s.targets], values: s.values.map((v) => [...v]), i: 0, count: 0, enabled: s.enabled !== false };
    });
    // every key a patch stops driving goes back to where the performer left it
    const before = new Set([...routes.map((r) => r.target), ...syncs.map((s) => s.target)]);
    routes = nextRoutes; syncs = nextSyncs; steps = nextSteps;
    if (Number.isFinite(p.offsetMs)) offsetMs = p.offsetMs;
    const after = new Set([...routes.map((r) => r.target), ...syncs.map((s) => s.target)]);
    for (const k of before) if (!after.has(k)) release(k);
  }

  function release(key) {
    if (!applied.has(key)) return;
    applied.delete(key);
    apply(key, store.get(key));
  }

  function serialize() {
    return {
      offsetMs,
      routes: routes.map(({ source, target, amount, attack, release: rel, curve, on }) => ({ source, target, amount, attack, release: rel, curve, on })),
      syncs: syncs.map(({ target, bars, sign, on }) => ({ target, bars, sign, on })),
      steps: steps.map(({ on, every, targets, values, enabled }) => ({ on, every, targets, values, enabled }))
    };
  }

  function pushFrame(f) {
    if (!f || typeof f !== 'object') return;
    frame = f;
  }

  function pushNotes(list) {
    if (!Array.isArray(list)) return;
    for (const n of list) {
      if (!n || !Number.isFinite(n.at)) continue;
      queue.push(n);
    }
    queue.sort((a, b) => a.at - b.at);
    if (queue.length > 4096) queue = queue.slice(-4096);
  }

  function bump(name, v) {
    if (!(v > (impulses.get(name) || 0))) return;
    impulses.set(name, v);
  }

  function fireDue(now) {
    const due = now - offsetMs;
    let i = 0;
    while (i < queue.length && queue[i].at <= due) {
      const n = queue[i++];
      // a note more than half a second stale (a stalled tab catching up) is dropped, not replayed as a burst
      if (due - n.at > 500) continue;
      const vel = clamp01(Number.isFinite(n.vel) ? n.vel : 1);
      lastNoteSeen = now;
      if (n.kind === 'drum') {
        bump('hit.' + n.lane, vel); bump('hit.any', vel);
      } else {
        bump('note.' + n.track, vel); bump('note.any', vel);
        if (Number.isFinite(n.pitch)) {
          const pv = clamp01((n.pitch - PITCH_LO) / (PITCH_HI - PITCH_LO));
          pitches.set(n.track, pv); pitches.set('*', pv);
        }
      }
    }
    if (i) queue = queue.slice(i);
  }

  function readSource(name) {
    const f = frame;
    if (name === 'rms') return f ? f.rms || 0 : 0;
    if (name === 'peak') return f ? f.peak || 0 : 0;
    if (name === 'beat.phase') return f && f.playing ? f.beatPhase || 0 : 0;
    if (name === 'bar.phase') return f && f.playing ? f.barPhase || 0 : 0;
    if (name === 'beat.pulse') return f && f.playing ? 1 - (f.beatPhase || 0) : 0;
    if (name === 'bar.pulse') return f && f.playing ? 1 - (f.barPhase || 0) : 0;
    if (name.startsWith('band.')) { const i = BAND_NAMES.indexOf(name.slice(5)); return f && f.bands && i >= 0 ? f.bands[i] || 0 : 0; }
    if (name.startsWith('track.')) return f && f.tracks ? f.tracks[name.slice(6)] || 0 : 0;
    if (name === 'pitch.any') return pitches.get('*') || 0;
    if (name.startsWith('pitch.')) return pitches.get(name.slice(6)) || 0;
    return impulses.get(name) || 0;     // hit.*, note.*, onset, section, bar, beat
  }

  function tick(now) {
    const dt = lastTick == null ? 16 : Math.min(250, Math.max(0, now - lastTick));
    lastTick = now;
    impulses = new Map();

    fireDue(now);

    const f = frame;
    const live = !!(f && f.playing);
    if (live) {
      if (f.onset) bump('onset', 1);
      // No score reaching us: let the audio stand in for it.
      if (now - lastNoteSeen > NOTE_FALLBACK_MS) {
        if (f.kick) { bump('hit.kick', 1); bump('hit.any', 1); }
        if (f.onset) { bump('note.any', 1); if (!f.kick) bump('hit.any', 0.6); }
      }
      // beat / bar edges from the phases wrapping
      if (prevBeatPhase != null && f.beatPhase < prevBeatPhase - 0.5) bump('beat', 1);
      if (prevBarPhase != null && f.barPhase < prevBarPhase - 0.5) bump('bar', 1);
      prevBeatPhase = f.beatPhase; prevBarPhase = f.barPhase;
      const sec = `${f.slot ?? ''}|${f.marker ?? ''}`;
      if (section != null && sec !== section) bump('section', 1);
      section = sec;
    } else {
      prevBeatPhase = prevBarPhase = null;
    }

    // steps move the performer's hand: they write the store
    for (const s of steps) {
      if (!s.enabled || !(readSource(s.on) > 0)) continue;
      if (++s.count % s.every) continue;
      s.i = (s.i + 1) % s.values.length;
      s.targets.forEach((k, j) => { if (!store.locked(k)) store.set(k, s.values[s.i][j]); });
    }

    // base position per driven key: the knob, or a tempo sync over it
    const base = new Map();
    for (const s of syncs) {
      if (!s.on) continue;
      const def = store.schema[s.target];
      if (live && f.bpm > 0) {
        const ms = s.sign * s.bars * (240000 / f.bpm);
        base.set(s.target, { t: null, value: Math.min(def.max, Math.max(def.min, ms)) });
      } else base.set(s.target, { t: store.valueToSlider(s.target, store.get(s.target)), value: null });
    }

    const sums = new Map();
    for (const r of routes) {
      const x = r.on ? clamp01(readSource(r.source)) : 0;
      r.y = follow(r.y, x, dt, r.attack, r.release);
      if (r.y < 1e-4 && x === 0) r.y = 0;
      sums.set(r.target, (sums.get(r.target) || 0) + r.amount * CURVES[r.curve](clamp01(r.y)));
    }

    const out = {};
    const keys = new Set([...base.keys(), ...sums.keys()]);
    for (const key of keys) {
      const def = store.schema[key];
      const b = base.get(key);
      const mod = sums.get(key) || 0;
      let value;
      if (b && b.value != null && mod === 0) value = b.value;                    // a pure sync keeps its exact ms
      else {
        const t0 = b ? (b.value != null ? store.valueToSlider(key, b.value) : b.t) : store.valueToSlider(key, store.get(key));
        value = quantize(def, store.sliderToValue(key, clamp01(t0 + mod)));
      }
      out[key] = value;
      if (applied.get(key) !== value) { applied.set(key, value); apply(key, value); }
    }
    return out;
  }

  // Is the patch riding this knob? The page uses it to decide who forwards a store change to the sim:
  // the router (on its next tick) or the page's own store -> sim wiring.
  function drives(key) {
    return routes.some((r) => r.target === key) || syncs.some((s) => s.target === key && s.on);
  }

  setPatch(patch || {});

  return {
    frame: pushFrame,
    notes: pushNotes,
    tick,
    setPatch,
    serialize,
    drives,
    get routes() { return routes; },
    get syncs() { return syncs; },
    get steps() { return steps; },
    get offsetMs() { return offsetMs; },
    set offsetMs(v) { offsetMs = Number(v) || 0; },
    get queued() { return queue.length; },
    source: readSource,
    level(i) { return routes[i] ? routes[i].y : 0; }
  };
}

const SOURCES = ['rms', 'peak', ...BAND_NAMES.map((b) => 'band.' + b), 'beat.phase', 'bar.phase', 'beat.pulse', 'bar.pulse', 'hit.kick', 'hit.snare', 'hit.clap', 'hit.chat', 'hit.ohat', 'hit.any', 'note.any', 'pitch.any', 'onset'];

export { createRouter, SOURCES, BAND_NAMES };
export default { createRouter, SOURCES, BAND_NAMES };
