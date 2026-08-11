/* =====================================================================
   eigen-form v0.1 — torus-knot family rendering engine.
   File: src/eigen-form.js. Thin assembly: createTrefoilMark composes the
   pure dynamics/palette modules with the canvas2d backend and the
   lifecycle layer below. The mark is what the substrate remembers of a
   constant-velocity wavefront processing through an (p,q) eigen-orbit.
   The crossings' over/under is not stored: it emerges from the drawing
   process itself — freshly deposited trail painting over the dimming
   trail beneath it, a stable path continually re-traced against the
   fade. The mark's depth is an eigenform of its own maintenance.
   Features:
   - Precession: the entire trefoil slowly rotates around the centroid.
     Successive revolutions land slightly offset, so the substrate
     accumulates a spirograph / rosette family from one primitive.
   - Path thickening: the wavefront's stroke can be set independently
     of the ball radius, so the trace can look brushy or hairline.
   - Custom gradients: the rainbow hue-lock can be replaced with a
     two-tone gradient, sub-spectrum slice, monochrome luminance ramp,
     or sub-brand hue band. Locked to closure period either way.
   - Hue parallax: the leading edge of the trail cycles forward, the
     trailing edge cycles reverse — visual depth without 3D geometry.

   USAGE
     <canvas data-myrgic-mark></canvas>                              // auto-init
     createTrefoilMark(el, {gradient: {hueStart: 240, hueEnd: 285}}) // imperative

   OPTIONS
     emergence:    bool   play full appear→settle→trail sequence
     period:       ms     orbital closure period (default 3000)
     scale:        px     trefoil scale (default 215, on logical 480)
     ballRadius:   px     wavefront point radius (default 18)
     strokeWidth:  px     stroke width override (default 2*ballRadius)
     decay:        ms     substrate memory half-life (default 6000)
     p, q:         int    eigenmode (default 2, 3 = trefoil)
     precession:   ms     full centroid rotation period
                          (default 0 = disabled; positive = prograde,
                          negative = retrograde)
     gradient:     'spectrum'|object   color treatment, see GRADIENTS below
     parallax:     0..1   strength of leading-fwd / trailing-rev hue
                          offset (default 0; 1 = ±period over trail)

   GROUND
     The mark owns no background/reference color, by design, at any
     layer (construction opts, setParam, or a data attribute) — the
     canvas itself is always transparent and composites onto whatever
     it's rendered over. That's the host page's call, not the engine's,
     the same module boundary the panel already draws (host page owns
     tokens.css's --bg; the panel never carries its own color default).
     See docs/api.md and docs/parameters.md, "the host owns the ground".

   GRADIENTS
     The color band is a fully configurable panel parameter, not a menu
     of named presets (docs/api.md, "Gradients"; retooled v0.3 — the
     org sub-brand rows and the ad hoc duotone/mono/madder variants
     that used to live here are gone, folded into the same knobs below):
     'spectrum'                        default — full rainbow, hue
                                        locked to closure (hueStart:0,
                                        hueEnd:360, sat:70, light:60);
                                        the sole surviving named preset
     {hueStart, hueEnd, sat?, light?, lightEnd?}  custom span (degrees),
                                        merged over the spectrum
                                        defaults for any field omitted.
                                        A locked/exported figure spec
                                        carries whatever values were
                                        dialed in — clamped by
                                        construction, nothing special-
                                        cased downstream.

   SEAMS (v0.1 — see ROADMAP.md)
     src/dynamics/torus-knot.js   knotPoint, phase windows, smoothstep,
                                   arc-length-bounded stepping
     src/dynamics/substrate.js    the fade/decay accumulator, pure state
     src/palette/gradients.js     GRADIENTS, resolveGradient, colorFor
     src/backends/canvas2d.js     every ctx call, named
     src/backends/capture.js      headless ctx stand-in for goldens
     src/lifecycle/mount.js       DOM: auto-init, rAF, visibility, reduced-motion
     src/figure-spec.js           versioned params spec, export/import
     This file assembles those seams into the same createTrefoilMark
     public API as v0.0.2 — the split changed nothing observable. See
     tools/golden.js and goldens/ops-v0.0.2.json for the equivalence
     proof.
   ===================================================================== */

