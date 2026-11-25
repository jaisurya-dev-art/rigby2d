// SPDX-License-Identifier: MIT OR Apache-2.0
// Command search: menu items (and submenus) become commands with a path; matching needs every word,
// ranks names that start with the query first, and puts disabled commands last.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { commandMatches, menuCommands } from '../src/editor/commandmatch.js';

const run = () => {};
const commands = menuCommands(
  [
    { label: 'Fit the skeleton in view', shortcut: 'Ctrl+Shift+F', action: run },
    { label: 'Frame the selection', shortcut: 'Ctrl+Alt+F', action: run },
    'separator',
    { label: 'Paste keys', action: run },
    { label: 'Paste keys reversed', action: run, disabled: true },
    { label: 'Show bones', action: run },
    null,
  ],
  ['View'],
);

test('menu items become commands with their menu as the path', () => {
  assert.equal(commands.length, 5);
  assert.deepEqual(commands[1], { label: 'Frame the selection', path: ['View'], shortcut: 'Ctrl+Alt+F', disabled: false, run, checked: undefined });
});

test('every word must match; names that start with the query come first', () => {
  assert.deepEqual(commandMatches(commands, 'fra sel').map((c) => c.label), ['Frame the selection']);
  assert.deepEqual(commandMatches(commands, 'f').map((c) => c.label).slice(0, 2), ['Fit the skeleton in view', 'Frame the selection']);
  assert.deepEqual(commandMatches(commands, 'view bones').map((c) => c.label), ['Show bones'], 'the path counts too');
  assert.deepEqual(commandMatches(commands, 'nothing like this'), []);
});

test('disabled commands go last, and an empty query lists only enabled ones', () => {
  assert.deepEqual(commandMatches(commands, 'paste').map((c) => c.label), ['Paste keys', 'Paste keys reversed']);
  assert.ok(!commandMatches(commands, '').some((c) => c.disabled));
});
