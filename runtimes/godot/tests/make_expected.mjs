// SPDX-License-Identifier: MIT OR Apache-2.0
// Reference results for the Godot tests, from the JavaScript runtime (src/core): bone positions
// while Rigbytron plays its release animation, and the events and completions it fires.
// Usage: node tests/make_expected.mjs  (writes tests/expected.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = (p) => import(pathToFileURL(path.join(here, '../../../src/core', p)).href);
const { readSkeletonJson } = await core('interop.js');
const { readSkeletonBinary } = await core('binary.js');
const { Pose } = await core('pose.js');
const { AnimationState } = await core('state.js');
const { loadScene } = await core('scene.js');

const sk = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(path.join(here, '../demo/rigbytron/rigbytron.skel')))), 'rigbytron').skeleton;
const pose = new Pose(sk);
const state = new AnimationState();
const events = [];
state.addListener({
  event: (e, ev) => events.push({ step: step, track: e.track, name: ev.name }),
  complete: (e) => events.push({ step: step, track: e.track, complete: e.name }),
});
const BONES = ['root', 'chest', 'head', 'upperarm_r', 'forearm_r', 'hand_r', 'fx'];
const CHECK = [1, 9, 13, 24, 48];
const frames = [];
let step = 0;
state.setAnimation(sk, 0, 'release', false, 0);
for (step = 1; step <= 48; step++) {
  state.update(sk, 1 / 30);
  state.apply(sk, pose);
  if (CHECK.includes(step)) {
    frames.push({
      step,
      bones: Object.fromEntries(BONES.map((n) => {
        const m = pose.world[sk.bones.findIndex((b) => b.name === n)];
        return [n, [m.tx, m.ty, (Math.atan2(m.b, m.a) * 180) / Math.PI]];
      })),
      attachments: { hand: pose.attachment[sk.slots.findIndex((s) => s.name === 'hand')] },
    });
  }
}
// The demo scene: the camera and some bones of each character, by actor name.
const sceneDir = path.join(here, '../demo/scene');
const player = await loadScene(JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene.scene.json'), 'utf8')), (f) => readSkeletonJson(JSON.parse(fs.readFileSync(path.join(sceneDir, f), 'utf8')), f).skeleton);
const SCENE_BONES = { NILA: ['head', 'braid2', 'hand_r'], Rigbytron: ['head', 'hand_r'] };
const at = (sk, pose, name) => {
  const m = pose.world[sk.bones.findIndex((b) => b.name === name)];
  return [m.tx, m.ty];
};
const scene = { shot: player.shot, steps: 240, frames: [] };
player.play(player.shot, true);
for (let s = 1; s <= scene.steps; s++) {
  player.update(1 / 30);
  if (s % 40) continue;
  const actors = {};
  for (const a of player.scene.actors) {
    const sk = player.actorDocs.get(a.id);
    actors[a.name] = Object.fromEntries((SCENE_BONES[a.name] ?? []).map((b) => [b, at(sk, player.actorPoses.get(a.id), b)]));
  }
  scene.frames.push({ step: s, time: player.time, camera: at(player.stage, player.pose, 'camera'), actors });
}
fs.writeFileSync(path.join(here, 'expected.json'), JSON.stringify({ dt: 1 / 30, steps: 48, frames, events, scene }, null, 1) + '\n');
console.log('expected.json:', frames.length, 'frames,', events.length, 'callbacks,', scene.frames.length, 'scene frames');
