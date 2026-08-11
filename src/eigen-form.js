/* =====================================================================
   eigen-form v0.0.2 — torus-knot family rendering engine.
   File: src/eigen-form.js (formerly trefoil-mark.js in canonical Myrgic DS).
   Function: createTrefoilMark — produces a (p,q) torus-knot canvas
   animation. Future versions add other eigenform families.
   Vision: mathematical design primitives — every visual element a rigorously defined mathematical object.
   ===================================================================== */
//
// The mark is what the substrate remembers of a constant-velocity
// wavefront processing through an (p,q) eigen-orbit. v0.0.2 makes the
// canvas transparent (it composites onto the page rather than painting
// its own background box), and removes the per-frame full-canvas readback
// that the opaque-substrate model required. The crossings' over/under is
// not stored: it emerges from the drawing process itself — freshly
// deposited trail painting over the dimming trail beneath it, a stable
// path continually re-traced against the fade. The mark's depth is an
// eigenform of its own maintenance. v2 (lineage) additions retained:
//
//   - Precession: the entire trefoil slowly rotates around the centroid.
//     Successive revolutions land slightly offset, so the substrate
//     accumulates a spirograph / rosette family from one primitive.
//   - Path thickening: the wavefront's stroke can be set independently
//     of the ball radius, so the trace can look brushy or hairline.
//   - Custom gradients: the rainbow hue-lock can be replaced with a
//     two-tone gradient, sub-spectrum slice, monochrome luminance ramp,
//     or sub-brand hue band. Locked to closure period either way.
//   - Hue parallax: the leading edge of the trail cycles forward, the
//     trailing edge cycles reverse — visual depth without 3D geometry.
//
// USAGE
//   <canvas data-myrgic-mark></canvas>                  // auto-init
//   createTrefoilMark(el, {gradient: 'cogos', ...})     // imperative
//
// OPTIONS
//   emergence:    bool   play full appear→settle→trail sequence
//   period:       ms     orbital closure period (default 3000)
//   scale:        px     trefoil scale (default 215, on logical 480)
//   ballRadius:   px     wavefront point radius (default 18)
//   strokeWidth:  px     stroke width override (default 2*ballRadius)
//   decay:        ms     substrate memory half-life (default 6000)
//   p, q:         int    eigenmode (default 2, 3 = trefoil)
//   precession:   ms     full centroid rotation period
//                        (default 0 = disabled; positive = prograde,
//                        negative = retrograde)
//   gradient:     name|object   color treatment, see GRADIENTS below
//   parallax:     0..1   strength of leading-fwd / trailing-rev hue
//                        offset (default 0; 1 = ±period over trail)
//   bg:           'rgb()' or [r,g,b]   optional halo/reference color;
//                 the canvas itself is transparent and composites onto
//                 the page — bg no longer paints a background box.
//
// GRADIENTS
//   'spectrum'   default — full rainbow, hue locked to closure
//   'cogos'      violet/indigo band   240..280°
//   'mod3'       cyan/teal band       170..210°
//   'research'   amber/gold band       30..60°
//   'constellation'  magenta band     310..340°
//   'duotone'    violet → cyan        custom two-tone
//   'mono'       accent → white       luminance only
//   'madder'     warm monochrome ink/madder band  4..36°, low sat
//   {hueStart, hueEnd, sat?, light?}  custom span (degrees)
// =================================================================
(function () {
  'use strict';

  const GRADIENTS = {
    spectrum:      { hueStart:   0, hueEnd: 360, sat: 70, light: 60 },
    cogos:         { hueStart: 240, hueEnd: 285, sat: 70, light: 62 },
    mod3:          { hueStart: 165, hueEnd: 210, sat: 65, light: 60 },
    research:      { hueStart:  28, hueEnd:  58, sat: 72, light: 62 },
    constellation: { hueStart: 305, hueEnd: 340, sat: 68, light: 62 },
    duotone:       { hueStart: 260, hueEnd: 190, sat: 70, light: 60 },
    mono:          { hueStart: 260, hueEnd: 260, sat: 60, light: 60, lightEnd: 95 },
    // Warm monochrome ink/madder band — matches a page whose accent is a
    // single madder red (e.g. #C4483E ≈ hsl(4.5°,51%,51%)) rather than a
    // full-saturation rainbow. Low sat keeps it quiet against ink/paper.
    madder:        { hueStart:   4, hueEnd:  36, sat: 54, light: 56 }
  };

  function resolveGradient(g) {
    if (!g) return GRADIENTS.spectrum;
    if (typeof g === 'string') return GRADIENTS[g] || GRADIENTS.spectrum;
    return Object.assign({}, GRADIENTS.spectrum, g);
  }

  function createTrefoilMark(canvas, opts) {
    if (typeof canvas === 'string') canvas = document.getElementById(canvas);
    if (!canvas) return null;
    opts = opts || {};

    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const LOGICAL = 480;
    ctx.scale(W / LOGICAL, H / LOGICAL);

    // ---- Tunable parameters (mutable via returned controller) ----
    const params = {
      p:           opts.p           != null ? opts.p           : 2,
      q:           opts.q           != null ? opts.q           : 3,
      scale:       opts.scale       != null ? opts.scale       : 215,
      period:      opts.period      != null ? opts.period      : 3000,
      ballRadius:  opts.ballRadius  != null ? opts.ballRadius  : 18,
      strokeWidth: opts.strokeWidth != null ? opts.strokeWidth : null,
      decay:       opts.decay       != null ? opts.decay       : 6000,
      precession:  opts.precession  != null ? opts.precession  : 0,
      parallax:    opts.parallax    != null ? opts.parallax    : 0,
      gradient:    resolveGradient(opts.gradient)
    };
    const showEmergence = !!opts.emergence;

    // ---- Optional reference color (halo tuning only — canvas itself is
    // transparent; nothing is painted as an opaque substrate anymore). ----
    function parseBg(input) {
      if (Array.isArray(input)) return input.slice(0, 3).map(Number);
      if (typeof input === 'string') {
        const s = input.trim();
        const hex3 = s.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
        const hex6 = s.match(/^#?([0-9a-f]{6})$/i);
        if (hex6) {
          const n = parseInt(hex6[1], 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
        if (hex3) {
          return [hex3[1], hex3[2], hex3[3]].map(c => parseInt(c + c, 16));
        }
        const rgb = s.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
        if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
      }
      return null;
    }
    let bg = parseBg(opts.bg) || [10, 10, 15];
    let BG_R = bg[0], BG_G = bg[1], BG_B = bg[2];
    function setBg(input) {
      const parsed = parseBg(input);
      if (!parsed) return;
      [BG_R, BG_G, BG_B] = parsed;
    }
    const cx = LOGICAL / 2, cy = LOGICAL / 2;

    // ---- Constants ----
    const DECAY_LN_HALF = Math.log(0.5);
    // Minimum α to actually paint a fade pulse — anything smaller rounds
    // to zero in 8-bit and would never decay the trail.
    const MIN_FADE_ALPHA = 3 / 255;
    // Max chord length (logical px) for curve sampling — keeps the
    // polyline smooth regardless of frame rate / dropped frames.
    const MAX_CHORD = 3;

    // Phase windows
    function phases(period) {
      return {
        appear:    [200,  500],
        translate: [500,  1100],
        settle:    [1100, 2000],
        trailGrow: [2000, 2000 + period]
      };
    }

    function smoothstep(x, e0, e1) {
      if (x <= e0) return 0;
      if (x >= e1) return 1;
      const t = (x - e0) / (e1 - e0);
      return t * t * (3 - 2 * t);
    }

    // ---- Color sampling ----
    // u in [0,1) — phase along the closure cycle
    function colorFor(u, chromaRamp) {
      const g = params.gradient;
      // wrap u into 0..1
      u = ((u % 1) + 1) % 1;
      // For full spectrum, hueEnd-hueStart = 360 → wraps cleanly.
      // For sub-bands, ping-pong so we don't snap at the seam.
      const span = g.hueEnd - g.hueStart;
      let hueT;
      if (Math.abs(span) >= 360) {
        hueT = u;
      } else {
        // triangle wave: 0..1..0
        hueT = u < 0.5 ? u * 2 : (1 - u) * 2;
      }
      const hue = (g.hueStart + span * hueT + 720) % 360;
      const sat = (g.sat != null ? g.sat : 70) * chromaRamp;
      const lightStart = g.light != null ? g.light : 60;
      const lightEnd = g.lightEnd != null ? g.lightEnd : lightStart;
      const light = 100 - (100 - (lightStart + (lightEnd - lightStart) * hueT)) * chromaRamp;
      return { hue, sat, light };
    }

    function colorStyle(c, alpha) {
      if (alpha == null) return `hsl(${c.hue.toFixed(1)} ${c.sat.toFixed(1)}% ${c.light.toFixed(1)}%)`;
      return `hsla(${c.hue.toFixed(1)} ${c.sat.toFixed(1)}% ${c.light.toFixed(1)}% / ${alpha.toFixed(3)})`;
    }

    // ---- Torus-knot geometry ----
    // Standard (p,q) torus-knot parametrization, projected to 2D with the
    // suppressed axis z = sin(radialPhase) used purely for depth sort
    // (over/under crossings), not literal 3D rendering.
    //   theta(t) = p * omega * t          (angular phase)
    //   phi(t)   = q * omega * t          (radial phase)
    //   r(t)     = R0 + RHO * cos(phi)
    //   x,y      = center + r * (cos theta, sin theta)
    //   z(t)     = sin(phi)               (depth proxy for crossing order)
    function knotPoint(SCALE, angularPhase, radialPhase, precessionPhase) {
      const R0  = SCALE * 2 / 3;
      const RHO = SCALE * 1 / 3;
      const r = R0 + RHO * Math.cos(radialPhase);
      const localAngle = angularPhase + precessionPhase;
      const x = cx + r * Math.cos(localAngle);
      const y = cy + r * Math.sin(localAngle);
      const z = Math.sin(radialPhase);
      return { x, y, z };
    }

    // ---- State ----
    let virtualTime = 0;
    let lastRealTime = 0;
    let angularPhase = 0;
    let radialPhase = 0;
    let prevX = null, prevY = null;
    // Accumulator for substrate fade. Canvas alpha is 8-bit, so very
    // small per-frame fadeAlpha values (< ~1/255) round to zero and the
    // trail never decays. We accumulate dt and only paint the fade
    // when it's large enough to register, which makes long half-lives
    // behave correctly.
    let fadeDtAccum = 0;

    function drawFrame(t, dt, period) {
      const T = phases(period);
      const HUE_START_MS = T.settle[0];
      const TRAIL_START_MS = T.settle[1];

      const distinctionActive = t >= T.appear[0];
      const ballRadiusFactor  = smoothstep(t, T.appear[0],    T.appear[1]);
      const orbitalFactor     = smoothstep(t, T.translate[0], T.translate[1]);
      const settleFactor      = smoothstep(t, T.settle[0],    T.settle[1]);

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

      // Substrate fade — transparent model. We erase the trail toward
      // transparent with destination-out; nothing is refilled beneath,
      // so the page shows through. Pre-trail phase clears to transparent
      // rather than painting an opaque box.
      if (t < TRAIL_START_MS) {
        ctx.clearRect(0, 0, LOGICAL, LOGICAL);
        fadeDtAccum = 0;
      } else {
        const trailRamp = smoothstep(t, T.trailGrow[0], T.trailGrow[1]);
        const halfLife = 800 + (params.decay - 800) * trailRamp;
        fadeDtAccum += dt;
        const fadeAlpha = 1 - Math.exp(DECAY_LN_HALF * fadeDtAccum / halfLife);
        if (fadeAlpha >= MIN_FADE_ALPHA) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
          ctx.fillRect(0, 0, LOGICAL, LOGICAL);
          ctx.globalCompositeOperation = 'source-over';
          fadeDtAccum = 0;
        }
      }

      // Precession: rotate the entire orbit frame around centroid.
      let precessionPhase = 0;
      if (params.precession !== 0 && settleFactor > 0) {
        const sign = params.precession > 0 ? 1 : -1;
        const omega = (2 * Math.PI) / Math.abs(params.precession);
        precessionPhase = sign * omega * Math.max(0, t - T.settle[0]);
      }

      // Arc-length-bounded sampling: subdivide this frame's phase step
      // into enough sub-steps that no chord exceeds MAX_CHORD logical px,
      // independent of frame rate. This avoids the kinked-polyline effect
      // of a single long chord after a dropped frame, and gives the live
      // trail the same smoothness as the analytic prefill.
      const R0  = SCALE * 2 / 3;
      const RHO = SCALE * 1 / 3;
      const rApprox = (R0 + RHO) * Math.max(orbitalRadiusFactor, radialAmpFactor, 0.01);
      const speedApprox = rApprox * Math.max(angularOmega, radialOmega, 1e-6);
      const frameArc = speedApprox * dt;
      const steps = Math.max(1, Math.min(64, Math.ceil(frameArc / MAX_CHORD)));
      const subDt = dt / steps;

      const chromaRamp = smoothstep(t, HUE_START_MS, TRAIL_START_MS);

      for (let s = 0; s < steps; s++) {
        angularPhase += angularOmega * subDt;
        radialPhase  += radialOmega  * subDt;

        const orbitalRadius = R0 * orbitalRadiusFactor;
        const radialAmp     = RHO * radialAmpFactor;
        const r = orbitalRadius + radialAmp * Math.cos(radialPhase);
        const localAngle = angularPhase + precessionPhase;
        const x = cx + r * Math.cos(localAngle);
        const y = cy + r * Math.sin(localAngle);

        const motionT = Math.max(0, t - HUE_START_MS);
        const huePeriod = period / (1 + params.parallax);
        const u = motionT / huePeriod;

        if (ballRadius > 0) {
          const jumped = prevX === null
            || Math.hypot(x - prevX, y - prevY) > ballRadius * 8;

          const c = colorFor(u, chromaRamp);
          const fillStyle = colorStyle(c);
          ctx.fillStyle = fillStyle;
          ctx.strokeStyle = fillStyle;
          ctx.lineWidth = strokeW;
          ctx.lineCap = 'round';
          if (jumped) {
            ctx.beginPath();
            ctx.arc(x, y, strokeW * 0.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
        }
        prevX = x;
        prevY = y;
      }
    }

    function reset() {
      ctx.clearRect(0, 0, LOGICAL, LOGICAL);
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
    // do in motion. (Replaces the old z-sorted analytic prefill; the mark's
    // dimensionality is an eigenform of the drawing process, not a value.)
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
    // not a z-sorted reconstruction of it.
    function renderStaticFrame() {
      reset();
      const T = phases(params.period);
      warmTo(T.trailGrow[1] + params.period * 1.5);
    }

    // Initial paint
    reset();

    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      renderStaticFrame();
    } else if (!showEmergence) {
      // Warm to the living steady state by tracing (no static prefill).
      const T = phases(params.period);
      warmTo(T.trailGrow[1] + params.period * 1.5);
    }

    let rafHandle = null;
    let observer = null;
    let paused = reducedMotion; // reduced-motion renders once and never starts rAF

    function frame(now) {
      const realDt = lastRealTime ? Math.min(now - lastRealTime, 100) : 16;
      lastRealTime = now;
      virtualTime += realDt;
      drawFrame(virtualTime, realDt, params.period);
      rafHandle = requestAnimationFrame(frame);
    }

    function start() {
      if (rafHandle || paused || reducedMotion) return;
      lastRealTime = 0;
      rafHandle = requestAnimationFrame(frame);
    }
    function stop() {
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    }

    if (!reducedMotion) start();

    // Pause/resume off-screen via IntersectionObserver. State is
    // virtualTime-driven, so resuming is trivial — no re-warmup needed.
    if (!reducedMotion && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target !== canvas) continue;
          if (entry.isIntersecting) {
            paused = false;
            start();
          } else {
            paused = true;
            stop();
          }
        }
      }, { threshold: 0 });
      observer.observe(canvas);
    }

    // Controller
    return {
      params,
      setParam(k, v) {
        if (k === 'gradient') params.gradient = resolveGradient(v);
        else if (k === 'bg') setBg(v);
        else params[k] = v;
      },
      reset,
      stop() {
        stop();
        if (observer) { observer.disconnect(); observer = null; }
      },
      get time() { return virtualTime; }
    };
  }

  // ---- Auto-init from data attrs ----
  function autoInit() {
    document.querySelectorAll('canvas[data-myrgic-mark]').forEach(c => {
      const opts = {};
      const d = c.dataset;
      if (d.emergence === 'true') opts.emergence = true;
      if (d.period)      opts.period      = parseFloat(d.period);
      if (d.scale)       opts.scale       = parseFloat(d.scale);
      if (d.ballRadius)  opts.ballRadius  = parseFloat(d.ballRadius);
      if (d.strokeWidth) opts.strokeWidth = parseFloat(d.strokeWidth);
      if (d.decay)       opts.decay       = parseFloat(d.decay);
      if (d.precession)  opts.precession  = parseFloat(d.precession);
      if (d.parallax)    opts.parallax    = parseFloat(d.parallax);
      if (d.gradient)    opts.gradient    = d.gradient;
      if (d.p)           opts.p           = parseInt(d.p, 10);
      if (d.q)           opts.q           = parseInt(d.q, 10);
      // Declarative background/reference color. The canvas itself is
      // transparent and composites onto the page — data-bg is accepted
      // for API completeness (e.g. custom halo tuning) but is no longer
      // required for correct blending the way it was under the opaque
      // substrate model.
      if (d.bg)          opts.bg          = d.bg;
      createTrefoilMark(c, opts);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit();
    }
  }

  if (typeof window !== 'undefined') {
    window.createTrefoilMark = createTrefoilMark;
    window.MYRGIC_GRADIENTS = GRADIENTS;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createTrefoilMark, GRADIENTS };
  }
})();
