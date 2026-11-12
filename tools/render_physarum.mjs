#!/usr/bin/env node
/* =====================================================================
   tools/render_physarum.mjs — play apps/physarum_live from a score,
   offline, and write the result as a video with the song under it.

   The live page is driven by Oscine's signal: ~60 Hz frames measured
   from the audio, and the notes the transport scheduled. This tool
   rebuilds that same signal without a browser:
     notes   straight from the project file (every note and drum hit of
             the song sequence, at its exact time)
     frames  from the rendered audio, through Oscine's own frame builder
             (src/engine/signal.js) fed by an FFT that mirrors an
             AnalyserNode (2048-point, Blackman window, no smoothing)
   and feeds it to the SAME router, patch, actions and model the page
   uses (apps/physarum_live/patch.js, src/signal/router.js,
   src/dynamics/physarum.js). One model step per 1/60 s, seeded: the
   same inputs give the same video.

   Usage:
     node tools/render_physarum.mjs --project song.oscine.json --audio song.wav \
          --oscine /path/to/oscine --out song.mp4
   Options:
     --size 960x540     grid the colony lives on (default 960x540)
     --scale 2          integer upscale for the video (default 2 -> 1920x1080)
     --fps 60           60 or 30
     --agents N         default: the live page's density (110k per 720x450)
     --seed 1           colony seed
     --patch file.json  a patch saved from the live page instead of the default
     --from S --to S    render only this stretch of the song (seconds)
     --crf 18           x264 quality (lower = bigger and cleaner)
     --ffmpeg path      default: ffmpeg on PATH
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = (...p) => pathToFileURL(join(HERE, '..', ...p)).href;

// ---- args ---------------------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (k.startsWith('--')) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const need = (k) => { if (!args[k] || args[k] === true) { console.error(`render_physarum: --${k} is required (see the header of this file)`); process.exit(2); } return args[k]; };
const projectPath = resolve(need('project')), audioPath = resolve(need('audio')), outPath = resolve(need('out')), oscine = resolve(need('oscine'));
const [GW, GH] = String(args.size || '960x540').split('x').map(Number);
const SCALE = Math.max(1, Math.round(Number(args.scale) || 2)), FPS = Number(args.fps) === 30 ? 30 : 60, STEPS = 60 / FPS;
const AGENTS = Math.round(Number(args.agents) || 110000 * (GW * GH) / (720 * 450));
const SEED = (Number(args.seed) >>> 0) || 1;
const CRF = Number.isFinite(Number(args.crf)) && args.crf !== true ? Number(args.crf) : 18;
if (!(GW >= 64 && GH >= 64)) { console.error('render_physarum: --size must be WxH, at least 64x64'); process.exit(2); }

const { defineParams } = await import(lib('src', 'params', 'define.js'));
const { createRouter } = await import(lib('src', 'signal', 'router.js'));
const { createPhysarum, buildLut, accentFor, SPAWNS } = await import(lib('src', 'dynamics', 'physarum.js'));
const { schema, DEFAULT_PATCH, createActions, modelParams } = await import(lib('apps', 'physarum_live', 'patch.js'));
let buildSignalFrame, OnsetTracker;
try {
  ({ buildSignalFrame } = await import(pathToFileURL(join(oscine, 'src', 'engine', 'signal.js')).href));
  ({ OnsetTracker } = await import(pathToFileURL(join(oscine, 'src', 'engine', 'earlive.js')).href));
} catch (err) { console.error(`render_physarum: --oscine must be an Oscine checkout that has src/engine/signal.js (${err.message})`); process.exit(2); }

// ---- the score: every note of the song, in seconds ----------------------
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
if (project.swing) console.error('render_physarum: note: this project has swing; hits are placed straight (a few ms off on swung 16ths)');
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
if (Math.abs(audioSec - songSec) > 3) console.error(`render_physarum: warning: the audio is ${audioSec.toFixed(1)} s but the score is ${songSec.toFixed(1)} s. Is this the render of this project's song sequence?`);

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

// ---- the instrument -------------------------------------------------------
let rs = SEED ^ 0x9e3779b9; const random = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
const store = defineParams(schema);
const eff = {};
const value = (k) => (k in eff ? eff[k] : store.get(k));
const sim = createPhysarum({ width: GW, height: GH, agents: AGENTS, seed: SEED, spawn: 'scatter' });
const patch = args.patch ? JSON.parse(readFileSync(resolve(args.patch), 'utf8')) : DEFAULT_PATCH;
const router = createRouter({ store, apply: (k, v) => { eff[k] = v; }, trigger: createActions(() => sim, { spawns: SPAWNS, random }), patch });

// ---- bloom: the page's blurred, screened copy of the picture, done by hand --
const BW = Math.ceil(GW / 4), BH = Math.ceil(GH / 4);
const small = [0, 1, 2].map(() => new Float32Array(BW * BH)), tmp = new Float32Array(BW * BH);
function bloom(px, strength) {
  if (!(strength > 0.01)) return;
  for (const s of small) s.fill(0);
  for (let y = 0; y < GH; y++) { const by = (y >> 2) * BW; for (let x = 0, j = y * GW * 4; x < GW; x++, j += 4) { const i = by + (x >> 2); small[0][i] += px[j]; small[1][i] += px[j + 1]; small[2][i] += px[j + 2]; } }
  const R = 3, norm = 1 / 16;
  for (const s of small) {
    for (let i = 0; i < s.length; i++) s[i] *= norm;
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < BH; y++) { let acc = 0; const o = y * BW; for (let x = -R; x <= R; x++) acc += s[o + Math.min(BW - 1, Math.max(0, x))]; for (let x = 0; x < BW; x++) { tmp[o + x] = acc / (2 * R + 1); acc += s[o + Math.min(BW - 1, x + R + 1)] - s[o + Math.max(0, x - R)]; } }
      for (let x = 0; x < BW; x++) { let acc = 0; for (let y = -R; y <= R; y++) acc += tmp[Math.min(BH - 1, Math.max(0, y)) * BW + x]; for (let y = 0; y < BH; y++) { s[y * BW + x] = acc / (2 * R + 1); acc += tmp[Math.min(BH - 1, y + R + 1) * BW + x] - tmp[Math.max(0, y - R) * BW + x]; } }
    }
  }
  const k = strength * 1.6;
  for (let y = 0; y < GH; y++) {
    const fy = Math.min(BH - 1.001, Math.max(0, (y + 0.5) / 4 - 0.5)), y0 = fy | 0, wy = fy - y0;
    for (let x = 0, j = y * GW * 4; x < GW; x++, j += 4) {
      const fx = Math.min(BW - 1.001, Math.max(0, (x + 0.5) / 4 - 0.5)), x0 = fx | 0, wx = fx - x0, i = y0 * BW + x0;
      for (let c = 0; c < 3; c++) {
        const s = small[c], b = (s[i] * (1 - wx) + s[i + 1] * wx) * (1 - wy) + (s[i + BW] * (1 - wx) + s[i + BW + 1] * wx) * wy;
        const a = px[j + c]; px[j + c] = a + b * k * (1 - a / 255);                 // screen
      }
    }
  }
}

// ---- render ---------------------------------------------------------------
const from = Math.max(0, Number(args.from) || 0), to = Math.min(audioSec, Number(args.to) || audioSec);
const totalFrames = Math.ceil((to - from) * FPS), firstFrame = Math.round(from * FPS);
const ffArgs = ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${GW}x${GH}`, '-r', String(FPS), '-i', 'pipe:0',
  '-ss', String(from), '-t', String(to - from), '-i', audioPath,
  '-map', '0:v', '-map', '1:a', '-vf', `scale=${GW * SCALE}:${GH * SCALE}:flags=bicubic`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-shortest', outPath];
const ff = spawn(args.ffmpeg && args.ffmpeg !== true ? args.ffmpeg : 'ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
let ffDone = null; const ffExit = new Promise((r) => ff.on('exit', (code) => { ffDone = code; r(code); }));
ff.on('error', (err) => { console.error(`render_physarum: could not start ffmpeg (${err.message})`); process.exit(1); });
ff.stdin.on('error', () => { /* reported through the exit code */ });

