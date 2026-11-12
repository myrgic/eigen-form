/* =====================================================================
   src/gl/signal-texture.js — the signal as a texture a shader samples.

   The layout is AudioLink's (llealloo/audiolink 1.3.0, MIT), read from
   the package's own AudioLink.cginc: a 128 x 64 float texture, one
   block of pixels per kind of data, addressed by the same ALPASS_*
   coordinates and decoded by the same helpers (GLSL ports of them are
   in PRELUDE below). A shader written against AudioLink's data reads
   this texture the same way.

   What is filled, and how faithfully:
     rows 0-3     four bands + 127 steps of history       FILLED, from our five bands
                  (bass <- max(sub, bass), low mids <- lowmid, high mids <- mid,
                  treble <- high). AudioLink's own crossovers differ, and it
                  steps history at 90 Hz where this steps at 60.
     row 22       version, fps, instance / local time, current intensity   FILLED (mono: L = R)
     row 23       four theme colours, unix days / seconds                  FILLED
     rows 28-31   x 0-15  filtered bands, 16 smoothing levels              FILLED (our time constants)
                  x 16-23 chronotensity, 8 behaviours per band             FILLED (documented behaviours,
                          our rates, pinned to the one figure the docs give:
                          628319 units in 2.8 s at fixed speed)
                  x 24-27 filtered intensity                               FILLED
     rows 4-5     DFT, 240 bins                                            EMPTY
     rows 6-21    waveform                                                 EMPTY
     rows 24-27   ColorChord strip / lights, autocorrelator                EMPTY
     strings, markers, autogain, media state                               EMPTY
   The empty blocks need raw samples, which the signal does not carry.
   Until the real analysis is ported and checked against the package,
   treat this as AudioLink's LAYOUT with our numbers in it.

   Below row 32 are rows AudioLink has no concept of: the score.
     (0,32) transport   beatPhase, barPhase, bpm, playing
     (1,32) position    bar, beat, sections so far, seconds since the section changed
     (2,32) levels      rms, peak, onset envelope, kick envelope
     (3,32) (4,32)      our five bands unmapped: sub, bass, lowmid, mid | high
     row 33 drums       x = lane (kick, snare, clap, hat, open hat, other):
                        envelope, seconds since, velocity, hits so far
     row 34 notes       x = 0 newest .. 127: pitch 0..1, velocity, age in seconds, track index
     row 35 tracks      x = track: level, last pitch 0..1, note envelope, seconds since
     row 36 chroma      x = pitch class 0..11: envelope, seconds since, octave 0..1, notes so far

   The writer is pure: a Float32Array in, no GL. upload() is the only
   function that touches a context.
   ===================================================================== */

const W = 128, H = 64;
const ROW = { BANDS: 0, VU: 22, THEME: 23, FILTERED: 28, TRANSPORT: 32, DRUMS: 33, NOTES: 34, TRACKS: 35, CHROMA: 36 };
const LANES = ['kick', 'snare', 'clap', 'chat', 'ohat'];   // 'hat' counts as chat; anything else lands in lane 5
const CHRONO_RATE = 628319 / 2.8;                           // units per second at "fixed speed" (AudioLink docs)
const FILTER_TAU = Array.from({ length: 16 }, (_, i) => 2.0 * Math.pow(0.03 / 2.0, i / 15));   // s: 2 s (x=0) .. 30 ms (x=15)
const VU_TAU = [1.5, 0.6, 0.2, 0.06];
const ENV_TAU = 0.16, PITCH_LO = 36, PITCH_HI = 96;
const HISTORY_HZ = 60;                                      // AudioLink targets 90; 127 columns here are 2.1 s

