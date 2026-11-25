// SPDX-License-Identifier: MIT OR Apache-2.0
// A small Aseprite (.aseprite) writer, from the format spec, for test files; and `blink`, a
// blinking character used by the importer and MCP tests.

import { deflateSync } from 'node:zlib';

import { DIRECTION } from '../../src/editor/aseprite.js';

const u16 = (v) => [v & 255, (v >> 8) & 255];
const s16 = (v) => u16(v & 0xffff);
const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const str = (s) => {
  const b = [...new TextEncoder().encode(s)];
  return [...u16(b.length), ...b];
};
const chunk = (type, body) => [...u32(body.length + 6), ...u16(type), ...body];

/** A layer chunk: type 0 image, 1 group. */
export const layer = (name, { type = 0, level = 0, visible = true, opacity = 255, blend = 0 } = {}) =>
  chunk(0x2004, [...u16(visible ? 1 : 0), ...u16(type), ...u16(level), ...u16(0), ...u16(0), ...u16(blend), opacity, 0, 0, 0, ...str(name)]);

/** A cel: raw (pixels given), compressed (zlib) or linked (`link` = source frame). */
export const cel = (layerIndex, x, y, { w, h, pixels, compressed = false, link, opacity = 255 }) => {
  const head = [...u16(layerIndex), ...s16(x), ...s16(y), opacity];
  if (link !== undefined) return chunk(0x2005, [...head, ...u16(1), ...s16(0), 0, 0, 0, 0, 0, ...u16(link)]);
  const data = compressed ? [...deflateSync(Buffer.from(pixels))] : pixels;
  return chunk(0x2005, [...head, ...u16(compressed ? 2 : 0), ...s16(0), 0, 0, 0, 0, 0, ...u16(w), ...u16(h), ...data]);
};

export const tags = (list) =>
  chunk(0x2018, [
    ...u16(list.length),
    0, 0, 0, 0, 0, 0, 0, 0,
    ...list.flatMap((t) => [...u16(t.from), ...u16(t.to), t.direction ?? 0, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...str(t.name)]),
  ]);

export const palette = (colors) =>
  chunk(0x2019, [...u32(colors.length), ...u32(0), ...u32(colors.length - 1), 0, 0, 0, 0, 0, 0, 0, 0, ...colors.flatMap((c) => [...u16(0), ...c])]);

export function file({ width, height, depth = 32, frames, transparent = 0 }) {
  const body = frames.flatMap(({ duration = 100, chunks }) => {
    const data = chunks.flat();
    return [...u32(16 + data.length), ...u16(0xf1fa), ...u16(chunks.length), ...u16(duration), 0, 0, ...u32(chunks.length), ...data];
  });
  const header = [...u32(128 + body.length), ...u16(0xa5e0), ...u16(frames.length), ...u16(width), ...u16(height), ...u16(depth), ...u32(1), ...u16(100), ...u32(0), ...u32(0), transparent, 0, 0, 0, ...u16(0), 1, 1];
  while (header.length < 128) header.push(0);
  return new Uint8Array([...header, ...body]);
}

/** w×h RGBA pixels of one colour. */
export const solid = (w, h, rgba) => Array.from({ length: w * h }, () => rgba).flat();

// A blinking character: body (static), eyes (open on frames 1 and 3, closed on 2), a hidden group.
export const blink = () =>
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
