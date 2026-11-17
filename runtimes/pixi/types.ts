// SPDX-License-Identifier: MIT OR Apache-2.0
// Public types of the Rigby2D PixiJS runtime. Type-only: nothing here exists at run time.

import type { Container, Point, Texture, Ticker } from 'pixi.js';

/** The PixiJS namespace the runtime is created for (`import * as PIXI from 'pixi.js'`, or the `PIXI` global). */
export type PixiNamespace = typeof import('pixi.js');

// ---------------------------------------------------------------------------------------------
// The shared JavaScript core (src/core), as far as this runtime's API shows it.
// ---------------------------------------------------------------------------------------------

/** One region of an atlas page. */
export interface AtlasRegion {
  name: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  offsetX: number;
  offsetY: number;
  originalWidth: number;
  originalHeight: number;
  split: number[] | null;
  pad: number[] | null;
  extra: Record<string, string>;
}

/** One page (image file) of an atlas. */
export interface AtlasPage {
  name: string;
  width: number;
  height: number;
  format: string;
  /** Min and mag filter, such as `['Linear', 'Linear']`. */
  filter: string[];
  repeat: string;
  /** Whether the page's image has premultiplied alpha. */
  pma: boolean;
  scale: number | null;
  regions: AtlasRegion[];
  extra: Record<string, string>;
}

/** A parsed `.atlas` file. */
export interface Atlas {
  pages: AtlasPage[];
}

/** A 2D affine matrix: (x, y) maps to (a*x + c*y + tx, b*x + d*y + ty). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** A named part of the skeleton data (bone, slot, skin, animation). */
export interface NamedItem {
  name: string;
}

/** The skeleton data from the shared core (bones, slots, skins, constraints, animations). */
export interface SkeletonData {
  bones: NamedItem[];
  slots: NamedItem[];
  skins: NamedItem[];
  animations: NamedItem[];
  events: SkeletonEventData[];
  /** The skin the data is drawn with (`null`: the default skin). Each RigbySkeleton keeps its own. */
  skin?: string | null;
}

/** An event defined in the skeleton, with its default values. */
export interface SkeletonEventData {
  name: string;
  int: number;
  float: number;
  string: string | null;
  audio: string | null;
  volume: number;
  balance: number;
}

/** An event as it fires during playback: its values, and when it fired. */
export interface SkeletonEvent extends SkeletonEventData {
  /** Seconds into the animation. */
  time: number;
}

/** An animation playing on a track. */
export interface TrackEntry {
  track: number;
  /** Index of the animation in the skeleton data. */
  animation: number;
  name: string;
  looping: boolean;
  mixDuration: number;
  mixTime: number;
  /** For queued entries: seconds after the previous one started, or `null` to start when it ends. */
  delay: number | null;
  time: number;
  lastTime: number;
  fresh: boolean;
  /** The track's influence (layers). */
  alpha: number;
  timeScale: number;
  /** The entry being faded out. */
  previous: TrackEntry | null;
  queue: TrackEntry[];
  /** Mix progress in [0, 1]. */
  mix(): number;
}

/** Callbacks for an AnimationState. */
export interface AnimationListener {
  start?(entry: TrackEntry): void;
  /** The entry was replaced or cleared. */
  end?(entry: TrackEntry): void;
  /** The entry reached its end (every loop, for looping entries). */
  complete?(entry: TrackEntry): void;
  event?(entry: TrackEntry, event: SkeletonEvent): void;
}

/** Tracks of animations, crossfades, queues and events (the shared core's AnimationState). */
export interface AnimationState {
  /** Track entries by track index (empty tracks are `undefined`). */
  tracks: Array<TrackEntry | undefined>;
  /** Playback speed multiplier for every track. */
  speed: number;
  listeners: AnimationListener[];
  physicsDelta: number;
  /** The base track's entry. */
  readonly current: TrackEntry | null;
  /** Adds a listener; returns a function that removes it. */
  addListener(listener: AnimationListener): () => void;
  play(skeleton: SkeletonData, name: string, looping: boolean, mix?: number): boolean;
  setAnimation(skeleton: SkeletonData, track: number, name: string, looping: boolean, mix?: number): TrackEntry | null;
  addAnimation(skeleton: SkeletonData, track: number, name: string, looping: boolean, mix?: number, delay?: number | null): TrackEntry | null;
  clearTrack(track: number): void;
  stop(): void;
  currentTime(): number | null;
  update(skeleton: SkeletonData, dt: number): void;
  apply(skeleton: SkeletonData, pose: Pose): void;
}

