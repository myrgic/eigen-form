/* =====================================================================
   src/backends/canvas2d.js — every ctx call the engine makes, named.

   This module doesn't know or care whether `ctx` is a real
   CanvasRenderingContext2D or the capture stand-in (capture.js) —
   both expose the same method/property surface, so the identical
   sequence of calls below either paints pixels or gets recorded for
   hashing. That's what makes the golden-op equivalence gate meaningful:
   the dynamics and palette modules compute numbers, this module is the
   only place those numbers become imperative canvas calls, in a fixed
   order.
   ===================================================================== */

// Acquires the real 2D context from a <canvas> element. The one place
// in this file that's specific to an actual DOM canvas rather than any
// ctx-shaped backend.
export function get2DContext(canvasEl) {
  return canvasEl.getContext('2d');
}

export function initTransform(ctx, width, height, logical) {
  ctx.scale(width / logical, height / logical);
}

export function clearFrame(ctx, logical) {
  ctx.clearRect(0, 0, logical, logical);
}

// Erases the trail toward transparent with destination-out; nothing is
// refilled beneath, so the page shows through.
export function applyFade(ctx, logical, alpha) {
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, logical, logical);
  ctx.globalCompositeOperation = 'source-over';
}

// Paints one wavefront step: a dot if the point jumped further than the
// ball's own width since the last point (a resumed/first point), or a
// stroked segment from the previous point otherwise.
export function paintStep(ctx, { x, y, prevX, prevY, jumped, style, lineWidth }) {
  ctx.fillStyle = style;
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  if (jumped) {
    ctx.beginPath();
    ctx.arc(x, y, lineWidth * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
}
