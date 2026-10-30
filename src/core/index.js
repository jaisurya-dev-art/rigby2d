// SPDX-License-Identifier: MIT OR Apache-2.0
// rigby-core: runtime for Rigby2D 2D skeletal animations.
// Load an exported skeleton, play animations and get textured quads to draw with any renderer.
//
//   const skeleton = Skeleton.fromJson(json);
//   const pose = new Pose(skeleton);
//   const state = new AnimationState();
//   state.play(skeleton, 'walk', true, 0.2);              // track 0
//   state.setAnimation(skeleton, 1, 'shoot', false);      // layered on top
//   state.addListener({ event: (entry, e) => console.log(e.name) });
//
//   // every frame:
//   state.update(skeleton, 1 / 60);
//   state.apply(skeleton, pose);
//   for (const quad of pose.quads(skeleton)) {
//     // draw quad.positions with quad.uvs from the atlas region named quad.attachment.image
//   }
//   // or, with clipping, atlas UVs and two-color tint worked out for you:
//   drawSkeletonGeometry(skeleton, pose, atlasLookup(atlas, textureOfPage), emitTriangles);
//
// Licensed under MIT OR Apache-2.0 so it can be embedded in any game.

export * from './animation.js';
export * as curve from './curve.js';
export { Affine, transform, identityTransform, cloneTransform, toAffine, lerpTransform, lerp, wrapDegrees } from './math.js';
export * from './model.js';
export { Pose, applyDrawOrder } from './pose.js';
export { AnimationState } from './state.js';
export { isSkeletonJson, readSkeletonJson, writeSkeletonJson } from './interop.js';
export { parseAtlas, writeAtlas, regionPlacement } from './atlas.js';
export { isSkeletonBinary, readSkeletonBinary } from './binary.js';
export { atlasLookup, imageLookup, drawSkeletonGeometry, regionEntry, QUAD } from './draw.js';
export { ScenePlayer, loadScene, readSceneManifest, sceneDrawList, actorSlots } from './scene.js';
