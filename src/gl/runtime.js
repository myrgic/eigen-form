/* =====================================================================
   src/gl/runtime.js — runs a GPU sim: a few fragment-shader passes over
   float buffers that persist between frames, then one pass to the
   screen. WebGL2, nothing else.

   A sim is data (see src/gl/sims/*.js):
     id, title, about            what it is and the work it comes from
     schema                      its knobs (src/params/define.js). Every
                                 knob is a uniform: `u_<key>`, float.
     patch                       the default patch (src/signal/router.js)
     buffers   { name: { size: [w, h], wrap: 'repeat' | 'clamp' } }
                                 RGBA16F, linear, ping-ponged. A pass
                                 reads any buffer as `u_<name>` (with
                                 `u_<name>Res`) and writes one.
     common                      GLSL shared by its passes
     init      { name: glsl }    first contents of a buffer
     passes    [{ target, src, iterations }]   run in order every frame;
                                 iterations may be a function of value()
     draw                        the pass to the screen
     uniforms(value, ctx)        optional extra uniforms { name: number | [..] }
     actions(api)                optional: returns trigger(action, strength, meta)
   Every pass body defines `vec4 pass(vec2 uv)`.

   Around each body the runtime declares: u_res, u_aspect, u_time, u_dt,
   u_frame, u_iter, u_texel (one texel of the target), the buffers, the
   knobs, the signal texture with AudioLink's readers (signal-texture.js
   PRELUDE), and the frame's events:
     u_splatCount, u_splat[16]      x, y (0..1), radius (in heights), strength
     u_splatColor[16]               rgb, a = 1 when the push is radial
     u_splatDir[16]                 xy = direction of a push, z = a second amount (the fluid's dye)
   An event lasts one frame. What a splat MEANS (dye, chemical, a push)
   is the sim's business.

   The model steps on a fixed dt (1/60 s) however fast the display runs.
   ===================================================================== */

import { PRELUDE, createSignalUpload } from './signal-texture.js';

const MAX_SPLATS = 16;
const VERT = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

function header(sim) {
  const knobs = Object.keys(sim.schema).map((k) => `uniform float u_${k};`).join('\n');
  const bufs = Object.keys(sim.buffers || {}).map((n) => `uniform sampler2D u_${n}; uniform vec2 u_${n}Res;`).join('\n');
  const extra = (sim.extraUniforms || []).map((u) => `uniform ${u};`).join('\n');
  return `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 v_uv; out vec4 fragColor;
uniform vec2 u_res; uniform vec2 u_texel; uniform float u_aspect, u_time, u_dt; uniform int u_frame, u_iter;
uniform sampler2D u_signal;
uniform int u_splatCount; uniform vec4 u_splat[${MAX_SPLATS}]; uniform vec4 u_splatColor[${MAX_SPLATS}]; uniform vec4 u_splatDir[${MAX_SPLATS}];
${bufs}
${knobs}
${extra}
${PRELUDE}
${sim.common || ''}
`;
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'no log';
    // point at the offending source line: the header shifts every number
    const m = /ERROR: \d+:(\d+)/.exec(log), line = m ? src.split('\n')[Number(m[1]) - 1] : '';
    gl.deleteShader(sh);
    throw new Error(`${label}: ${log.trim()}${line ? `\n    > ${line.trim()}` : ''}`);
  }
  return sh;
}

