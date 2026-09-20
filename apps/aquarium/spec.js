/* =====================================================================
   apps/aquarium/spec.js — the aquarium as an agent-substrate engine spec.

   docs/executable-experiments-design.md, "The shader correspondence":
   primitives are kernel specs (operation, stencil, state, parameters);
   the CPU path (engine/cpu.js) is the reference instrument, a GPU path
   (engine/webgl2.js) is a checked projection of it. This module is
   where the aquarium's own numbers live — ONE parameter table
   (ROADMAP.md), read by index.html's generated panel and by
   buildAquariumSpec() below, never duplicated between the two.

   What is, and is not, expressed as a kernel primitive here — named
   plainly rather than left to be discovered by reading the whole file:

     - Fields (momentum, temperature, nutrient, oxygen, ammonia,
       nitrite, nitrate, light, two static masks, two bacteria
       populations, and a fish-schooling density/velocity pair) are
       ordinary ChannelSpecs. Momentum is projected; temperature,
       nutrient, oxygen, ammonia, nitrite, nitrate, and the schooling
       pair are advected by it.
     - Chemistry (heater/jet/intake sources, Newton cooling, surface O2
       exchange, Boussinesq buoyancy, the nitrogen cycle) is entirely
       declared ReactionSpecs — see kernel.js's "Capabilities added for
       the aquarium" for buoyancy/relax/exchange/nitrify, added by this
       delivery because the original five reaction types could not
       express them.
     - Fish, plankton, and bubbles are three named PopulationSpecs
       (kernel.js's plural `populations`, also added by this delivery)
       sharing this one substrate.
     - Plants are NOT a kernel population — a small CPU-side Verlet
       chain set, coupled to the substrate through the same primitives
       (bilinearSample to read light, a scatter deposit to write
       oxygen/nitrate) a population's own weld uses internally, but
       hand-stepped by index.html every frame rather than declared as
       a WeldSpec. Named here, and in docs/aquarium-design.md, as the
       one deliberate exception — a Verlet chain's own internal
       constraint-satisfaction loop isn't a kernel primitive this
       engine has (or needs) a declarative form for yet.
     - The surface height field and its caustic ray-cast are likewise
       app-level (surface.js): a 1D system on the top row, cheap enough
       to step on the CPU every frame regardless of which backend runs
       the 2D substrate, depositing into the 'light' channel through
       the engine's own nearest-cell scatter primitive
       (engine/webgl2.js's scatterAdd; engine/cpu.js's addCell) rather
       than a declared reaction, because a ray hit's position changes
       every frame and isn't a fixed cells list.
   ===================================================================== */

import { defineSubstrate } from './engine/kernel.js';
import { rand01 } from './engine/rng.js';

/* ---- the one parameter table (ROADMAP.md: "one parameter table") ---- */

