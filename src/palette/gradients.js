/* =====================================================================
   src/palette/gradients.js — the canonical spectrum gradient band and
   hue/lightness sampling along the closure cycle.

   v0.3: the color band is a fully configurable panel parameter
   (hueStart, hueEnd, sat, light, lightEnd — see apps/mark's schema and
   docs/api.md), not a menu of named presets. The org-named sub-brand
   rows (cogos/mod3/research/constellation) and the ad hoc duotone/
   mono/madder variants that used to live here are retired: every look
   they produced is reachable by dialing the same four-to-five knobs
   directly, and a locked or exported figure spec now carries whatever
   values were dialed in, clamped by construction — no special-casing
   for "was this a named preset" needed anywhere downstream.
   `spectrum` remains the one named preset and the default.
   ===================================================================== */

export const GRADIENTS = {
  spectrum: { hueStart: 0, hueEnd: 360, sat: 70, light: 60 }
};

export function resolveGradient(g) {
  if (!g) return GRADIENTS.spectrum;
  if (typeof g === 'string') return GRADIENTS[g] || GRADIENTS.spectrum;
  return Object.assign({}, GRADIENTS.spectrum, g);
}

// u in [0,1) — phase along the closure cycle. chromaRamp fades in
// saturation/lightness swing over the settle window so the mark doesn't
// snap straight to full color.
export function colorFor(u, chromaRamp, gradient) {
  const g = gradient;
  u = ((u % 1) + 1) % 1;
  // For full spectrum, hueEnd-hueStart = 360 -> wraps cleanly.
  // For sub-bands, ping-pong so we don't snap at the seam.
  const span = g.hueEnd - g.hueStart;
  let hueT;
  if (Math.abs(span) >= 360) {
    hueT = u;
  } else {
    hueT = u < 0.5 ? u * 2 : (1 - u) * 2;
  }
  const hue = (g.hueStart + span * hueT + 720) % 360;
  const sat = (g.sat != null ? g.sat : 70) * chromaRamp;
  const lightStart = g.light != null ? g.light : 60;
  const lightEnd = g.lightEnd != null ? g.lightEnd : lightStart;
  const light = 100 - (100 - (lightStart + (lightEnd - lightStart) * hueT)) * chromaRamp;
  return { hue, sat, light };
}

export function colorStyle(c, alpha) {
  if (alpha == null) return `hsl(${c.hue.toFixed(1)} ${c.sat.toFixed(1)}% ${c.light.toFixed(1)}%)`;
  return `hsla(${c.hue.toFixed(1)} ${c.sat.toFixed(1)}% ${c.light.toFixed(1)}% / ${alpha.toFixed(3)})`;
}
