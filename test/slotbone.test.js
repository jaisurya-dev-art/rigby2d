// SPDX-License-Identifier: MIT OR Apache-2.0
// Moving an image to another bone (issue #22): regions, meshes and weighted meshes stay where
// they are in the world.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeAttachment, makeBone, makeSlot, moveAttachment, Skeleton } from '../src/core/model.js';
import { toAffine, transform } from '../src/core/math.js';
import { Pose } from '../src/core/pose.js';

function project() {
  const doc = new Skeleton();
  const arm = doc.addBone(makeBone('arm', 0, transform(50, 100, 30), 120));
  const hand = doc.addBone(makeBone('hand', arm, transform(120, 0, -20), 60));
  const att = makeAttachment('img', 'img', transform(40, 10, 15), 80, 50);
  doc.slots.push(makeSlot('img', arm, att));
  return { doc, arm, hand, slot: 0 };
}

/** What the editor's "move to bone" does (edit.js setSlotBoneKeepWorld), without the editor. */
function moveSlot(doc, slot, bone) {
  const setup = new Pose(doc);
  const toNew = setup.world[bone].inverse().mul(setup.world[doc.slots[slot].bone]);
  for (const att of doc.slots[slot].attachments) moveAttachment(att, toNew);
  doc.slots[slot].bone = bone;
}

/** Converts a region to a 4-vertex mesh on its bone (the inspector's Convert to mesh). */
function toMesh(doc, slot) {
  const att = doc.slots[slot].attachments[0];
  const m = toAffine(att.offset);
  const hw = att.width / 2;
  const hh = att.height / 2;
  const mesh = { name: att.name, type: 'mesh', image: att.image, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], hull: 4, width: att.width, height: att.height, color: att.color };
  mesh.vertices = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].flatMap((p) => m.apply(p));
  doc.slots[slot].attachments[0] = mesh;
  return mesh;
}

/** Weights every vertex to `bones` equally, in each bone's space (as binding does). */
function weigh(doc, slot, bones) {
  const att = doc.slots[slot].attachments[0];
  const pose = new Pose(doc);
  const pts = [...pose.worldVertices(doc, slot, att)];
  att.weights = [];
  for (let i = 0; i < pts.length; i += 2) {
    att.weights.push(bones.map((b) => {
      const [x, y] = pose.world[b].inverse().apply([pts[i], pts[i + 1]]);
      return { bone: b, x, y, weight: 1 / bones.length };
    }));
  }
  delete att.vertices;
}

const world = (doc, slot) => [...new Pose(doc).worldVertices(doc, slot, doc.slots[slot].attachments[0])];

function assertSame(a, b) {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `vertex value ${i}: ${v} vs ${b[i]}`));
}

test('moving an image to another bone keeps it in place', () => {
  const { doc, hand, slot } = project();
  const before = world(doc, slot);
  moveSlot(doc, slot, hand);
  assert.equal(doc.slots[slot].bone, hand);
  assertSame(world(doc, slot), before);
});

test('moving a converted mesh to another bone keeps it in place (issue #22)', () => {
  const { doc, hand, slot } = project();
  toMesh(doc, slot);
  const before = world(doc, slot);
  moveSlot(doc, slot, hand);
  assert.equal(doc.slots[slot].bone, hand);
  assertSame(world(doc, slot), before);
});

test('moving a weighted mesh to another bone leaves its weights alone', () => {
  const { doc, arm, hand, slot } = project();
  toMesh(doc, slot);
  weigh(doc, slot, [arm, hand]);
  const weights = JSON.stringify(doc.slots[slot].attachments[0].weights);
  const before = world(doc, slot);
  moveSlot(doc, slot, hand);
  assert.equal(JSON.stringify(doc.slots[slot].attachments[0].weights), weights);
  assertSame(world(doc, slot), before);
});
