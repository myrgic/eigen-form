/* src/gl/sims/common.js — what every sim shares: the colour knobs (two
   numbers become the four AudioLink theme colours, so a whole set reads
   as one show), the exposure knob, and the hue step most patches use. */

const COLOR = {
  hue:    { type: 'angle',  min: 0,    max: 360, step: 1,     unit: 'deg', default: 190, group: 'color', label: 'hue' },
  spread: { type: 'number', min: 0,    max: 180, step: 1,     unit: 'deg', default: 80,  group: 'color', label: 'hue spread' },
  gain:   { type: 'number', min: 0.2,  max: 4,   step: 0.01,               default: 1,   group: 'color', label: 'exposure', scale: 'log' }
};
// every eight bars the whole palette turns
const HUE_STEP = { on: 'bar', every: 8, targets: ['hue'], values: [[190], [300], [40], [140], [250], [350]] };

export { COLOR, HUE_STEP };
