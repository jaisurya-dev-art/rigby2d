import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, makeKey, resort, sample, setKey } from '../src/core/animation.js';
import { EASE_IN_OUT, LINEAR, STEPPED, ease } from '../src/core/curve.js';
import { toAffine, transform } from '../src/core/math.js';
import { Skeleton, makeBone } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';

const close = (a, b) => Math.abs(a - b) < 1e-4;

test('curve endpoints and symmetry', () => {
  assert.ok(Math.abs(ease(EASE_IN_OUT, 0)) < 1e-4);
  assert.ok(close(ease(EASE_IN_OUT, 1), 1));
  assert.ok(Math.abs(ease(EASE_IN_OUT, 0.5) - 0.5) < 1e-3);
  assert.ok(ease(EASE_IN_OUT, 0.25) < 0.25);
  assert.equal(ease(STEPPED, 0.99), 0);
});

test('affine inverse and decompose roundtrip', () => {
  const m = toAffine({ x: 3, y: -2, rotation: 37, scale_x: 2, scale_y: 0.5 });
  const p = m.inverse().apply(m.apply([5, 7]));
  assert.ok(close(p[0], 5) && close(p[1], 7));
  const d = toAffine({ x: 1, y: 2, rotation: -120, scale_x: 1.5, scale_y: 0.75 }).decompose();
  assert.ok(close(d.x, 1) && close(d.y, 2) && close(d.rotation, -120));
  assert.ok(close(d.scale_x, 1.5) && close(d.scale_y, 0.75));
  const r = toAffine(transform(0, 0, 90)).apply([1, 0]);
  assert.ok(close(r[0], 0) && close(r[1], 1), 'rotation is counter-clockwise');
});

const keys = () => [makeKey(0, 0, LINEAR), makeKey(1, 10, STEPPED), makeKey(2, 20, LINEAR)];

test('sampling', () => {
  const k = keys();
  assert.equal(sample(k, -1), 0);
  assert.equal(sample(k, 0.5), 5);
  assert.equal(sample(k, 1.5), 10);
  assert.equal(sample(k, 2), 20);
  assert.equal(sample(k, 9), 20);
  assert.equal(sample([], 1), undefined);
});

test('setKey keeps keys sorted and replaces', () => {
  const k = keys();
  assert.equal(setKey(k, 0.5, 3), 1);
  assert.equal(setKey(k, 0.5, 4), 1);
  assert.equal(k.length, 4);
  assert.equal(k[1].value, 4);
});

test('resort after retime', () => {
  const k = keys();
  k[0].time = 1.5;
  assert.equal(resort(k, 0), 1);
  for (let i = 1; i < k.length; i++) assert.ok(k[i - 1].time <= k[i].time);
});

function chain() {
  const sk = new Skeleton();
  const a = sk.addBone(makeBone('a', 0, transform(), 10));
  sk.addBone(makeBone('b', a, transform(), 10));
  sk.addBone(makeBone('c', 0, transform(), 10));
  return sk;
}

test('addBone keeps parent order', () => {
  const sk = chain();
  sk.addBone(makeBone('a2', sk.boneIndex('a'), transform(), 1));
  assert.equal(sk.validate(), null);
  assert.deepEqual(sk.bones.map((b) => b.name), ['root', 'a', 'b', 'a2', 'c']);
});

test('removeBone removes the subtree', () => {
  const sk = chain();
  sk.removeBone(sk.boneIndex('a'));
  assert.deepEqual(sk.bones.map((b) => b.name), ['root', 'c']);
  assert.equal(sk.bones[1].parent, 0);
  assert.equal(sk.validate(), null);
});

test('reparentBone moves the subtree', () => {
  const sk = chain();
  sk.reparentBone(sk.boneIndex('a'), sk.boneIndex('c'));
  assert.equal(sk.validate(), null);
  assert.equal(sk.bones[sk.boneIndex('a')].parent, sk.boneIndex('c'));
  assert.equal(sk.bones[sk.boneIndex('b')].parent, sk.boneIndex('a'));
});

test('json roundtrip', () => {
  const sk = chain();
  const anim = new Animation('wave', 1);
  setKey(anim.boneTimelineMut(1).rotate, 0.5, 12, EASE_IN_OUT);
  sk.animations.push(anim);
  const back = Skeleton.fromJson(sk.toJson());
  assert.equal(back.toJson(), sk.toJson());
  assert.throws(() => Skeleton.fromJson('{"bones": []}'), /no bones/);
  assert.throws(() => Skeleton.fromJson('not json'), /invalid JSON/);
});

test('world transforms follow the chain and animation', () => {
  const sk = new Skeleton();
  const arm = sk.addBone(makeBone('arm', 0, transform(0, 0, 90), 10));
  const hand = sk.addBone(makeBone('hand', arm, transform(10, 0, 0), 5));
  const anim = new Animation('wave', 1);
  const tl = anim.boneTimelineMut(arm);
  setKey(tl.rotate, 0, 0);
  tl.rotate.push(makeKey(1, -90));

  const pose = new Pose(sk);
  let p = pose.world[hand].apply([0, 0]);
  assert.ok(Math.abs(p[0]) < 1e-4 && close(p[1], 10));
  pose.apply(sk, anim, 1, 1);
  pose.updateWorld(sk);
  p = pose.world[hand].apply([0, 0]);
  assert.ok(close(p[0], 10) && Math.abs(p[1]) < 1e-4);
});

