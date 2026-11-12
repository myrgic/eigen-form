/* =====================================================================
   src/render/knot-pen.js — the torus-knot mark drawn as a woven object:
   a closed (p,q) knot painted back-to-front by its true 3D height, every
   crossing leaving a clean gap ("drop shadow") in the strand beneath, and
   optionally a pen that keeps re-writing the knot over its own older
   paint.

   Why this exists next to createTrefoilMark: the live mark stamps short
   round-capped chords and fades the canvas a little each frame. In
   motion that reads as a glowing trail; frozen (a still, an icon, a
   recording) it shows as scalloped edges and stepped colour bands. Here
   nothing accumulates between frames: each frame is painted from scratch
   from the closed curve, so the colour band is continuous at any size.

   Depth. knotPoint() gives z = sin(radialPhase), the knot's height above
   the projection plane. Segments are painted in ascending z; each lays a
   butt-capped halo of the ground colour (width = stroke * (1 + 2*gap))
   and then its colour, so a nearer strand cuts a gap in whatever is
   beneath it and never in its own neighbours (they are repainted over
   the halo). The diagram is therefore the knot's own for every (p,q) —
   no per-crossing bookkeeping.

   The pen. Every segment carries the colour it was WRITTEN with
   (hue at write time, so a hue period != the lap period makes each pass
   lay a new colour over the last) and fades with age. A small recency
   bias on the sort key lets the newest paint win the tie against its own
   oldest lap (same place, same z) — the pen writes over the previous
   pass. True crossings differ in z by far more than the bias. The pen
   itself (a forward shadow on the paint it is about to cover, the
   freshest stretch repainted over that shadow, and the ball) is one more
   item in the same sort, keyed at least as high as its own stretch of
   curve, so a strand that truly passes over it hides it like anything
   else.

   ctx-agnostic: draws into any CanvasRenderingContext2D-shaped object
   (a real 2D context or backends/capture.js), so it runs under Node for
   tests. Uses only fillRect/arc/fill/moveTo/lineTo/stroke and style
   properties.
   ===================================================================== */

import { knotPoint, torusKnotRadii } from '../dynamics/torus-knot.js';
import { resolveGradient, colorFor, colorStyle } from '../palette/gradients.js';

export const KNOT_PEN_DEFAULTS = {
  p: 2,
  q: 3,
  size: 1024,          // output px (square)
  fill: 0.80,          // knot diameter (incl. stroke) / size
  stroke: 0.10,        // stroke width / size
  gap: 0.5,            // crossing gap each side, in stroke widths
  ground: '#070707',   // ground colour; null = transparent (gaps cut with destination-out)
  gradient: 'spectrum',
  samples: 12000,      // curve samples (sub-pixel steps at 1024px)
  // pen / animation
  hueRatio: 4 / 3,     // hue period / lap period. 1 = colour locked to position
  fadeMin: 0.4,        // brightness of the oldest paint (1 = no fade)
  ball: 0.9,           // pen ball diameter in stroke widths (0 = no ball)
  ballColor: '#f4f4f6',
  bias: 0.08,          // recency bias on depth (newest paint wins ties with its own old lap)
  rot: 0               // rotation of the knot in the plane (radians)
};

function finiteOr(v, d) { return Number.isFinite(v) ? v : d; }

function resolve(opts) {
  const o = Object.assign({}, KNOT_PEN_DEFAULTS, opts || {});
  for (const k of ['p', 'q', 'size', 'fill', 'stroke', 'gap', 'samples', 'hueRatio', 'fadeMin', 'ball', 'bias', 'rot']) {
    o[k] = finiteOr(Number(o[k]), KNOT_PEN_DEFAULTS[k]);
  }
  o.p = Math.max(1, Math.round(o.p));
  o.q = Math.max(1, Math.round(o.q));
  o.samples = Math.max(600, Math.round(o.samples));
  o.hueRatio = o.hueRatio === 0 ? 1 : o.hueRatio;
  o.gradient = resolveGradient(o.gradient);
  return o;
}

/**
 * Builds the sampled, fitted curve once. Returns a renderer with
 * drawStill(ctx) and drawFrame(ctx, t) (t in laps; the pen is at
 * s = t mod 1), plus penOccluded(t) for verification.
 */
