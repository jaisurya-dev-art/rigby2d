// SPDX-License-Identifier: MIT OR Apache-2.0
// The shared JavaScript core (src/core), typed for this runtime. The core has no declarations of its
// own and is shared with the other runtimes and the editor, so it stays JavaScript: this file is
// the one place the Pixi runtime meets it, and each import below is cast to the shape used here.
// The bundler inlines the core into the runtime's build.

import type { Texture } from 'pixi.js';
import type { Affine as AffineShape, AnimationState as AnimationStateShape, Atlas, Pose as PoseShape, SkeletonData } from './types.js';

// @ts-expect-error TS7016: src/core is untyped JavaScript
import { parseAtlas as parseAtlasJs } from '../../src/core/atlas.js';
// @ts-expect-error TS7016: src/core is untyped JavaScript
import { isSkeletonBinary as isSkeletonBinaryJs, readSkeletonBinary as readSkeletonBinaryJs } from '../../src/core/binary.js';
// @ts-expect-error TS7016: src/core is untyped JavaScript
import { atlasLookup as atlasLookupJs, drawSkeletonGeometry as drawSkeletonGeometryJs, geometryCache as geometryCacheJs } from '../../src/core/draw.js';
// @ts-expect-error TS7016: src/core is untyped JavaScript
import { readSkeletonJson as readSkeletonJsonJs } from '../../src/core/interop.js';
// @ts-expect-error TS7016: src/core is untyped JavaScript
import { Affine as AffineJs } from '../../src/core/math.js';
// @ts-expect-error TS7016: src/core is untyped JavaScript
import { Pose as PoseJs } from '../../src/core/pose.js';
// @ts-expect-error TS7016: src/core is untyped JavaScript
import { AnimationState as AnimationStateJs } from '../../src/core/state.js';

/** A slot blend mode as the core names it. */
export type CoreBlend = 'normal' | 'additive' | 'multiply' | 'screen';

/** An atlas image: its texture and how image UVs map onto the page. */
export interface AtlasEntry {
  tex: Texture;
  trim: number[];
  map(u: number, v: number, out: number[]): number[];
}

/** Atlas UVs worked out once per attachment, and scratch arrays (opaque). */
export interface GeometryCache {
  readonly uvs: WeakMap<object, unknown>;
}

/** Called for each drawn run of triangles (Y up; the arrays are reused: copy what you keep). */
export type EmitGeometry = (
  tex: Texture,
  blend: CoreBlend,
  positions: ArrayLike<number>,
  uvs: ArrayLike<number>,
  triangles: ArrayLike<number>,
  light: ArrayLike<number>,
  dark: ArrayLike<number> | null,
) => void;

export const parseAtlas = parseAtlasJs as (text: string) => Atlas;
export const isSkeletonBinary = isSkeletonBinaryJs as (bytes: Uint8Array) => boolean;
export const readSkeletonBinary = readSkeletonBinaryJs as (bytes: Uint8Array) => object;
export const readSkeletonJson = readSkeletonJsonJs as (json: unknown) => { skeleton: SkeletonData };
export const atlasLookup = atlasLookupJs as (atlas: Atlas, textureOf: (page: Atlas['pages'][number]) => Texture | null) => (name: string) => AtlasEntry | null;
export const geometryCache = geometryCacheJs as () => GeometryCache;
export const drawSkeletonGeometry = drawSkeletonGeometryJs as (
  skeleton: SkeletonData,
  pose: PoseShape,
  lookup: (name: string) => AtlasEntry | null,
  emit: EmitGeometry,
  options?: { cache?: GeometryCache | null },
) => void;
export const Affine = AffineJs as new () => AffineShape;
export const Pose = PoseJs as new (skeleton: SkeletonData) => PoseShape;
export const AnimationState = AnimationStateJs as new () => AnimationStateShape;
