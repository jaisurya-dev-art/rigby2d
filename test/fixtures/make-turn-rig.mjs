// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds test/fixtures/turn-rig.json: a head made turnable (editor/turn.js: turn and tilt, two
// additive sliders on one control bone), a "look" animation that moves the control, and an additive
// slider whose animation rotates and moves a bone (additive bone keys). The runtimes' golden tests
// play it (runtimes/rust/rigby-runtime/tests/golden/turn.golden.json).
//   node test/fixtures/make-turn-rig.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Animation, setKey } from '../../src/core/animation.js';
import { addConstraint } from '../../src/core/constraintdata.js';
import { VERSION_FIELD as V, readSkeletonJson, writeSkeletonJson } from '../../src/core/interop.js';
import { buildTurn, planTurn } from '../../src/editor/turn.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sk = readSkeletonJson({
  skeleton: { [V]: '4.3.0' },
  bones: [
    { name: 'root' },
    { name: 'body', parent: 'root', y: 50 },
    { name: 'head', parent: 'body', y: 100, rotation: 5 },
    { name: 'arm', parent: 'body', x: 40, y: 40, rotation: -30, length: 60 },
    { name: 'wave', parent: 'root', x: 200 },
  ],
  slots: [
    { name: 'torso', bone: 'body', attachment: 'torso' },
    { name: 'arm', bone: 'arm', attachment: 'arm' },
    { name: 'hair back', bone: 'head', attachment: 'hair back' },
    { name: 'face', bone: 'head', attachment: 'face' },
    { name: 'hair front', bone: 'head', attachment: 'hair front' },
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        torso: { torso: { width: 80, height: 100 } },
        arm: { arm: { x: 30, width: 60, height: 16 } },
        'hair back': { 'hair back': { width: 120, height: 120 } },
        face: { face: { width: 100, height: 110 } },
        'hair front': { 'hair front': { y: 30, width: 110, height: 50 } },
      },
    },
  ],
}).skeleton;

const turn = buildTurn(sk, planTurn(sk, sk.boneIndex('head')));
const control = sk.boneIndex(turn.control);

// "look": the control goes right, up, left and down (turn and tilt together).
const look = new Animation('look', 2);
const bone = look.boneTimelineMut(control);
for (const [time, x, y] of [[0, 0, 0], [0.5, 90, 40], [1, -60, 80], [1.5, -100, -70], [2, 0, 0]]) setKey(bone.translate, time, [x, y]);
sk.animations.push(look);

// An additive slider whose animation rotates, moves and scales the arm, driven by "wave"'s x.
const swing = new Animation('swing', 1);
const arm = swing.boneTimelineMut(sk.boneIndex('arm'));
setKey(arm.rotate, 0, [0]);
setKey(arm.rotate, 1, [40]);
setKey(arm.translate, 0, [0, 0]);
setKey(arm.translate, 1, [10, -5]);
setKey(arm.scale, 0, [1, 1]);
setKey(arm.scale, 1, [1.3, 0.8]);
sk.animations.push(swing);
addConstraint(sk, { type: 'slider', name: 'swing', animation: 'swing', bone: 'wave', property: 'x', local: true, additive: true, scale: 0.01, offset: 0 });
// "wave" moves, and the arm also has its own rotation keys, so the slider adds to an animated pose.
const waveAnim = new Animation('wave', 1.5);
for (const [time, x] of [[0, 0], [0.75, 100], [1.5, 0]]) setKey(waveAnim.boneTimelineMut(sk.boneIndex('wave')).translate, time, [x, 0]);
for (const [time, r] of [[0, 0], [1.5, -20]]) setKey(waveAnim.boneTimelineMut(sk.boneIndex('arm')).rotate, time, [r]);
sk.animations.push(waveAnim);

const out = path.join(here, 'turn-rig.json');
fs.writeFileSync(out, JSON.stringify(writeSkeletonJson(sk, { version: '4.3' }).json, null, 1));
console.log(`${out}: ${sk.animations.map((a) => a.name).join(', ')}`);
