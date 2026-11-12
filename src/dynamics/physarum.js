/* =====================================================================
   src/dynamics/physarum.js — the Physarum (slime mold) transport model
   as a library family: agents that deposit into a shared, diffusing,
   decaying field and steer toward the strongest concentration ahead.

   Lineage: apps/physarum (frozen golden). The steering rule is that
   file's, unchanged: sense front / left / right at angle `sa` and
   distance `sensorDist`; keep straight if front is strongest, turn at
   random if front is weakest, else turn `ra` toward the stronger side;
   step; deposit. What differs is everything around the rule:
     - typed arrays and a sine table, so 60k agents fit in a frame
       (the original: 8k agents as objects, Math.cos per sensor)
     - edges wrap (the original teleported and reversed the agent)
     - diffusion is a separable 3-tap blur mixed in by `diffuse`
       (the original: a fixed 3x3 mean every step)
     - time is seeded (xorshift), so a run is reproducible and testable
     - `crowd`: a ceiling on what a sensor can read. The rule only
       compares, so in a vein denser than the ceiling all three sensors
       read the same and the agent goes straight on, out of the vein.
       Without it a dense colony drains into a few thick cords within
       seconds; with it the mesh stays a mesh. Infinity = the original.
     - a second field, `glow`, that agents ALSO sense (weighted by
       `attract`). Nothing in the model writes it; it is where the
       outside world reaches in: pulse(), seed(). That is the port a
       performance plays through (src/signal/router.js triggers).

   NO DOM, NO CANVAS, NO CLOCK. step(params) advances one tick;
   paint() writes RGBA into a buffer the caller owns.
   ===================================================================== */

const TAB = 4096, TAB_MASK = TAB - 1, TWO_PI = Math.PI * 2, TO_TAB = TAB / TWO_PI;
const COS = new Float32Array(TAB), SIN = new Float32Array(TAB);
for (let i = 0; i < TAB; i++) { COS[i] = Math.cos(i / TO_TAB); SIN[i] = Math.sin(i / TO_TAB); }

const SPAWNS = ['disc', 'ring', 'scatter', 'core'];

