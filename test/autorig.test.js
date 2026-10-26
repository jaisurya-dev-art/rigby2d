// SPDX-License-Identifier: MIT OR Apache-2.0
// AutoRig and retargeting: body part names, rigging layered artwork, mapping bones between
// characters and transferring animations with proportion compensation.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, setKey } from '../src/core/animation.js';
import { autoRig, findParts } from '../src/core/autorig.js';
import { boneKey, classify } from '../src/core/bodyparts.js';
import { EASE_IN_OUT } from '../src/core/curve.js';
import { autoWeights } from '../src/core/meshgeom.js';
import { Skeleton, makeBone } from '../src/core/model.js';
import { toAffine, transform } from '../src/core/math.js';
import { Pose } from '../src/core/pose.js';
import { mapBones, retarget } from '../src/core/retarget.js';
import { CHARACTER, figure } from './fixtures/figure.js';

/** World outline of an attachment: a region's corners, or a mesh's vertices. */
function outline(doc, pose, s) {
  const att = doc.slots[s].attachments[0];
  if (att.type === 'mesh') return pose.worldVertices(doc, s, att);
  const m = pose.world[doc.slots[s].bone].mul(toAffine(att.offset));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([x, y]) => m.apply([(x * att.width) / 2, (y * att.height) / 2]));
}

const world = (doc, pose, name) => pose.world[doc.boneIndex(name)];
const head = (doc, pose, name) => world(doc, pose, name).apply([0, 0]);

test('body part names: roles, sides and indices', () => {
  assert.deepEqual(classify('L_UpperArm'), { role: 'upperarm', side: 'l', index: null });
  assert.deepEqual(classify('forearm.R'), { role: 'forearm', side: 'r', index: null });
  assert.deepEqual(classify('Left Eye Brow'), { role: 'brow', side: 'l', index: null });
  assert.deepEqual(classify('shoe_right'), { role: 'foot', side: 'r', index: null });
  assert.deepEqual(classify('lower leg left'), { role: 'shin', side: 'l', index: null });
  assert.deepEqual(classify('Tail2'), { role: 'tail', side: null, index: 2 });
  assert.equal(classify('Layer 3'), null);
  assert.equal(boneKey('Arm_Left'), boneKey('arm.l'));
});

test('autorig: identifies parts, places joints, builds meshes and IK', () => {
  const { doc, alphaOf } = figure(CHARACTER);
  const parts = findParts(doc, alphaOf);
  const roleOf = (n) => parts.find((p) => p.name === n);
  assert.equal(roleOf('Body').role, 'torso');
  assert.equal(roleOf('arm_r').role, 'arm');
  assert.equal(roleOf('Layer 7').from, 'position');

  const report = autoRig(doc, alphaOf);
  for (const b of ['hip', 'chest', 'head', 'upperarm_l', 'forearm_l', 'hand_l', 'upperarm_r', 'forearm_r', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'eye_l', 'eye_r', 'mouth']) assert.ok(doc.boneIndex(b) !== null, `bone ${b}`);
  const pose = new Pose(doc);

  // Joints where the parts meet: the elbow between the upper arm and forearm images, the head
  // above the body, the hip low in the body.
  const elbow = head(doc, pose, 'forearm_l');
  assert.ok(Math.abs(elbow[0] - 72) < 4 && elbow[1] > 222 && elbow[1] < 232, `elbow ${elbow}`);
  const neck = head(doc, pose, 'head');
  assert.ok(neck[1] > 300 && neck[1] < 340, `head pivot ${neck}`);
  const hip = head(doc, pose, 'hip');
  assert.ok(hip[1] > 145 && hip[1] < 175, `hip ${hip}`);

  // The single right arm image is split into two bones and weighted across both.
  const armR = report.parts.find((p) => p.name === 'arm_r');
  assert.deepEqual(armR.bones, ['upperarm_r', 'forearm_r']);
  assert.equal(armR.mesh, 'weighted');
  const mesh = doc.slots[doc.slotIndex('arm_r')].attachments[0];
  assert.equal(mesh.type, 'mesh');
  assert.ok(mesh.weights.some((v) => v.length === 2), 'vertices near the elbow blend both bones');
  // The torso bends with the spine.
  assert.equal(report.parts.find((p) => p.name === 'Body').mesh, 'weighted');

  // Every part stays exactly where the artwork put it.
  const before = figure(CHARACTER);
  const poseBefore = new Pose(before.doc);
  for (const [name] of CHARACTER) {
    const s = doc.slotIndex(name);
    const a = outline(doc, pose, s);
    const b = outline(before.doc, poseBefore, s);
    const box = (v) => [Math.min(...v.filter((_, i) => i % 2 === 0)), Math.min(...v.filter((_, i) => i % 2 === 1)), Math.max(...v.filter((_, i) => i % 2 === 0)), Math.max(...v.filter((_, i) => i % 2 === 1))];
    const [ba, bb] = [box(a), box(b)];
    // Meshes hug the opaque pixels and stay inside the image rectangle.
    assert.ok(ba[0] >= bb[0] - 1e-6 && ba[1] >= bb[1] - 1e-6 && ba[2] <= bb[2] + 1e-6 && ba[3] <= bb[3] + 1e-6, `${name} moved: ${ba} vs ${bb}`);
  }

  // IK: the solved setup pose matches the artwork, and pulling a target in bends the joint outward.
  assert.deepEqual(report.ik.sort(), ['ik_foot_l', 'ik_foot_r', 'ik_hand_l', 'ik_hand_r']);
  for (const target of report.ik) {
    const t = doc.boneIndex(target);
    const c = doc.ik.find((k) => k.target === t);
    const [a, b] = c.bones;
    const mid0 = head(doc, pose, doc.bones[b].name);
    const root = pose.world[a].apply([0, 0]);
    const setup = doc.bones[t].setup;
    const saved = { x: setup.x, y: setup.y };
    // Pull the target 30% toward the chain root.
    const goal = pose.world[t].apply([0, 0]);
    const pulled = [goal[0] + (root[0] - goal[0]) * 0.3, goal[1] + (root[1] - goal[1]) * 0.3];
    Object.assign(setup, { x: pulled[0], y: pulled[1] });
    const bent = new Pose(doc);
    const mid = head(doc, bent, doc.bones[b].name);
    Object.assign(setup, saved);
    const outward = root[0] >= 0 ? 1 : -1;
    assert.ok((mid[0] - mid0[0]) * outward > 1, `${target}: middle joint moves outward (${mid0} -> ${mid})`);
  }
  assert.ok(report.warnings.some((w) => w.includes('Layer 7')));
});

