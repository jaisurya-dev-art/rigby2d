// SPDX-License-Identifier: MIT OR Apache-2.0
// Scene composition (core/scene.js): clips on the scene timeline, crossfades, actors placed on
// their anchor bones, parallax under a moving camera, draw order, and the scene in the work file.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, setKey } from '../src/core/animation.js';
import { transform } from '../src/core/math.js';
import { Skeleton, makeAttachment, makeSlot } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import {
  ScenePlayer,
  actorEnd,
  actorStateAt,
  applyParallax,
  clipLength,
  clipTime,
  depthFactor,
  emptyScene,
  poseActor,
  readScene,
  sceneDrawList,
  setupCameraPosition,
} from '../src/core/scene.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/** A one-bone character with a 'wave' (rotate 0 → 90 over 1 s) and a 'nod' (rotate 0 → -30 over 0.5 s). */
function character() {
  const doc = new Skeleton();
  doc.bones.push({ name: 'arm', parent: 0, length: 100, setup: transform(0, 0, 0), inherit: 'normal', skinRequired: false, color: null });
  doc.slots.push(makeSlot('arm', 1, makeAttachment('arm', 'arm', transform(50, 0, 0), 100, 20)));
  doc.images.push({ name: 'arm', path: null, width: 100, height: 20 });
  const wave = new Animation('wave', 1);
  const tl = wave.boneTimelineMut(1);
  setKey(tl.rotate, 0, 0);
  setKey(tl.rotate, 1, 90);
  const nod = new Animation('nod', 0.5);
  const tn = nod.boneTimelineMut(1);
  setKey(tn.rotate, 0, 0);
  setKey(tn.rotate, 0.5, -30);
  doc.animations.push(wave, nod);
  return doc;
}

/** A stage: root, a 'camera' bone, a 'far' background layer, two actor anchors and their slots. */
function stage() {
  const doc = new Skeleton();
  const bone = (name, x, y) => doc.bones.push({ name, parent: 0, length: 0, setup: transform(x, y, 0), inherit: 'normal', skinRequired: false, color: null });
  bone('camera', 0, 0);
  bone('far', 0, 0);
  bone('hero', 100, 0);
  bone('friend', -100, 0);
  doc.slots.push(makeSlot('sky', 2, null), makeSlot('friend', 4, null), makeSlot('hero', 3, null));
  const shot = new Animation('shot', 4);
  setKey(shot.boneTimelineMut(1).translate, 0, [0, 0]);
  setKey(shot.boneTimelineMut(1).translate, 4, [400, 0]);
  doc.animations.push(shot);
  doc.scene = emptyScene();
  return doc;
}

test('clips: length, trimming, speed and loops', () => {
  const anim = { duration: 1 };
  const clip = { animation: 'wave', start: 2, in: 0.25, out: 0.75, speed: 2, loops: 3, blend: 0 };
  near(clipLength(clip, anim), 0.75); // 0.5 s span × 3 loops / speed 2
  near(clipTime(clip, anim, 2), 0.25);
  near(clipTime(clip, anim, 2.1), 0.45);
  near(clipTime(clip, anim, 2.3), 0.35); // second loop
  near(clipTime(clip, anim, 9), 0.75); // holds its last frame
  near(clipTime(clip, anim, 0), 0.25); // before it starts: its first frame
  assert.equal(clipLength({ ...clip, loops: 0 }, anim), Infinity);
});

test('actor state: current clip, crossfade from the previous one, setup pose before the first', () => {
  const doc = character();
  const actor = { clips: { shot: readScene({ actors: [] }) && [{ animation: 'wave', start: 0, in: 0, out: null, speed: 1, loops: 1, blend: 0 }, { animation: 'nod', start: 1, in: 0, out: null, speed: 1, loops: 1, blend: 0.2 }] } };
  assert.equal(actorStateAt({ clips: {} }, doc, 'shot', 1), null);
  const a = actorStateAt(actor, doc, 'shot', 0.5);
  assert.equal(a.anim.name, 'wave');
  near(a.time, 0.5);
  const b = actorStateAt(actor, doc, 'shot', 1.1);
  assert.equal(b.anim.name, 'nod');
  assert.equal(b.from.anim.name, 'wave');
  near(b.alpha, 0.5);
  near(b.from.time, 1); // the wave is over and holds its end
  assert.equal(actorStateAt(actor, doc, 'shot', 1.3).from, null);
  near(actorEnd(actor, doc, 'shot'), 1.5);
});

test('actors stand on their anchor bone, flipped when asked; physics-free posing is repeatable', () => {
  const st = stage();
  const doc = character();
  const pose = new Pose(st);
  const actor = { id: 'h', name: 'Hero', bone: 'hero', slot: 'hero', skin: null, flip: false, clips: { shot: [{ animation: 'wave', start: 0, in: 0, out: null, speed: 1, loops: 1, blend: 0 }] } };
  const ap = poseActor(st, pose, actor, doc, 'shot', 1, new Pose(doc));
  // The arm's tip: anchored at x = 100, rotated 90° by the wave at t = 1.
  const tip = ap.world[1].apply([100, 0]);
  near(tip[0], 100);
  near(tip[1], 100);
  const flipped = poseActor(st, pose, { ...actor, flip: true }, doc, 'shot', 0, new Pose(doc));
  near(flipped.world[1].apply([100, 0])[0], 0); // points left instead of right
});

