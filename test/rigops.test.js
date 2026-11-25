// SPDX-License-Identifier: MIT OR Apache-2.0
// Rig operations (src/editor/rigops.js): side names, duplicating a branch (plain and mirrored) and
// copying a pose to paste it back, as it was or flipped left to right.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { transform } from '../src/core/math.js';
import { Skeleton, makeAttachment, makeBone, makeSlot } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import { copyPose, duplicateBranch, otherSide, pastePose } from '../src/editor/rigops.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** root ─ hip ─ arm_l ─ hand_l (pointing right of the centre), with a slot on the hand. */
function rig() {
  const doc = new Skeleton();
  const add = (name, parent, t, len) => doc.addBone(makeBone(name, doc.boneIndex(parent), t, len));
  add('hip', 'root', transform(0, 100, 90), 20);
  add('arm_l', 'hip', transform(20, -30, -60), 50); // out to the character's left (screen right)
  add('hand_l', 'arm_l', transform(50, 0, 10), 15);
  doc.slots.push(makeSlot('hand_l', doc.boneIndex('hand_l'), makeAttachment('hand', 'hand', transform(5, 2, 0), 8, 6)));
  return doc;
}

test('side names swap, names without a side have none', () => {
  assert.equal(otherSide('arm_l'), 'arm_r');
  assert.equal(otherSide('Arm.L'), 'Arm.R');
  assert.equal(otherSide('l_eye'), 'r_eye');
  assert.equal(otherSide('leftHand'), 'rightHand');
  assert.equal(otherSide('hand_r'), 'hand_l');
  assert.equal(otherSide('spine'), null);
  assert.equal(otherSide('tail'), null, 'a word ending in l is not a side');
});

test('a duplicate copies the branch and its slots under the same parent', () => {
  const doc = rig();
  const top = duplicateBranch(doc, doc.boneIndex('arm_l'));
  assert.equal(doc.bones[top].name, 'arm_l_copy');
  assert.equal(doc.bones[top].parent, doc.boneIndex('hip'));
  assert.equal(doc.bones[doc.boneIndex('hand_l_copy')].parent, top);
  const s = doc.slots.find((x) => x.name === 'hand_l_copy');
  assert.equal(s.bone, doc.boneIndex('hand_l_copy'));
  assert.equal(doc.validate(), null);
  // Twice: names stay unique.
  duplicateBranch(doc, doc.boneIndex('arm_l'));
  assert.ok(doc.boneIndex('arm_l_copy2') !== null || doc.bones.some((b) => /^arm_l_copy\d/.test(b.name)));
});

test('a mirrored duplicate is the other side: names swapped, positions mirrored', () => {
  const doc = rig();
  duplicateBranch(doc, doc.boneIndex('arm_l'), { mirror: true });
  assert.ok(doc.boneIndex('arm_r') !== null && doc.boneIndex('hand_r') !== null);
  const pose = new Pose(doc);
  for (const [l, r] of [['arm_l', 'arm_r'], ['hand_l', 'hand_r']]) {
    const a = pose.world[doc.boneIndex(l)];
    const b = pose.world[doc.boneIndex(r)];
    const [ax, ay] = a.apply([0, 0]);
    const [bx, by] = b.apply([0, 0]);
    assert.ok(close(bx, -ax, 1e-4) && close(by, ay, 1e-4), `${r} starts where ${l} does, mirrored`);
    const [atx, aty] = a.apply([10, 0]);
    const [btx, bty] = b.apply([10, 0]);
    assert.ok(close(btx - bx, -(atx - ax), 1e-4) && close(bty - by, aty - ay, 1e-4), `${r} points the mirrored way`);
  }
  // The image sits at the mirrored spot.
  const qa = pose.quads(doc).find((q) => q.slot === doc.slotIndex('hand_l'));
  const qb = pose.quads(doc).find((q) => q.slot === doc.slotIndex('hand_r'));
  const cx = (q) => q.positions.reduce((s, p) => s + p[0], 0) / q.positions.length;
  assert.ok(close(cx(qb), -cx(qa), 1e-3));
  assert.equal(doc.validate(), null);
});

test('a pose pastes back as it was, or flipped onto the other side', () => {
  const doc = rig();
  duplicateBranch(doc, doc.boneIndex('arm_l'), { mirror: true });
  const pose = new Pose(doc);
  const l = doc.boneIndex('arm_l');
  pose.local[l] = { ...pose.local[l], rotation: pose.local[l].rotation + 25, y: pose.local[l].y + 4 };
  const copied = copyPose(doc, pose, [l]);
  assert.deepEqual(pastePose(doc, copied).map(([i]) => doc.bones[i].name), ['arm_l']);
  const [[to, t]] = pastePose(doc, copied, { flipped: true });
  assert.equal(doc.bones[to].name, 'arm_r', 'the left arm pose goes to the right arm');
  const s = doc.bones[to].setup;
  assert.ok(close(t.rotation, s.rotation - 25), 'turns the other way by as much');
  assert.ok(close(t.y, s.y - 4), 'moves the mirrored way');
});
