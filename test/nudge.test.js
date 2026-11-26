// SPDX-License-Identifier: MIT OR Apache-2.0
// The share, star and support prompts (nudge.js): rare, and gone once acted on or dismissed enough.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countDay, countWork, fundDue, mayShow } from '../src/editor/nudge.js';

const DAY = 24 * 60 * 60 * 1000;

test('a prompt waits between showings, and stops once acted on or dismissed enough', () => {
  const now = Date.UTC(2026, 9, 30);
  const rule = { gap: 7, maxDismiss: 3 };
  assert.ok(mayShow({}, 'share', now, rule));
  assert.ok(!mayShow({ share: { shownAt: now - 2 * DAY } }, 'share', now, rule));
  assert.ok(mayShow({ share: { shownAt: now - 8 * DAY } }, 'share', now, rule));
  assert.ok(!mayShow({ share: { done: true } }, 'share', now, rule));
  assert.ok(!mayShow({ share: { dismissed: 3 } }, 'share', now, rule));
});

test('days of use are counted once per day', () => {
  const s = {};
  const d = Date.UTC(2026, 9, 30, 9);
  assert.equal(countDay(s, d), 1);
  assert.equal(countDay(s, d + 3600e3), 1);
  assert.equal(countDay(s, d + DAY), 2);
});

test('the support prompt waits for the third finished job and five days of use', () => {
  const now = Date.UTC(2026, 10, 26);
  const s = { days: 5 };
  countWork(s);
  countWork(s);
  assert.ok(!fundDue(s, now), 'two jobs are not enough');
  countWork(s);
  assert.ok(fundDue(s, now), 'the third job, after five days');
  assert.ok(!fundDue({ days: 4, work: 9 }, now), 'too early in the first days');
  assert.ok(!fundDue({ days: 9, work: 9, fund: { shownAt: now - 10 * DAY } }, now), 'at most every 45 days');
  assert.ok(fundDue({ days: 9, work: 9, fund: { shownAt: now - 46 * DAY } }, now));
  assert.ok(!fundDue({ days: 9, work: 9, fund: { dismissed: 2 } }, now), 'gone after two Not nows');
  assert.ok(!fundDue({ days: 9, work: 9, fund: { done: true } }, now), 'gone once they opened the page');
});
