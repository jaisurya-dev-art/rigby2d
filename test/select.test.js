// SPDX-License-Identifier: MIT OR Apache-2.0
// Selecting related bones (Edit ▸ Select all bones / Select related): all, parent, children, branch,
// skipping hidden and locked bones for "all".

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { transform } from '../src/core/math.js';
import { Skeleton, makeBone, makeAttachment, makeSlot } from '../src/core/model.js';
import { selectRelated } from '../src/editor/selection.js';
import { setViewState } from '../src/editor/visibility.js';

/** root ─ hip ─ (spine ─ head, leg ─ foot) and a slot on the leg. */
function rig() {
  const doc = new Skeleton();
  const add = (name, parent) => doc.addBone(makeBone(name, doc.boneIndex(parent), transform(0, 0, 0), 10));
  add('hip', 'root');
  add('spine', 'hip');
  add('head', 'spine');
  add('leg', 'hip');
  add('foot', 'leg');
  doc.slots.push(makeSlot('leg', doc.boneIndex('leg'), makeAttachment('leg', 'leg', transform(0, 0, 0), 4, 4)));
  return doc;
}

/** Just enough of the editor's App for selection. */
function fakeApp(doc, sel = null) {
  const app = {
    doc,
    sel,
    multi: new Set(),
    status: '',
    selectedBones() {
      return this.multi.size ? [...this.multi] : this.sel?.bone !== undefined ? [this.sel.bone] : [];
    },
    selectBones(bones, active = bones[0]) {
      this.multi = bones.length > 1 ? new Set(bones) : new Set();
      this.sel = bones.length ? { bone: active } : null;
    },
    setStatus(s) {
      this.status = s;
    },
  };
  return app;
}

const names = (app) => app.selectedBones().map((i) => app.doc.bones[i].name).sort();

test('select all skips hidden and locked bones', () => {
  const doc = rig();
  setViewState(doc, 'hidden', { bones: [doc.boneIndex('head')] }, true);
  setViewState(doc, 'locked', { bones: [doc.boneIndex('foot')] }, true);
  const app = fakeApp(doc);
  assert.equal(selectRelated(app, 'all'), 4);
  assert.deepEqual(names(app), ['hip', 'leg', 'root', 'spine']);
});

test('parent, children and branch from the selection', () => {
  const doc = rig();
  const app = fakeApp(doc, { bone: doc.boneIndex('hip') });
  selectRelated(app, 'children');
  assert.deepEqual(names(app), ['leg', 'spine']);
  selectRelated(app, 'parent');
  assert.deepEqual(names(app), ['hip'], 'the parent of both children, once');
  selectRelated(app, 'branch');
  assert.deepEqual(names(app), ['foot', 'head', 'hip', 'leg', 'spine']);
  assert.equal(app.doc.bones[app.sel.bone].name, 'hip', 'the bone the branch started from stays active');
});

test('a selected slot counts as its bone; the root has no parent', () => {
  const doc = rig();
  const app = fakeApp(doc, { slot: 0 });
  selectRelated(app, 'children');
  assert.deepEqual(names(app), ['foot']);
  const root = fakeApp(doc, { bone: 0 });
  assert.equal(selectRelated(root, 'parent'), 0);
  assert.match(root.status(), /root/i, 'the status says why (a function that renders the text)');
});
