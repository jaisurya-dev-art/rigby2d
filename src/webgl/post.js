// SPDX-License-Identifier: MIT OR Apache-2.0
// Post-processing passes for film effects, on top of the WebGLRenderer's context: offscreen
// targets, a separable Gaussian blur, and one composite shader for copy-with-colour-grade, drop
// shadow, glow and light shading. Everything stays premultiplied, like the renderer's output.
// Works with WebGL 1 and 2. Used only by film effects (filmdraw.js): projects without them never
// create it.

const QUAD_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const BLUR_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_step;
uniform float u_sigma;
varying vec2 v_uv;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -12; i <= 12; i++) {
    float f = float(i);
    float w = exp(-(f * f) / (2.0 * u_sigma * u_sigma));
    sum += texture2D(u_tex, v_uv + u_step * f) * w;
    total += w;
  }
  gl_FragColor = sum / total;
}`;

// Modes: 0 copy (offset, opacity, colour matrix), 1 shadow (colour from the alpha of u_tex, offset),
// 2 glow (colour from the alpha of u_tex), 3 shading (u_tex the layer, u_aux its blurred alpha).
const COMPOSITE_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform sampler2D u_aux;
uniform float u_mode;
uniform vec2 u_offset;
uniform float u_opacity;
uniform vec4 u_color;
uniform vec4 u_color2;
uniform mat4 u_matrix;
uniform vec4 u_add;
uniform vec2 u_light;
uniform vec2 u_texel;
uniform float u_reach;
varying vec2 v_uv;
void main() {
  if (u_mode < 0.5) {
    vec4 t = texture2D(u_tex, v_uv - u_offset);
    if (t.a <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec3 c = t.rgb / t.a;
    c = clamp((u_matrix * vec4(c, 1.0)).rgb + u_add.rgb, 0.0, 1.0);
    gl_FragColor = vec4(c * t.a, t.a) * u_opacity;
  } else if (u_mode < 1.5) {
    float a = texture2D(u_tex, v_uv - u_offset).a * u_color.a;
    gl_FragColor = vec4(u_color.rgb * a, a);
  } else if (u_mode < 2.5) {
    float a = texture2D(u_tex, v_uv).a * u_color.a * u_opacity;
    gl_FragColor = vec4(u_color.rgb * a, a);
  } else {
    vec4 t = texture2D(u_tex, v_uv);
    if (t.a <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec2 d = u_texel * u_reach;
    float ab = texture2D(u_aux, v_uv).a;
    vec2 g = vec2(texture2D(u_aux, v_uv + vec2(d.x, 0.0)).a - texture2D(u_aux, v_uv - vec2(d.x, 0.0)).a,
                  texture2D(u_aux, v_uv + vec2(0.0, d.y)).a - texture2D(u_aux, v_uv - vec2(0.0, d.y)).a);
    float len = length(g);
    vec2 n = len > 1e-4 ? -g / len : vec2(0.0);
    float facing = dot(n, u_light);
    float edge = clamp((1.0 - ab) * 2.0, 0.0, 1.0);
    float shade = edge * max(0.0, -facing) * u_color.a;
    float lit = edge * max(0.0, facing) * u_color2.a;
    vec3 c = t.rgb / t.a;
    c = mix(c, c * u_color.rgb, shade);
    c = mix(c, 1.0 - (1.0 - c) * (1.0 - u_color2.rgb), lit);
    gl_FragColor = vec4(c * t.a, t.a);
  }
}`;

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function program(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`post shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`post program: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { p, u: uniforms };
}

/**
 * A colour matrix (column-major mat4 for GLSL) and offset for a grade: brightness, contrast and
 * saturation in −1..1, hue in degrees, tint [r, g, b, amount].
 */
export function gradeMatrix(grade) {
  if (!grade) return { matrix: IDENTITY, add: [0, 0, 0, 0] };
  const { brightness = 0, contrast = 0, saturation = 0, hue = 0, tint = [1, 1, 1, 0] } = grade;
  const mul = (a, b) => {
    // 3x3 row-major multiply a * b
    const o = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    return o;
  };
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;
  const s = 1 + saturation;
  const sat = [lr * (1 - s) + s, lg * (1 - s), lb * (1 - s), lr * (1 - s), lg * (1 - s) + s, lb * (1 - s), lr * (1 - s), lg * (1 - s), lb * (1 - s) + s];
  const h = (hue * Math.PI) / 180;
  const cos = Math.cos(h);
  const sin = Math.sin(h);
  const rot = [
    lr + cos * (1 - lr) - sin * lr, lg - cos * lg - sin * lg, lb - cos * lb + sin * (1 - lb),
    lr - cos * lr + sin * 0.143, lg + cos * (1 - lg) + sin * 0.14, lb - cos * lb - sin * 0.283,
    lr - cos * lr - sin * (1 - lr), lg - cos * lg + sin * lg, lb + cos * (1 - lb) + sin * lb,
  ];
  const k = 1 + contrast;
  const ta = tint[3];
  const tintM = [1 - ta + ta * tint[0], 0, 0, 0, 1 - ta + ta * tint[1], 0, 0, 0, 1 - ta + ta * tint[2]];
  let m = mul(rot, sat);
  m = mul(tintM, m);
  m = m.map((v) => v * k);
  const off = 0.5 * (1 - k) + brightness;
  // to column-major mat4
  const matrix = [m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1];
  return { matrix, add: [off, off, off, 0] };
}

