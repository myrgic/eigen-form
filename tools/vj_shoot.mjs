#!/usr/bin/env node
/* =====================================================================
   tools/vj_shoot.mjs — look at a sim at chosen moments of a song,
   without a person at the screen: open the page in headless Chrome,
   let the embedded Oscine engine play, and take a picture when the song
   reaches each asked position. The loop an agent iterates in:
   change a shader or a patch, shoot, look, change again.

   Needs tools/vj_serve.mjs running (the page, Oscine and the songs on
   one origin) and Playwright, which this library does not depend on:
   it is looked up as `playwright`, then `playwright-core` (NODE_PATH is
   honoured), and Chrome is the installed one (--chrome <path> to name
   another). Screenshots are real-time: a moment 60 s into a section
   takes 60 s to reach, so start close with a section name.

   Usage:
     node tools/vj_shoot.mjs --sim rd --song /songs/storm/storm-over-the-lake.v5.oscine.json \
          --at A:3,C:1,C:9,G:5 --out /tmp/shots
   Options:
     --sim <id>[,<id>]   one or more sims (apps/vj_deck); default: all
     --app <path>        another shell-mounted page instead, e.g. /apps/physarum_live/index.html
     --at  S:b[,S:b]     positions: section name (or letter) : bar. Each is reached by STARTING the
                         song at that section and waiting for the bar, so they need not be in order.
     --settle <ms>       extra time after the bar is reached (default 0)
     --series <ms,ms>    after each stop, keep the page playing and shoot again this long after the bar was
                         reached: the way to watch one moment arrive (a section change, a bloom)
     --size 1280x720     viewport
     --origin <url>      default http://127.0.0.1:8471
     --ui                keep the drawer in the picture
     --gpu               ask for the real GPU instead of the software renderer
   Prints one JSON line per picture: { sim, at, file, reached, song: {...}, frames, renderer, error }.
   `frames` is model steps since the page opened and `renderer` is the GPU that drew it: a software
   renderer runs the heavy sims well below 60 steps a second, so its pictures are of a younger sim.
   ===================================================================== */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const require = createRequire(import.meta.url);
let chromium = null;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* try the next */ } }
if (!chromium) { console.error('vj_shoot: Playwright is not installed here. `npm i -g playwright-core` (or set NODE_PATH to where it is) and run again.'); process.exit(2); }
if (!args.song || args.song === true) { console.error('vj_shoot: --song <url path under the server> is required'); process.exit(2); }

const origin = String(args.origin || 'http://127.0.0.1:8471').replace(/\/+$/, '');
const out = resolve(String(args.out && args.out !== true ? args.out : 'out/vj_shoot')); mkdirSync(out, { recursive: true });
const [vw, vh] = String(args.size || '1280x720').split('x').map(Number);
const sims = args.app ? [null] : (args.sim && args.sim !== true ? String(args.sim).split(',') : ['fluid', 'rd', 'feedback', 'warp', 'tunnel', 'chladni']);
const stops = String(args.at && args.at !== true ? args.at : 'A:2').split(',').map((s) => { const [sec, bar] = s.split(':'); return { sec, bar: Math.max(1, Number(bar) || 1) }; });
const settle = Number(args.settle) || 0;
const series = args.series && args.series !== true ? String(args.series).split(',').map(Number).filter((n) => n > 0).sort((a, b) => a - b) : [];

// --mute-audio silences the device, not the graph: the engine still plays and the tap still hears it,
// so a shoot can run beside a window that is playing the same song out loud
const flags = ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl'];
if (!args.gpu) flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
else if (process.platform === 'darwin') flags.push('--use-angle=metal');
const browser = await chromium.launch(args.chrome && args.chrome !== true ? { executablePath: String(args.chrome), args: flags } : { channel: 'chrome', args: flags });
let failed = 0;
try {
  for (const sim of sims) for (const stop of stops) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    // Oscine probes for optional local files (game sound tables, breaks) with a guarded import: their 404s are not errors
    page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    const q = new URLSearchParams({ song: String(args.song), from: stop.sec });
    if (sim) q.set('sim', sim); if (!args.ui) q.set('ui', '0');
    await page.goto(`${origin}${args.app && args.app !== true ? args.app : '/apps/vj_deck/index.html'}?${q}`);
    const renderer = () => page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no webgl2'; const x = g.getExtension('WEBGL_debug_renderer_info'); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'webgl2'; });
    const pos = () => page.evaluate(() => { const d = window.__deck || {}, w = document.querySelector('.drawer .where'), said = w ? w.textContent : ''; return { song: d.song || null, frames: d.frames || 0, error: d.error || (/^could not start/.test(said) ? said : null) }; });
    // wait for the song to be playing at the asked bar (or past it), at most the length of 64 bars at 60 bpm
    let st = await pos(); const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      st = await pos();
      if (st.error || errors.length) break;
      if (st.song && st.song.playing && st.song.audio === 'running' && st.song.bar >= stop.bar) break;
      await page.waitForTimeout(40);
    }
    const reachedAt = Date.now();
    if (settle) await page.waitForTimeout(settle);
    st = await pos();
    const file = join(out, `${sim || 'app'}-${stop.sec}${String(stop.bar).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    const reached = !!(st.song && st.song.playing && st.song.bar >= stop.bar);
    if (!reached || st.error || errors.length) failed++;
    console.log(JSON.stringify({ sim, at: `${stop.sec}:${stop.bar}`, file, reached, song: st.song, frames: st.frames, renderer: await renderer(), error: st.error || errors[0] || null }));
    for (const ms of series) {
      await page.waitForTimeout(Math.max(0, reachedAt + ms - Date.now()));
      const f = join(out, `${sim || 'app'}-${stop.sec}${String(stop.bar).padStart(2, '0')}+${String(ms).padStart(5, '0')}.png`);
      await page.screenshot({ path: f }); const s2 = await pos();
      console.log(JSON.stringify({ sim, at: `${stop.sec}:${stop.bar}+${ms}`, late: Date.now() - reachedAt - ms, file: f, song: s2.song, error: s2.error || errors[0] || null }));
    }
    await page.close();
  }
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
