import assert from 'node:assert/strict';
import { test } from 'node:test';

import { invalidateConstraints } from '../src/core/constraints.js';
import { VERSION_FIELD as V, readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import { TURN_SAMPLES, buildTurn, planTurn, regionToGrid, removeTurn, turnOf, turnSlots } from '../src/editor/turn.js';

// A head: back hair, face and front hair (back to front) on a "head" bone, and a body below.
const rig = () => {
  const sk = readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'body', parent: 'root', y: 50 }, { name: 'head', parent: 'body', y: 100 }],
    slots: [
      { name: 'torso', bone: 'body', attachment: 'torso' },
      { name: 'hair back', bone: 'head', attachment: 'hair back' },
      { name: 'face', bone: 'head', attachment: 'face' },
      { name: 'hair front', bone: 'head', attachment: 'hair front' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          torso: { torso: { width: 80, height: 100 } },
          'hair back': { 'hair back': { width: 120, height: 120 } },
          face: { face: { width: 100, height: 110 } },
          'hair front': { 'hair front': { y: 30, width: 110, height: 50 } },
        },
      },
    ],
  }).skeleton;
  return sk;
};

/** World centre of a slot's shown mesh. */
function centre(sk, name) {
  invalidateConstraints(sk);
  const pose = new Pose(sk);
  const s = sk.slots.findIndex((x) => x.name === name);
  const v = pose.worldVertices(sk, s, sk.attachment(s, sk.slots[s].attachment));
  let x = 0;
  for (let i = 0; i < v.length; i += 2) x += v[i];
  return x / (v.length / 2);
}

const setControl = (sk, turn, x) => {
  const b = sk.bones.findIndex((bone) => bone.name === turn.control);
  sk.bones[b].setup = { ...sk.bones[b].setup, x };
};

test('a turn takes the pictures on the bone and its branch, front parts nearest', () => {
  const sk = rig();
  const head = sk.boneIndex('head');
  assert.deepEqual(turnSlots(sk, head).map((s) => sk.slots[s].name), ['hair back', 'face', 'hair front']);
  const turn = planTurn(sk, head);
  assert.deepEqual(turn.parts.map((p) => p.slot), ['hair back', 'face', 'hair front']);
  assert.ok(turn.parts[0].depth < 0 && turn.parts[2].depth > 0, 'back hair far, front hair near');
  assert.ok(Math.abs(turn.radius - 60) < 1e-9);
  assert.equal(planTurn(sk, sk.boneIndex('root')).parts.length, 4, 'the root takes everything');
});

test('the control bone turns the head: front parts one way, back parts the other', () => {
  const sk = rig();
  const turn = buildTurn(sk, planTurn(sk, sk.boneIndex('head')));
  assert.equal(sk.slots[sk.slots.findIndex((s) => s.name === 'face')].attachments[0].type, 'mesh', 'regions became meshes');
  const rest = { back: centre(sk, 'hair back'), face: centre(sk, 'face'), front: centre(sk, 'hair front') };
  assert.ok(Math.abs(rest.face) < 1e-6, 'straight ahead nothing moves');
  setControl(sk, turn, turn.reach);
  const right = { back: centre(sk, 'hair back'), face: centre(sk, 'face'), front: centre(sk, 'hair front') };
  assert.ok(right.front > right.face && right.face > 0, `near parts move right: ${JSON.stringify(right)}`);
  assert.ok(right.back < right.face, 'the back hair moves less (or the other way)');
  setControl(sk, turn, -turn.reach / 2);
  assert.ok(centre(sk, 'face') < 0, 'a half turn left');
  assert.equal(sk.animations.find((a) => a.name === turn.animation).deform[0].keys.length, TURN_SAMPLES);
  assert.deepEqual(turnOf(sk, sk.boneIndex('head'))?.name, turn.name);
});

test('turns export as plain skeleton data and are kept in work files', () => {
  const sk = rig();
  buildTurn(sk, planTurn(sk, sk.boneIndex('head')));
  const json = writeSkeletonJson(sk, { version: '4.3' }).json;
  assert.ok(json.constraints.some((c) => c.type === 'slider' && c.bone === 'head-turn-control'), 'a slider driven by the control bone');
  assert.ok(json.animations['head-turn'].attachments, 'the turn animation with deform keys');
  const again = Skeleton.fromObject(JSON.parse(JSON.stringify(sk.toSnapshot ? JSON.parse(sk.toSnapshot()) : sk)));
  assert.equal(again.turns?.length, 1, 'the work file keeps the turn');
  // Rebuilding replaces, removing takes the skeleton data out and keeps the meshes.
  buildTurn(sk, { ...sk.turns[0], angle: 20 });
  assert.equal(sk.turns.length, 1);
  assert.equal(sk.animations.filter((a) => a.name.startsWith('head-turn')).length, 1);
  assert.ok(removeTurn(sk, 'head-turn'));
  assert.equal(sk.bones.some((b) => b.name === 'head-turn-control'), false);
  assert.equal(sk.turns.length, 0);
  assert.equal(sk.slots[2].attachments[0].type, 'mesh');
});

test('a region becomes a grid mesh covering the same picture', () => {
  const mesh = regionToGrid({ name: 'r', image: 'r', type: 'region', width: 40, height: 20, offset: { x: 10, y: 5, rotation: 0, scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 } }, 4);
  assert.equal(mesh.vertices.length / 2, (4 + 1) * (2 + 1));
  assert.equal(mesh.triangles.length, 4 * 2 * 2 * 3);
  const xs = mesh.vertices.filter((_, i) => i % 2 === 0);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-10, 30]);
  assert.equal(mesh.hull, 12, 'the outline comes first');
});