function createSignalTexture() {
  const data = new Float32Array(W * H * 4);
  const px = (x, y) => (y * W + x) * 4;
  const set = (x, y, r, g = 0, b = 0, a = 0) => { const i = px(x, y); data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; };
  // AudioLinkDecodeDataAsUInt's inverse: r + g*1024 + b*1048576 + a*1073741824
  const setUInt = (x, y, v) => { v = ((v % 4294967296) + 4294967296) % 4294967296; set(x, y, v % 1024, Math.floor(v / 1024) % 1024, Math.floor(v / 1048576) % 1024, Math.floor(v / 1073741824)); };

  const filtered = Array.from({ length: 4 }, () => new Float64Array(16));
  const chrono = Array.from({ length: 4 }, () => new Float64Array(8));
  const vu = new Float64Array(4);
  const tracks = new Map();
  let t0 = null, sections = 0, sectionAt = 0, lastSection = null, frames = 0, fps = 60, histAcc = 0;
  let theme = [[1, 0.2, 0.5], [0.2, 0.9, 1], [1, 0.8, 0.2], [0.5, 0.3, 1]];

  function setTheme(colors) { theme = colors.slice(0, 4).map((c) => [c[0], c[1], c[2]]); }

  // A note at the moment it sounds (router's onNote).
  function noteOn(n) {
    const vel = Math.min(1, Math.max(0, Number.isFinite(n.vel) ? n.vel : 1));
    if (n.kind === 'drum') {
      const lane = n.lane === 'hat' ? 3 : (LANES.indexOf(n.lane) >= 0 ? LANES.indexOf(n.lane) : 5), i = px(lane, ROW.DRUMS);
      data[i] = Math.max(data[i], vel); data[i + 1] = 0; data[i + 2] = vel; data[i + 3] += 1;
      return;
    }
    if (!tracks.has(n.track)) tracks.set(n.track, tracks.size);
    const ti = Math.min(W - 1, tracks.get(n.track));
    const p = Number.isFinite(n.pitch) ? Math.min(1, Math.max(0, (n.pitch - PITCH_LO) / (PITCH_HI - PITCH_LO))) : 0;
    data.copyWithin(px(1, ROW.NOTES), px(0, ROW.NOTES), px(W - 1, ROW.NOTES));    // newest at x = 0
    set(0, ROW.NOTES, p, vel, 0, ti);
    const k = px(ti, ROW.TRACKS); data[k + 1] = p; data[k + 2] = Math.max(data[k + 2], vel); data[k + 3] = 0;
    if (Number.isFinite(n.pitch)) { const pc = ((Math.round(n.pitch) % 12) + 12) % 12, c = px(pc, ROW.CHROMA); data[c] = Math.max(data[c], vel); data[c + 1] = 0; data[c + 2] = Math.min(1, Math.max(0, (Math.floor(n.pitch / 12) - 1) / 8)); data[c + 3] += 1; }
  }

  // Once per rendered frame. frame: the latest signal frame (or null); dt: seconds since the last update; now: epoch ms.
  function update(frame, dt, now = Date.now()) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    if (t0 == null) t0 = now;
    frames++; if (dt > 0) fps += (1 / dt - fps) * 0.05;
    const f = frame && frame.playing ? frame : null;
    const b5 = f && f.bands ? f.bands : [0, 0, 0, 0, 0];
    const b4 = [Math.max(b5[0] || 0, b5[1] || 0), b5[2] || 0, b5[3] || 0, b5[4] || 0];

    // History advances on a clock (HISTORY_HZ), so the same stretch of the past fills the row whether the
    // display runs at 30, 60 or 144 Hz. At most 4 columns a call: a stalled tab leaves a gap, not a smear.
    histAcc += dt; let shifts = 0; while (histAcc + 1e-9 >= 1 / HISTORY_HZ && shifts < 4) { histAcc -= 1 / HISTORY_HZ; shifts++; }
    if (histAcc > 4 / HISTORY_HZ) histAcc = 0;
    for (let band = 0; band < 4; band++) {
      const v = b4[band];
      for (let s = 0; s < shifts; s++) data.copyWithin(px(1, band), px(0, band), px(W - 1, band));   // history cascades right
      set(0, band, v, v, v, 1);
      const fl = filtered[band];
      for (let i = 0; i < 16; i++) { fl[i] += (v - fl[i]) * (1 - Math.exp(-dt / FILTER_TAU[i])); set(i, ROW.FILTERED + band, fl[i], fl[i], fl[i], 1); }
      const s = fl[9], c = chrono[band], R = CHRONO_RATE * dt, dark = (x) => Math.max(0, 1 - 2.5 * x);
      c[0] += R * 2 * v;                    c[1] += R * 2 * s;                  // forward with intensity
      c[2] += R * 2 * (v - 0.5);            c[3] += R * 2 * (s - 0.5);          // back and forth
      c[4] += R * dark(v);                  c[5] += R * dark(s);                // fixed speed when dark, still when light
      c[6] += R * (2 * dark(v) - 1);        c[7] += R * (2 * dark(s) - 1);      // forward when dark, back when light
      for (let i = 0; i < 8; i++) setUInt(16 + i, ROW.FILTERED + band, Math.round(c[i]));
    }

    const rms = f ? f.rms || 0 : 0, peak = f ? f.peak || 0 : 0;
    set(0, ROW.VU, 3.02, 1, fps, 3);                                             // "version": layout follows 1.3
    set(1, ROW.VU, 0, fps, 0, 0);
    setUInt(2, ROW.VU, now - t0);
    const d = new Date(now); setUInt(3, ROW.VU, ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds());
    setUInt(4, ROW.VU, now - t0);
    set(8, ROW.VU, rms, peak, rms, peak);
    for (let i = 0; i < 4; i++) { vu[i] += (rms - vu[i]) * (1 - Math.exp(-dt / VU_TAU[i])); set(24 + i, ROW.FILTERED, vu[i], Math.max(vu[i], peak * (i === 3 ? 1 : 0.8)), vu[i], Math.max(vu[i], peak * (i === 3 ? 1 : 0.8))); }
    for (let i = 0; i < 4; i++) set(i, ROW.THEME, theme[i][0], theme[i][1], theme[i][2], 1);
    setUInt(5, ROW.THEME, Math.floor(now / 86400000)); setUInt(6, ROW.THEME, now % 86400000);

    // ---- our rows ----
    const sec = f ? `${f.slot ?? ''}|${f.marker ?? ''}` : lastSection;
    if (f && lastSection != null && sec !== lastSection) { sections++; sectionAt = now; }
    if (f) lastSection = sec;
    set(0, ROW.TRANSPORT, f ? f.beatPhase || 0 : 0, f ? f.barPhase || 0 : 0, f ? f.bpm || 0 : 0, f ? 1 : 0);
    set(1, ROW.TRANSPORT, f ? f.bar || 0 : 0, f ? f.beat || 0 : 0, sections, sectionAt ? (now - sectionAt) / 1000 : 9999);
    const lv = px(2, ROW.TRANSPORT), k = Math.exp(-dt / ENV_TAU);
    data[lv] = rms; data[lv + 1] = peak; data[lv + 2] = Math.max(data[lv + 2] * k, f && f.onset ? 1 : 0); data[lv + 3] = Math.max(data[lv + 3] * k, f && f.kick ? 1 : 0);
    set(3, ROW.TRANSPORT, b5[0] || 0, b5[1] || 0, b5[2] || 0, b5[3] || 0); set(4, ROW.TRANSPORT, b5[4] || 0);
    for (let x = 0; x < 6; x++) { const i = px(x, ROW.DRUMS); data[i] *= k; data[i + 1] += dt; }
    for (let x = 0; x < W; x++) { data[px(x, ROW.NOTES) + 2] += dt; }
    for (let x = 0; x < 12; x++) { const i = px(x, ROW.CHROMA); data[i] *= k; data[i + 1] += dt; }
    for (const [name, ti] of tracks) { if (ti >= W) continue; const i = px(ti, ROW.TRACKS); data[i] = f && f.tracks ? f.tracks[name] || 0 : 0; data[i + 2] *= k; data[i + 3] += dt; }
    return data;
  }

  // start every "seconds since" far in the past, so nothing reads as "just happened" before it has
  for (let x = 0; x < W; x++) { data[px(x, ROW.NOTES) + 2] = 9999; data[px(x, ROW.TRACKS) + 3] = 9999; }
  for (let x = 0; x < 12; x++) data[px(x, ROW.CHROMA) + 1] = 9999;
  for (let x = 0; x < 6; x++) data[px(x, ROW.DRUMS) + 1] = 9999;

  return { width: W, height: H, data, update, noteOn, setTheme, get frames() { return frames; }, trackIndex: (name) => tracks.get(name) };
}