export const SCHEMA = {
  // -- tank --------------------------------------------------------
  gravelFraction:   { type: 'number', min: 0.75, max: 0.95, step: 0.01, default: 0.86, group: 'tank', label: 'gravel line' },
  wallMargin:       { type: 'number', min: 2, max: 10, step: 1, default: 3, group: 'tank', label: 'wall margin (cells)' },

  // -- water (momentum + temperature substrate) ---------------------
  momentumDiffuse:  { type: 'number', min: 0.02, max: 0.3, step: 0.01, default: 0.14, group: 'water', label: 'viscosity (diffuse)' },
  momentumHalfLife: { type: 'number', min: 40, max: 800, step: 10, default: 220, group: 'water', label: 'drag half-life', unit: 'steps', scale: 'log' },
  projectionIters:  { type: 'number', min: 10, max: 80, step: 2, default: 44, group: 'water', label: 'projection iterations' },
  roomTemp:         { type: 'number', min: 15, max: 26, step: 0.5, default: 20, group: 'water', label: 'room temperature' },
  tempDiffuse:      { type: 'number', min: 0.02, max: 0.3, step: 0.01, default: 0.12, group: 'water', label: 'thermal diffuse' },
  buoyancyBeta:     { type: 'number', min: 0, max: 0.05, step: 0.001, default: 0.012, group: 'water', label: 'buoyancy (Boussinesq beta)' },
  coolingRate:      { type: 'number', min: 0, max: 0.05, step: 0.001, default: 0.01, group: 'water', label: 'surface cooling rate' },

  // -- filter (jet + intake momentum sources, filter media mask) ----
  filterRate:       { type: 'number', min: 0, max: 1, step: 0.02, default: 0.5, group: 'filter', label: 'jet strength' },
  intakeRate:       { type: 'number', min: 0, max: 1, step: 0.02, default: 0.35, group: 'filter', label: 'intake strength' },
  filterMediaSize:  { type: 'number', min: 2, max: 8, step: 1, default: 4, group: 'filter', label: 'media box (cells)' },

  // -- heater --------------------------------------------------------
  heaterRate:       { type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.06, group: 'heater', label: 'heat rate' },

  // -- light (caustics deposited into the light channel each frame) --
  lightHalfLife:    { type: 'number', min: 1, max: 8, step: 0.5, default: 2.5, group: 'light', label: 'decay half-life', unit: 'steps' },
  lightDiffuse:     { type: 'number', min: 0, max: 0.3, step: 0.01, default: 0.06, group: 'light', label: 'diffuse' },
  causticRays:      { type: 'number', min: 6, max: 48, step: 1, default: 28, group: 'light', label: 'caustic ray count' },
  causticIntensity: { type: 'number', min: 0.2, max: 3, step: 0.1, default: 1.1, group: 'light', label: 'caustic intensity' },
  surfaceIOR:       { type: 'number', min: 1.2, max: 1.5, step: 0.01, prereg: 1.33, group: 'light', label: 'water refractive index (n)' },

  // -- bubbles ---------------------------------------------------------
  bubbleCount:      { type: 'number', min: 0, max: 80, step: 1, default: 26, group: 'bubbles', label: 'count' },
  bubbleMinRadius:  { type: 'number', min: 0.2, max: 1.5, step: 0.05, default: 0.4, group: 'bubbles', label: 'min radius' },
  bubbleMaxRadius:  { type: 'number', min: 0.5, max: 3, step: 0.05, default: 1.6, group: 'bubbles', label: 'max radius' },
  bubbleWobble:     { type: 'number', min: 0, max: 0.4, step: 0.01, default: 0.12, group: 'bubbles', label: 'wobble' },
  bubbleAdvectGain: { type: 'number', min: 0, max: 1, step: 0.02, default: 0.35, group: 'bubbles', label: 'current drag' },
  bubbleThrust:     { type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.03, group: 'bubbles', label: 'momentum deposit' },

  // -- fish ------------------------------------------------------------
  fishCount:        { type: 'number', min: 2, max: 60, step: 1, default: 16, group: 'fish', label: 'count' },
  fishSpeed:        { type: 'number', min: 0.1, max: 1.5, step: 0.05, default: 0.55, group: 'fish', label: 'base speed' },
  fishRheotaxis:    { type: 'number', min: -0.3, max: 0.3, step: 0.01, default: -0.05, group: 'fish', label: 'rheotaxis (negative = face current)' },
  fishCurrentDrag:  { type: 'number', min: 0, max: 0.6, step: 0.02, default: 0.18, group: 'fish', label: 'current drag' },
  fishSensorDist:   { type: 'number', min: 1, max: 12, step: 0.5, default: 5, group: 'fish', label: 'sensor distance' },
  fishSensorAngle:  { type: 'angle', min: 5, max: 90, step: 1, default: 40, unit: 'deg', group: 'fish', label: 'sensor angle' },
  fishFoodGain:     { type: 'number', min: 0, max: 1.5, step: 0.02, default: 0.55, group: 'fish', label: 'food-seeking gain' },
  fishGrazeRate:    { type: 'number', min: 0, max: 0.1, step: 0.002, default: 0.03, group: 'fish', label: 'graze rate' },
  fishSchoolGain:   { type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0.12, group: 'fish', label: 'school density gain' },
  fishSchoolAlign:  { type: 'number', min: 0, max: 0.6, step: 0.01, default: 0.22, group: 'fish', label: 'school alignment' },
  fishThrustGain:   { type: 'number', min: 0, max: 0.3, step: 0.005, default: 0.05, group: 'fish', label: 'wake thrust' },
  fishWobble:       { type: 'number', min: 0, max: 0.3, step: 0.01, default: 0.06, group: 'fish', label: 'wobble' },
  fishAmmoniaRate:  { type: 'number', min: 0, max: 0.05, step: 0.001, default: 0.012, group: 'fish', label: 'ammonia deposit' },
  fishO2ConsumeRate:{ type: 'number', min: 0, max: 0.05, step: 0.001, default: 0.01, group: 'fish', label: 'oxygen consumption' },

  // -- plankton (physarum weld on nutrient; the field's own writers) ---
  planktonCount:    { type: 'number', min: 0, max: 1200, step: 20, default: 500, group: 'plankton', label: 'count' },
  planktonSpeed:    { type: 'number', min: 0.05, max: 0.8, step: 0.02, default: 0.28, group: 'plankton', label: 'base speed' },
  planktonSensorDist:{ type: 'number', min: 1, max: 8, step: 0.5, default: 3, group: 'plankton', label: 'sensor distance' },
  planktonSensorAngle:{ type: 'angle', min: 10, max: 90, step: 1, default: 35, unit: 'deg', group: 'plankton', label: 'sensor angle' },
  planktonGain:     { type: 'number', min: 0, max: 0.8, step: 0.02, default: 0.32, group: 'plankton', label: 'steering gain' },
  planktonGrowth:   { type: 'number', min: 0, max: 0.4, step: 0.01, default: 0.16, group: 'plankton', label: 'nutrient growth deposit' },
  planktonLightGain:{ type: 'number', min: 0, max: 1, step: 0.02, default: 0.5, group: 'plankton', label: 'light-speed coupling' },

  // -- plants (CPU-side Verlet chains, the one non-engine population) --
  plantCount:       { type: 'number', min: 0, max: 12, step: 1, default: 6, group: 'plants', label: 'count' },
  plantSegments:    { type: 'number', min: 3, max: 14, step: 1, default: 8, group: 'plants', label: 'segments' },
  plantSegLength:   { type: 'number', min: 0.5, max: 3, step: 0.1, default: 1.3, group: 'plants', label: 'segment length' },
  plantDrag:        { type: 'number', min: 0, max: 2, step: 0.05, default: 0.6, group: 'plants', label: 'current drag' },
  plantStiffIters:  { type: 'number', min: 1, max: 8, step: 1, default: 4, group: 'plants', label: 'constraint iterations' },
  plantOxygenRate:  { type: 'number', min: 0, max: 0.05, step: 0.001, default: 0.015, group: 'plants', label: 'oxygen deposit (per light unit)' },
  plantNitrateRate: { type: 'number', min: 0, max: 0.03, step: 0.001, default: 0.008, group: 'plants', label: 'nitrate uptake' },

  // -- chemistry (nitrogen cycle + O2 exchange time-scale) -------------
  chemistrySpeed:   { type: 'number', min: 1, max: 20, step: 1, default: 8, group: 'chemistry', label: 'time-scale multiplier', scale: 'log' },
  o2Saturation:      { type: 'number', min: 4, max: 12, step: 0.5, default: 8, group: 'chemistry', label: 'O2 saturation' },
  o2ExchangeRate:    { type: 'number', min: 0, max: 0.1, step: 0.002, default: 0.02, group: 'chemistry', label: 'O2 exchange rate' },
  nitrifyGrowth:     { type: 'number', min: 0.05, max: 1, step: 0.01, default: 0.4, group: 'chemistry', label: 'bacteria growth rate' },
  // Rescaled 2026-09-11 (found empirically, real-time-driver run:
  // bacteriaA/bacteriaB -> 0 within ~60 steps at the old default of 1,
  // never recovering — see seedAquarium's nitrify note and
  // tests/aquarium-app.js's bacteria-establish test). The old [0.1, 3]
  // range assumed a local-ammonia-at-the-filter-media concentration
  // scale the simulation never actually reaches: measured (5000 CPU-
  // engine steps, default params, filter-mask cells only) local
  // ammonia there stays in the 1e-4..1e-2 range, two to three orders of
  // magnitude below the old minimum half-saturation — so Monod uptake
  // (mu = growthRate * s / (s + halfSaturation)) was always small
  // relative to nitrifyDeathRate there, and the bootstrap population
  // (seedAquarium, 0.02) died faster than ammonia could ever arrive.
  // Rescaled to the concentration scale actually achieved, not the one
  // originally assumed.
  nitrifyHalfSat:    { type: 'number', min: 0.0005, max: 0.05, step: 0.0005, default: 0.001, group: 'chemistry', label: 'Monod half-saturation' },
  nitrifyDeathRate:  { type: 'number', min: 0.001, max: 0.05, step: 0.001, default: 0.012, group: 'chemistry', label: 'bacteria death rate' },

  // -- time --------------------------------------------------------
  simSpeed:         { type: 'number', min: 0.25, max: 4, step: 0.25, default: 1, group: 'time', label: 'sim speed' },

  // -- view ----------------------------------------------------------
  backend:          { type: 'select', options: ['webgl2', 'cpu'], default: 'webgl2', group: 'view', label: 'backend' },
  overlay:          { type: 'select', options: ['none', 'velocity', 'vorticity', 'temperature', 'ammonia', 'oxygen', 'nutrient', 'light'], default: 'none', group: 'view', label: 'overlay' },
  cpuGridScale:     { type: 'number', min: 0.25, max: 1, step: 0.05, default: 0.5, group: 'view', label: 'CPU grid scale' }
};

