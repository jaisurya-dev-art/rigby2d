// SPDX-License-Identifier: MIT OR Apache-2.0
// Onion skinning settings (onion.js): per-bone overrides follow their bone by name through deletes,
// reparenting, undo-style rebuilds and renames (including undoing one), and stale entries never mask the whole skeleton.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { Skeleton, readSkeletonJson } from '../src/core/index.js';
import { followBoneRenames, onionFor, onionOverride, onionOverrideCount, renameOnionBone, setOnionOverride } from '../src/editor/onion.js';

const json = JSON.parse(readFileSync(new URL('../branding/rigbytron/export/rigbytron.json', import.meta.url), 'utf8'));
const load = () => readSkeletonJson(json, 'rigbytron').skeleton;
const settings = () => ({ showFuture: true, showPast: true, future: 3, past: 2, futureColor: [0, 0, 1], pastColor: [1, 0, 0], perBone: new Map() });
const index = (doc, name) => doc.bones.findIndex((b) => b.name === name);
// A bone with children and a later sibling, so deleting or reparenting shifts other indices.
const pick = (doc) => {
  const parent = doc.bones.findIndex((b, i) => i > 0 && doc.bones.some((c) => c.parent === i));
  return { parent, child: doc.bones.findIndex((b) => b.parent === parent) };
};

test('no overrides: every bone uses the global settings', () => {
  const doc = load();
  const o = settings();
  assert.equal(onionOverrideCount(doc, o), 0);
  for (let b = 0; b < doc.bones.length; b++) assert.deepEqual(onionFor(doc, o, b), { future: 3, past: 2, futureColor: [0, 0, 1], pastColor: [1, 0, 0] });
});

test('an override applies to its bone and descendants only', () => {
  const doc = load();
  const o = settings();
  const { parent, child } = pick(doc);
  setOnionOverride(doc, o, parent, { future: 5, showPast: false });
  assert.equal(onionOverrideCount(doc, o), 1);
  assert.deepEqual(onionFor(doc, o, parent), { future: 5, past: 0, futureColor: [0, 0, 1], pastColor: [1, 0, 0] });
  assert.equal(onionFor(doc, o, child).future, 5, 'children inherit');
  assert.equal(onionFor(doc, o, 0), null, 'the root is not ghosted');
});

test('overrides stay on their bone when indices shift (delete, reparent, rebuild)', () => {
  const doc = load();
  const o = settings();
  const last = doc.bones[doc.bones.length - 1].name;
  setOnionOverride(doc, o, doc.bones.length - 1, { future: 7 });
  // Deleting an earlier bone (and its subtree) shifts the last bone's index down.
  const { parent } = pick(doc);
  if (doc.bones[parent].name !== last && !doc.isDescendant(index(doc, last), parent)) {
    doc.removeBone(parent);
    assert.equal(onionOverride(doc, o, index(doc, last))?.future, 7);
    assert.equal(onionFor(doc, o, index(doc, last)).future, 7);
  }
  // Undo/redo and cross-window sync rebuild the document: new objects, same names.
  const rebuilt = load();
  assert.equal(onionOverride(rebuilt, o, index(rebuilt, last))?.future, 7);
  // Reparenting reorders bones; the override follows the name.
  const target = rebuilt.bones.findIndex((b, i) => i > 0 && b.name !== last && !rebuilt.isDescendant(i, index(rebuilt, last)));
  rebuilt.reparentBone(index(rebuilt, last), target);
  assert.equal(onionOverride(rebuilt, o, index(rebuilt, last))?.future, 7);
});

test('entries for bones that are gone do not hide the rest of the skeleton', () => {
  const doc = load();
  const o = settings();
  o.perBone.set('no-such-bone', { future: 9 });
  assert.equal(onionOverrideCount(doc, o), 0);
  assert.equal(onionFor(doc, o, 0).future, 3, 'falls back to the whole skeleton');
});

test('renaming a bone carries its override', () => {
  const doc = load();
  const o = settings();
  const { parent } = pick(doc);
  const old = doc.bones[parent].name;
  setOnionOverride(doc, o, parent, { past: 4 });
  renameOnionBone(o, old, 'renamed');
  doc.bones[parent].name = 'renamed';
  assert.equal(onionOverride(doc, o, parent)?.past, 4);
  assert.equal(o.perBone.has(old), false);
  setOnionOverride(doc, o, parent, null);
  assert.equal(onionOverrideCount(doc, o), 0);
});

test('undoing and redoing a rename keeps the override on its bone', () => {
  const doc = load();
  const o = settings();
  const { parent } = pick(doc);
  const old = doc.bones[parent].name;
  setOnionOverride(doc, o, parent, { past: 4 });
  // Rename as the inspector does, then undo/redo by rebuilding from snapshots.
  const beforeRename = doc.toSnapshot();
  renameOnionBone(o, old, 'renamed');
  doc.bones[parent].name = 'renamed';
  const afterRename = doc.toSnapshot();
  const undone = Skeleton.fromObject(JSON.parse(beforeRename));
  followBoneRenames(o, doc, undone);
  assert.equal(onionOverride(undone, o, parent)?.past, 4, 'undo brings the override back to the old name');
  assert.equal(onionOverrideCount(undone, o), 1, 'the rest of the skeleton stays unghosted');
  assert.equal(onionFor(undone, o, 0), null);
  const redone = Skeleton.fromObject(JSON.parse(afterRename));
  followBoneRenames(o, undone, redone);
  assert.equal(onionOverride(redone, o, parent)?.past, 4, 'redo moves it to the new name again');
  assert.deepEqual([...o.perBone.keys()], ['renamed']);
});

test('rebuilds without a rename leave overrides alone', () => {
  const doc = load();
  const o = settings();
  const last = doc.bones[doc.bones.length - 1].name;
  setOnionOverride(doc, o, doc.bones.length - 1, { future: 7 });
  // Reparenting reorders bones (same count, names at shifted indices): nothing is renamed.
  const moved = Skeleton.fromObject(JSON.parse(doc.toSnapshot()));
  const target = moved.bones.findIndex((b, i) => i > 0 && b.name !== last && !moved.isDescendant(i, index(moved, last)));
  moved.reparentBone(index(moved, last), target);
  followBoneRenames(o, doc, moved);
  followBoneRenames(o, moved, doc);
  assert.deepEqual([...o.perBone.keys()], [last]);
  // Deleting a bone changes the count: nothing to follow.
  const fewer = Skeleton.fromObject(JSON.parse(doc.toSnapshot()));
  fewer.removeBone(pick(fewer).parent);
  followBoneRenames(o, doc, fewer);
  assert.deepEqual([...o.perBone.keys()], [last]);
});
