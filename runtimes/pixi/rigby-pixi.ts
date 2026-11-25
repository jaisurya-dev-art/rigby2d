// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for PixiJS 8: plays Rigby2D skeletons (.skel or .json with their .atlas) as native PixiJS
// display objects. The animation is the JavaScript runtime (src/core), so skeletons move exactly as
// in the editor; the drawing is PixiJS's own: every attachment is a PixiJS Mesh that goes through
// PixiJS's batcher, on WebGL and WebGPU, so skeletons share draw calls with sprites and work with
// filters, masks, tint, alpha, blend modes, bounds and events like any other display object.
//
//   import * as PIXI from 'pixi.js';
//   import { rigbyPixi } from './rigby-pixi.ts';
//   const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI);
//   const nila = new RigbySkeleton(await loadRigby('nila.skel', 'nila.atlas'), { animation: 'idle' });
//   app.stage.addChild(nila);
//
// See runtimes/pixi/README.md.

import type { Buffer as PixiBuffer, Container as PixiContainer, DestroyOptions, Mesh as PixiMesh, MeshGeometry as PixiMeshGeometry, Point, Shader as PixiShader, Texture, Ticker as PixiTicker } from 'pixi.js';
import {
  Affine,
  AnimationState,
  atlasLookup,
  drawSkeletonGeometry,
  geometryCache,
  isSkeletonBinary,
  parseAtlas,
  Pose,
  readSkeletonBinary,
  readSkeletonJson,
  type AtlasEntry,
  type CoreBlend,
  type GeometryCache,
} from './core.ts';
import type {
  Atlas,
  AnimationState as AnimationStateType,
  BoneTransform,
  PageTextures,
  PixiNamespace,
  Pose as PoseType,
  RigbyData as RigbyDataType,
  RigbyDataConstructor,
  RigbyPixiOptions,
  RigbyPixiRuntime,
  RigbySkeletonConstructor,
  RigbySkeletonOptions,
  RigbyWasm,
  RigbyWasmExports,
  SkeletonData,
  SkeletonSource,
  TrackEntry,
  TrackSnapshot,
  WasmSource,
  AttachToBoneOptions,
} from './types.js';

export type * from './types.js';

/** Slot blend modes -> PixiJS blend modes (all four are PixiJS's own, batchable ones). */
export const BLEND_MODES = { normal: 'normal', additive: 'add', multiply: 'multiply', screen: 'screen' } as const;

/** Blend modes by the WebAssembly runtime's blend index. */
const WASM_BLENDS: readonly CoreBlend[] = ['normal', 'additive', 'multiply', 'screen'];

/** The folder part of a URL, with its trailing slash: "assets/nila.atlas" -> "assets/". */
const folderOf = (url: string): string => url.slice(0, url.lastIndexOf('/') + 1);

type Color3 = [number, number, number];
type Color4 = [number, number, number, number];
type TypedArray = Float32Array | Uint32Array;
/** What `Piece.flush` takes from the WebAssembly batch table: positions, UVs, indices and dark colors. */
type MeshViews = [Float32Array, Float32Array, Uint32Array, Float32Array | null];
/** A two-color mesh's shader, which remembers the texture it was made for. */
type DarkShader = PixiShader & { rigbyTexture: Texture };

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
class Buf<T extends TypedArray> {
  Type: new (length: number) => T;
  data: T;
  length: number;
  constructor(Type: new (length: number) => T) {
    this.Type = Type;
    this.data = new Type(64);
    this.length = 0;
  }
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    const next = new this.Type(Math.max(this.data.length * 2, this.length + n));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
}

/** A display object that follows a bone. */
interface Follower {
  name: string;
  child: PixiContainer;
  rotate: boolean;
  scale: boolean;
  base: { x: number; y: number };
}

/**
 * Creates the runtime for a PixiJS namespace (`import * as PIXI from 'pixi.js'`, or the `PIXI`
 * global of the script build). Returns { loadRigby, parseRigby, RigbySkeleton, RigbyData }.
 */
