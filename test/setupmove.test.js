// SPDX-License-Identifier: MIT OR Apache-2.0
// "Bone only" in Setup mode (setupmove.js): moving, turning or scaling a bone leaves its child bones,
// its images and the weighted vertices bound to it where they are drawn.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeAttachment, makeBone, makeSlot, Skeleton } from '../src/core/model.js';
import { transform } from '../src/core/math.js';
import { Pose } from '../src/core/pose.js';
import { setBoneSetupOnly } from '../src/editor/setupmove.js';

function project() {
  const doc = new Skeleton();
  const arm = doc.addBone(makeBone('arm', 0, transform(50, 100, 30), 120));
  const hand = doc.addBone(makeBone('hand', arm, transform(120, 0, -20), 60));
  const finger = doc.addBone(makeBone('finger', hand, transform(60, 0, 10), 20));
  doc.slots.push(makeSlot('sleeve', arm, makeAttachment('sleeve', 'sleeve', transform(40, 10, 15), 80, 50)));
  // A mesh weighted to the arm and the hand.
  const pose = new Pose(doc);
  const pts = [[100, 120], [180, 160], [150, 220]];
  const mesh = { name: 'skin', type: 'mesh', image: 'skin', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3, width: 10, height: 10 };
  mesh.weights = pts.map((p) => [arm, hand].map((b) => {
    const [x, y] = pose.world[b].inverse().apply(p);
    return { bone: b, x, y, weight: 0.5 };
  }));
  doc.slots.push(makeSlot('skin', hand, mesh));
  return { doc, arm, hand, finger };
}

const verts = (doc, slot) => [...new Pose(doc).worldVertices(doc, slot, doc.slots[slot].attachments[0])];
const origin = (doc, bone) => new Pose(doc).world[bone].apply([0, 0]);

function near(a, b) {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `value ${i}: ${v} vs ${b[i]}`));
}

test('moving a bone alone leaves its children and images in place', () => {
  const { doc, arm, hand, finger } = project();
  const before = { hand: origin(doc, hand), finger: origin(doc, finger), sleeve: verts(doc, 0), skin: verts(doc, 1) };
  // Move, turn and scale the arm.
  setBoneSetupOnly(doc, arm, { ...doc.bones[arm].setup, x: 80, y: 60, rotation: 75, scale_x: 1.3 });
  assert.equal(doc.bones[arm].setup.x, 80);
  near(origin(doc, arm), [80, 60]);
  near(origin(doc, hand), before.hand);
  near(origin(doc, finger), before.finger);
  near(verts(doc, 0), before.sleeve);
  near(verts(doc, 1), before.skin);
});

test('a plain setup change still carries everything along', () => {
  const { doc, arm, hand } = project();
  const hand0 = origin(doc, hand);
  doc.bones[arm].setup = { ...doc.bones[arm].setup, x: 80 };
  assert.notDeepEqual(origin(doc, hand), hand0);
});

test('a selected child moves along with its bone', () => {
  const { doc, arm, hand, finger } = project();
  const finger0 = origin(doc, finger);
  const hand0 = origin(doc, hand);
  setBoneSetupOnly(doc, arm, { ...doc.bones[arm].setup, x: 80 }, new Set([arm, hand]));
  near(origin(doc, hand), [hand0[0] + 30, hand0[1]]);
  near(origin(doc, finger), [finger0[0] + 30, finger0[1]]);
});
