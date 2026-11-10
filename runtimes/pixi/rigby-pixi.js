// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for PixiJS 8: plays Rigby2D skeletons (.skel or .json with their .atlas) as native PixiJS
// display objects. The animation is the JavaScript runtime (src/core), so skeletons move exactly as
// in the editor; the drawing is PixiJS's own: every attachment is a PixiJS Mesh that goes through
// PixiJS's batcher, on WebGL and WebGPU, so skeletons share draw calls with sprites and work with
// filters, masks, tint, alpha, blend modes, bounds and events like any other display object.
//
//   import * as PIXI from 'pixi.js';
//   import { rigbyPixi } from './rigby-pixi.js';
//   const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI);
//   const nila = new RigbySkeleton(await loadRigby('nila.skel', 'nila.atlas'), { animation: 'idle' });
//   app.stage.addChild(nila);
//
// See runtimes/pixi/README.md.

import { parseAtlas } from '../../src/core/atlas.js';
import { isSkeletonBinary, readSkeletonBinary } from '../../src/core/binary.js';
import { atlasLookup, drawSkeletonGeometry } from '../../src/core/draw.js';
import { readSkeletonJson } from '../../src/core/interop.js';
import { Affine } from '../../src/core/math.js';
import { Pose } from '../../src/core/pose.js';
import { AnimationState } from '../../src/core/state.js';

/** Slot blend modes -> PixiJS blend modes (all four are PixiJS's own, batchable ones). */
export const BLEND_MODES = { normal: 'normal', additive: 'add', multiply: 'multiply', screen: 'screen' };

/** The folder part of a URL, with its trailing slash: "assets/nila.atlas" -> "assets/". */
const folderOf = (url) => url.slice(0, url.lastIndexOf('/') + 1);

/**
 * Two-color tint (the slot's dark color): texture color c becomes light * c + dark * (1 - c), the same
 * formula as the editor's renderer. With premultiplied textures and PixiJS's premultiplied vertex
 * color, the dark term to add is dark * (t.a - t.rgb) * alpha.
 */
const darkTintBit = {
  name: 'rigby-dark-tint',
  vertex: { header: '@in aDark: vec3<f32>;\n@out vDark: vec3<f32>;', main: 'vDark = aDark;' },
  fragment: { header: '@in vDark: vec3<f32>;', end: 'finalColor = vec4<f32>(finalColor.rgb + (outColor.a - outColor.rgb) * vDark * vColor.a, finalColor.a);' },
};
const darkTintBitGl = {
  name: 'rigby-dark-tint',
  vertex: { header: 'in vec3 aDark;\nout vec3 vDark;', main: 'vDark = aDark;' },
  fragment: { header: 'in vec3 vDark;', end: 'finalColor = vec4(finalColor.rgb + (outColor.a - outColor.rgb) * vDark * vColor.a, finalColor.a);' },
};

