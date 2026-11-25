// SPDX-License-Identifier: MIT OR Apache-2.0
// Auto smooth curves: flowing through keys, flat at peaks and ends, never overshooting.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeKey, sample } from '../src/core/animation.js';
import { ease } from '../src/core/curve.js';
import { applyAutoCurves, autoCurve } from '../src/editor/curveauto.js';

test('a peak gets flat tangents: the motion eases in and out of it', () => {
  const keys = [makeKey(0, 0), makeKey(1, 90), makeKey(2, 0)];
  const c = autoCurve(keys, 0);
  assert.deepEqual(c.bezier.slice(0, 2), [0.333333, 0], 'flat out of the first key');
  assert.equal(c.bezier[3], 1, 'flat into the peak');
});

test('keys in a row flow through: the middle key keeps the slope of its neighbours', () => {
  const keys = [makeKey(0, 0), makeKey(1, 50), makeKey(2, 100)];
  const [first, second] = [autoCurve(keys, 0), autoCurve(keys, 1)];
  assert.ok(first.bezier[3] < 1, 'not flat into the middle key');
  assert.ok(second.bezier[1] > 0, 'not flat out of it');
});

test('values never go past the keys', () => {
  const keys = [makeKey(0, 0), makeKey(0.2, 80), makeKey(1, 100), makeKey(1.1, 10)];
  applyAutoCurves(keys);
  for (let i = 0; i < keys.length - 1; i++) {
    const lo = Math.min(keys[i].value, keys[i + 1].value);
    const hi = Math.max(keys[i].value, keys[i + 1].value);
    for (let f = 0; f <= 20; f++) {
      const p = ease(keys[i].curve, f / 20);
      const v = keys[i].value + (keys[i + 1].value - keys[i].value) * p;
      assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6, `segment ${i} stays between its keys`);
    }
  }
});

test('two-number keys get a curve per number; only selected keys change', () => {
  const keys = [makeKey(0, [0, 0]), makeKey(1, [10, 0]), makeKey(2, [20, 5])];
  const sel = new Set([keys[1]]);
  assert.equal(applyAutoCurves(keys, sel), 1);
  assert.equal(keys[0].curve, 'linear');
  assert.equal(keys[1].curve.beziers.length, 2);
});
