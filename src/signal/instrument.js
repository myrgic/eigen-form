/* =====================================================================
   src/signal/instrument.js — the shell a live app mounts: a source
   picker, the patch drawer, the knob panel, the keys, and the one loop
   that turns music into parameter values each frame.

   A live app is then three things of its own: a schema (what can be
   played), a default patch (how the music plays it), and a frame
   callback (draw). Everything between — router, sources, persistence of
   the patch, meters — is here, so the second instrument is not a copy
   of the first.

   DOM lives here and in src/panel/render.js; router.js and sources.js
   stay pure. Styles: src/signal/instrument.css.

     const inst = mountInstrument({
       store,                  // defineParams(schema)
       defaultPatch,           // { routes, syncs, steps, triggers, offsetMs }
       patchKey,               // localStorage key for the edited patch
       trigger(action, strength, meta),   // optional: the sim's events
       onNote(note, now),      // optional: every note at the moment it sounds
       onValue(key, value),    // optional: pushed when an effective value changes
       keys: { r: () => ... }, // optional: extra single-key actions
       keyHelp: 'R respawn',   // optional: text for them
     });
     ?song=<url to an .oscine.json>   adds a third source to ANY app mounted here: Oscine's engine in this
                             page, playing that song's whole sequence on loop (src/signal/embedded.js;
                             &oscine=<base url>; default /oscine on this machine, Oscine's public site anywhere else; &from=<section> starts there).
                             Space plays / pauses, comma and full stop step back / forward a section.
     inst.value(key)           // the EFFECTIVE value: knob + modulation
     inst.onFrame((now, frame) => { ... })   // called once per animation frame, after the router ticked
   ===================================================================== */