/* ---- fixed geometry (not schema knobs: changing these mid-run would
   require re-deriving every fraction-based position below; they are
   the "fixed" idiom from apps/mark's period/decay ranges, generalized
   to whole-tank constants). Grid dims scale with backend (view).
   cpuGridScale) via buildAquariumSpec's own W/H computation, below. --- */
export const BASE_WIDTH = 112;
export const BASE_HEIGHT = 70;

export const CHANNELS = Object.freeze({
  MOMENTUM: 'momentum', TEMPERATURE: 'temperature', NUTRIENT: 'nutrient',
  OXYGEN: 'oxygen', AMMONIA: 'ammonia', NITRITE: 'nitrite', NITRATE: 'nitrate',
  LIGHT: 'light', FILTER_MASK: 'filterMask', SURFACE_MASK: 'surfaceMask',
  BACTERIA_A: 'bacteriaA', BACTERIA_B: 'bacteriaB',
  FISH_DENSITY: 'fishDensity', FISH_VELOCITY: 'fishVelocity'
});

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

/** Pure function: schema values (a plain object, e.g. store.values()) +
 *  a seed -> { spec, meta }. `spec` is the frozen kernel spec
 *  (defineSubstrate's return); `meta` carries every derived, backend-
 *  independent-in-FRACTION geometry fact index.html/surface.js need
 *  (grid dims, filter/heater/gravel positions in grid cells) so nothing
 *  downstream re-derives a fraction*width calculation its own way. */
