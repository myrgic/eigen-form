/* =====================================================================
   apps/aquarium/engine/kernel.js — the kernel spec: the data structure
   every backend (cpu.js, webgl2.js) reads and executes identically.

   docs/executable-experiments-design.md, "The shader correspondence":
   primitives are authored as kernel specs (operation, stencil, state,
   parameters), the CPU path is the reference semantics, and any
   accelerated backend is a checked projection of that same spec. This
   module is where that spec lives as data — chemistry, sensing, and
   motor effects are declared here, never hand-coded per simulation.

   NO DOM. NO CANVAS. NO RANDOMNESS AT DEFINITION TIME. This module only
   validates shape and freezes it; cpu.js and webgl2.js are the two
   things that ever execute a spec.

   ---------------------------------------------------------------------
   Grammar
   ---------------------------------------------------------------------

   A full spec passed to defineSubstrate() has this shape:

     {
       width, height,                 // grid dimensions, shared by every
                                       // channel (a deliberate simplification
                                       // over the welded-fields prior art,
                                       // which ran the momentum/hormone
                                       // fields at a coarser resolution as a
                                       // render-cost optimization — see
                                       // docs/agent-substrate-engine.md,
                                       // "Simplifications from the prior art")
       seed,                          // uint32 seed threading every rand01 call
       channels: [ ChannelSpec, ... ],
       reactions: [ ReactionSpec, ... ],   // optional, run in declared order
                                            // after every channel's own
                                            // diffuse/decay/advect
       population: PopulationSpec | null,  // optional — a pure field spec
                                            // (no agents) is legal
       tolerance: {                   // the twin protocol's declared pass/fail
         relL2: 1e-3,
         maxAbs: 1e-2,
         agentPos: 1e-2
       }
     }

   ChannelSpec:
     {
       name: 'trail',
       kind: 'scalar' | 'vector',     // vector = 2 floats/cell (vx, vy)
       diffuse: 0..1,                 // blend weight toward the 3x3 declared
                                       // stencil average (0 = no diffusion)
       halfLife: frames | Infinity,   // per-frame multiplicative decay;
                                       // Infinity = no decay
       advectedBy: channelName | null,// must name a `kind: 'vector'` channel;
                                       // semi-Lagrangian advection by it
       boundary: 'wall' | 'wrap' | 'absorb',
       momentum: false,               // true marks this the one channel a
                                       // population's weld may declare
                                       // read.mode:'vector' deposit-scatter
                                       // velocity into, AND the one advection
                                       // sources point at
       projection: { enabled, iterations } | null  // Jacobi divergence-free
                                                     // projection; only legal
                                                     // on a vector channel
     }

   ReactionSpec, one of:
     { type: 'source', channel, rate, cells: [[x,y], ...] }
     { type: 'sink',   channel, rate }                  // rate in (0,1]
     { type: 'decay',  channel, rate }                  // rate in (0,1]
     { type: 'monod',  from, to, rate, halfSaturation }  // A -> B
     { type: 'product', a, b, into, rate }               // into += rate*A*B

   PopulationSpec:
     {
       count,
       boundary: 'wall' | 'wrap' | 'absorb',
       speed: number,                 // base forward speed, cells/step
       scalars: { name: defaultValue, ... },   // free per-agent scalars
       welds: [ WeldSpec, ... ]
     }

   WeldSpec:
     {
       channel,                       // which ChannelSpec this weld reads
       read:
           { mode: 'gradient', sensorDist, sensorAngle }  // 3-sensor F/L/R
         | { mode: 'vector' }                              // bilinear (vx,vy)
         | { mode: 'level' },                               // bilinear scalar
       effect:
           { type: 'steerByAngle', gain }                   // needs 'gradient'
         | { type: 'alignAndAdvect', align, advect }         // needs 'vector'
         | { type: 'rescale', scalar, gain },                // needs 'level'
       deposit: { channel, amount } | null   // vector channel => amount is
                                              // scaled by the agent's own
                                              // velocity, per weld
     }

   ---------------------------------------------------------------------
   Capabilities added for the aquarium (2026-09-11), additive only
   ---------------------------------------------------------------------

   Everything above this note is exactly as it shipped with the engine.
   The aquarium spec (apps/aquarium/spec.js) needed a few things the
   grammar above could not express; each was added here, to BOTH
   cpu.js and webgl2.js, and covered in tests/aquarium-engine.js, per
   docs/agent-substrate-engine.md's promotion path — not hand-coded in
   the app. None of these change what an existing spec (physarum,
   boids) means; every one is a new branch, never a rewrite of an old
   one.

     populations: [ PopulationSpec & { name }, ... ]  // plural, NAMED.
       An aquarium needs several heterogeneous agent kinds (fish,
       plankton, bubbles) sharing one channel substrate, not one
       homogeneous population. `population` (singular) is untouched;
       `populations` is the general n-populations-per-spec case. A spec
       may declare either, or both. Execution order (both backends):
       the singular population first (if present), then each named
       population in declared array order — see cpu.js's
       populationList() / webgl2.js's populationEntries().

     read.mode: 'none' + effect.type: 'wobble'  // { amount }
       A weld that perturbs heading by amount * a signed hash-RNG draw
       (same addressing as steerByAngle's tie-break: seed, agentIndex,
       step, a declared stream id) and reads no channel. Needed for
       bubbles' upward drift-with-jitter, which isn't steered by any
       field.

     reactions: 'buoyancy' | 'relax' | 'exchange' | 'nitrify'
       Four new per-cell (no neighbour stencil) reaction types, ported
       to GPU as plain fullscreen passes exactly like the original
       five:
         buoyancy  { velocity, temperature, beta, reference }
                   velocity.y -= beta * (temperature - reference)
                   (Boussinesq; up is -y, row 0 is the surface)
         relax     { channel, mask, target, rate }
                   channel += rate * mask * (target - channel)
                   (Newton cooling: mask = 1 at the surface row)
         exchange  { channel, driver (vector), mask, target, rate }
                   channel += rate * mask * |driver| * (target - channel)
                   (surface gas exchange, faster where the flow is more
                   agitated)
         nitrify   { substrate, product, bacteria, mask, growthRate,
                     halfSaturation, carryingCapacity, yieldFactor,
                     deathRate }
                   Monod uptake of substrate by a spatial bacteria
                   population that itself grows logistically on that
                   substrate, both gated by a static filter-media mask
                   — one declared reaction for "a fresh filter cycles",
                   applied twice (ammonia->nitrite, nitrite->nitrate)
                   with two independent bacteria channels.
     ===================================================================== */