test('parallax: deep layers follow the camera part of the way and keep their size', () => {
  const st = stage();
  st.scene.depth = { far: 1000 };
  const cam0 = setupCameraPosition(st);
  const pose = new Pose(st);
  pose.reset(st);
  pose.apply(st, st.animations[0], 4, 1); // camera moved 400 to the right
  pose.updateWorld(st);
  applyParallax(st, st.scene, pose, cam0);
  near(depthFactor(1000), 0.5);
  near(pose.world[2].tx, 200); // half of the camera's motion
  near(Math.hypot(pose.world[2].a, pose.world[2].b), 1); // same size
  near(pose.world[3].tx, 100); // a layer without depth stays put
});

test('draw list: actors at their slots, in the stage draw order', () => {
  const st = stage();
  st.scene.actors.push({ id: 'h', name: 'Hero', bone: 'hero', slot: 'hero', skin: null, flip: false, clips: {} }, { id: 'f', name: 'Friend', bone: 'friend', slot: 'friend', skin: null, flip: false, clips: {} });
  const list = sceneDrawList(st, st.scene, new Pose(st));
  assert.deepEqual(
    list.map((x) => x.actor?.name ?? st.slots[x.slot].name),
    ['sky', 'Friend', 'Hero'],
  );
});

test('the scene round-trips through the project file, and skeleton exports never see it', async () => {
  const st = stage();
  st.scene.actors.push({ id: 'h', name: 'Hero', bone: 'hero', slot: 'hero', source: 'hero.rigby', skin: null, flip: true, clips: { shot: [{ animation: 'wave', start: 1, in: 0, out: 0.5, speed: 1.5, loops: 2, blend: 0.3 }] } });
  st.scene.depth = { far: 800 };
  const back = Skeleton.fromJson(st.toJson());
  assert.deepEqual(back.scene, st.scene);
  const { writeSkeletonJson } = await import('../src/core/interop.js');
  assert.equal(JSON.stringify(writeSkeletonJson(st, { version: '4.2' }).json).includes('Hero'), false);
  assert.equal(readScene(null), null);
  assert.deepEqual(readScene({ actors: [{ id: 1 }], depth: { x: 'far' } }), emptyScene());
});

test('ScenePlayer plays a shot with its actors and loops it', () => {
  const st = stage();
  st.scene.actors.push({ id: 'h', name: 'Hero', bone: 'hero', slot: 'hero', skin: null, flip: false, clips: { shot: [{ animation: 'wave', start: 0, in: 0, out: null, speed: 1, loops: 0, blend: 0 }] } });
  const player = new ScenePlayer(st, new Map([['h', character()]]));
  player.play('shot', true);
  player.update(0.5);
  const drawn = [];
  player.forEachLayer((doc, pose, actor) => drawn.push([actor.name, pose.world[1].rotation()]));
  assert.equal(drawn.length, 1);
  near(drawn[0][1], 45);
  assert.equal(player.duration(), 4);
  player.update(4); // loops around the 4 s shot
  near(player.time, 0.5);
});

test('physics on a placed, scaled actor swings exactly like the character at full size', async () => {
  const fs = await import('node:fs');
  const { unzip } = await import('../src/editor/zip.js');
  const nila = Skeleton.fromJson(new TextDecoder().decode(unzip(fs.readFileSync(new URL('../branding/nila/nila.rigby', import.meta.url))).get('project.json')));
  const braid = nila.boneIndex('braid2');
  const st = stage();
  st.bones[3].setup = { ...st.bones[3].setup, x: -330, scale_x: 0.36, scale_y: 0.36 };
  const actor = { id: 'n', name: 'NILA', bone: 'hero', slot: 'hero', skin: null, flip: false, clips: { shot: [{ animation: 'wave', start: 0, in: 0, out: null, speed: 1, loops: 0, blend: 0 }] } };
  const stagePose = new Pose(st);
  const placed = new Pose(nila);
  const alone = new Pose(nila);
  const wave = nila.animations.find((a) => a.name === 'wave');
  for (let f = 0; f < 40; f++) {
    poseActor(st, stagePose, actor, nila, 'shot', f / 30, placed, f ? 1 / 30 : 0);
    alone.reset(nila);
    alone.apply(nila, wave, f / 30, 1);
    alone.physicsDelta = f ? 1 / 30 : 0;
    alone.updateWorld(nila);
    const rel = (p) => p.world[braid].rotation() - p.world[nila.bones[braid].parent].rotation();
    near(rel(placed), rel(alone), 1e-6);
  }
});
