// SPDX-License-Identifier: MIT OR Apache-2.0
// Draws a posed skeleton with film effects (core/filmfx.js): effect layers drawn offscreen at the
// place of their first slot in the draw order, then shadowed, shaded, blurred (and focus-blurred by
// depth), graded and glowing as they are put back; particles at their slot (or on top); a grade over
// the whole frame. Used by the viewport (Film workspace) and offline renders, and only for projects
// that have film effects: everything else keeps the renderer's direct path.

import { dofRadius, resolveLayers } from '../core/filmfx.js';
import { PostFX, gradeMatrix } from './post.js';

const QUAD = [0, 1, 2, 0, 2, 3];
const CORNERS = [
  [0, 0, -1, 1],
  [1, 0, 1, 1],
  [1, 1, 1, -1],
  [0, 1, -1, -1],
];

export class FilmDrawer {
  /** @param {import('./renderer.js').WebGLRenderer} renderer */
  constructor(renderer) {
    this.r = renderer;
    this.gl = renderer.gl;
    this.post = null;
    this.dotTex = null;
  }

  /**
   * Draws the frame into `target` (a framebuffer, or null for the canvas), which the caller has
   * cleared. `o`: { doc, pose, lookup, width, height, camera, target, between (actors, may be null),
   * particles ([{ emitter, sprites }] from ParticleField.update) }.
   */
  draw(o) {
    const post = (this.post ??= new PostFX(this.r));
    const film = o.doc.film;
    const layers = resolveLayers(o.doc);
    // The innermost layer of each slot.
    const owner = new Map();
    layers.forEach((l, k) => {
      for (const s of l.slots) owner.set(s, k);
    });
    const ctx = { ...o, post, film, layers, owner };
    const dest = { raw: o.target ?? null };
    if (film?.grade) {
      const frame = post.acquire(o.width, o.height);
      this.level(ctx, -1, frame);
      this.bindDest(ctx, dest);
      post.copy(frame, { grade: gradeMatrix(film.grade) });
      post.release(frame);
    } else {
      this.level(ctx, -1, dest);
    }
  }

  bindDest(ctx, dest) {
    if (dest.fb) ctx.post.bind(dest);
    else ctx.post.bind(dest.raw, ctx.width, ctx.height);
  }

  /** The layer directly under level `L` that slot `i` is drawn in: L itself, a child, or null (outside L). */
  childAt(ctx, i, L) {
    let k = ctx.owner.has(i) ? ctx.owner.get(i) : -1;
    if (k === L) return L;
    while (k !== -1) {
      const parent = ctx.layers[k].parent;
      if (parent === L) return k;
      k = parent;
    }
    return L === -1 ? -1 : null;
  }

  /** Draws the slots of level `L` (−1 = everything outside layers) into `dest`, child layers at their place. */
  level(ctx, L, dest) {
    const r = this.r;
    const { doc, pose, lookup, width, height, camera } = ctx;
    const drawn = new Set();
    const begin = () => {
      this.bindDest(ctx, dest);
      r.begin(width, height, camera);
    };
    begin();
    r.drawSkeleton(doc, pose, lookup, {
      skip: (i, att) => (att.type === 'clipping' ? false : this.childAt(ctx, i, L) !== L),
      between: (i) => {
        const at = this.childAt(ctx, i, L);
        if (at === null) return;
        if (at !== L) {
          if (!drawn.has(at)) {
            drawn.add(at);
            r.end();
            this.layer(ctx, at, dest);
            begin();
          }
          return;
        }
        ctx.between?.(i);
        const name = doc.slots[i]?.name;
        for (const p of ctx.particles ?? []) if (p.emitter.slot === name) this.sprites(ctx, p);
      },
    });
    // Particles drawn on top of everything (no slot, or a slot that no longer exists).
    if (L === -1) for (const p of ctx.particles ?? []) if (!p.emitter.slot || !doc.slots.some((s) => s.name === p.emitter.slot)) this.sprites(ctx, p);
    r.end();
  }

