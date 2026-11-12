#!/usr/bin/env node
/* =====================================================================
   tools/render_gl.mjs — play a GPU sim (src/gl/sims) from a score,
   offline, and write the result as a video with the song under it.

   The GPU twin of tools/render_physarum.mjs. The signal is rebuilt the
   same way (notes from the project file; frames from the rendered audio
   through Oscine's own frame builder), but the sim needs a GPU, so the
   drawing happens in headless Chrome on a page with no clock of its own
   (tools/render_gl.html): this tool hands it one signal frame per
   1/60 s and takes back the picture. Because the whole song is known,
   the router is given the schedule up front, so anticipation (leads,
   until.* sources, the bloom on the downbeat) plays as it does live
   with the embedded song. Seeded: the same inputs give the same video
   on the same GPU.

   Usage:
     node tools/render_gl.mjs --sim rd --project song.oscine.json --audio song.wav \
          --oscine /path/to/oscine --out song.mp4
   Options:
     --size 1920x1080   picture size (default 1920x1080)
     --fps 60           60 or 30
     --seed 1           seeds the actions' randomness
     --patch file.json  a patch saved from the deck instead of the sim's default
     --from S --to S    encode only this stretch (seconds); what comes before is still played
     --crf 17           x264 quality (lower = bigger and cleaner)
     --quality 0.95     JPEG quality of the frames handed from the page to ffmpeg
     --software         draw with SwiftShader instead of the GPU (slow; for machines without one)
     --chrome path      a Chrome to use instead of the installed one
     --ffmpeg path      default: ffmpeg on PATH
   Needs Playwright (set NODE_PATH to where it is) and ffmpeg.
   ===================================================================== */

import { readFileSync, createReadStream, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve, dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const need = (k) => { if (!args[k] || args[k] === true) { console.error(`render_gl: --${k} is required (see the header of this file)`); process.exit(2); } return args[k]; };
const simId = need('sim'), projectPath = resolve(need('project')), audioPath = resolve(need('audio')), outPath = resolve(need('out')), oscine = resolve(need('oscine'));
const [W, H] = String(args.size || '1920x1080').split('x').map(Number);
const FPS = Number(args.fps) === 30 ? 30 : 60, KEEP = 60 / FPS;
const SEED = (Number(args.seed) >>> 0) || 1;
const CRF = Number.isFinite(Number(args.crf)) && args.crf !== true ? Number(args.crf) : 17;
const QUALITY = Number(args.quality) > 0 ? Math.min(1, Number(args.quality)) : 0.95;
if (!(W >= 64 && H >= 64) || W % 2 || H % 2) { console.error('render_gl: --size must be WxH, even numbers, at least 64x64'); process.exit(2); }
const require = createRequire(import.meta.url);
let chromium = null;
for (const name of ['playwright', 'playwright-core']) { try { chromium = require(name).chromium; break; } catch { /* try the next */ } }
if (!chromium) { console.error('render_gl: Playwright is not installed here. Set NODE_PATH to where it is and run again.'); process.exit(2); }
let buildSignalFrame, OnsetTracker;
try {
  ({ buildSignalFrame } = await import(pathToFileURL(join(oscine, 'src', 'engine', 'signal.js')).href));
  ({ OnsetTracker } = await import(pathToFileURL(join(oscine, 'src', 'engine', 'earlive.js')).href));
} catch (err) { console.error(`render_gl: --oscine must be an Oscine checkout that has src/engine/signal.js (${err.message})`); process.exit(2); }

// ---- the score: every note of the song, in seconds ----------------------
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
if (project.swing) console.error('render_gl: note: this project has swing; hits are placed straight (a few ms off on swung 16ths)');
const spb = 60 / project.bpm;
const order = Array.isArray(project.song) && project.song.length ? project.song : [0];
const sections = []; const notes = [];
let cursor = 0;
for (const si of order) {
  const slot = project.slots[si]; if (!slot) continue;
  const beats = slot.bars * 4, start = cursor;
  sections.push({ name: slot.name ?? 'ABCDEFGH'[si] ?? String(si), start, beats });
  for (const tr of project.tracks) {
    if (tr.channel?.mute) continue;
    const pat = slot.patterns?.[tr.id]; if (!pat) continue;
    if (pat.steps) {
      for (const [lane, vels] of Object.entries(pat.steps)) for (let i = 0; i < vels.length && i < beats * 4; i++) if (vels[i] > 0) notes.push({ track: tr.name, kind: 'drum', lane, vel: vels[i], t: start + (i / 4) * spb });
    } else for (const n of pat.notes ?? []) if (n.start < beats) notes.push({ track: tr.name, kind: 'note', pitch: n.pitch, vel: n.vel, t: start + n.start * spb });
  }
  cursor += beats * spb;
}
notes.sort((a, b) => a.t - b.t);
const songSec = cursor;

// ---- the audio: mono samples ---------------------------------------------
function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file (render the song to .wav first)');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= b.length;) { const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; else if (id === 'data') data = { o: o + 8, size: Math.min(size, b.length - o - 8) }; o += 8 + size + (size & 1); }
  if (!fmt || !data) throw new Error('wav has no fmt/data chunk');
  const bytes = fmt.bits / 8, n = Math.floor(data.size / (bytes * fmt.ch)), out = new Float32Array(n);
  const read = fmt.tag === 3 && fmt.bits === 32 ? (o) => b.readFloatLE(o) : fmt.bits === 16 ? (o) => b.readInt16LE(o) / 32768 : fmt.bits === 24 ? (o) => b.readIntLE(o, 3) / 8388608 : fmt.bits === 32 ? (o) => b.readInt32LE(o) / 2147483648 : null;
  if (!read) throw new Error(`unsupported wav format (tag ${fmt.tag}, ${fmt.bits}-bit)`);
  for (let i = 0, o = data.o; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++, o += bytes) s += read(o); out[i] = s / fmt.ch; }
  return { rate: fmt.rate, samples: out };
}
const wav = readWav(audioPath);
const audioSec = wav.samples.length / wav.rate;
if (Math.abs(audioSec - songSec) > 3) console.error(`render_gl: warning: the audio is ${audioSec.toFixed(1)} s but the score is ${songSec.toFixed(1)} s. Is this the render of this project's song sequence?`);