test('autorig: refuses rigged projects, honours role overrides', () => {
  const { doc, alphaOf } = figure(CHARACTER);
  autoRig(doc, alphaOf);
  assert.throws(() => autoRig(doc, alphaOf), /already has bones/);
  const second = figure(CHARACTER);
  const r = autoRig(second.doc, second.alphaOf, { roles: { 'Layer 7': 'none', mouth: 'jaw' } });
  assert.equal(second.doc.slots[second.doc.slotIndex('Layer 7')].bone, 0);
  assert.equal(r.parts.find((p) => p.name === 'mouth').role, 'jaw');
});

test('autorig: mouth shapes have no side, accessories ride on their body part', () => {
  const f = figure([
    ...CHARACTER,
    ['mouth_viseme_L', 0, 345, 30, 12],
    ['mouth_viseme_O', 0, 345, 14, 14],
    ['earring_l', 52, 345, 8, 16],
    ['blush', -22, 360, 20, 8],
    ['bindi', 0, 400, 6, 6],
  ]);
  const r = autoRig(f.doc, f.alphaOf);
  const part = (name) => r.parts.find((p) => p.name === name);
  // "_L" on a mouth shape is a name, not a side: every mouth shape shares the one mouth bone.
  assert.equal(part('mouth_viseme_L').side, null);
  assert.equal(part('mouth_viseme_L').bone, part('mouth').bone);
  assert.equal(part('mouth_viseme_O').bone, part('mouth').bone);
  assert.equal(f.doc.bones.some((b) => /mouth_l/.test(b.name)), false);
  // Jewellery and makeup are identified from their names, so nothing is left unknown.
  assert.equal(part('earring_l').role, 'ear');
  assert.equal(part('blush').role, 'head');
  assert.equal(part('bindi').role, 'head');
  assert.equal(r.warnings.some((w) => /earring|blush|bindi/.test(w)), false);
});

// ---- retargeting ------------------------------------------------------------------------------


/** CHARACTER under other layer names, 1.5 times bigger. */
function bigCousin() {
  const rename = { leg_r: 'Right Leg', thigh_l: 'L_Thigh', shin_l: 'L_Calf', foot_l: 'L_Shoe', Body: 'Torso', arm_r: 'R_Arm', upperarm_l: 'L_UpperArm', forearm_l: 'L_LowerArm', hand_l: 'L_Glove', Head: 'Head', eye_l: 'Eye.L', eye_r: 'Eye.R', mouth: 'Mouth', 'Layer 7': 'badge' };
  return figure(CHARACTER.map(([n, x, y, w, h]) => [rename[n], x * 1.5, y * 1.5, Math.round(w * 1.5), Math.round(h * 1.5)]));
}

function rigged(f) {
  autoRig(f.doc, f.alphaOf);
  return f.doc;
}

