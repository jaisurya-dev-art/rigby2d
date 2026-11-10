// SPDX-License-Identifier: MIT OR Apache-2.0
// The PixiJS runtime (runtimes/pixi): skeletons draw as PixiJS meshes holding exactly the triangles
// the JavaScript runtime makes, batched by texture, blend and tint; physics can follow the object's
// movement without changing what a still skeleton draws; skins are per object; bones carry children.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import * as PIXI from 'pixi.js';

import { drawSkeletonGeometry, Pose, AnimationState } from '../src/core/index.js';
import { rigbyPixi } from '../runtimes/pixi/rigby-pixi.js';

// No browser here: shader programs probe a canvas for precision; give them one without WebGL.
PIXI.DOMAdapter.set({ ...PIXI.DOMAdapter.get(), createCanvas: () => ({ getContext: () => null }) });

const { parseRigby, RigbySkeleton, RigbyData } = rigbyPixi(PIXI);

const read = (p) => fs.readFileSync(new URL(`../branding/${p}`, import.meta.url));
/** Fresh data each time (tests change it), with one PixiJS texture per atlas page. */
const nilaData = () => parseRigby(new Uint8Array(read('nila/export/nila.skel')), read('nila/export/nila.atlas').toString(), () => PIXI.Texture.WHITE);
const robotData = () => parseRigby(read('rigbytron/export/rigbytron.json').toString(), read('rigbytron/export/rigbytron.atlas').toString(), () => PIXI.Texture.WHITE);

/** Every visible mesh's triangles, flattened to world-space triangle corners (PixiJS axes). */
function meshTriangles(sk) {
  const out = [];
  for (const m of sk.children[0].children) {
    if (!m.visible) continue;
    const g = m.geometry;
    const p = g.getBuffer('aPosition').data;
    for (const i of g.getIndex().data) out.push(p[2 * i], p[2 * i + 1]);
  }
  return out;
}

/** The same, from the JavaScript runtime directly (Y flipped to PixiJS's axes). */
function coreTriangles(data, pose) {
  const out = [];
  drawSkeletonGeometry(data.skeleton, pose, data.lookup, (_tex, _blend, positions, _uvs, triangles) => {
    for (const i of triangles) out.push(positions[2 * i], -positions[2 * i + 1]);
  });
  return out;
}

