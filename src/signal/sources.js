/* =====================================================================
   src/signal/sources.js — where the music comes from.

   A source hands the router (router.js) frames and notes. Two here:

   oscineSource   Oscine's signal stream, ws://127.0.0.1:<port>/signal
                  (Oscine: src/engine/signal.js). Frames ~60 Hz; notes
                  arrive when the transport schedules them, ~100 ms
                  early, each with the epoch-ms time it will be heard.
                  Reconnects on its own; walks the sidecar's port range
                  (it takes the next free port when 7321 is busy).

   demoSource     A built-in four-section loop, so a page performs with
                  no Oscine running (a hosted page, a first look, a
                  test). Deterministic: demoAt(tMs, bpm) is a pure
                  function of time, which is what lets tests/signal.js
                  and a headless screenshot agree on what "bar 3" is.
                  It makes no sound.

   Both speak the same shape — onFrame(frame), onNotes(notes[]),
   onStatus({ kind, connected, project, detail }) — so a line-input
   source (FFT only, no notes) is a third function's worth of work, not
   a redesign: the router already falls back to the frame's own kick and
   onset flags when no notes arrive.

   The only platform things used are WebSocket and timers, both passed
   in or looked up lazily, so this file imports cleanly in node.
   ===================================================================== */

const DEFAULT_PORT = 7321;
const PORT_SPAN = 10;             // the sidecar tries BASE..BASE+9

function oscineSource({ port = DEFAULT_PORT, host = '127.0.0.1', hz = 60, onFrame, onNotes, onStatus, WebSocketImpl, retryMs = 1500 } = {}) {
  const WS = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  let ws = null, stopped = false, timer = null, tryPort = port, connected = false, project = null;
  const status = (detail) => onStatus && onStatus({ kind: 'oscine', connected, project, detail, port: tryPort });

  function open() {
    if (stopped) return;
    if (!WS) { status('no WebSocket in this environment'); return; }
    let sock;
    try { sock = new WS(`ws://${host}:${tryPort}/signal?hz=${hz}`); } catch (err) { schedule(); return; }
    ws = sock;
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'frame') onFrame && onFrame(m);
      else if (m.type === 'notes') onNotes && onNotes(m.notes || []);
      else if (m.type === 'hello') {
        if (m.server !== 'oscine') { sock.close(); return; }
        connected = true; project = m.project || null;
        status(m.app ? 'streaming' : 'sidecar up, no Oscine tab open');
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      const was = connected;
      connected = false; ws = null;
      if (!was) tryPort = port + ((tryPort - port + 1) % PORT_SPAN);   // nothing answered here: try the next port
      status(was ? 'disconnected' : 'looking for Oscine');
      schedule();
    };
    sock.onerror = () => { try { sock.close(); } catch { /* already closed */ } };
  }
  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(open, tryPort === port ? retryMs : retryMs / 4);
  }

  status('looking for Oscine');
  open();
  return {
    kind: 'oscine',
    stop() { stopped = true; clearTimeout(timer); const s = ws; ws = null; connected = false; try { s && s.close(); } catch { /* ok */ } },
    get connected() { return connected; },
    get project() { return project; }
  };
}

// ---- the demo loop -----------------------------------------------------
// 16 sixteenths per bar. Four sections of four bars: A sparse, B full,
// C breakdown (no kick), D full with an open hat. Enough contrast that
// every source in router.js has something to do.
const KICK  = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const CHAT  = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
const BASS  = [36, 0, 0, 36, 0, 0, 39, 0, 36, 0, 0, 36, 0, 41, 0, 43];
const LEAD  = [72, 0, 75, 0, 79, 0, 0, 77, 0, 0, 75, 0, 72, 0, 70, 0];
const SECTIONS = ['A', 'B', 'C', 'D'];
const BARS_PER_SECTION = 4;

function sectionOf(bar) { return SECTIONS[Math.floor(bar / BARS_PER_SECTION) % SECTIONS.length]; }

// Every note that sounds in sixteenth `step` (absolute, from t=0).
function demoStep(step) {
  const bar = Math.floor(step / 16), i = step % 16, sec = sectionOf(bar);
  const out = [];
  if (KICK[i] && sec !== 'C') out.push({ track: 'Kit', kind: 'drum', lane: 'kick', vel: 1 });
  if (SNARE[i] && sec !== 'A') out.push({ track: 'Kit', kind: 'drum', lane: 'snare', vel: 0.9 });
  if (CHAT[i]) out.push({ track: 'Kit', kind: 'drum', lane: sec === 'D' && i === 14 ? 'ohat' : 'chat', vel: i % 4 === 2 ? 0.7 : 0.45 });
  if (BASS[i] && sec !== 'C') out.push({ track: 'Bass', kind: 'note', pitch: BASS[i], vel: 0.85, durMs: 120 });
  if (LEAD[i] && sec !== 'A') out.push({ track: 'Lead', kind: 'note', pitch: LEAD[i] + (bar % 2 ? 3 : 0), vel: 0.7, durMs: 200 });
  return out;
}

