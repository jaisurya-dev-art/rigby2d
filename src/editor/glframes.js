// SPDX-License-Identifier: MIT OR Apache-2.0
// Frames drawn on the GPU: the WebGL renderer on an OffscreenCanvas (4x MSAA), read back as
// straight-alpha RGBA. A drop-in for the software renderer (raster.js) in renderFrames, used by the
// sprite sheet worker when WebGL is there; the software renderer stays the fallback (and the MCP
// server's renderer under Node).
//
//   const r = createGLFrameRenderer(width, height, { x0, y1, scale }, { smooth: true });
//   r.clear(); r.drawSkeleton(sk, pose, lookup); const rgba = r.resolve();
//
// `lookup` gives the same entries as for raster.js: { tex: { width, height, data, pma }, trim, map }.

import { WebGLRenderer } from '../webgl/renderer.js';

/** A GPU frame renderer, or null when WebGL (in this thread) can't draw a frame this size. */
export function createGLFrameRenderer(width, height, frame, { smooth = true } = {}) {
  if (typeof OffscreenCanvas !== 'function') return null;
  let gl;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const attrs = { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true };
    gl = canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs);
  } catch {
    return null;
  }
  if (!gl) return null;
  const max = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);
  if (width > max || height > max) return null;
  const renderer = new WebGLRenderer(gl);
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  // The world rectangle as the renderer's camera: centered, `1 / scale` pixels per world unit.
  const camera = { x: frame.x0 + (width * frame.scale) / 2, y: frame.y1 - (height * frame.scale) / 2, zoom: 1 / frame.scale };
  const textures = new WeakMap(); // raster texture -> GL texture
  const entries = new WeakMap(); // lookup entry -> the same entry with its GL texture
  const glEntry = (e) => {
    if (!e?.tex?.data) return null;
    let g = entries.get(e);
    if (!g) {
      let t = textures.get(e.tex);
      if (!t) {
        if (e.tex.width > maxTexture || e.tex.height > maxTexture) throw new Error(`an image of ${e.tex.width}×${e.tex.height} is larger than this GPU's limit`);
        const { width: w, height: h, data } = e.tex;
        const pixels = new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, w * h * 4), w, h);
        textures.set(e.tex, (t = renderer.createTexture(pixels, { pma: !!e.tex.pma, linear: smooth })));
      }
      entries.set(e, (g = { ...e, tex: t }));
    }
    return g;
  };
  return {
    gpu: true,
    clear() {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    drawSkeleton(sk, pose, lookup, options = {}) {
      renderer.begin(width, height, camera);
      renderer.drawSkeleton(sk, pose, (name) => glEntry(lookup(name)), options);
      renderer.end();
    },
    resolve() {
      // A lost context reads back as empty frames: report it so renderFrames redraws on the CPU.
      if (gl.isContextLost()) throw new Error('the GPU context was lost');
      return readFrame(gl, width, height, {});
    },
    /** Frees the GPU memory now rather than whenever the context is collected. */
    dispose() {
      renderer.dispose?.();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/**
 * The current frame as straight-alpha RGBA rows, top row first (WebGL reads bottom-up and
 * premultiplied). `out` keeps the buffers between calls ({} for fresh ones).
 */
export function readFrame(gl, width, height, out) {
  const px = out.raw ?? (out.raw = new Uint8Array(width * height * 4));
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const rgba = out.rgba ?? (out.rgba = new Uint8ClampedArray(width * height * 4));
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row;
    const dst = y * row;
    for (let x = 0; x < row; x += 4) {
      const a = px[src + x + 3];
      if (a === 0) {
        rgba[dst + x] = rgba[dst + x + 1] = rgba[dst + x + 2] = rgba[dst + x + 3] = 0;
      } else if (a === 255) {
        rgba[dst + x] = px[src + x];
        rgba[dst + x + 1] = px[src + x + 1];
        rgba[dst + x + 2] = px[src + x + 2];
        rgba[dst + x + 3] = 255;
      } else {
        const k = 255 / a;
        rgba[dst + x] = px[src + x] * k;
        rgba[dst + x + 1] = px[src + x + 1] * k;
        rgba[dst + x + 2] = px[src + x + 2] * k;
        rgba[dst + x + 3] = a;
      }
    }
  }
  return rgba;
}