/** Flat number arrays grow by doubling, so a playing skeleton stops allocating after a few frames. */
class Buf {
  constructor(Type) {
    this.Type = Type;
    this.data = new Type(64);
    this.length = 0;
  }
  reserve(n) {
    if (this.length + n <= this.data.length) return;
    const next = new this.Type(Math.max(this.data.length * 2, this.length + n));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
}

/**
 * Creates the runtime for a PixiJS namespace (`import * as PIXI from 'pixi.js'`, or the `PIXI`
 * global of the script build). Returns { loadRigby, parseRigby, RigbySkeleton, RigbyData }.
 */
export function rigbyPixi(PIXI = globalThis.PIXI) {
  if (!PIXI?.Mesh || !PIXI?.MeshGeometry || !PIXI?.Container) throw new Error('Rigby2D: pass the PixiJS namespace (PixiJS 8): rigbyPixi(PIXI)');
  const { Assets, Container, DOMAdapter, Mesh, MeshGeometry, Shader, Texture, Ticker } = PIXI;

  /**
   * Loaded skeleton data, shared by every RigbySkeleton made from it: the skeleton, its atlas and a
   * PixiJS texture per atlas page.
   */
  class RigbyData {
    constructor(skeleton, atlas, pages) {
      /** The skeleton data (src/core model): bones, slots, skins, constraints, animations. */
      this.skeleton = skeleton;
      /** The parsed atlas. */
      this.atlas = atlas;
      /** Atlas page name -> PixiJS Texture. */
      this.pages = pages;
      this.lookup = atlasLookup(atlas, (page) => pages.get(page.name) ?? null);
      if (skeleton.skins.length && skeleton.skin === undefined) skeleton.skin = null;
    }
    get animationNames() {
      return this.skeleton.animations.map((a) => a.name);
    }
    get skinNames() {
      return this.skeleton.skins.map((s) => s.name);
    }
  }

  /**
   * Builds skeleton data from what is already in memory: the skeleton (.skel bytes, JSON text or a
   * parsed JSON object), the atlas text, and the page textures (page name -> Texture, or a function).
   */
  function parseRigby(skeleton, atlasText, textures) {
    let json = skeleton;
    if (skeleton instanceof ArrayBuffer) json = new Uint8Array(skeleton);
    if (json instanceof Uint8Array) json = isSkeletonBinary(json) ? readSkeletonBinary(json) : JSON.parse(new TextDecoder().decode(json));
    else if (typeof json === 'string') json = JSON.parse(json);
    const data = readSkeletonJson(json).skeleton;
    const atlas = parseAtlas(atlasText);
    const pages = new Map();
    for (const page of atlas.pages) {
      const tex = typeof textures === 'function' ? textures(page.name, page) : textures instanceof Map ? textures.get(page.name) : textures?.[page.name];
      if (tex) pages.set(page.name, tex);
    }
    return new RigbyData(data, atlas, pages);
  }

  const cache = new Map();

  /**
   * Loads a skeleton (.skel or .json), its .atlas and the atlas pages (through PixiJS Assets, from
   * the atlas's folder). Loading the same pair again returns the same RigbyData.
   */
  function loadRigby(skeletonUrl, atlasUrl) {
    const key = `${skeletonUrl}\n${atlasUrl}`;
    if (!cache.has(key)) {
      const promise = (async () => {
        const fetcher = DOMAdapter?.get?.().fetch?.bind(DOMAdapter.get()) ?? globalThis.fetch;
        const get = async (url) => {
          const res = await fetcher(url);
          if (!res.ok) throw new Error(`Rigby2D: could not load ${url} (${res.status})`);
          return res;
        };
        const [bytes, atlasText] = await Promise.all([get(skeletonUrl).then((r) => r.arrayBuffer()), get(atlasUrl).then((r) => r.text())]);
        const atlas = parseAtlas(atlasText);
        const textures = new Map();
        await Promise.all(
          atlas.pages.map(async (page) => {
            const nearest = (page.filter?.[1] ?? page.filter?.[0] ?? 'Linear').toLowerCase().startsWith('nearest');
            const tex = await Assets.load({
              src: new URL(page.name, new URL(folderOf(atlasUrl) || './', globalThis.location?.href ?? 'http://localhost/')).href,
              data: { alphaMode: page.pma ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload', scaleMode: nearest ? 'nearest' : 'linear' },
            });
            textures.set(page.name, tex);
          }),
        );
        return parseRigby(new Uint8Array(bytes), atlasText, textures);
      })();
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    }
    return cache.get(key);
  }

  /** The two-color tint shader for one texture (a Mesh with its own shader draws outside the batcher). */
  function darkShader(texture) {
    const shader = new Shader({
      glProgram: (darkShader.gl ??= PIXI.compileHighShaderGlProgram({ name: 'rigby-dark-mesh', bits: [PIXI.localUniformBitGl, PIXI.textureBitGl, PIXI.roundPixelsBitGl, darkTintBitGl] })),
      gpuProgram: (darkShader.gpu ??= PIXI.compileHighShaderGpuProgram({ name: 'rigby-dark-mesh', bits: [PIXI.localUniformBit, PIXI.textureBit, PIXI.roundPixelsBit, darkTintBit] })),
      resources: {
        uTexture: texture.source,
        uSampler: texture.source.style,
        textureUniforms: { uTextureMatrix: { type: 'mat3x3<f32>', value: texture.textureMatrix.mapCoord } },
      },
    });
    shader.rigbyTexture = texture;
    return shader;
  }

  /**
   * One run of the draw list: a Mesh fed with the triangles of consecutive attachments that share a
   * texture, blend mode, light color and dark color.
   */
  class Piece {
    constructor(owner) {
      this.owner = owner;
      this.positions = new Buf(Float32Array);
      this.uvs = new Buf(Float32Array);
      this.indices = new Buf(Uint32Array);
      this.darks = null;
      this.mesh = null;
      this.darkMesh = null;
    }
    begin(tex, blend, light, dark) {
      this.tex = tex;
      this.blend = blend;
      this.light = light;
      this.dark = dark;
      this.positions.length = this.uvs.length = this.indices.length = 0;
      if (this.darks) this.darks.length = 0;
    }
    accepts(tex, blend, light, dark) {
      const l = this.light;
      if (tex !== this.tex || blend !== this.blend || l[0] !== light[0] || l[1] !== light[1] || l[2] !== light[2] || l[3] !== light[3]) return false;
      const d = this.dark;
      return !d === !dark && (!d || (d[0] === dark[0] && d[1] === dark[1] && d[2] === dark[2]));
    }
    add(positions, uvs, triangles) {
      const n = positions.length / 2;
      const base = this.positions.length / 2;
      this.positions.reserve(positions.length);
      this.uvs.reserve(uvs.length);
      this.indices.reserve(triangles.length);
      const p = this.positions.data;
      const t = this.uvs.data;
      const ix = this.indices.data;
      let o = this.positions.length;
      // Skeleton space is Y up; PixiJS is Y down.
      for (let k = 0; k < n; k++, o += 2) {
        p[o] = positions[2 * k];
        p[o + 1] = -positions[2 * k + 1];
        t[o] = uvs[2 * k];
        t[o + 1] = uvs[2 * k + 1];
      }
      this.positions.length = this.uvs.length = o;
      o = this.indices.length;
      for (let k = 0; k < triangles.length; k++) ix[o + k] = base + triangles[k];
      this.indices.length = o + triangles.length;
      if (this.dark) {
        this.darks ??= new Buf(Float32Array);
        this.darks.reserve(n * 3);
        const dk = this.darks.data;
        for (let k = 0, q = this.darks.length; k < n; k++, q += 3) {
          dk[q] = this.dark[0];
          dk[q + 1] = this.dark[1];
          dk[q + 2] = this.dark[2];
        }
        this.darks.length += n * 3;
      }
    }
    /** Writes the run into its Mesh (the plain one, or the two-color one when it has a dark color). */
    flush(container, index) {
      const dark = !!this.dark;
      let mesh = dark ? this.darkMesh : this.mesh;
      if (!mesh) {
        const geometry = new MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array(6) });
        if (dark) {
          geometry.addAttribute('aDark', { buffer: new PIXI.Buffer({ data: new Float32Array(12), usage: PIXI.BufferUsage.VERTEX | PIXI.BufferUsage.COPY_DST }), format: 'float32x3', stride: 12, offset: 0 });
        } else {
          // Every size goes through PixiJS's batcher, so a whole skeleton is a few draw calls.
          geometry.batchMode = 'batch';
        }
        mesh = new Mesh({ geometry, texture: this.tex });
        mesh.label = dark ? 'rigby-dark' : 'rigby';
        if (dark) {
          this.darkMesh = mesh;
          mesh.shader = darkShader(this.tex);
        } else this.mesh = mesh;
        container.addChildAt(mesh, Math.min(index, container.children.length));
      }
      const other = dark ? this.mesh : this.darkMesh;
      if (other) other.visible = false;
      mesh.visible = true;
      if (container.getChildIndex(mesh) !== index) container.setChildIndex(mesh, Math.min(index, container.children.length - 1));
      const g = mesh.geometry;
      setBuffer(g.getBuffer('aPosition'), this.positions);
      setBuffer(g.getBuffer('aUV'), this.uvs);
      setBuffer(g.getIndex(), this.indices);
      if (dark) setBuffer(g.getBuffer('aDark'), this.darks);
      if (mesh.texture !== this.tex) {
        mesh.texture = this.tex;
        if (dark) {
          mesh.shader.resources.uTexture = this.tex.source;
          mesh.shader.resources.uSampler = this.tex.source.style;
          mesh.shader.resources.textureUniforms.uniforms.uTextureMatrix = this.tex.textureMatrix.mapCoord;
        }
      }
      const [r, gr, b, a] = this.light;
      mesh.tint = ((clamp255(r) << 16) | (clamp255(gr) << 8) | clamp255(b)) >>> 0;
      mesh.alpha = Math.max(0, Math.min(1, a));
      mesh.blendMode = BLEND_MODES[this.blend] ?? 'normal';
      mesh.roundPixels = this.owner.roundPixels;
      return 1;
    }
    hide() {
      if (this.mesh) this.mesh.visible = false;
      if (this.darkMesh) this.darkMesh.visible = false;
    }
    destroy() {
      this.darkMesh?.shader?.destroy();
      this.mesh?.destroy();
      this.darkMesh?.destroy();
    }
  }

  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

