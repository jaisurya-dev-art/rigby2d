import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addConstraint } from '../src/core/constraintdata.js';
import { invalidateConstraints } from '../src/core/constraints.js';
import { VERSION_FIELD as V, readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { constraintsKeeping, keepPoseOffsets } from '../src/editor/constraintoffsets.js';

// A two-way control rig: "back" and "front" under a rotated, scaled parent, as in the classic
// transform-constraint setup for weight binding.
const rig = () =>
  readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root', x: 20, y: 40, rotation: 30, scaleX: 1.2 },
      { name: 'front', parent: 'body', x: 120, y: 75, rotation: 15, length: 40 },
      { name: 'back', parent: 'body', x: -150, y: 70, rotation: -40, scaleY: 0.8, length: 30 },
    ],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
  }).skeleton;

const PROPS = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
const allProps = () => Object.fromEntries(PROPS.map((p) => [p, { to: { [p]: {} } }]));

function worldOf(sk, name) {
  invalidateConstraints(sk);
  const m = new Pose(sk).world[sk.boneIndex(name)];
  return [m.a, m.b, m.c, m.d, m.tx, m.ty];
}

function near(a, b, eps = 1e-3) {
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));
}

for (const [label, extra] of [
  ['world', {}],
  ['world, additive', { additive: true }],
  ['local', { localSource: true, localTarget: true }],
  ['local, additive', { localSource: true, localTarget: true, additive: true }],
  ['world, half mix', { mixRotate: 0.5, mixX: 0.5, mixScaleX: 0.5, mixShearY: 0.5 }],
]) {
  test(`a new transform constraint keeps the driven bone in place (${label})`, () => {
    const sk = rig();
    const before = worldOf(sk, 'back');
    const d = addConstraint(sk, { type: 'transform', name: 'follow', bones: ['back'], source: 'front', properties: allProps(), ...extra });
    assert.ok(keepPoseOffsets(sk, d));
    near(worldOf(sk, 'back'), before);
  });
}

test('the driven bone follows its driver after the offsets are kept', () => {
  const sk = rig();
  const d = addConstraint(sk, { type: 'transform', name: 'follow', bones: ['back'], source: 'front', properties: allProps() });
  keepPoseOffsets(sk, d);
  const before = worldOf(sk, 'back');
  sk.bones[sk.boneIndex('front')].setup.x += 25;
  const after = worldOf(sk, 'back');
  assert.ok(Math.abs(after[4] - before[4]) > 1, 'moved with the driver');
});

test('moving the driven bone in the setup pose and keeping the offsets leaves it where it was moved', () => {
  const sk = rig();
  const d = addConstraint(sk, { type: 'transform', name: 'follow', bones: ['back'], source: 'front', properties: allProps() });
  keepPoseOffsets(sk, d);
  const back = sk.bones[sk.boneIndex('back')];
  back.setup = { ...back.setup, x: back.setup.x + 30, rotation: back.setup.rotation + 20 };
  invalidateConstraints(sk);
  const unconstrained = (() => {
    const saved = d.mixRotate;
    d.mixRotate = d.mixX = d.mixY = d.mixScaleX = d.mixScaleY = d.mixShearY = 0;
    const w = worldOf(sk, 'back');
    for (const k of ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY']) delete d[k];
    if (saved !== undefined) d.mixRotate = saved;
    return w;
  })();
  for (const c of constraintsKeeping(sk, 'back')) keepPoseOffsets(sk, c, 'back');
  near(worldOf(sk, 'back'), unconstrained);
});

test('constraintsKeeping lists the transform constraints whose first bone is the given bone', () => {
  const sk = rig();
  addConstraint(sk, { type: 'transform', name: 'a', bones: ['back'], source: 'front' });
  addConstraint(sk, { type: 'transform', name: 'b', bones: ['front'], source: 'back' });
  addConstraint(sk, { type: 'physics', name: 'c', bone: 'back' });
  assert.deepEqual(constraintsKeeping(sk, 'back').map((d) => d.name), ['a']);
  assert.equal(keepPoseOffsets(sk, { type: 'transform', name: 'x', bones: ['missing'], source: 'front' }), false);
});

test('tree Find keeps matching bones and slots with the bones above them; reparenting rules', async () => {
  const { treeMatches, canReparent } = await import('../src/editor/treefind.js');
  const sk = rig();
  assert.equal(treeMatches(sk, '  '), null);
  const keep = treeMatches(sk, 'BACK');
  assert.deepEqual([...keep].map((b) => sk.bones[b].name).sort(), ['back', 'body', 'root']);
  assert.equal(treeMatches(sk, 'nothing').size, 0);
  const body = sk.boneIndex('body');
  const front = sk.boneIndex('front');
  assert.equal(canReparent(sk, front, sk.boneIndex('back')), true);
  assert.equal(canReparent(sk, body, front), false, 'not under its own child');
  assert.equal(canReparent(sk, front, body), false, 'already its parent');
  assert.equal(canReparent(sk, 0, front), false, 'the root stays the root');
});