console.error(`render_physarum: ${sections.length} sections, ${notes.length} notes, ${songSec.toFixed(1)} s of score, ${audioSec.toFixed(1)} s of audio`);
console.error(`render_physarum: ${GW}x${GH} grid, ${AGENTS} agents, seed ${SEED} -> ${GW * SCALE}x${GH * SCALE} @ ${FPS} fps, ${totalFrames} frames`);

const T0 = 1_000_000;                                        // an arbitrary epoch: the router only needs a consistent clock
const px = new Uint8ClampedArray(GW * GH * 4), out = Buffer.from(px.buffer);
const tracker = new OnsetTracker(), params = {};
let lut = buildLut(), lutKey = '', accent = accentFor(165), nextNote = 0, lastPct = -1;
const t0 = Date.now();
// Everything before --from still has to happen (the colony has a history); it is just not encoded.
for (let f = 0; f < firstFrame + totalFrames; f++) {
  if (ffDone != null) break;
  const t = f / FPS, now = T0 + t * 1000;
  // hand over notes the way a transport does: a little ahead of when they sound
  const batch = []; while (nextNote < notes.length && notes[nextNote].t <= t + 0.15) { const n = notes[nextNote++]; batch.push({ ...n, at: T0 + n.t * 1000 }); }
  if (batch.length) router.notes(batch);

  let sec = sections[sections.length - 1]; for (const s of sections) if (t < s.start + s.beats * spb) { sec = s; break; }
  const playing = t < songSec, localBeat = Math.max(0, Math.min(sec.beats, (t - sec.start) / spb));
  analyse(Math.round(t * wav.rate));
  const head = { slot: sec.name, bar: Math.floor(localBeat / 4) + 1, beat: Math.floor(localBeat % 4) + 1, bars: sec.beats / 4, sec: Math.round(t * 10) / 10 };
  // past the last bar the tail is still sounding: keep measuring it, with the playhead parked
  router.frame(buildSignalFrame({ seq: f, at: now, sampleRate: wav.rate, master: { freqDb, td }, head, pos: { localBeat: playing ? localBeat : 0 }, bpm: project.bpm, playing: true, tracker }));
  router.tick(now);
  modelParams(value, params);
  for (let s = 0; s < STEPS; s++) sim.step(params);
  if (f < firstFrame) continue;

  const hue = value('hue'), spread = value('spread'), key = hue + '|' + spread;
  if (key !== lutKey) { lutKey = key; buildLut(hue, spread, lut); accent = accentFor(hue); }
  sim.paint(px, lut, accent, value('gain'));
  bloom(px, value('bloom'));
  if (!ff.stdin.write(out)) await new Promise((r) => ff.stdin.once('drain', r));
  const pct = Math.floor(((f - firstFrame + 1) / totalFrames) * 20);
  if (pct !== lastPct) { lastPct = pct; console.error(`render_physarum: ${pct * 5}%  (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
}
ff.stdin.end();
const code = await ffExit;
if (code !== 0) { console.error(`render_physarum: ffmpeg exited with ${code}`); process.exit(1); }
console.error(`render_physarum: wrote ${outPath}`);
