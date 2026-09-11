/* =====================================================================
   apps/aquarium/engine/webgl2.js — the projection backend.

   docs/executable-experiments-design.md, "The shader correspondence":
   "a GPU path, when it arrives, is the fast projection, verified against
   the reference within a declared tolerance and never trusted past it."
   This module is that projection. It executes the SAME kernel spec
   cpu.js executes, on the GPU, and is judged by engine/twin.js against
   cpu.js's output — never the other way around.

   Layout, per channel: one RGBA32F texture (ping-ponged), NEAREST
   filtering (every sample this module takes is a manual texelFetch-based
   bilinear or boundary-aware read, matching cpu.js's own bilinearSample/
   readCell exactly in weights — hardware bilinear filtering is
   deliberately unused so the two backends apply the same arithmetic).
   A scalar channel uses only .r; a vector channel uses .rg. Every
   channel shares one WxH texture size (the same simplification cpu.js
   documents: this engine runs every channel on one grid).

   Agents live in one more RGBA32F texture, N wide by 1 tall:
   (x, y, heading, speed) per texel, ping-ponged by a full-screen-quad
   fragment pass that inlines the spec's declared welds directly into
   GLSL (one code block per weld, unrolled at spec-compile time — this
   IS "primitives authored as kernel specs ... executed by a backend",
   not a hand-written physarum or boids shader).

   Scope carried by this delivery, named plainly rather than silently
   dropped (see docs/agent-substrate-engine.md, "What the GPU backend
   does not yet cover"):
     - The reactions vocabulary (source/sink/decay/monod/product) is
       CPU-only here; a spec with a non-empty `reactions` array throws
       rather than silently drifting from the reference.
     - The 'rescale' weld effect (read.mode 'level') is CPU-only here;
       a weld using it throws for the same reason.
     - advectedBy (semi-Lagrangian advection) and vector-channel
       projection ARE implemented below, but neither of the two twin
       specs (apps/aquarium/twin.html: physarum, boids) exercises them,
       so they are unverified by the twin harness in this delivery.
   Every one of these throws with a message naming exactly what is
   missing, rather than quietly producing a wrong number — a spec this
   backend cannot run is a loud, immediate error, never a silent
   divergence discovered later at the twin comparison.
   ===================================================================== */

import { GLSL_HASH } from './rng.js';
import { STENCIL_1D } from './kernel.js';

// kernel.js's declared 1D box-3 weights, formatted as GLSL float literals
// (a bare integer division like `/ 3` reads as integer division to a
// careless GLSL author, though `3.0` would be fine too — using the
// SAME source constant as cpu.js's ST_A/ST_B/ST_C removes the question
// entirely: there is one place either backend could get this wrong, and
// it is kernel.js's STENCIL_1D, not two independently-typed copies).
const [ST_A, ST_B, ST_C] = STENCIL_1D.map((w) => w.toFixed(10));

/* ---- shared GLSL: boundary-aware reads, matching cpu.js's readCell/
   bilinearSample exactly (same weights, same wrap/wall/absorb rules) --- */
const BOUNDARY_CODE = { wrap: 0, wall: 1, absorb: 2 };
// Must equal cpu.js's TIE_EPS exactly — see weldGLSLDirect's use site.
const TIE_EPS = 0.001;

