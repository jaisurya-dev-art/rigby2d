// SPDX-License-Identifier: MIT OR Apache-2.0
// Named window layouts store (layouts.js): upsert/rename/delete, and that a Ctrl+Alt+<digit>
// shortcut stays unique — assigning one to a layout clears it from whichever held it before.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignHotkey, byHotkey, hotkeyLabel, loadLayouts, removeLayout, renameLayout, saveLayouts, updatePanels, upsertLayout } from '../src/editor/layouts.js';

const layout = (id, name, hotkey = null, panels = {}) => ({ id, name, hotkey, panels });

test('upsert adds, then replaces by id', () => {
  let list = [];
  list = upsertLayout(list, layout('a', 'One'));
  list = upsertLayout(list, layout('b', 'Two'));
  assert.deepEqual(list.map((l) => l.name), ['One', 'Two']);
  list = upsertLayout(list, layout('a', 'One renamed'));
  assert.equal(list.length, 2);
  assert.equal(list.find((l) => l.id === 'a').name, 'One renamed');
});

test('a hotkey is unique across layouts', () => {
  let list = [layout('a', 'A', 3), layout('b', 'B', null)];
  list = assignHotkey(list, 'b', 3); // steal Ctrl+Alt+3 from A
  assert.equal(byHotkey(list, 3).id, 'b');
  assert.equal(list.find((l) => l.id === 'a').hotkey, null, 'A lost the shortcut');
  // Adding a new layout that claims an in-use digit also clears the old holder.
  list = upsertLayout(list, layout('c', 'C', 3));
  assert.equal(byHotkey(list, 3).id, 'c');
  assert.equal(list.find((l) => l.id === 'b').hotkey, null);
});

test('assigning digit 0 works and is distinct from null', () => {
  let list = [layout('a', 'A', 0)];
  assert.equal(byHotkey(list, 0).id, 'a');
  assert.equal(byHotkey(list, null), null, 'null never matches a real layout');
  list = assignHotkey(list, 'a', null);
  assert.equal(list[0].hotkey, null);
});

test('rename, update panels, and remove', () => {
  let list = [layout('a', 'A', null, { timeline: { x: 0, y: 0, w: 10, h: 10 } })];
  list = renameLayout(list, 'a', 'Renamed');
  assert.equal(list[0].name, 'Renamed');
  list = updatePanels(list, 'a', { tree: { x: 1, y: 2, w: 3, h: 4 } });
  assert.deepEqual(Object.keys(list[0].panels), ['tree']);
  list = removeLayout(list, 'a');
  assert.deepEqual(list, []);
});

test('hotkeyLabel shows the combo, or nothing without one', () => {
  assert.equal(hotkeyLabel(5), 'Ctrl+Alt+5');
  assert.equal(hotkeyLabel(0), 'Ctrl+Alt+0');
  assert.equal(hotkeyLabel(null), '');
  assert.equal(hotkeyLabel(undefined), '');
});

test('load/save round trip through an injected storage, ignoring malformed entries', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveLayouts([layout('a', 'A', 1, { timeline: { x: 0, y: 0, w: 1, h: 1 } })], storage);
  const back = loadLayouts(storage);
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'A');
  // Malformed rows are dropped, not thrown on.
  storage.setItem('rigby.layouts', JSON.stringify([{ nope: true }, layout('b', 'B')]));
  assert.deepEqual(loadLayouts(storage).map((l) => l.name), ['B']);
  // Unreadable storage yields an empty list.
  assert.deepEqual(loadLayouts({ getItem: () => '{bad json' }), []);
});
