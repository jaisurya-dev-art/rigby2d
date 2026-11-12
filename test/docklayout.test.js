// SPDX-License-Identifier: MIT OR Apache-2.0
// The dock layout: regions of tab groups inside the editor window (src/editor/docklayout.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activatePanel, defaultDock, findPanel, isDefaultDock, loadDock, movePanel, normalizeDock, saveDock, setWeights, visibleDock } from '../src/editor/docklayout.js';

const tabs = (l) => Object.fromEntries(['left', 'right', 'bottom'].map((r) => [r, l[r].groups.map((g) => g.tabs)]));

test('the default is tree over inspector on the right and the timeline at the bottom', () => {
  assert.deepEqual(tabs(defaultDock()), { left: [], right: [['tree'], ['inspector']], bottom: [['timeline']] });
  assert.ok(isDefaultDock(defaultDock()));
});

test('dropping a tab on a tab strip groups the panels, and the dropped one is shown', () => {
  const l = movePanel(defaultDock(), 'inspector', { region: 'right', group: 0, where: 'tab' });
  assert.deepEqual(tabs(l).right, [['tree', 'inspector']]);
  assert.equal(l.right.groups[0].active, 'inspector');
  assert.ok(!isDefaultDock(l));
  // At a given index: before the tree.
  const m = movePanel(defaultDock(), 'inspector', { region: 'right', group: 0, where: 'tab', index: 0 });
  assert.deepEqual(tabs(m).right, [['inspector', 'tree']]);
});

test('reordering tabs inside one group', () => {
  const l = movePanel(defaultDock(), 'inspector', { region: 'right', group: 0, where: 'tab' });
  const m = movePanel(l, 'inspector', { region: 'right', group: 0, where: 'tab', index: 0 });
  assert.deepEqual(tabs(m).right, [['inspector', 'tree']]);
});

test('dropping on an edge splits: a new group beside the target', () => {
  const l = movePanel(defaultDock(), 'timeline', { region: 'right', group: 1, where: 'after' });
  assert.deepEqual(tabs(l), { left: [], right: [['tree'], ['inspector'], ['timeline']], bottom: [] });
  // The new group takes half of its neighbour's share.
  assert.equal(l.right.groups[1].weight, l.right.groups[2].weight);
  const b = movePanel(defaultDock(), 'tree', { region: 'bottom', group: 0, where: 'before' });
  assert.deepEqual(tabs(b), { left: [], right: [['inspector']], bottom: [['tree'], ['timeline']] });
});

test('a group of its own in an empty region, and the input layout is untouched', () => {
  const d = defaultDock();
  const l = movePanel(d, 'tree', { region: 'left', where: 'new' });
  assert.deepEqual(tabs(l).left, [['tree']]);
  assert.deepEqual(tabs(d), tabs(defaultDock()));
});

test('dropping a panel onto its own single-panel group changes nothing', () => {
  const d = defaultDock();
  assert.equal(movePanel(d, 'tree', { region: 'right', group: 0, where: 'tab' }), d);
  assert.equal(movePanel(d, 'tree', { region: 'right', group: 0, where: 'after' }), d);
  assert.equal(movePanel(d, 'nope', { region: 'right', where: 'new' }), d);
});

test('moving the last tab out of a group removes the group; the other tab is shown', () => {
  let l = movePanel(defaultDock(), 'inspector', { region: 'right', group: 0, where: 'tab' });
  l = movePanel(l, 'inspector', { region: 'bottom', group: 0, where: 'tab' });
  assert.deepEqual(tabs(l), { left: [], right: [['tree']], bottom: [['timeline', 'inspector']] });
  assert.equal(l.right.groups[0].active, 'tree');
  assert.deepEqual(findPanel(l, 'inspector'), { region: 'bottom', group: 0, tab: 1 });
});

test('activate and weights', () => {
  let l = movePanel(defaultDock(), 'inspector', { region: 'right', group: 0, where: 'tab' });
  l = activatePanel(l, 'tree');
  assert.equal(l.right.groups[0].active, 'tree');
  const w = setWeights(defaultDock(), 'right', [10, 90]);
  assert.deepEqual(w.right.groups.map((g) => g.weight), [10, 90]);
});

test('hidden panels (popped out, timeline in Setup) leave the view; the group shows another tab', () => {
  const l = movePanel(defaultDock(), 'inspector', { region: 'right', group: 0, where: 'tab' });
  const v = visibleDock(l, new Set(['inspector', 'timeline']));
  assert.equal(v.right.length, 1);
  assert.deepEqual(v.right[0].tabs, ['tree']);
  assert.equal(v.right[0].active, 'tree');
  assert.deepEqual(v.bottom, []);
});

test('normalize repairs stored layouts: unknown, duplicate and missing panels', () => {
  const l = normalizeDock({ left: { groups: [{ tabs: ['tree', 'tree', 'ghost'], active: 'ghost' }] }, right: { groups: [{ tabs: [] }] } });
  assert.deepEqual(tabs(l), { left: [['tree']], right: [['inspector']], bottom: [['timeline']] });
  assert.equal(l.left.groups[0].active, 'tree');
  assert.deepEqual(tabs(normalizeDock(null)), tabs(defaultDock()));
  assert.deepEqual(tabs(normalizeDock('junk')), tabs(defaultDock()));
});

test('load/save round trip; null forgets it', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.ok(isDefaultDock(loadDock(storage)));
  const l = movePanel(defaultDock(), 'timeline', { region: 'left', where: 'new' });
  saveDock(l, storage);
  assert.deepEqual(tabs(loadDock(storage)), tabs(l));
  saveDock(null, storage);
  assert.ok(isDefaultDock(loadDock(storage)));
  store.set('rigby.layout.dock', '{not json');
  assert.ok(isDefaultDock(loadDock(storage)));
});
