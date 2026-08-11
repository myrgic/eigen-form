/* =====================================================================
   src/lifecycle/mount.js — page integration. The only file in this
   library that touches `document`, `window`, `requestAnimationFrame`,
   or `IntersectionObserver`. Everything here is guarded so it's a no-op
   under Node (see tools/golden.js, which never calls autoInit or
   observeVisibility and stubs requestAnimationFrame itself).
   ===================================================================== */

// Resolves the public API's `canvas` argument, which may already be an
// element or may be a data-attribute id string.
export function resolveCanvasElement(canvasOrId) {
  if (typeof canvasOrId === 'string') {
    return typeof document !== 'undefined' ? document.getElementById(canvasOrId) : null;
  }
  return canvasOrId;
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Wraps requestAnimationFrame scheduling behind start()/stop(), calling
// onTick(now) once per frame while running. State-driven (virtualTime
// lives in the caller), so stop()/start() never needs to re-warm.
export function createAnimationLoop(onTick) {
  let handle = null;
  function tick(now) {
    onTick(now);
    handle = requestAnimationFrame(tick);
  }
  return {
    start() {
      if (handle != null) return;
      handle = requestAnimationFrame(tick);
    },
    stop() {
      if (handle != null) {
        cancelAnimationFrame(handle);
        handle = null;
      }
    },
    get running() {
      return handle != null;
    }
  };
}

// Pauses/resumes via IntersectionObserver when available; no-ops (returns
// null) when it isn't, e.g. under Node.
export function observeVisibility(el, { onEnter, onExit }) {
  if (typeof IntersectionObserver !== 'function') return null;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== el) continue;
      if (entry.isIntersecting) onEnter();
      else onExit();
    }
  }, { threshold: 0 });
  observer.observe(el);
  return observer;
}

// Data-attribute driven auto-init: finds every
// canvas[data-myrgic-mark], builds an opts object from its dataset, and
// calls create(canvasEl, opts) for each. `create` is
// createTrefoilMark itself — this function's only job is the DOM query
// and readiness wiring.
export function autoInit(create) {
  function run() {
    document.querySelectorAll('canvas[data-myrgic-mark]').forEach((c) => {
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
      create(c, opts);
    });
  }
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}
