// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';

import { defoldAtlas, frameCount, frameName, opaqueRect, packRects } from '../src/editor/spritesheet.js';

test('a loop leaves out its last frame, a one-shot keeps it', () => {
  assert.equal(frameCount(1, 30, true), 30);
  assert.equal(frameCount(1, 30, false), 31);
  assert.equal(frameName('walk', 7), 'walk_007');
});

test('packed rectangles never overlap and stay inside the sheet', () => {
  const sizes = [
    { w: 40, h: 30 },
    { w: 10, h: 50 },
    { w: 25, h: 25 },
    { w: 60, h: 10 },
  ];
  for (const layout of ['packed', 'grid']) {
    const { width, height, places } = packRects(sizes, { layout, padding: 2 });
    places.forEach((p, i) => {
      assert.ok(p.x + sizes[i].w <= width && p.y + sizes[i].h <= height);
      places.forEach((q, j) => {
        if (i >= j) return;
        const apart = p.x + sizes[i].w <= q.x || q.x + sizes[j].w <= p.x || p.y + sizes[i].h <= q.y || q.y + sizes[j].h <= p.y;
        assert.ok(apart, `${layout}: ${i} and ${j} overlap`);
      });
    });
  }
});

test('opaque rect finds the visible pixels', () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  rgba[(1 * 4 + 2) * 4 + 3] = 255;
  rgba[(2 * 4 + 1) * 4 + 3] = 10;
  assert.deepEqual(opaqueRect(rgba, 4, 4), { x: 1, y: 1, w: 2, h: 2 });
  assert.equal(opaqueRect(new Uint8ClampedArray(16), 2, 2), null);
});

test('Defold atlas lists one animation per animation', () => {
  const text = defoldAtlas([{ name: 'walk_000', animation: 'walk' }, { name: 'walk_001', animation: 'walk' }], { folder: 'hero', fps: 30, loop: true });
  assert.match(text, /id: "walk"/);
  assert.match(text, /image: "\/hero\/walk_001.png"/);
  assert.match(text, /PLAYBACK_LOOP_FORWARD/);
});