const GLSL_PREAMBLE = `
precision highp float;
precision highp int;
${GLSL_HASH}
vec4 efReadCellB(sampler2D tex, ivec2 c, ivec2 size, int mode) {
  if (mode == 0) {
    ivec2 w = ivec2(mod(vec2(c), vec2(size)));
    return texelFetch(tex, w, 0);
  } else if (mode == 2) {
    if (c.x < 0 || c.x >= size.x || c.y < 0 || c.y >= size.y) return vec4(0.0);
    return texelFetch(tex, c, 0);
  }
  ivec2 cl = clamp(c, ivec2(0), size - ivec2(1));
  return texelFetch(tex, cl, 0);
}
vec4 efBilinear(sampler2D tex, vec2 p, ivec2 size, int mode) {
  vec2 fl = floor(p);
  ivec2 c0 = ivec2(fl);
  vec2 f = p - fl;
  vec4 v00 = efReadCellB(tex, c0, size, mode);
  vec4 v10 = efReadCellB(tex, c0 + ivec2(1, 0), size, mode);
  vec4 v01 = efReadCellB(tex, c0 + ivec2(0, 1), size, mode);
  vec4 v11 = efReadCellB(tex, c0 + ivec2(1, 1), size, mode);
  return v00 * (1.0 - f.x) * (1.0 - f.y) + v10 * f.x * (1.0 - f.y) + v01 * (1.0 - f.x) * f.y + v11 * f.x * f.y;
}
`;

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`aquarium/webgl2: shader compile failed: ${log}\n---\n${source}`);
  }
  return sh;
}

function linkProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error(`aquarium/webgl2: program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function createFloatTexture(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFBO(gl, tex) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`aquarium/webgl2: framebuffer incomplete (status 0x${status.toString(16)})`);
  }
  return fbo;
}

function pingPong(gl, w, h) {
  const texA = createFloatTexture(gl, w, h);
  const texB = createFloatTexture(gl, w, h);
  return { texA, texB, fboA: createFBO(gl, texA), fboB: createFBO(gl, texB), front: 'A' };
}

function currentTex(pp) { return pp.front === 'A' ? pp.texA : pp.texB; }
function currentFBO(pp) { return pp.front === 'A' ? pp.fboA : pp.fboB; }
function backTex(pp) { return pp.front === 'A' ? pp.texB : pp.texA; }
function backFBO(pp) { return pp.front === 'A' ? pp.fboB : pp.fboA; }
function swap(pp) { pp.front = pp.front === 'A' ? 'B' : 'A'; }

/* ---- per-channel diffuse+decay program (2-pass separable, matching
   cpu.js's diffuseInPlace + decayInPlace exactly: horizontal box-3,
   vertical box-3 of that, blend against the ORIGINAL value by the
   declared diffuse rate, then multiply the whole result by the decay
   factor) ---------------------------------------------------------- */

function buildDiffusePrograms(gl, boundaryMode) {
  const horizontalFS = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_src;
uniform ivec2 u_size;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 l = efReadCellB(u_src, c + ivec2(-1, 0), u_size, ${boundaryMode});
  vec4 m = texelFetch(u_src, c, 0);
  vec4 r = efReadCellB(u_src, c + ivec2(1, 0), u_size, ${boundaryMode});
  outColor = l * ${ST_A} + m * ${ST_B} + r * ${ST_C};
}
`;
  const verticalBlendFS = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_scratch;
uniform sampler2D u_orig;
uniform ivec2 u_size;
uniform float u_rate;
uniform float u_decay;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 u = efReadCellB(u_scratch, c + ivec2(0, -1), u_size, ${boundaryMode});
  vec4 m = texelFetch(u_scratch, c, 0);
  vec4 d = efReadCellB(u_scratch, c + ivec2(0, 1), u_size, ${boundaryMode});
  vec4 avg3 = u * ${ST_A} + m * ${ST_B} + d * ${ST_C};
  vec4 origv = texelFetch(u_orig, c, 0);
  outColor = (origv * (1.0 - u_rate) + avg3 * u_rate) * u_decay;
}
`;
  return {
    horizontal: linkProgram(gl, FULLSCREEN_VS, horizontalFS),
    verticalBlend: linkProgram(gl, FULLSCREEN_VS, verticalBlendFS)
  };
}

function buildAdvectProgram(gl, boundaryMode) {
  const fs = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_src;
uniform sampler2D u_mom;
uniform ivec2 u_size;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 v = texelFetch(u_mom, c, 0).rg;
  vec2 srcPos = vec2(c) - v;
  outColor = efBilinear(u_src, srcPos, u_size, ${boundaryMode});
}
`;
  return linkProgram(gl, FULLSCREEN_VS, fs);
}