export class PostFX {
  /** @param {import('./renderer.js').WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    const gl = (this.gl = renderer.gl);
    this.blurProg = program(gl, QUAD_VS, BLUR_FS);
    this.compProg = program(gl, QUAD_VS, COMPOSITE_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.free = [];
    this.all = [];
  }

  /** Whether half-float targets can be rendered to (WebGL 2 with EXT_color_buffer_float). */
  canFloat() {
    if (this.floatOk === undefined) {
      const gl = this.gl;
      this.floatOk = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext && !!gl.getExtension('EXT_color_buffer_float');
    }
    return this.floatOk;
  }

  /**
   * An offscreen target of `w` x `h` (from the pool), cleared to transparent and bound. `precise`
   * asks for a half-float target where available (motion blur sums many sub-frames into it).
   */
  acquire(w, h, { precise = false } = {}) {
    const gl = this.gl;
    const float = precise && this.canFloat();
    let t = this.free.findIndex((x) => x.w === w && x.h === h && x.float === float);
    let target;
    if (t >= 0) target = this.free.splice(t, 1)[0];
    else {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      target = { fb, w, h, float, tex: { texture, width: w, height: h, pma: true } };
      this.all.push(target);
    }
    this.bind(target);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return target;
  }

  release(target) {
    if (target) this.free.push(target);
  }

  /** Binds `target` (or the given raw framebuffer / null for the canvas) and sets the viewport. */
  bind(target, w, h) {
    const gl = this.gl;
    if (target && target.fb) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ?? null);
      gl.viewport(0, 0, w, h);
    }
  }

  draw(prog, setup, blend) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // The renderer's other attributes may still be enabled with its buffer; only 0 is used here
    // (the renderer enables its attributes again on every flush).
    for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.enable(gl.BLEND);
    if (blend === 'replace') gl.blendFunc(gl.ONE, gl.ZERO);
    else if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Gaussian blur of `src` by `radius` pixels; returns a new target (src is left as is). */
  blur(src, radius) {
    const gl = this.gl;
    if (!(radius > 0.25)) return null;
    const spacing = Math.max(1, radius / 12);
    const sigma = Math.max(0.5, radius / 2 / spacing);
    const a = this.acquire(src.w, src.h);
    this.bindTex(0, src.tex);
    this.draw(this.blurProg, (u) => {
      gl.uniform1i(u.u_tex, 0);
      gl.uniform2f(u.u_step, spacing / src.w, 0);
      gl.uniform1f(u.u_sigma, sigma);
    }, 'replace');
    const b = this.acquire(src.w, src.h);
    this.bindTex(0, a.tex);
    this.draw(this.blurProg, (u) => {
      gl.uniform1i(u.u_tex, 0);
      gl.uniform2f(u.u_step, 0, spacing / src.h);
      gl.uniform1f(u.u_sigma, sigma);
    }, 'replace');
    this.release(a);
    return b;
  }

  composite(mode, src, set, blend = 'over', aux = null) {
    const gl = this.gl;
    this.bindTex(0, src.tex);
    if (aux) this.bindTex(1, aux.tex);
    this.draw(this.compProg, (u) => {
      gl.uniform1i(u.u_tex, 0);
      gl.uniform1i(u.u_aux, aux ? 1 : 0);
      gl.uniform1f(u.u_mode, mode);
      gl.uniform2f(u.u_offset, 0, 0);
      gl.uniform1f(u.u_opacity, 1);
      gl.uniformMatrix4fv(u.u_matrix, false, new Float32Array(IDENTITY));
      gl.uniform4f(u.u_add, 0, 0, 0, 0);
      gl.uniform4f(u.u_color, 0, 0, 0, 0);
      gl.uniform4f(u.u_color2, 0, 0, 0, 0);
      gl.uniform2f(u.u_light, 0, 1);
      gl.uniform2f(u.u_texel, 1 / src.w, 1 / src.h);
      gl.uniform1f(u.u_reach, 1);
      set?.(u);
    }, blend);
  }

  /** Draws `src` into the bound target, graded and faded (`grade`: gradeMatrix() output). */
  copy(src, { grade = null, opacity = 1, blend = 'over' } = {}) {
    const gl = this.gl;
    this.composite(0, src, (u) => {
      gl.uniform1f(u.u_opacity, opacity);
      if (grade) {
        gl.uniformMatrix4fv(u.u_matrix, false, new Float32Array(grade.matrix));
        gl.uniform4fv(u.u_add, grade.add);
      }
    }, blend);
  }

  /** A shadow of `alpha`'s shape (already blurred), moved by (dx, dy) pixels, in `color`. */
  shadow(alpha, dx, dy, color) {
    const gl = this.gl;
    this.composite(1, alpha, (u) => {
      gl.uniform2f(u.u_offset, dx / alpha.w, dy / alpha.h);
      gl.uniform4fv(u.u_color, color);
    });
  }

  /** Adds a glow from the blurred layer `blurred`. */
  glow(blurred, color, strength) {
    const gl = this.gl;
    this.composite(2, blurred, (u) => {
      gl.uniform4fv(u.u_color, color);
      gl.uniform1f(u.u_opacity, strength);
    }, 'add');
  }

  /** `layer` with light shading from its blurred alpha `soft`: light comes from `angle` degrees. */
  shade(layer, soft, angle, shadeColor, lightColor, reach) {
    const gl = this.gl;
    const r = (angle * Math.PI) / 180;
    this.composite(3, layer, (u) => {
      gl.uniform2f(u.u_light, Math.cos(r), Math.sin(r));
      gl.uniform4fv(u.u_color, shadeColor);
      gl.uniform4fv(u.u_color2, lightColor);
      gl.uniform1f(u.u_reach, Math.max(1, reach));
    }, 'replace', soft);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.all) {
      gl.deleteTexture(t.tex.texture);
      gl.deleteFramebuffer(t.fb);
    }
    this.all = [];
    this.free = [];
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.blurProg.p);
    gl.deleteProgram(this.compProg.p);
  }
}
