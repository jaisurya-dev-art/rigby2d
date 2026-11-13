import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, setKey } from '../src/core/animation.js';
import { VERSION_FIELD as V, readSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import { regionToGrid } from '../src/editor/turn.js';
import { applyToSetup, bakeWarps, createWarp, keyWarp, latticePoints, latticeWeights, pointsOf, removeWarp, resizeWarp, warpDeltas } from '../src/editor/warp.js';

// A face (100 x 100) and an eye on a rotated head bone; both grid meshes.
const rig = () => {
  const sk = readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'head', parent: 'root', x: 20, y: 100, rotation: 10 }],
    slots: [
      { name: 'face', bone: 'head', attachment: 'face' },
      { name: 'eye', bone: 'head', attachment: 'eye' },
    ],
    skins: [{ name: 'default', attachments: { face: { face: { width: 100, height: 100 } }, eye: { eye: { x: 20, y: 10, width: 20, height: 10 } } } }],
  }).skeleton;
  for (const s of sk.slots) s.attachments[0] = regionToGrid(s.attachments[0], 4);
  return sk;
};

const world = (sk, slot) => {
  const p = new Pose(sk);
  const v = p.worldVertices(sk, slot, sk.attachment(slot, sk.slots[slot].attachment));
  return v;
};

test('a lattice covers its meshes; weights at a lattice point are that point', () => {
  const sk = rig();
  const w = createWarp(sk, { name: 'face-warp', bone: sk.boneIndex('head'), slots: [0, 1], cols: 3, rows: 2 });
  assert.equal(pointsOf(w), 12);
  assert.ok(w.rect.x < -50 && w.rect.x + w.rect.w > 50, 'around the face, with a margin');
  const pts = latticePoints(w);
  const ws = latticeWeights(w, ...pts[5]);
  const total = ws.reduce((s, [, x]) => s + x, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.deepEqual(ws.filter(([, x]) => x > 1e-9).map(([i]) => i), [5]);
});

test('moving lattice points bends the meshes, linearly; nested lattices add up', () => {
  const sk = rig();
  const head = sk.boneIndex('head');
  const w = createWarp(sk, { name: 'face-warp', bone: head, slots: [0], cols: 2, rows: 2 });
  const off = new Array(pointsOf(w) * 2).fill(0);
  off[2 * 8] = 10; // the top right point, 10 along the bone's x
  const one = warpDeltas(sk, w, new Map([[w.name, off]]))[0].deltas;
  const two = warpDeltas(sk, w, new Map([[w.name, off.map((v) => v * 2)]]))[0].deltas;
  assert.ok(one.some((v) => Math.abs(v) > 1), 'something moved');
  one.forEach((v, i) => assert.ok(Math.abs(two[i] - 2 * v) < 1e-9, 'linear'));
  // A child lattice over the eye, inside the face's: the parent's motion carries the eye.
  const child = createWarp(sk, { name: 'eye-warp', bone: head, slots: [1], cols: 1, rows: 1, parent: 'face-warp' });
  const viaParent = warpDeltas(sk, child, new Map([[w.name, off]]))[0].deltas;
  assert.ok(viaParent.some((v) => Math.abs(v) > 0.5), 'the parent moves the child');
  const childOff = new Array(pointsOf(child) * 2).fill(0).map((_, i) => (i % 2 ? 3 : 0));
  const both = warpDeltas(sk, child, new Map([[w.name, off], [child.name, childOff]]))[0].deltas;
  const alone = warpDeltas(sk, child, new Map([[child.name, childOff]]))[0].deltas;
  both.forEach((v, i) => assert.ok(Math.abs(v - (viaParent[i] + alone[i])) < 1e-9, 'parent + child'));
});

test('resizing a lattice keeps its deformation', () => {
  const sk = rig();
  const w = createWarp(sk, { name: 'face-warp', bone: sk.boneIndex('head'), slots: [0], cols: 2, rows: 2 });
  const off = new Array(pointsOf(w) * 2).fill(0).map((_, i) => (i === 8 ? 6 : 0));
  keyWarp(w, 'a', 0, off);
  const before = warpDeltas(sk, w, new Map([[w.name, w.keys.a[0].offsets]]))[0].deltas;
  resizeWarp(w, 4, 4);
  const after = warpDeltas(sk, w, new Map([[w.name, w.keys.a[0].offsets]]))[0].deltas;
  before.forEach((v, i) => assert.ok(Math.abs(after[i] - v) < 1e-6, `vertex value ${i}: ${after[i]} vs ${v}`));
  assert.equal(w.keys.a[0].offsets.length, 25 * 2);
});

test('warps bake into deform keys: added to the mesh\'s own keys, never twice, and taken out again', () => {
  const sk = rig();
  const anim = new Animation('look', 1);
  // The face has its own deform key: everything up 5 at time 1 (in the bone's space).
  const n = sk.attachment(0, 'face').vertices.length;
  const own = { slot: 0, attachment: 'face', skin: null, keys: [] };
  setKey(own.keys, 0, { offset: 0, vertices: new Array(n).fill(0) });
  setKey(own.keys, 1, { offset: 0, vertices: new Array(n).fill(0).map((_, i) => (i % 2 ? 5 : 0)) });
  anim.deform.push(own);
  sk.animations.push(anim);
  const w = createWarp(sk, { name: 'face-warp', bone: sk.boneIndex('head'), slots: [0], cols: 1, rows: 1 });
  const shift = new Array(pointsOf(w) * 2).fill(0).map((_, i) => (i % 2 ? 0 : 7)); // all points 7 along x
  keyWarp(w, 'look', 0, new Array(pointsOf(w) * 2).fill(0));
  keyWarp(w, 'look', 1, shift);
  assert.equal(bakeWarps(sk), 1);
  const at1 = () => sk.animations[0].deform[0].keys.at(-1).value.vertices;
  assert.ok(Math.abs(at1()[0] - 7) < 1e-6 && Math.abs(at1()[1] - 5) < 1e-6, `own + warp: ${at1().slice(0, 2)}`);
  bakeWarps(sk);
  assert.ok(Math.abs(at1()[0] - 7) < 1e-6, 'baking again does not add the warp twice');
  // Kept through a work file save and load.
  const again = Skeleton.fromObject(JSON.parse(sk.toSnapshot()));
  assert.equal(again.warps.length, 1);
  assert.equal(Object.keys(again.warpBase).length, 1);
  // Removing the warp gives the mesh its own keys back.
  removeWarp(sk, 'face-warp');
  bakeWarps(sk);
  assert.ok(Math.abs(at1()[0]) < 1e-9 && Math.abs(at1()[1] - 5) < 1e-9, 'own keys back');
  assert.deepEqual(sk.warpBase, {});
});

test('in Setup mode a lattice edit reshapes the meshes for good', () => {
  const sk = rig();
  const before = world(sk, 0);
  const w = createWarp(sk, { name: 'face-warp', bone: sk.boneIndex('head'), slots: [0], cols: 1, rows: 1 });
  applyToSetup(sk, w, new Array(pointsOf(w) * 2).fill(0).map((_, i) => (i % 2 ? 4 : 0)));
  const after = world(sk, 0);
  // 4 along the head bone's y, which is rotated 10°.
  const dy = after[1] - before[1];
  const dx = after[0] - before[0];
  assert.ok(Math.abs(Math.hypot(dx, dy) - 4) < 1e-6 && Math.abs(Math.atan2(dy, dx) * 180 / Math.PI - 100) < 1e-6);
});
