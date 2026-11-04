// SPDX-License-Identifier: MIT OR Apache-2.0
// A software renderer for posed skeletons: the same two-color tint and blend modes as the WebGL
// renderer (src/webgl/renderer.js), drawn into memory with no graphics API, so sprite sheets come
// out the same in the editor, in the browser and from the MCP server under Node. Smooth images
// are supersampled 2 × 2 per pixel (mesh seams stay invisible); pixel art is sampled nearest,
// one sample per pixel.
//
//   const r = new SoftRenderer(width, height, { x0, y1, scale }, { smooth: true });
//   r.drawSkeleton(sk, pose, lookup);   // lookup: image name -> { tex, trim, map } (core/draw.js)
//   const rgba = r.resolve();           // straight-alpha RGBA bytes, top row first
//
// A texture is { width, height, data (RGBA bytes, top row first), pma }.

import { drawSkeletonGeometry } from '../core/draw.js';

export class SoftRenderer {
  /**
   * `frame`: the world rectangle shown, as its left edge `x0`, top edge `y1` (Y up) and `scale`
   * (world units per pixel). `smooth`: bilinear sampling and 2 × 2 supersampling.
   */
  constructor(width, height, frame, { smooth = true } = {}) {
    this.width = width;
    this.height = height;
    this.smooth = smooth;
    this.ss = smooth ? 2 : 1;
    this.sw = width * this.ss;
    this.sh = height * this.ss;
    this.buf = new Float32Array(this.sw * this.sh * 4);
    this.k = this.ss / frame.scale;
    this.x0 = frame.x0;
    this.y1 = frame.y1;
    this.rgba = [0, 0, 0, 0];
  }

  clear() {
    this.buf.fill(0);
  }

  /** Draws a posed skeleton; options as drawSkeletonGeometry (tint, skip, between). */
  drawSkeleton(sk, pose, lookup, options = {}) {
    drawSkeletonGeometry(sk, pose, lookup, (entry, blend, positions, uvs, triangles, light, dark) => this.mesh(entry.tex ?? entry, blend, positions, uvs, triangles, light, dark), options);
  }