/* ---- projection: same backward-divergence / forward-gradient
   convention as cpu.js's project() (see cpu.js's comment for why —
   centered differences for both halves are not adjoint operators and
   never converge to zero divergence). Double-buffered Jacobi on GPU
   (not Gauss-Seidel: a fragment pass can't read its own sweep's
   in-progress writes), so — like the double-buffered Jacobi this
   repo's CPU path moved away from — this GPU projection carries the
   same undamped-Nyquist-mode limitation the CPU path fixed by going to
   Gauss-Seidel. Neither twin spec in this delivery enables projection,
   so this is present for spec completeness and un-twin-verified; see
   docs/agent-substrate-engine.md, "What the GPU backend does not yet
   cover". */

function buildProjectionPrograms(gl, boundaryMode) {
  const divergenceFS = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_vec;
uniform ivec2 u_size;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 m = texelFetch(u_vec, c, 0);
  vec4 l = efReadCellB(u_vec, c + ivec2(-1, 0), u_size, ${boundaryMode});
  vec4 u = efReadCellB(u_vec, c + ivec2(0, -1), u_size, ${boundaryMode});
  float div = (m.r - l.r) + (m.g - u.g);
  outColor = vec4(div, 0.0, 0.0, 1.0);
}
`;
  const jacobiFS = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_p;
uniform sampler2D u_div;
uniform ivec2 u_size;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float l = efReadCellB(u_p, c + ivec2(-1, 0), u_size, ${boundaryMode}).r;
  float r = efReadCellB(u_p, c + ivec2(1, 0), u_size, ${boundaryMode}).r;
  float u = efReadCellB(u_p, c + ivec2(0, -1), u_size, ${boundaryMode}).r;
  float d = efReadCellB(u_p, c + ivec2(0, 1), u_size, ${boundaryMode}).r;
  float div = texelFetch(u_div, c, 0).r;
  outColor = vec4((l + r + u + d - div) / 4.0, 0.0, 0.0, 1.0);
}
`;
  const correctFS = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_vec;
uniform sampler2D u_p;
uniform ivec2 u_size;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 v = texelFetch(u_vec, c, 0);
  float p = texelFetch(u_p, c, 0).r;
  float rt = efReadCellB(u_p, c + ivec2(1, 0), u_size, ${boundaryMode}).r;
  float d = efReadCellB(u_p, c + ivec2(0, 1), u_size, ${boundaryMode}).r;
  outColor = vec4(v.r - (rt - p), v.g - (d - p), 0.0, 1.0);
}
`;
  return {
    divergence: linkProgram(gl, FULLSCREEN_VS, divergenceFS),
    jacobi: linkProgram(gl, FULLSCREEN_VS, jacobiFS),
    correct: linkProgram(gl, FULLSCREEN_VS, correctFS)
  };
}

/* ---- agent update: one weld block per declared weld, unrolled into
   GLSL at spec-compile time. This is the direct GLSL translation of
   cpu.js's stepAgents — same branch structure, same tie-break stream
   ids, same effect math. Each weld's channel boundary is baked in as an
   integer literal directly (weldGLSLDirect, below) rather than threaded
   through a shared placeholder, since different welds in the same
   population can reference channels with different boundary modes. --- */

function buildAgentProgram(gl, spec) {
  const { population } = spec;
  const channelsByName = new Map(spec.channels.map((c) => [c.name, c]));

  for (const weld of population.welds) {
    if (weld.effect.type === 'rescale') {
      throw new Error("aquarium/webgl2: effect 'rescale' (read.mode 'level') is CPU-only in this backend");
    }
  }

  const usedChannels = [...new Set(population.welds.map((w) => w.channel))];
  const uniformName = (name) => `u_ch_${name}`;

  const body = population.welds.map((weld, i) => {
    const ch = channelsByName.get(weld.channel);
    return weldGLSLDirect(weld, i, uniformName(weld.channel), ch.boundary);
  }).join('\n');

  const uniformDecls = usedChannels.map((name) => `uniform sampler2D ${uniformName(name)};`).join('\n');

  const boundaryMode = BOUNDARY_CODE[population.boundary];
  const speedLine = `float speed = a.w;`;

  const fs = `#version 300 es