export function rigbyPixi(PIXI: PixiNamespace = (globalThis as { PIXI?: PixiNamespace }).PIXI as PixiNamespace, { wasm = null }: RigbyPixiOptions = {}): RigbyPixiRuntime {
  if (!PIXI?.Mesh || !PIXI?.MeshGeometry || !PIXI?.Container) throw new Error('Rigby2D: pass the PixiJS namespace (PixiJS 8): rigbyPixi(PIXI)');
  const { Assets, Container, DOMAdapter, Mesh, MeshGeometry, Shader, Texture, Ticker } = PIXI;

  /**
   * Loaded skeleton data, shared by every RigbySkeleton made from it: the skeleton, its atlas and a
   * PixiJS texture per atlas page.
   */
  class RigbyData implements RigbyDataType {
    /** The skeleton data (src/core model): bones, slots, skins, constraints, animations. */
    readonly skeleton: SkeletonData;
    /** The parsed atlas. */
    readonly atlas: Atlas;
    /** Atlas page name -> PixiJS Texture. */
    readonly pages: Map<string, Texture>;
    readonly lookup: (name: string) => AtlasEntry | null;
    /** Atlas UVs worked out once per attachment, and scratch arrays, shared by every skeleton made from this data. */
    readonly geometry: GeometryCache;
    /** The WebAssembly data handle (with rigbyPixi(PIXI, { wasm })). */
    wasm?: number;
    /** The page textures by atlas page index (with WebAssembly). */
    pageTextures?: Array<Texture | null>;
    constructor(skeleton: SkeletonData, atlas: Atlas, pages: Map<string, Texture>) {
      this.skeleton = skeleton;
      this.atlas = atlas;
      this.pages = pages;
      this.lookup = atlasLookup(atlas, (page) => pages.get(page.name) ?? null);
      this.geometry = geometryCache();
      if (skeleton.skins.length && skeleton.skin === undefined) skeleton.skin = null;
    }
    get animationNames(): string[] {
      return this.skeleton.animations.map((a) => a.name);
    }
    get skinNames(): string[] {
      return this.skeleton.skins.map((s) => s.name);
    }
  }

  /**
   * Builds skeleton data from what is already in memory: the skeleton (.skel bytes, JSON text or a
   * parsed JSON object), the atlas text, and the page textures (page name -> Texture, or a function).
   */
  function parseRigby(skeleton: SkeletonSource, atlasText: string, textures: PageTextures): RigbyData {
    const raw = skeleton instanceof ArrayBuffer ? new Uint8Array(skeleton) : skeleton;
    let json: unknown = skeleton;
    if (skeleton instanceof ArrayBuffer) json = new Uint8Array(skeleton);
    if (json instanceof Uint8Array) json = isSkeletonBinary(json) ? readSkeletonBinary(json) : JSON.parse(new TextDecoder().decode(json));
    else if (typeof json === 'string') json = JSON.parse(json);
    const data = readSkeletonJson(json).skeleton;
    const atlas = parseAtlas(atlasText);
    const pages = new Map<string, Texture>();
    for (const page of atlas.pages) {
      const tex = typeof textures === 'function' ? textures(page.name, page) : textures instanceof Map ? textures.get(page.name) : textures?.[page.name];
      if (tex) pages.set(page.name, tex);
    }
    const result = new RigbyData(data, atlas, pages);
    if (wasm) {
      const bytes = raw instanceof Uint8Array ? raw : new TextEncoder().encode(typeof raw === 'string' ? raw : JSON.stringify(raw));
      result.wasm = wasm.load(bytes, atlasText);
      result.pageTextures = atlas.pages.map((p) => pages.get(p.name) ?? null);
    }
    return result;
  }

  const cache = new Map<string, Promise<RigbyData>>();

  /**
   * Loads a skeleton (.skel or .json), its .atlas and the atlas pages (through PixiJS Assets, from
   * the atlas's folder). Loading the same pair again returns the same RigbyData.
   */
  function loadRigby(skeletonUrl: string, atlasUrl: string): Promise<RigbyData> {
    const key = `${skeletonUrl}\n${atlasUrl}`;
    if (!cache.has(key)) {
      const promise = (async () => {
        const fetcher = DOMAdapter?.get?.().fetch?.bind(DOMAdapter.get()) ?? globalThis.fetch;
        const get = async (url: string): Promise<Response> => {
          const res = await fetcher(url);
          if (!res.ok) throw new Error(`Rigby2D: could not load ${url} (${res.status})`);
          return res;
        };
        const [bytes, atlasText] = await Promise.all([get(skeletonUrl).then((r) => r.arrayBuffer()), get(atlasUrl).then((r) => r.text())]);
        const atlas = parseAtlas(atlasText);
        const textures = new Map<string, Texture>();
        await Promise.all(
          atlas.pages.map(async (page) => {
            const nearest = (page.filter?.[1] ?? page.filter?.[0] ?? 'Linear').toLowerCase().startsWith('nearest');
            const tex = await Assets.load<Texture>({
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
    return cache.get(key) as Promise<RigbyData>;
  }

  /** The two-color tint shader for one texture (a Mesh with its own shader draws outside the batcher). */
  let darkGl: ReturnType<typeof PIXI.compileHighShaderGlProgram> | undefined;
  let darkGpu: ReturnType<typeof PIXI.compileHighShaderGpuProgram> | undefined;
  function darkShader(texture: Texture): DarkShader {
    const shader = new Shader({
      glProgram: (darkGl ??= PIXI.compileHighShaderGlProgram({ name: 'rigby-dark-mesh', bits: [PIXI.localUniformBitGl, PIXI.textureBitGl, PIXI.roundPixelsBitGl, darkTintBitGl] })),
      gpuProgram: (darkGpu ??= PIXI.compileHighShaderGpuProgram({ name: 'rigby-dark-mesh', bits: [PIXI.localUniformBit, PIXI.textureBit, PIXI.roundPixelsBit, darkTintBit] })),
      resources: {
        uTexture: texture.source,
        uSampler: texture.source.style,
        textureUniforms: { uTextureMatrix: { type: 'mat3x3<f32>', value: texture.textureMatrix.mapCoord } },
      },
    });
    const result = shader as DarkShader;
    result.rigbyTexture = texture;
    return result;
  }

  /**
   * One run of the draw list: a Mesh fed with the triangles of consecutive attachments that share a
   * texture, blend mode, light color and dark color.
   */
  class Piece {
    owner: { roundPixels: boolean };
    positions = new Buf(Float32Array);
    uvs = new Buf(Float32Array);
    indices = new Buf(Uint32Array);
    darks: Buf<Float32Array> | null = null;
    mesh: PixiMesh | null = null;
    darkMesh: PixiMesh | null = null;
    tex!: Texture;
    blend!: CoreBlend;
    light: Color4 | undefined;
    dark: Color3 | null = null;
    private _dark: Color3 | undefined;
    constructor(owner: { roundPixels: boolean }) {
      this.owner = owner;
    }
    begin(tex: Texture, blend: CoreBlend, light: ArrayLike<number>, dark: ArrayLike<number> | null): void {
      this.tex = tex;
      this.blend = blend;
      // Copies: the drawing walk reuses its color arrays.
      const l: Color4 = (this.light ??= [0, 0, 0, 0]);
      l[0] = light[0];
      l[1] = light[1];
      l[2] = light[2];
      l[3] = light[3];
      if (dark) {
        const d: Color3 = (this._dark ??= [0, 0, 0]);
        d[0] = dark[0];
        d[1] = dark[1];
        d[2] = dark[2];
        this.dark = d;
      } else this.dark = null;
      this.positions.length = this.uvs.length = this.indices.length = 0;
      if (this.darks) this.darks.length = 0;
    }
    accepts(tex: Texture, blend: CoreBlend, light: ArrayLike<number>, dark: ArrayLike<number> | null): boolean {
      const l = this.light as Color4;
      if (tex !== this.tex || blend !== this.blend || l[0] !== light[0] || l[1] !== light[1] || l[2] !== light[2] || l[3] !== light[3]) return false;
      const d = this.dark;
      return !d === !dark && (!d || (!!dark && d[0] === dark[0] && d[1] === dark[1] && d[2] === dark[2]));
    }
    add(positions: ArrayLike<number>, uvs: ArrayLike<number>, triangles: ArrayLike<number>): void {
      const n = positions.length / 2;
      const base = this.positions.length / 2;
      this.positions.reserve(positions.length);
      this.uvs.reserve(uvs.length);
      this.indices.reserve(triangles.length);
      const p = this.positions.data;
      const t = this.uvs.data;
      const ix = this.indices.data;
      let o = this.positions.length;
      // Skeleton space is Y up: the mesh container is flipped (scale.y = -1), so vertices copy as they are.
      for (let k = 0, m = n * 2; k < m; k++) {
        p[o + k] = positions[k];
        t[o + k] = uvs[k];
      }
      o += n * 2;
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
    flush(container: PixiContainer, index: number, views: MeshViews | null = null): number {
      const dark = !!this.dark;
      let mesh: PixiMesh | null = dark ? this.darkMesh : this.mesh;
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
          mesh.shader = darkShader(this.tex) as unknown as NonNullable<PixiMesh['shader']>;
        } else this.mesh = mesh;
        container.addChildAt(mesh, Math.min(index, container.children.length));
      }
      const other = dark ? this.mesh : this.darkMesh;
      if (other) other.visible = false;
      mesh.visible = true;
      if (container.getChildIndex(mesh) !== index) container.setChildIndex(mesh, Math.min(index, container.children.length - 1));
      const g = mesh.geometry;
      if (views) {
        setView(g.getBuffer('aPosition'), views[0]);
        setView(g.getBuffer('aUV'), views[1]);
        setView(g.getIndex(), views[2]);
        if (dark) setView(g.getBuffer('aDark'), views[3] as Float32Array);
      } else {
        setBuffer(g.getBuffer('aPosition'), this.positions);
        setBuffer(g.getBuffer('aUV'), this.uvs);
        setBuffer(g.getIndex(), this.indices);
        if (dark) setBuffer(g.getBuffer('aDark'), this.darks as Buf<Float32Array>);
      }
      if (mesh.texture !== this.tex) {
        mesh.texture = this.tex;
        if (dark) {
          const resources = (mesh.shader as unknown as PixiShader).resources;
          resources.uTexture = this.tex.source;
          resources.uSampler = this.tex.source.style;
          resources.textureUniforms.uniforms.uTextureMatrix = this.tex.textureMatrix.mapCoord;
        }
      }
      const [r, gr, b, a] = this.light as Color4;
      mesh.tint = ((clamp255(r) << 16) | (clamp255(gr) << 8) | clamp255(b)) >>> 0;
      mesh.alpha = Math.max(0, Math.min(1, a));
      mesh.blendMode = BLEND_MODES[this.blend] ?? 'normal';
      mesh.roundPixels = this.owner.roundPixels;
      return 1;
    }
    hide(): void {
      if (this.mesh) this.mesh.visible = false;
      if (this.darkMesh) this.darkMesh.visible = false;
    }
    destroy(): void {
      this.darkMesh?.shader?.destroy();
      this.mesh?.destroy();
      this.darkMesh?.destroy();
    }
  }

  const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

  /** Puts `buf`'s live part into a PixiJS buffer, reusing its storage while it is big enough. */
  function setBuffer(buffer: PixiBuffer, buf: Buf<Float32Array | Uint32Array>): void {
    setView(buffer, buf.data.subarray(0, buf.length));
  }
  function setView(buffer: PixiBuffer, view: TypedArray): void {
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
    /** The loaded data this skeleton was made from (from loadRigby or parseRigby). */
    data: RigbyData;
    skeleton: SkeletonData;
    pose: PoseType;
    state: AnimationStateType;
    timeScale: number;
    physicsMovement: number;
    roundPixels: boolean;
    /** How many meshes the skeleton drew with in its last update. */
    meshCount = 0;
    private _skin: string | null;
    private _pieces: Piece[] = [];
    private _followers: Follower[] = [];
    private _placement = new Affine();
    private _placed = false;
    private _view: PixiContainer;
    private _w: number;
    private _ticker: PixiTicker | null = null;
    private _wl: Color4 | undefined;
    private _wd: Color3 | undefined;

    constructor(data: RigbyDataType, options: RigbySkeletonOptions = {}) {
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
      // Skeleton space is Y up and PixiJS's Y down: the meshes live in a flipped container.
      this._view = new Container({ label: 'rigby-meshes' });
      this._view.scale.y = -1;
      this.addChild(this._view);
      /** The WebAssembly instance that poses this skeleton (with rigbyPixi(PIXI, { wasm })). */
      this._w = data.wasm && wasm ? wasm.create(data.wasm) : 0;
      this.state.addListener({
        start: (entry) => this.emit('start', entry),
        end: (entry) => this.emit('end', entry),
        complete: (entry) => this.emit('complete', entry),
        event: (entry, event) => this.emit('event', entry, event),
      });
      if (this._skin !== null) this.skin = this._skin;
      if (options.animation) this.play(options.animation, options.loop ?? true);
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
    get autoUpdate(): boolean {
      return !!this._ticker;
    }
    set autoUpdate(on: boolean) {
      if (on && !this._ticker) this._attachTicker(Ticker.shared);
      else if (!on && this._ticker) {
        this._ticker.remove(this._tick, this);
        this._ticker = null;
      }
    }
    private _attachTicker(ticker: PixiTicker): void {
      if (this._ticker) this._ticker.remove(this._tick, this);
      this._ticker = ticker;
      ticker.add(this._tick, this);
    }
    private _tick(ticker: PixiTicker): void {
      this.update(ticker.deltaMS / 1000);
    }

    /** Plays `name` on `track` (0 by default), crossfading over `mix` seconds. Returns the track entry. */
    play(name: string, loop = true, mix = 0, track = 0): TrackEntry | null | undefined {
      this._check(name);
      if (this._w) return void wasm!.setAnimation(this._w, track, name, loop, mix);
      return this.state.setAnimation(this.skeleton, track, name, loop, mix);
    }

    /** Queues `name` after the current animation on `track`. Returns the queued entry. */
    queue(name: string, loop = true, mix = 0.2, track = 0, delay: number | null = null): TrackEntry | null | undefined {
      this._check(name);
      if (this._w) return void wasm!.addAnimation(this._w, track, name, loop, mix, delay);
      return this.state.addAnimation(this.skeleton, track, name, loop, mix, delay);
    }

    /** Stops every track and goes back to the setup pose. */
    stop(): this {
      if (this._w) wasm!.stop(this._w);
      this.state.stop();
      this.pose.setToSetup(this.skeleton);
      this.update(0);
      return this;
    }

    private _check(name: string): void {
      if (!this.skeleton.animations.some((a) => a.name === name)) throw new Error(`Rigby2D: no animation '${name}' (has: ${this.animationNames.join(', ')})`);
    }

    /** Names of the skeleton's animations and skins. */
    get animationNames(): string[] {
      return this.data.animationNames;
    }
    get skinNames(): string[] {
      return this.data.skinNames;
    }
    get boneNames(): string[] {
      return this.skeleton.bones.map((b) => b.name);
    }
    hasAnimation(name: string): boolean {
      return this.skeleton.animations.some((a) => a.name === name);
    }
    hasSkin(name: string): boolean {
      return this.skeleton.skins.some((s) => s.name === name);
    }
    /** Throws with the WebAssembly core, whose tracks live in WebAssembly and can't be read from here. */
    private _jsTracks(what: string): void {
      if (this._w) throw new Error(`Rigby2D: ${what} needs the JavaScript core (not available with WebAssembly)`);
    }
    /** Whether animation `name` is playing (on `track`, or on any track), or anything at all without a name. */
    isPlaying(name?: string, track?: number): boolean {
      this._jsTracks('isPlaying()');
      return this.state.tracks.some((e) => e && (track === undefined || e.track === track) && (name === undefined || e.name === name));
    }
    /** What every track is playing now, as plain values (for save files). Not with WebAssembly. */
    snapshotTracks(): TrackSnapshot[] {
      this._jsTracks('snapshotTracks()');
      const out: TrackSnapshot[] = [];
      for (const e of this.state.tracks) {
        if (!e) continue;
        out.push({
          track: e.track,
          name: e.name,
          looping: e.looping,
          time: e.time,
          mixDuration: e.mixDuration,
          alpha: e.alpha,
          timeScale: e.timeScale,
          queue: e.queue.map((q) => ({ name: q.name, looping: q.looping, mixDuration: q.mixDuration, delay: q.delay })),
        });
      }
      return out;
    }
    /**
     * Replaces what is playing with `snapshots`: each animation resumes at its time, with its queue.
     * A crossfade that was under way when the snapshot was taken is restored as finished.
     */
    restoreTracks(snapshots: readonly TrackSnapshot[]): this {
      this._jsTracks('restoreTracks()');
      this.state.tracks.forEach((_, i) => this.state.clearTrack(i));
      for (const s of snapshots) {
        if (!this.hasAnimation(s.name)) continue;
        const entry = this.play(s.name, s.looping, 0, s.track);
        if (entry) {
          entry.time = s.time;
          entry.mixDuration = s.mixDuration;
          entry.mixTime = s.mixDuration;
          entry.alpha = s.alpha;
          entry.timeScale = s.timeScale;
        }
        for (const q of s.queue) if (this.hasAnimation(q.name)) this.queue(q.name, q.looping, q.mixDuration, s.track, q.delay);
      }
      this.update(0);
      return this;
    }
    /** Length in seconds of animation `name`, or null without that animation. */
    animationDuration(name: string): number | null {
      return this.skeleton.animations.find((a) => a.name === name)?.duration ?? null;
    }

    /** This skeleton's skin (null for the default skin). Each RigbySkeleton has its own. */
    get skin(): string | null {
      return this._skin;
    }
    set skin(name: string | null) {
      if (name !== null && !this.skeleton.skins.some((s) => s.name === name)) throw new Error(`Rigby2D: no skin '${name}' (has: ${this.skinNames.join(', ')})`);
      this._skin = name;
      if (this._w) {
        wasm!.setSkin(this._w, name);
        this.update(0);
        return;
      }
      this._withSkin(() => {
        this.pose.setToSetup(this.skeleton);
        this.state.apply(this.skeleton, this.pose);
      });
      this._draw();
    }
    setSkin(name: string | null): this {
      this.skin = name;
      return this;
    }

    /** Runs `fn` with this skeleton's skin active on the (shared) skeleton data. */
    private _withSkin<R>(fn: () => R): R {
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
    update(seconds: number): void {
      const dt = Math.max(0, seconds) * this.timeScale;
      if (this._w) {
        this._drawWasm(wasm!.update(this._w, dt));
        this._follow();
        return;
      }
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
    private _place(): void {
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
    resetPhysics(): this {
      this.pose.resetPhysics();
      return this;
    }

    /** Rebuilds the meshes from the current pose. */
    private _draw(): void {
      const ox = this.pose.placement ? this._placement.tx : 0;
      const oy = this.pose.placement ? this._placement.ty : 0;
      let count = 0;
      let current: Piece | null = null;
      const pieces = this._pieces;
      const shifted: number[] | null = ox !== 0 || oy !== 0 ? [] : null;
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
        }, { cache: this.data.geometry }),
      );
      if (current) (current as Piece).flush(this._view, count++);
      for (let k = count; k < pieces.length; k++) pieces[k].hide();
      /** How many meshes the skeleton drew with in its last update. */
      this.meshCount = count;
    }

    /** Rebuilds the meshes from the WebAssembly runtime's batch table (one mesh per batch). */
    private _drawWasm(table: number): void {
      const { u32, f32 } = wasm!.views();
      const pages = this.data.pageTextures as Array<Texture | null>;
      const pieces = this._pieces;
      const n = u32[table];
      let count = 0;
      const light = (this._wl ??= [0, 0, 0, 0]);
      const dark = (this._wd ??= [0, 0, 0]);
      for (let b = 0, o = table + 1; b < n; b++, o += 15) {
        const tex = pages[u32[o]];
        if (!tex) continue;
        const vc = u32[o + 4];
        const pos = f32.subarray(u32[o + 2] >> 2, (u32[o + 2] >> 2) + vc * 2);
        const uv = f32.subarray(u32[o + 3] >> 2, (u32[o + 3] >> 2) + vc * 2);
        const idx = u32.subarray(u32[o + 5] >> 2, (u32[o + 5] >> 2) + u32[o + 6]);
        light[0] = f32[o + 7];
        light[1] = f32[o + 8];
        light[2] = f32[o + 9];
        light[3] = f32[o + 10];
        dark[0] = f32[o + 11];
        dark[1] = f32[o + 12];
        dark[2] = f32[o + 13];
        const hasDark = f32[o + 14] === 1 && (dark[0] || dark[1] || dark[2]);
        const piece = (pieces[count] ??= new Piece(this));
        piece.begin(tex, WASM_BLENDS[u32[o + 1]], light, hasDark ? dark : null);
        let darks: Float32Array | null = null;
        if (hasDark) {
          piece.darks ??= new Buf(Float32Array);
          piece.darks.reserve(vc * 3);
          darks = piece.darks.data.subarray(0, vc * 3);
          for (let k = 0; k < vc * 3; k += 3) darks.set(dark, k);
        }
        piece.flush(this._view, count++, [pos, uv, idx, darks]);
      }
      for (let k = count; k < pieces.length; k++) pieces[k].hide();
      this.meshCount = count;
    }

    /**
     * Where bone `name` is, in this object's coordinates (PixiJS axes): { x, y, rotation (radians),
     * scaleX, scaleY }, or null without that bone.
     */
    boneTransform(name: string, out: Partial<BoneTransform> = {}): BoneTransform | null {
      const i = this.skeleton.bones.findIndex((b) => b.name === name);
      const w = i >= 0 ? (this._w ? wasm!.boneWorld(this._w, i) : this.pose.world[i]) : null;
      if (!w) return null;
      const ox = this.pose.placement ? this._placement.tx : 0;
      const oy = this.pose.placement ? this._placement.ty : 0;
      out.x = w.tx - ox;
      out.y = -(w.ty - oy);
      out.rotation = Math.atan2(-w.b, w.a);
      out.scaleX = Math.hypot(w.a, w.b);
      out.scaleY = (w.a * w.d - w.b * w.c) / (out.scaleX || 1);
      return out as BoneTransform;
    }

    /** Where bone `name` is on screen (PixiJS global coordinates): a Point, or null. */
    boneGlobal(name: string, out?: Point): Point | null {
      const t = this.boneTransform(name);
      return t ? this.toGlobal({ x: t.x, y: t.y }, out) : null;
    }

    /**
     * Makes `child` (any display object) follow bone `name`: it is added to this skeleton and moved
     * to the bone every update, in front of the skeleton. `{ rotate, scale }` choose whether it also
     * turns and scales with the bone (both on by default). Returns the child.
     */
    attachToBone<T extends PixiContainer>(name: string, child: T, { rotate = true, scale = true }: AttachToBoneOptions = {}): T {
      if (!this.skeleton.bones.some((b) => b.name === name)) throw new Error(`Rigby2D: no bone '${name}'`);
      this.detachFromBone(child);
      this._followers.push({ name, child, rotate, scale, base: { x: child.scale.x, y: child.scale.y } });
      this.addChild(child);
      this._follow();
      return child;
    }

    /** Stops `child` following its bone (it stays a child of the skeleton). */
    detachFromBone<T extends PixiContainer>(child: T): T {
      this._followers = this._followers.filter((f) => f.child !== child);
      return child;
    }

    private _follow(): void {
      const t: Partial<BoneTransform> = {};
      for (const f of this._followers) {
        if (!this.boneTransform(f.name, t)) continue;
        f.child.position.set(t.x, t.y);
        if (f.rotate) f.child.rotation = t.rotation as number;
        if (f.scale) f.child.scale.set(f.base.x * (t.scaleX as number), f.base.y * (t.scaleY as number));
      }
    }

    override destroy(options?: DestroyOptions): void {
      this.autoUpdate = false;
      this.state.stop();
      this.state.listeners.length = 0;
      if (this._w) wasm!.free(this._w);
      this._w = 0;
      for (const p of this._pieces) p.destroy();
      this._pieces.length = 0;
      super.destroy(options);
    }
  }

  const runtime: RigbyPixiRuntime = { loadRigby, parseRigby, RigbySkeleton, RigbyData: RigbyData as RigbyDataConstructor };
  return runtime;
}

/**
 * Loads the WebAssembly build of the Rust runtime (runtimes/rust/rigby-wasm) for
 * rigbyPixi(PIXI, { wasm }): posing and geometry then run in WebAssembly. `source` is a URL, a
 * Response, bytes or a WebAssembly.Module.
 */
export async function loadRigbyWasm(source: WasmSource): Promise<RigbyWasm> {
  let module: WebAssembly.Module;
  if (source instanceof WebAssembly.Module) module = source;
  else {
    const bytes = typeof source === 'string' || source instanceof URL ? await (await fetch(source)).arrayBuffer() : source instanceof Response ? await source.arrayBuffer() : source;
    module = await WebAssembly.compile(bytes as BufferSource);
  }
  const x = (await WebAssembly.instantiate(module, {})).exports as unknown as RigbyWasmExports;
  const enc = new TextEncoder();
  let u32: Uint32Array | null = null;
  let f32: Float32Array | null = null;
  let f64: Float64Array | null = null;
  const views = (): { u32: Uint32Array; f32: Float32Array; f64: Float64Array } => {
    if (!u32 || !f32 || !f64 || u32.buffer !== x.memory.buffer) {
      u32 = new Uint32Array(x.memory.buffer);
      f32 = new Float32Array(x.memory.buffer);
      f64 = new Float64Array(x.memory.buffer);
    }
    return { u32, f32, f64 };
  };
  const withBytes = <R>(bytes: Uint8Array, fn: (pointer: number, length: number) => R): R => {
    const p = x.alloc(bytes.length);
    new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
    try {
      return fn(p, bytes.length);
    } finally {
      x.dealloc(p, bytes.length);
    }
  };
  const withString = <R>(s: string | null | undefined, fn: (pointer: number, length: number) => R): R => withBytes(enc.encode(s ?? ''), fn);
  return {
    exports: x,
    views,
    load(skel: Uint8Array, atlasText: string): number {
      const d = withBytes(skel, (sp, sl) => withString(atlasText, (ap, al) => x.data_load(sp, sl, ap, al)));
      if (!d) throw new Error(`Rigby2D: ${new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.error_ptr(), x.error_len()))}`);
      return d;
    },
    create: (d: number) => x.inst_new(d),
    free: (h: number) => x.inst_free(h),
    setAnimation: (h: number, track: number, name: string, loop: boolean, mix: number) => withString(name, (p, l) => x.inst_set_animation(h, track, p, l, loop ? 1 : 0, mix)),
    addAnimation: (h: number, track: number, name: string, loop: boolean, mix: number, delay: number | null) => withString(name, (p, l) => x.inst_add_animation(h, track, p, l, loop ? 1 : 0, mix, delay ?? NaN)),
    stop: (h: number) => x.inst_stop(h),
    setSkin: (h: number, name: string | null) => withString(name, (p, l) => x.inst_set_skin(h, p, l)),
    /** Advances, poses and builds geometry; returns the batch table's index in the u32 view. */
    update: (h: number, dt: number) => x.inst_update(h, dt) >> 2,
    boneWorld(h: number, i: number) {
      const p = x.inst_bone_world(h, i);
      if (!p) return null;
      const v = views().f64;
      const o = p >> 3;
      return { a: v[o], b: v[o + 1], c: v[o + 2], d: v[o + 3], tx: v[o + 4], ty: v[o + 5] };
    },
  };
}