  /** Puts `buf`'s live part into a PixiJS buffer, reusing its storage while it is big enough. */
  function setBuffer(buffer, buf) {
    const view = buf.data.subarray(0, buf.length);
    if (buffer.data.length === view.length) {
      buffer.data.set(view);
      buffer.update();
    } else buffer.data = view.slice();
  }

  /**
   * A playing skeleton: a PixiJS Container whose children are the meshes of the skeleton's
   * attachments. `state` is its AnimationState (tracks, crossfades, queues), `pose` the current pose.
   * Emits 'start', 'end', 'complete' (entry) and 'event' (entry, event) as its animations play.
   */
  class RigbySkeleton extends Container {
    /**
     * @param {RigbyData} data from loadRigby or parseRigby
     * @param {{ animation?: string, loop?: boolean, skin?: string|null, autoUpdate?: boolean,
     *   timeScale?: number, physicsMovement?: number, ticker?: any, roundPixels?: boolean }} [options]
     */
    constructor(data, options = {}) {
      if (!(data instanceof RigbyData)) throw new Error('Rigby2D: new RigbySkeleton(data) takes the data from loadRigby() or parseRigby()');
      super({ label: options.label ?? 'RigbySkeleton' });
      this.data = data;
      this.skeleton = data.skeleton;
      this.pose = new Pose(this.skeleton);
      this.state = new AnimationState();
      /** Speed multiplier for this skeleton's animations (1 = real time). */
      this.timeScale = options.timeScale ?? 1;
      /**
       * How strongly moving the object in its parent drives physics (hair, cloth, jiggle): 0 (the
       * default) = only the animation does, exactly as in the editor; 1 = as if the character itself
       * covered that distance in its own units. Physics is tuned in the editor for animation, so
       * turn this on only for rigs made to be moved around (a small value, such as 0.05, first).
       */
      this.physicsMovement = options.physicsMovement ?? 0;
      this.roundPixels = !!options.roundPixels;
      this._skin = options.skin !== undefined ? options.skin : (this.skeleton.skin ?? null);
      this._pieces = [];
      this._followers = [];
      this._placement = new Affine();
      this._placed = false;
      this._view = new Container({ label: 'rigby-meshes' });
      this.addChild(this._view);
      this.state.addListener({
        start: (entry) => this.emit('start', entry),
        end: (entry) => this.emit('end', entry),
        complete: (entry) => this.emit('complete', entry),
        event: (entry, event) => this.emit('event', entry, event),
      });
      if (this._skin !== null) this.skin = this._skin;
      if (options.animation) this.play(options.animation, options.loop ?? true);
      this._ticker = null;
      this.update(0);
      this._placed = false; // physics starts from wherever the object is on its first frame
      // A ticker of its own (an Application's app.ticker, say), or PixiJS's shared one.
      if (options.ticker) this._attachTicker(options.ticker);
      else this.autoUpdate = options.autoUpdate ?? true;
    }

