// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRESETS,
  actionFor,
  bindCombo,
  comboLabel,
  conflictsFor,
  customBindings,
  importKeymapFile,
  keymapFile,
  newCustom,
  readCustom,
  registerCustom,
  reservedCombo,
  resetCustom,
  shortcutLabel,
  unbindCombo,
  withShortcut,
} from '../src/editor/keymap.js';

test('a new custom keymap is its base preset', () => {
  const custom = newCustom('blender');
  assert.deepEqual(customBindings(custom), PRESETS.blender.bindings);
  assert.equal(newCustom('nope').base, 'reference');
});

test('binding a key adds it, and takes it from the action that had it', () => {
  // In the Spine-like preset, B is the pose tool and N creates bones.
  const { custom, moved } = bindCombo(newCustom('reference'), 'tool.create', 'b');
  assert.deepEqual(moved, ['tool.pose']);
  const b = customBindings(custom);
  assert.deepEqual(b['tool.create'], ['n', 'b']);
  assert.deepEqual(b['tool.pose'], []);
  assert.deepEqual(Object.keys(custom.changes).sort(), ['tool.create', 'tool.pose']);
});

test('replacing a key keeps its place in the list', () => {
  const { custom } = bindCombo(newCustom('blender'), 'view.fit', 'ctrl+h', 'f');
  assert.deepEqual(customBindings(custom)['view.fit'], ['ctrl+h', 'home']);
});

test('changes that match the base preset are dropped', () => {
  let custom = unbindCombo(newCustom('reference'), 'tool.pose', 'b');
  assert.deepEqual(custom.changes, { 'tool.pose': [] });
  custom = bindCombo(custom, 'tool.pose', 'b').custom;
  assert.deepEqual(custom.changes, {});
});

test('reset puts one action, or all of them, back', () => {
  let custom = bindCombo(newCustom('reference'), 'tool.create', 'b').custom;
  custom = resetCustom(custom, 'tool.pose');
  assert.deepEqual(customBindings(custom)['tool.pose'], ['b']);
  assert.deepEqual(resetCustom(custom).changes, {});
});

test('Escape closing menus is not a conflict with deselect', () => {
  const b = PRESETS.reference.bindings;
  assert.deepEqual(conflictsFor(b, 'escape', 'select.none'), []);
  assert.deepEqual(conflictsFor(b, 'b', 'tool.create'), ['tool.pose']);
});

test('a registered custom keymap drives lookups', () => {
  const { custom } = bindCombo(newCustom('reference'), 'file.save', 'ctrl+alt+s');
  registerCustom(custom);
  try {
    assert.equal(actionFor('custom', 'ctrl+alt+s'), 'file.save');
    assert.equal(shortcutLabel('custom', 'file.save'), 'Ctrl+S');
    assert.equal(PRESETS.custom.label, 'Custom');
  } finally {
    registerCustom(null);
  }
  assert.equal(PRESETS.custom, undefined);
});

test('keymap files round-trip and reject other files', () => {
  const { custom } = bindCombo(newCustom('blender'), 'loop.toggle', 'shift+l');
  assert.deepEqual(importKeymapFile(keymapFile(custom)), custom);
  assert.throws(() => importKeymapFile('{"bones": []}'), /not a Rigby2D keymap/);
  assert.throws(() => importKeymapFile('nope'), /not a Rigby2D keymap/);
});

test('reading drops unknown actions, bad combos and reserved keys', () => {
  const custom = readCustom({ base: 'reference', changes: { 'no.such': ['x'], 'tool.pose': ['ctrl+alt+3', 'has space', 'p', 'p'] } });
  assert.deepEqual(custom.changes, { 'tool.pose': ['p'] });
  assert.ok(reservedCombo('ctrl+alt+1'));
  assert.equal(comboLabel('ctrl+shift+arrowleft'), 'Ctrl+Shift+Left');
});

test('tooltips name the shortcut of the current keymap', () => {
  assert.equal(withShortcut('Undo', 'reference', 'edit.undo'), 'Undo (Ctrl+Z)');
  assert.equal(withShortcut('Go to start', 'blender', 'time.start'), 'Go to start (Home)');
  assert.equal(withShortcut('Auto key', 'reference', 'autokey.toggle'), 'Auto key');
});

test('every preset can show or hide bones without a conflict', () => {
  for (const id of ['reference', 'blender']) {
    const combo = PRESETS[id].bindings['view.bones'][0];
    assert.deepEqual(conflictsFor(PRESETS[id].bindings, combo, 'view.bones'), []);
  }
});