test('retarget: bone mapping by name and body part', () => {
  const source = rigged(figure(CHARACTER));
  const target = new Skeleton();
  for (const [name, parent] of [['Hips', 0], ['Spine', 1], ['L_UpperArm', 2], ['L_Forearm', 3], ['Hand.L', 4], ['IK_Hand_L', 0], ['Neck', 2]]) target.bones.push(makeBone(name, parent, transform(0, 0, 0), 10));
  const { pairs, unmapped } = mapBones(source, target, { chest: 'Spine' });
  const pair = (s) => {
    const p = pairs.find((q) => source.bones[q.source].name === s);
    return p && `${target.bones[p.target].name} (${p.how})`;
  };
  assert.equal(pair('chest'), 'Spine (manual)');
  assert.equal(pair('hip'), 'Hips (body part)');
  assert.equal(pair('upperarm_l'), 'L_UpperArm (body part)');
  assert.equal(pair('forearm_l'), 'L_Forearm (similar name)');
  assert.equal(pair('hand_l'), 'Hand.L (similar name)');
  assert.equal(pair('ik_hand_l'), 'IK_Hand_L (similar name)');
  assert.equal(pair('root'), 'root (name)');
  assert.ok(unmapped.map((i) => source.bones[i].name).includes('head'));
});

test('retarget: an animation plays on a bigger character with other names', () => {
  const source = rigged(figure(CHARACTER));
  const target = rigged(bigCousin());
  const wave = new Animation('wave', 1);
  const hip = wave.boneTimelineMut(source.boneIndex('hip'));
  setKey(hip.translate, 0, [0, 0]);
  setKey(hip.translate, 0.5, [10, 20], EASE_IN_OUT);
  const arm = wave.boneTimelineMut(source.boneIndex('upperarm_l'));
  setKey(arm.rotate, 0, 0);
  setKey(arm.rotate, 1, 120);
  wave.events.push({ time: 0.5, name: 'hi' });
  source.events.push({ name: 'hi', int: 3, float: 0, string: null, audio: null, volume: 1, balance: 0 });
  source.animations.push(wave);

  const { report } = retarget(source, 'wave', target);
  assert.ok(Math.abs(report.scale - 1.5) < 0.02, `scale ${report.scale}`);
  const out = target.animations.find((a) => a.name === 'wave');
  const tHip = out.boneTimeline(target.boneIndex('hip')).translate;
  assert.ok(Math.abs(tHip[1].value[0] - 15) < 0.4 && Math.abs(tHip[1].value[1] - 30) < 0.4, `hip move ${tHip[1].value}`);
  assert.deepEqual(tHip[1].curve, EASE_IN_OUT);
  assert.equal(out.boneTimeline(target.boneIndex('upperarm_l')).rotate[1].value, 120);
  assert.equal(target.events.find((e) => e.name === 'hi').int, 3);
  assert.throws(() => retarget(source, 'wave', target), /already has an animation 'wave'/);
  retarget(source, 'wave', target, { replace: true, scale: 2 });
  assert.equal(target.animations.filter((a) => a.name === 'wave').length, 1);
});

test('retarget: world mode compensates for different rest poses', () => {
  // The source's arm hangs down in its rest pose; the target's points sideways.
  const source = new Skeleton();
  source.bones.push(makeBone('arm', 0, transform(0, 100, -90), 50));
  const target = new Skeleton();
  target.bones.push(makeBone('Arm', 0, transform(0, 100, 0), 60));
  const anim = new Animation('raise', 1);
  setKey(anim.boneTimelineMut(1).rotate, 1, 30);
  source.animations.push(anim);
  const world = (doc, a) => {
    const p = new Pose(doc);
    p.apply(doc, doc.animations.find((x) => x.name === a), 1, 1);
    p.updateWorld(doc);
    return p.world[1].rotation();
  };
  retarget(source, 'raise', target, { name: 'relative' });
  retarget(source, 'raise', target, { name: 'world', mode: 'world' });
  assert.ok(Math.abs(world(source, 'raise') - -60) < 1e-6);
  assert.ok(Math.abs(world(target, 'relative') - 30) < 1e-6, 'relative: 30 degrees from its own rest pose');
  assert.ok(Math.abs(world(target, 'world') - -60) < 1e-6, 'world: the same direction as the source');
});

test('automatic weights pick the nearest bone even far from every bone', () => {
  const bones = [
    { bone: 1, from: [0, 0], to: [100, 0] },
    { bone: 2, from: [100, 0], to: [200, 0] },
  ];
  // 30 units off the axis, beside the second bone: the raw weights are tiny.
  const [nearest] = autoWeights([[180, 30]], bones)[0];
  assert.equal(nearest.bone, 2);
  assert.ok(nearest.weight > 0.95, `weight ${nearest.weight}`);
});

test('autorig: a hand without a side follows its arm, even across the body', () => {
  // Layers with no side in their names; the right arm (image left) reaches across the body.
  const { doc, alphaOf } = figure([
    ['torso', 0, 230, 110, 170],
    ['head', 0, 370, 100, 100],
    ['upperarm', -70, 270, 24, 70, -60],
    ['forearm', -20, 300, 22, 80, -90],
    ['hand', 30, 300, 30, 30],
  ]);
  const parts = findParts(doc, alphaOf);
  const side = (n) => parts.find((p) => p.name === n).side;
  assert.deepEqual([side('upperarm'), side('forearm'), side('hand')], ['r', 'r', 'r']);
});
