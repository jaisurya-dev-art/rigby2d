// SPDX-License-Identifier: MIT OR Apache-2.0
// The share and star prompts (nudge.js): rare, and gone once acted on or dismissed enough.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countDay, mayShow } from '../src/editor/nudge.js';

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