const BOUNDARY_MODES = new Set(['wall', 'wrap', 'absorb']);
const CHANNEL_KINDS = new Set(['scalar', 'vector']);
// 'none' (aquarium addition, 2026-09-11): pairs with effect 'wobble' — a
// weld that perturbs heading from the RNG alone, reading no field. See
// EFFECT_TYPES' 'wobble' entry and docs/agent-substrate-engine.md's
// "Capabilities added for the aquarium" for why this is a read mode
// rather than a special-cased no-read effect: every weld still has one
// declared read mode, so a backend never has to ask "does this weld read
// anything?" before dispatching on it.
const READ_MODES = new Set(['gradient', 'vector', 'level', 'none']);
// 'wobble' (aquarium addition, 2026-09-11): heading += amount * a signed
// hash-RNG draw, addressed the same way steerByAngle's tie-break draw
// already is (seed, agentIndex, step, stream). Needed for the bubble
// population's upward drift with a jitter that isn't steered by any
// field — no existing effect can express "perturb heading from noise
// alone" without pretending to read a field it doesn't use.
const EFFECT_TYPES = new Set(['steerByAngle', 'alignAndAdvect', 'rescale', 'wobble']);
// buoyancy/relax/exchange/nitrify (aquarium addition, 2026-09-11): see
// docs/agent-substrate-engine.md, "Capabilities added for the aquarium",
// for the full grammar and why each is a genuine new reaction type
// rather than expressible via the original five. All four are declared,
// per-cell, and ported to both cpu.js and webgl2.js (no CPU-only carve-
// out), with coverage in tests/aquarium-engine.js.
const REACTION_TYPES = new Set(['source', 'sink', 'decay', 'monod', 'product', 'buoyancy', 'relax', 'exchange', 'nitrify']);

