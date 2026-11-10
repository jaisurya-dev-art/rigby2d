// SPDX-License-Identifier: MIT OR Apache-2.0
// Pixel grid: draws a scene at its art's own pixel size, then scales that image up with nearest
// sampling, so pixel art stays on one pixel grid. Rotated, scaled and bent parts are rasterized
// into whole art pixels (no smooth, mismatched "mixels"), as a pixel-art game would show them.
//
//   const grid = new PixelGrid(renderer);
//   // instead of renderer.begin(width, height, camera); draw(); renderer.end():
//   grid.draw(width, height, camera, pixelSize, () => renderer.drawSkeleton(sk, pose, lookup));
//
// The art pixels line up with the world grid (pixelSize world units per pixel, from the origin),
// so a part that doesn't move stays on the same pixels from frame to frame.

/** The largest offscreen image, per side (the scene beyond it is drawn without the grid). */
export const MAX_GRID_SIZE = 4096;

/**
 * The art pixels a `width` x `height` target shows through `camera` ({ x, y, zoom }) at `size`
 * world units per pixel: { x, y } (world position of the bottom-left pixel's corner, on the world
 * grid), cols and rows; null when art pixels would be smaller than target pixels or too many.
 */
export function gridRect(width, height, camera, size) {
  if (!(size > 0) || !(camera.zoom * size >= 1)) return null;
  const worldW = width / camera.zoom;
  const worldH = height / camera.zoom;
  const x = Math.floor((camera.x - worldW / 2) / size) * size;
  const y = Math.floor((camera.y - worldH / 2) / size) * size;
  const cols = Math.ceil((camera.x + worldW / 2 - x) / size);
  const rows = Math.ceil((camera.y + worldH / 2 - y) / size);
  if (cols < 1 || rows < 1 || cols > MAX_GRID_SIZE || rows > MAX_GRID_SIZE) return null;
  return { x, y, cols, rows };
}

export class PixelGrid {
  /** @param {import('./renderer.js').WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.gl = renderer.gl;
    this.framebuffer = null;
    this.tex = null;
  }

  /** Makes the offscreen texture at least cols x rows (it only grows). */
  ensure(cols, rows) {
    const gl = this.gl;
    if (this.tex && this.tex.width >= cols && this.tex.height >= rows) return;
    const width = Math.max(cols, this.tex?.width ?? 0);
    const height = Math.max(rows, this.tex?.height ?? 0);
    if (this.tex) gl.deleteTexture(this.tex.texture);
    this.framebuffer ??= gl.createFramebuffer();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    // What the offscreen image holds is premultiplied (the renderer's output).
    this.tex = { texture, width, height, pma: true };
  }

  /**
   * Draws `scene()` (renderer draw calls, between a begin and end made here) into a `width` x
   * `height` target through the pixel grid. `camera` is the target's { x, y, zoom } (zoom = target
   * pixels per world unit), `size` the world units per art pixel. Returns false, drawing nothing,
   * when art pixels would be smaller than target pixels or the grid image too large: the caller
   * then draws the scene the usual way.
   */
  draw(width, height, camera, size, scene, { target = null } = {}) {
    // The art pixels in view, aligned to the world grid.
    const rect = gridRect(width, height, camera, size);
    if (!rect) return false;
    const { x: gx, y: gy, cols, rows } = rect;
    const gl = this.gl;
    const r = this.renderer;
    this.ensure(cols, rows);

    // 1. The scene at one art pixel per offscreen pixel.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, cols, rows);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const sx = 2 / (cols * size);
    const sy = 2 / (rows * size);
    r.beginMatrix([sx, 0, 0, 0, sy, 0, -1 - gx * sx, -1 - gy * sy, 1]);
    scene();
    r.end();

    // 2. That image, scaled up into the target with nearest sampling.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, width, height);
    r.begin(width, height, camera);
    const x1 = gx + cols * size;
    const y1 = gy + rows * size;
    const u = cols / this.tex.width;
    const v = rows / this.tex.height;
    r.use(this.tex, 'normal');
    // Offscreen row 0 is the bottom of the image (world gy).
    r.emit([gx, gy, x1, gy, x1, y1, gx, y1], [0, 0, u, 0, u, v, 0, v], [0, 1, 2, 0, 2, 3], [1, 1, 1, 1], null);
    r.end();
    return true;
  }

  dispose() {
    if (this.tex) this.gl.deleteTexture(this.tex.texture);
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    this.tex = null;
    this.framebuffer = null;
  }
}
