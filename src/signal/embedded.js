/* =====================================================================
   src/signal/embedded.js — Oscine's engine running INSIDE the page that
   draws, playing a whole song on loop.

   The live rig is two windows joined by a socket: Oscine plays, a page
   draws. That is the right shape for a show and the wrong one for
   working on a sim, where what you want is one tab that makes the sound
   and the picture together, restarts in a second, and can be driven by
   a script. This source is that tab's audio half:

     - it imports Oscine's own modules from `base` (bus, store, engine,
       transport, signal) at run time, so the sound is Oscine's, built
       from the project file, not a recording of it
     - it taps the engine with Oscine's own SignalTap, so the frames and
       notes are the same ones the socket carries. No analysis lives
       here
     - it walks the project's song sequence: Oscine's live transport
       loops one slot, so at every loop boundary the next section is
       queued, and after the last comes the first again

   Nothing of Oscine is copied into this library: `base` is a URL, and
   the page works without it (tools/vj_serve.mjs mounts an Oscine
   checkout at /oscine for local work). Same shape as the other sources
   in sources.js: onFrame, onNotes, onStatus.
   ===================================================================== */

// Which section plays next. Pure, so tests/signal.js can drive it: the transport tells it a loop
// boundary was crossed (the queued slot is now playing) and it answers with the slot to queue.
function createSongDriver(order, start = 0) {
  const seq = Array.isArray(order) && order.length ? order.slice() : [0];
  let idx = ((start % seq.length) + seq.length) % seq.length, jump = null, loops = 0;
  const after = (i) => (i + 1) % seq.length;
  return {
    get index() { return idx; },
    get slot() { return seq[idx]; },
    get loops() { return loops; },                       // times the whole song has come round
    get length() { return seq.length; },
    queued() { return seq[jump != null ? jump : after(idx)]; },
    // a boundary was crossed: what was queued is playing now
    crossed() { const to = jump != null ? jump : after(idx); if (jump == null && to === 0 && seq.length > 0) loops++; idx = to; jump = null; return seq[after(idx)]; },
    // ask for section n at the next boundary (wraps)
    jumpTo(n) { jump = ((n % seq.length) + seq.length) % seq.length; return seq[jump]; },
    restart(at = idx) { idx = ((at % seq.length) + seq.length) % seq.length; jump = null; return seq[after(idx)]; }
  };
}

// `from` names where to start: a slot letter ("G"), a slot name, or a position in the song ("6").
function startIndex(project, from) {
  const order = project.song && project.song.length ? project.song : [0];
  if (from == null || from === '') return 0;
  if (/^\d+$/.test(String(from))) return Math.min(order.length - 1, Number(from));
  const want = String(from).toLowerCase();
  const at = order.findIndex((si) => { const s = project.slots[si]; return ((s && s.name) || 'ABCDEFGH'[si] || '').toLowerCase() === want; });
  return at < 0 ? 0 : at;
}

function embeddedOscineSource({ base = '/oscine', songUrl, from, hz = 60, onFrame, onNotes, onStatus } = {}) {
  let stopped = false, connected = false, project = null, teardown = () => {}, control = null;
  const status = (detail) => onStatus && onStatus({ kind: 'song', label: 'Song', connected, project: project && project.name, detail });
  const root = String(base).replace(/\/+$/, '');

  (async () => {
    status('loading Oscine');
    const mod = (p) => import(/* runtime URL: Oscine is not part of this library */ `${root}/src/${p}`);
    const [{ EventBus }, { Store }, { validateProject }, { AudioEngine }, { Transport }, { getCtx, ensureRunning }, { SignalTap }] =
      await Promise.all([mod('core/bus.js'), mod('core/store.js'), mod('core/schema.js'), mod('engine/engine.js'), mod('engine/transport.js'), mod('engine/context.js'), mod('engine/signal.js')]);
    status('loading the song');
    const res = await fetch(songUrl);
    if (!res.ok) throw new Error(`${songUrl}: ${res.status}`);
    project = validateProject(await res.json());
    if (stopped) return;

    const bus = new EventBus(), store = new Store(bus, project);
    const engine = new AudioEngine(store, bus), ctx = getCtx(), transport = new Transport(ctx, store, bus);
    const tap = new SignalTap({ engine, transport, store, bus });
    const order = project.song && project.song.length ? project.song : [store.ui.activeSlot];
    const driver = createSongDriver(order, startIndex(project, from));

    bus.on('signal:frame', (f) => { if (!stopped && onFrame) onFrame(f); });
    bus.on('signal:notes', (d) => { if (!stopped && onNotes) onNotes(d.notes || []); });
    bus.on('transport:loop', () => { if (transport.playing) store.requestSlot(driver.crossed(), true); });

    function play(at) {
      if (transport.playing) return;
      const next = driver.restart(at);
      store.requestSlot(driver.slot, false);             // not playing yet: this section becomes the active one
      transport.play();
      store.requestSlot(next, true);                     // and the one after it waits at the boundary
    }
    const say = () => status(ctx.state === 'running' ? (transport.playing ? 'playing' : 'paused') : 'click or press a key to start the sound');
    const unlock = () => { ensureRunning().then(say, say); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    ctx.onstatechange = say;

    tap.start({ hz });
    connected = true;
    play();
    ensureRunning().then(say, say);                      // resolves at once where autoplay is allowed, after the first gesture where it is not
    say();

    control = {
      toggle() { if (transport.playing) transport.stop(); else play(driver.index); say(); },
      next() { store.requestSlot(driver.jumpTo(driver.index + 1), true); },
      prev() { store.requestSlot(driver.jumpTo(driver.index - 1), true); },
      position() { const p = transport.getPosition(); return { playing: !!p.playing, audio: ctx.state, index: driver.index, of: driver.length, slot: 'ABCDEFGH'[driver.slot] ?? String(driver.slot), bar: Math.floor((p.localBeat || 0) / 4) + 1, beat: Math.floor((p.localBeat || 0) % 4) + 1, loops: driver.loops }; }
    };
    teardown = () => { try { tap.stop(); transport.stop(); } catch { /* already down */ } removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); ctx.onstatechange = null; };
    if (stopped) teardown();
  })().catch((err) => { connected = false; status(`could not start: ${err.message}`); console.error('[embedded oscine]', err); });

  return {
    kind: 'song',
    stop() { stopped = true; connected = false; teardown(); },
    get connected() { return connected; },
    get project() { return project && project.name; },
    get control() { return control; }
  };
}

export { embeddedOscineSource, createSongDriver, startIndex };
export default { embeddedOscineSource, createSongDriver, startIndex };