// AnalyserNode.getFloatFrequencyData, offline: Blackman window, FFT, |X|/N in dB.
const N = 2048, HALF = N / 2;
const win = Float32Array.from({ length: N }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N));
const re = new Float32Array(N), im = new Float32Array(N), td = new Float32Array(N), freqDb = new Float32Array(HALF);
const rev = new Uint16Array(N); for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < 11; b++) r |= ((i >> b) & 1) << (10 - b); rev[i] = r; }
const cosT = Float32Array.from({ length: HALF }, (_, i) => Math.cos(2 * Math.PI * i / N)), sinT = Float32Array.from({ length: HALF }, (_, i) => Math.sin(2 * Math.PI * i / N));
function analyse(endSample) {
  for (let i = 0; i < N; i++) { const k = endSample - N + i; td[i] = k >= 0 && k < wav.samples.length ? wav.samples[k] : 0; }
  for (let i = 0; i < N; i++) { re[rev[i]] = td[i] * win[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, stride = N / size;
    for (let s = 0; s < N; s += size) for (let k = 0; k < half; k++) {
      const c = cosT[k * stride], sn = -sinT[k * stride], a = s + k, b = a + half;
      const xr = re[b] * c - im[b] * sn, xi = re[b] * sn + im[b] * c;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
  for (let k = 0; k < HALF; k++) freqDb[k] = 20 * Math.log10(Math.max(Math.hypot(re[k], im[k]) / N, 1e-10));
}

// ---- the page ---------------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {                // this repo, read-only, to this machine only
  const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  try { if (!p.startsWith(ROOT) || !statSync(p).isFile()) throw 0; res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); createReadStream(p).pipe(res); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const flags = ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', ...(args.software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : process.platform === 'darwin' ? ['--use-angle=metal'] : [])];
const browser = await chromium.launch({ headless: true, args: flags, ...(args.chrome && args.chrome !== true ? { executablePath: String(args.chrome) } : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/tools/render_gl.html`);
await page.waitForFunction(() => window.__render);

const T0 = 1_000_000;                                        // an arbitrary epoch: the router only needs a consistent clock
// the whole song is known: hand the router its future once
const ahead = {
  section: { index: 0, name: sections[0].name, at: T0 },
  sections: sections.slice(1).map((s, i) => ({ at: Math.round(T0 + s.start * 1000), index: i + 1, name: s.name })),
  notes: notes.map((n) => ({ ...n, at: Math.round(T0 + n.t * 1000) })),
  until: Math.round(T0 + songSec * 1000)
};
const patch = args.patch ? JSON.parse(readFileSync(resolve(args.patch), 'utf8')) : null;
let info;
try { info = await page.evaluate((o) => window.__render.init(o), { sim: simId, width: W, height: H, seed: SEED, patch, ahead, t0: T0 }); }
catch (err) { console.error(`render_gl: the sim did not start: ${err.message.split('\n')[0]}`); await browser.close(); server.close(); process.exit(1); }

// ---- render ---------------------------------------------------------------
const from = Math.max(0, Number(args.from) || 0), to = Math.min(audioSec, Number(args.to) || audioSec);
const firstStep = Math.round(from * 60), totalSteps = Math.ceil((to - from) * 60), totalFrames = Math.ceil(totalSteps / KEEP);
const ffArgs = ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
  '-ss', String(from), '-t', String(to - from), '-i', audioPath,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-shortest', outPath];
const ff = spawn(args.ffmpeg && args.ffmpeg !== true ? args.ffmpeg : 'ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
let ffDone = null; const ffExit = new Promise((r) => ff.on('exit', (code) => { ffDone = code; r(code); }));
ff.on('error', (err) => { console.error(`render_gl: could not start ffmpeg (${err.message})`); process.exit(1); });
ff.stdin.on('error', () => { /* reported through the exit code */ });

console.error(`render_gl: ${info.title} on ${info.renderer}`);
console.error(`render_gl: ${sections.length} sections, ${notes.length} notes, ${songSec.toFixed(1)} s of score, ${audioSec.toFixed(1)} s of audio`);
console.error(`render_gl: ${W}x${H} @ ${FPS} fps, ${totalFrames} frames, seed ${SEED}`);

const tracker = new OnsetTracker();
let nextNote = 0, lastPct = -1, wrote = 0, failed = null;
const t0 = Date.now(), BATCH = 12;
// Everything before --from still has to happen (the field has a history); it is just not shot.
for (let f = 0; f < firstStep + totalSteps && ffDone == null; f += BATCH) {
  const steps = [];
  for (let i = f; i < Math.min(f + BATCH, firstStep + totalSteps); i++) {
    const t = i / 60, now = T0 + t * 1000;
    // hand over notes the way a transport does: a little ahead of when they sound
    const batch = []; while (nextNote < notes.length && notes[nextNote].t <= t + 0.15) { const n = notes[nextNote++]; batch.push({ ...n, at: T0 + n.t * 1000 }); }
    let sec = sections[sections.length - 1]; for (const s of sections) if (t < s.start + s.beats * spb) { sec = s; break; }
    const playing = t < songSec, localBeat = Math.max(0, Math.min(sec.beats, (t - sec.start) / spb));
    analyse(Math.round(t * wav.rate));
    const head = { slot: sec.name, bar: Math.floor(localBeat / 4) + 1, beat: Math.floor(localBeat % 4) + 1, bars: sec.beats / 4, sec: Math.round(t * 10) / 10 };
    // past the last bar the tail is still sounding: keep measuring it, with the playhead parked
    const frame = buildSignalFrame({ seq: i, at: now, sampleRate: wav.rate, master: { freqDb, td }, head, pos: { localBeat: playing ? localBeat : 0 }, bpm: project.bpm, playing: true, tracker });
    steps.push({ i: i - firstStep, skip: i < firstStep, now, notes: batch, frame });
  }
  let shots;
  try { shots = await page.evaluate(([s, keep, q]) => window.__render.frames(s, keep, q), [steps, KEEP, QUALITY]); }
  catch (err) { failed = err.message.split('\n')[0]; break; }
  if (pageErrors.length) { failed = pageErrors[0]; break; }
  for (const url of shots) { wrote++; if (!ff.stdin.write(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))) await new Promise((r) => ff.stdin.once('drain', r)); }
  const pct = Math.floor((wrote / totalFrames) * 20);
  if (pct !== lastPct) { lastPct = pct; console.error(`render_gl: ${pct * 5}%  (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
}
ff.stdin.end();
const code = await ffExit;
await browser.close(); server.close();
if (failed) { console.error(`render_gl: the page failed: ${failed}`); process.exit(1); }
if (code !== 0) { console.error(`render_gl: ffmpeg exited with ${code}`); process.exit(1); }
console.error(`render_gl: wrote ${outPath} (${wrote} frames)`);