import { renderPanel } from '../panel/render.js';
import { createRouter, SOURCES } from './router.js';
import { oscineSource, demoSource } from './sources.js';
import { embeddedOscineSource } from './embedded.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function mountInstrument({ store, defaultPatch, patchKey, trigger, onNote, onValue, keys = {}, keyHelp = '', routable } = {}) {
  const schema = store.schema;
  const eff = {};                                         // values the router is holding a knob at
  const value = (k) => (k in eff ? eff[k] : store.get(k));
  const push = (k, v) => { if (onValue) onValue(k, v); };
  const apply = (k, v) => { eff[k] = v; push(k, v); };

  const load = () => { try { const raw = patchKey && localStorage.getItem(patchKey); if (raw) return JSON.parse(raw); } catch { /* private window, blocked storage */ } return defaultPatch; };
  let router;
  try { router = createRouter({ store, apply, trigger, onNote, patch: load() }); }
  catch (err) {
    // a remembered patch that no longer fits this schema: start over rather than refuse to open
    console.warn('[instrument] saved patch rejected, using the default:', err.message);
    router = createRouter({ store, apply, trigger, onNote, patch: defaultPatch });
  }
  const save = () => { try { if (patchKey) localStorage.setItem(patchKey, JSON.stringify(router.serialize())); } catch { /* fine without */ } };
  const forget = () => { for (const k of Object.keys(eff)) if (!router.drives(k)) { delete eff[k]; push(k, store.get(k)); } };
  store.subscribe((key, v) => { if (!router.drives(key)) { delete eff[key]; push(key, v); } });

  // ---- drawer markup -------------------------------------------------
  const drawer = el('aside', 'drawer'); drawer.setAttribute('aria-label', 'Instrument');
  drawer.innerHTML = `
    <section>
      <h2>Source</h2>
      <div class="src"></div>
      <div class="now"><span class="dot"></span><span class="where">starting</span><span class="pos">–</span></div>
      <div class="meters"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i><span class="lamp"></span></div>
      <div class="legend"><span>sub</span><span>bass</span><span>low</span><span>mid</span><span>high</span><span>kick</span></div>
    </section>
    <div class="scroll">
      <section><h2>Patch <span class="patch-note"></span></h2><div class="routes"></div><div class="trigs"></div><div class="fixed"></div>
        <div class="row"><button type="button" class="mini add">+ route</button><button type="button" class="mini reset">reset patch</button></div></section>
      <section><h2>Knobs <span>where the patch rides from</span></h2><div class="knobs"></div></section>
      <section class="keys"><kbd>H</kbd> hide this drawer &nbsp; <kbd>F</kbd> fullscreen &nbsp; <span class="key-help"></span><br><kbd>[</kbd> <kbd>]</kbd> nudge timing <span class="offset">0 ms</span></section>
    </div>`;
  document.body.appendChild(drawer);
  const $ = (sel) => drawer.querySelector(sel);
  $('.key-help').textContent = keyHelp;

  // ---- sources -------------------------------------------------------
  const q = new URLSearchParams(location.search);
  // On this machine Oscine is served beside the page and its sidecar may be listening. On the open web
  // neither is true: the engine comes from Oscine's public site, and the page does not go knocking on the
  // visitor's localhost unless asked to (?source=oscine).
  const local = /^(localhost|127\.|\[::1\]|.*\.local$)/.test(location.hostname) || location.protocol === 'file:';
  const OSCINE_PUBLIC = 'https://chazmaniandinkle.github.io/oscine';
  const makers = { oscine: () => oscineSource(hooks), demo: () => demoSource(hooks) };
  const labels = [['oscine', 'Oscine'], ['demo', 'Built-in loop']];
  if (q.get('song')) {                                    // one tab that makes the sound and the picture
    makers.song = () => embeddedOscineSource({ base: q.get('oscine') || (local ? '/oscine' : OSCINE_PUBLIC), songUrl: q.get('song'), from: q.get('from'), ...hooks });
    labels.unshift(['song', 'Song']);
  }
  for (const [id, label] of labels) { const b = el('button', null, label); b.type = 'button'; b.dataset.src = id; b.setAttribute('aria-pressed', 'false'); $('.src').appendChild(b); }

  let source = null, wanted = 'auto', lastFrame = null, fallbackTimer = null;
  const hooks = {
    onFrame: (f) => { lastFrame = f; router.frame(f); },
    onNotes: (n) => router.notes(n),
    onAhead: (a) => router.ahead(a),                      // only a source that knows the future calls this
    onStatus: (s) => {
      $('.dot').classList.toggle('on', !!s.connected);
      $('.where').textContent = s.kind === 'demo' ? `built-in loop, silent (${s.detail})`
        : s.kind === 'song' ? (s.connected ? `${s.project || 'song'}: ${s.detail}` : s.detail)
        : (s.connected ? `Oscine: ${s.project || 'untitled'}` : `${s.detail} (port ${s.port})`);
      if (s.kind === 'oscine' && s.connected) clearTimeout(fallbackTimer);
    }
  };
  function use(kind) {
    if (source) source.stop();
    lastFrame = null; router.frame({ playing: false }); router.ahead(null);
    for (const b of drawer.querySelectorAll('[data-src]')) b.setAttribute('aria-pressed', String(b.dataset.src === kind));
    source = (makers[kind] || makers.oscine)();
  }
  for (const b of drawer.querySelectorAll('[data-src]')) b.addEventListener('click', () => { wanted = b.dataset.src; clearTimeout(fallbackTimer); use(wanted); });
  const asked = q.get('source') || (q.get('song') ? 'song' : null);
  if (asked && makers[asked] && asked !== 'oscine') { wanted = asked; use(asked); }
  else if (!asked && !local) { wanted = 'demo'; use('demo'); }
  else {
    use('oscine');
    // Nobody chose: if Oscine isn't there, don't sit dark.
    if (asked !== 'oscine') fallbackTimer = setTimeout(() => { if (wanted === 'auto' && !source.connected) use('demo'); }, 2500);
  }
  if (q.get('ui') === '0') document.body.classList.add('quiet');
  if (q.get('song')) $('.key-help').textContent = `${keyHelp}  Space play/pause  , . section`.trim();

  // ---- patch editor --------------------------------------------------
  const targets = (routable || Object.keys(schema)).filter((k) => !store.locked(k) && (schema[k].type === 'number' || schema[k].type === 'angle'));
  const labelOf = (k) => (schema[k].group === schema[k].label ? schema[k].label : `${schema[k].group}: ${schema[k].label}`);
  const option = (v, text, selected) => { const o = el('option', null, text); o.value = v; o.selected = selected; return o; };
  let levelEls = [];
  function edit(mutate) { const p = router.serialize(); mutate(p); router.setPatch(p); forget(); save(); draw(); }
  function draw() {
    const host = $('.routes'); host.textContent = ''; levelEls = [];
    const known = new Set(SOURCES);
    for (const r of router.routes) known.add(r.source);
    if (lastFrame && lastFrame.tracks) for (const t of Object.keys(lastFrame.tracks)) { known.add('track.' + t); known.add('note.' + t); known.add('pitch.' + t); }
    router.routes.forEach((r, i) => {
      const row = el('div', 'route');
      const src = el('select'); src.setAttribute('aria-label', 'source');
      for (const s of known) src.appendChild(option(s, s, s === r.source));
      src.addEventListener('change', () => edit((p) => { p.routes[i].source = src.value; }));
      const tgt = el('select'); tgt.setAttribute('aria-label', 'target');
      for (const k of targets) tgt.appendChild(option(k, labelOf(k), k === r.target));
      tgt.addEventListener('change', () => edit((p) => { p.routes[i].target = tgt.value; }));
      const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'remove this route'; x.setAttribute('aria-label', 'remove this route');
      x.addEventListener('click', () => edit((p) => { p.routes.splice(i, 1); }));
      const amt = el('div', 'amt');
      const range = el('input'); range.type = 'range'; range.min = '-1'; range.max = '1'; range.step = '0.01'; range.value = String(r.amount); range.title = 'amount: how far along the knob this route pushes'; range.setAttribute('aria-label', 'amount');
      range.addEventListener('input', () => { router.routes[i].amount = parseFloat(range.value); save(); });
      const num = (val, max, title, set) => { const n = el('input'); n.type = 'number'; n.min = '0'; n.max = String(max); n.step = '10'; n.value = String(val); n.title = title; n.setAttribute('aria-label', title); n.addEventListener('change', () => { set(Math.max(0, +n.value || 0)); save(); }); return n; };
      amt.append(range, num(r.attack, 5000, 'attack, ms', (v) => { router.routes[i].attack = v; }), num(r.release, 10000, 'release, ms', (v) => { router.routes[i].release = v; }));
      const lvl = el('div', 'lvl'); const bar = el('b'); lvl.appendChild(bar); levelEls.push(bar);
      row.append(src, el('span', 'arrow', '→'), tgt, x, amt, lvl);
      host.appendChild(row);
    });
    // Built as nodes, not markup: a remembered patch is data and must not become HTML.
    const trigs = $('.trigs'); trigs.textContent = '';
    router.triggers.forEach((t, i) => {
      const row = el('div', 'trig'); const label = el('span'); label.append(`${t.on} → `, el('em', null, t.action));
      const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '1.5'; range.step = '0.01'; range.value = String(t.amount); range.title = 'strength (0 = off)'; range.setAttribute('aria-label', `${t.action} strength`);
      range.addEventListener('input', () => { router.triggers[i].amount = parseFloat(range.value); save(); });
      row.append(label, range); trigs.appendChild(row);
    });
    const fixed = $('.fixed'); fixed.textContent = '';
    const line = (strong, rest) => { const d = el('div'); d.append(el('em', null, strong), rest); fixed.appendChild(d); };
    for (const s of router.syncs) line(labelOf(s.target), ` locked to ${s.bars} bar${s.bars === 1 ? '' : 's'}`);
    for (const s of router.steps) line(s.targets.join(', '), ` steps through ${s.values.map((v) => '(' + v.join(',') + ')').join(' ')} every ${s.every > 1 ? s.every + ' ' : ''}${s.on}${s.every > 1 ? 's' : ''}`);
    $('.patch-note').textContent = `${router.routes.length} route${router.routes.length === 1 ? '' : 's'}`;
    showOffset();
  }
  const showOffset = () => { $('.offset').textContent = `${router.offsetMs > 0 ? '+' : ''}${router.offsetMs} ms`; };
  $('.add').addEventListener('click', () => edit((p) => { p.routes.push({ source: 'band.mid', target: targets[0], amount: 0.2, attack: 30, release: 300 }); }));
  $('.reset').addEventListener('click', () => { router.setPatch(defaultPatch); forget(); try { if (patchKey) localStorage.removeItem(patchKey); } catch { /* ok */ } draw(); });
  draw();
  renderPanel(store, $('.knobs'));

  // ---- the loop ------------------------------------------------------
  const meterBars = [...drawer.querySelectorAll('.meters i b')];
  const frameFns = [];
  let tracksSeen = '', lampUntil = 0;
  function loop() {
    const now = Date.now();
    router.tick(now);
    for (const fn of frameFns) fn(now, lastFrame);
    if (!document.body.classList.contains('quiet')) {
      const f = lastFrame;
      for (let i = 0; i < 5; i++) meterBars[i].style.height = (f && f.playing && f.bands ? (f.bands[i] || 0) * 100 : 0) + '%';
      if (router.source('hit.kick') > 0) lampUntil = now + 90;
      $('.lamp').classList.toggle('hit', now < lampUntil);
      $('.pos').textContent = f && f.playing ? `${f.bpm} bpm  ${f.slot ?? ''}${f.marker ? ' ' + f.marker : ''}  ${f.bar}.${f.beat}` : (f ? 'stopped' : '–');
      for (let i = 0; i < levelEls.length; i++) levelEls[i].style.width = Math.min(100, Math.abs(router.level(i)) * 100) + '%';
      // new track names give the patch new sources to offer
      const names = f && f.tracks ? Object.keys(f.tracks).join('|') : '';
      if (names !== tracksSeen && !drawer.contains(document.activeElement)) { tracksSeen = names; draw(); }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- keys ----------------------------------------------------------
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'h') document.body.classList.toggle('quiet');
    else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
    else if (k === '[' || k === ']') { router.offsetMs += k === ']' ? 5 : -5; save(); showOffset(); }
    else if (source && source.control && (k === ' ' || k === ',' || k === '.')) { e.preventDefault(); if (k === ' ') source.control.toggle(); else if (k === '.') source.control.next(); else source.control.prev(); }
    else if (keys[k]) keys[k]();
  });

  return { router, value, onFrame: (fn) => { frameFns.push(fn); }, get lastFrame() { return lastFrame; }, get source() { return source; } };
}

export { mountInstrument };
export default { mountInstrument };