  /** Draws triangles: flat world positions, flat page UVs (v down), vertex indices. */
  mesh(tex, blend, positions, uvs, triangles, light, dark) {
    if (!tex?.data || light[3] <= 0) return;
    const n = positions.length / 2;
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sx[i] = (positions[2 * i] - this.x0) * this.k;
      sy[i] = (this.y1 - positions[2 * i + 1]) * this.k;
    }
    for (let t = 0; t + 2 < triangles.length; t += 3) this.triangle(tex, blend, sx, sy, uvs, triangles[t], triangles[t + 1], triangles[t + 2], light, dark);
  }

  triangle(tex, blend, sx, sy, uvs, i0, i1, i2, light, dark) {
    let x0 = sx[i0];
    let y0 = sy[i0];
    let x1 = sx[i1];
    let y1 = sy[i1];
    let x2 = sx[i2];
    let y2 = sy[i2];
    let u0 = uvs[2 * i0];
    let v0 = uvs[2 * i0 + 1];
    let u1 = uvs[2 * i1];
    let v1 = uvs[2 * i1 + 1];
    const u2 = uvs[2 * i2];
    const v2 = uvs[2 * i2 + 1];
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    if (area < 0) {
      // Clockwise in screen space: swap two vertices so the edge functions are positive inside.
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
      [u0, u1] = [u1, u0];
      [v0, v1] = [v1, v0];
      area = -area;
    }
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(this.sw - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(this.sh - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;
    // Edge functions with the top-left rule, so samples on a shared edge belong to one triangle.
    // Kept in plain locals (this loop runs for every sample of every frame).
    const a0 = y1 - y2, b0e = x2 - x1, c0 = x1 * y2 - y1 * x2, tl0 = a0 > 0 || (a0 === 0 && b0e < 0);
    const a1 = y2 - y0, b1e = x0 - x2, c1 = x2 * y0 - y2 * x0, tl1 = a1 > 0 || (a1 === 0 && b1e < 0);
    const a2 = y0 - y1, b2e = x1 - x0, c2 = x0 * y1 - y0 * x1, tl2 = a2 > 0 || (a2 === 0 && b2e < 0);
    const inv = 1 / area;
    const hasDark = dark ? 1 : 0;
    const dr = dark ? dark[0] : 0;
    const dg = dark ? dark[1] : 0;
    const db = dark ? dark[2] : 0;
    const lr = light[0];
    const lg = light[1];
    const lb = light[2];
    const la = light[3];
    const buf = this.buf;
    const sw = this.sw;
    const mode = BLEND[blend] ?? 0;
    const smooth = this.smooth;
    const { width: tw, height: th, data } = tex;
    const pma = !!tex.pma;
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      // The span of this row inside all three edges (each is linear in x), widened by a pixel so
      // the exact tests below decide the boundary pixels.
      let from = minX;
      let to = maxX;
      let k = b0e * cy + c0;
      if (a0 > 0) from = Math.max(from, Math.floor(-k / a0 - 0.5) - 1);
      else if (a0 < 0) to = Math.min(to, Math.ceil(-k / a0 - 0.5) + 1);
      else if (k < 0 || (k === 0 && !tl0)) to = -1;
      k = b1e * cy + c1;
      if (a1 > 0) from = Math.max(from, Math.floor(-k / a1 - 0.5) - 1);
      else if (a1 < 0) to = Math.min(to, Math.ceil(-k / a1 - 0.5) + 1);
      else if (k < 0 || (k === 0 && !tl1)) to = -1;
      k = b2e * cy + c2;
      if (a2 > 0) from = Math.max(from, Math.floor(-k / a2 - 0.5) - 1);
      else if (a2 < 0) to = Math.min(to, Math.ceil(-k / a2 - 0.5) + 1);
      else if (k < 0 || (k === 0 && !tl2)) to = -1;
      for (let px = from; px <= to; px++) {
        const cx = px + 0.5;
        const w0 = a0 * cx + b0e * cy + c0;
        if (w0 < 0 || (w0 === 0 && !tl0)) continue;
        const w1 = a1 * cx + b1e * cy + c1;
        if (w1 < 0 || (w1 === 0 && !tl1)) continue;
        const w2 = a2 * cx + b2e * cy + c2;
        if (w2 < 0 || (w2 === 0 && !tl2)) continue;
        const bc0 = w0 * inv;
        const bc1 = w1 * inv;
        const bc2 = 1 - bc0 - bc1;
        const u = bc0 * u0 + bc1 * u1 + bc2 * u2;
        const v = bc0 * v0 + bc1 * v1 + bc2 * v2;
        // The texel color (as sample() below, inlined).
        let cr, cg, cb, ta;
        if (!smooth) {
          const x = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
          const y = Math.min(th - 1, Math.max(0, Math.floor(v * th)));
          const o = (y * tw + x) * 4;
          cr = data[o] / 255;
          cg = data[o + 1] / 255;
          cb = data[o + 2] / 255;
          ta = data[o + 3] / 255;
        } else {
          const fx = u * tw - 0.5;
          const fy = v * th - 0.5;
          const xa = Math.floor(fx);
          const ya = Math.floor(fy);
          const tx = fx - xa;
          const ty = fy - ya;
          const xb = Math.min(tw - 1, Math.max(0, xa + 1));
          const yb = Math.min(th - 1, Math.max(0, ya + 1));
          const xc = Math.min(tw - 1, Math.max(0, xa));
          const yc = Math.min(th - 1, Math.max(0, ya));
          const o00 = (yc * tw + xc) * 4;
          const o10 = (yc * tw + xb) * 4;
          const o01 = (yb * tw + xc) * 4;
          const o11 = (yb * tw + xb) * 4;
          const w00 = (1 - tx) * (1 - ty);
          const w10 = tx * (1 - ty);
          const w01 = (1 - tx) * ty;
          const w11 = tx * ty;
          const t00 = data[o00 + 3];
          const t10 = data[o10 + 3];
          const t01 = data[o01 + 3];
          const t11 = data[o11 + 3];
          const k00 = pma ? w00 : w00 * t00;
          const k10 = pma ? w10 : w10 * t10;
          const k01 = pma ? w01 : w01 * t01;
          const k11 = pma ? w11 : w11 * t11;
          const sa = t00 * w00 + t10 * w10 + t01 * w01 + t11 * w11;
          const sr = data[o00] * k00 + data[o10] * k10 + data[o01] * k01 + data[o11] * k11;
          const sg = data[o00 + 1] * k00 + data[o10 + 1] * k10 + data[o01 + 1] * k01 + data[o11 + 1] * k11;
          const sb = data[o00 + 2] * k00 + data[o10 + 2] * k10 + data[o01 + 2] * k01 + data[o11 + 2] * k11;
          if (pma) {
            cr = sr / 255;
            cg = sg / 255;
            cb = sb / 255;
          } else if (sa > 0) {
            cr = sr / sa / 255;
            cg = sg / sa / 255;
            cb = sb / sa / 255;
          } else {
            cr = cg = cb = 0;
          }
          ta = sa / 255;
        }
        if (ta <= 0) continue;
        if (pma) {
          cr /= ta;
          cg /= ta;
          cb /= ta;
        }
        const a = ta * la;
        const r = (cr * lr + (1 - cr) * dr * hasDark) * a;
        const g = (cg * lg + (1 - cg) * dg * hasDark) * a;
        const bl = (cb * lb + (1 - cb) * db * hasDark) * a;
        const o = (py * sw + px) * 4;
        if (mode === 0) {
          // ONE, ONE_MINUS_SRC_ALPHA (blendInto's normal case, inlined)
          buf[o] = r + buf[o] * (1 - a);
          buf[o + 1] = g + buf[o + 1] * (1 - a);
          buf[o + 2] = bl + buf[o + 2] * (1 - a);
          buf[o + 3] = a + buf[o + 3] * (1 - a);
        } else blendInto(buf, o, blend, r, g, bl, a);
      }
    }
  }

  /** Texture color at page UV (u, v), straight or premultiplied as stored, in 0..1. */
  sample(tex, u, v, out) {
    const { width: w, height: h, data } = tex;
    if (!this.smooth) {
      const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
      const o = (y * w + x) * 4;
      out[0] = data[o] / 255;
      out[1] = data[o + 1] / 255;
      out[2] = data[o + 2] / 255;
      out[3] = data[o + 3] / 255;
      return out;
    }
    // Bilinear, clamped to the edge, weighting color by alpha so transparent texels don't bleed
    // their (often black) color into edges.
    const fx = u * w - 0.5;
    const fy = v * h - 0.5;
    const xa = Math.floor(fx);
    const ya = Math.floor(fy);
    const tx = fx - xa;
    const ty = fy - ya;
    const xb = Math.min(w - 1, Math.max(0, xa + 1));
    const yb = Math.min(h - 1, Math.max(0, ya + 1));
    const xc = Math.min(w - 1, Math.max(0, xa));
    const yc = Math.min(h - 1, Math.max(0, ya));
    const o00 = (yc * w + xc) * 4;
    const o10 = (yc * w + xb) * 4;
    const o01 = (yb * w + xc) * 4;
    const o11 = (yb * w + xb) * 4;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    // Straight-alpha pages weight each texel's color by its alpha; premultiplied ones already are.
    const pma = tex.pma;
    const k00 = pma ? w00 : w00 * data[o00 + 3];
    const k10 = pma ? w10 : w10 * data[o10 + 3];
    const k01 = pma ? w01 : w01 * data[o01 + 3];
    const k11 = pma ? w11 : w11 * data[o11 + 3];
    const a = data[o00 + 3] * w00 + data[o10 + 3] * w10 + data[o01 + 3] * w01 + data[o11 + 3] * w11;
    const r = data[o00] * k00 + data[o10] * k10 + data[o01] * k01 + data[o11] * k11;
    const g = data[o00 + 1] * k00 + data[o10 + 1] * k10 + data[o01 + 1] * k01 + data[o11 + 1] * k11;
    const b = data[o00 + 2] * k00 + data[o10 + 2] * k10 + data[o01 + 2] * k01 + data[o11 + 2] * k11;
    if (tex.pma) {
      out[0] = r / 255;
      out[1] = g / 255;
      out[2] = b / 255;
    } else if (a > 0) {
      out[0] = r / a / 255;
      out[1] = g / a / 255;
      out[2] = b / a / 255;
    } else {
      out[0] = out[1] = out[2] = 0;
    }
    out[3] = a / 255;
    return out;
  }

  /** The image as straight-alpha RGBA bytes, top row first (supersamples averaged). */
  resolve(out = new Uint8ClampedArray(this.width * this.height * 4)) {
    const { ss, sw, buf } = this;
    const n = ss * ss;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let j = 0; j < ss; j++) {
          for (let i = 0; i < ss; i++) {
            const o = ((y * ss + j) * sw + x * ss + i) * 4;
            r += buf[o];
            g += buf[o + 1];
            b += buf[o + 2];
            a += buf[o + 3];
          }
        }
        const d = (y * this.width + x) * 4;
        a /= n;
        if (a <= 0) {
          out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
          continue;
        }
        const k = 255 / (a * n);
        out[d] = Math.round(r * k);
        out[d + 1] = Math.round(g * k);
        out[d + 2] = Math.round(b * k);
        out[d + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    return out;
  }
}

