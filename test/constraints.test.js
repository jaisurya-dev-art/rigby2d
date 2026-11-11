import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sampleRaw } from '../src/core/constraints.js';
import { VERSION_FIELD as V, readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const pos = (pose, sk, name) => pose.world[sk.bones.findIndex((b) => b.name === name)].apply([0, 0]);
const rot = (pose, sk, name) => pose.world[sk.bones.findIndex((b) => b.name === name)].rotation();

// Hand-written fixtures following the documented formats.
const transformRig = (version, constraint, animations = {}) => ({
  skeleton: { [V]: version },
  bones: [
    { name: 'root' },
    { name: 'driver', parent: 'root', x: 100, y: 50, rotation: 30 },
    { name: 'follower', parent: 'root', x: -40 },
    { name: 'child', parent: 'follower', x: 10 },
  ],
  slots: [],
  ...(version.startsWith('4.3') ? { constraints: [{ type: 'transform', name: 't', ...constraint }] } : { transform: [{ name: 't', ...constraint }] }),
  skins: [{ name: 'default', attachments: {} }],
  animations,
});

test('world transform constraint moves and rotates bones onto the source, children follow', () => {
  for (const [version, data] of [
    ['4.2.0', { bones: ['follower'], target: 'driver', x: 10 }],
    ['4.3.0', { bones: ['follower'], source: 'driver', x: 10, properties: { rotate: { to: { rotate: {} } }, x: { to: { x: {} } }, y: { to: { y: {} } } } }],
    ['3.8.99', { bones: ['follower'], target: 'driver', x: 10, scaleMix: 0, shearMix: 0 }],
  ]) {
    const { skeleton: sk } = readSkeletonJson(transformRig(version, data));
    const pose = new Pose(sk);
    // The offset (10, 0) is in the source bone's space, rotated by 30 degrees.
    const [x, y] = pos(pose, sk, 'follower');
    assert.ok(close(x, 100 + 10 * Math.cos(Math.PI / 6)) && close(y, 50 + 10 * Math.sin(Math.PI / 6)), `${version}: ${x}, ${y}`);
    assert.ok(close(rot(pose, sk, 'follower'), 30), version);
    const [cx, cy] = pos(pose, sk, 'child');
    assert.ok(close(cx, x + 10 * Math.cos(Math.PI / 6)) && close(cy, y + 10 * Math.sin(Math.PI / 6)), `${version} child`);
  }
});

test('transform constraint mixes, local mode and animated mixes', () => {
  const half = readSkeletonJson(transformRig('4.2.0', { bones: ['follower'], target: 'driver', mixRotate: 0, mixX: 0.5 })).skeleton;
  const p = new Pose(half);
  const [x, y] = pos(p, half, 'follower');
  assert.ok(close(x, 30) && close(y, 25), `${x}, ${y}`);
  assert.ok(close(rot(p, half, 'follower'), 0));

  const local = readSkeletonJson(transformRig('4.2.0', { bones: ['follower'], target: 'driver', local: true, relative: true, mixX: 0, mixScaleX: 0, mixShearY: 0 })).skeleton;
  assert.ok(close(rot(new Pose(local), local, 'follower'), 30));

  const animated = readSkeletonJson(
    transformRig('4.2.0', { bones: ['follower'], target: 'driver', mixRotate: 0, mixX: 0 }, { a: { transform: { t: [{ mixRotate: 0, mixX: 0 }, { time: 1, mixRotate: 1, mixX: 1 }] } } }),
  ).skeleton;
  const pose = new Pose(animated);
  pose.apply(animated, animated.animations[0], 0.5, 1);
  pose.updateWorld(animated);
  assert.ok(close(rot(pose, animated, 'follower'), 15));
  assert.ok(close(pos(pose, animated, 'follower')[0], 30));
});

test('constraint data and timelines round-trip unchanged', () => {
  const src = transformRig('4.2.0', { bones: ['follower'], target: 'driver', mixRotate: 0.5 }, { a: { transform: { t: [{ mixRotate: 0 }, { time: 1 }] } } });
  const { skeleton: sk } = readSkeletonJson(structuredClone(src));
  const out = writeSkeletonJson(sk, { version: '4.2' }).json;
  assert.deepEqual(out.transform, src.transform);
  assert.deepEqual(out.animations.a.transform, src.animations.a.transform);
});

test('raw key sampling: absolute 4.x curves, 3.8 curves and stepped keys', () => {
  const read = (k) => [k.v ?? 0];
  // An absolute bezier whose handles lie on the straight line is linear.
  const linear = [{ time: 0, v: 0, curve: [1 / 3, 10 / 3, 2 / 3, 20 / 3] }, { time: 1, v: 10 }];
  assert.ok(close(sampleRaw(linear, 0.25, read)[0], 2.5));
  const ease = [{ time: 0, v: 0, curve: [0.5, 0, 0.5, 10] }, { time: 1, v: 10 }];
  assert.ok(sampleRaw(ease, 0.25, read)[0] < 2.5);
  assert.ok(close(sampleRaw(ease, 0.5, read)[0], 5));
  assert.equal(sampleRaw([{ time: 0, v: 1, curve: 'stepped' }, { time: 1, v: 5 }], 0.9, read)[0], 1);
  assert.ok(close(sampleRaw([{ time: 0, v: 0, curve: 0.25, c2: 0.25, c3: 0.75, c4: 0.75 }, { time: 1, v: 4 }], 0.5, read)[0], 2));
});

// A straight path along +x from (0, 0) to (300, 0): points at x = 0, 150, 300.
const pathVertices = [-50, 0, 0, 0, 50, 0, 100, 0, 150, 0, 200, 0, 250, 0, 300, 0, 350, 0];
const pathRig = (constraint) => ({
  skeleton: { [V]: '4.2.0' },
  bones: [
    { name: 'root' },
    { name: 'a', parent: 'root', y: 40, rotation: 90, length: 50 },
    { name: 'b', parent: 'a', x: 50, length: 50 },
    { name: 'c', parent: 'b', x: 50, length: 50 },
  ],
  slots: [{ name: 'path', bone: 'root', attachment: 'path' }],
  path: [{ name: 'p', bones: ['a', 'b', 'c'], target: 'path', ...constraint }],
  skins: [{ name: 'default', attachments: { path: { path: { type: 'path', vertexCount: 9, vertices: pathVertices, lengths: [150, 300] } } } }],
});

test('path constraint lays a chain along the path', () => {
  const { skeleton: sk } = readSkeletonJson(pathRig({ spacingMode: 'length', rotateMode: 'chain' }));
  const pose = new Pose(sk);
  for (const [name, x] of [['a', 0], ['b', 50], ['c', 100]]) {
    const [px, py] = pos(pose, sk, name);
    assert.ok(close(px, x, 0.5) && close(py, 0, 0.5), `${name}: ${px}, ${py}`);
    assert.ok(close(rot(pose, sk, name), 0, 0.5), `${name} rotation ${rot(pose, sk, name)}`);
  }

  const { skeleton: pct } = readSkeletonJson(pathRig({ spacingMode: 'percent', spacing: 0.25, position: 0.25, rotateMode: 'chainScale' }));
  const p2 = new Pose(pct);
  for (const [name, x] of [['a', 75], ['b', 150], ['c', 225]]) {
    const [px, py] = pos(p2, pct, name);
    assert.ok(close(px, x, 0.5) && close(py, 0, 0.5), `${name}: ${px}, ${py}`);
  }
  // chainScale stretches each 50-long bone to the 75 gap.
  const a = p2.world[1];
  assert.ok(close(Math.hypot(a.a, a.b), 1.5, 1e-2));
});

// A bone pointing up from a movable root, with rotation physics.
const physicsRig = (constraint) =>
  readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'hair', parent: 'root', rotation: 90, length: 100 }],
    slots: [],
    constraints: [{ type: 'physics', name: 'p', bone: 'hair', rotate: 1, ...constraint }],
    skins: [{ name: 'default', attachments: {} }],
  }).skeleton;

