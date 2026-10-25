// SPDX-License-Identifier: MIT OR Apache-2.0
// WebGL layer of the viewport: background, grid and attachments, drawn with the runtime's
// WebGL renderer. Bones, handles and other overlays stay on the 2D canvas above it.

import { WebGLRenderer } from '../webgl/renderer.js';

const BACKGROUND = [38 / 255, 38 / 255, 38 / 255];
const GRID = [48 / 255, 48 / 255, 48 / 255, 1];
const X_AXIS = [90 / 255, 60 / 255, 60 / 255, 1];
const Y_AXIS = [60 / 255, 90 / 255, 60 / 255, 1];
const identity = (u, v, out) => ((out[0] = u), (out[1] = v), out);

export class GLView {
  /** Returns null when WebGL is unavailable (the viewport then draws with Canvas 2D). */
  static create(canvas) {
    try {
      const options = { alpha: false, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false };
      const gl = canvas.getContext('webgl2', options) ?? canvas.getContext('webgl', options);
      return gl ? new GLView(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.renderer = new WebGLRenderer(gl);
    /** Image name -> { canvas, entry }: textures follow the editor's image store. */
    this.textures = new Map();
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  /**
   * Texture entry for an editor image, uploaded on first use and again when the image is replaced
   * or the project's texture filter changes (`linear` false = nearest, for pixel art).
   */
  lookup(images, name, linear = true) {
    const canvas = images.get(name);
    if (!canvas || !canvas.width || !canvas.height) return null;
    const hit = this.textures.get(name);
    if (hit && hit.canvas === canvas && hit.linear === linear) return hit.entry;
    if (hit) this.renderer.deleteTexture(hit.entry.tex);
    const entry = { tex: this.renderer.createTexture(canvas, { linear }), trim: [0, 0, 1, 1], map: identity };
    this.textures.set(name, { canvas, linear, entry });
    return entry;
  }

  /** Drops textures of images no longer in the store. */
  prune(images) {
    for (const [name, hit] of this.textures) {
      if (images.get(name) !== hit.canvas) {
        this.renderer.deleteTexture(hit.entry.tex);
        this.textures.delete(name);
      }
    }
  }

  /**
   * Draws a frame. `view` is the editor camera ({ zoom, panX, panY } in CSS pixels), `width` and
   * `height` the CSS size and `dpr` the device pixel ratio.
   */
  draw(app, pose, width, height, dpr) {
    if (this.lost) return false;
    const gl = this.gl;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) [this.canvas.width, this.canvas.height] = [w, h];
    gl.viewport(0, 0, w, h);
    gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { zoom, panX, panY } = app.view;
    const r = this.renderer;
    r.begin(w, h, { x: -panX / zoom, y: panY / zoom, zoom: zoom * dpr });

    // Grid: the same spacing rules as the 2D overlay used.
    let step = 50;
    while (step * zoom < 24) step *= 2;
    while (step * zoom > 120) step /= 2;
    const x0 = (-width / 2 - panX) / zoom;
    const x1 = (width / 2 - panX) / zoom;
    const y0 = (-height / 2 + panY) / zoom;
    const y1 = (height / 2 + panY) / zoom;
    const px = 1 / zoom;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) r.line(x, y0, x, y1, px, GRID);
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) r.line(x0, y, x1, y, px, GRID);
    r.line(x0, 0, x1, 0, px, X_AXIS);
    r.line(0, y0, 0, y1, px, Y_AXIS);

    const linear = app.doc.textureFilter !== 'nearest';
    const lookup = (name) => this.lookup(app.images, name, linear);
    // Onion skinning: ghosts of nearby frames, faded (and optionally masked per bone) behind the pose.
    for (const g of app.onionDraws?.() ?? []) r.drawSkeleton(app.doc, g.pose, lookup, { tint: g.tint, skip: g.skip });
    r.drawSkeleton(app.doc, pose, lookup);
    r.end();
    this.stats = { drawCalls: r.drawCalls };
    return true;
  }
}