${GLSL_PREAMBLE}
uniform sampler2D u_agentsOld;
uniform ivec2 u_gridSize;
uniform uint u_seed;
uniform uint u_step;
${uniformDecls}
out vec4 outAgent;
void main() {
  int i = int(gl_FragCoord.x);
  vec4 a = texelFetch(u_agentsOld, ivec2(i, 0), 0);
  float x = a.x;
  float y = a.y;
  float heading = a.z;
  ${speedLine}
  float dx = 0.0;
  float dy = 0.0;
${body}
  float vx = cos(heading) * speed + dx;
  float vy = sin(heading) * speed + dy;
  float nx = x + vx;
  float ny = y + vy;
  int boundary = ${boundaryMode};
  if (boundary == 0) {
    nx = mod(nx, float(u_gridSize.x));
    ny = mod(ny, float(u_gridSize.y));
    if (nx < 0.0) nx += float(u_gridSize.x);
    if (ny < 0.0) ny += float(u_gridSize.y);
  } else if (boundary == 1) {
    if (nx < 0.0) { nx = -nx; vx = -vx; } else if (nx >= float(u_gridSize.x)) { nx = 2.0 * float(u_gridSize.x) - nx; vx = -vx; }
    if (ny < 0.0) { ny = -ny; vy = -vy; } else if (ny >= float(u_gridSize.y)) { ny = 2.0 * float(u_gridSize.y) - ny; vy = -vy; }
    heading = atan(vy, vx);
  } else {
    if (nx < 0.0) nx = 0.0; else if (nx >= float(u_gridSize.x)) nx = float(u_gridSize.x) - 1e-6;
    if (ny < 0.0) ny = 0.0; else if (ny >= float(u_gridSize.y)) ny = float(u_gridSize.y) - 1e-6;
  }
  outAgent = vec4(nx, ny, heading, speed);
}
`;
  return { program: linkProgram(gl, FULLSCREEN_VS, fs), usedChannels };
}

/** Same weld->GLSL translation as weldGLSL, but with the channel's own
 *  boundary mode baked in directly (as an integer literal) instead of
 *  threaded through a placeholder — see buildAgentProgram's comment for
 *  why the first approach (string-replace substitution) was rejected in
 *  favor of this direct one. */
function weldGLSLDirect(weld, index, samplerName, boundary) {
  const mode = BOUNDARY_CODE[boundary];
  const stream = 5000 + index;
  if (weld.read.mode === 'gradient') {
    const so = weld.read.sensorDist.toFixed(8);
    const sa = weld.read.sensorAngle.toFixed(8);
    const gain = weld.effect.gain.toFixed(8);
    return `
  {
    float so_${index} = ${so};
    float sa_${index} = ${sa};
    float F_${index} = efBilinear(${samplerName}, vec2(x + cos(heading) * so_${index}, y + sin(heading) * so_${index}), u_gridSize, ${mode}).r;
    float L_${index} = efBilinear(${samplerName}, vec2(x + cos(heading - sa_${index}) * so_${index}, y + sin(heading - sa_${index}) * so_${index}), u_gridSize, ${mode}).r;
    float R_${index} = efBilinear(${samplerName}, vec2(x + cos(heading + sa_${index}) * so_${index}, y + sin(heading + sa_${index}) * so_${index}), u_gridSize, ${mode}).r;
    float gain_${index} = ${gain};
    // TIE_EPS deadband — must match cpu.js's TIE_EPS constant exactly.
    // See cpu.js's stepAgents comment at its use site for why this
    // exists: without it, a sensor pair within a few ULPs of each other
    // can compare > on the CPU and <= on the GPU (native cos/sin differ
    // in their last bit between backends), flipping which way one agent
    // turns that step — a discrete divergence that compounds over many
    // steps, not a small numeric one.
    if (F_${index} > L_${index} + ${TIE_EPS} && F_${index} > R_${index} + ${TIE_EPS}) {
      // straight
    } else if (F_${index} < L_${index} - ${TIE_EPS} && F_${index} < R_${index} - ${TIE_EPS}) {
      float rr_${index} = efRand01(u_seed, uint(i), u_step, ${stream}u);
      heading += (rr_${index} < 0.5) ? gain_${index} : -gain_${index};
    } else if (L_${index} > R_${index} + ${TIE_EPS}) {
      heading -= gain_${index};
    } else if (R_${index} > L_${index} + ${TIE_EPS}) {
      heading += gain_${index};
    } else {
      float rr_${index} = efRand01(u_seed, uint(i), u_step, ${stream}u);
      heading += (rr_${index} < 0.5) ? gain_${index} : -gain_${index};
    }
  }
