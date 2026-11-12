// SPDX-License-Identifier: MIT OR Apache-2.0
// PNG layer sets (pngset.js): same-size PNGs exported from a layered drawing are recognised, cropped
// to their visible pixels, placed where they were drawn, named and ordered like PSD layers.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alphaBounds, backToFront, fileName, isLayerSet, layerCenter, layerName, pixelArtScale } from '../src/editor/pngset.js';

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

test('desktop paths: names and Photoshop order come from the file name, not the folder', () => {
  const paths = ['F:\\Application\\Rigby2D_0.5.1_x64_portable\\_0000_Head.png', 'F:\\Application\\Rigby2D_0.5.1_x64_portable\\_0001_Body.png', '/home/me/art/_0002_Legs.png'];
  const names = paths.map(fileName);
  assert.deepEqual(names, ['_0000_Head.png', '_0001_Body.png', '_0002_Legs.png']);
  assert.deepEqual(names.map(layerName), ['Head', 'Body', 'Legs']);
  // Photoshop numbers from the top layer: back to front is legs, body, head.
  assert.deepEqual(backToFront(names), [2, 1, 0]);
});

/** An RGBA image from a function of the pixel: [r, g, b, a]. */
function rgba(width, height, px, x = 0, y = 0) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data.set(px(i, j), (j * width + i) * 4);
  return { width, height, data, x, y };
}
const PALETTE = [[20, 30, 90, 255], [230, 220, 240, 255], [240, 150, 170, 255], [0, 0, 0, 0]];
/** Pixel art: a few palette colors in irregular shapes, drawn at `k` screen pixels per art pixel. */
const sprite = (k, w = 40, h = 48) => (i, j) => PALETTE[(Math.floor(i / k) * 7 + Math.floor(j / k) * 3 + ((Math.floor(i / k) * Math.floor(j / k)) % 5)) % 4];

test('pixel art is detected, with the scale it was exported at', () => {
  assert.equal(pixelArtScale([rgba(40, 48, sprite(1))]), 1);
  assert.equal(pixelArtScale([rgba(80, 96, sprite(2))]), 2);
  assert.equal(pixelArtScale([rgba(120, 144, sprite(3))]), 3);
  // Layers of a 2x drawing cropped at odd offsets still line up on the canvas grid.
  const canvas = sprite(2);
  assert.equal(pixelArtScale([rgba(30, 30, (i, j) => canvas(i + 13, j + 7), 13, 7), rgba(20, 20, (i, j) => canvas(i + 4, j + 21), 4, 21)]), 2);
});

test('a few small details keep a flat 2x drawing at 2x, not 4x', () => {
  // Flat blocks on a 4-pixel grid, with 2x2 details off that grid.
  const art = rgba(64, 64, (i, j) => (i >= 20 && i < 44 && j >= 4 && j < 60 ? ((i === 22 || i === 23) && (j === 6 || j === 7) ? [17, 17, 17, 255] : [48, 64, 160, 255]) : [0, 0, 0, 0]));
  assert.equal(pixelArtScale([art]), 2);
});

test('painted art is not pixel art', () => {
  // Soft, anti-aliased edges.
  const disc = rgba(64, 64, (i, j) => [200, 100, 50, Math.max(0, Math.min(255, Math.round((28 - Math.hypot(i - 32, j - 32)) * 128)))]);
  assert.equal(pixelArtScale([disc]), 0);
  // Hard edges but a smooth gradient: far more colors than a palette.
  const gradient = rgba(64, 64, (i, j) => [i * 4, j * 4, (i * j) % 256, 255]);
  assert.equal(pixelArtScale([gradient]), 0);
  assert.equal(pixelArtScale([rgba(4, 4, () => [0, 0, 0, 0])]), 0);
});