    /**
     * Whether the skeleton advances by itself with PixiJS's shared ticker (true by default). Turn
     * it off to drive it with update(seconds) from your own loop.
     */
    get autoUpdate() {
      return !!this._ticker;
    }
    set autoUpdate(on) {
      if (on && !this._ticker) this._attachTicker(Ticker.shared);
      else if (!on && this._ticker) {
        this._ticker.remove(this._tick, this);
        this._ticker = null;
      }
    }
    _attachTicker(ticker) {
      if (this._ticker) this._ticker.remove(this._tick, this);
      this._ticker = ticker;
      ticker.add(this._tick, this);
    }
    _tick(ticker) {
      this.update(ticker.deltaMS / 1000);
    }

    /** Plays `name` on `track` (0 by default), crossfading over `mix` seconds. Returns the track entry. */
    play(name, loop = true, mix = 0, track = 0) {
      this._check(name);
      return this.state.setAnimation(this.skeleton, track, name, loop, mix);
    }

    /** Queues `name` after the current animation on `track`. Returns the queued entry. */
    queue(name, loop = true, mix = 0.2, track = 0, delay = null) {
      this._check(name);
      return this.state.addAnimation(this.skeleton, track, name, loop, mix, delay);
    }

    /** Stops every track and goes back to the setup pose. */
    stop() {
      this.state.stop();
      this.pose.setToSetup(this.skeleton);
      this.update(0);
      return this;
    }

