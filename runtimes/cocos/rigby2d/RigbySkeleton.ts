// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for Cocos Creator 3.8: plays Rigby2D skeletons (.json or .skel with their .atlas) with the
// Rigby2D JavaScript runtime, so they move exactly as in the editor: meshes and weights, IK, physics,
// clipping, two-color tint, every blend mode, skins, events, layered tracks with crossfades.
//
// Add RigbySkeleton to a node and give it the skeleton: either the skeleton asset Cocos makes when it
// imports a .json + .atlas pair (Skeleton Data), or the raw assets (JSON or .skel, atlas, textures).
// It is a 2D renderer: put it under a Canvas, where it draws in order with sprites and UI, takes the
// node's color and opacity, and works in 2D-only projects (no 3D engine module needed).
//
//   const rigby = this.getComponent(RigbySkeleton);
//   rigby.setAnimation(0, 'run', true, 0.2);
//   rigby.addAnimation(0, 'idle', true, 0.3);
//   rigby.node.on(RigbySkeleton.EVENT, (e: RigbyEvent) => console.log(e.name, e.time));
//
// See README.md.

import {
  _decorator,
  assetManager,
  BufferAsset,
  CCFloat,
  CCString,
  director,
  EffectAsset,
  gfx,
  JsonAsset,
  Material,
  renderer,
  RenderingSubMesh,
  TextAsset,
  Texture2D,
  UIRenderer,
  Vec2,
} from 'cc';
import { EDITOR } from 'cc/env';
// The Rigby2D runtime (src/core), bundled into one module by runtimes/cocos/build.mjs.
import { AnimationState, atlasLookup, drawSkeletonGeometry, isSkeletonBinary, parseAtlas, Pose, readSkeletonBinary, readSkeletonJson } from './rigby2d-core';

const { ccclass, property, executeInEditMode, menu, help, disallowMultiple } = _decorator;

/** The rigby2d.effect shipped next to this file: its uuid is fixed in rigby2d.effect.meta. */
export const RIGBY_EFFECT_UUID = '7a0b6c3e-2f1d-4c84-9a3e-5b2d8f4e1c60';

/** An animation event, as RigbySkeleton.EVENT gives it to listeners. */
export interface RigbyEvent {
  name: string;
  time: number;
  int: number;
  float: number;
  string: string;
  /** The animation that fired it, and its track. */
  animation: string;
  track: number;
}

/** Blend states for premultiplied output, by slot blend mode. */
const BLEND_FACTORS: Record<string, [gfx.BlendFactor, gfx.BlendFactor]> = {
  normal: [gfx.BlendFactor.ONE, gfx.BlendFactor.ONE_MINUS_SRC_ALPHA],
  additive: [gfx.BlendFactor.ONE, gfx.BlendFactor.ONE],
  multiply: [gfx.BlendFactor.DST_COLOR, gfx.BlendFactor.ONE_MINUS_SRC_ALPHA],
  screen: [gfx.BlendFactor.ONE, gfx.BlendFactor.ONE_MINUS_SRC_COLOR],
};

/** One draw: a texture and blend mode, and how many vertices and indices it has this frame. */
interface Batch {
  texture: Texture2D;
  pma: boolean;
  blend: string;
  vertices: number;
  indices: number;
}

/** Vertex layout: position, page UV, light color and dark color (two-color tint). */
const ATTRIBUTES = [
  new gfx.Attribute('a_position', gfx.Format.RGB32F),
  new gfx.Attribute('a_texCoord', gfx.Format.RG32F),
  new gfx.Attribute('a_color', gfx.Format.RGBA32F),
  new gfx.Attribute('a_color2', gfx.Format.RGBA32F),
];
const FLOATS = 13;
/** Vertices and indices one draw holds; a bigger draw is split. */
const MAX_VERTICES = 16384;
const MAX_INDICES = 49152;

/** A draw's GPU side: a model with one sub-model and its own buffers, and the arrays to fill. */
interface Draw {
  model: renderer.scene.Model;
  vb: Float32Array;
  ib: Uint16Array;
  material: Material | null;
}

