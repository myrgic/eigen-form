/* =====================================================================
   src/palette/gradients.js — named gradient bands, hue/lightness
   sampling along the closure cycle, and the small color-string parser
   the engine uses for its optional reference-color parameter.
   ===================================================================== */

export const GRADIENTS = {
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

// Accepts #rgb, #rrggbb, rgb()/rgba(), or a 3-element array; returns
// [r,g,b] or null. Used for the mark's optional reference/halo color,
// which is not part of the paint pipeline itself (see the comment on
// setBg in eigen-form.js).
export function parseColor(input) {
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
