/* =====================================================================
   src/params/define.js — declared parameter schemas and the store that
   backs them.

   docs/params-panel-design.md is the contract this implements: a
   simulation declares its knobs as a typed schema (defineParams), the
   engine renders the inspector from it (src/panel/render.js), and a
   figure spec becomes schema-plus-values instead of a bag of numbers.

   NO DOM ANYWHERE IN THIS FILE. This module is the store; the renderer
   is a separate module (src/panel/render.js) that owns every DOM touch.
   Same split as src/eigen-form.js's own dynamics/backends seam: this
   file is pure state and validation, framework- and canvas-agnostic.

   Store surface:
     get(key)                 current value (the prereg value if locked)
     set(key, value)           validates type + range, throws on locked
                              (prereg) keys
     values()                  plain object snapshot of every current
                              value
     subscribe(fn)              fn(key, value) on every successful set;
                              returns an unsubscribe function
     serialize()                 { schemaHash, values }
     hydrate(obj)                 applies obj.values to every unlocked
                              key present in it; locked keys never move
     locked(key)                  true when the key declares a prereg
                              value — the panel renders those read-only
     schema                       the frozen schema this store was built
                              from, for a renderer to introspect (types,
                              groups, labels, units, options)
     schemaHash()                 the schema's content hash (see
                              schemaHash() below), used by
                              serialize()/hydrate() to catch a spec
                              built against a different schema
     sliderToValue(key, t)        scale-aware 0..1 slider fraction ->
                              value, per the param's declared `scale`
     valueToSlider(key, v)        scale-aware value -> 0..1 slider
                              fraction

   Scale math (linear / log / log-complement) lives in this file, as
   scaleToValue/scaleFromValue below, so every renderer maps sliders the
   same way — a renderer never re-derives what "0.9..0.999 on a
   log-complement scale" means, it asks the store.
   ===================================================================== */

const VALID_TYPES = new Set(['number', 'angle', 'boolean', 'select']);
const VALID_SCALES = new Set(['linear', 'log', 'log-complement']);

// ---- Scale mapping: slider fraction t in [0,1] <-> a param's value ----
// Shared by every renderer so a decay-style parameter (0.9..0.999, where
// a linear slider wastes all its resolution on the useless end) reads
// the same way wherever it's drawn.

function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

// value -> slider fraction t in [0,1]
function scaleFromValue(scale, min, max, value) {
  if (scale === 'log') {
    // min/max must be > 0 for a log scale to be meaningful; that's on
    // the schema author to declare correctly (see defineParams below).
    const lo = Math.log(min), hi = Math.log(max);
    if (hi === lo) return 0;
    return clamp01((Math.log(value) - lo) / (hi - lo));
  }
  if (scale === 'log-complement') {
    // Built for decay-style constants that approach 1 (e.g. 0.9..0.999,
    // docs/params-panel-design.md's evaporation example): work in the
    // complement space (1 - value), where the perceptually interesting
    // resolution — near max — is the *small* end, then go log there.
    const cMin = 1 - min, cMax = 1 - max;
    const c = 1 - value;
    const loC = Math.log(cMin), hiC = Math.log(cMax);
    if (hiC === loC) return 0;
    return clamp01((Math.log(c) - loC) / (hiC - loC));
  }
  // linear
  if (max === min) return 0;
  return clamp01((value - min) / (max - min));
}

// slider fraction t in [0,1] -> value
function scaleToValue(scale, min, max, t) {
  t = clamp01(t);
  if (scale === 'log') {
    const lo = Math.log(min), hi = Math.log(max);
    return Math.exp(lo + t * (hi - lo));
  }
  if (scale === 'log-complement') {
    const cMin = 1 - min, cMax = 1 - max;
    const loC = Math.log(cMin), hiC = Math.log(cMax);
    const c = Math.exp(loC + t * (hiC - loC));
    return 1 - c;
  }
  return min + t * (max - min);
}

// ---- Deterministic schema hash ----
// A stable (sorted-key) JSON stringify, hashed with FNV-1a 32-bit. No
// crypto dependency, so this runs identically in a browser tab and
// under `node tests/params.js`. Not a security hash — a change
// detector: two schemas with the same shape hash the same, any change
// to any field of any param hashes differently.
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

