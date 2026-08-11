/* =====================================================================
   src/figure-spec.js — a torus-knot mark's full parameter state as a
   small versioned document. exportSpec() turns a live controller's
   params into a spec; fromSpec() turns a spec back into the opts object
   createTrefoilMark() accepts. This is "figures can answer for
   themselves" (ROADMAP.md design principle 5) for the torus-knot family:
   a spec names its family, its version, and every tunable, so a figure
   can be reconstructed or diffed without guessing.
   ===================================================================== */

export const SPEC_VERSION = 1;
export const FAMILY = 'torus-knot';

export const PARAM_DEFAULTS = {
  p: 2,
  q: 3,
  scale: 215,
  period: 3000,
  ballRadius: 18,
  strokeWidth: null,
  decay: 6000,
  precession: 0,
  parallax: 0,
  gradient: 'spectrum'
};

// params is a live controller's params object — params.gradient is
// already resolved to a {hueStart,hueEnd,sat,light,...} object by
// resolveGradient(), not the name/object it was constructed with. When
// the GRADIENTS table is supplied and the resolved gradient matches a
// named preset exactly, the spec names it instead of inlining the
// object, so a spec built from a stock gradient reads legibly and still
// round-trips through fromSpec() -> createTrefoilMark().
export function exportSpec(params, { GRADIENTS } = {}) {
  return {
    version: SPEC_VERSION,
    family: FAMILY,
    params: {
      p: params.p,
      q: params.q,
      scale: params.scale,
      period: params.period,
      ballRadius: params.ballRadius,
      strokeWidth: params.strokeWidth,
      decay: params.decay,
      precession: params.precession,
      parallax: params.parallax,
      gradient: namedGradientOrObject(params.gradient, GRADIENTS)
    }
  };
}

function sameGradient(a, b) {
  return a.hueStart === b.hueStart
    && a.hueEnd === b.hueEnd
    && a.sat === b.sat
    && a.light === b.light
    && (a.lightEnd ?? a.light) === (b.lightEnd ?? b.light);
}

function namedGradientOrObject(resolved, GRADIENTS) {
  if (!GRADIENTS) return resolved;
  for (const [name, g] of Object.entries(GRADIENTS)) {
    if (sameGradient(g, resolved)) return name;
  }
  return resolved;
}

// Turns a spec back into an opts object createTrefoilMark(canvas, opts)
// accepts directly.
export function fromSpec(spec) {
  if (!spec || spec.version !== SPEC_VERSION) {
    throw new Error(`figure-spec: unsupported spec version ${spec && spec.version}`);
  }
  if (spec.family !== FAMILY) {
    throw new Error(`figure-spec: expected family "${FAMILY}", got "${spec.family}"`);
  }
  return { ...spec.params };
}

// =====================================================================
// v0.2 addition (docs/params-panel-design.md, "defineParams"): a spec
// can additionally carry a src/params/define.js store's schema hash and
// current values, alongside the torus-knot `params` field above. Purely
// additive — exportSpec()/fromSpec() above are unchanged, and a spec
// built without a params store round-trips exactly as it always has.
// `store` here is whatever defineParams(schema) returned; only its
// serialize() contract is used, so this stays decoupled from any one
// schema shape.
// =====================================================================

export function withParamsStore(spec, store) {
  return { ...spec, paramsStore: store.serialize() };
}

export function paramsStoreOf(spec) {
  return (spec && spec.paramsStore) || null;
}