    _check(name) {
      if (!this.skeleton.animations.some((a) => a.name === name)) throw new Error(`Rigby2D: no animation '${name}' (has: ${this.animationNames.join(', ')})`);
    }

    /** Names of the skeleton's animations and skins. */
    get animationNames() {
      return this.data.animationNames;
    }
    get skinNames() {
      return this.data.skinNames;
    }

    /** This skeleton's skin (null for the default skin). Each RigbySkeleton has its own. */
    get skin() {
      return this._skin;
    }
    set skin(name) {
      if (name !== null && !this.skeleton.skins.some((s) => s.name === name)) throw new Error(`Rigby2D: no skin '${name}' (has: ${this.skinNames.join(', ')})`);
      this._skin = name;
      this._withSkin(() => {
        this.pose.setToSetup(this.skeleton);
        this.state.apply(this.skeleton, this.pose);
      });
      this._draw();
    }
    setSkin(name) {
      this.skin = name;
      return this;
    }

    /** Runs `fn` with this skeleton's skin active on the (shared) skeleton data. */
    _withSkin(fn) {
      const shared = this.skeleton.skin;
      this.skeleton.skin = this._skin;
      try {
        return fn();
      } finally {
        this.skeleton.skin = shared;
      }
    }

    /**
     * Advances the animations by `seconds` (scaled by timeScale), poses the skeleton and rebuilds
     * its meshes. Called every frame by the ticker unless autoUpdate is off.
     */
    update(seconds) {
      const dt = Math.max(0, seconds) * this.timeScale;
      this._withSkin(() => {
        this._place();
        this.state.update(this.skeleton, dt);
        this.state.apply(this.skeleton, this.pose);
      });
      this._draw();
      this._follow();
    }

    /**
     * With physicsMovement, places the skeleton where the object is in its parent (in skeleton
     * units, scaled by physicsMovement), so physics sees the object's movement; the drawing takes
     * the offset back out.
     */
    _place() {
      const k = this.physicsMovement;
      if (!(k > 0)) {
        this.pose.placement = null;
        this._placed = false;
        return;
      }
      const sx = this.scale.x || 1;
      const sy = this.scale.y || 1;
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      // The object's position, in its own unrotated, unscaled frame, then Y up.
      const x = (k * (cos * this.position.x + sin * this.position.y)) / sx;
      const y = (-k * (-sin * this.position.x + cos * this.position.y)) / sy;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this._placement.tx = x;
      this._placement.ty = y;
      this.pose.placement = this._placement;
      // The first placed update starts the simulation where the object already is, so placing a
      // new skeleton (or turning this on) doesn't fling its hair across the screen.
      if (!this._placed) this.pose.resetPhysics();
      this._placed = true;
    }

