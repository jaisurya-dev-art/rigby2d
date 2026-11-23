import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renameBoneRefs, renameSlotRefs } from '../src/core/constraintdata.js';
import { VERSION_FIELD as V, readSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import {
  branchBones,
  clearViewState,
  hasViewState,
  hiddenSlotSkip,
  isBoneHidden,
  isBoneLocked,
  isSlotHidden,
  isSlotLocked,
  toggleBone,
  toggleSlot,
} from '../src/editor/visibility.js';

// root > arm > hand, root > leg; a slot on hand and one on leg.
const rig = () =>
  readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }, { name: 'hand', parent: 'arm' }, { name: 'leg', parent: 'root' }],
    slots: [
      { name: 'hand-img', bone: 'hand', attachment: 'hand' },
      { name: 'leg-img', bone: 'leg', attachment: 'leg' },
    ],
    skins: [{ name: 'default', attachments: { 'hand-img': { hand: { width: 10, height: 10 } }, 'leg-img': { leg: { width: 10, height: 10 } } } }],
  }).skeleton;

test('visibility: bone and slot toggles, and branches with Alt', () => {
  const doc = rig();
  assert.equal(hasViewState(doc), false);
  assert.deepEqual(branchBones(doc, 1), [1, 2]);
  assert.equal(toggleBone(doc, 'hidden', 1), true);
  assert.ok(isBoneHidden(doc, 1));
  assert.ok(!isBoneHidden(doc, 2), 'without Alt only the bone itself');
  assert.equal(toggleBone(doc, 'hidden', 1), false);
  assert.equal(hasViewState(doc), false);

  toggleBone(doc, 'locked', 1, true);
  assert.ok(isBoneLocked(doc, 1) && isBoneLocked(doc, 2));
  assert.ok(isSlotLocked(doc, 0), "the branch's slots lock too");
  assert.ok(!isSlotLocked(doc, 1) && !isBoneLocked(doc, 3));

  toggleSlot(doc, 'hidden', 1);
  assert.ok(isSlotHidden(doc, 1));
  const skip = hiddenSlotSkip(doc);
  assert.equal(skip(1, { type: 'region' }), true);
  assert.equal(skip(1, { type: 'clipping' }), false, 'a hidden clipping mask still clips');
  assert.equal(skip(0, { type: 'region' }), false);
  assert.ok(clearViewState(doc));
  assert.equal(hiddenSlotSkip(doc), undefined);
});

test('visibility: stored by name in work files, kept through renames, never in exports', () => {
  const doc = rig();
  toggleBone(doc, 'hidden', 3);
  toggleSlot(doc, 'locked', 0);
  renameBoneRefs(doc, 'leg', 'shin');
  doc.bones[3].name = 'shin';
  renameSlotRefs(doc, 'hand-img', 'palm');
  doc.slots[0].name = 'palm';
  const back = Skeleton.fromObject(JSON.parse(doc.toSnapshot()));
  assert.ok(isBoneHidden(back, 3));
  assert.ok(isSlotLocked(back, 0));
  assert.deepEqual(back.hidden, { bones: ['shin'], slots: [] });
  const plain = Skeleton.fromObject(JSON.parse(rig().toSnapshot()));
  assert.equal(JSON.parse(plain.toSnapshot()).hidden, undefined, 'nothing is written when nothing is hidden');
});
