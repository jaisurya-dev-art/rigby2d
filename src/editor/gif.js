// SPDX-License-Identifier: MIT OR Apache-2.0
// Animated GIF encoding, without the DOM (tests run it under Node): one palette for the whole
// animation (median cut over all frames), and on an opaque background each frame stores only the
// rectangle that changed, with unchanged pixels transparent, so loops stay small enough to post.

const TRANSPARENT = 255;

/**
 * Encodes frames into an animated GIF. `frames` are straight-alpha RGBA arrays (width * height * 4,
 * top row first); `fps` sets the frame delay (GIF counts hundredths of a second). With
 * `transparent`, pixels under half alpha are see-through; otherwise frames must be opaque.
 */
export function encodeGif({ width, height, frames, fps = 25, transparent = false, loop = true }) {
  if (!frames.length) throw new Error('no frames to encode');
  const palette = buildPalette(frames, 255);
  const out = new Bytes();
  out.str('GIF89a');
  out.u16(width);
  out.u16(height);
  out.u8(0xf7); // global palette of 256 colours
  out.u8(0);
  out.u8(0);
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? 0;
    out.u8((c >> 16) & 255);
    out.u8((c >> 8) & 255);
    out.u8(c & 255);
  }
  if (loop) {
    out.u8(0x21);
    out.u8(0xff);
    out.u8(11);
    out.str('NETSCAPE2.0');
    out.u8(3);
    out.u8(1);
    out.u16(0);
    out.u8(0);
  }
  const lookup = nearest(palette);
  const delays = frameDelays(frames.length, fps);
  let previous = null;
  for (let f = 0; f < frames.length; f++) {
    const indices = indexFrame(frames[f], lookup, transparent);
    // Opaque: only the changed rectangle, unchanged pixels transparent (drawn over the last frame).
    let rect = { x: 0, y: 0, w: width, h: height };
    let data = indices;
    if (!transparent && previous) {
      rect = changedRect(indices, previous, width, height) ?? { x: 0, y: 0, w: 1, h: 1 };
      data = new Uint8Array(rect.w * rect.h);
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const i = (rect.y + y) * width + rect.x + x;
          data[y * rect.w + x] = indices[i] === previous[i] ? TRANSPARENT : indices[i];
        }
      }
    }
    previous = indices;
    // Graphic control: delay, disposal (2 = clear, for transparent frames; 1 = keep), transparency.
    out.u8(0x21);
    out.u8(0xf9);
    out.u8(4);
    out.u8(((transparent ? 2 : 1) << 2) | 1);
    out.u16(delays[f]);
    out.u8(TRANSPARENT);
    out.u8(0);
    // Image descriptor and data.
    out.u8(0x2c);
    out.u16(rect.x);
    out.u16(rect.y);
    out.u16(rect.w);
    out.u16(rect.h);
    out.u8(0);
    lzw(data, 8, out);
  }
  out.u8(0x3b);
  return out.bytes();
}

/**
 * Delays in hundredths of a second that add up to the real duration (25 fps alternates 4 cs; 24 fps
 * mixes 4 and 5). Browsers treat delays under 2 cs as slow, so 2 is the shortest.
 */
export function frameDelays(count, fps) {
  const delays = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const next = Math.round(((i + 1) * 100) / fps);
    delays.push(Math.max(2, next - t));
    t = next;
  }
  return delays;
}

/** Up to `size` colours (as 0xRRGGBB) for the opaque pixels of every frame, by median cut. */
export function buildPalette(frames, size) {
  // A sample of the pixels: every frame, evenly, up to about 250 000 in all.
  const total = frames.reduce((n, f) => n + f.length / 4, 0);
  const step = Math.max(1, Math.floor(total / 250000));
  const samples = [];
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4 * step) if (f[i + 3] >= 128) samples.push((f[i] << 16) | (f[i + 1] << 8) | f[i + 2]);
  }
  if (!samples.length) return [0];
  const unique = [...new Set(samples)];
  if (unique.length <= size) return unique;
  let boxes = [Uint32Array.from(samples)];
  while (boxes.length < size) {
    // Split the box with the widest channel range (weighted by its pixel count).
    let best = -1;
    let bestScore = 0;
    let bestChannel = 0;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      if (box.length < 2) continue;
      const [range, channel] = widest(box);
      const score = range * Math.sqrt(box.length);
      if (score > bestScore) [best, bestScore, bestChannel] = [b, score, channel];
    }
    if (best < 0) break;
    const shift = 16 - 8 * bestChannel;
    const box = boxes[best].sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.subarray(0, mid), box.subarray(mid));
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const c of box) {
      r += (c >> 16) & 255;
      g += (c >> 8) & 255;
      b += c & 255;
    }
    const n = box.length;
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  });
}

function widest(box) {
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (const c of box) {
    for (let k = 0; k < 3; k++) {
      const v = (c >> (16 - 8 * k)) & 255;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  // Green matters most to the eye, red next.
  const ranges = [(hi[0] - lo[0]) * 1.0, (hi[1] - lo[1]) * 1.2, (hi[2] - lo[2]) * 0.8];
  const channel = ranges.indexOf(Math.max(...ranges));
  return [ranges[channel], channel];
}

/** The nearest palette index for a colour, cached. */
function nearest(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let index = cache.get(key);
    if (index !== undefined) return index;
    let best = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const dr = ((c >> 16) & 255) - r;
      const dg = ((c >> 8) & 255) - g;
      const db = (c & 255) - b;
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (d < best) [best, index] = [d, i];
    }
    cache.set(key, index);
    return index;
  };
}

function indexFrame(rgba, lookup, transparent) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = transparent && rgba[i + 3] < 128 ? TRANSPARENT : lookup(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  return out;
}

function changedRect(a, b, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (a[i] === b[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** GIF's LZW: variable-width codes, packed little-endian into sub-blocks of up to 255 bytes. */
function lzw(indices, minCodeSize, out) {
  out.u8(minCodeSize);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let size = minCodeSize + 1;
  let next = end + 1;
  let dict = new Map();
  let block = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) {
        out.u8(255);
        out.raw(block);
        block = [];
      }
    }
  };
  emit(clear);
  let prefix = indices.length ? indices[0] : 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const code = dict.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      size = minCodeSize + 1;
      next = end + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) block.push(acc & 255);
  if (block.length) {
    out.u8(block.length);
    out.raw(block);
  }
  out.u8(0);
}

class Bytes {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.length = 0;
  }
  grow(n) {
    if (this.length + n <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    b.set(this.buf.subarray(0, this.length));
    this.buf = b;
  }
  u8(v) {
    this.grow(1);
    this.buf[this.length++] = v;
  }
  u16(v) {
    this.u8(v & 255);
    this.u8((v >> 8) & 255);
  }
  str(s) {
    for (const c of s) this.u8(c.charCodeAt(0));
  }
  raw(list) {
    this.grow(list.length);
    this.buf.set(list, this.length);
    this.length += list.length;
  }
  bytes() {
    return this.buf.slice(0, this.length);
  }
}
