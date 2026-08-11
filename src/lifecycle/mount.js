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

// Parses a data-attribute as a float/int, assigning it into opts only
// when the parse actually produced a finite number. `if (d.xxx)` alone
// only gates on the raw string being non-empty — a malformed value (a
// stray "undefined" from an unset template variable, a typo'd unit like
// "ms") parses to NaN, which is truthy-adjacent enough to sail past that
// gate and then past createTrefoilMark's own `!= null` default checks,
// permanently poisoning the mark (NaN phases never recover). Falls back
// to createTrefoilMark's own default by simply not setting the key, same
// as an absent attribute; warns once so a malformed value isn't silently
// invisible.
function setFiniteAttr(opts, key, raw, parse) {
  if (!raw) return;
  const v = parse(raw);
  if (Number.isFinite(v)) {
    opts[key] = v;
  } else if (typeof console !== 'undefined') {
    console.warn(`eigen-form: data attribute for "${key}" ("${raw}") did not parse to a finite number, ignoring`);
  }
}

// Data-attribute driven auto-init: finds every
// canvas[data-myrgic-mark], builds an opts object from its dataset, and
// calls create(canvasEl, opts) for each. `create` is
// createTrefoilMark itself — this function's only job is the DOM query
// and readiness wiring. A canvas that already has a controller (from an
// earlier autoInit pass, or an imperative createTrefoilMark call on the
// same element) is handled by createTrefoilMark's own dedup guard
// (src/eigen-form.js, MARK_KEY) — calling create() again here just
// retrieves the existing controller rather than constructing a second
// one, so re-running run() is always safe.
export function autoInit(create) {
  function run() {
    document.querySelectorAll('canvas[data-myrgic-mark]').forEach((c) => {
      const opts = {};
      const d = c.dataset;
      if (d.emergence === 'true') opts.emergence = true;
      setFiniteAttr(opts, 'period',      d.period,      parseFloat);
      setFiniteAttr(opts, 'scale',       d.scale,       parseFloat);
      setFiniteAttr(opts, 'ballRadius',  d.ballRadius,  parseFloat);
      setFiniteAttr(opts, 'strokeWidth', d.strokeWidth, parseFloat);
      setFiniteAttr(opts, 'decay',       d.decay,       parseFloat);
      setFiniteAttr(opts, 'precession',  d.precession,  parseFloat);
      setFiniteAttr(opts, 'parallax',    d.parallax,    parseFloat);
      if (d.gradient)    opts.gradient    = d.gradient;
      setFiniteAttr(opts, 'p', d.p, (s) => parseInt(s, 10));
      setFiniteAttr(opts, 'q', d.q, (s) => parseInt(s, 10));
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