    /**
     * Restarts physics from the current pose: call it after teleporting the object, so the jump
     * isn't simulated as movement.
     */
    resetPhysics() {
      this.pose.resetPhysics();
      return this;
    }

    /** Rebuilds the meshes from the current pose. */
    _draw() {
      const ox = this.pose.placement ? this._placement.tx : 0;
      const oy = this.pose.placement ? this._placement.ty : 0;
      let count = 0;
      let current = null;
      const pieces = this._pieces;
      const shifted = ox !== 0 || oy !== 0 ? [] : null;
      this._withSkin(() =>
        drawSkeletonGeometry(this.skeleton, this.pose, this.data.lookup, (tex, blend, positions, uvs, triangles, light, dark) => {
          if (shifted) {
            shifted.length = positions.length;
            for (let k = 0; k < positions.length; k += 2) {
              shifted[k] = positions[k] - ox;
              shifted[k + 1] = positions[k + 1] - oy;
            }
            positions = shifted;
          }
          const d = dark && (dark[0] || dark[1] || dark[2]) ? dark : null;
          if (!current || !current.accepts(tex, blend, light, d)) {
            if (current) current.flush(this._view, count++);
            current = pieces[count] ??= new Piece(this);
            current.begin(tex, blend, light, d);
          }
          current.add(positions, uvs, triangles);
        }),
      );
      if (current) current.flush(this._view, count++);
      for (let k = count; k < pieces.length; k++) pieces[k].hide();
      /** How many meshes the skeleton drew with in its last update. */
      this.meshCount = count;
    }

    /**
     * Where bone `name` is, in this object's coordinates (PixiJS axes): { x, y, rotation (radians),
     * scaleX, scaleY }, or null without that bone.
     */
    boneTransform(name, out = {}) {
      const i = this.skeleton.bones.findIndex((b) => b.name === name);
      const w = i >= 0 ? this.pose.world[i] : null;
      if (!w) return null;
      const ox = this.pose.placement ? this._placement.tx : 0;
      const oy = this.pose.placement ? this._placement.ty : 0;
      out.x = w.tx - ox;
      out.y = -(w.ty - oy);
      out.rotation = Math.atan2(-w.b, w.a);
      out.scaleX = Math.hypot(w.a, w.b);
      out.scaleY = (w.a * w.d - w.b * w.c) / (out.scaleX || 1);
      return out;
    }

    /** Where bone `name` is on screen (PixiJS global coordinates): a Point, or null. */
    boneGlobal(name, out) {
      const t = this.boneTransform(name);
      return t ? this.toGlobal({ x: t.x, y: t.y }, out) : null;
    }

    /**
     * Makes `child` (any display object) follow bone `name`: it is added to this skeleton and moved
     * to the bone every update, in front of the skeleton. `{ rotate, scale }` choose whether it also
     * turns and scales with the bone (both on by default). Returns the child.
     */
    attachToBone(name, child, { rotate = true, scale = true } = {}) {
      if (!this.skeleton.bones.some((b) => b.name === name)) throw new Error(`Rigby2D: no bone '${name}'`);
      this.detachFromBone(child);
      this._followers.push({ name, child, rotate, scale, base: { x: child.scale.x, y: child.scale.y } });
      this.addChild(child);
      this._follow();
      return child;
    }

    /** Stops `child` following its bone (it stays a child of the skeleton). */
    detachFromBone(child) {
      this._followers = this._followers.filter((f) => f.child !== child);
      return child;
    }

    _follow() {
      const t = {};
      for (const f of this._followers) {
        if (!this.boneTransform(f.name, t)) continue;
        f.child.position.set(t.x, t.y);
        if (f.rotate) f.child.rotation = t.rotation;
        if (f.scale) f.child.scale.set(f.base.x * t.scaleX, f.base.y * t.scaleY);
      }
    }

    destroy(options) {
      this.autoUpdate = false;
      this.state.stop();
      this.state.listeners.length = 0;
      for (const p of this._pieces) p.destroy();
      this._pieces.length = 0;
      super.destroy(options);
    }
  }

  return { loadRigby, parseRigby, RigbySkeleton, RigbyData };
}
