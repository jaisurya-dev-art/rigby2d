import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { DIRECTION, asepriteParts, readAseprite, tagFrames } from '../src/editor/aseprite.js';

// ---- a small Aseprite writer, from the format spec, for test files ----------------------------

const u16 = (v) => [v & 255, (v >> 8) & 255];
const s16 = (v) => u16(v & 0xffff);
const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const str = (s) => {
  const b = [...new TextEncoder().encode(s)];
  return [...u16(b.length), ...b];
};
const chunk = (type, body) => [...u32(body.length + 6), ...u16(type), ...body];

/** A layer chunk: type 0 image, 1 group. */
const layer = (name, { type = 0, level = 0, visible = true, opacity = 255, blend = 0 } = {}) =>
  chunk(0x2004, [...u16(visible ? 1 : 0), ...u16(type), ...u16(level), ...u16(0), ...u16(0), ...u16(blend), opacity, 0, 0, 0, ...str(name)]);

/** A cel: raw (pixels given), compressed (zlib) or linked (`link` = source frame). */
const cel = (layerIndex, x, y, { w, h, pixels, compressed = false, link, opacity = 255 }) => {
  const head = [...u16(layerIndex), ...s16(x), ...s16(y), opacity];
  if (link !== undefined) return chunk(0x2005, [...head, ...u16(1), ...s16(0), 0, 0, 0, 0, 0, ...u16(link)]);
  const data = compressed ? [...deflateSync(Buffer.from(pixels))] : pixels;
  return chunk(0x2005, [...head, ...u16(compressed ? 2 : 0), ...s16(0), 0, 0, 0, 0, 0, ...u16(w), ...u16(h), ...data]);
};

const tags = (list) =>
  chunk(0x2018, [
    ...u16(list.length),
    0, 0, 0, 0, 0, 0, 0, 0,
    ...list.flatMap((t) => [...u16(t.from), ...u16(t.to), t.direction ?? 0, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...str(t.name)]),
  ]);

const palette = (colors) =>
  chunk(0x2019, [...u32(colors.length), ...u32(0), ...u32(colors.length - 1), 0, 0, 0, 0, 0, 0, 0, 0, ...colors.flatMap((c) => [...u16(0), ...c])]);

function file({ width, height, depth = 32, frames, transparent = 0 }) {
  const body = frames.flatMap(({ duration = 100, chunks }) => {
    const data = chunks.flat();
    return [...u32(16 + data.length), ...u16(0xf1fa), ...u16(chunks.length), ...u16(duration), 0, 0, ...u32(chunks.length), ...data];
  });
  const header = [...u32(128 + body.length), ...u16(0xa5e0), ...u16(frames.length), ...u16(width), ...u16(height), ...u16(depth), ...u32(1), ...u16(100), ...u32(0), ...u32(0), transparent, 0, 0, 0, ...u16(0), 1, 1];
  while (header.length < 128) header.push(0);
  return new Uint8Array([...header, ...body]);
}

/** w×h RGBA pixels of one colour. */
const solid = (w, h, rgba) => Array.from({ length: w * h }, () => rgba).flat();

// A blinking character: body (static), eyes (open on frames 1 and 3, closed on 2), a hidden group.
const blink = () =>
  file({
    width: 32,
    height: 32,
    frames: [
      {
        duration: 200,
        chunks: [
          layer('body'),
          layer('eyes'),
          layer('ghosts', { type: 1, visible: false }),
          layer('ghost', { level: 1 }),
          layer('shade', { opacity: 128 }),
          cel(0, 8, 10, { w: 16, h: 20, pixels: solid(16, 20, [200, 120, 80, 255]), compressed: true }),
          cel(1, 12, 12, { w: 8, h: 2, pixels: solid(8, 2, [0, 0, 0, 255]) }),
          cel(3, 0, 0, { w: 2, h: 2, pixels: solid(2, 2, [255, 255, 255, 255]) }),
          cel(4, 8, 28, { w: 16, h: 2, pixels: solid(16, 2, [0, 0, 0, 255]) }),
          tags([{ name: 'blink', from: 0, to: 2 }, { name: 'bounce', from: 1, to: 2, direction: DIRECTION.pingpong }]),
        ],
      },
      { duration: 50, chunks: [cel(0, 0, 0, { link: 0 }), cel(1, 12, 13, { w: 8, h: 1, pixels: solid(8, 1, [0, 0, 0, 255]) })] },
      { duration: 200, chunks: [cel(0, 0, 0, { link: 0 }), cel(1, 12, 12, { w: 8, h: 2, pixels: solid(8, 2, [0, 0, 0, 255]) })] },
    ],
  });

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