const BLEND = { normal: 0, additive: 1, multiply: 2, screen: 3 };

/** Blends a premultiplied color into `buf` at `o`, like the WebGL renderer's blend functions. */
function blendInto(buf, o, blend, r, g, b, a) {
  const dr = buf[o];
  const dg = buf[o + 1];
  const db = buf[o + 2];
  const da = buf[o + 3];
  if (blend === 'additive') {
    // ONE, ONE
    buf[o] = dr + r;
    buf[o + 1] = dg + g;
    buf[o + 2] = db + b;
    buf[o + 3] = Math.min(1, da + a);
  } else if (blend === 'multiply') {
    // DST_COLOR, ONE_MINUS_SRC_ALPHA
    buf[o] = r * dr + dr * (1 - a);
    buf[o + 1] = g * dg + dg * (1 - a);
    buf[o + 2] = b * db + db * (1 - a);
    buf[o + 3] = a * da + da * (1 - a);
  } else if (blend === 'screen') {
    // ONE, ONE_MINUS_SRC_COLOR
    buf[o] = r + dr * (1 - r);
    buf[o + 1] = g + dg * (1 - g);
    buf[o + 2] = b + db * (1 - b);
    buf[o + 3] = a + da * (1 - a);
  } else {
    // ONE, ONE_MINUS_SRC_ALPHA
    buf[o] = r + dr * (1 - a);
    buf[o + 1] = g + dg * (1 - a);
    buf[o + 2] = b + db * (1 - a);
    buf[o + 3] = a + da * (1 - a);
  }
}
