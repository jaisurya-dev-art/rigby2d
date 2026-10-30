// SPDX-License-Identifier: MIT OR Apache-2.0
// Share to r/rigby2d (share.js): clip settings sized for Reddit and the new-post address.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shareSettings, shareTitle, submitUrl } from '../src/editor/share.js';
import { outputFrame } from '../src/editor/output.js';

test('clips are scaled down to the chosen size, never up', () => {
  const s = { width: 1920, height: 1080, fps: 30, background: null, frame: null };
  const out = shareSettings(s, { size: 480, fps: 15, background: [0, 0, 0, 1] });
  assert.deepEqual([out.width, out.height, out.fps], [480, 270, 15]);
  assert.deepEqual(out.background, [0, 0, 0, 1]);
  const small = shareSettings({ ...s, width: 300, height: 400 }, { size: 720, fps: 25, background: null });
  assert.deepEqual([small.width, small.height], [300, 400]);
});

test('a fixed framing shows the same part of the scene when smaller', () => {
  const s = { width: 1920, height: 1080, fps: 24, frame: { x: 10, y: 20, scale: 0.5 } };
  const big = outputFrame(s, null);
  const small = outputFrame(shareSettings(s, { size: 640, fps: 24, background: null }), null);
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(big[k] - small[k]) < 1, k);
});

test('the post page opens with the title filled in', () => {
  assert.equal(submitUrl(' NILA: wave & wink '), 'https://www.reddit.com/r/rigby2d/submit/?type=IMAGE&title=NILA%3A%20wave%20%26%20wink');
  assert.equal(shareTitle('NILA', 'wave'), 'NILA: wave, made in Rigby2D');
  assert.equal(shareTitle('', 'walk'), 'walk, made in Rigby2D');
});