`;
  }
  if (weld.read.mode === 'vector') {
    const align = weld.effect.align.toFixed(8);
    const advect = weld.effect.advect.toFixed(8);
    return `
  {
    vec2 v_${index} = efBilinear(${samplerName}, vec2(x, y), u_gridSize, ${mode}).rg;
    float mag_${index} = length(v_${index});
    if (mag_${index} > 1e-9) {
      float target_${index} = atan(v_${index}.y, v_${index}.x);
      float diff_${index} = target_${index} - heading;
      diff_${index} = mod(diff_${index} + 3.14159265358979, 6.28318530717959) - 3.14159265358979;
      heading += diff_${index} * ${align};
    }
    dx += v_${index}.x * ${advect};
    dy += v_${index}.y * ${advect};
  }
`;
  }
  throw new Error(`aquarium/webgl2: weld read.mode "${weld.read.mode}" is CPU-only in this backend`);
}

/* ---- deposit: 4 instanced points per agent, bilinear-weighted,
   additive-blended into the target channel's current texture — the
   direct GPU expression of cpu.js's bilinearDeposit (same 4 corners,
   same weights, same wrap/wall/absorb rule per corner). --------------- */

function buildDepositProgram(gl) {
  const vs = `#version 300 es
uniform sampler2D u_agents;
uniform ivec2 u_gridSize;
uniform float u_amount;
uniform int u_boundary;
uniform int u_isVector;
out vec3 vAmount;
void main() {
  int i = gl_InstanceID;
  int corner = gl_VertexID;
  vec4 a = texelFetch(u_agents, ivec2(i, 0), 0);
  float x = a.x;
  float y = a.y;
  float heading = a.z;
  float speed = a.w;
  vec2 fl = floor(vec2(x, y));
  vec2 f = vec2(x, y) - fl;
  ivec2 offs[4];
  offs[0] = ivec2(0, 0);
  offs[1] = ivec2(1, 0);
  offs[2] = ivec2(0, 1);
  offs[3] = ivec2(1, 1);
  float weights[4];
  weights[0] = (1.0 - f.x) * (1.0 - f.y);
  weights[1] = f.x * (1.0 - f.y);
  weights[2] = (1.0 - f.x) * f.y;
  weights[3] = f.x * f.y;
  ivec2 cc = ivec2(fl) + offs[corner];
  float w = weights[corner];
  bool drop = false;
  if (u_boundary == 0) {
    cc = ivec2(mod(vec2(cc), vec2(u_gridSize)));
  } else if (u_boundary == 2) {
    if (cc.x < 0 || cc.x >= u_gridSize.x || cc.y < 0 || cc.y >= u_gridSize.y) drop = true;
  } else {
    cc = clamp(cc, ivec2(0), u_gridSize - ivec2(1));
  }
  vec2 amt2 = (u_isVector == 1)
    ? vec2(cos(heading) * speed, sin(heading) * speed) * (u_amount * w)
    : vec2(u_amount * w, 0.0);
  vAmount = drop ? vec3(0.0) : vec3(amt2, 0.0);
  vec2 ndc = (vec2(cc) + 0.5) / vec2(u_gridSize) * 2.0 - 1.0;
  gl_Position = drop ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(ndc, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;
  const fs = `#version 300 es
precision highp float;
in vec3 vAmount;
out vec4 outColor;
void main() {
  outColor = vec4(vAmount, 1.0);
}
`;
  return linkProgram(gl, vs, fs);
}

/* ---- state: allocate every texture/program a spec's execution needs -- */

function createGLState(gl, spec) {
  const { width: W, height: H, channels, population } = spec;

  for (const r of spec.reactions) {
    throw new Error(`aquarium/webgl2: reaction type "${r.type}" is CPU-only in this backend — createGLState refuses a spec with any declared reactions`);
  }

  const fields = {};
  const diffusePrograms = {};
  const advectPrograms = {};
  const projectionPrograms = {};
  for (const ch of channels) {
    fields[ch.name] = pingPong(gl, W, H);
    diffusePrograms[ch.name] = buildDiffusePrograms(gl, BOUNDARY_CODE[ch.boundary]);
    if (ch.advectedBy) advectPrograms[ch.name] = buildAdvectProgram(gl, BOUNDARY_CODE[ch.boundary]);
    if (ch.projection && ch.projection.enabled) projectionPrograms[ch.name] = buildProjectionPrograms(gl, BOUNDARY_CODE[ch.boundary]);
  }

  let agents = null, agentProgram = null, depositProgram = null;
  if (population) {
    agents = pingPong(gl, population.count, 1);
    agentProgram = buildAgentProgram(gl, spec);
    depositProgram = buildDepositProgram(gl);
  }

  const scratch = { tex: createFloatTexture(gl, W, H), fbo: null };
  scratch.fbo = createFBO(gl, scratch.tex);
  const projScratch = channels.some((c) => c.projection && c.projection.enabled)
    ? { div: createFloatTexture(gl, W, H), divFbo: null, p: pingPong(gl, W, H) }
    : null;
  if (projScratch) projScratch.divFbo = createFBO(gl, projScratch.div);

  return {
    gl, spec, fields, agents, agentProgram, depositProgram,
    diffusePrograms, advectPrograms, projectionPrograms,
    scratch, projScratch,
    channelsByName: new Map(channels.map((c) => [c.name, c])),
    step: 0
  };
}

/** Upload initial channel and agent state computed on the CPU (via
 *  cpu.js's createState/resetAgents) into the GL textures — see
 *  webgl2.js's header: initial state is a pure function of the spec's
 *  seed either way, so uploading a CPU-computed initial condition costs
 *  nothing in fidelity and removes t=0 as a source of twin drift. Only
 *  the per-step DYNAMICS run as shaders from here on. */
function uploadInitialState(gl, glState, cpuState) {
  const { spec } = glState;
  const { width: W, height: H } = spec;
  for (const ch of spec.channels) {
    const pp = glState.fields[ch.name];
    const buf = new Float32Array(W * H * 4);
    if (ch.kind === 'scalar') {
      const src = cpuState.fields[ch.name];
      for (let i = 0; i < src.length; i++) buf[i * 4] = src[i];
    } else {
      const src = cpuState.fields[ch.name];
      for (let i = 0; i < src.x.length; i++) { buf[i * 4] = src.x[i]; buf[i * 4 + 1] = src.y[i]; }
    }
    gl.bindTexture(gl.TEXTURE_2D, currentTex(pp));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
  }
  if (spec.population && cpuState.agents) {
    const N = spec.population.count;
    const buf = new Float32Array(N * 4);
    const A = cpuState.agents;
    for (let i = 0; i < N; i++) {
      buf[i * 4] = A.x[i]; buf[i * 4 + 1] = A.y[i]; buf[i * 4 + 2] = A.heading[i]; buf[i * 4 + 3] = A.speed[i];
    }
    gl.bindTexture(gl.TEXTURE_2D, currentTex(glState.agents));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 1, gl.RGBA, gl.FLOAT, buf);
  }
}