/** A skeleton's current pose (the shared core's Pose). */
export interface Pose {
  /** World transform of every bone. */
  world: Affine[];
  /** Where the object is (with `physicsMovement`), or `null`. */
  placement: Affine | null;
  drawOrder: number[];
  setToSetup(skeleton: SkeletonData): void;
  resetPhysics(): void;
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

/**
 * The atlas page textures for `parseRigby`: a `Map` or an object by page name, or a function that
 * returns each page's texture (a missing texture skips the page).
 */
export type PageTextures =
  | Map<string, Texture>
  | Record<string, Texture | undefined>
  | ((pageName: string, page: AtlasPage) => Texture | null | undefined);

/** A skeleton for `parseRigby`: `.skel` bytes, JSON text, or parsed JSON. */
export type SkeletonSource = ArrayBuffer | Uint8Array | string | object;

/**
 * Loaded skeleton data, shared by every RigbySkeleton made from it: the skeleton, its atlas and a
 * PixiJS texture per atlas page.
 */
export interface RigbyData {
  /** The skeleton data (bones, slots, skins, constraints, animations). */
  readonly skeleton: SkeletonData;
  /** The parsed atlas. */
  readonly atlas: Atlas;
  /** Atlas page name -> PixiJS Texture. */
  readonly pages: Map<string, Texture>;
  /** Names of the animations. */
  readonly animationNames: string[];
  /** Names of the skins. */
  readonly skinNames: string[];
}

/** The `RigbyData` class: use it for `instanceof`. */
export interface RigbyDataConstructor {
  new (skeleton: SkeletonData, atlas: Atlas, pages: Map<string, Texture>): RigbyData;
  readonly prototype: RigbyData;
}

// ---------------------------------------------------------------------------------------------
// RigbySkeleton
// ---------------------------------------------------------------------------------------------

export interface RigbySkeletonOptions {
  /** An animation to start playing. */
  animation?: string;
  /** Whether `animation` loops (true). */
  loop?: boolean;
  /** The skin (`null`: the default skin). */
  skin?: string | null;
  /** Speed of the skeleton's animations (1). */
  timeScale?: number;
  /** Whether it advances with the ticker by itself (true). */
  autoUpdate?: boolean;
  /** A ticker of your own, such as `app.ticker`, instead of `Ticker.shared`. */
  ticker?: Ticker;
  /** How strongly moving the object drives physics (0 = only the animation does). */
  physicsMovement?: number;
  /** Rounds vertex positions to whole pixels (false). */
  roundPixels?: boolean;
  /** The container's label ("RigbySkeleton"). */
  label?: string;
}

/** A bone's position in the skeleton's coordinates (PixiJS axes). */
export interface BoneTransform {
  x: number;
  y: number;
  /** Radians. */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface AttachToBoneOptions {
  /** Whether the child turns with the bone (true). */
  rotate?: boolean;
  /** Whether the child scales with the bone (true). */
  scale?: boolean;
}

/**
 * A playing skeleton: a PixiJS Container whose children are the meshes of the skeleton's
 * attachments. Emits `'start'`, `'end'` and `'complete'` (with the track entry) and `'event'`
 * (entry, event) as its animations play.
 */
export interface RigbySkeleton extends Container {
  /** The loaded data this skeleton was made from. */
  readonly data: RigbyData;
  /** The skeleton data. */
  readonly skeleton: SkeletonData;
  /** The current pose. */
  readonly pose: Pose;
  /** The AnimationState: tracks, crossfades, queues. */
  readonly state: AnimationState;
  /** Speed multiplier for this skeleton's animations (1 = real time). */
  timeScale: number;
  /** How strongly moving the object drives physics (0 = only the animation does). */
  physicsMovement: number;
  roundPixels: boolean;
  /** How many meshes the last update drew with. */
  readonly meshCount: number;
  /** Whether it advances with its ticker by itself. */
  autoUpdate: boolean;
  /** This skeleton's skin (`null` for the default). */
  skin: string | null;
  readonly animationNames: string[];
  readonly skinNames: string[];
  /** Plays `name` on `track`, crossfading over `mix` seconds. Returns the track entry (not with WebAssembly). */
  play(name: string, loop?: boolean, mix?: number, track?: number): TrackEntry | null | undefined;
  /** Plays `name` after the current animation on `track`. Returns the queued entry (not with WebAssembly). */
  queue(name: string, loop?: boolean, mix?: number, track?: number, delay?: number | null): TrackEntry | null | undefined;
  /** Stops every track and goes back to the setup pose. */
  stop(): this;
  setSkin(name: string | null): this;
  /** Advances by `seconds`, poses and redraws. */
  update(seconds: number): void;
  /** Restarts physics from the current pose, after a teleport. */
  resetPhysics(): this;
  /** Where bone `name` is, in this object's coordinates, or `null` without that bone. */
  boneTransform(name: string, out?: Partial<BoneTransform>): BoneTransform | null;
  /** Where bone `name` is on screen (global coordinates), or `null`. */
  boneGlobal(name: string, out?: Point): Point | null;
  /** Makes `child` follow bone `name`. Returns the child. */
  attachToBone<T extends Container>(name: string, child: T, options?: AttachToBoneOptions): T;
  /** Stops `child` following its bone. Returns the child. */
  detachFromBone<T extends Container>(child: T): T;
}

/** The `RigbySkeleton` class. */
export interface RigbySkeletonConstructor {
  new (data: RigbyData, options?: RigbySkeletonOptions): RigbySkeleton;
  readonly prototype: RigbySkeleton;
}

// ---------------------------------------------------------------------------------------------
// WebAssembly core
// ---------------------------------------------------------------------------------------------

/** What the WebAssembly module (runtimes/rust/rigby-wasm) exports. */
export interface RigbyWasmExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  data_load(skelPtr: number, skelLen: number, atlasPtr: number, atlasLen: number): number;
  error_ptr(): number;
  error_len(): number;
  inst_new(data: number): number;
  inst_free(handle: number): void;
  inst_set_animation(handle: number, track: number, ptr: number, len: number, loop: number, mix: number): unknown;
  inst_add_animation(handle: number, track: number, ptr: number, len: number, loop: number, mix: number, delay: number): unknown;
  inst_stop(handle: number): void;
  inst_set_skin(handle: number, ptr: number, len: number): unknown;
  inst_update(handle: number, dt: number): number;
  inst_bone_world(handle: number, bone: number): number;
}

/** The module for `rigbyPixi(PIXI, { wasm })`, from `loadRigbyWasm`. */
export interface RigbyWasm {
  exports: RigbyWasmExports;
  /** Typed views of the module's memory (refreshed when it grows). */
  views(): { u32: Uint32Array; f32: Float32Array; f64: Float64Array };
  load(skeleton: Uint8Array, atlasText: string): number;
  create(data: number): number;
  free(instance: number): void;
  setAnimation(instance: number, track: number, name: string, loop: boolean, mix: number): unknown;
  addAnimation(instance: number, track: number, name: string, loop: boolean, mix: number, delay: number | null): unknown;
  stop(instance: number): void;
  setSkin(instance: number, name: string | null): unknown;
  /** Advances, poses and builds geometry; returns the batch table's index in the u32 view. */
  update(instance: number, dt: number): number;
  boneWorld(instance: number, bone: number): Affine | null;
}

/** Where `loadRigbyWasm` reads the module from. */
export type WasmSource = string | URL | Response | ArrayBuffer | ArrayBufferView | WebAssembly.Module;

// ---------------------------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------------------------

export interface RigbyPixiOptions {
  /** The WebAssembly core, from `loadRigbyWasm`: posing and geometry then run in WebAssembly. */
  wasm?: RigbyWasm | null;
}

/** What `rigbyPixi(PIXI)` returns. */
export interface RigbyPixiRuntime {
  /**
   * Loads a skeleton (`.skel` or `.json`), its `.atlas` and the atlas pages (through PixiJS
   * `Assets`, from the atlas's folder). Loading the same pair again returns the same data.
   */
  loadRigby(skeletonUrl: string, atlasUrl: string): Promise<RigbyData>;
  /** Builds skeleton data from what is already in memory. */
  parseRigby(skeleton: SkeletonSource, atlasText: string, textures: PageTextures): RigbyData;
  RigbySkeleton: RigbySkeletonConstructor;
  RigbyData: RigbyDataConstructor;
}
