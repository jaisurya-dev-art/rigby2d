// SPDX-License-Identifier: MIT OR Apache-2.0
// The key-selection round trip (keySelectionIndices → applyKeySelection): the editor and a detached
// panel window send the selected dopesheet keys across as plain indices into a shared key order, so
// turning the selection into indices and back must restore exactly the same keys (see keyorder.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, makeKey } from '../src/core/animation.js';
import { applyKeySelection, keySelectionIndices, orderedKeys } from '../src/editor/keyorder.js';

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
