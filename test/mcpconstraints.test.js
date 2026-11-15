// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP constraint tools (add_constraint, set_constraint, delete_constraint), in batch_edit too, and
// rename_bone keeping constraint references.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listConstraints } from '../src/core/constraintdata.js';
import { Pose } from '../src/core/pose.js';
import { createEditTools } from '../src/mcp/edits.js';
import { createFilmTools } from '../src/mcp/film.js';
import { Workspace, createTools, loadProject } from '../src/mcp/tools.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '../..');

async function project() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-mcp-constraints-'));
  const ws = await Workspace.open([tmp]);
  const tools = Object.fromEntries([...createTools(ws), ...createEditTools(ws), ...createFilmTools(ws)].map((t) => [t.name, t.handler]));
  const file = path.join(tmp, 'rigbytron.rigby');
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/rigbytron.rigby'), file);
  // Two plain bones to constrain, so the tests don't depend on the demo's own rig.
  await tools.batch_edit({
    path: file,
    operations: [
      { op: 'add_bone', name: 'a', parent: 'root', x: 100, y: 50, rotation: 20, length: 40 },
      { op: 'add_bone', name: 'b', parent: 'a', x: 40, length: 40 },
      { op: 'add_bone', name: 'aim', parent: 'root', x: 180, y: 120 },
    ],
  });
  return { tmp, tools, file };
}

const doc = async (_ws, file) => (await loadProject(file)).doc;
const worldOf = (sk, name) => new Pose(sk).world[sk.bones.findIndex((b) => b.name === name)];

test('add_constraint: IK, transform (keeping the pose), path, physics per bone and slider', async () => {
  const { tmp, tools, file } = await project();
  const ws = await Workspace.open([tmp]);
  const before = worldOf(await doc(ws, file), 'b');
  await tools.add_constraint({ path: file, type: 'ik', name: 'arm-ik', bones: ['a', 'b'], target: 'aim', settings: { bendPositive: false, softness: 4 } });
  let sk = await doc(ws, file);
  const ik = sk.ik.find((c) => c.name === 'arm-ik');
  assert.deepEqual([ik.bendPositive, ik.softness], [false, 4]);
  assert.deepEqual(ik.bones.map((i) => sk.bones[i].name), ['a', 'b']);
  // The IK chain now reaches for the target: b moved.
  assert.notDeepEqual(worldOf(sk, 'b'), before);

  await tools.delete_constraint({ path: file, constraint: 'arm-ik' });
  const rest = worldOf(await doc(ws, file), 'b');
  await tools.add_constraint({ path: file, type: 'transform', name: 'follow', bones: ['b'], target: 'aim' });
  sk = await doc(ws, file);
  const after = worldOf(sk, 'b');
  for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty']) assert.ok(Math.abs(after[k] - rest[k]) < 1e-3, `transform keeps the pose (${k})`);
  assert.equal(listConstraints(sk).find((c) => c.name === 'follow').data.source, 'aim');

  const r = await tools.add_constraint({ path: file, type: 'physics', name: 'jiggle', bones: ['a', 'b'], settings: { strength: 80 } });
  assert.deepEqual(r.added, ['jiggle1', 'jiggle2']);
  sk = await doc(ws, file);
  const phys = listConstraints(sk).filter((c) => c.type === 'physics');
  assert.deepEqual(phys.map((c) => [c.data.bone, c.data.rotate, c.data.strength]), [['a', 1, 80], ['b', 1, 80]]);

  const anim = sk.animations[0].name;
  await tools.add_constraint({ path: file, type: 'slider', name: 'dial', target: 'aim', settings: { animation: anim } });
  sk = await doc(ws, file);
  const slider = listConstraints(sk).find((c) => c.name === 'dial').data;
  assert.deepEqual([slider.animation, slider.bone], [anim, 'aim']);

  // Errors name the problem and save nothing.
  await assert.rejects(tools.add_constraint({ path: file, type: 'ik', name: 'x', bones: ['a'], target: 'nope' }), /No bone 'nope'/);
  await assert.rejects(tools.add_constraint({ path: file, type: 'ik', name: 'follow', bones: ['a'], target: 'aim' }), /already exists/);
  await assert.rejects(tools.add_constraint({ path: file, type: 'ik', name: 'x', bones: ['aim', 'b'], target: 'a' }), /must be a child/);
  await assert.rejects(tools.add_constraint({ path: file, type: 'path', name: 'p', bones: ['a'], target: 'no-slot' }), /No slot 'no-slot'/);
});