function program(gl, vs, fragSrc, label) {
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc, label));
  gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label}: link failed: ${gl.getProgramInfoLog(p)}`);
  const locs = new Map();
  return { p, loc: (name) => { if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name)); return locs.get(name); } };
}

function createRunner(canvas, sim) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('This browser has no WebGL2.');
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('This GPU cannot render to float textures (EXT_color_buffer_float), which every stateful sim needs.');

  const vs = compile(gl, gl.VERTEX_SHADER, VERT, 'vertex');
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const head = header(sim);
  const body = (src) => `${head}\n${src}\nvoid main() { fragColor = pass(v_uv); }`;
  const passes = (sim.passes || []).map((ps, i) => ({ ...ps, prog: program(gl, vs, body(ps.src), `${sim.id} pass ${i} (${ps.target})`) }));
  const drawProg = program(gl, vs, body(sim.draw), `${sim.id} draw`);
  const inits = Object.entries(sim.init || {}).map(([name, src]) => ({ target: name, prog: program(gl, vs, body(src), `${sim.id} init ${name}`) }));

  // ---- buffers --------------------------------------------------------
  function target(w, h, wrap) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const w_ = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w_); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w_);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`${sim.id}: a ${w}x${h} float buffer is not renderable on this GPU`);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo };
  }
  const buffers = {};
  for (const [name, def] of Object.entries(sim.buffers || {})) { const [w, h] = def.size; buffers[name] = { w, h, read: target(w, h, def.wrap), write: target(w, h, def.wrap) }; }
  const signal = createSignalUpload(gl);

  // ---- events ---------------------------------------------------------
  let splats = [];
  const splatA = new Float32Array(MAX_SPLATS * 4), splatC = new Float32Array(MAX_SPLATS * 4), splatD = new Float32Array(MAX_SPLATS * 4);
  function splat({ x = 0.5, y = 0.5, r = 0.05, strength = 1, color = [1, 1, 1], dir = [0, 0], radial = false } = {}) {
    if (splats.length >= MAX_SPLATS) splats.shift();
    splats.push({ x, y, r, strength, color, dir, radial });
  }

  // ---- one pass ---------------------------------------------------------
  let frame = 0, time = 0, extra = {};
  const DT = 1 / 60;
  function run(prog, tgt, value, iter) {
    const w = tgt ? tgt.w : canvas.width, h = tgt ? tgt.h : canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.write.fbo : null);
    gl.viewport(0, 0, w, h); gl.useProgram(prog.p);
    let unit = 0;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, signal.tex); gl.uniform1i(prog.loc('u_signal'), unit++);
    for (const [name, b] of Object.entries(buffers)) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, b.read.tex);
      gl.uniform1i(prog.loc(`u_${name}`), unit++); gl.uniform2f(prog.loc(`u_${name}Res`), b.w, b.h);
    }
    gl.uniform2f(prog.loc('u_res'), canvas.width, canvas.height); gl.uniform2f(prog.loc('u_texel'), 1 / w, 1 / h);
    gl.uniform1f(prog.loc('u_aspect'), canvas.width / Math.max(1, canvas.height));
    gl.uniform1f(prog.loc('u_time'), time); gl.uniform1f(prog.loc('u_dt'), DT);
    gl.uniform1i(prog.loc('u_frame'), frame); gl.uniform1i(prog.loc('u_iter'), iter);
    gl.uniform1i(prog.loc('u_splatCount'), splats.length);
    gl.uniform4fv(prog.loc('u_splat[0]'), splatA); gl.uniform4fv(prog.loc('u_splatColor[0]'), splatC); gl.uniform4fv(prog.loc('u_splatDir[0]'), splatD);
    for (const k of Object.keys(sim.schema)) { const l = prog.loc(`u_${k}`); if (l) { const v = value(k); gl.uniform1f(l, typeof v === 'boolean' ? (v ? 1 : 0) : Number(v) || 0); } }
    for (const [k, v] of Object.entries(extra)) { const l = prog.loc(k); if (!l) continue; if (Array.isArray(v)) gl[`uniform${v.length}fv`](l, v); else gl.uniform1f(l, v); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (tgt) { const t = tgt.read; tgt.read = tgt.write; tgt.write = t; }
  }

  let needInit = true;
  function reset() { needInit = true; }

  // One display frame: `steps` model steps (0 holds the picture), then draw. signalData: the texture's Float32Array.
  function render(value, signalData, steps = 1) {
    signal.upload(signalData);
    splats.forEach((s, i) => { splatA.set([s.x, s.y, s.r, s.strength], i * 4); splatC.set([s.color[0], s.color[1], s.color[2], s.radial ? 1 : 0], i * 4); splatD.set([s.dir[0] || 0, s.dir[1] || 0, s.dir[2] || 0, 0], i * 4); });
    extra = sim.uniforms ? sim.uniforms(value, { time, frame, dt: DT }) || {} : {};
    if (needInit) { for (const it of inits) run(it.prog, buffers[it.target], value, 0); needInit = false; }
    for (let s = 0; s < steps; s++) {
      for (const ps of passes) {
        const n = typeof ps.iterations === 'function' ? ps.iterations(value) : ps.iterations || 1;
        for (let i = 0; i < n; i++) run(ps.prog, buffers[ps.target], value, i);
      }
      splats = [];                                     // an event lasts one step
      frame++; time += DT;
    }
    run(drawProg, null, value, 0);
  }

  function resize(w, h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } }

  return { gl, render, splat, reset, resize, get frame() { return frame; }, get time() { return time; } };
}

// Where a note lands on the stage: pitch winds twice around the centre across the playable range, and each
// track keeps its own orbit. Returns uv (0..1). `rows` is a Map the caller keeps (track -> orbit).
function placeNote(meta, rows, aspect = 16 / 9, random = Math.random) {
  if (!meta || meta.pitch == null) return [0.15 + 0.7 * random(), 0.15 + 0.7 * random()];
  if (!rows.has(meta.track)) rows.set(meta.track, rows.size);
  const a = meta.pitch * Math.PI * 4 - Math.PI / 2, rad = 0.13 + 0.07 * (rows.get(meta.track) % 5);
  return [0.5 + rad * Math.cos(a) / aspect * 1.3, 0.5 + rad * Math.sin(a)];
}

function hsv(h, s, v) { h = ((h % 360) + 360) % 360 / 60; const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c; const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]; return [r + m, g + m, b + m]; }
// Four theme colours from two knobs: a hue and how far the other three fan out from it.
function themeFrom(hue, spread) { return [0, 1, 2, 3].map((i) => hsv(hue + spread * (i / 3 - 0.5) * 2, i === 3 ? 0.55 : 0.9, 1)); }

export { createRunner, placeNote, themeFrom, hsv, MAX_SPLATS };
export default { createRunner, placeNote, themeFrom, hsv, MAX_SPLATS };
