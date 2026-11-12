/* Warp: fractal noise bent through itself, seen in a kaleidoscope.
   The noise is Perlin's fractal sum ("An Image Synthesizer", SIGGRAPH
   1985); feeding a noise field's own value back in as a displacement
   of the next lookup (domain warping) is what turns clouds into marble
   and smoke. The kaleidoscope folds the plane into mirror wedges first.
   No state: every frame is a function of the signal texture.

   Played: time itself is the bass's chronotensity, so the image
   surges when the low end is full and idles when it is not; the kick
   bumps the warp, the snare flashes the ridges, sections change the
   number of mirrors. */
import { COLOR, HUE_STEP } from './common.js';

export default {
  id: 'warp', title: 'Warp', about: 'Domain-warped fractal noise (Perlin 1985), kaleidoscope',
  schema: {
    segments: { type: 'number', min: 1,   max: 16,  step: 1,    default: 6,   group: 'mirror', label: 'mirrors' },
    turn:     { type: 'number', min: -1,  max: 1,   step: 0.01, default: 0.1, group: 'mirror', label: 'turn' },
    scale:    { type: 'number', min: 0.5, max: 8,   step: 0.05, default: 2.2, group: 'noise',  label: 'scale' },
    warp:     { type: 'number', min: 0,   max: 6,   step: 0.05, default: 2.6, group: 'noise',  label: 'warp' },
    speed:    { type: 'number', min: 0,   max: 3,   step: 0.01, default: 1,   group: 'noise',  label: 'speed' },
    contrast: { type: 'number', min: 0.5, max: 4,   step: 0.05, default: 1.6, group: 'color',  label: 'contrast' },
    flash:    { type: 'number', min: 0,   max: 2,   step: 0.01, default: 0,   group: 'color',  label: 'flash' },
    ...COLOR
  },
  patch: {
    routes: [
      { source: 'hit.kick',  target: 'warp',  amount: 0.18, attack: 0,  release: 220 },
      { source: 'hit.snare', target: 'flash', amount: 0.5,  attack: 0,  release: 160 },
      { source: 'band.mid',  target: 'scale', amount: 0.1,  attack: 60, release: 600 },
      { source: 'rms',       target: 'gain',  amount: 0.12, attack: 100, release: 800 }
    ],
    steps: [{ on: 'section', targets: ['segments'], values: [[6], [3], [8], [1], [12], [4]] }, HUE_STEP]
  },
  draw: `
    vec4 pass(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0);
      float t = (AudioLinkGetChronoLoop(1, 0, 400000000u) * 0.12 + u_time * 0.02) * u_speed;
      float seg = floor(u_segments + 0.5);
      if (seg > 1.5) { float s = TAU / seg, a = atan(p.y, p.x) + u_turn * t * 0.3, r = length(p); a = abs(mod(a, s) - s * 0.5); p = r * vec2(cos(a), sin(a)); }
      p *= u_scale;
      vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(3.1, 7.7) - 0.7 * t));
      vec2 r2 = vec2(fbm(p + u_warp * q + vec2(4.4, 1.9) + 0.3 * t), fbm(p + u_warp * q + vec2(9.6, 5.3) - 0.25 * t));
      float f = fbm(p + u_warp * r2);
      vec3 col = theme(f * 1.4 + 0.5 * length(q));
      col = mix(col, themeColor(2), 0.4 * clamp(length(r2) * 1.4 - 0.8, 0.0, 1.0));
      col *= pow(smoothstep(0.22, 0.82, f), u_contrast) * 1.6;   // deep valleys stay black: the form reads, not a wash
      col += u_flash * pow(clamp(f * 1.5, 0.0, 1.0), 4.0) * themeColor(3);
      col *= smoothstep(1.25, 0.25, length(uv - 0.5) * 1.6);
      return vec4(col * u_gain, 1.0);
    }`
};
