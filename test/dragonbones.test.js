// SPDX-License-Identifier: MIT OR Apache-2.0
// DragonBones import (dragonbones.js, dbnest.js): flags written as text, rotations unwound the way the
// DragonBones runtime turns, and nested armatures flattened into the parent with their animations
// baked in. These rules were checked against the official DragonBones runtime on its demo
// characters (bones, nested bones, images and colors match within rounding).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';
import { dragonBonesToSkeleton } from '../src/editor/dragonbones.js';

const TEX = { imagePath: 'hero_tex.png', width: 64, height: 64, SubTexture: ['body', 'blade', 'flash/1', 'flash/2'].map((name, i) => ({ name, x: i * 16, y: 0, width: 16, height: 16 })) };

/** A hero with a sword (nested armature `sword`) in slot `hand`, and an effect slot. */
function hero() {
  return {
    version: '5.5',
    frameRate: 10,
    armature: [
      {
        name: 'hero',
        type: 'Armature',
        frameRate: 10,
        defaultActions: [{ gotoAndPlay: 'idle' }],
        bone: [
          { name: 'root' },
          { name: 'arm', parent: 'root', transform: { x: 10 }, inheritScale: 'false' },
          { name: 'hand', parent: 'arm', transform: { x: 20 } },
        ],
        slot: [
          { name: 'body', parent: 'root' },
          { name: 'hand', parent: 'hand', color: { aM: 50 } },
          { name: 'fx', parent: 'hand', displayIndex: -1 },
        ],
        ik: [{ name: 'reach', bone: 'hand', target: 'root', bendPositive: 'false' }],
        skin: [
          {
            name: '',
            slot: [
              { name: 'body', display: [{ name: 'body' }] },
              // The same armature twice, at two offsets: the names must not collide.
              { name: 'hand', display: [{ type: 'armature', name: 'sword', path: 'sword', transform: { x: 5 } }, { type: 'armature', name: 'sword', path: 'sword', transform: { x: 9 } }] },
              { name: 'fx', display: [{ type: 'armature', name: 'flash', path: 'flash' }] },
            ],
          },
        ],
        animation: [
          { name: 'idle', duration: 10, playTimes: 0, bone: [], slot: [] },
          {
            name: 'attack',
            duration: 10,
            bone: [{ name: 'arm', rotateFrame: [{ duration: 5, tweenEasing: 0, rotate: -170 }, { duration: 5, tweenEasing: 0, rotate: 170 }, { duration: 0, rotate: 160, clockwise: 0 }] }],
            slot: [
              // The sword swings at frame 2; the flash shows at frame 4 for 2 frames.
              { name: 'hand', displayFrame: [{ duration: 2 }, { duration: 8, actions: [{ gotoAndPlay: 'swing' }] }] },
              { name: 'fx', displayFrame: [{ duration: 4, value: -1 }, { duration: 2 }, { duration: 4, value: -1 }] },
            ],
            frame: [{ duration: 9 }, { duration: 0, action: 'idle' }],
          },
        ],
      },
      {
        name: 'sword',
        type: 'Armature',
        frameRate: 10,
        defaultActions: [{ gotoAndPlay: 'rest' }],
        bone: [{ name: 'b', inheritScale: false }],
        slot: [{ name: 'blade', parent: 'b' }],
        skin: [{ name: '', slot: [{ name: 'blade', display: [{ name: 'blade' }] }] }],
        animation: [
          { name: 'rest', duration: 0, bone: [], slot: [] },
          { name: 'swing', duration: 4, bone: [{ name: 'b', rotateFrame: [{ duration: 4, tweenEasing: 0 }, { duration: 0, rotate: 40 }] }], slot: [], frame: [{ duration: 1 }, { duration: 0, events: [{ name: 'clang' }] }] },
          { name: 'idle', duration: 2, bone: [{ name: 'b', translateFrame: [{ duration: 2, tweenEasing: 0 }, { duration: 0, y: -3 }] }], slot: [] },
        ],
      },
      {
        name: 'flash',
        type: 'Armature',
        frameRate: 10,
        defaultActions: [{ gotoAndPlay: 'pop' }],
        bone: [{ name: 'f' }],
        slot: [{ name: 'img', parent: 'f' }],
        skin: [{ name: '', slot: [{ name: 'img', display: [{ name: 'flash/1' }, { name: 'flash/2' }] }] }],
        animation: [{ name: 'pop', duration: 2, slot: [{ name: 'img', displayFrame: [{ duration: 1 }, { duration: 1, value: 1 }, { duration: 0, value: -1 }] }] }],
      },
    ],
  };
}

