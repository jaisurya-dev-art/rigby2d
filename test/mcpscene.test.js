// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP scene tools (src/mcp/scene.js): an assistant builds a scene with two actors, clips and a
// parallax layer, and the work file keeps the characters inside it.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Skeleton } from '../src/core/model.js';
import { createEditTools } from '../src/mcp/edits.js';
import { createSceneTools } from '../src/mcp/scene.js';
import { Workspace, createTools } from '../src/mcp/tools.js';
import { unzip, zip } from '../src/editor/zip.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '../..');

test('add_actor, add_clip, set_actor and set_layer_depth build a scene', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-mcp-scene-'));
  await fs.copyFile(path.join(REPO, 'branding/nila/nila.rigby'), path.join(tmp, 'nila.rigby'));
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/rigbytron.rigby'), path.join(tmp, 'rigbytron.rigby'));
  const stage = new Skeleton();
  await fs.writeFile(path.join(tmp, 'scene.rigby'), zip([{ path: 'project.json', bytes: new TextEncoder().encode(stage.toJson()) }]));
  const ws = await Workspace.open([tmp]);
  const tools = Object.fromEntries([...createTools(ws), ...createEditTools(ws), ...createSceneTools(ws)].map((t) => [t.name, t]));
  const call = (name, args) => tools[name].handler({ path: 'scene.rigby', ...args });

  await call('add_animation', { name: 'shot 1', duration: 2 });
  const nila = await call('add_actor', { character: 'nila.rigby', x: -400, scale: 0.4, animation: 'wave' });
  assert.equal(nila.actor, 'NILA');
  const robo = await call('add_actor', { character: 'rigbytron.rigby', x: 400, flip: true, animation: 'hold', start: 0.5 });
  assert.equal(robo.actor, 'Rigbytron');
  const clip = await call('add_clip', { actor: 'NILA', shot: 'shot 1', animation: 'idle', start: 2.4, loops: 0 });
  assert.equal(clip.clip.blend, 0.25);
  assert.ok(clip.shotDuration >= 2.9); // grew to hold Rigbytron's hold clip (0.5 + 2.4 s)
  await assert.rejects(call('add_clip', { actor: 'NILA', shot: 'shot 1', animation: 'dance', start: 3 }), /no animation 'dance'/);
  await call('set_actor', { actor: 'Rigbytron', y: 20, scale: 0.5 });
  await call('add_bone', { name: 'background', parent: 'root' });
  await call('set_layer_depth', { bone: 'background', depth: 1200 });
  await call('remove_clip', { actor: 'NILA', shot: 'shot 1', start: 2.4 });

  const info = await call('inspect_project', {});
  assert.deepEqual(info.scene.actors.map((a) => a.name), ['NILA', 'Rigbytron']);
  assert.equal(info.scene.depth.background, 1200);
  // The characters travel inside the scene's work file.
  const entries = unzip(await fs.readFile(path.join(tmp, 'scene.rigby')));
  assert.ok(entries.has('actors/nila/project.json'));
  assert.ok(entries.has('actors/rigbytron/project.json'));
  const doc = Skeleton.fromJson(new TextDecoder().decode(entries.get('project.json')));
  const rb = doc.bones[doc.boneIndex('Rigbytron')];
  assert.deepEqual([rb.setup.x, rb.setup.y, rb.setup.scale_x], [400, 20, 0.5]);
  assert.equal(doc.scene.actors[0].clips['shot 1'].length, 1);
});
