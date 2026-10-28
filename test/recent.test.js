// SPDX-License-Identifier: MIT OR Apache-2.0
// File ▸ Open recent (editor/recent.js): newest first, no duplicates, a size limit, and display helpers.

import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { ago, clearRecentProjects, forgetProject, recentProjects, rememberProject, splitPath } = await import('../src/editor/recent.js');

test('projects are listed newest first, once each, up to a limit', () => {
  clearRecentProjects();
  rememberProject({ kind: 'file', path: 'C:\\art\\hero.rigby' });
  rememberProject({ kind: 'demo', id: 'nila', name: 'NILA' });
  rememberProject({ kind: 'file', path: 'c:\\ART\\hero.rigby' }); // same file, other case (Windows)
  assert.deepEqual(
    recentProjects().map((e) => e.path ?? e.id),
    ['c:\\ART\\hero.rigby', 'nila'],
  );
  for (let i = 0; i < 20; i++) rememberProject({ kind: 'file', path: `/p/${i}.rigby` });
  assert.equal(recentProjects().length, 12);
  assert.equal(recentProjects()[0].path, '/p/19.rigby');
  forgetProject({ kind: 'file', path: '/p/19.rigby' });
  assert.equal(recentProjects()[0].path, '/p/18.rigby');
});

test('a damaged list reads as empty', () => {
  localStorage.setItem('rigby.recent', '{not json');
  assert.deepEqual(recentProjects(), []);
  localStorage.setItem('rigby.recent', JSON.stringify([{ kind: 'file' }, { kind: 'demo', id: 'scene' }, 7]));
  assert.deepEqual(recentProjects(), [{ kind: 'demo', id: 'scene' }]);
});

test('display helpers', () => {
  assert.deepEqual(splitPath('C:\\Users\\me\\hero.rigby'), { name: 'hero.rigby', folder: 'C:\\Users\\me' });
  assert.deepEqual(splitPath('/home/me/hero.rigby'), { name: 'hero.rigby', folder: '/home/me' });
  assert.deepEqual(splitPath('hero.rigby'), { name: 'hero.rigby', folder: '' });
  const now = 1_800_000_000_000;
  assert.equal(ago(now - 5_000, now), 'just now');
  assert.equal(ago(now - 5 * 60_000, now), '5 min ago');
  assert.equal(ago(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(ago(now - 30 * 3_600_000, now), 'yesterday');
  assert.equal(ago(now - 4 * 86_400_000, now), '4 days ago');
});