test('looping and crossfade', () => {
  const sk = new Skeleton();
  const b = sk.addBone(makeBone('b', 0, transform(), 1));
  for (const [name, v] of [['a', 10], ['c', 30]]) {
    const anim = new Animation(name, 1);
    setKey(anim.boneTimelineMut(b).rotate, 0, v);
    sk.animations.push(anim);
  }
  const st = new AnimationState();
  const pose = new Pose(sk);
  assert.ok(st.play(sk, 'a', true, 0));
  st.update(2.5);
  st.apply(sk, pose);
  assert.equal(pose.local[b].rotation, 10);

  st.play(sk, 'c', true, 1);
  st.update(0.5);
  st.apply(sk, pose);
  assert.ok(close(pose.local[b].rotation, 20));
  st.update(1);
  st.apply(sk, pose);
  assert.equal(pose.local[b].rotation, 30);
});

test('atlas region UVs undo whitespace stripping and rotation', async () => {
  const { regionEntry } = await import('../src/core/draw.js');
  const page = { width: 100, height: 100 };
  // 20x10 image stripped to 16x6 (2 px of whitespace on each side), stored unrotated at (10, 20).
  const plain = regionEntry(null, { x: 10, y: 20, width: 16, height: 6, rotate: 0, offsetX: 2, offsetY: 2, originalWidth: 20, originalHeight: 10 }, page.width, page.height);
  assert.deepEqual(plain.trim.map((v) => +v.toFixed(3)), [0.1, 0.2, 0.9, 0.8]);
  const at = (e, u, v) => e.map(u, v, [0, 0]).map((x) => +(x * 100).toFixed(3));
  assert.deepEqual(at(plain, 0.1, 0.2), [10, 20]); // packed top-left
  assert.deepEqual(at(plain, 0.9, 0.8), [26, 26]); // packed bottom-right
  // Same image stored rotated 90 degrees counter-clockwise: a 6x16 footprint at (40, 50). The
  // image's top-left lands at the footprint's bottom-left, its top-right at the top-left.
  const rotated = regionEntry(null, { x: 40, y: 50, width: 16, height: 6, rotate: 90, offsetX: 2, offsetY: 2, originalWidth: 20, originalHeight: 10 }, page.width, page.height);
  assert.deepEqual(at(rotated, 0.1, 0.2), [40, 66]);
  assert.deepEqual(at(rotated, 0.9, 0.2), [40, 50]);
  assert.deepEqual(at(rotated, 0.9, 0.8), [46, 50]);
});

test('clipping masks triangles to a concave polygon and interpolates UVs', async () => {
  const { Clipper, triangulate } = await import('../src/core/clipping.js');
  // An L shape (concave), clockwise on purpose: area 3.
  const L = [0, 0, 0, 2, 1, 2, 1, 1, 2, 1, 2, 0];
  const tris = triangulate(L);
  assert.equal(tris.length, 4);
  const area = (t) => Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[3] - t[1]) * (t[4] - t[0])) / 2;
  assert.ok(Math.abs(tris.reduce((s, t) => s + area(t), 0) - 3) < 1e-9);

  // A 2x2 quad covering the L: what remains is the L itself (area 3), with UVs following x/y.
  const clipper = new Clipper(L);
  let out = null;
  clipper.clip([0, 0, 2, 0, 2, 2, 0, 2], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3], (p, uv, t) => (out = { p, uv, t }));
  let total = 0;
  for (let i = 0; i < out.t.length; i += 3) {
    const [a, b, c] = [out.t[i], out.t[i + 1], out.t[i + 2]];
    total += area([out.p[2 * a], out.p[2 * a + 1], out.p[2 * b], out.p[2 * b + 1], out.p[2 * c], out.p[2 * c + 1]]);
  }
  assert.ok(Math.abs(total - 3) < 1e-9, String(total));
  for (let k = 0; k < out.p.length; k += 2) {
    assert.ok(Math.abs(out.uv[k] - out.p[k] / 2) < 1e-9 && Math.abs(out.uv[k + 1] - out.p[k + 1] / 2) < 1e-9);
    assert.ok(!(out.p[k] > 1 + 1e-9 && out.p[k + 1] > 1 + 1e-9), 'nothing in the cut-out corner');
  }
});

test('deform keys interpolate between keys along their curve', async () => {
  const { readSkeletonJson, VERSION_FIELD } = await import('../src/core/interop.js');
  const { Pose } = await import('../src/core/pose.js');
  const { skeleton: sk } = readSkeletonJson({
    skeleton: { [VERSION_FIELD]: '4.2.0' },
    bones: [{ name: 'root' }],
    slots: [{ name: 's', bone: 'root', attachment: 'm' }],
    skins: [{ name: 'default', attachments: { s: { m: { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], hull: 3, vertices: [0, 0, 10, 0, 0, 10] } } } }],
    animations: { a: { attachments: { default: { s: { m: { deform: [{ vertices: [0, 0] }, { time: 1, offset: 2, vertices: [4, 8] }] } } } } } },
  });
  const pose = new Pose(sk);
  pose.apply(sk, sk.animations[0], 0.5, 1);
  pose.updateWorld(sk);
  const v = pose.worldVertices(sk, 0, sk.slots[0].attachments[0]);
  assert.deepEqual(v.map((x) => Math.round(x * 1e6) / 1e6), [0, 0, 12, 4, 0, 10]);
});
