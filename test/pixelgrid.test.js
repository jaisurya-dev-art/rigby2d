// SPDX-License-Identifier: MIT OR Apache-2.0
// Pixel grid (src/webgl/pixelgrid.js and the project setting): the art pixels in view line up with
// the world grid and cover the whole view; the setting is saved only when on.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Skeleton } from '../src/core/model.js';
import { gridRect, MAX_GRID_SIZE } from '../src/webgl/pixelgrid.js';

test('the art pixels in view sit on the world grid and cover the view', () => {
  const camera = { x: 13.3, y: -7.6, zoom: 6.5 };
  for (const size of [1, 2, 3]) {
    const r = gridRect(1280, 720, camera, size);
    assert.ok(r);
    assert.equal(r.x % size === 0 || Object.is(r.x % size, -0), true, 'left edge on the grid');
    assert.equal(r.y % size === 0 || Object.is(r.y % size, -0), true, 'bottom edge on the grid');
    const worldW = 1280 / camera.zoom;
    const worldH = 720 / camera.zoom;
    assert.ok(r.x <= camera.x - worldW / 2 && r.x + r.cols * size >= camera.x + worldW / 2, 'covers the width');
    assert.ok(r.y <= camera.y - worldH / 2 && r.y + r.rows * size >= camera.y + worldH / 2, 'covers the height');
    assert.ok(r.cols <= Math.ceil(worldW / size) + 1 && r.rows <= Math.ceil(worldH / size) + 1, 'no more pixels than needed');
  }
});

test('no grid when art pixels are smaller than screen pixels, or too many', () => {
  assert.equal(gridRect(1280, 720, { x: 0, y: 0, zoom: 0.5 }, 1), null);
  assert.ok(gridRect(1280, 720, { x: 0, y: 0, zoom: 0.5 }, 2));
  assert.equal(gridRect(MAX_GRID_SIZE * 2 + 10, 100, { x: 0, y: 0, zoom: 1 }, 1), null);
  assert.equal(gridRect(100, 100, { x: 0, y: 0, zoom: 4 }, 0), null);
});

test('the project setting survives save and undo, and is left out when off', () => {
  const sk = new Skeleton();
  assert.equal(sk.pixelGrid, 0);
  assert.ok(!sk.toSnapshot().includes('pixelGrid'));
  sk.pixelGrid = 2;
  const back = Skeleton.fromObject(JSON.parse(sk.toSnapshot()));
  assert.equal(back.pixelGrid, 2);
  assert.equal(Skeleton.fromObject({ ...JSON.parse(sk.toSnapshot()), pixelGrid: -1 }).pixelGrid, 0);
});
