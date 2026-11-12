/* Chladni figures: sand on a singing plate.
   Bow a plate dusted with sand and the grains leave the parts that
   move and gather on the lines that do not: the nodal lines of the
   mode the plate is ringing in. Higher notes, finer figures.
     Chladni, "Entdeckungen über die Theorie des Klanges" (1787).
   The figure drawn is the usual closed form for a square plate,
     cos(n pi x) cos(m pi y) - cos(m pi x) cos(n pi y) = 0,
   an idealisation (real plates need the full biharmonic solution).
   No state: the "sand" is noise gathered where the function is small.

   Played: each note picks the mode from its pitch, and the figure
   slides from the old mode to the new; the kick bounces the sand off
   the lines; the snare thickens them. The one sim here where pitch,
   not loudness, is the picture. */
import { COLOR, HUE_STEP } from './common.js';

export default {
  id: 'chladni', title: 'Chladni', about: 'Chladni plate figures (1787), closed-form square plate',
  schema: {
    n:      { type: 'number', min: 1,     max: 14,  step: 1,     default: 3,    group: 'mode',  label: 'n' },
    m:      { type: 'number', min: 1,     max: 14,  step: 1,     default: 5,    group: 'mode',  label: 'm' },
    glide:  { type: 'number', min: 20,    max: 2000, step: 10,   unit: 'ms', default: 220, group: 'mode', label: 'glide', scale: 'log' },
    zoom:   { type: 'number', min: 0.4,   max: 2,   step: 0.01,  default: 0.85, group: 'plate', label: 'plate size' },
    width:  { type: 'number', min: 0.01,  max: 0.4, step: 0.005, default: 0.07, group: 'sand',  label: 'line width' },
    shake:  { type: 'number', min: 0,     max: 1,   step: 0.01,  default: 0.05, group: 'sand',  label: 'shake' },
    ...COLOR
  },
  patch: {
    routes: [
      { source: 'hit.kick',  target: 'shake', amount: 0.6,  attack: 0,  release: 200 },
      { source: 'hit.snare', target: 'width', amount: 0.25, attack: 0,  release: 180 },
      { source: 'rms',       target: 'gain',  amount: 0.12, attack: 100, release: 800 }
    ],
    triggers: [{ on: 'note.any', action: 'mode', amount: 1, every: 2 }],
    steps: [HUE_STEP]
  },
  extraUniforms: ['float u_nE', 'float u_mE'],
  uniforms(value, ctx) {
    // ease toward the mode the knobs name: non-integer (n, m) are what the slide between two figures looks like
    const k = 1 - Math.exp(-(ctx.dt * 1000) / Math.max(1, value('glide')));
    this._n = this._n == null ? value('n') : this._n + (value('n') - this._n) * k;
    this._m = this._m == null ? value('m') : this._m + (value('m') - this._m) * k;
    return { u_nE: this._n, u_mE: this._m };
  },
  draw: `
    float plate(vec2 p, float n, float m) { return cos(n * PI * p.x) * cos(m * PI * p.y) - cos(m * PI * p.x) * cos(n * PI * p.y); }
    vec4 pass(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0) / u_zoom;
      float f = plate(p, u_nE, u_mE);
      vec2 grain = floor(uv * u_res / 1.5);
      float g = hash21(grain + floor(u_time * 30.0) * 7.0), fixedGrain = hash21(grain + 91.0);
      float w = u_width * (0.6 + 0.8 * fixedGrain) * (1.0 + 2.5 * u_shake * g);
      float sand = smoothstep(w, w * 0.15, abs(f)) * (0.45 + 0.55 * fixedGrain);
      sand += u_shake * step(0.975, g) * 0.7;                               // grains in the air
      vec3 col = mix(themeColor(0), themeColor(1), 0.5 + 0.5 * sin(f * 3.0 + p.x * 2.0)) * sand;
      col += themeColor(2) * 0.05 * (1.0 - min(1.0, abs(f)));               // the plate, faintly
      col *= smoothstep(1.3, 0.3, length(uv - 0.5) * 1.7);
      return vec4(col * u_gain * 1.3, 1.0);
    }`,
  actions(api) {
    const rows = new Map();
    return (action, strength, meta) => {
      if (action !== 'mode' || !meta || meta.pitch == null) return;
      if (!rows.has(meta.track)) rows.set(meta.track, rows.size);
      const n = 2 + Math.round(meta.pitch * 9), m = n + 1 + (rows.get(meta.track) % 4);   // even the lowest note gets a figure, not one cross
      api.set('n', Math.min(14, n)); api.set('m', Math.min(14, m));
    };
  }
};