const convert = () => dragonBonesToSkeleton(hero(), TEX);
const keyAt = (keys, t) => keys.filter((k) => k.time <= t + 1e-6).at(-1);

test('flags written as text are read as the DragonBones runtime reads them', () => {
  const { json } = convert();
  assert.equal(json.bones.find((b) => b.name === 'arm').transform, 'noScale');
  // Y is flipped, so a DragonBones bend that is not positive becomes a positive one.
  assert.equal(json.ik[0].bendPositive, true);
});

test('rotation keys are unwound: the short way round, or the turns `clockwise` asks for', () => {
  const rotate = convert().json.animations.attack.bones.arm.rotate;
  // -170 to 170 is 20 degrees the short way, not 340 back round (Y flipped: angles negate).
  assert.deepEqual(
    rotate.map((k) => k.angle),
    [170, 190, 200],
  );
});

test('nested armatures become bones and slots under the slot that shows them', () => {
  const { json, warnings } = convert();
  assert.ok(!warnings.some((w) => /not supported/.test(w)), warnings.join('\n'));
  const names = json.bones.map((b) => b.name);
  assert.ok(names.includes('hand/sword#0') && names.includes('hand/sword#1'), names.join());
  const instance = json.bones.find((b) => b.name === 'hand/sword#1');
  assert.equal(instance.parent, 'hand');
  assert.equal(instance.x, 9);
  const root = json.bones.find((b) => b.name === 'hand/sword#1/b');
  assert.equal(root.parent, 'hand/sword#1');
  // A child's root bone follows the slot fully: its inherit flags meant nothing inside the child.
  assert.equal(root.transform, undefined);
  // Drawn where the parent slot is drawn, tinted by it, and only the shown display at setup.
  const order = json.slots.map((s) => s.name);
  assert.ok(order.indexOf('hand/sword#0/blade') === order.indexOf('hand') + 1);
  assert.equal(json.slots.find((s) => s.name === 'hand/sword#0/blade').attachment, 'blade');
  assert.equal(json.slots.find((s) => s.name === 'hand/sword#1/blade').attachment, undefined);
  assert.equal(json.slots.find((s) => s.name === 'hand/sword#0/blade').color, 'ffffff80');
  assert.ok(json.skins[0].attachments['hand/sword#0/blade'].blade);
});

test('child animations are baked in: default clip, actions, restarts when shown, events', () => {
  const { json } = convert();
  const attack = json.animations.attack;
  // The sword rests, then swings from 0.2 s (the action), reaching 40 degrees after 0.4 s.
  const swing = attack.bones['hand/sword#0/b'].rotate;
  assert.equal(keyAt(swing, 0.1).angle, 0);
  assert.equal(keyAt(swing, 0.6).angle, -40);
  // The flash is shown from 0.4 s: its flipbook starts there, not at the start of the attack.
  const img = attack.slots['fx/flash/img'].attachment;
  assert.equal(keyAt(img, 0.3).name, null);
  assert.equal(keyAt(img, 0.4).name, 'flash/1');
  assert.equal(keyAt(img, 0.5).name, 'flash/2');
  assert.equal(keyAt(img, 0.6).name, null);
  // The child's event fires while it plays; the parent's end-of-animation action is kept as an event.
  assert.ok(attack.events.some((e) => e.name === 'clang' && Math.abs(e.time - 0.3) < 1e-6));
  assert.ok(attack.events.some((e) => e.name === 'action' && e.string === 'idle'));
  // When the parent plays `idle`, a child with an `idle` animation plays it too.
  assert.ok(json.animations.idle.bones['hand/sword#0/b'].translate);
});