const close = (a, b, eps, what) => {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${what}: value ${i} ${a[i]} vs ${b[i]}`);
};

test('a skeleton draws exactly the triangles of the JavaScript runtime, in few meshes', () => {
  const data = nilaData();
  const nila = new RigbySkeleton(data, { animation: 'wave', autoUpdate: false, physicsMovement: 0 });
  // The same playback, done by hand with the core runtime.
  const pose = new Pose(data.skeleton);
  const state = new AnimationState();
  state.setAnimation(data.skeleton, 0, 'wave', true, 0);
  for (let f = 0; f < 40; f++) {
    nila.update(1 / 60);
    state.update(data.skeleton, 1 / 60);
    state.apply(data.skeleton, pose);
  }
  close(meshTriangles(nila), coreTriangles(data, pose), 1e-3, 'NILA');
  // One page, one blend mode, one tint: the whole character is one batched mesh.
  assert.equal(nila.meshCount, 1);
  assert.ok(nila.children[0].children.filter((m) => m.visible).every((m) => m.batched));
  nila.destroy();
});

test('slot blend modes become PixiJS blend modes, each run its own mesh', () => {
  const robot = new RigbySkeleton(robotData(), { animation: 'hold', autoUpdate: false });
  robot.update(0.5);
  const modes = robot.children[0].children.filter((m) => m.visible).map((m) => m.blendMode);
  assert.ok(modes.includes('normal') && modes.includes('add'), modes.join());
  assert.equal(robot.meshCount, modes.length);
  robot.destroy();
});

test('physics can follow the object moving, without changing what a still skeleton draws', () => {
  const still = new RigbySkeleton(nilaData(), { animation: 'wave', autoUpdate: false, physicsMovement: 0 });
  const placed = new RigbySkeleton(nilaData(), { animation: 'wave', autoUpdate: false, physicsMovement: 1 });
  placed.position.set(480, 560);
  placed.scale.set(0.2);
  for (let f = 0; f < 90; f++) {
    still.update(1 / 60);
    placed.update(1 / 60);
  }
  // Standing still, the placed skeleton draws what the unplaced one does.
  close(meshTriangles(placed), meshTriangles(still), 1e-2, 'placed');
  // Moving it swings the braid; without movement physics it doesn't.
  const braid = (sk) => sk.boneTransform('braid3').rotation;
  const before = braid(placed);
  for (let f = 0; f < 10; f++) {
    placed.x += 30;
    placed.update(1 / 60);
  }
  assert.ok(Math.abs(braid(placed) - before) > 0.05, 'the braid swings when NILA is moved');
  const calm = braid(still);
  still.x += 300;
  still.update(1 / 60);
  assert.ok(Math.abs(braid(still) - calm) < 0.05, 'physicsMovement 0 ignores movement');
  still.destroy();
  placed.destroy();
});

test('each skeleton has its own skin', () => {
  const data = nilaData();
  const sk = data.skeleton;
  // A 'red' skin: the torso slot's image, tinted red.
  const slot = sk.slots.findIndex((s) => s.name === 'torso');
  const base = sk.attachment(slot, sk.slots[slot].attachment);
  sk.skins.push({ name: 'red', slots: [{ slot, attachments: [{ ...base, color: [1, 0, 0, 1] }] }], bones: [], ik: [], transform: [], path: [], physics: [], slider: [] });
  const red = new RigbySkeleton(data, { autoUpdate: false, skin: 'red' });
  const plain = new RigbySkeleton(data, { autoUpdate: false });
  const tints = (s) => s.children[0].children.filter((m) => m.visible).map((m) => m.tint);
  assert.ok(tints(red).includes(0xff0000), 'the red skin draws its red torso');
  assert.ok(!tints(plain).includes(0xff0000), 'the other skeleton keeps the default skin');
  assert.equal(sk.skin, null, 'the shared data is left as it was');
  assert.deepEqual(red.skinNames, ['red']);
  assert.throws(() => (plain.skin = 'blue'), /no skin 'blue'/);
  red.destroy();
  plain.destroy();
});

test('dark (two-color) tint draws through its own shader with per-vertex dark colors', () => {
  const data = robotData();
  for (const s of data.skeleton.slots) s.dark = [0.5, 0.25, 0];
  const robot = new RigbySkeleton(data, { animation: 'hold', autoUpdate: false });
  const meshes = robot.children[0].children.filter((m) => m.visible);
  assert.ok(meshes.length > 0 && meshes.every((m) => m.label === 'rigby-dark' && m.shader));
  const dark = meshes[0].geometry.getBuffer('aDark').data;
  assert.deepEqual([...dark.slice(0, 3)], [0.5, 0.25, 0]);
  assert.equal(dark.length / 3, meshes[0].geometry.getBuffer('aPosition').data.length / 2);
  robot.destroy();
});

test('animations, queues and events reach PixiJS listeners', () => {
  const robot = new RigbySkeleton(robotData(), { animation: 'hold', loop: false, autoUpdate: false });
  const seen = [];
  robot.on('start', (e) => seen.push(`start ${e.name ?? e.animation?.name}`));
  robot.on('complete', (e) => seen.push(`complete ${e.name ?? e.animation?.name}`));
  robot.on('event', (_e, ev) => seen.push(`event ${ev.name ?? ev.data?.name}`));
  robot.queue('release', false, 0.1);
  for (let f = 0; f < 5 * 60; f++) robot.update(1 / 60);
  assert.ok(seen.some((s) => s.startsWith('complete hold')), seen.join());
  assert.ok(seen.some((s) => s.startsWith('start release')), seen.join());
  assert.ok(seen.some((s) => s.startsWith('event slash')), seen.join());
  assert.throws(() => robot.play('fly'), /no animation 'fly'/);
  robot.destroy();
});

test('children attached to a bone follow it', () => {
  const nila = new RigbySkeleton(nilaData(), { animation: 'wave', autoUpdate: false });
  const star = new PIXI.Container();
  nila.attachToBone('hand_r', star);
  for (let f = 0; f < 20; f++) nila.update(1 / 60);
  const t = nila.boneTransform('hand_r');
  assert.ok(Math.abs(star.x - t.x) < 1e-9 && Math.abs(star.y - t.y) < 1e-9 && Math.abs(star.rotation - t.rotation) < 1e-9);
  assert.equal(nila.children.at(-1), star, 'drawn in front of the skeleton');
  // The bone's position matches the core runtime's world transform, Y flipped.
  const w = nila.pose.world[nila.skeleton.bones.findIndex((b) => b.name === 'hand_r')];
  assert.ok(Math.abs(t.x - w.tx) < 1e-6 && Math.abs(t.y + w.ty) < 1e-6);
  nila.detachFromBone(star);
  const x = star.x;
  nila.update(0.3);
  assert.equal(star.x, x, 'detached children stay put');
  assert.equal(nila.boneTransform('nope'), null);
  nila.destroy();
});

test('parseRigby takes .skel bytes, JSON text or parsed JSON', () => {
  const json = JSON.parse(read('rigbytron/export/rigbytron.json').toString());
  const atlas = read('rigbytron/export/rigbytron.atlas').toString();
  const a = parseRigby(json, atlas, () => PIXI.Texture.WHITE);
  assert.ok(a instanceof RigbyData);
  assert.deepEqual(a.animationNames, ['hold', 'release']);
  assert.throws(() => new RigbySkeleton({}), /takes the data from loadRigby/);
  assert.throws(() => rigbyPixi({}), /PixiJS 8/);
});
