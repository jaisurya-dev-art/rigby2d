// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for Phaser 3 (3.60 or newer, WebGL renderer): plays Rigby2D skeletons (.skel or .json
// with their .atlas) as Phaser game objects, with the JavaScript runtime (src/core) and the
// reference WebGL renderer (src/webgl), so they move exactly as in the editor.
//
//   import { rigbyPhaser } from './rigby-phaser.js';
//   const { RigbyPlugin } = rigbyPhaser(Phaser);
//   new Phaser.Game({ type: Phaser.WEBGL, plugins: { scene: [{ key: 'RigbyPlugin', plugin: RigbyPlugin, mapping: 'rigby' }] }, scene: { preload, create } });
//   function preload() { this.load.rigby('nila', 'nila.skel', 'nila.atlas'); }
//   function create() { this.add.rigby(400, 550, 'nila', 'idle'); }
//
// See runtimes/phaser/README.md.

import { parseAtlas } from '../../src/core/atlas.js';
import { isSkeletonBinary, readSkeletonBinary } from '../../src/core/binary.js';
import { readSkeletonJson } from '../../src/core/interop.js';
import { Pose } from '../../src/core/pose.js';
import { AnimationState } from '../../src/core/state.js';
import { WebGLRenderer } from '../../src/webgl/renderer.js';

const CACHE = 'rigby2d';
const decoder = new TextDecoder();

/** The skeleton data loaded under `key`: { skeleton, atlas, pages: Map<page name, texture key> }. */
function cached(scene, key) {
  const data = scene.cache.custom[CACHE]?.get(key);
  if (!data) throw new Error(`Rigby2D: nothing loaded as '${key}' (this.load.rigby('${key}', skeletonUrl, atlasUrl) in preload)`);
  return data;
}

/** The folder part of a URL, with its trailing slash: "assets/nila.atlas" -> "assets/". */
const folderOf = (url) => url.slice(0, url.lastIndexOf('/') + 1);

/**
 * Creates the plugin and game object classes for a Phaser namespace (the `Phaser` global, or the
 * `phaser` module's default export). Returns { RigbyPlugin, RigbySkeleton }.
 */
