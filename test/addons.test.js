// SPDX-License-Identifier: MIT OR Apache-2.0
// Add-on packages (addons.js): .py and .zip files, the package root inside a zip, ids, manifests
// and version checks.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addonId, addonManifest, compareVersions, disableAddonPy, enableAddonPy, readAddonPackage, versionText } from '../src/editor/addons.js';
import { zip } from '../src/editor/zip.js';

const enc = new TextEncoder();
const file = (path, text) => ({ path, bytes: enc.encode(text) });

test('add-on ids are Python identifiers', () => {
  assert.equal(addonId('Mirror Tools-main.zip'), 'mirror_tools_main');
  assert.equal(addonId('2d_helpers.py'), 'addon_2d_helpers');
  assert.equal(addonId('---'), 'addon');
});

test('a .py file is a one-module add-on', () => {
  const pkg = readAddonPackage('C:\\Downloads\\My Tool.py', enc.encode('addon_info = {}'));
  assert.equal(pkg.id, 'my_tool');
  assert.deepEqual([...pkg.files.keys()], ['__init__.py']);
});

test('a zip holds a package at its top or inside one folder', () => {
  const nested = zip([file('mirror-main/__init__.py', 'x'), file('mirror-main/ops/flip.py', 'y'), file('mirror-main/tests/__init__.py', 'z'), file('__MACOSX/._x', '')]);
  const pkg = readAddonPackage('mirror-main.zip', nested);
  assert.equal(pkg.id, 'mirror_main');
  assert.deepEqual([...pkg.files.keys()].sort(), ['__init__.py', 'ops/flip.py', 'tests/__init__.py']);

  const flat = readAddonPackage('Rig Helpers.zip', zip([file('__init__.py', 'x')]));
  assert.equal(flat.id, 'rig_helpers');
  assert.throws(() => readAddonPackage('x.zip', zip([file('readme.md', '')])), /__init__\.py/);
  assert.throws(() => readAddonPackage('x.txt', enc.encode('')), /\.zip or \.py/);
});

test('manifests need a name and an editor that is new enough', () => {
  const m = addonManifest('mirror', { name: ' Mirror ', version: [1, 2, 0], rigby: [0, 3, 0], doc_url: 'https://x' }, { editorVersion: '0.3.3', file: 'm.zip', now: new Date(0) });
  assert.deepEqual(m, { id: 'mirror', name: 'Mirror', version: '1.2.0', author: '', description: '', rigby: '0.3.0', url: 'https://x', file: 'm.zip', installed: new Date(0).toISOString() });
  assert.throws(() => addonManifest('x', null), /addon_info/);
  assert.throws(() => addonManifest('x', { version: '1' }), /name/);
  assert.throws(() => addonManifest('x', { name: 'X', rigby: [9, 0] }, { editorVersion: '0.3.3' }), /needs Rigby2D 9\.0/);
  // Development builds (no version) accept every add-on.
  assert.equal(addonManifest('x', { name: 'X', rigby: [9, 0] }).rigby, '9.0');
});

test('versions compare part by part', () => {
  assert.equal(versionText([1, 0]), '1.0');
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.0', [1, 0, 0]), 0);
  assert.ok(compareVersions('0.3.3', '0.4') < 0);
});

test('enable and disable code names only the add-on module', () => {
  assert.match(enableAddonPy('mirror'), /import_module\("mirror"\)/);
  assert.match(disableAddonPy('mirror'), /unregister\(\)/);
});