function fail(msg) {
  throw new Error(`aquarium/kernel: ${msg}`);
}

function assertFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number, got ${JSON.stringify(value)}`);
  }
}

function validateChannel(ch, index) {
  if (!ch || typeof ch !== 'object') fail(`channels[${index}] must be an object`);
  if (typeof ch.name !== 'string' || !ch.name) fail(`channels[${index}].name must be a non-empty string`);
  if (!CHANNEL_KINDS.has(ch.kind)) fail(`channels[${index}] (${ch.name}) has invalid kind "${ch.kind}"`);
  if (typeof ch.diffuse !== 'number' || ch.diffuse < 0 || ch.diffuse > 1) {
    fail(`channels[${index}] (${ch.name}).diffuse must be in [0, 1]`);
  }
  if (ch.halfLife !== Infinity) assertFinite(ch.halfLife, `channels[${index}] (${ch.name}).halfLife`);
  if (ch.halfLife <= 0) fail(`channels[${index}] (${ch.name}).halfLife must be > 0 or Infinity`);
  if (!BOUNDARY_MODES.has(ch.boundary)) fail(`channels[${index}] (${ch.name}) has invalid boundary "${ch.boundary}"`);
  if (ch.advectedBy != null && typeof ch.advectedBy !== 'string') {
    fail(`channels[${index}] (${ch.name}).advectedBy must be a channel name or null`);
  }
  if (ch.projection) {
    if (ch.kind !== 'vector') fail(`channels[${index}] (${ch.name}): projection is only legal on a vector channel`);
    if (typeof ch.projection.iterations !== 'number' || ch.projection.iterations < 1) {
      fail(`channels[${index}] (${ch.name}).projection.iterations must be >= 1`);
    }
  }
}

function validateReaction(r, index, channels) {
  if (!r || !REACTION_TYPES.has(r.type)) fail(`reactions[${index}] has invalid type "${r && r.type}"`);
  const wantChannel = (key) => {
    if (!channels.has(r[key])) fail(`reactions[${index}] (${r.type}).${key} "${r[key]}" is not a declared channel`);
  };
  const wantKind = (key, kind) => {
    if (channels.get(r[key]).kind !== kind) fail(`reactions[${index}] (${r.type}).${key} must be a ${kind} channel`);
  };
  if (r.type === 'source') {
    wantChannel('channel');
    assertFinite(r.rate, `reactions[${index}].rate`);
    if (!Array.isArray(r.cells) || r.cells.length === 0) fail(`reactions[${index}] (source) needs a non-empty cells array`);
    // Aquarium addition: a source on a vector channel (the filter jet /
    // intake are fixed-location momentum injections, not scalar
    // deposits) needs a direction, not just a rate.
    if (r.vector != null) {
      wantKind('channel', 'vector');
      if (!Array.isArray(r.vector) || r.vector.length !== 2) fail(`reactions[${index}] (source).vector must be [x, y]`);
      assertFinite(r.vector[0], `reactions[${index}].vector[0]`);
      assertFinite(r.vector[1], `reactions[${index}].vector[1]`);
    } else {
      wantKind('channel', 'scalar');
    }
  } else if (r.type === 'sink' || r.type === 'decay') {
    wantChannel('channel');
    assertFinite(r.rate, `reactions[${index}].rate`);
    if (r.rate <= 0 || r.rate > 1) fail(`reactions[${index}] (${r.type}).rate must be in (0, 1]`);
  } else if (r.type === 'monod') {
    wantChannel('from'); wantChannel('to');
    assertFinite(r.rate, `reactions[${index}].rate`);
    assertFinite(r.halfSaturation, `reactions[${index}].halfSaturation`);
  } else if (r.type === 'product') {
    wantChannel('a'); wantChannel('b'); wantChannel('into');
    assertFinite(r.rate, `reactions[${index}].rate`);
  } else if (r.type === 'buoyancy') {
    // Aquarium addition: Boussinesq buoyancy — velocity.y -= beta *
    // (temperature - reference) at every cell (up is -y, row 0 is the
    // surface). Purely local, no neighbour reads, ported to GPU as one
    // fullscreen pass reading two textures.
    wantChannel('velocity'); wantKind('velocity', 'vector');
    wantChannel('temperature'); wantKind('temperature', 'scalar');
    assertFinite(r.beta, `reactions[${index}].beta`);
    assertFinite(r.reference, `reactions[${index}].reference`);
  } else if (r.type === 'relax') {
    // Aquarium addition: channel += rate * mask * (target - channel).
    // Newton cooling at the surface is `relax` with `mask` a static
    // channel that is 1 at the surface row and 0 elsewhere.
    wantChannel('channel'); wantKind('channel', 'scalar');
    wantChannel('mask'); wantKind('mask', 'scalar');
    assertFinite(r.target, `reactions[${index}].target`);
    assertFinite(r.rate, `reactions[${index}].rate`);
  } else if (r.type === 'exchange') {
    // Aquarium addition: like `relax`, but the rate is additionally
    // scaled by a vector channel's local magnitude ("agitation") — gas
    // exchange at the surface is faster where the flow is more
    // turbulent. `driver` is read, never written.
    wantChannel('channel'); wantKind('channel', 'scalar');
    wantChannel('driver'); wantKind('driver', 'vector');
    wantChannel('mask'); wantKind('mask', 'scalar');
    assertFinite(r.target, `reactions[${index}].target`);
    assertFinite(r.rate, `reactions[${index}].rate`);
  } else if (r.type === 'nitrify') {
    // Aquarium addition: Monod uptake of `substrate` into `product` by a
    // spatial `bacteria` population that itself grows logistically on
    // that same substrate, both gated by a static `mask` (filter media
    // occupancy, 0..1). One declared reaction expresses "a fresh filter
    // cycles" without hand-coding the nitrogen cycle per simulation —
    // see docs/agent-substrate-engine.md.
    wantChannel('substrate'); wantKind('substrate', 'scalar');
    wantChannel('product'); wantKind('product', 'scalar');
    wantChannel('bacteria'); wantKind('bacteria', 'scalar');
    wantChannel('mask'); wantKind('mask', 'scalar');
    assertFinite(r.growthRate, `reactions[${index}].growthRate`);
    assertFinite(r.halfSaturation, `reactions[${index}].halfSaturation`);
    assertFinite(r.carryingCapacity, `reactions[${index}].carryingCapacity`);
    assertFinite(r.yieldFactor, `reactions[${index}].yieldFactor`);
    assertFinite(r.deathRate, `reactions[${index}].deathRate`);
  }
}

function validateWeld(w, index, channels) {
  if (!w || typeof w !== 'object') fail(`welds[${index}] must be an object`);
  if (!w.read || !READ_MODES.has(w.read.mode)) fail(`welds[${index}].read.mode "${w.read && w.read.mode}" invalid`);
  // 'none' reads no channel — 'wobble' is pure RNG. Every other mode
  // still requires w.channel to name a declared channel, same as before.
  let ch = null;
  if (w.read.mode !== 'none') {
    ch = channels.get(w.channel);
    if (!ch) fail(`welds[${index}].channel "${w.channel}" is not a declared channel`);
  } else if (w.channel != null) {
    ch = channels.get(w.channel);
    if (!ch) fail(`welds[${index}].channel "${w.channel}" is not a declared channel`);
  }
  if (w.read.mode === 'gradient') {
    assertFinite(w.read.sensorDist, `welds[${index}].read.sensorDist`);
    assertFinite(w.read.sensorAngle, `welds[${index}].read.sensorAngle`);
    if (ch.kind !== 'scalar') fail(`welds[${index}]: read.mode 'gradient' needs a scalar channel`);
  }
  if (w.read.mode === 'vector' && ch.kind !== 'vector') {
    fail(`welds[${index}]: read.mode 'vector' needs a vector channel`);
  }
  if (w.read.mode === 'level' && ch.kind !== 'scalar') {
    fail(`welds[${index}]: read.mode 'level' needs a scalar channel`);
  }
  if (!w.effect || !EFFECT_TYPES.has(w.effect.type)) fail(`welds[${index}].effect.type "${w.effect && w.effect.type}" invalid`);
  if (w.effect.type === 'steerByAngle') {
    if (w.read.mode !== 'gradient') fail(`welds[${index}]: effect 'steerByAngle' needs read.mode 'gradient'`);
    assertFinite(w.effect.gain, `welds[${index}].effect.gain`);
  }
  if (w.effect.type === 'alignAndAdvect') {
    if (w.read.mode !== 'vector') fail(`welds[${index}]: effect 'alignAndAdvect' needs read.mode 'vector'`);
    assertFinite(w.effect.align, `welds[${index}].effect.align`);
    assertFinite(w.effect.advect, `welds[${index}].effect.advect`);
  }
  if (w.effect.type === 'rescale') {
    if (w.read.mode !== 'level') fail(`welds[${index}]: effect 'rescale' needs read.mode 'level'`);
    if (typeof w.effect.scalar !== 'string') fail(`welds[${index}].effect.scalar must name a population scalar`);
    assertFinite(w.effect.gain, `welds[${index}].effect.gain`);
  }
  if (w.effect.type === 'wobble') {
    if (w.read.mode !== 'none') fail(`welds[${index}]: effect 'wobble' needs read.mode 'none'`);
    assertFinite(w.effect.amount, `welds[${index}].effect.amount`);
  }
  if (w.deposit != null) {
    const dch = channels.get(w.deposit.channel);
    if (!dch) fail(`welds[${index}].deposit.channel "${w.deposit.channel}" is not a declared channel`);
    assertFinite(w.deposit.amount, `welds[${index}].deposit.amount`);
  }
}

function validatePopulation(pop, channels, opts) {
  if (!pop || typeof pop !== 'object') fail('population must be an object or null');
  if (opts && opts.requireName && (typeof pop.name !== 'string' || !pop.name)) {
    fail('populations[].name must be a non-empty string');
  }
  if (!Number.isInteger(pop.count) || pop.count <= 0) fail('population.count must be a positive integer');
  if (!BOUNDARY_MODES.has(pop.boundary)) fail(`population.boundary "${pop.boundary}" invalid`);
  assertFinite(pop.speed, 'population.speed');
  if (pop.scalars && typeof pop.scalars !== 'object') fail('population.scalars must be an object');
  if (!Array.isArray(pop.welds)) fail('population.welds must be an array');
  pop.welds.forEach((w, i) => validateWeld(w, i, channels));
  const scalarNames = new Set(Object.keys(pop.scalars || {}));
  pop.welds.forEach((w, i) => {
    if (w.effect.type === 'rescale' && !scalarNames.has(w.effect.scalar)) {
      fail(`welds[${i}].effect.scalar "${w.effect.scalar}" is not declared in population.scalars`);
    }
  });
}

/** Validate a full substrate+population spec and return it frozen. Throws
 *  with a descriptive message on any shape violation — this is the single
 *  gate both cpu.js and webgl2.js trust instead of re-checking shape. */
function defineSubstrate(spec) {
  if (!spec || typeof spec !== 'object') fail('spec must be an object');
  if (!Number.isInteger(spec.width) || spec.width <= 0) fail('width must be a positive integer');
  if (!Number.isInteger(spec.height) || spec.height <= 0) fail('height must be a positive integer');
  if (!Number.isInteger(spec.seed)) fail('seed must be an integer (used as a uint32 RNG seed)');
  if (!Array.isArray(spec.channels) || spec.channels.length === 0) fail('channels must be a non-empty array');

  spec.channels.forEach(validateChannel);
  const names = new Set(spec.channels.map((c) => c.name));
  if (names.size !== spec.channels.length) fail('channel names must be unique');
  const channels = new Map(spec.channels.map((c) => [c.name, c]));

  for (const ch of spec.channels) {
    if (ch.advectedBy != null) {
      const src = channels.get(ch.advectedBy);
      if (!src) fail(`channels (${ch.name}).advectedBy "${ch.advectedBy}" is not a declared channel`);
      if (src.kind !== 'vector') fail(`channels (${ch.name}).advectedBy "${ch.advectedBy}" must be a vector channel`);
    }
  }

  const reactions = spec.reactions || [];
  if (!Array.isArray(reactions)) fail('reactions must be an array');
  reactions.forEach((r, i) => validateReaction(r, i, channels));

  if (spec.population != null) validatePopulation(spec.population, channels);

  // 'populations' (aquarium addition, 2026-09-11): the plural, NAMED
  // form — one spec, several heterogeneous agent kinds (fish, plankton,
  // bubbles) sharing the same channel substrate. Deliberately additive:
  // the singular 'population' field above is untouched (every existing
  // physarum/boids spec, and their twin coverage, keeps working
  // byte-for-byte), and a spec may use one, the other, or both — cpu.js
  // and webgl2.js execute the singular population (if present) first,
  // then each named population in declared array order. See
  // docs/agent-substrate-engine.md, "Capabilities added for the
  // aquarium", for why this is a plural field rather than a rewrite of
  // the singular one: a single homogeneous population was never wrong,
  // it just isn't the whole grammar an aquarium's populations need.
  const populationsIn = Array.isArray(spec.populations) ? spec.populations : [];
  const popNames = new Set();
  populationsIn.forEach((p, i) => {
    if (typeof p.name !== 'string' || !p.name) fail(`populations[${i}].name must be a non-empty string`);
    if (popNames.has(p.name)) fail(`populations[${i}].name "${p.name}" is not unique`);
    popNames.add(p.name);
    validatePopulation(p, channels, { requireName: true });
  });

  const tolerance = Object.assign({ relL2: 1e-3, maxAbs: 1e-2, agentPos: 1e-2 }, spec.tolerance || {});

  const freezePopulation = (pop) => Object.freeze({
    ...pop,
    scalars: Object.freeze({ ...(pop.scalars || {}) }),
    welds: Object.freeze(pop.welds.map((w) => Object.freeze(JSON.parse(JSON.stringify(w)))))
  });

  return Object.freeze({
    width: spec.width,
    height: spec.height,
    seed: spec.seed >>> 0,
    channels: Object.freeze(spec.channels.map((c) => Object.freeze({ ...c }))),
    reactions: Object.freeze(reactions.map((r) => Object.freeze({ ...r }))),
    population: spec.population ? freezePopulation(spec.population) : null,
    populations: Object.freeze(populationsIn.map(freezePopulation)),
    tolerance: Object.freeze(tolerance)
  });
}

/* ---- the declared diffusion stencil --------------------------------
   A separable 3x3 box mean (weights [1/3,1/3,1/3] each pass, giving a
   uniform 1/9 per cell as a full 2D kernel), computed as two 1D box-3
   averages the way apps/welded_fields/index.html's diffuseDecay does it
   ("separable box mean on a torus"). Declared once, here, so cpu.js and
   webgl2.js apply the exact same weights in the exact same two-pass
   order — "declared weights" per the deliverable, not two independent
   reimplementations that happen to agree today. */
const STENCIL_1D = Object.freeze([1 / 3, 1 / 3, 1 / 3]);

export {
  defineSubstrate,
  BOUNDARY_MODES,
  CHANNEL_KINDS,
  READ_MODES,
  EFFECT_TYPES,
  REACTION_TYPES,
  STENCIL_1D
};
export default { defineSubstrate, BOUNDARY_MODES, CHANNEL_KINDS, READ_MODES, EFFECT_TYPES, REACTION_TYPES, STENCIL_1D };
