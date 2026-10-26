// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tools for project features: workspace and output settings, poses and face controls, audio
// tracks and lip-sync, renames, slots and Python scripts, on copies of the Rigbytron project.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createEditTools } from '../src/mcp/edits.js';
import { createFilmTools, decodeWav } from '../src/mcp/film.js';
import { createScriptTools } from '../src/mcp/scripting.js';
import { Workspace, createTools } from '../src/mcp/tools.js';
import { unzip } from '../src/editor/zip.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '../..');

async function project() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-mcp-film-'));
  const ws = await Workspace.open([tmp]);
  const tools = Object.fromEntries([...createTools(ws), ...createEditTools(ws), ...createFilmTools(ws), ...createScriptTools(ws)].map((t) => [t.name, t.handler]));
  const file = path.join(tmp, 'rigbytron.rigby');
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/rigbytron.rigby'), file);
  return { tmp, tools, file };
}

const bone = (pose, name) => pose.bones.find((b) => b.name === name);

/** 16-bit mono WAV: `silent` seconds of silence, then `loud` seconds of a 220 Hz tone. */
function wav(silent, loud, rate = 16000) {
  const n = Math.round((silent + loud) * rate);
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = Math.round(silent * rate); i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 20000), true);
  return bytes;
}

test('mcp film: workspace and output settings live in work files', async () => {
  const { tools, file, tmp } = await project();
  await tools.set_workspace({ path: file, workspace: 'film' });
  const out = await tools.set_output({ path: file, fps: 23.976, width: 2048, height: 858, background: '#102030', framing: 'fixed', frame_x: 10, frame_y: 300, frame_scale: 0.5 });
  delete out.file;
  assert.deepEqual(out, { fps: 23.976, width: 2048, height: 858, background: '#102030', framing: 'fixed', frame: { x: 10, y: 300, scale: 0.5 } });
  const camera = await tools.set_output({ path: file, framing: 'camera' });
  assert.equal(camera.framing, 'camera');
  const info = await tools.inspect_project({ path: file });
  assert.equal(info.workspace, 'film');
  assert.equal(info.film.output.fps, 23.976);
  assert.ok((await tools.describe_rig({ path: file })).bones.some((b) => b.name === 'camera'), 'camera framing adds a camera bone');
  await assert.rejects(tools.set_output({ path: file, background: 'red' }), /transparent' or a #rrggbb/);

  const json = path.join(tmp, 'rigbytron.json');
  await fs.copyFile(path.join(REPO, 'branding/rigbytron/export/rigbytron.json'), json);
  await assert.rejects(tools.set_workspace({ path: json, workspace: 'film' }), /stored only in \.rigby work files/);
});

test('mcp film: poses and face controls, in the setup pose and as keys', async () => {
  const { tools, file } = await project();
  const setup = await tools.sample_pose({ path: file });
  const head0 = bone(setup, 'head').rotation;

  // A pose: head turned 30 degrees, hand showing its second image.
  await tools.set_bone_setup({ path: file, bone: 'head', rotation: (await tools.describe_rig({ path: file })).bones.find((b) => b.name === 'head').rotation + 30 });
  await tools.set_slot({ path: file, slot: 'hand', attachment: 'hand_e' });
  const saved = await tools.save_pose({ path: file, name: 'look', bones: ['head', 'hand_r'] });
  assert.equal(saved.bones, 2);
  assert.ok(saved.slots >= 1, 'the slots on those bones');
  assert.ok((await tools.inspect_project({ path: file })).film.poses[0].slots.includes('hand'));
  await assert.rejects(tools.save_pose({ path: file, name: 'look' }), /replace: true/);
  // Back to the original setup pose with the second pose.
  await tools.set_bone_setup({ path: file, bone: 'head', rotation: (await tools.describe_rig({ path: file })).bones.find((b) => b.name === 'head').rotation - 30 });
  await tools.set_slot({ path: file, slot: 'hand', attachment: 'hand' });

  // Apply at 0.4: rotation 40% of the way, image not switched yet.
  await tools.apply_pose({ path: file, pose: 'look', amount: 0.4 });
  let pose = await tools.sample_pose({ path: file });
  assert.ok(Math.abs(bone(pose, 'head').rotation - head0 - 12) < 1e-6);
  assert.equal(pose.slots.find((s) => s.name === 'hand').attachment, 'hand');

  // A face control keyed in an animation at frame 30 (1 s at 30 fps).
  await tools.add_face_control({ path: file, name: 'turn', to: 'look' });
  await tools.set_face_control({ path: file, control: 'turn', value: 1, animation: 'hold', frame: 30 });
  pose = await tools.sample_pose({ path: file, animation: 'hold', time: 1 });
  assert.equal(pose.slots.find((s) => s.name === 'hand').attachment, 'hand_e');
  const keys = (await tools.describe_animation({ path: file, animation: 'hold' })).bones.find((b) => b.bone === 'head').keys;
  assert.ok(keys.rotate.includes(1));

  const info = await tools.inspect_project({ path: file });
  assert.deepEqual(info.film.faceControls, [{ name: 'turn', from: 'setup pose', to: 'look', value: 1 }]);
  const del = await tools.delete_pose({ path: file, name: 'look' });
  assert.deepEqual(del.faceControlsDeleted, ['turn']);
});

test('mcp film: audio tracks are stored in the work file and drive lip-sync', async () => {
  const { tools, file, tmp } = await project();
  await fs.writeFile(path.join(tmp, 'line.wav'), wav(1, 1));
  assert.equal(decodeWav(wav(0.5, 0.5)).length, 16000);

  await tools.save_pose({ path: file, name: 'open', bones: ['head'] });
  await tools.add_face_control({ path: file, name: 'mouth', to: 'open' });
  const added = await tools.add_audio_track({ path: file, audio_file: 'line.wav', animation: 'hold', offset: 0 });
  assert.equal(added.sound, 'line.wav');
  assert.ok(unzip(new Uint8Array(await fs.readFile(file))).has('audio/line.wav'));
  await tools.set_audio_track({ path: file, sound: 'line.wav', animation: 'hold', volume: 0.8 });

  // Lip-sync: closed for the first second (silence), open for the next (tone), closed after the
  // sound ends at 2 s (the animation is 2.4 s).
  const r = await tools.lip_sync({ path: file, control: 'mouth', animation: 'hold' });
  assert.equal(r.frames, 73);
  assert.ok(r.framesOpen >= 28 && r.framesOpen <= 33, `framesOpen ${r.framesOpen}`);
  const keys = (await tools.describe_animation({ path: file, animation: 'hold' })).bones.find((b) => b.bone === 'head').keys;
  assert.equal(keys.rotate.length, 73);

  // Viseme lip-sync from a timing file (no audio decoding needed), on a slot with named images.
  await fs.writeFile(path.join(tmp, 'line.json'), JSON.stringify([{ word: 'hi', start: 1.0, end: 1.3 }, { word: 'me', start: 1.5, end: 1.9 }]));
  const v = await tools.lip_sync({ path: file, animation: 'hold', timing_file: 'line.json', slot: 'hand', mouths: { A: 'hand_e', rest: 'hand' } });
  assert.equal(v.mode, 'visemes');
  assert.equal(v.slot, 'hand');
  assert.ok(v.keys >= 2, `keys ${v.keys}`);
  const handKeys = (await tools.describe_animation({ path: file, animation: 'hold' })).slots.find((s) => s.slot === 'hand');
  assert.ok(handKeys, 'the hand slot has attachment keys now');
  // Text is timed against the WAV's loudness.
  const t = await tools.lip_sync({ path: file, animation: 'hold', text: 'hi there', slot: 'hand', mouths: { A: 'hand_e', rest: 'hand' } });
  assert.match(t.source, /2 words, timed by loudness/);
  await assert.rejects(tools.lip_sync({ path: file, animation: 'hold', timing_file: 'line.json', slot: 'hand', mouths: { A: 'nope' } }), /has no image 'nope'/);
  await assert.rejects(tools.lip_sync({ path: file, animation: 'hold' }), /Give text or timing_file/);

  const removed = await tools.remove_audio_track({ path: file, sound: 'line.wav', animation: 'hold' });
  assert.equal(removed.fileRemoved, true);
  assert.ok(!unzip(new Uint8Array(await fs.readFile(file))).has('audio/line.wav'));
  await fs.writeFile(path.join(tmp, 'notes.txt'), 'x');
  await assert.rejects(tools.add_audio_track({ path: file, audio_file: 'notes.txt', animation: 'hold' }), /Unsupported sound file/);
});

test('mcp film: rename and delete, slots', async () => {
  const { tools, file } = await project();
  await tools.save_pose({ path: file, name: 'p', bones: ['head'] });
  await tools.rename_bone({ path: file, bone: 'head', name: 'skull' });
  assert.deepEqual((await tools.inspect_project({ path: file })).film.poses[0].bones, ['skull']);
  await tools.rename_animation({ path: file, animation: 'hold', name: 'idle' });
  const del = await tools.delete_animation({ path: file, animation: 'release' });
  assert.deepEqual(del.animations, ['idle']);
  const slot = await tools.set_slot({ path: file, slot: 'torso', color: '#ff000080' });
  assert.equal(slot.color, '#ff000080');
  await tools.set_slot({ path: file, slot: 'torso', hide: true });
  assert.equal((await tools.sample_pose({ path: file })).slots.find((s) => s.name === 'torso')?.attachment ?? null, null);
});

test('mcp scripting: run_script edits and saves, reports output and tracebacks', async () => {
  const { tools, file } = await project();
  const r = await tools.run_script({
    path: file,
    selection: ['head'],
    script: `import rigby
for b in rigby.selected_bones():
    b.rotation += 10
anim = rigby.add_animation("nod", 1)
anim.key("head", "rotate", 0.5, 15, curve="ease_in_out")
print("done", len(rigby.bones()))
`,
  });
  assert.deepEqual(r.output, ['done 11']);
  assert.ok((await tools.inspect_project({ path: file })).animations.some((a) => a.name === 'nod'));

  const before = await fs.readFile(file);
  await assert.rejects(tools.run_script({ path: file, script: 'import rigby\nrigby.add_animation("x")\nprint("half")\nrigby.bone("tail")\n' }), (e) => {
    assert.match(e.message, /The script failed: No bone 'tail'/);
    assert.match(e.message, /File "script\.py", line 4/);
    assert.match(e.message, /Output before the error:\nhalf/);
    return true;
  });
  assert.deepEqual(await fs.readFile(file), before, 'a failing script saves nothing');

  const dry = await tools.run_script({ path: file, dry_run: true, animation: 'nod', time: 0.5, script: 'import rigby\nrigby.bone("head").rotation = 0\nprint(rigby.current_animation().name, rigby.time(), rigby.mode())' });
  assert.deepEqual(dry.output, ['nod 0.5 animate']);
  assert.deepEqual(await fs.readFile(file), before, 'dry runs save nothing');
});