@ccclass('RigbySkeleton')
@menu('Rigby2D/RigbySkeleton')
@help('https://rigby2d.com/docs/runtimes.html#cocos-creator')
@executeInEditMode
@disallowMultiple
export class RigbySkeleton extends UIRenderer {
  /** Node event for animation events: listeners get a RigbyEvent. */
  static readonly EVENT = 'rigby-event';
  /** Node events as animations start, end, and complete a loop: listeners get (animation, track). */
  static readonly START = 'rigby-start';
  static readonly END = 'rigby-end';
  static readonly COMPLETE = 'rigby-complete';

  // ---------------------------------------------------------------- skeleton data

  /**
   * The skeleton asset Cocos makes when it imports a .json and an .atlas of the same name (Skeleton
   * Data): the simplest way to set a character up. Takes the place of the three fields below.
   */
  @property({ type: Object as any, tooltip: 'The Skeleton Data asset Cocos makes from a .json + .atlas pair. Or use the fields below.' })
  skeletonData: any = null;

  @property({ type: JsonAsset, tooltip: 'The skeleton as JSON (.json), when not using Skeleton Data.' })
  skeletonJson: JsonAsset | null = null;

  @property({ type: BufferAsset, tooltip: 'The skeleton as binary (.skel, imported as a binary asset), when not using Skeleton Data.' })
  skeletonBinary: BufferAsset | null = null;

  @property({ type: TextAsset, tooltip: 'The texture atlas (.atlas) text.' })
  atlasText: TextAsset | null = null;

  @property({ type: [Texture2D], tooltip: 'The atlas pages, in the order the atlas lists them (or named like them).' })
  textures: Texture2D[] = [];

  // ---------------------------------------------------------------- playback

  @property({ type: CCString, tooltip: 'Animation to play on track 0 when the scene starts.' })
  animation = '';

  @property({ tooltip: 'Loop the starting animation.' })
  loop = true;

  @property({ type: CCString, tooltip: 'Skin to show (empty: the default skin).' })
  skin = '';

  @property({ type: CCFloat, tooltip: 'Animation speed (1 = real time).' })
  timeScale = 1;

  @property({ tooltip: 'Play animations in the Cocos editor while you set the scene up.' })
  previewInEditor = true;

  @property({ type: EffectAsset, tooltip: 'The rigby2d effect (found automatically when this is empty).' })
  effect: EffectAsset | null = null;

  // ---------------------------------------------------------------- runtime state

  /** The skeleton data, its current pose and its AnimationState (tracks, queues, crossfades). */
  skeleton: any = null;
  pose: any = null;
  state: any = null;

  private lookup: ((name: string) => any) | null = null;
  private rigbyMaterials = new Map<string, Material>();
  private draws: Draw[] = [];
  private batches: Batch[] = [];
  private loadedKey = '';

  // ---------------------------------------------------------------- API

  /** Plays `name` on `track`, crossfading over `mix` seconds. Returns the track entry. */
  setAnimation(track: number, name: string, loop = true, mix = 0) {
    this.ensureLoaded();
    if (!this.skeleton?.animations.some((a: any) => a.name === name)) throw new Error(`Rigby2D: no animation '${name}'`);
    this.state.setAnimation(this.skeleton, track, name, loop, mix);
    return this.state.tracks[track];
  }

  /** Queues `name` after the current animation on `track` (after `delay` seconds, or when it ends). */
  addAnimation(track: number, name: string, loop = true, mix = 0.2, delay: number | null = null) {
    this.ensureLoaded();
    return this.state.addAnimation(this.skeleton, track, name, loop, mix, delay);
  }

  /** Stops `track`. */
  clearTrack(track: number) {
    this.state?.clearTrack(track);
  }

  /** Shows skin `name` (null or '' for the default skin). */
  setSkin(name: string | null) {
    this.ensureLoaded();
    if (name && !this.skeleton.skins.some((s: any) => s.name === name)) throw new Error(`Rigby2D: no skin '${name}'`);
    this.skin = name ?? '';
    this.skeleton.skin = name || null;
  }

