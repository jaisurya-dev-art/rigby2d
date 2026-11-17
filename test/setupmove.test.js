// SPDX-License-Identifier: MIT OR Apache-2.0
// "Bone only" in Setup mode (setupmove.js): moving, turning or scaling a bone leaves its child bones,
// its images and the weighted vertices bound to it where they are drawn.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeAttachment, makeBone, makeSlot, Skeleton } from '../src/core/model.js';
import { transform } from '../src/core/math.js';
import { Pose } from '../src/core/pose.js';
import { setBoneSetupOnly, setupWorld } from '../src/editor/setupmove.js';

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

// A leg: thigh and shin solved by IK to a target, a foot under the shin, and a mesh weighted to
// thigh and shin, as on the mammoth demo's legs.
function leg() {
  const doc = new Skeleton();
  const hip = doc.addBone(makeBone('hip', 0, transform(0, 300, 0), 0));
  const thigh = doc.addBone(makeBone('thigh', hip, transform(0, 0, -80), 150));
  const shin = doc.addBone(makeBone('shin', thigh, transform(150, 0, -20), 150));
  const foot = doc.addBone(makeBone('foot', shin, transform(150, 0, 100), 40));
  const target = doc.addBone(makeBone('target', 0, transform(0, 0, 0), 0));
  doc.ik.push({ name: 'leg-ik', order: 0, skinRequired: false, bones: [thigh, shin], target, mix: 1, softness: 0, bendPositive: false, compress: false, stretch: false, uniform: false });
  // Put the target where the shin ends in the setup pose, so the knee stays bent as drawn.
  const tip = setupWorld(doc)[foot].apply([0, 0]);
  Object.assign(doc.bones[target].setup, { x: tip[0], y: tip[1] });
  const pose = new Pose(doc);
  const pts = [[10, 280], [40, 200], [30, 120], [60, 60], [20, 40]];
  const mesh = { name: 'leg', type: 'mesh', image: 'leg', uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5], triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4], hull: 4, width: 10, height: 10 };
  mesh.weights = pts.map((p, k) => [thigh, shin].map((b, j) => {
    const [x, y] = pose.world[b].inverse().apply(p);
    return { bone: b, x, y, weight: k < 2 ? (j ? 0.2 : 0.8) : j ? 0.8 : 0.2 };
  }));
  doc.slots.push(makeSlot('leg', thigh, mesh));
  doc.slots.push(makeSlot('hoof', foot, makeAttachment('hoof', 'hoof', transform(20, 0, 0), 50, 30)));
  return { doc, thigh, shin, foot, target };
}

const worldOf = (doc, bone) => {
  const m = new Pose(doc).world[bone];
  return [m.a, m.b, m.c, m.d, m.tx, m.ty];
};

test('moving a joint in an IK chain moves only that bone: the leg, foot and other bones stay', () => {
  const { doc, thigh, shin, foot } = leg();
  const before = { leg: verts(doc, 0), hoof: verts(doc, 1), thigh: worldOf(doc, thigh), shin: worldOf(doc, shin), foot: worldOf(doc, foot) };
  const knee = origin(doc, shin);
  // Drag the knee: the shin's origin moves; the IK must not turn the thigh or the shin.
  const thighWorld = new Pose(doc).world[thigh];
  setBoneSetupOnly(doc, shin, { ...doc.bones[shin].setup, x: 120, y: 30 });
  near(worldOf(doc, thigh), before.thigh);
  near(worldOf(doc, foot), before.foot);
  // The shin moved to its new place without turning.
  near(worldOf(doc, shin).slice(0, 4), before.shin.slice(0, 4));
  near(origin(doc, shin), thighWorld.apply([120, 30]));
  assert.ok(Math.hypot(origin(doc, shin)[0] - knee[0], origin(doc, shin)[1] - knee[1]) > 10);
  near(verts(doc, 0), before.leg);
  near(verts(doc, 1), before.hoof);
});

test('moving the hip of an IK leg moves only the thigh: the shin, foot and leg stay', () => {
  const { doc, thigh, shin, foot } = leg();
  const before = { leg: verts(doc, 0), hoof: verts(doc, 1), shin: worldOf(doc, shin), foot: worldOf(doc, foot), thigh: worldOf(doc, thigh) };
  setBoneSetupOnly(doc, thigh, { ...doc.bones[thigh].setup, x: 25, y: -15 });
  near(worldOf(doc, shin), before.shin);
  near(worldOf(doc, foot), before.foot);
  near(worldOf(doc, thigh).slice(0, 4), before.thigh.slice(0, 4));
  near(verts(doc, 0), before.leg);
  near(verts(doc, 1), before.hoof);
});

test('an IK leg with softness and a foot that keeps its own rotation: only the moved bone moves', () => {
  for (const which of ['shin', 'thigh']) {
    const { doc, thigh, shin, foot } = leg();
    doc.ik[0].softness = 8;
    doc.bones[foot].inherit = 'noRotationOrReflection';
    const others = which === 'shin' ? [thigh, foot] : [shin, foot];
    const before = others.map((b) => worldOf(doc, b));
    const leg0 = verts(doc, 0);
    const b = which === 'shin' ? shin : thigh;
    // A drag: many small moves, each from the current setup, as the editor sends them.
    const s0 = { ...doc.bones[b].setup };
    for (let k = 1; k <= 20; k++) setBoneSetupOnly(doc, b, { ...doc.bones[b].setup, x: s0.x - 2 * k, y: s0.y + 1.2 * k });
    others.forEach((o, i) => near(worldOf(doc, o), before[i]));
    near(verts(doc, 0), leg0);
  }
});

test('a selected child moves along with its bone', () => {
  const { doc, arm, hand, finger } = project();
  const finger0 = origin(doc, finger);
  const hand0 = origin(doc, hand);
  setBoneSetupOnly(doc, arm, { ...doc.bones[arm].setup, x: 80 }, new Set([arm, hand]));
  near(origin(doc, hand), [hand0[0] + 30, hand0[1]]);
  near(origin(doc, finger), [finger0[0] + 30, finger0[1]]);
});
