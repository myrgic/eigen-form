/* =====================================================================
   src/backends/capture.js — a stand-in for CanvasRenderingContext2D that
   records every call and property set the engine makes, instead of
   painting pixels. This is what lets the engine run headlessly under
   Node and be hashed for regression: the "op stream" is every drawing
   instruction the engine issued, in order.

   Determinism note: a (p,q) torus-knot position comes from Math.cos /
   Math.sin on accumulated phase, and transcendental function output can
   differ by a handful of ULPs across CPU architectures and JS engine
   versions, even for bit-identical inputs. Left unrounded, that noise
   would make opsHash() unstable across machines for no meaningful reason.
   Every numeric argument and numeric property value is therefore rounded
   to 6 decimal places (~1e-6 logical px, far below anything visible or
   meaningful to the renderer) before it's recorded. String values
   (fillStyle, globalCompositeOperation, ...) are recorded as-is — the
   engine already formats those with fixed decimal precision itself
   (see colorStyle's toFixed calls in palette/gradients.js), so they're
   stable without help.

   Implemented as a Proxy rather than a hardcoded method allowlist: any
   property read that hasn't been set becomes a recorded method call, any
   property write is recorded as a state change. That makes this a
   genuine stand-in for the whole CanvasRenderingContext2D surface, not
   just the handful of calls the current torus-knot engine happens to
   make — future backends/families can grow their canvas usage without
   this file needing to know about it in advance.

   Node-only: uses node:crypto for hashing, so this file is a test/tool
   dependency (see tools/golden.js), never imported by the browser-facing
   assembly (src/eigen-form.js).
   ===================================================================== */

import { createHash } from 'node:crypto';

export const PRECISION = 6;

function round(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const f = 10 ** PRECISION;
  return Math.round(value * f) / f;
}

function roundArgs(args) {
  return args.map(round);
}

/**
 * Creates a fresh capture context: `ctx` is the CanvasRenderingContext2D
 * stand-in to hand to the engine, `ops` is the live ordered op list, and
 * `opsHash()` returns the sha256 (hex) of the JSON-serialized op stream.
 */
export function createCaptureContext() {
  const ops = [];
  const state = Object.create(null);

  const ctx = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === 'canvas') return { width: 0, height: 0 };
      if (Object.prototype.hasOwnProperty.call(state, prop)) return state[prop];
      // Not a property that's ever been set — treat access as a method
      // call site: return a recorder bound to this property name.
      return (...args) => {
        ops.push({ op: prop, args: roundArgs(args) });
      };
    },
    set(_target, prop, value) {
      state[prop] = value;
      ops.push({ set: prop, value: round(value) });
      return true;
    }
  });

  function opsHash() {
    return createHash('sha256').update(JSON.stringify(ops)).digest('hex');
  }

  return { ctx, ops, opsHash, precision: PRECISION };
}

export default { createCaptureContext, PRECISION };