  /** The names of the skeleton's animations and skins. */
  get animationNames(): string[] {
    this.ensureLoaded();
    return this.skeleton ? this.skeleton.animations.map((a: any) => a.name) : [];
  }
  get skinNames(): string[] {
    this.ensureLoaded();
    return this.skeleton ? this.skeleton.skins.map((s: any) => s.name) : [];
  }

  /**
   * Where bone `name` is, in this node's space: { position, rotation (degrees) }, or null without
   * that bone. RigbyBoneFollower uses it to keep nodes on bones.
   */
  boneTransform(name: string): { position: Vec2; rotation: number; scaleX: number; scaleY: number } | null {
    this.ensureLoaded();
    const i = this.skeleton?.bones.findIndex((b: any) => b.name === name) ?? -1;
    const w = i >= 0 ? this.pose.world[i] : null;
    if (!w) return null;
    return {
      position: new Vec2(w.tx, w.ty),
      rotation: (Math.atan2(w.b, w.a) * 180) / Math.PI,
      scaleX: Math.hypot(w.a, w.b),
      scaleY: Math.hypot(w.c, w.d),
    };
  }

  // ---------------------------------------------------------------- lifecycle

  onLoad() {
    super.onLoad?.();
    this.ensureLoaded();
  }

  update(dt: number) {
    this.ensureLoaded();
    if (!this.skeleton || !this.effectAsset()) return;
    if (EDITOR && !this.previewInEditor) dt = 0;
    if ((this.skeleton.skin ?? '') !== (this.skin || '')) this.skeleton.skin = this.skin || null;
    this.state.update(this.skeleton, dt * this.timeScale);
    this.state.apply(this.skeleton, this.pose);
    this.rebuild();
    this.markForUpdateRenderData();
  }

  onDestroy() {
    for (const d of this.draws) director.root?.destroyModel(d.model);
    this.draws.length = 0;
    for (const m of this.rigbyMaterials.values()) m.destroy();
    this.rigbyMaterials.clear();
    super.onDestroy?.();
  }

  // ---------------------------------------------------------------- loading

  /** (Re)loads the skeleton when its assets changed. */
  private ensureLoaded() {
    const key = [this.skeletonData?._uuid, this.skeletonJson?._uuid, this.skeletonBinary?._uuid, this.atlasText?._uuid, ...this.textures.map((t) => t?._uuid)].join('|');
    if (key === this.loadedKey) return;
    this.loadedKey = key;
    this.skeleton = null;
    try {
      this.load();
    } catch (e) {
      console.error(`Rigby2D: could not load the skeleton on '${this.node.name}':`, e);
      this.skeleton = null;
    }
  }