export function buildAquariumSpec(values, seed) {
  const backend = values.backend;
  const gridScale = backend === 'cpu' ? values.cpuGridScale : 1;
  const width = clampInt(BASE_WIDTH * gridScale, 24, BASE_WIDTH);
  const height = clampInt(BASE_HEIGHT * gridScale, 16, BASE_HEIGHT);

  const gravelRow = clampInt(values.gravelFraction * height, 1, height - 2);
  const heaterCell = [clampInt(width * 0.5, 1, width - 2), clampInt(height * 0.93, 1, height - 2)];
  const filterCell = [clampInt(width * 0.9, 1, width - 2), clampInt(height * 0.22, 1, height - 2)];
  const intakeCell = [clampInt(width * 0.9, 1, width - 2), clampInt(height * 0.1, 1, height - 2)];
  const filterMediaHalf = Math.max(1, Math.round(values.filterMediaSize * gridScale));

  const meta = { width, height, gravelRow, heaterCell, filterCell, intakeCell, filterMediaHalf, gridScale, backend };

  // Jet direction: down and into the tank (away from the back-right
  // corner where the filter hangs). Intake: a gentle pull back toward
  // the filter box — named plainly in docs/aquarium-design.md as a
  // momentum-source approximation of an intake sink, not a true sink.
  const jetVector = [-0.55, 0.6];
  const intakeVector = [0.15, -1];

  // A single-cell 'source' is a spatial delta function — the sharpest
  // possible excitation of the GPU projection's undamped Nyquist mode
  // (docs/agent-substrate-engine.md, "Projection: two real bugs").
  // Spreading the heater/jet/intake sources over a small soft cluster
  // (center + 4 neighbours, tapered) keeps their physical location
  // while removing most of that high-frequency content — a mitigation
  // named here because it is exactly the failure mode that doc warns
  // about, not a coincidence.
  function softCells(cell, halfWeight = 0.5) {
    const [cx, cy] = cell;
    return [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]].map((c, i) => ({
      cell: c, weight: i === 0 ? 1 : halfWeight
    }));
  }

  function sourceReaction(channel, rate, cell, vector) {
    const soft = softCells(cell);
    // kernel.js's 'source' reaction takes ONE rate applied uniformly to
    // every declared cell — soften the cluster's edge cells by
    // declaring them as SEPARATE source reactions at a scaled rate
    // instead (still one reaction TYPE, several small instances; the
    // grammar does not need a per-cell weight field for this).
    return soft.map((s) => ({
      type: 'source', channel, rate: rate * s.weight, cells: [s.cell], ...(vector ? { vector } : {})
    }));
  }

  const channels = [
    { name: CHANNELS.MOMENTUM, kind: 'vector', diffuse: values.momentumDiffuse, halfLife: values.momentumHalfLife, boundary: 'wall', advectedBy: null, projection: { enabled: true, iterations: values.projectionIters } },
    { name: CHANNELS.TEMPERATURE, kind: 'scalar', diffuse: values.tempDiffuse, halfLife: Infinity, boundary: 'wall', advectedBy: CHANNELS.MOMENTUM },
    { name: CHANNELS.NUTRIENT, kind: 'scalar', diffuse: 0.08, halfLife: 900, boundary: 'wall', advectedBy: CHANNELS.MOMENTUM },
    { name: CHANNELS.OXYGEN, kind: 'scalar', diffuse: 0.1, halfLife: Infinity, boundary: 'wall', advectedBy: CHANNELS.MOMENTUM },
    { name: CHANNELS.AMMONIA, kind: 'scalar', diffuse: 0.08, halfLife: Infinity, boundary: 'wall', advectedBy: CHANNELS.MOMENTUM },
    { name: CHANNELS.NITRITE, kind: 'scalar', diffuse: 0.08, halfLife: Infinity, boundary: 'wall', advectedBy: CHANNELS.MOMENTUM },
    { name: CHANNELS.NITRATE, kind: 'scalar', diffuse: 0.08, halfLife: Infinity, boundary: 'wall', advectedBy: CHANNELS.MOMENTUM },
    { name: CHANNELS.LIGHT, kind: 'scalar', diffuse: values.lightDiffuse, halfLife: values.lightHalfLife, boundary: 'wall', advectedBy: null },
    { name: CHANNELS.FILTER_MASK, kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
    { name: CHANNELS.SURFACE_MASK, kind: 'scalar', diffuse: 0, halfLife: Infinity, boundary: 'wall', advectedBy: null },
    { name: CHANNELS.BACTERIA_A, kind: 'scalar', diffuse: 0.01, halfLife: Infinity, boundary: 'wall', advectedBy: null },
    { name: CHANNELS.BACTERIA_B, kind: 'scalar', diffuse: 0.01, halfLife: Infinity, boundary: 'wall', advectedBy: null },
    { name: CHANNELS.FISH_DENSITY, kind: 'scalar', diffuse: 0.25, halfLife: 20, boundary: 'wall', advectedBy: null },
    { name: CHANNELS.FISH_VELOCITY, kind: 'vector', diffuse: 0.25, halfLife: 15, boundary: 'wall', advectedBy: null }
  ];

  const chem = values.chemistrySpeed;
  const reactions = [
    ...sourceReaction(CHANNELS.TEMPERATURE, values.heaterRate, heaterCell),
    ...sourceReaction(CHANNELS.MOMENTUM, values.filterRate, filterCell, jetVector),
    ...sourceReaction(CHANNELS.MOMENTUM, values.intakeRate, intakeCell, intakeVector),
    { type: 'buoyancy', velocity: CHANNELS.MOMENTUM, temperature: CHANNELS.TEMPERATURE, beta: values.buoyancyBeta, reference: values.roomTemp },
    { type: 'relax', channel: CHANNELS.TEMPERATURE, mask: CHANNELS.SURFACE_MASK, target: values.roomTemp, rate: values.coolingRate },
    { type: 'exchange', channel: CHANNELS.OXYGEN, driver: CHANNELS.MOMENTUM, mask: CHANNELS.SURFACE_MASK, target: values.o2Saturation, rate: values.o2ExchangeRate },
    {
      type: 'nitrify', substrate: CHANNELS.AMMONIA, product: CHANNELS.NITRITE, bacteria: CHANNELS.BACTERIA_A, mask: CHANNELS.FILTER_MASK,
      growthRate: values.nitrifyGrowth * chem, halfSaturation: values.nitrifyHalfSat, carryingCapacity: 1, yieldFactor: 1, deathRate: values.nitrifyDeathRate * chem
    },
    {
      type: 'nitrify', substrate: CHANNELS.NITRITE, product: CHANNELS.NITRATE, bacteria: CHANNELS.BACTERIA_B, mask: CHANNELS.FILTER_MASK,
      growthRate: values.nitrifyGrowth * chem * 0.8, halfSaturation: values.nitrifyHalfSat, carryingCapacity: 1, yieldFactor: 1, deathRate: values.nitrifyDeathRate * chem
    }
  ];

  const sa = (deg) => deg * Math.PI / 180;

  const fish = {
    name: 'fish', count: values.fishCount, boundary: 'wall', speed: values.fishSpeed, scalars: {},
    welds: [
      // 1. rheotaxis: sense the local current, (anti-)align to it —
      //    a negative gain turns AWAY from the downstream direction,
      //    i.e. toward facing into the current, and 'advect' carries
      //    the fish along with the flow it's swimming against.
      { channel: CHANNELS.MOMENTUM, read: { mode: 'vector' }, effect: { type: 'alignAndAdvect', align: values.fishRheotaxis, advect: values.fishCurrentDrag }, deposit: null },
      // 2. food-seeking + grazing: climb the nutrient (plankton
      //    biomass) gradient, eating it down as it passes through.
      { channel: CHANNELS.NUTRIENT, read: { mode: 'gradient', sensorDist: values.fishSensorDist, sensorAngle: sa(values.fishSensorAngle) }, effect: { type: 'steerByAngle', gain: values.fishFoodGain }, deposit: { channel: CHANNELS.NUTRIENT, amount: -values.fishGrazeRate } },
      // 3. schooling (density): the boid weld on fish's OWN density
      //    channel — separate/cohere depending on the declared sign.
      { channel: CHANNELS.FISH_DENSITY, read: { mode: 'gradient', sensorDist: values.fishSensorDist * 0.6, sensorAngle: sa(values.fishSensorAngle) }, effect: { type: 'steerByAngle', gain: values.fishSchoolGain }, deposit: { channel: CHANNELS.FISH_DENSITY, amount: 2 } },
      // 4. schooling (alignment): match neighbours' heading via the
      //    fish-velocity vector channel — the boid weld's other half.
      { channel: CHANNELS.FISH_VELOCITY, read: { mode: 'vector' }, effect: { type: 'alignAndAdvect', align: values.fishSchoolAlign, advect: 0 }, deposit: { channel: CHANNELS.FISH_VELOCITY, amount: 1 } },
      // 5. thrust bursts: a wobble weld (natural swimming jitter)
      //    whose deposit is NEGATIVE momentum in the fish's own
      //    direction of travel — Newton's third law, the wake a fish
      //    leaves is equal and opposite to its own forward thrust.
      { read: { mode: 'none' }, effect: { type: 'wobble', amount: values.fishWobble }, deposit: { channel: CHANNELS.MOMENTUM, amount: -values.fishThrustGain } },
      // 6. ammonia deposit (a wobble weld with amount 0 — inert on
      //    heading, present purely to carry this deposit).
      { read: { mode: 'none' }, effect: { type: 'wobble', amount: 0 }, deposit: { channel: CHANNELS.AMMONIA, amount: values.fishAmmoniaRate } },
      // 7. oxygen consumption (same inert-carrier pattern as #6).
      { read: { mode: 'none' }, effect: { type: 'wobble', amount: 0 }, deposit: { channel: CHANNELS.OXYGEN, amount: -values.fishO2ConsumeRate } }
    ]
  };

  const plankton = {
    name: 'plankton', count: values.planktonCount, boundary: 'wall', speed: values.planktonSpeed, scalars: {},
    welds: [
      // The physarum reference rule, applied to nutrient instead of a
      // dedicated trail channel: plankton ARE the nutrient field's own
      // writers (a positive deposit — growth), and fish's weld #2
      // above grazes that same field down.
      { channel: CHANNELS.NUTRIENT, read: { mode: 'gradient', sensorDist: values.planktonSensorDist, sensorAngle: sa(values.planktonSensorAngle) }, effect: { type: 'steerByAngle', gain: values.planktonGain }, deposit: { channel: CHANNELS.NUTRIENT, amount: values.planktonGrowth } }
    ]
  };

  const bubbles = {
    name: 'bubbles', count: values.bubbleCount, boundary: 'absorb', speed: 0, scalars: { radius: 1 },
    welds: [
      // Heading is forced to "up" at spawn/recycle (index.html) and
      // never re-steered by a gradient weld — wobble is the only
      // heading perturbation, giving upward drift with jitter.
      { read: { mode: 'none' }, effect: { type: 'wobble', amount: values.bubbleWobble }, deposit: null },
      // Horizontal (and slight vertical) advection by the local
      // current, plus the deposit half of this SAME weld sends
      // momentum in the bubble's own direction of travel (upward) —
      // "momentum deposit upward" from the brief, read off the weld
      // that already carries the bubble's own velocity.
      { channel: CHANNELS.MOMENTUM, read: { mode: 'vector' }, effect: { type: 'alignAndAdvect', align: 0, advect: values.bubbleAdvectGain }, deposit: { channel: CHANNELS.MOMENTUM, amount: values.bubbleThrust } }
    ]
  };

  const spec = defineSubstrate({
    width, height, seed: seed >>> 0,
    channels, reactions,
    populations: [fish, plankton, bubbles],
    tolerance: { relL2: 0.08, maxAbs: 8, agentPos: 0.5, earlyStep: 5, earlyRelL2: 0.05, earlyMaxAbs: 4 }
  });

  return { spec, meta };
}

