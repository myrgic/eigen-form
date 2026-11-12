/* =====================================================================
   apps/physarum_live/patch.js — what makes this app THIS instrument:
   the knobs it declares, the patch it opens with, and what each event
   does to the colony.

   Split out of index.html so there is exactly one definition of the
   instrument and two players of it: the live page (index.html) and the
   offline renderer (tools/render_physarum.mjs). A video is the
   instrument played by a score, not a second implementation of it.

   No DOM here: importable from node.
   ===================================================================== */

const schema = {
  sensorAngle: { type: 'angle',  min: 5,    max: 90,    step: 1,     unit: 'deg', default: 33,   group: 'sense', label: 'sensor angle' },
  sensorDist:  { type: 'number', min: 2,    max: 40,    step: 0.5,   unit: 'px',  default: 8,    group: 'sense', label: 'sensor reach' },
  rotateAngle: { type: 'angle',  min: 5,    max: 90,    step: 1,     unit: 'deg', default: 28,   group: 'sense', label: 'turn angle' },
  speed:       { type: 'number', min: 0.3,  max: 4,     step: 0.05,  unit: 'px',  default: 1.2,  group: 'move',  label: 'speed' },
  wander:      { type: 'number', min: 0,    max: 1.5,   step: 0.01,  unit: 'rad', default: 0.06, group: 'move',  label: 'wander' },
  deposit:     { type: 'number', min: 0.1,  max: 3,     step: 0.05,               default: 1,    group: 'trail', label: 'deposit' },
  decay:       { type: 'number', min: 0.8,  max: 0.995, step: 0.001,              default: 0.9,  group: 'trail', label: 'persistence', scale: 'log-complement' },
  diffuse:     { type: 'number', min: 0,    max: 1,     step: 0.01,               default: 0.7,  group: 'trail', label: 'diffusion' },
  crowd:       { type: 'number', min: 1,    max: 60,    step: 0.5,                default: 10,   group: 'colony', label: 'crowding limit', scale: 'log' },
  spores:      { type: 'number', min: 0,    max: 0.03,  step: 0.0005,             default: 0.005, group: 'colony', label: 'spores' },
  attract:     { type: 'number', min: 0,    max: 10,    step: 0.1,                default: 1.2,  group: 'events', label: 'pull of events' },
  hue:         { type: 'angle',  min: 0,    max: 360,   step: 1,     unit: 'deg', default: 165,  group: 'color', label: 'hue' },
  spread:      { type: 'number', min: 0,    max: 180,   step: 1,     unit: 'deg', default: 70,   group: 'color', label: 'hue spread' },
  gain:        { type: 'number', min: 0.03, max: 1,     step: 0.005,              default: 0.085, group: 'color', label: 'exposure', scale: 'log' },
  bloom:       { type: 'number', min: 0,    max: 1,     step: 0.01,               default: 0.3,  group: 'stage', label: 'bloom' }
};

// How the music plays the colony. Routes bend the model's own
// parameters; triggers reach into its field.
//   bass     lengthens the sensors: the network coarsens into thick veins
//   sub      speeds the agents up
//   highs    make them wander: fine structure frays
//   kick     a ring of attractant expands from the centre; the colony chases it
//   snare    a fraction of agents lose their heading: veins shatter and re-knit
//   a note   food appears at a place set by its pitch (angle) and its track (radius)
//   section  every agent loses its heading at once: the mesh dissolves and re-forms in place
const DEFAULT_PATCH = {
  offsetMs: 0,
  routes: [
    { source: 'band.bass', target: 'sensorDist',  amount: 0.26, attack: 30,  release: 320 },
    { source: 'band.sub',  target: 'speed',       amount: 0.16, attack: 10,  release: 220 },
    { source: 'band.high', target: 'wander',      amount: 0.22, attack: 20,  release: 300 },
    { source: 'hit.snare', target: 'rotateAngle', amount: 0.30, attack: 0,   release: 260 },
    { source: 'hit.kick',  target: 'bloom',       amount: 0.40, attack: 0,   release: 240 },
    { source: 'rms',       target: 'gain',        amount: 0.08, attack: 120, release: 900 }
  ],
  triggers: [
    { on: 'hit.kick',  action: 'pulse',   amount: 1 },
    { on: 'hit.snare', action: 'scatter', amount: 0.22 },
    { on: 'note.any',  action: 'seed',    amount: 0.8 },
    { on: 'section',   action: 'scatter', amount: 1 }
  ],
  steps: [
    { on: 'bar', every: 8, targets: ['hue'], values: [[165], [285], [35], [215]] }
  ]
};

// What each event does. `sim()` returns the current colony (the page rebuilds it on resize);
// `strength` is the router's (velocity x amount); `meta` is the note behind the event.
// `random` is injectable so an offline render is reproducible.
function createActions(sim, { spawns, random = Math.random } = {}) {
  const trackRows = new Map();                             // track name -> radius band, in order of first appearance
  let spawnIndex = 0;
  return function trigger(action, strength, meta) {
    const s = sim();
    if (!s || !(strength > 0)) return;
    const W = s.width, H = s.height, R = Math.min(W, H);
    if (action === 'pulse') s.pulse(Math.min(1.5, strength));
    else if (action === 'scatter') s.scatter(Math.min(1, strength));
    else if (action === 'seed') {
      let x, y;
      if (meta && meta.pitch != null) {
        // pitch winds twice around the centre across the playable range; each track keeps its own orbit
        if (!trackRows.has(meta.track)) trackRows.set(meta.track, trackRows.size);
        const band = trackRows.get(meta.track) % 5, a = meta.pitch * Math.PI * 4 - Math.PI / 2;
        const rad = R * (0.14 + 0.075 * band);
        x = W / 2 + rad * Math.cos(a) * (W / H > 1.4 ? 1.35 : 1); y = H / 2 + rad * Math.sin(a);
      } else { x = random() * W; y = random() * H; }       // an onset with no score behind it
      s.seed(x, y, Math.min(1.5, strength));
    } else if (action === 'respawn' && spawns && spawns.length) { spawnIndex++; s.respawn(spawns[spawnIndex % spawns.length]); }
  };
}

// The model's parameter object from effective knob values. value(key) -> number.
const DEG = Math.PI / 180;
function modelParams(value, out = {}) {
  out.sa = value('sensorAngle') * DEG; out.ra = value('rotateAngle') * DEG; out.sensorDist = value('sensorDist');
  out.speed = value('speed'); out.wander = value('wander'); out.deposit = value('deposit');
  out.decay = value('decay'); out.diffuse = value('diffuse'); out.attract = value('attract');
  out.crowd = value('crowd'); out.spores = value('spores');
  return out;
}

export { schema, DEFAULT_PATCH, createActions, modelParams };
export default { schema, DEFAULT_PATCH, createActions, modelParams };
