// SPDX-License-Identifier: MIT OR Apache-2.0
// The key-selection round trip (keySelectionIndices → applyKeySelection): the editor and a detached
// panel window send the selected dopesheet keys across as plain indices into a shared key order, so
// turning the selection into indices and back must restore exactly the same keys (see keyorder.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, makeKey } from '../src/core/animation.js';
import { applyKeySelection, keySelectionIndices, orderedKeys, shownTracks, tracks, tweenSpans, tweens } from '../src/editor/keyorder.js';

/** A document + animation with keys on several bone channels and some events. */
function fixture() {
  const anim = new Animation('nod', 1);
  const spine = anim.boneTimelineMut(0);
  spine.rotate = [makeKey(0, 0), makeKey(0.5, 30), makeKey(1, 0)];
  spine.translate = [makeKey(0, [0, 0]), makeKey(1, [5, 0])];
  const head = anim.boneTimelineMut(1);
  head.rotate = [makeKey(0.25, 10), makeKey(0.75, -10)];
  anim.events.push({ time: 0.2, name: 'step' }, { time: 0.8, name: 'step' });
  const app = {
    doc: { bones: [{ name: 'spine' }, { name: 'head' }], slots: [], ik: [] },
    currentAnimation: () => anim,
    selectedKeys: new Set(),
  };
  return { app, anim };
}

test('key selection survives the index round trip across windows', () => {
  const { app, anim } = fixture();
  const order = orderedKeys(app, anim);
  assert.ok(order.length >= 7, 'every keyed channel contributes its keys to the order');

  // Select a spread of keys: ends of the spine rotation, one head key, and an event.
  const chosen = [order[0], order[2], anim.boneTimeline(1).rotate[0], anim.events[1]];
  app.selectedKeys = new Set(chosen);

  const indices = keySelectionIndices(app);
  assert.equal(indices.length, chosen.length);
  assert.deepEqual([...indices].sort((a, b) => a - b), indices, 'indices come back in order');

  // A second window resolves the same indices against its own copy of the order...
  const other = fixture();
  applyKeySelection(other.app, indices);
  const otherOrder = orderedKeys(other.app, other.anim);
  const expected = indices.map((i) => otherOrder[i]);
  assert.deepEqual([...other.app.selectedKeys], expected, 'the same positions are selected');
  assert.equal(other.app.selectedKeys.size, chosen.length);

  // ...and re-applying in the same window restores the very same key objects.
  applyKeySelection(app, indices);
  assert.deepEqual(new Set(app.selectedKeys), new Set(chosen));
});

test('an empty selection makes no indices, and empty indices clear the selection', () => {
  const { app } = fixture();
  assert.deepEqual(keySelectionIndices(app), []);
  app.selectedKeys = new Set([orderedKeys(app, app.currentAnimation())[0]]);
  applyKeySelection(app, []);
  assert.equal(app.selectedKeys.size, 0);
});

test('with no current animation, selection indices are empty and applying clears', () => {
  const app = { doc: { bones: [], slots: [], ik: [] }, currentAnimation: () => undefined, selectedKeys: new Set([{}]) };
  assert.deepEqual(keySelectionIndices(app), []);
  applyKeySelection(app, [0, 1]);
  assert.equal(app.selectedKeys.size, 0);
});

test('tween lines join each key to the next, except after a stepped key', () => {
  const keys = [{ time: 0 }, { time: 0.5, curve: 'stepped' }, { time: 1 }, { time: 1.5, curve: { bezier: [0.42, 0, 0.58, 1] } }, { time: 2 }];
  assert.deepEqual(tweenSpans({ bone: 0, channel: 'rotate' }, keys), [[0, 1], [2, 3], [3, 4]]);
  // Keys written without a time (0 in skeleton JSON) still count from the start.
  assert.deepEqual(tweenSpans({ raw: { type: 'ik', name: 'a' } }, [{}, { time: 1 }]), [[0, 1]]);
  assert.deepEqual(tweenSpans({ bone: 0, channel: 'rotate' }, [{ time: 0 }]), []);
});

test('only tracks whose values blend get tween lines', () => {
  assert.equal(tweens({ bone: 0, channel: 'translate' }), true);
  assert.equal(tweens({ slot: 0, channel: 'rgba' }), true);
  assert.equal(tweens({ deform: 0, slot: 0 }), true);
  assert.equal(tweens({ ik: 0 }), true);
  assert.equal(tweens({ bone: 0, channel: 'inherit' }), false);
  assert.equal(tweens({ slot: 0, channel: 'attachment' }), false);
  assert.equal(tweens({ slot: 0 }), false);
  assert.equal(tweens({ drawOrder: true }), false);
  assert.equal(tweens({ events: true }), false);
  assert.equal(tweens({ sequence: { skin: 'default', slot: 'a', attachment: 'b' } }), false);
  assert.deepEqual(tweenSpans({ slot: 0, channel: 'attachment' }, [{ time: 0 }, { time: 1 }]), []);
});

test('rows come grouped by bone, in hierarchy order, labelled once per group', () => {
  const { app, anim } = fixture();
  // Keys made for the head first: the rows still list the spine (bone 0) first.
  anim.bones.reverse();
  const rows = tracks(app, anim);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.group, r.owner, r.part]), [
    ['bone:0', 'spine', 'rotate'],
    ['bone:0', 'spine', 'translate'],
    ['bone:1', 'head', 'rotate'],
  ]);
  assert.equal(rows.at(-1).group, rows.at(-1).label, 'rows without an owner are their own group');
});

test('Selected only shows the rows of the selection; the key order across windows stays whole', () => {
  const { app, anim } = fixture();
  const before = orderedKeys(app, anim);
  app.dopesheetSelectedOnly = true;
  app.selectedBones = () => [1];
  app.sel = { bone: 1 };
  assert.deepEqual(shownTracks(app, anim).map((r) => r.label), ['head · rotate']);
  assert.deepEqual(orderedKeys(app, anim), before, 'indices still mean the same keys');
  app.selectedBones = () => [];
  app.sel = null;
  assert.equal(shownTracks(app, anim).length, tracks(app, anim).length, 'nothing selected shows every row');
});