import * as torusKnot from './dynamics/torus-knot.js';
import * as substrate from './dynamics/substrate.js';
import { GRADIENTS, resolveGradient, colorFor, colorStyle } from './palette/gradients.js';
import * as canvas2d from './backends/canvas2d.js';
import * as mount from './lifecycle/mount.js';
import * as figureSpec from './figure-spec.js';

const LOGICAL = 480;

// Guards against a canvas ending up with two uncontrolled controllers
// (GH #1: HMR replacing this module without a page reload, a duplicate
// <script> resolving to the same file under a different specifier, or a
// page that declares data-myrgic-mark AND also calls createTrefoilMark
// imperatively on the same element). Stashed directly on the canvas
// element rather than a module-scoped WeakMap, so the guard survives a
// swap of this module's own instance — the DOM node persists across
// that, a fresh module's WeakMap wouldn't. A second createTrefoilMark
// call on an already-controlled canvas returns the SAME controller
// instead of constructing another; controller.stop() clears the slot,
// so the stop()-then-recreate pattern every rebuild()-style page in
// this repo already uses (apps/mark, examples/configurator.html) keeps
// working.
const MARK_KEY = '__eigenFormMark';

// A caller-supplied option that fails to parse to a finite number (e.g.
// mount.js's parseFloat of a malformed data-attribute, or NaN passed
// directly) must not sail through and poison the phase integration:
// FINAL_OMEGA = 2π/NaN is NaN, and once a phase accumulator goes NaN it
// never recovers — `NaN + x = NaN` forever, so the mark silently goes
// blank with no error. Falls back to the given default whenever the
// value isn't a finite number, same as an option that was never passed.
function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createTrefoilMark(canvas, opts) {
  canvas = mount.resolveCanvasElement(canvas);
  if (!canvas) return null;
  if (canvas[MARK_KEY]) return canvas[MARK_KEY];

  opts = opts || {};

  const ctx = canvas2d.get2DContext(canvas);
  let lastW = canvas.width, lastH = canvas.height;
  canvas2d.initTransform(ctx, lastW, lastH, LOGICAL);

  // ---- Tunable parameters (mutable via returned controller) ----
  const params = {
    p:           finiteOr(opts.p, 2),
    q:           finiteOr(opts.q, 3),
    scale:       finiteOr(opts.scale, 215),
    period:      finiteOr(opts.period, 3000),
    ballRadius:  finiteOr(opts.ballRadius, 18),
    strokeWidth: finiteOr(opts.strokeWidth, null),
    decay:       finiteOr(opts.decay, 6000),
    precession:  finiteOr(opts.precession, 0),
    parallax:    finiteOr(opts.parallax, 0),
    gradient:    resolveGradient(opts.gradient)
  };
  const showEmergence = !!opts.emergence;

  const cx = LOGICAL / 2, cy = LOGICAL / 2;

  // ---- State ----
  let virtualTime = 0;
  let lastRealTime = 0;
  let angularPhase = 0;
  let radialPhase = 0;
  let prevX = null, prevY = null;
  // Accumulator for substrate fade — see dynamics/substrate.js.
  let fadeDtAccum = 0;

  function drawFrame(t, dt, period) {
    // Self-heal the transform if the canvas's own backing-store size has
    // changed since it was last applied. Assigning canvas.width/height
    // — even a host's own responsive/DPR resize handler reassigning it
    // to a new value, a first-class pattern elsewhere in this repo
    // (apps/physarum, apps/boid_drafting, apps/welded_fields) — resets
    // the 2D context's transform to identity per the canvas spec, with
    // no event this library is otherwise told about. Comparing against
    // the size last applied, every frame, means the desync self-corrects
    // on the very next frame instead of persisting indefinitely.
    if (canvas.width !== lastW || canvas.height !== lastH) {
      lastW = canvas.width;
      lastH = canvas.height;
      canvas2d.initTransform(ctx, lastW, lastH, LOGICAL);
    }

    const T = torusKnot.phases(period);
    const HUE_START_MS = T.settle[0];
    const TRAIL_START_MS = T.settle[1];

    const distinctionActive = t >= T.appear[0];
    const ballRadiusFactor  = torusKnot.smoothstep(t, T.appear[0],    T.appear[1]);
    const orbitalFactor     = torusKnot.smoothstep(t, T.translate[0], T.translate[1]);
    const settleFactor      = torusKnot.smoothstep(t, T.settle[0],    T.settle[1]);

    const SCALE = params.scale;
    const FINAL_OMEGA = (2 * Math.PI) / period;
    const ballRadius = distinctionActive
      ? Math.max(1, params.ballRadius * ballRadiusFactor) : 0;
    const strokeW = (params.strokeWidth != null
      ? params.strokeWidth * ballRadiusFactor
      : ballRadius * 2);
    const orbitalRadiusFactor = orbitalFactor; // 0..1 lerp toward SCALE*2/3
    const radialAmpFactor     = settleFactor;  // 0..1 lerp toward SCALE*1/3
    const angularOmega  = FINAL_OMEGA * params.p * settleFactor;
    const radialOmega   = FINAL_OMEGA * params.q * settleFactor;

    // Substrate fade. Pre-trail phase clears to transparent; once the
    // trail has started, dynamics/substrate.js decides whether enough
    // time has accumulated to register an 8-bit fade this frame.
    if (t < TRAIL_START_MS) {
      canvas2d.clearFrame(ctx, LOGICAL);
      fadeDtAccum = 0;
    } else {
      const trailRamp = torusKnot.smoothstep(t, T.trailGrow[0], T.trailGrow[1]);
      const halfLife = substrate.halfLifeFor(params.decay, trailRamp);
      const { alpha, nextAccum } = substrate.stepFade(fadeDtAccum, dt, halfLife);
      fadeDtAccum = nextAccum;
      if (alpha != null) canvas2d.applyFade(ctx, LOGICAL, alpha);
    }

    // Precession: rotate the entire orbit frame around centroid.
    let precessionPhase = 0;
    if (params.precession !== 0 && settleFactor > 0) {
      const sign = params.precession > 0 ? 1 : -1;
      const omega = (2 * Math.PI) / Math.abs(params.precession);
      precessionPhase = sign * omega * Math.max(0, t - T.settle[0]);
    }

    const { R0, RHO } = torusKnot.torusKnotRadii(SCALE);
    const { steps, subDt } = torusKnot.computeSubstepPlan({
      R0, RHO, orbitalRadiusFactor, radialAmpFactor, angularOmega, radialOmega, dt
    });

    const chromaRamp = torusKnot.smoothstep(t, HUE_START_MS, TRAIL_START_MS);

    for (let s = 0; s < steps; s++) {
      ({ angularPhase, radialPhase } = torusKnot.stepPhases({
        angularPhase, radialPhase, angularOmega, radialOmega, subDt
      }));

      const orbitalRadius = R0 * orbitalRadiusFactor;
      const radialAmp     = RHO * radialAmpFactor;
      const { x, y } = torusKnot.knotPoint({
        orbitalRadius, radialAmp, angularPhase, radialPhase, precessionPhase, cx, cy
      });

      const motionT = Math.max(0, t - HUE_START_MS);
      const huePeriod = period / (1 + params.parallax);
      const u = motionT / huePeriod;

      if (ballRadius > 0) {
        const jumped = prevX === null
          || Math.hypot(x - prevX, y - prevY) > ballRadius * 8;

        const c = colorFor(u, chromaRamp, params.gradient);
        const style = colorStyle(c);
        canvas2d.paintStep(ctx, { x, y, prevX, prevY, jumped, style, lineWidth: strokeW });
      }
      prevX = x;
      prevY = y;
    }
  }

  function reset() {
    canvas2d.clearFrame(ctx, LOGICAL);
    angularPhase = 0;
    radialPhase = 0;
    prevX = null; prevY = null;
    virtualTime = 0;
    fadeDtAccum = 0;
  }

  // ---- Warm to the settled steady state by tracing ----
  // Run the live deposit/dissipate loop synchronously up to targetMs, so
  // the mark reaches its living steady state the same way it sustains it:
  // by re-tracing a stable path against the fade. No stored depth — the
  // (2,3) crossings' over/under emerge from paint order, exactly as they
  // do in motion.
  function warmTo(targetMs) {
    const dtStep = 16;
    let vt = virtualTime, guard = 0;
    while (vt < targetMs && guard < 5000) {
      vt += dtStep;
      drawFrame(vt, dtStep, params.period);
      guard++;
    }
    virtualTime = vt;
  }

  // ---- Static reduced-motion frame ----
  // No animation allowed, so trace synchronously to the settled steady
  // state and leave that frozen frame — the real living mark, stopped,
  // not a reconstruction of it.
  function renderStaticFrame() {
    reset();
    const T = torusKnot.phases(params.period);
    warmTo(T.trailGrow[1] + params.period * 1.5);
  }

  // Initial paint
  reset();

  const reducedMotion = mount.prefersReducedMotion();

  if (reducedMotion) {
    renderStaticFrame();
  } else if (!showEmergence) {
    // Warm to the living steady state by tracing (no static prefill).
    const T = torusKnot.phases(params.period);
    warmTo(T.trailGrow[1] + params.period * 1.5);
  }

  let paused = reducedMotion; // reduced-motion renders once and never starts the loop

  const loop = mount.createAnimationLoop((now) => {
    const realDt = lastRealTime ? Math.min(now - lastRealTime, 100) : 16;
    lastRealTime = now;
    virtualTime += realDt;
    drawFrame(virtualTime, realDt, params.period);
  });

  function start() {
    if (loop.running || paused || reducedMotion) return;
    lastRealTime = 0;
    loop.start();
  }
  function stop() {
    loop.stop();
  }

  if (!reducedMotion) start();

  // Pause/resume off-screen via IntersectionObserver. State is
  // virtualTime-driven, so resuming is trivial — no re-warmup needed.
  let observer = null;
  if (!reducedMotion) {
    observer = mount.observeVisibility(canvas, {
      onEnter() { paused = false; start(); },
      onExit() { paused = true; stop(); }
    });
  }

  // Controller
  const controller = {
    params,
    setParam(k, v) {
      if (k === 'gradient') params.gradient = resolveGradient(v);
      else params[k] = v;
    },
    reset,
    stop() {
      stop();
      if (observer) { observer.disconnect(); observer = null; }
      // Release the dedup slot (see MARK_KEY above) so a subsequent
      // createTrefoilMark call on this canvas — the stop()-then-recreate
      // pattern rebuild()-style pages use — gets a fresh controller
      // rather than this now-stopped one back.
      if (canvas[MARK_KEY] === controller) delete canvas[MARK_KEY];
    },
    get time() { return virtualTime; },
    // New in v0.1 (ROADMAP design principle 5, "figures can answer for
    // themselves") — not part of the v0.0.2 contract, purely additive.
    exportSpec() { return figureSpec.exportSpec(params, { GRADIENTS }); }
  };
  canvas[MARK_KEY] = controller;
  return controller;
}

// ---- Auto-init from data attrs ----
mount.autoInit(createTrefoilMark);

if (typeof window !== 'undefined') {
  window.createTrefoilMark = createTrefoilMark;
  window.MYRGIC_GRADIENTS = GRADIENTS;
}

export { createTrefoilMark, GRADIENTS };
export const exportSpec = figureSpec.exportSpec;
export const fromSpec = figureSpec.fromSpec;
export default { createTrefoilMark, GRADIENTS, exportSpec: figureSpec.exportSpec, fromSpec: figureSpec.fromSpec };