  private load() {
    let json: any = null;
    let binary: Uint8Array | null = null;
    let atlas = '';
    let textures: Texture2D[] = this.textures.filter(Boolean);
    let names: string[] = [];
    const data = this.skeletonData;
    if (data) {
      // Cocos' Skeleton Data: JSON (skeletonJson) or binary (its native asset), atlas text, textures.
      if (data.skeletonJson && typeof data.skeletonJson === 'object' && Object.keys(data.skeletonJson).length) json = data.skeletonJson;
      else if (data._nativeAsset) binary = new Uint8Array(data._nativeAsset);
      atlas = data.atlasText ?? '';
      if (!textures.length) textures = (data.textures ?? []).filter(Boolean);
      names = data.textureNames ?? [];
    } else {
      if (this.skeletonJson) json = this.skeletonJson.json;
      else if (this.skeletonBinary) binary = new Uint8Array(this.skeletonBinary.buffer());
      atlas = this.atlasText?.text ?? '';
    }
    if (!json && !binary) return;
    if (!atlas) throw new Error('no atlas: set the atlas text (or use the Skeleton Data asset)');
    const name = this.node.name;
    if (binary && !isSkeletonBinary(binary)) throw new Error('this is not a Rigby2D or Spine .skel file');
    const raw = binary ? readSkeletonBinary(binary) : json;
    this.skeleton = readSkeletonJson(raw, name).skeleton;
    const parsed = parseAtlas(atlas);
    // Pages by name when the textures are named like them, else in the atlas's order.
    const byName = new Map<string, Texture2D>();
    textures.forEach((t, k) => {
      const n = (names[k] ?? t.name ?? '').replace(/\.[^.]+$/, '');
      if (n) byName.set(n, t);
    });
    this.lookup = atlasLookup(parsed, (page: any) => {
      const tex = byName.get(page.name.replace(/\.[^.]+$/, '')) ?? textures[parsed.pages.indexOf(page)];
      return tex ? { texture: tex, pma: !!page.pma, width: tex.width, height: tex.height } : null;
    });
    this.pose = new Pose(this.skeleton);
    this.state = new AnimationState();
    this.state.addListener({
      start: (entry: any) => this.node.emit(RigbySkeleton.START, entry.name, entry.track),
      end: (entry: any) => this.node.emit(RigbySkeleton.END, entry.name, entry.track),
      complete: (entry: any) => this.node.emit(RigbySkeleton.COMPLETE, entry.name, entry.track),
      event: (entry: any, e: any) =>
        this.node.emit(RigbySkeleton.EVENT, { name: e.name, time: e.time, int: e.int ?? 0, float: e.float ?? 0, string: e.string ?? '', animation: entry.name, track: entry.track } as RigbyEvent),
    });
    this.skeleton.skin = this.skin || null;
    this.pose.setToSetup(this.skeleton);
    this.pose.updateWorld(this.skeleton);
    if (this.animation && this.skeleton.animations.some((a: any) => a.name === this.animation)) this.state.setAnimation(this.skeleton, 0, this.animation, this.loop, 0);
  }

  // ---------------------------------------------------------------- drawing

  /** Builds this frame's triangles, batched by texture and blend mode, into the draws' buffers. */
  private rebuild() {
    this.batches.length = 0;
    let batch: Batch | null = null;
    let draw: Draw | null = null;
    const c = this.color;
    const t = [c.r / 255, c.g / 255, c.b / 255, c.a / 255];
    drawSkeletonGeometry(this.skeleton, this.pose, this.lookup!, (tex: any, blend: string, p: number[], uv: number[], tri: number[], light: number[], dark: number[] | null) => {
      const n = p.length / 2;
      if (!batch || batch.texture !== tex.texture || batch.blend !== blend || batch.vertices + n > MAX_VERTICES || batch.indices + tri.length > MAX_INDICES) {
        batch = { texture: tex.texture, pma: tex.pma, blend, vertices: 0, indices: 0 };
        this.batches.push(batch);
        draw = this.drawFor(this.batches.length - 1);
      }
      const vb = draw!.vb;
      let o = batch.vertices * FLOATS;
      for (let k = 0; k < n; k++, o += FLOATS) {
        vb[o] = p[2 * k];
        vb[o + 1] = p[2 * k + 1];
        vb[o + 2] = 0;
        vb[o + 3] = uv[2 * k];
        vb[o + 4] = uv[2 * k + 1];
        vb[o + 5] = light[0] * t[0];
        vb[o + 6] = light[1] * t[1];
        vb[o + 7] = light[2] * t[2];
        vb[o + 8] = light[3] * t[3];
        vb[o + 9] = dark ? dark[0] : 0;
        vb[o + 10] = dark ? dark[1] : 0;
        vb[o + 11] = dark ? dark[2] : 0;
        vb[o + 12] = dark ? 1 : 0;
      }
      const ib = draw!.ib;
      for (let k = 0; k < tri.length; k++) ib[batch.indices + k] = batch.vertices + tri[k];
      batch.vertices += n;
      batch.indices += tri.length;
    });
    // Upload each draw, with its material (texture and blend mode).
    this.batches.forEach((b, i) => {
      const d = this.draws[i];
      const material = this.materialFor(b);
      if (material && d.material !== material) {
        d.model.setSubModelMaterial(0, material);
        d.material = material;
      }
      const ia = d.model.subModels[0].inputAssembler;
      ia.vertexBuffers[0].update(d.vb.subarray(0, b.vertices * FLOATS));
      ia.vertexCount = b.vertices;
      ia.indexBuffer!.update(d.ib.subarray(0, b.indices));
      ia.indexCount = b.indices;
    });
  }

