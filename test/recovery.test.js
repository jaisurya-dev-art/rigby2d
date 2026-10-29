// SPDX-License-Identifier: MIT OR Apache-2.0
// File safety (recovery.js, prefs.js): numbered backups, crashed-session detection, crash reports,
// and preferences that fall back to their defaults when stored values are wrong.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STALE_MS, backupPath, backupShifts, crashReport, crashedSessions, deadSessions, isBackup, replaceWithBackups } from '../src/editor/recovery.js';
import { PREFS, STORAGE_KEY, createPrefs, validPref } from '../src/editor/prefs.js';

test('backups are numbered like .blend1: walk.rigby1 is the newest', () => {
  assert.equal(backupPath('C:/art/walk.rigby', 1), 'C:/art/walk.rigby1');
  assert.ok(isBackup('walk.rigby3'));
  assert.ok(!isBackup('walk.rigby'));
  assert.deepEqual(backupShifts('w.rigby', 1), []);
  // Oldest first, so nothing is overwritten before it moves.
  assert.deepEqual(backupShifts('w.rigby', 3), [
    ['w.rigby2', 'w.rigby3'],
    ['w.rigby1', 'w.rigby2'],
  ]);
});

test('saving keeps numbered backups and never leaves a half-written file', async () => {
  const disk = new Map();
  const ops = {
    writeFile: async (p, b) => void disk.set(p, b),
    exists: async (p) => disk.has(p),
    rename: async (from, to) => {
      disk.set(to, disk.get(from));
      disk.delete(from);
    },
    copyFile: async (from, to) => void disk.set(to, disk.get(from)),
  };
  for (const v of ['v1', 'v2', 'v3', 'v4']) await replaceWithBackups(ops, 'w.rigby', v, 2);
  assert.deepEqual(Object.fromEntries(disk), { 'w.rigby': 'v4', 'w.rigby1': 'v3', 'w.rigby2': 'v2' });
  await replaceWithBackups(ops, 'n.rigby', 'a', 0);
  await replaceWithBackups(ops, 'n.rigby', 'b', 0);
  assert.equal(disk.get('n.rigby'), 'b');
  assert.ok(!disk.has('n.rigby1') && !disk.has('n.rigby.saving'));
  // A failed write leaves the saved file untouched.
  const failing = { ...ops, writeFile: async () => { throw new Error('disk full'); } };
  await assert.rejects(replaceWithBackups(failing, 'w.rigby', 'v5', 2), /disk full/);
  assert.equal(disk.get('w.rigby'), 'v4');
});

test('a session counts as crashed when its heartbeat stopped and it left an auto-save', () => {
  const now = 1_000_000;
  const records = [
    { id: 'me', beat: now - STALE_MS * 4 },
    { id: 'running', beat: now - 1000 },
    { id: 'old', beat: now - STALE_MS - 1 },
    { id: 'older', beat: now - STALE_MS * 10 },
    { id: 'closed', beat: now - STALE_MS * 10, clean: true },
    { id: 'answered', beat: now - STALE_MS * 10 },
    { id: 'nothing', beat: now - STALE_MS * 10 },
  ];
  const hasAutosave = (r) => r.id !== 'nothing';
  const alive = new Set(['answered']);
  const crashed = crashedSessions(records, { now, current: 'me', alive, hasAutosave });
  assert.deepEqual(
    crashed.map((r) => r.id),
    ['old', 'older'],
  );
  assert.deepEqual(
    deadSessions(records, { now, current: 'me', alive, hasAutosave }).map((r) => r.id),
    ['nothing'],
  );
});

test('crash reports hide home folder names', () => {
  const text = crashReport({
    version: '0.4.0',
    platform: 'desktop',
    when: new Date(0),
    errors: [{ source: 'editor', message: 'Could not open C:\\Users\\jai\\walk.rigby', trace: 'at /home/jai/x.js:1' }],
  });
  assert.match(text, /^Rigby2D 0\.4\.0 on desktop/);
  assert.ok(!text.includes('jai'), text);
  assert.match(text, /Users\\…\\walk\.rigby/);
});

test('preferences keep valid values and fall back to defaults', () => {
  assert.equal(validPref('files.backups', 4), 4);
  assert.equal(validPref('files.backups', 99), PREFS['files.backups'].max);
  assert.equal(validPref('files.backups', 'x'), PREFS['files.backups'].default);
  assert.equal(validPref('files.autosave', 'yes'), true);
  assert.deepEqual(validPref('addons.enabled', [1]), {});

  const data = new Map([[STORAGE_KEY, JSON.stringify({ 'editing.undoSteps': 5, 'files.autosave': false })]]);
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const prefs = createPrefs(storage);
  assert.equal(prefs.get('editing.undoSteps'), PREFS['editing.undoSteps'].min);
  assert.equal(prefs.get('files.autosave'), false);
  let changed = null;
  prefs.onChange((key) => (changed = key));
  prefs.set('files.autosaveMinutes', 5);
  assert.equal(changed, 'files.autosaveMinutes');
  assert.equal(createPrefs(storage).get('files.autosaveMinutes'), 5);
  prefs.reset();
  assert.equal(createPrefs(storage).get('files.autosave'), true);
  assert.throws(() => prefs.set('nope', 1));
  // Unreadable storage leaves the defaults.
  assert.equal(createPrefs({ getItem: () => '{', setItem() {} }).get('files.backups'), 1);
});