// RNG stream ids for app-level (non-kernel) initial-condition seeding —
// deliberately far above the engine's own internal ranges (STREAM_INIT_*
// ~101-103+salt*97, STREAM_TIEBREAK_BASE 5000+salt*97+weldIndex; see
// cpu.js) so this can never collide with a declared weld's own draws.
const STREAM_BUBBLE_RADIUS = 90001;

/** Pure: bubble `i`'s radius, deterministic from the spec's own seed —
 *  the one fact both seedAquarium (which derives terminal speed from
 *  it) and index.html's renderer (which draws bubbles sized by it, but
 *  never uploads radius to the GPU — see this function's call sites)
 *  need to agree on without either recomputing the other's formula by
 *  hand. */
export function bubbleRadius(seed, i, minR, maxR) {
  const t = rand01(seed, i, 0, STREAM_BUBBLE_RADIUS);
  return minR + t * (maxR - minR);
}

/** Seed every initial condition the engine's own zero-default state
 *  can't express: the static filterMask/surfaceMask channels, a small
 *  bootstrap bacteria population (a fresh filter cannot cycle from
 *  bacteria = 0 — see kernel.js's nitrify grammar and tests/
 *  aquarium-engine.js's nitrify case), room-temperature water,
 *  saturated oxygen, and bubbles' per-agent radius/speed and forced
 *  "up" heading (bubbles are never re-steered by a gradient weld — see
 *  spec.js's population declarations — so heading only ever drifts by
 *  wobble from whatever this function sets it to).
 *
 *  Mutates `state` (a cpu.js-shaped state: state.fields, and
 *  state.populationsByName) in place. Called ONCE, on the CPU
 *  reference state, before either backend steps — for the webgl2
 *  backend, index.html uploads this same seeded state via
 *  engine/webgl2.js's uploadInitialState, exactly like the twin
 *  protocol already does for t=0 (see engine/webgl2.js's header:
 *  "initial state is a pure function of the spec's seed... costs
 *  nothing in fidelity"). This function is that pure function's
 *  aquarium-specific extension. */