const env = (ageMs, tau) => (ageMs < 0 ? 0 : Math.exp(-ageMs / tau));

// The frame a listener would measure at tMs. Levels are synthesized from
// the same pattern the notes come from, so frames and notes agree.
function demoAt(tMs, bpm = 124) {
  const stepMs = 15000 / bpm;
  const beat = tMs / (60000 / bpm);
  const step = Math.floor(tMs / stepMs);
  const bar = Math.floor(step / 16);
  let sub = 0, bass = 0, lowmid = 0, mid = 0, high = 0, kick = false, onset = false;
  for (let s = Math.max(0, step - 8); s <= step; s++) {
    const age = tMs - s * stepMs;
    for (const n of demoStep(s)) {
      if (n.lane === 'kick') { sub = Math.max(sub, 0.95 * env(age, 110)); bass = Math.max(bass, 0.7 * env(age, 90)); if (s === step && age < 18) kick = true; }
      else if (n.lane === 'snare') { lowmid = Math.max(lowmid, 0.6 * env(age, 90)); mid = Math.max(mid, 0.8 * env(age, 120)); high = Math.max(high, 0.5 * env(age, 80)); }
      else if (n.lane === 'chat' || n.lane === 'ohat') high = Math.max(high, n.vel * env(age, n.lane === 'ohat' ? 260 : 45));
      else if (n.track === 'Bass') bass = Math.max(bass, 0.8 * env(age, 160));
      else if (n.track === 'Lead') mid = Math.max(mid, 0.6 * env(age, 220));
      if (s === step && age < 18) onset = true;
    }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const bands = [sub, bass, lowmid, mid, high].map(r3);
  const rms = r3(Math.min(1, 0.25 + 0.45 * Math.max(sub, bass) + 0.2 * mid + 0.1 * high));
  return {
    v: 1, at: 0, playing: true, bpm,
    slot: sectionOf(bar), bar: (bar % BARS_PER_SECTION) + 1, beat: Math.floor(beat % 4) + 1, bars: BARS_PER_SECTION,
    beatPhase: r3(beat % 1), barPhase: r3((beat % 4) / 4), sec: r3(tMs / 1000),
    rms, peak: r3(Math.min(1, rms + 0.12)), bands, onset, kick,
    tracks: { Kit: r3(Math.max(sub, high)), Bass: r3(bass), Lead: r3(mid) }
  };
}

// Notes whose step starts in [fromMs, toMs), stamped relative to t0 (epoch ms of tMs = 0).
function demoNotes(fromMs, toMs, bpm = 124, t0 = 0) {
  const stepMs = 15000 / bpm;
  const out = [];
  for (let s = Math.max(0, Math.ceil(fromMs / stepMs - 1e-9)); s * stepMs < toMs - 1e-9; s++) {
    for (const n of demoStep(s)) out.push({ ...n, at: Math.round(t0 + s * stepMs) });
  }
  return out;
}

function demoSource({ bpm = 124, hz = 60, lookaheadMs = 100, onFrame, onNotes, onStatus, now = () => Date.now(), setIntervalImpl, clearIntervalImpl } = {}) {
  const setI = setIntervalImpl || setInterval, clearI = clearIntervalImpl || clearInterval;
  const t0 = now();
  let cursor = 0, seq = 0;
  const tick = () => {
    const t = now() - t0;
    // schedule ahead, the way a real transport does
    if (t + lookaheadMs > cursor) { const to = t + lookaheadMs; const ns = demoNotes(cursor, to, bpm, t0); cursor = to; if (ns.length && onNotes) onNotes(ns); }
    const f = demoAt(t, bpm); f.at = t0 + t; f.seq = ++seq;
    onFrame && onFrame(f);
  };
  const id = setI(tick, Math.round(1000 / hz));
  onStatus && onStatus({ kind: 'demo', connected: true, project: 'built-in loop', detail: `${bpm} bpm` });
  return { kind: 'demo', stop() { clearI(id); }, get connected() { return true; }, get project() { return 'built-in loop'; }, tick };
}

export { oscineSource, demoSource, demoAt, demoNotes, demoStep, DEFAULT_PORT };
export default { oscineSource, demoSource, demoAt, demoNotes, demoStep, DEFAULT_PORT };
