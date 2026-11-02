// SPDX-License-Identifier: MIT OR Apache-2.0
// PNG layer sets (pngset.js): same-size PNGs exported from a layered drawing are recognised, cropped
// to their visible pixels, placed where they were drawn, named and ordered like PSD layers.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alphaBounds, backToFront, isLayerSet, layerCenter, layerName } from '../src/editor/pngset.js';

test('a layer set is two or more images of one size', () => {
  assert.equal(isLayerSet([{ width: 800, height: 600 }, { width: 800, height: 600 }]), true);
  assert.equal(isLayerSet([{ width: 800, height: 600 }, { width: 120, height: 80 }]), false);
  assert.equal(isLayerSet([{ width: 800, height: 600 }]), false);
  assert.equal(isLayerSet([]), false);
});

test('alpha bounds find the visible pixels, or null for an empty layer', () => {
  const w = 6;
  const h = 5;
  const data = new Uint8ClampedArray(w * h * 4);
  const opaque = (x, y) => (data[(y * w + x) * 4 + 3] = 255);
  assert.equal(alphaBounds(data, w, h), null);
  opaque(1, 2);
  opaque(4, 3);
  assert.deepEqual(alphaBounds(data, w, h), { x: 1, y: 2, width: 4, height: 2 });
});

test('a cropped layer is centered where it was drawn, bottom-center origin, y up (as a PSD)', () => {
  // A 100x40 layer drawn at (450, 100) on a 1000x800 canvas.
  assert.deepEqual(layerCenter({ x: 450, y: 100, width: 100, height: 40 }, 1000, 800), [0, 680]);
  // A layer touching the bottom-left corner.
  assert.deepEqual(layerCenter({ x: 0, y: 780, width: 20, height: 20 }, 1000, 800), [-490, 10]);
});

test("names lose the extension and Photoshop's export numbering", () => {
  assert.equal(layerName('arm_l.png'), 'arm_l');
  assert.equal(layerName('_0003_Upper Arm L.png'), 'Upper Arm L');
  assert.equal(layerName('_0000s_0002_Hand.png'), 'Hand');
  assert.equal(layerName('0012_head.png'), 'head');
  assert.equal(layerName('07_pelvis.png'), 'pelvis');
  assert.equal(layerName('12 - Hand L.png'), 'Hand L');
  assert.equal(layerName('2024.png'), '2024');
  assert.equal(layerName('_0001_.png'), '_0001_');
});

test('Photoshop exports are numbered from the top layer, so they are drawn in reverse', () => {
  assert.deepEqual(backToFront(['_0000_head.png', '_0001_torso.png', '_0002_legs.png']), [2, 1, 0]);
  // Picked out of order: still sorted by the numbering, top layer last.
  assert.deepEqual(backToFront(['_0001_torso.png', '_0002_legs.png', '_0000_head.png']), [1, 0, 2]);
  // Other names keep the order they were picked in.
  assert.deepEqual(backToFront(['legs.png', 'torso.png', 'head.png']), [0, 1, 2]);
});
