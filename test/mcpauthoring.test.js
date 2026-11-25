// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP authoring tools: constraint and IK target keys, world to local, skins and attachment copies,
// meshes and weights, physics baking and animation lint, on copies of the Rigbytron project.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { authoringReadTools } from '../src/mcp/authoring.js';
import { createEditTools } from '../src/mcp/edits.js';
import { Workspace, createTools } from '../src/mcp/tools.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '../..');

async function project() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-mcp-author-'));
  const ws = await Workspace.open([tmp]);
  const tools = Object.fromEntries([...createTools(ws), ...createEditTools(ws), ...authoringReadTools(ws)].map((t) => [t.name, t.handler]));
  const file = path.join(tmp, 'rigbytron.rigby');
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/rigbytron.rigby'), file);
  return { tmp, tools, file };
}

test('mcp authoring: constraint keys, IK target keys and world to local', async () => {
  const { tools, file } = await project();
  await tools.add_constraint({ path: file, type: 'ik', name: 'arm', bones: ['upperarm_r', 'forearm_r'], target: 'fx' });
  const ik = await tools.set_constraint_key({ path: file, animation: 'hold', constraint: 'arm', time: 0.5, values: { mix: 0.25 }, curve: 'easeIn' });
  assert.equal(ik.type, 'ik');
  await assert.rejects(tools.set_constraint_key({ path: file, animation: 'hold', constraint: 'arm', time: 0, values: { wind: 1 } }), /no keyable value 'wind'/);
  await assert.rejects(tools.set_constraint_key({ path: file, animation: 'hold', constraint: 'arm', time: 0, values: { mix: 'a' } }), /must be a number/);

  await tools.add_constraint({ path: file, type: 'physics', name: 'antenna', bones: ['head'] });
  await tools.set_constraint_key({ path: file, animation: 'hold', constraint: 'antenna', time: 0, values: { wind: 2, mix: 1 } });
  await tools.set_constraint_key({ path: file, animation: 'hold', constraint: 'antenna', time: 1, values: { wind: 8 }, curve: 'stepped' });

  // The IK target reaches a world point: world_to_local in the target's parent space agrees.
  const key = await tools.set_ik_target_key({ path: file, animation: 'hold', constraint: 'arm', time: 1, world_point: [120, 340] });
  assert.equal(key.bone, 'fx');
  const pose = await tools.sample_pose({ path: file, animation: 'hold', time: 1 });
  const hand = pose.bones.find((b) => b.name === 'fx');
  assert.ok(Math.hypot(hand.x - 120, hand.y - 340) < 0.01, `hand at ${hand.x}, ${hand.y}`);
  const local = await tools.world_to_local({ path: file, bone: 'fx', point: [120, 340], animation: 'hold', time: 1 });
  assert.ok(Math.hypot(...local.point) < 0.01, 'the point is the bone origin');
  await assert.rejects(tools.set_ik_target_key({ path: file, animation: 'hold', constraint: 'antenna', time: 0, world_point: [0, 0] }), /not IK/);
});

test('mcp authoring: skins and attachment copies', async () => {
  const { tools, file } = await project();
  await tools.add_skin({ path: file, name: 'gold' });
  await assert.rejects(tools.add_skin({ path: file, name: 'gold' }), /already exists/);
  const copy = await tools.duplicate_attachment({ path: file, slot: 'head', attachment: 'head', new_name: 'head', target_skin: 'gold' });
  assert.equal(copy.skin, 'gold');
  const alt = await tools.duplicate_attachment({ path: file, slot: 'head', attachment: 'head', new_name: 'head_alt' });
  assert.equal(alt.skin, 'default');
  await tools.add_skin({ path: file, name: 'silver', copy_from: 'gold' });
  let rig = await tools.describe_rig({ path: file });
  assert.deepEqual(rig.skins.map((s) => s.name).sort(), ['gold', 'silver']);
  await tools.delete_skin({ path: file, name: 'gold' });
  rig = await tools.describe_rig({ path: file });
  assert.deepEqual(rig.skins.map((s) => s.name), ['silver']);
});

test('mcp authoring: meshes from the image outline or a grid, weights and smoothing', async () => {
  const { tools, file } = await project();
  const outline = await tools.make_mesh({ path: file, slot: 'torso', attachment: 'torso' });
  assert.equal(outline.mode, 'outline');
  assert.ok(outline.vertices >= 24, `${outline.vertices} vertices`);
  await assert.rejects(tools.make_mesh({ path: file, slot: 'torso', attachment: 'torso' }), /only region attachments/);
  const grid = await tools.make_mesh({ path: file, slot: 'head', attachment: 'head', mode: 'grid', spacing: 40 });
  assert.ok(grid.vertices > 4 && grid.triangles > 2);

  // Making a mesh leaves the art where it was.
  const before = await tools.sample_pose({ path: file });
  const bound = await tools.auto_weight({ path: file, slot: 'torso', attachment: 'torso', bones: ['hip', 'chest'] });
  assert.equal(bound.vertices, outline.vertices);
  const set = await tools.set_weights({ path: file, slot: 'torso', attachment: 'torso', vertices: [0], weights: [[{ bone: 'chest', weight: 3 }, { bone: 'hip', weight: 1 }]] });
  assert.equal(set.vertices, 1);
  await assert.rejects(tools.set_weights({ path: file, slot: 'torso', attachment: 'torso', vertices: [0], weights: [[{ bone: 'chest', weight: 0 }]] }), /at least one weight/);
  const smooth = await tools.smooth_weights({ path: file, slot: 'torso', attachment: 'torso', iterations: 3 });
  assert.equal(smooth.iterations, 3);
  await assert.rejects(tools.smooth_weights({ path: file, slot: 'head', attachment: 'head' }), /not weighted/);
  const after = await tools.sample_pose({ path: file });
  assert.deepEqual(after.bones, before.bones, 'weights never move bones');

  // A skeleton export has no pixels: outline meshes need a work file, grids don't.
  const json = path.join(path.dirname(file), 'rigbytron.json');
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/export/rigbytron.json'), json);
  await assert.rejects(tools.make_mesh({ path: json, slot: 'torso', attachment: 'torso' }), /work files hold/);
  assert.ok((await tools.make_mesh({ path: json, slot: 'torso', attachment: 'torso', mode: 'grid' })).vertices > 4);
});

test('mcp authoring: bake physics into keys, and lint animations', async () => {
  const { tools, file } = await project();
  await tools.add_constraint({ path: file, type: 'physics', name: 'fx', bones: ['fx'], settings: { rotate: 1, gravity: 30 } });
  const baked = await tools.bake_physics({ path: file, animation: 'hold', fps: 24 });
  assert.deepEqual(baked.bones, ['fx']);
  assert.equal(baked.frames, Math.round(2.4 * 24) + 1);
  assert.equal(baked.disabled, true);
  const anim = await tools.describe_animation({ path: file, animation: 'hold' });
  assert.ok(JSON.stringify(anim).includes('fx'), 'the baked bone has keys');
  await assert.rejects(tools.bake_physics({ path: file, animation: 'hold', constraints: ['nope'] }), /No physics constraint 'nope'/);

  const lint = await tools.lint_animations({ path: file, loop: true, jump_threshold: 1 });
  assert.ok(lint.count > 0);
  assert.ok(lint.warnings.every((w) => typeof w.code === 'string' && w.animation));
  const quiet = await tools.lint_animations({ path: file, animation: 'hold', loop: false, jump_threshold: 1e6, rotation_threshold: 1e6 });
  assert.equal(quiet.warnings.filter((w) => w.code === 'frame_jump').length, 0);
});