test('the flattened skeleton loads and plays', () => {
  const sk = readSkeletonJson(convert().json, 'hero').skeleton;
  const pose = new Pose(sk);
  const state = new AnimationState();
  state.setAnimation(sk, 0, 'attack', false, 0);
  state.update(sk, 0.45);
  state.apply(sk, pose);
  const fx = sk.slots.findIndex((s) => s.name === 'fx/flash/img');
  assert.equal(pose.attachment[fx], 'flash/1');
  const hidden = sk.slots.findIndex((s) => s.name === 'hand/sword#1/blade');
  assert.equal(pose.attachment[hidden] ?? null, null);
});

test('with no armature named, the character is imported, not a weapon or bullet listed first', () => {
  const ske = hero();
  ske.name = 'hero_file';
  // Put the nested sword first, and an effect no slot shows (spawned by the game) before the hero.
  const sword = ske.armature.find((a) => a.name === 'sword');
  const bullet = { name: 'bullet', frameRate: 24, bone: [{ name: 'root' }], slot: [], skin: [], animation: [{ name: 'fly', duration: 1 }] };
  ske.armature = [sword, bullet, ...ske.armature.filter((a) => a !== sword)];
  const { json, warnings } = dragonBonesToSkeleton(ske, TEX);
  assert.ok(json.bones.some((b) => b.name === 'arm'));
  assert.ok(warnings.some((w) => w.includes("imported 'hero'")));
  // The file's own name wins when an armature has it.
  ske.armature.find((a) => a.name === 'bullet').name = 'hero_file';
  assert.ok(dragonBonesToSkeleton(ske, TEX).warnings.some((w) => w.includes("imported 'hero_file'")));
});

test('opening picked files: the project is found by its contents, never the texture atlas', async () => {
  const { projectKind, isDragonBonesAtlasText, missingFiles } = await import('../src/editor/io.js');
  const ske = JSON.stringify({ name: 'hero', armature: [{ name: 'hero' }] });
  const tex = JSON.stringify({ name: 'hero', imagePath: 'hero_tex.png', SubTexture: [] });
  const spine = JSON.stringify({ skeleton: { spine: '4.2' }, bones: [{ name: 'root' }] });
  assert.equal(projectKind('hero_ske.json', ske).kind, 'DragonBones skeleton');
  assert.equal(projectKind('hero_tex.json', tex), null, 'the texture atlas is not a project');
  assert.ok(isDragonBonesAtlasText(tex));
  assert.equal(projectKind('hero.json', spine).kind, 'skeleton JSON');
  assert.equal(projectKind('settings.json', '{"a":1}'), null);
  assert.equal(projectKind('hero.png'), null);
  assert.equal(projectKind('hero.atlas'), null);
  // Work files beat skeletons, binary beats JSON, backups come last.
  const ranks = ['a.rigby', 'a.skel', 'a.rigby3'].map((n) => projectKind(n).rank);
  assert.deepEqual(ranks, [0, 1, 4]);
  assert.ok(projectKind('hero_ske.json', ske).rank < projectKind('hero.json', spine).rank);
  // What an import still needs, read from its warnings.
  const m = missingFiles(["image 'arm' not found", "image 'leg' is missing", 'atlas page hero.png: file not found: hero.png', 'no DragonBones texture atlas (_tex.json) found next to the skeleton: images are looked up by name instead', 'something else']);
  assert.deepEqual(m.names, ['hero.png'], 'a missing atlas page is asked for, not each image in it');
  assert.deepEqual(missingFiles(["image 'arm' not found"]).names, ['arm']);
  assert.equal(m.dragonBonesAtlas, true);
});