function tex(t) { return { __texture__: true, tex: t }; }
// GLSL ES 3.0 distinguishes int and uint uniforms (gl.uniform1i vs
// gl.uniform1ui) even though JS has one number type; u_seed/u_step are
// declared `uint` (they feed efHash4's uint arithmetic, see rng.js's
// GLSL_HASH), so they need this wrapper to route to uniform1ui rather
// than silently going through uniform1i.
function uintVal(n) { return { __uint__: true, value: n >>> 0 }; }

function runFullscreen(gl, program, targetFBO, w, h, uniforms) {
  gl.useProgram(program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
  gl.viewport(0, 0, w, h);
  let unit = 0;
  for (const [name, value] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(program, name);
    if (loc === null) continue;
    if (value && value.__texture__) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, value.tex);
      gl.uniform1i(loc, unit);
      unit++;
    } else if (value && value.__uint__) {
      gl.uniform1ui(loc, value.value);
    } else if (Array.isArray(value)) {
      gl.uniform2i(loc, value[0] | 0, value[1] | 0);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) gl.uniform1i(loc, value); else gl.uniform1f(loc, value);
    }
  }
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function substratePassGL(gl, glState) {
  const { spec } = glState;
  const { width: W, height: H } = spec;
  for (const ch of spec.channels) {
    const pp = glState.fields[ch.name];
    const progs = glState.diffusePrograms[ch.name];
    if (ch.diffuse > 0) {
      runFullscreen(gl, progs.horizontal, glState.scratch.fbo, W, H, {
        u_src: tex(currentTex(pp)), u_size: [W, H]
      });
      const decayFactor = ch.halfLife === Infinity ? 1 : Math.pow(0.5, 1 / ch.halfLife);
      runFullscreen(gl, progs.verticalBlend, backFBO(pp), W, H, {
        u_scratch: tex(glState.scratch.tex), u_orig: tex(currentTex(pp)), u_size: [W, H],
        u_rate: ch.diffuse, u_decay: decayFactor
      });
      swap(pp);
    } else if (ch.halfLife !== Infinity) {
      const decayFactor = Math.pow(0.5, 1 / ch.halfLife);
      runFullscreen(gl, progs.verticalBlend, backFBO(pp), W, H, {
        u_scratch: tex(currentTex(pp)), u_orig: tex(currentTex(pp)), u_size: [W, H],
        u_rate: 0, u_decay: decayFactor
      });
      swap(pp);
    }
    if (ch.advectedBy) {
      const mom = glState.fields[ch.advectedBy];
      runFullscreen(gl, glState.advectPrograms[ch.name], backFBO(pp), W, H, {
        u_src: tex(currentTex(pp)), u_mom: tex(currentTex(mom)), u_size: [W, H]
      });
      swap(pp);
    }
  }
}