export function rigbyPhaser(Phaser = globalThis.Phaser) {
  if (!Phaser?.GameObjects?.Extern) throw new Error('Rigby2D: pass the Phaser namespace (Phaser 3.60 or newer)');

  /**
   * A playing skeleton. `state` is its AnimationState (tracks, crossfades, queues), `skeleton` the
   * skeleton data and `pose` the current pose. Emits 'start', 'end', 'complete' (entry) and 'event'
   * (entry, event) as its animations play.
   */
  class RigbySkeleton extends Phaser.GameObjects.Extern {
    constructor(scene, x, y, key, animation, loop = true) {
      super(scene);
      const data = cached(scene, key);
      this.type = 'RigbySkeleton';
      this.key = key;
      this.skeleton = data.skeleton;
      this.data_ = data;
      this.pose = new Pose(this.skeleton);
      this.state = new AnimationState();
      /** Speed multiplier for this skeleton's animations (1 = real time). */
      this.timeScale = 1;
      this.setPosition(x, y);
      this.state.addListener({
        start: (entry) => this.emit('start', entry),
        end: (entry) => this.emit('end', entry),
        complete: (entry) => this.emit('complete', entry),
        event: (entry, event) => this.emit('event', entry, event),
      });
      if (this.skeleton.skins.length && this.skeleton.skin === undefined) this.skeleton.skin = null;
      if (animation) this.play(animation, loop);
      this.pose.setToSetup(this.skeleton);
      this.pose.updateWorld?.(this.skeleton);
      this.updateSize();
    }

    /** Plays `name` on track 0, crossfading over `mix` seconds. Returns the track entry. */
    play(name, loop = true, mix = 0) {
      if (!this.skeleton.animations.some((a) => a.name === name)) throw new Error(`Rigby2D: '${this.key}' has no animation '${name}'`);
      this.state.setAnimation(this.skeleton, 0, name, loop, mix);
      return this.state.tracks[0];
    }

    /** Queues `name` after the current animation on `track`. */
    queue(name, loop = true, mix = 0.2, track = 0, delay = null) {
      return this.state.addAnimation(this.skeleton, track, name, loop, mix, delay);
    }

    /** Names of the skeleton's animations and skins. */
    get animationNames() {
      return this.skeleton.animations.map((a) => a.name);
    }
    get skinNames() {
      return this.skeleton.skins.map((s) => s.name);
    }

    /** The active skin's name (null for the default skin). */
    get skin() {
      return this.skeleton.skin ?? null;
    }
    set skin(name) {
      if (name !== null && !this.skeleton.skins.some((s) => s.name === name)) throw new Error(`Rigby2D: '${this.key}' has no skin '${name}'`);
      this.skeleton.skin = name;
    }
    setSkin(name) {
      this.skin = name;
      return this;
    }

    /**
     * Where bone `name` is in the scene (Phaser coordinates), for attaching sprites, particles or
     * hit boxes: { x, y, rotation (radians, Phaser's direction) }, or null without that bone.
     */
    boneWorld(name) {
      const i = this.skeleton.bones.findIndex((b) => b.name === name);
      const w = i >= 0 ? this.pose.world[i] : null;
      if (!w) return null;
      const [bx, by] = w.apply([0, 0]);
      const [tx, ty] = w.apply([1, 0]);
      const m = this.getWorldTransformMatrix();
      const sx = this.flipX ? -1 : 1;
      const sy = this.flipY ? -1 : 1;
      const p = m.transformPoint(bx * sx, -by * sy, { x: 0, y: 0 });
      const q = m.transformPoint(tx * sx, -ty * sy, { x: 0, y: 0 });
      return { x: p.x, y: p.y, rotation: Math.atan2(q.y - p.y, q.x - p.x) };
    }

    /** Sets the object's size to the setup pose's bounds (for input hit areas and bounds). */
    updateSize() {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const q of this.pose.quads?.(this.skeleton) ?? []) {
        for (const [x, y] of q.positions) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, -y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, -y);
        }
      }
      if (!Number.isFinite(x0)) return this;
      // The skeleton's origin stays at the object's position; the display origin only places the
      // size box (input hit area, getBounds) over the drawn skeleton.
      this.setSize(x1 - x0, y1 - y0);
      this.setDisplayOrigin(-x0, -y0);
      /** The setup pose's bounds relative to the skeleton origin, in Phaser coordinates. */
      this.localBounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      return this;
    }

    preUpdate(time, delta) {
      const dt = (delta / 1000) * this.timeScale;
      this.state.update(this.skeleton, dt);
      this.state.apply(this.skeleton, this.pose);
    }

    render(renderer, camera, calc) {
      const gl = renderer.gl;
      const draw = (renderer.rigby2d ??= new WebGLRenderer(gl));
      const saved = saveGL(gl, draw.attributes);
      const textures = (this.data_.textures ??= makeTextures(draw, this.data_, this.scene));
      // Skeleton space (Y up) -> object space (Y down, flips) -> screen (Phaser's matrix) -> clip.
      const W = renderer.width;
      const H = renderer.height;
      const fx = this.flipX ? -1 : 1;
      const fy = this.flipY ? -1 : 1;
      const { a, b, c, d, e, f } = calc;
      const ax = a * fx;
      const bx = b * fx;
      const cy = -c * fy;
      const dy = -d * fy;
      draw.beginMatrix([(2 * ax) / W, (-2 * bx) / H, 0, (2 * cy) / W, (-2 * dy) / H, 0, (2 * e) / W - 1, 1 - (2 * f) / H, 1]);
      draw.drawSkeleton(this.skeleton, this.pose, textures, { tint: [1, 1, 1, this.alpha * camera.alpha] });
      draw.end();
      // Put back exactly what Phaser had bound (it caches its program and buffers), then its blend mode.
      restoreGL(gl, saved);
      renderer.setBlendMode(Phaser.BlendModes.NORMAL, true);
    }

    preDestroy() {
      this.state.stop();
      this.state.listeners.length = 0;
    }
  }

  /** The WebGL bindings drawing a skeleton changes: program, buffers, texture unit 0, vertex attributes. */
  function saveGL(gl, locations) {
    const p = (name) => gl.getParameter(gl[name]);
    const active = p('ACTIVE_TEXTURE');
    gl.activeTexture(gl.TEXTURE0);
    const state = {
      program: p('CURRENT_PROGRAM'),
      arrayBuffer: p('ARRAY_BUFFER_BINDING'),
      elementBuffer: p('ELEMENT_ARRAY_BUFFER_BINDING'),
      active,
      texture: p('TEXTURE_BINDING_2D'),
      blend: gl.isEnabled(gl.BLEND),
      attributes: locations
        .filter((loc) => loc >= 0)
        .map((loc) => ({
          loc,
          enabled: gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
          buffer: gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
          size: gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_SIZE),
          type: gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_TYPE),
          normalized: gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
          stride: gl.getVertexAttrib(loc, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
          offset: gl.getVertexAttribOffset(loc, gl.VERTEX_ATTRIB_ARRAY_POINTER),
        })),
    };
    return state;
  }

  function restoreGL(gl, s) {
    for (const a of s.attributes) {
      if (a.buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
        gl.vertexAttribPointer(a.loc, a.size, a.type, a.normalized, a.stride, a.offset);
      }
      if (a.enabled) gl.enableVertexAttribArray(a.loc);
      else gl.disableVertexAttribArray(a.loc);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, s.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.elementBuffer);
    gl.useProgram(s.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.texture);
    gl.activeTexture(s.active);
    if (!s.blend) gl.disable(gl.BLEND);
  }

  /** GL textures for a loaded skeleton's atlas pages, made the first time it draws. */
  function makeTextures(draw, data, scene) {
    const pages = new Map();
    for (const [page, textureKey] of data.pages) {
      const texture = scene.textures.get(textureKey);
      const image = texture?.getSourceImage?.();
      if (image && texture.key !== '__MISSING') pages.set(page, image);
    }
    return draw.atlasTextures(data.atlas, pages);
  }

  /**
   * Scene plugin: adds `this.load.rigby(key, skeletonUrl, atlasUrl)` and
   * `this.add.rigby(x, y, key, animation, loop)`. The atlas pages load from the atlas's folder.
   */
  class RigbyPlugin extends Phaser.Plugins.ScenePlugin {
    constructor(scene, pluginManager, pluginKey) {
      super(scene, pluginManager, pluginKey);
      pluginManager.registerFileType('rigby', loadRigby, scene);
      pluginManager.registerGameObject('rigby', function (x, y, key, animation, loop) {
        const obj = new RigbySkeleton(this.scene, x, y, key, animation, loop);
        this.displayList.add(obj);
        this.updateList.add(obj);
        return obj;
      });
    }

    boot() {
      if (!this.game.cache.custom[CACHE]) this.game.cache.addCustom(CACHE);
    }

    /** Skeleton data loaded under `key` (shared by every RigbySkeleton made from it). */
    get(key) {
      return cached(this.scene, key);
    }
  }

  /** this.load.rigby(key, skeletonUrl, atlasUrl): loads the skeleton, its atlas and the atlas pages. */
  function loadRigby(key, skeletonUrl, atlasUrl) {
    const loader = this;
    const skelKey = `${CACHE}:${key}:skeleton`;
    const atlasKey = `${CACHE}:${key}:atlas`;
    let bytes = null;
    let atlasText = null;
    const finish = () => {
      if (bytes === null || atlasText === null) return;
      const atlas = parseAtlas(atlasText);
      const data = isSkeletonBinary(bytes) ? readSkeletonBinary(bytes) : JSON.parse(decoder.decode(bytes));
      const skeleton = readSkeletonJson(data, skeletonUrl).skeleton;
      const pages = new Map();
      for (const page of atlas.pages) {
        const pageKey = `${CACHE}:${key}:page:${page.name}`;
        pages.set(page.name, pageKey);
        if (!loader.scene.textures.exists(pageKey)) loader.image(pageKey, folderOf(atlasUrl) + page.name);
      }
      if (!loader.cacheManager.custom[CACHE]) loader.cacheManager.addCustom(CACHE);
      loader.cacheManager.custom[CACHE].add(key, { skeleton, atlas, pages, textures: null });
      loader.cacheManager.binary.remove(skelKey);
      loader.cacheManager.text.remove(atlasKey);
    };
    loader.once(`filecomplete-binary-${skelKey}`, (_k, _t, data) => {
      bytes = new Uint8Array(data);
      finish();
    });
    loader.once(`filecomplete-text-${atlasKey}`, (_k, _t, data) => {
      atlasText = data;
      finish();
    });
    loader.binary(skelKey, skeletonUrl);
    loader.text(atlasKey, atlasUrl);
    return loader;
  }

  return { RigbyPlugin, RigbySkeleton };
}
