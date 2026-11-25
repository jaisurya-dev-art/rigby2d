// SPDX-License-Identifier: MIT OR Apache-2.0
// Time operations (src/editor/timeops.js) and timeline markers: inserting and deleting time moves
// every kind of key, the breakdown pose sits between a bone's neighbouring keys, and markers are
// kept in work files but never exported.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, makeKey } from '../src/core/animation.js';
import { writeSkeletonJson } from '../src/core/interop.js';
import { transform } from '../src/core/math.js';
import { Skeleton, makeBone } from '../src/core/model.js';
import { breakdownPose, deleteTime, insertTime, keyLists } from '../src/editor/timeops.js';

function doc() {
  const d = new Skeleton();
  d.addBone(makeBone('arm', 0, transform(0, 0, 0), 10));
  const anim = new Animation('wave', 1);
  const tl = anim.boneTimelineMut(1);
  tl.rotate = [makeKey(0, 0), makeKey(0.5, 90), makeKey(1, 0)];
  anim.events.push({ time: 0.5, name: 'step' });
  anim.markers.push({ time: 0.75, name: 'contact' });
  d.animations.push(anim);
  return { d, anim, tl };
}

test('every key list is found, markers and events included', () => {
  const { anim } = doc();
  assert.equal(keyLists(anim).length, 3, 'rotate, events, markers');
});

test('inserting time moves everything after it and grows the animation', () => {
  const { anim, tl } = doc();
  const moved = insertTime(anim, 0.5, 0.25);
  assert.deepEqual(tl.rotate.map((k) => k.time), [0, 0.5, 1.25], 'a key exactly at the playhead stays');
  assert.equal(anim.markers[0].time, 1);
  assert.equal(anim.duration, 1.25);
  assert.equal(moved, 2);
});

test('deleting time removes what is inside and pulls the rest back', () => {
  const { anim, tl } = doc();
  const r = deleteTime(anim, 0.25, 0.5);
  assert.deepEqual(tl.rotate.map((k) => k.time), [0, 0.75]);
  assert.equal(anim.events.length, 0, 'the event inside the span went');
  assert.equal(anim.markers[0].time, 0.5);
  assert.equal(anim.duration, 0.75);
  assert.deepEqual(r, { removed: 2, moved: 2 });
});

test('the breakdown pose sits between the previous and next keys', () => {
  const { d, anim } = doc();
  const [[bone, t]] = breakdownPose(d, anim, [1], 0.25, 0.25);
  assert.equal(bone, 1);
  assert.ok(Math.abs(t.rotation - 22.5) < 1e-6, 'a quarter of the way from 0° to 90°');
  assert.deepEqual(breakdownPose(d, anim, [1], 1.5, 0.5), [], 'no next key: nothing to break down');
});

test('markers are kept in work files and left out of exports', () => {
  const { d } = doc();
  const back = Skeleton.fromObject(JSON.parse(d.toSnapshot()));
  assert.deepEqual(back.animations[0].markers, [{ time: 0.75, name: 'contact' }]);
  const { json } = writeSkeletonJson(d, { version: '4.3' });
  assert.equal(JSON.stringify(json).includes('contact'), false);
});