export function createKnotPen(opts) {
  const o = resolve(opts);
  const S = o.size, N = o.samples;
  const { R0, RHO } = torusKnotRadii(1);
  const pts = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const s = i / N, th = 2 * Math.PI * s;
    const k = knotPoint({ orbitalRadius: R0, radialAmp: RHO, angularPhase: o.p * th,
      radialPhase: o.q * th, precessionPhase: o.rot, cx: 0, cy: 0 });
    pts[i] = { x: k.x, y: k.y, z: k.z, s };
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const W = o.stroke * S;
  const k = (o.fill * S - W) / Math.max(x1 - x0, y1 - y0);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (const p of pts) { p.X = S / 2 + (p.x - mx) * k; p.Y = S / 2 + (p.y - my) * k; }
  const HW = W * (1 + 2 * o.gap);
  const segZ = new Float64Array(N);
  for (let i = 0; i < N; i++) segZ[i] = (pts[i].z + pts[i + 1].z) / 2;
  // Curve indices within which the pen counts as "its own stretch": the
  // arc length of one halo width, generously, but well short of the
  // nearest true crossing.
  const lapLen = (() => { let L = 0; for (let i = 0; i < N; i++) L += Math.hypot(pts[i + 1].X - pts[i].X, pts[i + 1].Y - pts[i].Y); return L; })();
  const near = Math.max(4, Math.ceil(N * Math.min(0.06, (3 * HW) / lapLen)));
  const span = Math.ceil(N * HW / lapLen) + 2;

  function ground(ctx) {
    if (o.ground) { ctx.fillStyle = o.ground; ctx.fillRect(0, 0, S, S); }
    else if (ctx.clearRect) ctx.clearRect(0, 0, S, S);
  }
  function line(ctx, i, width, cap, style) {
    const a = pts[i], b = pts[i + 1];
    ctx.strokeStyle = style; ctx.lineCap = cap; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke();
  }
  function cut(ctx, draw) {
    // Gaps are ground-coloured; on a transparent ground they are erased.
    if (o.ground) { draw(o.ground); return; }
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'destination-out';
    draw('#000');
    ctx.globalCompositeOperation = prev;
  }

  // One painted item per segment: its depth key, colour, brightness.
  function items(t, animated) {
    const out = new Array(N);
    const sh = ((t % 1) + 1) % 1;
    for (let i = 0; i < N; i++) {
      let age = 0, tw = pts[i].s;
      if (animated) {
        age = ((sh - pts[i].s) % 1 + 1) % 1;      // 0 = just written, -> 1 = oldest
        tw = t - age;                              // when it was written (laps)
      }
      const c = colorFor(animated ? tw / o.hueRatio : tw, 1, o.gradient);
      const b = animated ? o.fadeMin + (1 - o.fadeMin) * Math.pow(1 - age, 1.6) : 1;
      out[i] = {
        i,
        key: segZ[i] + (animated ? o.bias * (1 - age) : 0),
        b,
        col: colorStyle({ hue: c.hue, sat: c.sat, light: c.light * b })
      };
    }
    return out;
  }

  function paint(ctx, list) {
    for (const it of list) {
      if (it.pen) { it.pen(); continue; }
      // a faded strand casts a slightly smaller gap
      cut(ctx, (st) => line(ctx, it.i, W + (HW - W) * Math.min(1, it.b * 1.2), 'butt', st));
      line(ctx, it.i, W, 'round', it.col);
    }
  }

  function drawStill(ctx) {
    ground(ctx);
    const list = items(0, false).sort((a, b) => a.key - b.key);
    paint(ctx, list);
  }

  function penKeyAt(byIndex, hi) {
    let key = byIndex[hi].key;
    for (let m = -near; m <= near; m++) key = Math.max(key, byIndex[((hi + m) % N + N) % N].key);
    return key + 1e-6;
  }

  function drawFrame(ctx, t) {
    ground(ctx);
    const byIndex = items(t, true);
    const hi = Math.floor((((t % 1) + 1) % 1) * N) % N;
    const h = pts[hi + 1];
    const list = byIndex.slice();
    list.push({
      key: penKeyAt(byIndex, hi),
      pen: () => {
        cut(ctx, (st) => { ctx.fillStyle = st; ctx.beginPath(); ctx.arc(h.X, h.Y, HW / 2, 0, Math.PI * 2); ctx.fill(); });
        for (let m = span; m >= 0; m--) line(ctx, ((hi - m) % N + N) % N, W, 'round', byIndex[((hi - m) % N + N) % N].col);
        if (o.ball > 0) {
          ctx.fillStyle = o.ballColor; ctx.beginPath();
          ctx.arc(h.X, h.Y, o.ball * W / 2, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
    list.sort((a, b) => a.key - b.key);
    paint(ctx, list);
  }

  // Geometric occlusion of the pen at time t: some strand far along the
  // curve (a true crossing, not the pen's own stretch) is painted after
  // the pen and covers the pen's centre. Used by tests: the pen must be
  // hidden exactly once per under-crossing per lap.
  function penOccluded(t) {
    const byIndex = items(t, true);
    const hi = Math.floor((((t % 1) + 1) % 1) * N) % N;
    const h = pts[hi + 1], pk = penKeyAt(byIndex, hi);
    for (let j = 0; j < N; j++) {
      const d = Math.min(Math.abs(j - hi), N - Math.abs(j - hi));
      if (d <= near) continue;
      if (byIndex[j].key > pk && Math.hypot(pts[j].X - h.X, pts[j].Y - h.Y) < W / 2) return true;
    }
    return false;
  }

  return { options: o, size: S, strokeWidth: W, samples: N, drawStill, drawFrame, penOccluded };
}

/**
 * Number of crossings in the diagram drawn here (angular winding p,
 * radial winding q): q * (p - 1). (2,3) -> 3, (3,4) -> 8, (2,5) -> 5.
 * The pen passes under each crossing exactly once per lap.
 */
export function diagramCrossings(p, q) { return q * (p - 1); }

/**
 * Animated controller on a real canvas: the pen laps every `lapMs`.
 * Honours prefers-reduced-motion by drawing one still and not looping.
 * Returns { stop, start, renderer, setTime(t) }.
 */
export function createKnotPenMark(canvas, opts) {
  const o = Object.assign({ lapMs: 2250, animate: true }, opts || {});
  const size = o.size || canvas.width || KNOT_PEN_DEFAULTS.size;
  canvas.width = size; canvas.height = size;
  const renderer = createKnotPen(Object.assign({}, o, { size }));
  const ctx = canvas.getContext('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, t0 = null, running = false;
  function tick(now) {
    if (!running) return;
    if (t0 === null) t0 = now;
    renderer.drawFrame(ctx, (now - t0) / o.lapMs);
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (running || reduced || !o.animate) { if (!running) renderer.drawStill(ctx); return; }
    running = true; t0 = null; raf = requestAnimationFrame(tick);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  start();
  return { renderer, start, stop, setTime(t) { stop(); renderer.drawFrame(ctx, t); } };
}
