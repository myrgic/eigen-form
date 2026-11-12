/* Tunnel: the band history, flown through.
   AudioLink keeps each band's recent past along the x axis of its
   texture, newest first. Read with radius as the index and the centre
   is "now": every hit starts in the middle and travels out to the edge
   as it ages, which is the look AudioLink worlds are known for. Four
   bands take turns around the walls; notes are sparks that fly out at
   an angle set by their pitch. No state.

   Played: nothing is routed onto the walls at all. They ARE the
   signal. The patch only drives the camera: twist on the highs'
   chronotensity, a flash on the kick, wall count by section. */
import { COLOR, HUE_STEP } from './common.js';

export default {
  id: 'tunnel', title: 'Tunnel', about: 'AudioLink band history, centre-out',
  schema: {
    segments: { type: 'number', min: 4,    max: 32,  step: 4,    default: 12,  group: 'walls',  label: 'walls' },
    reach:    { type: 'number', min: 0.2,  max: 2,   step: 0.01, default: 0.9, group: 'walls',  label: 'history shown' },
    rings:    { type: 'number', min: 0,    max: 12,  step: 0.1,  default: 4,   group: 'walls',  label: 'ribs' },
    speed:    { type: 'number', min: 0,    max: 3,   step: 0.01, default: 1,   group: 'camera', label: 'speed' },
    twist:    { type: 'number', min: -2,   max: 2,   step: 0.01, default: 0.5, group: 'camera', label: 'twist' },
    flash:    { type: 'number', min: 0,    max: 2,   step: 0.01, default: 0,   group: 'camera', label: 'flash' },
    notes:    { type: 'number', min: 0,    max: 3,   step: 0.01, default: 1.2, group: 'sparks', label: 'note sparks' },
    ...COLOR
  },
  patch: {
    routes: [
      { source: 'hit.kick', target: 'flash', amount: 0.4,  attack: 0,  release: 140 },
      { source: 'band.bass', target: 'reach', amount: 0.08, attack: 40, release: 500 }
    ],
    steps: [{ on: 'section', targets: ['segments'], values: [[12], [8], [16], [4], [24]] }, HUE_STEP]
  },
  draw: `
    vec4 pass(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0);
      float r = length(p) + 1e-4, a = atan(p.y, p.x);
      float spin = AudioLinkGetChronoLoop(1, 3, 628319u) * u_twist + r * u_twist * 0.6;
      float seg = floor(u_segments / 4.0 + 0.5) * 4.0;
      float sa = (a + spin) / TAU * seg;
      int b = int(mod(floor(sa), 4.0));
      float cell = abs(fract(sa) - 0.5) * 2.0;                       // 0 at the middle of a wall, 1 at its seam
      float idx = clamp(r / u_reach * 150.0, 0.0, 126.0);            // radius -> how long ago
      float lvl = AudioLinkLerp(vec2(idx, float(b))).r;
      float lit = 1.0 - smoothstep(lvl * 0.9, lvl * 0.9 + 0.06, cell);
      float flow = AudioLinkGetChronoLoop(0, 0, 400000000u) * 0.25 * u_speed + u_time * 0.2 * u_speed;
      float rib = 0.55 + 0.45 * cos(TAU * (log(r) * u_rings - flow));
      vec3 col = themeColor(b) * lit * rib * (0.25 + 1.9 * lvl);
      col += themeColor(b) * (0.07 + 0.09 * rib) * (1.0 - cell) * smoothstep(1.1, 0.2, r);   // the wall itself, so a quiet band is dim, not gone
      col *= smoothstep(0.0, 0.12, r);                               // the far end is dark
      col += theme(a / TAU) * u_flash * 0.5 * exp(-r * 9.0);         // the kick, at the vanishing point

      for (int i = 0; i < 28; i++) {
        vec4 n = AudioLinkData(ALPASS_MYRGIC_NOTES + ivec2(i, 0));   // pitch, velocity, age, track
        if (n.y <= 0.0 || n.z > 2.5) continue;
        float na = n.x * TAU * 2.0 + n.w * 0.7, nr = n.z * 0.45 * (0.6 + u_speed);
        float d = length(p - nr * vec2(cos(na), sin(na)));
        col += theme(n.x * 2.0 + 0.5) * n.y * u_notes * exp(-d * d / (0.00006 + 0.0007 * nr)) * exp(-n.z * 1.4);
      }
      return vec4(col * u_gain, 1.0);
    }`
};
