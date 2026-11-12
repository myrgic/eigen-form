/* Fluid with dye: Stam's stable fluids.
   Each step: carry the velocity along itself (semi-Lagrangian, which
   is what makes it unconditionally stable), add forces, then remove
   the divergence by solving for pressure (Jacobi) and subtracting its
   gradient. The dye rides the result.
     Stam, "Stable Fluids", SIGGRAPH 1999.
   No viscosity pass: the advection's own smoothing is plenty at this
   resolution. Velocity is in stage-heights per second.

   Played: the kick is a radial shove from the centre; every note is a
   blob of dye at its place, pushed along its orbit, coloured by where
   it sits in the palette; a slow divergence-free stir, clocked by the
   bass's chronotensity, keeps the tank moving when the music thins. */
import { COLOR, HUE_STEP } from './common.js';
import { placeNote, hsv } from '../runtime.js';

const VEL = [256, 144], DYE = [768, 432];
export default {
  id: 'fluid', title: 'Fluid', about: 'Stable fluids (Stam 1999)',
  schema: {
    swirl:   { type: 'number', min: 0,    max: 2,     step: 0.01,  default: 0.5,   group: 'flow', label: 'stir' },
    scale:   { type: 'number', min: 0.5,  max: 8,     step: 0.05,  default: 2.4,   group: 'flow', label: 'stir size' },
    carry:   { type: 'number', min: 0.9,  max: 0.999, step: 0.001, default: 0.985, group: 'flow', label: 'momentum', scale: 'log-complement' },
    hold:    { type: 'number', min: 0.9,  max: 0.999, step: 0.001, default: 0.988, group: 'dye',  label: 'dye persistence', scale: 'log-complement' },
    push:    { type: 'number', min: 0,    max: 3,     step: 0.01,  default: 1,     group: 'flow', label: 'event force' },
    ink:     { type: 'number', min: 0,    max: 3,     step: 0.01,  default: 1,     group: 'dye',  label: 'ink' },
    ...COLOR
  },
  patch: {
    routes: [
      { source: 'band.bass', target: 'swirl', amount: 0.3,  attack: 30, release: 400 },
      { source: 'band.high', target: 'ink',   amount: 0.25, attack: 20, release: 300 },
      { source: 'rms',       target: 'gain',  amount: 0.14, attack: 100, release: 800 }
    ],
    triggers: [
      { on: 'hit.kick',  action: 'burst', amount: 1 },
      { on: 'hit.snare', action: 'cross', amount: 0.8 },
      { on: 'note.any',  action: 'ink',   amount: 1 }
    ],
    steps: [HUE_STEP]
  },
  buffers: { vel: { size: VEL, wrap: 'clamp' }, prs: { size: VEL, wrap: 'clamp' }, dye: { size: DYE, wrap: 'clamp' } },
  passes: [
    { target: 'vel', src: `
      vec4 pass(vec2 uv) {
        vec2 v = texture(u_vel, uv).xy;
        vec2 nv = texture(u_vel, uv - v * u_dt * vec2(1.0 / u_aspect, 1.0)).xy * u_carry;
        // stir: the curl of a noise field is divergence-free, so it moves the fluid without piling it up
        float e = 0.02, ct = AudioLinkGetChronoLoop(1, 0, 400000000u) * 0.06 + u_time * 0.03;
        vec2 q = uv * vec2(u_aspect, 1.0) * u_scale + vec2(0.0, ct);
        nv += vec2(fbm(q + vec2(0, e)) - fbm(q - vec2(0, e)), fbm(q - vec2(e, 0)) - fbm(q + vec2(e, 0))) / (2.0 * e) * u_swirl * u_dt * 0.6;
        for (int i = 0; i < u_splatCount; i++) {
          vec2 d = uv - u_splat[i].xy; d.x *= u_aspect;
          vec2 dir = u_splatColor[i].a > 0.5 ? d / (length(d) + 0.02) : u_splatDir[i].xy;
          nv += dir * u_splat[i].w * u_push * splatAt(uv, i);
        }
        // the walls: no flow through the edge
        vec2 edge = smoothstep(vec2(0.0), 2.0 * u_texel, uv) * smoothstep(vec2(0.0), 2.0 * u_texel, 1.0 - uv);
        return vec4(nv * edge, 0.0, 1.0);
      }` },
    { target: 'prs', iterations: 22, src: `
      vec4 pass(vec2 uv) {
        vec2 t = u_texel;
        float div = 0.5 * (texture(u_vel, uv + vec2(t.x, 0)).x - texture(u_vel, uv - vec2(t.x, 0)).x + texture(u_vel, uv + vec2(0, t.y)).y - texture(u_vel, uv - vec2(0, t.y)).y);
        float p = texture(u_prs, uv + vec2(t.x, 0)).x + texture(u_prs, uv - vec2(t.x, 0)).x + texture(u_prs, uv + vec2(0, t.y)).x + texture(u_prs, uv - vec2(0, t.y)).x;
        return vec4((p - div) * 0.25, 0.0, 0.0, 1.0);
      }` },
    { target: 'vel', src: `
      vec4 pass(vec2 uv) {
        vec2 t = u_texel;
        vec2 grad = 0.5 * vec2(texture(u_prs, uv + vec2(t.x, 0)).x - texture(u_prs, uv - vec2(t.x, 0)).x, texture(u_prs, uv + vec2(0, t.y)).x - texture(u_prs, uv - vec2(0, t.y)).x);
        return vec4(texture(u_vel, uv).xy - grad, 0.0, 1.0);
      }` },
    { target: 'dye', src: `
      vec4 pass(vec2 uv) {
        vec2 v = texture(u_vel, uv).xy;
        vec3 d = texture(u_dye, uv - v * u_dt * vec2(1.0 / u_aspect, 1.0)).rgb * u_hold;
        for (int i = 0; i < u_splatCount; i++) d += u_splatColor[i].rgb * u_splatDir[i].z * u_ink * splatAt(uv, i);
        return vec4(max(d, vec3(0.0)), 1.0);
      }` }
  ],
  draw: `
    vec4 pass(vec2 uv) {
      vec3 d = texture(u_dye, uv).rgb;
      vec3 col = 1.0 - exp(-d * 1.4 * u_gain);
      return vec4(col, 1.0);
    }`,
  actions(api) {
    const rows = new Map();
    let n = 0;
    return (action, strength, meta) => {
      const hue = api.value('hue'), spread = api.value('spread');
      if (action === 'burst') api.splat({ x: 0.5, y: 0.5, r: 0.16, strength: 0.9 * strength, radial: true, color: hsv(hue, 0.7, 1), dir: [0, 0, 0.12 * strength] });   // a shove, and a breath of dye so it shows
      else if (action === 'cross') {                       // two jets across the tank, alternating axis
        const h = (n++ % 2) === 0;
        api.splat({ x: h ? 0.12 : 0.5, y: h ? 0.5 : 0.12, r: 0.07, strength: 1.4 * strength, dir: h ? [1, 0, 0.5] : [0, 1, 0.5], color: hsv(hue + 180, 0.5, 1) });
        api.splat({ x: h ? 0.88 : 0.5, y: h ? 0.5 : 0.88, r: 0.07, strength: 1.4 * strength, dir: h ? [-1, 0, 0.5] : [0, -1, 0.5], color: hsv(hue + 180, 0.5, 1) });
      } else if (action === 'ink') {
        const [x, y] = placeNote(meta, rows, api.aspect());
        const a = Math.atan2(y - 0.5, (x - 0.5) * api.aspect()) + Math.PI / 2, p = meta && meta.pitch != null ? meta.pitch : Math.random();
        api.splat({ x, y, r: 0.022 + 0.02 * strength, strength: 0.5 * strength, dir: [Math.cos(a), Math.sin(a), 0.9 * strength], color: hsv(hue + spread * (p * 2 - 1), 0.85, 1) });
      } else if (action === 'reset') api.reset();
    };
  }
};
