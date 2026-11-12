/* Video feedback: a camera pointed at its own monitor.
   Each frame is the last one, slightly zoomed, turned and faded, with
   something new drawn on top. The picture is whatever survives the
   loop: spirals, tunnels, lace.
     Crutchfield, "Space-Time Dynamics in Video Feedback", Physica D 10 (1984).
   Here the "camera" is a transform about the centre (optionally folded
   into mirror wedges first) and the new light is a polygon outline.

   Played: bass drives the zoom, the kick lights the outline, the snare
   kicks the hue round, notes are sparks at their places, and the
   outline turns on the mids' chronotensity. */
import { COLOR, HUE_STEP } from './common.js';
import { placeNote, hsv } from '../runtime.js';

export default {
  id: 'feedback', title: 'Feedback', about: 'Video feedback (Crutchfield 1984)',
  schema: {
    zoom:    { type: 'number', min: 0.9,  max: 1.15,  step: 0.001, default: 1.03,  group: 'loop',  label: 'zoom' },
    twist:   { type: 'number', min: -0.2, max: 0.2,   step: 0.001, default: 0.02,  group: 'loop',  label: 'twist', unit: 'rad' },
    keep:    { type: 'number', min: 0.8,  max: 0.999, step: 0.001, default: 0.95,  group: 'loop',  label: 'persistence', scale: 'log-complement' },
    drift:   { type: 'number', min: -0.3, max: 0.3,   step: 0.005, default: 0.04,  group: 'loop',  label: 'hue drift' },
    folds:   { type: 'number', min: 1,    max: 12,    step: 1,     default: 1,     group: 'loop',  label: 'mirror folds' },
    sides:   { type: 'number', min: 3,    max: 12,    step: 1,     default: 5,     group: 'light', label: 'sides' },
    radius:  { type: 'number', min: 0.05, max: 0.45,  step: 0.005, default: 0.2,   group: 'light', label: 'radius' },
    spark:   { type: 'number', min: 0,    max: 2,     step: 0.01,  default: 0.25,  group: 'light', label: 'light' },
    spin:    { type: 'number', min: -2,   max: 2,     step: 0.01,  default: 0.4,   group: 'light', label: 'spin' },
    ...COLOR
  },
  patch: {
    routes: [
      { source: 'band.bass', target: 'zoom',  amount: 0.22, attack: 20, release: 260 },
      { source: 'hit.kick',  target: 'spark', amount: 0.45, attack: 0,  release: 160 },
      { source: 'hit.snare', target: 'drift', amount: 0.35, attack: 0,  release: 220 },
      { source: 'band.high', target: 'twist', amount: 0.12, attack: 30, release: 400 }
    ],
    triggers: [{ on: 'note.any', action: 'spark', amount: 1 }],
    steps: [
      { on: 'section', targets: ['sides', 'folds'], values: [[5, 1], [3, 3], [6, 1], [4, 4], [7, 2]] },
      HUE_STEP
    ]
  },
  buffers: { fb: { size: [960, 540], wrap: 'clamp' } },
  passes: [{ target: 'fb', src: `
    vec4 pass(vec2 uv) {
      vec2 p = uv - 0.5; p.x *= u_aspect;
      vec2 s = p;
      float folds = floor(u_folds + 0.5);
      if (folds > 1.5) { float seg = TAU / folds, a = atan(s.y, s.x), r = length(s); a = abs(mod(a, seg) - seg * 0.5); s = r * vec2(cos(a), sin(a)); }
      vec2 q = rot(u_twist) * s / u_zoom; q.x /= u_aspect; q += 0.5;
      q = 1.0 - abs(1.0 - mod(q, 2.0));                       // past the edge the picture mirrors back in (no black wedges when folded)
      vec3 prev = texture(u_fb, q).rgb;
      prev = max(hueRotate(prev, u_drift), vec3(0.0)) * u_keep;

      float sides = floor(u_sides + 0.5), turn = AudioLinkGetChronoLoop(1, 2, 628319u) * u_spin;
      float a = atan(p.y, p.x) + turn, r = length(p);
      float poly = cos(PI / sides) / cos(mod(a, TAU / sides) - PI / sides);
      float line = smoothstep(0.012, 0.0, abs(r - u_radius * poly));
      vec3 src = theme(a / TAU + u_time * 0.05) * line * u_spark;
      for (int i = 0; i < u_splatCount; i++) src += u_splatColor[i].rgb * u_splat[i].w * splatAt(uv, i);
      return vec4(min(prev + src, vec3(4.0)), 1.0);
    }` }],
  draw: `
    vec4 pass(vec2 uv) { return vec4(1.0 - exp(-texture(u_fb, uv).rgb * 1.6 * u_gain), 1.0); }`,
  actions(api) {
    const rows = new Map();
    return (action, strength, meta) => {
      if (action === 'spark') {
        const [x, y] = placeNote(meta, rows, api.aspect()), p = meta && meta.pitch != null ? meta.pitch : Math.random();
        api.splat({ x, y, r: 0.012 + 0.01 * strength, strength: 0.9 * strength, color: hsv(api.value('hue') + api.value('spread') * (p * 2 - 1), 0.8, 1) });
      } else if (action === 'reset') api.reset();
    };
  }
};