function createPhysarum({ width, height, agents = 60000, seed = 1, spawn = 'disc' } = {}) {
  const W = Math.max(16, width | 0), H = Math.max(16, height | 0), N = W * H, A = Math.max(1, agents | 0);
  let trail = new Float32Array(N), bufA = new Float32Array(N), bufB = new Float32Array(N);
  const glow = new Float32Array(N);
  const ax = new Float32Array(A), ay = new Float32Array(A), aa = new Float32Array(A);
  let rings = [];
  let rs = (seed >>> 0) || 1;
  const rand = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };

  function respawn(mode = 'disc') {
    const cx = W / 2, cy = H / 2, R = Math.min(W, H);
    for (let i = 0; i < A; i++) {
      const th = rand() * TWO_PI;
      if (mode === 'ring') { const r = R * (0.36 + 0.03 * rand()); ax[i] = cx + r * Math.cos(th); ay[i] = cy + r * Math.sin(th); aa[i] = (th + Math.PI) % TWO_PI; }           // a ring, facing in
      else if (mode === 'scatter') { ax[i] = rand() * W; ay[i] = rand() * H; aa[i] = th; }                                                                               // everywhere, any heading
      else if (mode === 'core') { const r = R * 0.04 * Math.sqrt(rand()); ax[i] = cx + r * Math.cos(th); ay[i] = cy + r * Math.sin(th); aa[i] = th; }                     // a point, facing out
      else { const r = R * 0.3 * Math.sqrt(rand()); ax[i] = cx + r * Math.cos(th); ay[i] = cy + r * Math.sin(th); aa[i] = (th + Math.PI) % TWO_PI; }                      // a disc, facing in (the original's start)
      ax[i] = ((ax[i] % W) + W) % W; ay[i] = ((ay[i] % H) + H) % H;
    }
  }

  // A soft blob of attractant: food the agents converge on while it lasts. Glow only: written into the
  // trail it would outlive the note and become a permanent sink the whole colony drains into.
  function seedAt(x, y, strength = 1, radius = 0) {
    const r = Math.max(2, radius || (3 + 7 * strength)), r2 = r * r, ir = Math.ceil(r);
    const x0 = Math.round(x), y0 = Math.round(y);
    for (let dy = -ir; dy <= ir; dy++) {
      const yy = (((y0 + dy) % H) + H) % H;
      for (let dx = -ir; dx <= ir; dx++) {
        const d2 = dx * dx + dy * dy; if (d2 > r2) continue;
        const xx = (((x0 + dx) % W) + W) % W, w = (1 - d2 / r2);
        glow[yy * W + xx] += 14 * strength * w * w;
      }
    }
  }

  // A ring that expands from (x, y): a wavefront in the glow field the agents chase outward.
  function pulse(strength = 1, x = W / 2, y = H / 2) {
    if (rings.length > 24) rings.shift();
    rings.push({ x, y, r: 2, v: 2.2 + 3.2 * strength, amp: 1.6 * strength });
  }

  // Knock a fraction of the agents off their trails: the network shatters, then heals.
  function scatter(fraction = 0.3) {
    const f = Math.min(1, Math.max(0, fraction));
    for (let i = 0; i < A; i++) if (rand() < f) aa[i] = rand() * TWO_PI;
  }

  function stepRings() {
    const maxR = Math.hypot(W, H) * 0.6;
    for (const g of rings) {
      // Paint the whole band the front crossed this step (one circle per pixel of travel), not just its
      // new edge: a fast ring would otherwise leave a stack of thin circles with gaps between them.
      const from = g.r; g.r += g.v; g.amp *= 0.955;
      const passes = Math.max(1, Math.ceil(g.v)), share = g.amp / passes;
      for (let k = 1; k <= passes; k++) {
        const r = from + (g.r - from) * (k / passes);
        const n = Math.max(24, Math.ceil(TWO_PI * r * 1.6)), dt = TAB / n;
        for (let i = 0; i < n; i++) {
          const t = (i * dt) & TAB_MASK;
          const x = (g.x + r * COS[t]) | 0, y = (g.y + r * SIN[t]) | 0;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          glow[y * W + x] += share;
        }
      }
    }
    rings = rings.filter((g) => g.amp > 0.15 && g.r < maxR);
  }

  function step(p) {
    const sa = p.sa, ra = p.ra, sd = p.sensorDist, sp = p.speed, dep = p.deposit, att = p.attract || 0, wander = p.wander || 0;
    const cap = p.crowd > 0 ? p.crowd : Infinity;
    // spores: each step a small fraction of agents lets go and lands somewhere else, so empty ground keeps
    // being recolonised and the mesh never finishes coarsening.
    const spores = p.spores > 0 ? Math.min(A, Math.round(A * p.spores)) : 0;
    for (let k = 0; k < spores; k++) { const i = (rand() * A) | 0; ax[i] = rand() * W; ay[i] = rand() * H; aa[i] = rand() * TWO_PI; }
    stepRings();

    for (let i = 0; i < A; i++) {
      let a = aa[i];
      const x = ax[i], y = ay[i];
      const tf = (a * TO_TAB) & TAB_MASK, tl = ((a - sa) * TO_TAB) & TAB_MASK, tr = ((a + sa) * TO_TAB) & TAB_MASK;
      let fx = (x + COS[tf] * sd) | 0, fy = (y + SIN[tf] * sd) | 0;
      let lx = (x + COS[tl] * sd) | 0, ly = (y + SIN[tl] * sd) | 0;
      let rx = (x + COS[tr] * sd) | 0, ry = (y + SIN[tr] * sd) | 0;
      fx = fx < 0 ? fx + W : fx >= W ? fx - W : fx; fy = fy < 0 ? fy + H : fy >= H ? fy - H : fy;
      lx = lx < 0 ? lx + W : lx >= W ? lx - W : lx; ly = ly < 0 ? ly + H : ly >= H ? ly - H : ly;
      rx = rx < 0 ? rx + W : rx >= W ? rx - W : rx; ry = ry < 0 ? ry + H : ry >= H ? ry - H : ry;
      const fi = fy * W + fx, li = ly * W + lx, ri = ry * W + rx;
      let wF = trail[fi], wL = trail[li], wR = trail[ri];
      if (wF > cap) wF = cap; if (wL > cap) wL = cap; if (wR > cap) wR = cap;
      wF += att * glow[fi]; wL += att * glow[li]; wR += att * glow[ri];

      if (wF > wL && wF > wR) { /* straight on */ }
      else if (wF < wL && wF < wR) a += rand() > 0.5 ? ra : -ra;
      else if (wL > wR) a -= ra;
      else if (wR > wL) a += ra;
      if (wander) a += (rand() - 0.5) * wander;
      if (a < 0) a += TWO_PI; else if (a >= TWO_PI) a -= TWO_PI;

      const tm = (a * TO_TAB) & TAB_MASK;
      let nx = x + COS[tm] * sp, ny = y + SIN[tm] * sp;
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      if (ny < 0) ny += H; else if (ny >= H) ny -= H;
      ax[i] = nx; ay[i] = ny; aa[i] = a;
      const ci = (ny | 0) * W + (nx | 0);
      if (ci >= 0 && ci < N) trail[ci] += dep;
    }

    // diffuse (separable 3-tap, wrapped) and decay
    const d = Math.min(1, Math.max(0, p.diffuse)), keep = 1 - d, third = d / 3, decay = p.decay;
    for (let y = 0; y < H; y++) {
      const o = y * W;
      bufA[o] = trail[o + W - 1] + trail[o] + trail[o + 1];
      for (let x = 1; x < W - 1; x++) bufA[o + x] = trail[o + x - 1] + trail[o + x] + trail[o + x + 1];
      bufA[o + W - 1] = trail[o + W - 2] + trail[o + W - 1] + trail[o];
    }
    for (let y = 0; y < H; y++) {
      const o = y * W, up = (y === 0 ? H - 1 : y - 1) * W, dn = (y === H - 1 ? 0 : y + 1) * W;
      for (let x = 0; x < W; x++) {
        const blur = (bufA[up + x] + bufA[o + x] + bufA[dn + x]) * (1 / 3);
        bufB[o + x] = (trail[o + x] * keep + blur * third) * decay;
      }
    }
    const t = trail; trail = bufB; bufB = t;

    const gd = p.glowDecay == null ? 0.75 : p.glowDecay;
    for (let i = 0; i < N; i++) glow[i] *= gd;
  }

  // RGBA out. lut: 256 x 3 bytes (see buildLut); accent: [r, g, b] 0..255 for the glow field.
  function paint(out, lut, accent, gain = 0.22, glowGain = 0.07) {
    const ar = accent[0], ag = accent[1], ab = accent[2];
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const v = trail[i] * gain;
      const k = ((v >= 6 ? 1 : 1 - Math.exp(-v)) * 255 | 0) * 3;
      const g = glow[i] * glowGain, e = g <= 0.001 ? 0 : g >= 6 ? 1 : 1 - Math.exp(-g);
      out[j] = lut[k] + ar * e; out[j + 1] = lut[k + 1] + ag * e; out[j + 2] = lut[k + 2] + ab * e; out[j + 3] = 255;
    }
  }

  respawn(spawn);

  return {
    width: W, height: H, agents: A,
    get trail() { return trail; },
    glow, ax, ay, aa,
    get rings() { return rings.length; },
    step, paint, respawn, seed: seedAt, pulse, scatter
  };
}

// hue-anchored ramp: black -> deep saturated -> bright -> near white at the very top.
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function buildLut(hue = 150, spread = 60, out = new Uint8Array(256 * 3)) {
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const [r, g, b] = hsl(hue + spread * (t - 0.5), 0.92 - 0.35 * t * t * t, Math.pow(t, 1.25) * (0.5 + 0.42 * t * t));
    out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
  }
  return out;
}
function accentFor(hue, offset = 150) { return hsl(hue + offset, 1, 0.62); }

export { createPhysarum, buildLut, accentFor, SPAWNS };
export default { createPhysarum, buildLut, accentFor, SPAWNS };