function simulate(sk, pose, seconds, move = () => {}) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    pose.reset(sk);
    move(pose, t);
    pose.physicsDelta = 1 / 60;
    pose.updateWorld(sk);
  }
  return rot(pose, sk, 'hair');
}

test('physics: no simulated time means no effect', () => {
  const sk = physicsRig({});
  assert.ok(close(rot(new Pose(sk), sk, 'hair'), 90));
});

test('physics: a bone lags when its parent moves, then settles back', () => {
  const sk = physicsRig({});
  const pose = new Pose(sk);
  const lagging = simulate(sk, pose, 0.2, (p, t) => (p.local[0].x = Math.min(1, t / 0.1) * 100));
  // Moving right leaves the tip behind (to the left): the bone tilts counter-clockwise.
  assert.ok(lagging > 95, `lagging rotation ${lagging}`);
  const settled = simulate(sk, pose, 5, (p) => (p.local[0].x = 100));
  assert.ok(Math.abs(settled - 90) < 0.5, `settled rotation ${settled}`);
});

test('physics: wind and gravity push the tip; mix 0 turns it off', () => {
  const windy = physicsRig({ wind: 20 });
  const bent = simulate(windy, new Pose(windy), 5);
  assert.ok(bent < 85, `wind toward +X bends the upright bone clockwise: ${bent}`);
  const heavy = physicsRig({ gravity: 20 });
  heavy.bones[1].setup.rotation = 0; // pointing right
  assert.ok(simulate(heavy, new Pose(heavy), 5) < -5, 'gravity pulls the tip down');
  const off = physicsRig({ wind: 20, mix: 0 });
  assert.ok(close(simulate(off, new Pose(off), 2), 90));
});

