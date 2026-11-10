// SPDX-License-Identifier: MIT OR Apache-2.0
// Workspaces: definitions, timecode, storage in the work file, and that switching workspaces never
// changes what skeleton exports contain.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import { WORKSPACES, has, timecode, workspace } from '../src/editor/workspaces.js';

test('workspaces: definitions and features', () => {
  assert.deepEqual(Object.keys(WORKSPACES), ['game', 'film']);
  assert.equal(workspace('nope').id, 'game', 'unknown workspaces fall back to game');
  assert.equal(WORKSPACES.game.fps, 30);
  assert.equal(WORKSPACES.film.fps, 24);
  for (const feature of ['output', 'render', 'faceControls', 'timecode', 'outputFrame']) {
    assert.equal(has({ workspace: 'game' }, feature), false, `game hides ${feature}`);
    assert.equal(has({ workspace: 'film' }, feature), true, `film shows ${feature}`);
  }
  assert.ok(has({ workspace: 'game' }, 'poses') && has({ workspace: 'film' }, 'poses'));
});

test('workspaces: timecode', () => {
  assert.equal(timecode(0, 24), '00:00:00');
  assert.equal(timecode(1.5, 24), '00:01:12');
  assert.equal(timecode(3725 + 23 / 24, 24), '01:02:05:23');
  // Non-drop timecode at 23.976 fps counts 24 frames per timecode second.
  assert.equal(timecode(23 / 23.976, 23.976), '00:00:23');
  assert.equal(timecode(24 / 23.976, 23.976), '00:01:00');
  assert.equal(timecode(1 + 5 / 120, 120), '00:01:005');
});

test('workspaces: stored in the work file, invisible to exports', () => {
  const sk = new Skeleton();
  assert.equal(sk.workspace, null, 'no workspace: the user default applies');
  sk.workspace = 'film';
  assert.equal(Skeleton.fromJson(sk.toJson()).workspace, 'film');
  const bad = sk.toObject();
  bad.workspace = 'theatre';
  assert.equal(Skeleton.fromObject(bad).workspace, null);

  const rig = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('../branding/rigbytron/export/rigbytron.skel', import.meta.url)))), 'r').skeleton;
  const game = JSON.stringify(writeSkeletonJson(rig, { version: '4.3' }).json);
  rig.workspace = 'film';
  rig.controllers = [{ name: 'c', from: null, to: 'p', value: 0.5 }];
  rig.settings = { ...rig.settings, width: 2048, height: 858, background: [0, 0, 0, 1] };
  assert.equal(JSON.stringify(writeSkeletonJson(rig, { version: '4.3' }).json), game, 'film project data is never exported');
});

test('audio tracks: stored in the work file, never exported', () => {
  const sk = new Skeleton();
  sk.audio = [{ sound: 'line.wav', animation: 'talk', offset: 0.5, volume: 0.8 }];
  assert.deepEqual(Skeleton.fromJson(sk.toJson()).audio, sk.audio);
  const o = sk.toObject();
  o.audio = [{ sound: 1 }, { sound: 'a.wav', animation: 'x', offset: 'bad' }];
  assert.deepEqual(Skeleton.fromObject(o).audio, [{ sound: 'a.wav', animation: 'x', offset: 0, volume: 1 }]);
});