function projectionPassGL(gl, glState) {
  const { spec, projScratch } = glState;
  const { width: W, height: H } = spec;
  for (const ch of spec.channels) {
    if (!(ch.projection && ch.projection.enabled)) continue;
    const pp = glState.fields[ch.name];
    const progs = glState.projectionPrograms[ch.name];
    runFullscreen(gl, progs.divergence, projScratch.divFbo, W, H, { u_vec: tex(currentTex(pp)), u_size: [W, H] });
    const p = projScratch.p;
    // Zero the pressure guess before the Jacobi loop. texImage2D with a
    // null pixel source leaves the store's initial content
    // implementation-defined (not guaranteed zero) per the WebGL spec —
    // an explicit framebuffer clear is the portable way to actually zero
    // it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, currentFBO(p));
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let iter = 0; iter < ch.projection.iterations; iter++) {
      runFullscreen(gl, progs.jacobi, backFBO(p), W, H, { u_p: tex(currentTex(p)), u_div: tex(projScratch.div), u_size: [W, H] });
      swap(p);
    }
    runFullscreen(gl, progs.correct, backFBO(pp), W, H, { u_vec: tex(currentTex(pp)), u_p: tex(currentTex(p)), u_size: [W, H] });
    swap(pp);
  }
}

function agentPassGL(gl, glState) {
  const { spec, agents, agentProgram } = glState;
  if (!agents) return;
  const { population, width: W, height: H } = spec;
  const N = population.count;
  const uniforms = {
    u_agentsOld: tex(currentTex(agents)),
    u_gridSize: [W, H],
    u_seed: uintVal(spec.seed),
    u_step: uintVal(glState.step)
  };
  for (const name of agentProgram.usedChannels) {
    uniforms[`u_ch_${name}`] = tex(currentTex(glState.fields[name]));
  }
  runFullscreen(gl, agentProgram.program, backFBO(agents), N, 1, uniforms);
  swap(agents);
}