export function seedAquarium(spec, state, meta, values) {
  const { width: W, height: H, filterCell, intakeCell, filterMediaHalf, gridScale } = meta;
  const mediaCx = Math.round((filterCell[0] + intakeCell[0]) / 2);
  const mediaCy = Math.round((filterCell[1] + intakeCell[1]) / 2);

  const filterMask = state.fields[CHANNELS.FILTER_MASK];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(x - mediaCx) <= filterMediaHalf && Math.abs(y - mediaCy) <= filterMediaHalf) {
        filterMask[y * W + x] = 1;
      }
    }
  }

  const surfaceMask = state.fields[CHANNELS.SURFACE_MASK];
  for (let x = 0; x < W; x++) {
    surfaceMask[0 * W + x] = 1;
    if (H > 1) surfaceMask[1 * W + x] = 0.4;
  }

  // Bootstrap bacteria: a fresh filter cannot cycle without SOME
  // nitrifying bacteria already present — 0.02 is small relative to
  // nitrify's carryingCapacity of 1 (see spec's reactions), a
  // deliberately modest seed so the cycle's rise is visible rather
  // than starting pre-saturated.
  //
  // This bootstrap population used to die before it ever got the
  // chance to grow: at step 1 the filter media has essentially no
  // ammonia yet (S ~ 0), so Monod growth (mu = growthRate * s / (s +
  // halfSaturation)) is ~0, and ANY positive deathRate then dominates
  // — cpu.js's `nitrify` branch computes `growth = (mu*(1-b/cap) -
  // deathRate) * b`, so at S ~ 0 that's just `-deathRate * b`, pure
  // exponential decay from the very first step. Measured: the 0.02
  // seed was down two orders of magnitude within ~60 steps and never
  // recovered (growth is proportional to the population itself — an
  // extinct-in-practice population can't restart from a later rise in
  // ammonia). The actual fix is SCHEMA's nitrifyHalfSat (see its own
  // comment): rescaled to the concentration scale ammonia genuinely
  // reaches in the filter media, so Monod growth is no longer
  // structurally smaller than death the moment the bootstrap population
  // exists.
  const bacA = state.fields[CHANNELS.BACTERIA_A], bacB = state.fields[CHANNELS.BACTERIA_B];
  for (let i = 0; i < filterMask.length; i++) {
    if (filterMask[i] > 0) { bacA[i] = 0.02; bacB[i] = 0.02; }
  }

  state.fields[CHANNELS.TEMPERATURE].fill(values.roomTemp);
  state.fields[CHANNELS.OXYGEN].fill(values.o2Saturation);

  const bubbles = state.populationsByName.bubbles;
  if (bubbles) {
    const minR = values.bubbleMinRadius, maxR = values.bubbleMaxRadius;
    for (let i = 0; i < bubbles.count; i++) {
      const radius = bubbleRadius(spec.seed, i, minR, maxR);
      bubbles.scalars.radius[i] = radius;
      bubbles.scalarsBase.radius[i] = radius;
      // Terminal rise speed grows with radius (a gentler-than-Stokes
      // linear approximation, named as such in docs/aquarium-design.md
      // — true Stokes drag scales with r^2, which at this grid's cell-
      // per-step scale would make the largest bubbles unrealistically
      // fast relative to the tank height).
      bubbles.speed[i] = (0.12 + 0.35 * (radius - minR) / Math.max(1e-6, maxR - minR)) * gridScale;
      // "Up" — grid convention: row 0 is the surface, so up is -y.
      // Never re-steered by a gradient weld; only wobble perturbs this.
      bubbles.heading[i] = -Math.PI / 2;
      // Spawn near the gravel, not already mid-water, so a viewer sees
      // the rise from the start.
      bubbles.y[i] = H - 1 - (i % 3);
    }
  }
}

export default { SCHEMA, BASE_WIDTH, BASE_HEIGHT, CHANNELS, buildAquariumSpec, seedAquarium, bubbleRadius };