test('sequence frames: hold, loop, once reverse and inherited delays', async () => {
  const { sequenceFrameName, sequenceIndexAt } = await import('../src/core/sequence.js');
  assert.equal(sequenceFrameName({ image: 'wing', sequence: { count: 9, digits: 2 } }, 0), 'wing01');
  assert.equal(sequenceFrameName({ image: 'top-', sequence: { count: 7, start: 0 } }, 6), 'top-6');
  const keys = [{ mode: 'loop', delay: 0.1 }, { time: 1, mode: 'onceReverse' }, { time: 2, index: 3 }];
  assert.equal(sequenceIndexAt(keys, 0.25, 4), 2);
  assert.equal(sequenceIndexAt(keys, 0.45, 4), 0); // looped around
  assert.equal(sequenceIndexAt(keys, 1.15, 4), 2); // reverse from the last frame, delay kept from the first key
  assert.equal(sequenceIndexAt(keys, 1.9, 4), 0); // stops at the first frame
  assert.equal(sequenceIndexAt(keys, 5, 4), 3); // hold
  assert.equal(sequenceIndexAt([{ time: 1 }], 0.5, 4), null);
});

test('slider constraint drives an animation from a bone rotation', () => {
  const { skeleton: sk } = readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'dial', parent: 'root', rotation: 90 }, { name: 'arm', parent: 'root' }],
    slots: [],
    constraints: [{ type: 'slider', name: 's', animation: 'raise', bone: 'dial', property: 'rotate', scale: 1 / 180, local: true }],
    skins: [{ name: 'default', attachments: {} }],
    animations: { raise: { bones: { arm: { rotate: [{ value: 0 }, { time: 1, value: 100 }] } } } },
  });
  // A 90 degree dial is half a second into the one-second animation.
  assert.ok(close(rot(new Pose(sk), sk, 'arm'), 50));
  sk.bones[1].setup.rotation = 180;
  assert.ok(close(rot(new Pose(sk), sk, 'arm'), 100));
});

test('a sequence is read from the name of one of its frames', async () => {
  const { inferSequence, sequenceFrameName } = await import('../src/core/sequence.js');
  const images = new Set(['guy-01', 'guy-02', 'guy-03', 'fire0', 'fire1', 'fire2', 'wing7']);
  const has = (n) => images.has(n);
  assert.deepEqual(inferSequence('guy-01', has), { base: 'guy-', start: 1, digits: 2, count: 3, setup: 0 });
  assert.deepEqual(inferSequence('guy-02', has), { base: 'guy-', start: 1, digits: 2, count: 3, setup: 1 });
  assert.deepEqual(inferSequence('fire1', has), { base: 'fire', start: 0, digits: 0, count: 3, setup: 1 });
  assert.equal(inferSequence('guy', has), null);
  const one = inferSequence('wing7', has);
  assert.equal(one.count, 2);
  const att = { image: 'guy-', sequence: { count: 3, digits: 2 } };
  assert.deepEqual([0, 1, 2].map((i) => sequenceFrameName(att, i)), ['guy-01', 'guy-02', 'guy-03']);
});

test('a stretching two-bone IK reaches a target out of reach, bent or straight', () => {
  for (const [tx, ty, bent] of [[500, 200, 0], [500, 0, 40], [300, 400, 0], [600, -50, -30]]) {
    const { skeleton: sk } = readSkeletonJson({
      skeleton: { [V]: '4.2.0' },
      bones: [{ name: 'root' }, { name: 'a', parent: 'root', length: 100 }, { name: 'b', parent: 'a', x: 100, rotation: bent, length: 100 }, { name: 't', parent: 'root', x: tx, y: ty }],
      slots: [],
      ik: [{ name: 'ik', bones: ['a', 'b'], target: 't', stretch: true }],
    });
    const pose = new Pose(sk);
    const [x, y] = pose.world[2].apply([100, 0]);
    assert.ok(close(x, tx, 1e-6) && close(y, ty, 1e-6), `tip ${x}, ${y} for target ${tx}, ${ty}`);
  }
});
