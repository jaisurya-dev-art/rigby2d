// SPDX-License-Identifier: MIT OR Apache-2.0
// Reading format 4.2 binary skeletons (src/core/binary.js): a small 4.2 file encoded byte by byte
// from the documented layout (test/fixtures/skel42.js), read back into the 4.2 skeleton JSON structure
// and then into the document model. Every 4.2 feature the reader supports is in it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readSkeletonBinary } from '../src/core/binary.js';
import { VERSION_FIELD as V, readSkeletonJson } from '../src/core/interop.js';
import { encode42 as encode } from './fixtures/skel42.js';

test('a 4.2 binary skeleton reads into the 4.2 skeleton JSON structure', () => {
  const out = readSkeletonBinary(encode());
  assert.equal(out.skeleton[V], '4.2.43');
  assert.deepEqual(out.bones, [
    { name: 'root' },
    { name: 'hip', parent: 'root', length: 30, y: 100, color: 'ff0000ff', icon: 'ik' },
    { name: 'upper', parent: 'hip', length: 50, rotation: -90, inherit: 'noScale' },
    { name: 'target', parent: 'root', x: 30, y: 20 },
  ]);
  assert.deepEqual(out.slots.map((s) => [s.name, s.bone, s.attachment]), [['body', 'hip', 'body'], ['leg', 'upper', 'leg'], ['path', 'root', 'spine']]);
  assert.deepEqual(out.ik, [{ name: 'leg-ik', bones: ['upper'], target: 'target', bendPositive: false }]);
  assert.deepEqual(out.transform, [{ name: 'hip-follow', order: 1, bones: ['upper'], target: 'hip', rotation: 15, x: 5, mixRotate: 0.5, mixX: 0, mixScaleX: 0, mixShearY: 0 }]);
  assert.deepEqual(out.path, [{ name: 'spine-follow', order: 2, bones: ['hip'], target: 'path', rotateMode: 'chain' }]);

  const atts = out.skins[0].attachments;
  assert.deepEqual(atts.body.body, { rotation: 5, x: 1, y: 2, width: 40, height: 60 });
  assert.deepEqual(atts.leg.leg, {
    type: 'mesh',
    hull: 3,
    vertices: [1, 2, 0, 0, 1, 2, 2, 50, 0, 0.5, 1, 50, -30, 0.5, 1, 2, 0, 10, 1],
    uvs: [0, 0, 1, 0, 0, 1],
    triangles: [0, 1, 2],
    edges: [0, 2, 2, 4, 4, 0],
    width: 50,
    height: 10,
  });
  assert.deepEqual(atts.path.spine, { type: 'path', vertexCount: 3, vertices: [1, 0, 0, 0, 1, 1, 0, 10, 50, 1, 1, 0, 0, 100, 1], lengths: [100], color: 'ff8800ff' });

  const walk = out.animations.walk;
  assert.deepEqual(walk.bones.upper.rotate, [{ value: 10, curve: [0.1, 10, 0.4, -20] }, { time: 0.5, value: -20 }]);
  assert.deepEqual(walk.ik['leg-ik'], [{ time: 0.25, mix: 0 }]);
  assert.deepEqual(walk.attachments.default.leg.leg.deform, [{ offset: 2, vertices: [3, -3] }]);
});

test('a 4.2 binary skeleton loads into the document model', () => {
  const { skeleton } = readSkeletonJson(readSkeletonBinary(encode()));
  assert.deepEqual(skeleton.bones.map((b) => b.name), ['root', 'hip', 'upper', 'target']);
  assert.equal(skeleton.ik.length, 1);
  assert.equal(skeleton.ik[0].bendPositive, false);
  assert.equal(skeleton.animations[0].name, 'walk');
  assert.equal(skeleton.attachment(1, 'leg').type, 'mesh', "slot 1 ('leg') holds the weighted mesh");
});

test('what a 4.2 file has beyond the observed layout stops with a clear message', () => {
  assert.throws(() => readSkeletonBinary(encode({ slotColor: '80ff80ff' })), /Slot colors in format 4\.2/);
});

test('versions other than 4.2 and 4.3 are refused', () => {
  const bytes = encode();
  bytes[9] = '4'.charCodeAt(0);
  bytes[11] = '1'.charCodeAt(0);
  assert.throws(() => readSkeletonBinary(bytes), /Binary format 4\.1/);
});
