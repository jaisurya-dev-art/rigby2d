// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP batch_edit (issue #1): many edits in one atomic call, custom bezier curves, and saving
// that leaves the structure of older files alone.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createEditTools } from '../src/mcp/edits.js';
import { Workspace, createTools, loadProject } from '../src/mcp/tools.js';
import { unzip } from '../src/editor/zip.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '../..');

async function project() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-mcp-batch-'));
  const ws = await Workspace.open([tmp]);
  const tools = Object.fromEntries([...createTools(ws), ...createEditTools(ws)].map((t) => [t.name, t.handler]));
  const file = path.join(tmp, 'rigbytron.rigby');
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/rigbytron.rigby'), file);
  return { tmp, tools, file };
}

/** 40 rotate keys on the head over 2 seconds, alternating easing and a custom curve. */
const KEYS = Array.from({ length: 40 }, (_, i) => ({
  op: 'set_bone_key',
  animation: 'wave',
  bone: 'head',
  channel: 'rotate',
  time: i * 0.05,
  value: Math.sin(i / 3) * 20,
  curve: i % 2 ? 'easeInOut' : [0.25, 0.1, 0.25, 1],
}));

const projectJson = async (file) => JSON.parse(new TextDecoder().decode(unzip(new Uint8Array(await fs.readFile(file))).get('project.json')));

test('batch_edit: an animation with 40 keys in one call, loaded and saved once', async () => {
  const { tools, file } = await project();
  const r = await tools.batch_edit({ path: file, operations: [{ op: 'add_animation', name: 'wave' }, ...KEYS, { op: 'set_event_key', animation: 'wave', event: 'peak', time: 1 }] });
  assert.equal(r.applied, 42);
  assert.deepEqual(r.operations, { add_animation: 1, set_bone_key: 40, set_event_key: 1 });
  const p = await loadProject(file);
  const anim = p.doc.animations.find((a) => a.name === 'wave');
  const keys = anim.boneTimeline(p.doc.boneIndex('head')).rotate;
  assert.equal(keys.length, 40);
  assert.deepEqual(keys[0].curve, { bezier: [0.25, 0.1, 0.25, 1] }, 'custom bezier stored as given');
  assert.deepEqual(keys[1].curve, { bezier: [0.42, 0, 0.58, 1] });
  assert.ok(Math.abs(anim.duration - 1.95) < 1e-9);
  assert.equal(anim.events.length, 1);
});

test('batch_edit: much faster than one call per key, with the same result', async () => {
  // Untimed first: module loading and JIT warm-up would otherwise land on the batch alone.
  const warm = await project();
  await warm.tools.batch_edit({ path: warm.file, operations: [{ op: 'add_animation', name: 'wave' }, ...KEYS] });
  const batch = await project();
  let t = performance.now();
  await batch.tools.batch_edit({ path: batch.file, operations: [{ op: 'add_animation', name: 'wave' }, ...KEYS] });
  const batchMs = performance.now() - t;

  const single = await project();
  t = performance.now();
  await single.tools.add_animation({ path: single.file, name: 'wave' });
  for (const { op: _op, ...k } of KEYS) await single.tools.set_bone_key({ path: single.file, ...k });
  const singleMs = performance.now() - t;

  const keysOf = async (file) => {
    const p = await loadProject(file);
    return p.doc.animations.find((a) => a.name === 'wave').boneTimeline(p.doc.boneIndex('head')).rotate;
  };
  assert.deepEqual(await keysOf(batch.file), await keysOf(single.file), 'identical keys and curves');
  // A clear margin, with room for slow shared CI machines.
  assert.ok(batchMs * 3 < singleMs, `batch ${batchMs.toFixed(0)} ms vs ${singleMs.toFixed(0)} ms one by one`);
});

test('batch_edit: atomic: a failing operation saves nothing and says which one failed', async () => {
  const { tools, file } = await project();
  const before = await fs.readFile(file);
  await assert.rejects(
    tools.batch_edit({ path: file, operations: [{ op: 'add_animation', name: 'wave' }, KEYS[0], { ...KEYS[1], bone: 'tail' }, KEYS[2]] }),
    /Operation 3 \(set_bone_key\) failed, so nothing was saved: No bone 'tail'/,
  );
  assert.deepEqual(await fs.readFile(file), before, 'the file is unchanged');
  // Arguments are checked before the project is touched.
  await assert.rejects(tools.batch_edit({ path: file, operations: [{ op: 'add_animation', name: 'x' }, { op: 'set_bone_key', bone: 'head' }] }), /Operation 2 \(set_bone_key\): 'animation' is required/);
  await assert.rejects(tools.batch_edit({ path: file, operations: [{ op: 'explode' }] }), /Operation 1: unknown op 'explode'/);
  await assert.rejects(tools.batch_edit({ path: file, operations: [{ op: 'add_animation', name: 'x', path: 'other.rigby' }] }), /unknown argument 'path'/);
  await assert.rejects(tools.batch_edit({ path: file, operations: [] }), /'operations' is empty/);
  assert.deepEqual(await fs.readFile(file), before);
});

test('custom bezier curves: validated, and accepted by set_bone_key too', async () => {
  const { tools, file } = await project();
  await tools.add_animation({ path: file, name: 'wave' });
  await tools.set_bone_key({ path: file, animation: 'wave', bone: 'head', channel: 'rotate', time: 0, value: 0, curve: [0.68, -0.55, 0.27, 1.55] });
  const p = await loadProject(file);
  assert.deepEqual(p.doc.animations.find((a) => a.name === 'wave').boneTimeline(p.doc.boneIndex('head')).rotate[0].curve, { bezier: [0.68, -0.55, 0.27, 1.55] });
  await assert.rejects(tools.set_bone_key({ path: file, animation: 'wave', bone: 'head', channel: 'rotate', time: 1, value: 0, curve: [1.2, 0, 0.5, 1] }), /within 0\.\.1/);
  await assert.rejects(tools.set_bone_key({ path: file, animation: 'wave', bone: 'head', channel: 'rotate', time: 1, value: 0, curve: [0.5, 0] }), /four numbers/);
  await assert.rejects(tools.set_bone_key({ path: file, animation: 'wave', bone: 'head', channel: 'rotate', time: 1, value: 0, curve: 'bouncy' }), /Unknown curve 'bouncy'/);
});

test('saving keeps the structure of older files: no settings field is added', async () => {
  const { tools, file } = await project();
  const original = await projectJson(file);
  assert.equal('settings' in original, false, 'the bundled demo predates settings');
  await tools.batch_edit({ path: file, operations: [{ op: 'add_animation', name: 'wave' }, KEYS[0]] });
  const saved = await projectJson(file);
  assert.equal('settings' in saved, false, 'still no settings field');
  assert.deepEqual(Object.keys(saved), Object.keys(original), 'the same top-level fields, in the same order');
});