function depositPassGL(gl, glState) {
  const { spec, agents, depositProgram } = glState;
  if (!agents) return;
  const { population, width: W, height: H } = spec;
  const N = population.count;
  gl.useProgram(depositProgram);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (const weld of population.welds) {
    if (!weld.deposit) continue;
    const ch = glState.channelsByName.get(weld.deposit.channel);
    const target = glState.fields[weld.deposit.channel];
    gl.bindFramebuffer(gl.FRAMEBUFFER, currentFBO(target));
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTex(agents));
    gl.uniform1i(gl.getUniformLocation(depositProgram, 'u_agents'), 0);
    gl.uniform2i(gl.getUniformLocation(depositProgram, 'u_gridSize'), W, H);
    gl.uniform1f(gl.getUniformLocation(depositProgram, 'u_amount'), weld.deposit.amount);
    gl.uniform1i(gl.getUniformLocation(depositProgram, 'u_boundary'), BOUNDARY_CODE[ch.boundary]);
    gl.uniform1i(gl.getUniformLocation(depositProgram, 'u_isVector'), ch.kind === 'vector' ? 1 : 0);
    gl.drawArraysInstanced(gl.POINTS, 0, 4, N);
  }
  gl.disable(gl.BLEND);
}

/** One full GPU step, mirroring cpu.js's step(): substrate -> projection
 *  -> agents -> deposit. */
function stepGL(gl, glState) {
  substratePassGL(gl, glState);
  projectionPassGL(gl, glState);
  agentPassGL(gl, glState);
  depositPassGL(gl, glState);
  glState.step += 1;
}

/** Read a channel's current GPU state back to a Float32Array shaped
 *  exactly like cpu.js's state.fields entry (scalar -> flat Float32Array;
 *  vector -> {x, y}), for twin.js's comparison. */
function readback(gl, glState, channelName) {
  const ch = glState.channelsByName.get(channelName);
  const { width: W, height: H } = glState.spec;
  const pp = glState.fields[channelName];
  gl.bindFramebuffer(gl.FRAMEBUFFER, currentFBO(pp));
  const buf = new Float32Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
  if (ch.kind === 'scalar') {
    const out = new Float32Array(W * H);
    for (let i = 0; i < out.length; i++) out[i] = buf[i * 4];
    return out;
  }
  const x = new Float32Array(W * H), y = new Float32Array(W * H);
  for (let i = 0; i < x.length; i++) { x[i] = buf[i * 4]; y[i] = buf[i * 4 + 1]; }
  return { x, y };
}

/** Read agent state back, shaped like cpu.js's state.agents. */
function readAgents(gl, glState) {
  const N = glState.spec.population.count;
  gl.bindFramebuffer(gl.FRAMEBUFFER, currentFBO(glState.agents));
  const buf = new Float32Array(N * 4);
  gl.readPixels(0, 0, N, 1, gl.RGBA, gl.FLOAT, buf);
  const x = new Float32Array(N), y = new Float32Array(N), heading = new Float32Array(N), speed = new Float32Array(N);
  for (let i = 0; i < N; i++) { x[i] = buf[i * 4]; y[i] = buf[i * 4 + 1]; heading[i] = buf[i * 4 + 2]; speed[i] = buf[i * 4 + 3]; }
  return { x, y, heading, speed };
}

export { createGLState, uploadInitialState, stepGL, readback, readAgents };
export default { createGLState, uploadInitialState, stepGL, readback, readAgents };
