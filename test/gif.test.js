// SPDX-License-Identifier: MIT OR Apache-2.0
// GIF encoding (gif.js), checked by decoding the result with a small reference decoder.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPalette, encodeGif, frameDelays } from '../src/editor/gif.js';

/** Decodes a GIF into full RGBA frames (enough of the format to check the encoder). */
function decodeGif(bytes) {
  let p = 6;
  const u16 = () => bytes[p++] | (bytes[p++] << 8);
  const width = u16();
  const height = u16();
  const flags = bytes[p];
  p += 3;
  const palette = [];
  for (let i = 0; i < 2 << (flags & 7); i++, p += 3) palette.push([bytes[p], bytes[p + 1], bytes[p + 2]]);
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let gce = { disposal: 0, transparent: -1, delay: 0 };
  let loops = false;
  for (;;) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        const packed = bytes[p + 1];
        gce = { disposal: (packed >> 2) & 7, transparent: packed & 1 ? bytes[p + 4] : -1, delay: bytes[p + 2] | (bytes[p + 3] << 8) };
      }
      if (label === 0xff) loops = true;
      while (bytes[p]) p += bytes[p] + 1;
      p++;
      continue;
    }
    assert.equal(b, 0x2c, 'image descriptor');
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    p++;
    const min = bytes[p++];
    const data = [];
    while (bytes[p]) {
      data.push(...bytes.subarray(p + 1, p + 1 + bytes[p]));
      p += bytes[p] + 1;
    }
    p++;
    const indices = lzwDecode(data, min, w * h);
    for (let i = 0; i < w * h; i++) {
      const k = indices[i];
      if (k === gce.transparent) continue;
      const o = ((y + Math.floor(i / w)) * width + x + (i % w)) * 4;
      canvas.set([...palette[k], 255], o);
    }
    frames.push({ rgba: canvas.slice(), delay: gce.delay, rect: [x, y, w, h] });
    if (gce.disposal === 2) canvas.fill(0);
  }
  return { width, height, frames, loops };
}

function lzwDecode(data, min, count) {
  const clear = 1 << min;
  const end = clear + 1;
  let size = min + 1;
  let dict = [];
  const reset = () => {
    dict = Array.from({ length: clear }, (_, i) => [i]);
    dict.push(null, null);
    size = min + 1;
  };
  reset();
  const out = [];
  let prev = null;
  let bit = 0;
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else entry = [...prev, prev[0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  assert.equal(out.length, count, 'pixel count');
  return out;
}

const solid = (w, h, f) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([...f(i % w, Math.floor(i / w)), 255], i * 4);
  return a;
};

test('frame delays add up to the real duration', () => {
  assert.deepEqual(frameDelays(4, 25), [4, 4, 4, 4]);
  assert.equal(frameDelays(24, 24).reduce((a, b) => a + b), 100);
  assert.ok(frameDelays(10, 100).every((d) => d >= 2));
});

test('a palette keeps every colour when there are few', () => {
  const f = solid(4, 1, (x) => [x * 60, 0, 0]);
  assert.equal(buildPalette([f], 255).length, 4);
  const many = solid(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]);
  assert.equal(buildPalette([many], 255).length, 255);
});

test('opaque frames round-trip, storing only what changed', () => {
  const w = 40;
  const h = 30;
  const colors = [
    [20, 22, 28],
    [94, 162, 255],
    [255, 122, 184],
  ];
  // A square moving over a flat background.
  const frames = [0, 6, 12].map((dx) => solid(w, h, (x, y) => (x >= 5 + dx && x < 15 + dx && y >= 8 && y < 18 ? colors[1] : y > 25 ? colors[2] : colors[0])));
  const gif = encodeGif({ width: w, height: h, frames, fps: 25 });
  const d = decodeGif(gif);
  assert.equal(d.width, w);
  assert.equal(d.frames.length, 3);
  assert.ok(d.loops);
  for (let f = 0; f < 3; f++) assert.deepEqual([...d.frames[f].rgba], [...frames[f]], `frame ${f}`);
  assert.deepEqual(d.frames[1].rect, [5, 8, 16, 10], 'only the moved square is stored');
  assert.equal(d.frames[0].delay, 4);
});

test('transparent frames keep their see-through pixels', () => {
  const w = 8;
  const h = 8;
  const frame = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < 16; i++) frame.set([255, 0, 0, 255], i * 4);
  const d = decodeGif(encodeGif({ width: w, height: h, frames: [frame, frame], transparent: true }));
  assert.deepEqual([...d.frames[1].rgba.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...d.frames[1].rgba.subarray(64, 68)], [0, 0, 0, 0]);
});

test('large noisy frames survive the dictionary resets', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255;
  // 64 colours, so the palette is exact; noise fills the 4096-code dictionary many times over.
  const frame = solid(120, 90, () => [rand() & 0xc0, rand() & 0xc0, rand() & 0xc0]);
  const d = decodeGif(encodeGif({ width: 120, height: 90, frames: [frame] }));
  let wrong = 0;
  for (let i = 0; i < frame.length; i++) wrong += d.frames[0].rgba[i] !== frame[i];
  assert.equal(wrong, 0);
});