  /** Draws layer `k` offscreen, applies its effects and puts it into `dest`. */
  layer(ctx, k, dest) {
    const { post, film, width, height } = ctx;
    const { layer, depth } = ctx.layers[k];
    const zoom = ctx.camera.zoom;
    let content = post.acquire(width, height);
    this.level(ctx, k, content);
    // Blur, and focus blur by depth.
    const blurPx = ((layer.blur?.radius ?? 0) + dofRadius(film?.dof, depth)) * zoom;
    if (blurPx > 0.25) {
      const b = post.blur(content, blurPx);
      if (b) {
        post.release(content);
        content = b;
      }
    }
    if (layer.shading) {
      const width = Math.max(1, layer.shading.width * zoom);
      const soft = post.blur(content, width);
      if (soft) {
        const shaded = post.acquire(content.w, content.h);
        post.shade(content, soft, film?.light?.angle ?? 135, layer.shading.shade, layer.shading.light, width / 3);
        post.release(soft);
        post.release(content);
        content = shaded;
      }
    }
    if (layer.shadow) {
      const s = layer.shadow;
      const soft = post.blur(content, s.softness * zoom) ?? content;
      this.bindDest(ctx, dest);
      post.shadow(soft, s.x * zoom, s.y * zoom, s.color);
      if (soft !== content) post.release(soft);
    }
    // Glow goes under the layer: a halo around the shape that the layer itself covers inside, so
    // the art keeps its colours.
    if (layer.glow) {
      const g = layer.glow;
      const soft = post.blur(content, g.radius * zoom) ?? content;
      this.bindDest(ctx, dest);
      post.glow(soft, g.color, g.strength);
      if (soft !== content) post.release(soft);
    }
    this.bindDest(ctx, dest);
    post.copy(content, { grade: layer.grade ? gradeMatrix(layer.grade) : null });
    post.release(content);
  }

  /** A soft round dot, for emitters without an image. */
  dot() {
    if (this.dotTex) return this.dotTex;
    const gl = this.gl;
    const n = 64;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
        const a = Math.round(255 * Math.max(0, Math.min(1, (1 - d) * 2.5)));
        data.set([255, 255, 255, a], (y * n + x) * 4);
      }
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.dotTex = { texture, width: n, height: n, pma: false };
    return this.dotTex;
  }

  /** Draws an emitter's particles as textured quads. */
  sprites(ctx, { emitter, sprites }) {
    if (!sprites.length) return;
    const r = this.r;
    const entry = emitter.image ? ctx.lookup(emitter.image) : null;
    const tex = entry?.tex ?? this.dot();
    const [u0, v0, u1, v1] = entry?.trim ?? [0, 0, 1, 1];
    const aspect = tex.height / tex.width || 1;
    const uv = [0, 0];
    const uvs = new Array(8);
    for (let k = 0; k < 4; k++) {
      const [cu, cv] = CORNERS[k];
      if (entry) entry.map(cu ? u1 : u0, cv ? v1 : v0, uv);
      else ((uv[0] = cu), (uv[1] = cv));
      uvs[2 * k] = uv[0];
      uvs[2 * k + 1] = uv[1];
    }
    r.use(tex, emitter.blend);
    const pos = new Array(8);
    for (const s of sprites) {
      if (s.color[3] <= 0.002) continue;
      const a = (s.rotation * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const hw = s.size / 2;
      const hh = (s.size * aspect) / 2;
      for (let k = 0; k < 4; k++) {
        const lx = CORNERS[k][2] * hw;
        const ly = CORNERS[k][3] * hh;
        pos[2 * k] = s.x + lx * cos - ly * sin;
        pos[2 * k + 1] = s.y + lx * sin + ly * cos;
      }
      r.emit(pos, uvs, QUAD, s.color, null);
    }
  }

  dispose() {
    this.post?.dispose();
    if (this.dotTex) this.gl.deleteTexture(this.dotTex.texture);
    this.post = null;
    this.dotTex = null;
  }
}
