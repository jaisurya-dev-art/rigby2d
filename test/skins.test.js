// SPDX-License-Identifier: MIT OR Apache-2.0
// Skins shown together (the editor's preview of a combination): the active skin, extra skins on top
// of it (the last one wins), then the default skin; kept in the work file, and constraints that need
// a skin run when any shown skin has them.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { transform } from '../src/core/math.js';
import { Skeleton, makeAttachment, makeSlot } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';

function rig() {
  const doc = new Skeleton();
  const att = (name) => makeAttachment(name, name, transform(0, 0, 0), 10, 10);
  doc.slots.push(makeSlot('body', 0, att('body')), makeSlot('hat', 0, null), makeSlot('cape', 0, null));
  doc.slots[1].attachment = 'hat';
  doc.slots[2].attachment = 'cape';
  const skin = (name, entries) => ({ name, slots: entries.map(([slot, a]) => ({ slot, attachments: [att(a)] })), bones: [], ik: [], color: null, extra: {} });
  // Each skin calls its images like the slots, so a combination shows which skin won.
  doc.skins.push(skin('knight', [[1, 'hat'], [2, 'cape']]), skin('wizard', [[1, 'hat']]));
  doc.skins[0].slots[0].attachments[0].image = 'knight-hat';
  doc.skins[1].slots[0].attachments[0].image = 'wizard-hat';
  return doc;
}

test('the active skin, extra skins on top (the last one wins), then the default skin', () => {
  const doc = rig();
  assert.equal(doc.attachment(1, 'hat'), undefined, 'no skin active: the default skin has no hat');
  doc.skin = 'knight';
  assert.equal(doc.attachment(1, 'hat').image, 'knight-hat');
  doc.extraSkins = ['wizard'];
  assert.deepEqual(doc.activeSkins(), ['knight', 'wizard']);
  assert.equal(doc.attachment(1, 'hat').image, 'wizard-hat', 'the extra skin wins');
  assert.ok(doc.attachment(2, 'cape'), 'what only the knight has still shows');
  assert.equal(doc.attachment(0, 'body').image, 'body', 'the default skin fills the rest');
  assert.equal(doc.attachment(1, 'hat', 'knight').image, 'knight-hat', 'a named skin is looked up alone');
  doc.extraSkins = ['wizard', 'gone', 'knight'];
  assert.deepEqual(doc.activeSkins(), ['knight', 'wizard'], 'each skin once, only skins that exist');
});

test('extra skins are kept in the work file and survive undo', () => {
  const doc = rig();
  doc.skin = 'knight';
  doc.extraSkins = ['wizard'];
  const back = Skeleton.fromObject(JSON.parse(doc.toSnapshot()));
  assert.equal(back.skin, 'knight');
  assert.deepEqual(back.extraSkins, ['wizard']);
  const plain = rig();
  assert.equal('extraSkins' in plain.toObject(), false, 'nothing is written without a combination');
});

test('a skin-required constraint runs when any shown skin has it', () => {
  const doc = rig();
  const pose = new Pose(doc);
  const has = (skin) => skin.name === 'wizard';
  doc.skin = 'knight';
  assert.equal(pose.skinActive(doc, has), false);
  doc.extraSkins = ['wizard'];
  assert.equal(pose.skinActive(doc, has), true);
});