  /** The draw for batch `i`, made the first time it is needed. */
  private drawFor(i: number): Draw {
    while (this.draws.length <= i) {
      const device = gfx.deviceManager.gfxDevice;
      const stride = FLOATS * 4;
      const vertexBuffer = device.createBuffer(new gfx.BufferInfo(gfx.BufferUsageBit.VERTEX | gfx.BufferUsageBit.TRANSFER_DST, gfx.MemoryUsageBit.DEVICE, MAX_VERTICES * stride, stride));
      const indexBuffer = device.createBuffer(new gfx.BufferInfo(gfx.BufferUsageBit.INDEX | gfx.BufferUsageBit.TRANSFER_DST, gfx.MemoryUsageBit.DEVICE, MAX_INDICES * 2, 2));
      const mesh = new RenderingSubMesh([vertexBuffer], ATTRIBUTES, gfx.PrimitiveMode.TRIANGLE_LIST, indexBuffer);
      mesh.subMeshIdx = 0;
      const model = director.root!.createModel(renderer.scene.Model);
      model.node = model.transform = this.node;
      const material = this.materialFor({ texture: null as any, pma: false, blend: 'normal', vertices: 0, indices: 0 });
      model.initSubModel(0, mesh, material!);
      this.draws.push({ model, vb: new Float32Array(MAX_VERTICES * FLOATS), ib: new Uint16Array(MAX_INDICES), material });
    }
    return this.draws[i];
  }

  // ---------------------------------------------------------------- UIRenderer

  protected _render(render: any) {
    this.batches.forEach((b, i) => {
      const d = this.draws[i];
      if (b.indices && d.material) render.commitModel(this, d.model, d.material);
    });
  }

  protected _canRender(): boolean {
    return this.enabledInHierarchy && !!this.skeleton && this.batches.length > 0;
  }

  /** Materials are per draw (texture and blend mode); the renderer's own material slot is not used. */
  public updateMaterial() {}

  /** The material for a texture and blend mode (made once, then reused). */
  private materialFor(b: Batch): Material | null {
    const effect = this.effectAsset();
    if (!effect) return null;
    const key = `${b.texture?._uuid ?? 'none'}|${b.blend}|${b.pma ? 1 : 0}`;
    let m = this.rigbyMaterials.get(key);
    if (!m) {
      const [src, dst] = BLEND_FACTORS[b.blend] ?? BLEND_FACTORS.normal;
      m = new Material();
      m.initialize({
        effectAsset: effect,
        states: {
          blendState: { targets: [{ blend: true, blendSrc: src, blendDst: dst, blendSrcAlpha: gfx.BlendFactor.ONE, blendDstAlpha: gfx.BlendFactor.ONE_MINUS_SRC_ALPHA }] },
          rasterizerState: { cullMode: gfx.CullMode.NONE },
          depthStencilState: { depthTest: false, depthWrite: false },
        },
      });
      if (b.texture) m.setProperty('mainTexture', b.texture);
      m.setProperty('rigbyParams', [b.pma ? 1 : 0, 0, 0, 0]);
      this.rigbyMaterials.set(key, m);
    }
    return m;
  }

  private effectAsset(): EffectAsset | null {
    if (this.effect) return this.effect;
    const found = EffectAsset.get('rigby2d') ?? EffectAsset.get('../rigby2d/rigby2d');
    if (found) return (this.effect = found);
    if (!this.effectRequested) {
      this.effectRequested = true;
      assetManager.loadAny({ uuid: RIGBY_EFFECT_UUID }, (err: any, asset: EffectAsset) => {
        if (err) console.error('Rigby2D: rigby2d.effect not found; set the Effect field of RigbySkeleton', err);
        else this.effect = asset;
      });
    }
    return null;
  }
  private effectRequested = false;
}
