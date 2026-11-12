/* src/gl/sims/index.js — the deck: every GPU sim, in the order the number keys pick them. */
import fluid from './fluid.js';
import rd from './rd.js';
import feedback from './feedback.js';
import warp from './warp.js';
import tunnel from './tunnel.js';
import chladni from './chladni.js';

const SIMS = [fluid, rd, feedback, warp, tunnel, chladni];
const byId = (id) => SIMS.find((s) => s.id === id) || null;

export { SIMS, byId };
export default { SIMS, byId };
