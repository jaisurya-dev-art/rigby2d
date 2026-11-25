import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIRECTION, asepriteParts, readAseprite, tagFrames } from '../src/editor/aseprite.js';
import { blink, cel, file, layer, palette, solid, tags } from './fixtures/aseprite-writer.js';

test('reads layers, frames, linked and compressed cels, tags and hidden groups', () => {
  const ase = readAseprite(blink());
  assert.equal(ase.width, 32);
  assert.deepEqual(ase.layers.map((l) => l.name), ['body', 'eyes', 'ghosts', 'ghost', 'shade']);
  assert.deepEqual(ase.layers.map((l) => l.hidden), [false, false, true, true, false], 'a hidden group hides its layers');
  assert.deepEqual(ase.frames.map((f) => f.duration), [0.2, 0.05, 0.2]);
  const body0 = ase.frames[0].cels.find((c) => c.layer === 0);
  assert.equal(ase.frames[1].cels.find((c) => c.layer === 0), body0, 'a linked cel is its source');
  assert.deepEqual([...body0.pixels.subarray(0, 4)], [200, 120, 80, 255], 'compressed pixels');
  assert.deepEqual(ase.tags.map((t) => t.name), ['blink', 'bounce']);
});

test('the import plan: one image per different picture, animations from tags', () => {
  const parts = asepriteParts(readAseprite(blink()), 'hero');
  assert.deepEqual(parts.slots.map((s) => s.name), ['body', 'eyes', 'ghost', 'shade']);
  const [body, eyes, ghost, shade] = parts.slots;
  assert.equal(body.pictures.length, 1, 'linked frames share one image');
  assert.deepEqual(body.shown, [0, 0, 0]);
  assert.equal(eyes.pictures.length, 2, 'open and closed eyes; the reopened eyes are the same picture');
  assert.deepEqual(eyes.shown, [0, 1, 0]);
  assert.equal(ghost.hidden, true);
  assert.equal(shade.pictures[0].data[3], 128, 'layer opacity is baked in');
  assert.deepEqual({ x: eyes.pictures[0].x, y: eyes.pictures[0].y, w: eyes.pictures[0].width }, { x: 12, y: 12, w: 8 });
  const [blinkAnim, bounce] = parts.animations;
  assert.equal(blinkAnim.name, 'blink');
  assert.ok(Math.abs(blinkAnim.duration - 0.45) < 1e-9);
  assert.deepEqual(blinkAnim.steps.map((s) => s.frame), [0, 1, 2]);
  assert.deepEqual(bounce.steps.map((s) => s.frame), [1, 2], 'ping-pong over two frames');
  // The hidden layer is a variant: one more animation per tag, with it shown.
  assert.deepEqual(parts.animations.map((a) => `${a.name}:${a.variant}`), ['blink:null', 'bounce:null', 'blink · ghost:2', 'bounce · ghost:2']);
  assert.deepEqual(parts.animations[2].steps, blinkAnim.steps);
});

test('tag directions and a file without tags', () => {
  assert.deepEqual(tagFrames({ from: 1, to: 4, direction: DIRECTION.forward }), [1, 2, 3, 4]);
  assert.deepEqual(tagFrames({ from: 1, to: 4, direction: DIRECTION.reverse }), [4, 3, 2, 1]);
  assert.deepEqual(tagFrames({ from: 1, to: 4, direction: DIRECTION.pingpong }), [1, 2, 3, 4, 3, 2]);
  assert.deepEqual(tagFrames({ from: 1, to: 4, direction: DIRECTION.pingpongReverse }), [4, 3, 2, 1, 2, 3]);
  const two = file({ width: 4, height: 4, frames: [{ chunks: [layer('a'), cel(0, 0, 0, { w: 1, h: 1, pixels: [9, 9, 9, 255] })] }, { chunks: [cel(0, 1, 1, { w: 1, h: 1, pixels: [9, 9, 9, 255] })] }] });
  const parts = asepriteParts(readAseprite(two), 'walk');
  assert.deepEqual(parts.animations.map((a) => a.name), ['walk'], 'the whole timeline, named after the file');
  assert.equal(parts.slots[0].pictures.length, 2, 'the same drawing moved is another picture');
});

test('indexed colour with a palette and a transparent index; damaged files are refused', () => {
  const indexed = file({
    width: 4,
    height: 4,
    depth: 8,
    transparent: 0,
    frames: [{ chunks: [palette([[0, 0, 0, 255], [255, 0, 0, 255]]), layer('dot'), cel(0, 1, 1, { w: 2, h: 1, pixels: [1, 0] })] }],
  });
  const parts = asepriteParts(readAseprite(indexed));
  const pic = parts.slots[0].pictures[0];
  assert.equal(pic.width, 1, 'the transparent index is cropped away');
  assert.deepEqual([...pic.data], [255, 0, 0, 255]);
  assert.throws(() => readAseprite(new Uint8Array(200)), /not an Aseprite file/);
  assert.throws(() => readAseprite(new Uint8Array(10)), /too short/);
});

test('layers are clipped to the canvas; blend layers are baked below, kept on the slot, or kept when hidden', async () => {
  const { blendInto } = await import('../src/editor/aseprite.js');
  const ase = file({
    width: 4,
    height: 4,
    frames: [
      {
        chunks: [
          layer('ground'),
          layer('shade', { blend: 1 }), // multiply: drawn by the slot
          layer('grade', { blend: 7 }), // colour burn: baked into "ground"
          layer('variant', { blend: 9, visible: false }), // soft light, hidden: kept as a part
          cel(0, -2, 0, { w: 4, h: 4, pixels: solid(4, 4, [200, 200, 200, 255]) }),
          cel(1, 0, 0, { w: 1, h: 1, pixels: [100, 100, 100, 255] }),
          cel(2, 0, 0, { w: 2, h: 4, pixels: solid(2, 4, [128, 128, 128, 255]) }),
          cel(3, 0, 0, { w: 1, h: 1, pixels: [9, 9, 9, 255] }),
        ],
      },
    ],
  });
  const parts = asepriteParts(readAseprite(ase));
  assert.deepEqual(parts.slots.map((s) => `${s.name}:${s.blend}${s.hidden ? ':hidden' : ''}`), ['ground:normal', 'shade:multiply', 'variant:normal:hidden']);
  assert.deepEqual(parts.baked, ['grade']);
  const ground = parts.slots[0].pictures[0];
  assert.deepEqual([ground.x, ground.width], [0, 2], 'the part left of the canvas is cut off');
  // Colour burn of 200 by 128: 1 - (1 - 200/255) / (128/255) = 0.569 → 145.
  assert.equal(ground.data[0], 145);
  // The blend functions on their own: multiply halves, normal leaves pixels alone.
  const under = { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array([200, 100, 50, 255]) };
  blendInto(under, { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array([128, 128, 128, 255]) }, 1);
  assert.deepEqual([...under.data], [100, 50, 25, 255]);
});
