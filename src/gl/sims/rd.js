/* Reaction-diffusion: the Gray-Scott model.
   Two chemicals on a grid; U is fed in, V eats U to make more V, V
   decays. Feed and kill rate alone decide whether the field makes
   spots, stripes, dividing cells, coral or chaos.
     Pearson, "Complex Patterns in a Simple System", Science 261 (1993).
   Integration: explicit Euler, dt = 1, Du = 1, Dv = 0.5, nine-point
   Laplacian (0.2 edges, 0.05 corners), several steps per frame.

   Played: sections move (feed, kill) between regimes; every note seeds
   V at its place; the kick stirs V everywhere; the snare drops a
   scatter of seeds. `spores` keeps a trickle of V arriving so a regime
   that would die out under the music never leaves the stage empty.

   Anticipated (needs a source that knows the future, i.e. the embedded
   song): through the last bar before a section change `wither` rises,
   the kill rate climbs with it and the stage empties; on the downbeat a
   flower is drawn in V in one step and the new regime grows from it.
   Without a schedule wither stays at zero and the flower still lands
   on the change, as it is seen. */
import { COLOR, HUE_STEP } from './common.js';
import { placeNote } from '../runtime.js';

const SIZE = [640, 360];
let flower = null;                      // set by the action, drawn in the next step, then cleared
export default {
  id: 'rd', title: 'Reaction-diffusion', about: 'Gray-Scott (Pearson 1993)',
  schema: {
    feed:    { type: 'number', min: 0.01,  max: 0.09,  step: 0.0005, default: 0.03,   group: 'chemistry', label: 'feed' },
    kill:    { type: 'number', min: 0.045, max: 0.07,  step: 0.0002, default: 0.055,  group: 'chemistry', label: 'kill' },
    spores:  { type: 'number', min: 0,     max: 1,     step: 0.01,   default: 0.25,   group: 'chemistry', label: 'spores' },
    stir:    { type: 'number', min: 0,     max: 1,     step: 0.01,   default: 0,      group: 'chemistry', label: 'stir' },
    wither:  { type: 'number', min: 0,     max: 1,     step: 0.01,   default: 0,      group: 'chemistry', label: 'wither' },
    rate:    { type: 'number', min: 1,     max: 24,    step: 1,      default: 12,     group: 'time',      label: 'steps per frame' },
    relief:  { type: 'number', min: 0,     max: 1,     step: 0.01,   default: 0.6,    group: 'color',     label: 'relief' },
    ...COLOR
  },
  patch: {
    routes: [
      { source: 'hit.kick',  target: 'stir',   amount: 0.5,  attack: 0,  release: 140 },
      { source: 'until.section', target: 'wither', amount: 1, leadBars: 1, attack: 0, release: 120, curve: 'sq' },
      { source: 'band.bass', target: 'rate',   amount: 0.3,  attack: 20, release: 300 },
      { source: 'hit.snare', target: 'relief', amount: 0.35, attack: 0,  release: 200 },
      { source: 'rms',       target: 'gain',   amount: 0.12, attack: 100, release: 800 }
    ],
    triggers: [
      { on: 'note.any',  action: 'seed',    amount: 0.9 },
      { on: 'hit.snare', action: 'scatter', amount: 0.6 },
      { on: 'section',   action: 'flower',  amount: 1 }
    ],
    steps: [
      // Regimes by section, all from the fast side of Pearson's map (kill <= 0.058): a section is 8 or 16 bars
      // and starts from one flower, so a regime has to cross the stage in seconds. The slow, pretty ones
      // (mitosis 0.0367/0.0649, spots 0.035/0.065, worms 0.046/0.0632) left the stage near empty for a
      // third of a full-song render.
      { on: 'section', targets: ['feed', 'kill'], values: [[0.03, 0.055], [0.039, 0.058], [0.029, 0.057], [0.026, 0.051], [0.026, 0.055]] },
      HUE_STEP
    ]
  },
  extraUniforms: ['vec4 u_flower', 'vec2 u_petals'],
  uniforms() { const f = flower; flower = null; return f ? { u_flower: [f.x, f.y, f.r, f.strength], u_petals: [f.petals, f.turn] } : { u_flower: [0, 0, 0, 0], u_petals: [5, 0] }; },
  buffers: { chem: { size: SIZE, wrap: 'repeat' } },
  init: { chem: `
    vec4 pass(vec2 uv) {
      vec2 g = uv * vec2(u_chemRes.x / u_chemRes.y, 1.0) * 9.0;
      float seed = step(0.86, hash21(floor(g))) * smoothstep(0.35, 0.1, length(fract(g) - 0.5));
      return vec4(1.0, seed, 0.0, 1.0);
    }` },
  passes: [{
    target: 'chem',
    iterations: (v) => Math.max(1, Math.round(v('rate'))),
    src: `
    vec4 pass(vec2 uv) {
      vec2 t = u_texel, c = texture(u_chem, uv).xy;
      vec2 lap = 0.2 * (texture(u_chem, uv + vec2(t.x, 0)).xy + texture(u_chem, uv - vec2(t.x, 0)).xy + texture(u_chem, uv + vec2(0, t.y)).xy + texture(u_chem, uv - vec2(0, t.y)).xy)
               + 0.05 * (texture(u_chem, uv + t).xy + texture(u_chem, uv - t).xy + texture(u_chem, uv + vec2(t.x, -t.y)).xy + texture(u_chem, uv + vec2(-t.x, t.y)).xy) - c;
      float a = c.x, b = c.y, r = a * b * b;
      a += lap.x - r + u_feed * (1.0 - a);
      b += 0.5 * lap.y + r - (u_kill + 0.02 * u_wither + u_feed) * b;
      if (u_iter == 0) {
        for (int i = 0; i < u_splatCount; i++) b += u_splat[i].w * splatAt(uv, i);
        vec2 cell = floor(uv * u_chemRes / 3.0);
        b += 0.5 * u_spores * step(0.99985, hash21(cell + float(u_frame) * 17.0));       // a trickle of new V
        // the kick stirs what is there: zero on average and in proportion, so it can neither flood nor empty the field
        b *= 1.0 + 0.7 * u_stir * (vnoise(uv * vec2(u_aspect, 1.0) * 24.0 + float(u_frame) * 0.37) - 0.5);
        if (u_flower.w > 0.0) {                                                           // petal outlines and a centre, in V
          vec2 d = uv - u_flower.xy; d.x *= u_aspect;
          float rr = length(d), edge = u_flower.z * (0.4 + 0.6 * abs(cos(0.5 * u_petals.x * atan(d.y, d.x) + u_petals.y)));
          b += u_flower.w * (smoothstep(0.014, 0.004, abs(rr - edge)) + smoothstep(0.03, 0.015, rr));
        }
      }
      return vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
    }`
  }],
  draw: `
    vec4 pass(vec2 uv) {
      vec2 t = 1.0 / u_chemRes, c = texture(u_chem, uv).xy;
      float bx = texture(u_chem, uv + vec2(t.x, 0)).y - texture(u_chem, uv - vec2(t.x, 0)).y;
      float by = texture(u_chem, uv + vec2(0, t.y)).y - texture(u_chem, uv - vec2(0, t.y)).y;
      vec3 n = normalize(vec3(-bx, -by, 0.12 - 0.09 * u_relief));
      float lit = clamp(dot(n, normalize(vec3(0.45, 0.6, 0.65))), 0.0, 1.0);
      float v = smoothstep(0.04, 0.32, c.y);
      vec3 col = theme(c.y * 1.6 + 0.25 * (1.0 - c.x)) * (0.03 + 1.0 * v) * (0.45 + 0.85 * lit);
      col += pow(lit, 14.0) * 0.5 * v * u_relief;
      col += themeColor(3) * 0.035 * (1.0 - c.x);
      return vec4(col * u_gain, 1.0);
    }`,
  actions(api) {
    const rows = new Map();
    return (action, strength, meta) => {
      if (action === 'seed') { const [x, y] = placeNote(meta, rows, api.aspect()); api.splat({ x, y, r: 0.018 + 0.012 * strength, strength: 0.55 * strength }); }
      else if (action === 'scatter') { for (let i = 0; i < 6; i++) api.splat({ x: Math.random(), y: Math.random(), r: 0.02, strength: 0.6 * strength }); }
      else if (action === 'flower') flower = { x: 0.5, y: 0.5, r: 0.36, strength: 0.9 * strength, petals: 5 + ((meta && Number.isInteger(meta.index) ? meta.index : 0) % 4), turn: Math.random() * 6.283 };
      else if (action === 'reset') api.reset();
    };
  }
};