function schemaHash(schema) {
  const stable = canonicalStringify(schema);
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function defineParams(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('defineParams: schema must be a plain object of param definitions');
  }

  // ---- definition-time validation ----
  for (const [key, def] of Object.entries(schema)) {
    if (!def || typeof def !== 'object') {
      throw new Error(`defineParams: "${key}" definition must be an object`);
    }
    if (!VALID_TYPES.has(def.type)) {
      throw new Error(`defineParams: "${key}" has invalid type "${def.type}" (want one of ${[...VALID_TYPES].join(', ')})`);
    }
    if (def.type === 'number' || def.type === 'angle') {
      if (typeof def.min !== 'number' || typeof def.max !== 'number') {
        throw new Error(`defineParams: "${key}" (${def.type}) requires numeric min and max`);
      }
      if (def.max < def.min) {
        throw new Error(`defineParams: "${key}" has max (${def.max}) below min (${def.min})`);
      }
      if (def.scale !== undefined && !VALID_SCALES.has(def.scale)) {
        throw new Error(`defineParams: "${key}" has invalid scale "${def.scale}" (want one of ${[...VALID_SCALES].join(', ')})`);
      }
    }
    if (def.type === 'select') {
      if (!Array.isArray(def.options) || def.options.length === 0) {
        throw new Error(`defineParams: "${key}" (select) requires a non-empty options array`);
      }
    }
    const hasDefault = hasOwn(def, 'default');
    const hasPrereg = hasOwn(def, 'prereg');
    if (!hasDefault && !hasPrereg) {
      throw new Error(`defineParams: "${key}" needs a "default" (or a "prereg" lock value)`);
    }
  }

  // Freeze the schema (and every def inside it) so a renderer can hold a
  // reference to store.schema without anyone mutating a declaration out
  // from under it after the fact.
  const frozenSchema = Object.freeze(
    Object.fromEntries(Object.entries(schema).map(([k, d]) => [k, Object.freeze({ ...d })]))
  );
  const hash = schemaHash(frozenSchema);

  const values = {};
  for (const [key, def] of Object.entries(frozenSchema)) {
    values[key] = hasOwn(def, 'prereg') ? def.prereg : def.default;
  }

  const listeners = new Set();

  function isLocked(key) {
    const def = frozenSchema[key];
    return !!def && hasOwn(def, 'prereg');
  }

  function validate(key, value) {
    const def = frozenSchema[key];
    if (!def) throw new Error(`params: unknown key "${key}"`);
    if (isLocked(key)) {
      throw new Error(`params: "${key}" is locked by a prereg value (${JSON.stringify(def.prereg)}) and cannot be set`);
    }
    if (def.type === 'number' || def.type === 'angle') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`params: "${key}" must be a finite number, got ${JSON.stringify(value)}`);
      }
      if (value < def.min || value > def.max) {
        throw new Error(`params: "${key}" = ${value} is out of range [${def.min}, ${def.max}]`);
      }
    } else if (def.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`params: "${key}" must be a boolean, got ${JSON.stringify(value)}`);
      }
    } else if (def.type === 'select') {
      if (!def.options.includes(value)) {
        throw new Error(`params: "${key}" = ${JSON.stringify(value)} is not one of [${def.options.join(', ')}]`);
      }
    }
  }

  const store = {
    schema: frozenSchema,

    get(key) {
      if (!(key in frozenSchema)) throw new Error(`params: unknown key "${key}"`);
      return values[key];
    },

    set(key, value) {
      validate(key, value);
      values[key] = value;
      for (const fn of listeners) fn(key, value);
      return value;
    },

    values() {
      return { ...values };
    },

    locked: isLocked,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    schemaHash() {
      return hash;
    },

    serialize() {
      return { schemaHash: hash, values: store.values() };
    },

    // Applies obj.values (or a bare values object) to every unlocked key
    // present in it. Locked keys never move on hydrate, same as set():
    // a spec captured with a stale value for a since-locked key is not
    // an error, it's just ignored, matching "the panel will not render a
    // writable control for a declared value" — hydrate honors the same
    // rule for a value arriving out of band.
    hydrate(obj) {
      if (!obj || typeof obj !== 'object') {
        throw new Error('params: hydrate() needs an object');
      }
      if (obj.schemaHash !== undefined && obj.schemaHash !== hash) {
        throw new Error(`params: hydrate() schema hash ${obj.schemaHash} does not match this store's schema (${hash})`);
      }
      const src = obj.values || obj;
      for (const key of Object.keys(frozenSchema)) {
        if (!(key in src)) continue;
        if (isLocked(key)) continue;
        store.set(key, src[key]);
      }
      return store;
    },

    sliderToValue(key, t) {
      const def = frozenSchema[key];
      if (!def) throw new Error(`params: unknown key "${key}"`);
      return scaleToValue(def.scale || 'linear', def.min, def.max, t);
    },

    valueToSlider(key, value) {
      const def = frozenSchema[key];
      if (!def) throw new Error(`params: unknown key "${key}"`);
      return scaleFromValue(def.scale || 'linear', def.min, def.max, value);
    }
  };

  return store;
}

// ES module surface, same shape as src/eigen-form.js's own dual export.
export { defineParams, scaleToValue, scaleFromValue, schemaHash };
export default { defineParams, scaleToValue, scaleFromValue, schemaHash };