test('set_constraint changes settings, renames and reorders; delete removes keys too', async () => {
  const { tmp, tools, file } = await project();
  const ws = await Workspace.open([tmp]);
  await tools.add_constraint({ path: file, type: 'physics', name: 'p1', bones: ['a'] });
  await tools.add_constraint({ path: file, type: 'transform', name: 't1', bones: ['b'], target: 'aim', keepPose: false, settings: { mixRotate: 0.5, localSource: true } });
  await tools.set_constraint({ path: file, constraint: 't1', settings: { mixRotate: 0.25, localSource: null, clamp: true }, rename: 'follow', order: 0 });
  const sk = await doc(ws, file);
  const list = listConstraints(sk);
  assert.equal(list[0].name, 'follow', 'moved first');
  const d = list[0].data;
  assert.deepEqual([d.mixRotate, d.localSource, d.clamp], [0.25, undefined, true]);
  await assert.rejects(tools.set_constraint({ path: file, constraint: 'follow', settings: { name: 'x' } }), /cannot be changed/);
  await assert.rejects(tools.set_constraint({ path: file, constraint: 'missing' }), /No constraint 'missing'/);
  await tools.delete_constraint({ path: file, constraint: 'follow' });
  assert.deepEqual(listConstraints(await doc(ws, file)).map((c) => c.name).filter((n) => ['follow', 'p1'].includes(n)), ['p1']);
});

test('constraint tools work inside batch_edit, atomically', async () => {
  const { tmp, tools, file } = await project();
  const ws = await Workspace.open([tmp]);
  const stamp = await fs.readFile(file);
  await assert.rejects(
    tools.batch_edit({
      path: file,
      operations: [
        { op: 'add_constraint', type: 'physics', name: 'ok', bones: ['a'] },
        { op: 'add_constraint', type: 'ik', name: 'bad', bones: ['a'], target: 'missing' },
      ],
    }),
    /Operation 2 \(add_constraint\) failed/,
  );
  assert.deepEqual(await fs.readFile(file), stamp, 'nothing saved when an operation fails');
  await tools.batch_edit({
    path: file,
    operations: [
      { op: 'add_constraint', type: 'ik', name: 'arm-ik', bones: ['a', 'b'], target: 'aim' },
      { op: 'set_constraint', constraint: 'arm-ik', settings: { mix: 0.5 } },
    ],
  });
  assert.equal((await doc(ws, file)).ik.find((c) => c.name === 'arm-ik').mix, 0.5);
});

test('rename_bone keeps constraint references', async () => {
  const { tmp, tools, file } = await project();
  const ws = await Workspace.open([tmp]);
  await tools.add_constraint({ path: file, type: 'transform', name: 'follow', bones: ['b'], target: 'aim' });
  await tools.add_constraint({ path: file, type: 'physics', name: 'wobble', bones: ['a'] });
  await tools.rename_bone({ path: file, bone: 'aim', name: 'driver' });
  await tools.rename_bone({ path: file, bone: 'a', name: 'upper' });
  const list = listConstraints(await doc(ws, file));
  assert.equal(list.find((c) => c.name === 'follow').data.source, 'driver');
  assert.equal(list.find((c) => c.name === 'wobble').data.bone, 'upper');
});