// GL side: one RGBA32F texture, read with texelFetch (float textures need no filtering extension that way).
function createSignalUpload(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  return { tex, upload(data) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, data); } };
}

// GLSL ES 3.00: AudioLink's coordinates and readers, ported from AudioLink.cginc, plus ours.
const PRELUDE = `
#define PI 3.14159265359
#define TAU 6.28318530718
#define AUDIOLINK_WIDTH 128
const ivec2 ALPASS_DFT = ivec2(0, 4);
const ivec2 ALPASS_WAVEFORM = ivec2(0, 6);
const ivec2 ALPASS_AUDIOLINK = ivec2(0, 0);
const ivec2 ALPASS_AUDIOBASS = ivec2(0, 0);
const ivec2 ALPASS_AUDIOLOWMIDS = ivec2(0, 1);
const ivec2 ALPASS_AUDIOHIGHMIDS = ivec2(0, 2);
const ivec2 ALPASS_AUDIOTREBLE = ivec2(0, 3);
const ivec2 ALPASS_AUDIOLINKHISTORY = ivec2(1, 0);
const ivec2 ALPASS_GENERALVU = ivec2(0, 22);
const ivec2 ALPASS_GENERALVU_INSTANCE_TIME = ivec2(2, 22);
const ivec2 ALPASS_THEME_COLOR0 = ivec2(0, 23);
const ivec2 ALPASS_THEME_COLOR1 = ivec2(1, 23);
const ivec2 ALPASS_THEME_COLOR2 = ivec2(2, 23);
const ivec2 ALPASS_THEME_COLOR3 = ivec2(3, 23);
const ivec2 ALPASS_CCSTRIP = ivec2(0, 24);
const ivec2 ALPASS_AUTOCORRELATOR = ivec2(0, 27);
const ivec2 ALPASS_FILTEREDAUDIOLINK = ivec2(0, 28);
const ivec2 ALPASS_CHRONOTENSITY = ivec2(16, 28);
const ivec2 ALPASS_FILTEREDVU = ivec2(24, 28);
// the score rows (ours)
const ivec2 ALPASS_MYRGIC_TRANSPORT = ivec2(0, 32);
const ivec2 ALPASS_MYRGIC_POSITION = ivec2(1, 32);
const ivec2 ALPASS_MYRGIC_LEVELS = ivec2(2, 32);
const ivec2 ALPASS_MYRGIC_DRUMS = ivec2(0, 33);
const ivec2 ALPASS_MYRGIC_NOTES = ivec2(0, 34);
const ivec2 ALPASS_MYRGIC_TRACKS = ivec2(0, 35);
const ivec2 ALPASS_MYRGIC_CHROMA = ivec2(0, 36);

vec4 AudioLinkData(ivec2 xy) { return texelFetch(u_signal, xy, 0); }
vec4 AudioLinkLerp(vec2 xy) { ivec2 i = ivec2(floor(xy)); return mix(AudioLinkData(i), AudioLinkData(i + ivec2(1, 0)), fract(xy.x)); }
uint AudioLinkDecodeDataAsUInt(ivec2 loc) { vec4 r = AudioLinkData(loc); return uint(r.x) + uint(r.y) * 1024u + uint(r.z) * 1048576u + uint(r.w) * 1073741824u; }
float AudioLinkGetChronoTime(int index, int band) { return float(AudioLinkDecodeDataAsUInt(ALPASS_CHRONOTENSITY + ivec2(index, band))) / 100000.0; }
// The docs' advice made a function: take the modulus BEFORE going to float, or motion turns coarse as the count grows.
float AudioLinkGetChronoLoop(int index, int band, uint loopUnits) { return float(AudioLinkDecodeDataAsUInt(ALPASS_CHRONOTENSITY + ivec2(index, band)) % loopUnits) / 100000.0; }

float band(int b) { return AudioLinkData(ivec2(0, b)).r; }
float bandSmooth(int b, int level) { return AudioLinkData(ALPASS_FILTEREDAUDIOLINK + ivec2(level, b)).r; }
vec3 themeColor(int i) { return AudioLinkData(ivec2(i, 23)).rgb; }
// the four theme colours as one cyclic ramp
vec3 theme(float t) { t = fract(t) * 4.0; int i = int(floor(t)); float f = fract(t); f = f * f * (3.0 - 2.0 * f); return mix(themeColor(i), themeColor((i + 1) % 4), f); }
float drumEnv(int lane) { return AudioLinkData(ALPASS_MYRGIC_DRUMS + ivec2(lane, 0)).r; }

// Integer hash in the style of Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020).
uint hashu(uvec2 v) { v = v * 1664525u + 1013904223u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; return v.x ^ v.y; }
float hash21(vec2 p) { return float(hashu(uvec2(ivec2(floor(p)) + ivec2(32768)))) / 4294967295.0; }
// Value noise and fractal sum (Perlin, "An Image Synthesizer", SIGGRAPH 1985).
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 11.3; a *= 0.5; } return s; }
vec3 hueRotate(vec3 c, float a) { vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// one event: a soft spot at splat i, aspect-true
float splatAt(vec2 uv, int i) { vec2 d = uv - u_splat[i].xy; d.x *= u_aspect; return exp(-dot(d, d) / max(1e-6, u_splat[i].z * u_splat[i].z)); }
`;

export { createSignalTexture, createSignalUpload, PRELUDE, ROW, LANES, CHRONO_RATE, HISTORY_HZ, W as SIGNAL_WIDTH, H as SIGNAL_HEIGHT };
export default { createSignalTexture, createSignalUpload, PRELUDE, ROW, LANES, CHRONO_RATE };
