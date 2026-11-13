// SPDX-License-Identifier: MIT OR Apache-2.0
// Aseprite files (.aseprite / .ase): a reader for the documented format
// (github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md) and the plan an import follows:
// every image layer becomes a slot, every different picture it shows becomes an image, and the
// frames (or each tag) become an animation that swaps them. No DOM: tested under Node; io.js turns
// the pixels into canvases.

import { inflateRaw } from './zip.js';
import { alphaBounds } from './pngset.js';
import { tn } from './i18n.js';

const HEADER_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const CHUNK = { oldPalette: 0x0004, layer: 0x2004, cel: 0x2005, tags: 0x2018, palette: 0x2019 };
const LAYER = { visible: 1, background: 8, reference: 64 };
const LAYER_TYPE = { image: 0, group: 1, tilemap: 2 };
const CEL_TYPE = { raw: 0, linked: 1, compressed: 2, tilemap: 3 };
/** Tag directions, as stored. */
export const DIRECTION = { forward: 0, reverse: 1, pingpong: 2, pingpongReverse: 3 };

/** Little-endian reader over a byte array. */
class Reader {
  constructor(bytes, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }
  byte() {
    return this.bytes[this.pos++];
  }
  word() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  short() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  dword() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n) {
    this.pos += n;
  }
  string() {
    const n = this.word();
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
}

/** zlib (2-byte header, DEFLATE, checksum) into `size` bytes. */
function inflateZlib(data, size) {
  return inflateRaw(data.subarray(2), size);
}

/** Pixels in the file's colour depth as RGBA. */
function toRgba(src, w, h, depth, palette, transparent, background) {
  const out = new Uint8Array(w * h * 4);
  const n = w * h;
  if (depth === 32) out.set(src.subarray(0, n * 4));
  else if (depth === 16) {
    for (let i = 0; i < n; i++) {
      const v = src[i * 2];
      out.set([v, v, v, src[i * 2 + 1]], i * 4);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const index = src[i];
      if (index === transparent && !background) continue;
      const c = palette[index] ?? [0, 0, 0, 255];
      out.set(c, i * 4);
    }
  }
  return out;
}

/**
 * Reads an Aseprite file. Returns { width, height, depth, layers: [{ name, type, level, visible,
 * hidden, background, reference, opacity, blend }], frames: [{ duration (s), cels: [{ layer, x, y,
 * opacity, z, width, height, pixels (RGBA) }] }], tags: [{ name, from, to, direction, repeat }] }.
 * Layers are bottom-most first; `hidden` also counts hidden groups above. Linked cels share their
 * source's object. Tilemap cels are left out.
 */
export function readAseprite(bytes) {
  if (bytes.length < 128) throw new Error('not an Aseprite file (too short)');
  const r = new Reader(bytes);
  r.dword(); // file size
  if (r.word() !== HEADER_MAGIC) throw new Error('not an Aseprite file');
  const frameCount = r.word();
  const width = r.word();
  const height = r.word();
  const depth = r.word();
  const flags = r.dword();
  r.skip(2 + 4 + 4); // speed, reserved
  const transparent = r.byte();
  r.skip(3);
  const colorCount = r.word();
  if (![8, 16, 32].includes(depth)) throw new Error(`unsupported colour depth ${depth}`);
  const opacityValid = (flags & 1) !== 0;
  const uuids = (flags & 4) !== 0;
  r.pos = 128;

  const layers = [];
  const frames = [];
  const tags = [];
  let palette = new Array(Math.max(256, colorCount)).fill(null);
  let newPalette = false;
  const pending = []; // cels decoded after every palette chunk is known

  for (let f = 0; f < frameCount; f++) {
    const start = r.pos;
    const size = r.dword();
    if (r.word() !== FRAME_MAGIC) throw new Error(`damaged frame ${f + 1}`);
    const oldCount = r.word();
    const duration = r.word() / 1000;
    r.skip(2);
    const newCount = r.dword();
    const chunks = newCount || oldCount;
    const frame = { duration: duration || 0.1, cels: [] };
    frames.push(frame);
    for (let c = 0; c < chunks; c++) {
      const at = r.pos;
      const chunkSize = r.dword();
      const type = r.word();
      if (type === CHUNK.layer) {
        const layerFlags = r.word();
        const layerType = r.word();
        const level = r.word();
        r.skip(4); // default size
        const blend = r.word();
        const opacity = r.byte();
        r.skip(3);
        const name = r.string();
        if (layerType === LAYER_TYPE.tilemap) r.skip(4);
        if (uuids) r.skip(16);
        layers.push({
          name,
          type: layerType,
          level,
          visible: (layerFlags & LAYER.visible) !== 0,
          background: (layerFlags & LAYER.background) !== 0,
          reference: (layerFlags & LAYER.reference) !== 0,
          opacity: opacityValid ? opacity / 255 : 1,
          blend,
        });
      } else if (type === CHUNK.cel) {
        const layer = r.word();
        const x = r.short();
        const y = r.short();
        const opacity = r.byte() / 255;
        const celType = r.word();
        const z = r.short();
        r.skip(5);
        if (celType === CEL_TYPE.linked) {
          pending.push({ frame, layer, link: r.word() });
        } else if (celType === CEL_TYPE.raw || celType === CEL_TYPE.compressed) {
          const w = r.word();
          const h = r.word();
          const data = bytes.subarray(r.pos, at + chunkSize);
          pending.push({ frame, cel: { layer, x, y, opacity, z, width: w, height: h }, data, compressed: celType === CEL_TYPE.compressed });
        }
      } else if (type === CHUNK.palette) {
        const total = r.dword();
        const first = r.dword();
        const last = r.dword();
        r.skip(8);
        if (palette.length < total) palette = palette.concat(new Array(total - palette.length).fill(null));
        for (let i = first; i <= last; i++) {
          const entryFlags = r.word();
          palette[i] = [r.byte(), r.byte(), r.byte(), r.byte()];
          if (entryFlags & 1) r.string();
        }
        newPalette = true;
      } else if (type === CHUNK.oldPalette && !newPalette) {
        const packets = r.word();
        let index = 0;
        for (let p = 0; p < packets; p++) {
          index += r.byte();
          const count = r.byte() || 256;
          for (let i = 0; i < count; i++) palette[index++] = [r.byte(), r.byte(), r.byte(), 255];
        }
      } else if (type === CHUNK.tags) {
        const count = r.word();
        r.skip(8);
        for (let i = 0; i < count; i++) {
          const from = r.word();
          const to = r.word();
          const direction = r.byte();
          const repeat = r.word();
          r.skip(6 + 3 + 1);
          tags.push({ name: r.string(), from, to, direction, repeat });
        }
      }
      r.pos = at + chunkSize;
    }
    r.pos = start + size;
  }

  // Cels: decoded now that the palette is known; linked cels point at their source frame's cel.
  for (const p of pending) {
    if (p.link !== undefined) continue;
    const { cel } = p;
    const n = cel.width * cel.height * (depth / 8);
    const raw = p.compressed ? inflateZlib(p.data, n) : p.data.subarray(0, n);
    cel.pixels = toRgba(raw, cel.width, cel.height, depth, palette, transparent, layers[cel.layer]?.background);
    p.frame.cels.push(cel);
  }
  for (const p of pending) {
    if (p.link === undefined) continue;
    const source = frames[p.link]?.cels.find((c) => c.layer === p.layer);
    if (source) p.frame.cels.push(source);
  }

  // A layer is hidden when it or any group above it is.
  const groups = [];
  for (const layer of layers) {
    groups.length = layer.level;
    layer.hidden = !layer.visible || groups.some((g) => g && !g.visible);
    if (layer.type === LAYER_TYPE.group) groups[layer.level] = { visible: !layer.hidden };
  }
  return { width, height, depth, layers, frames, tags };
}

/** The frame order a tag plays (Aseprite's forward, reverse and ping-pong directions). */
export function tagFrames(tag) {
  const forward = [];
  for (let f = tag.from; f <= tag.to; f++) forward.push(f);
  const back = forward.slice(1, -1).reverse();
  if (tag.direction === DIRECTION.reverse) return forward.reverse();
  if (tag.direction === DIRECTION.pingpong) return [...forward, ...back];
  if (tag.direction === DIRECTION.pingpongReverse) return [...forward.slice().reverse(), ...back.reverse()];
  return forward;
}

/** A cheap fingerprint of a picture, so the same drawing on several frames becomes one image. */
function fingerprint(x, y, w, h, data) {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 1) hash = Math.imul(hash ^ data[i], 16777619);
  return `${x},${y},${w},${h},${hash >>> 0}`;
}

/**
 * What an import makes from a read file: { width, height, slots: [{ name, hidden, pictures: [{
 * width, height, x, y (top-left in the canvas), data (RGBA) }], shown: picture index per frame (-1 =
 * none) }], animations: [{ name, steps: [{ frame, time }], duration }], skipped: [what was left out] }.
 * Slots are bottom-most first, one per image layer that shows anything; `stem` names the animation
 * of a file without tags.
 */
export function asepriteParts(ase, stem = 'animation') {
  const skipped = new Set();
  const slots = [];
  ase.layers.forEach((layer, index) => {
    if (layer.type === LAYER_TYPE.tilemap) return skipped.add(tn('tilemap layers'));
    if (layer.type !== LAYER_TYPE.image) return;
    if (layer.reference) return skipped.add(tn('reference layers'));
    if (layer.blend !== 0) skipped.add(tn('layer blend modes (imported as normal)'));
    const pictures = [];
    const byKey = new Map();
    const byCel = new Map();
    const shown = ase.frames.map((frame) => {
      const cel = frame.cels.find((c) => c.layer === index);
      if (!cel) return -1;
      if (cel.z) skipped.add(tn('per-cel z-order (layer order is kept)'));
      if (byCel.has(cel)) return byCel.get(cel);
      // Layer and cel opacity are baked into the picture; then it is cropped to what it shows.
      const alpha = layer.opacity * cel.opacity;
      const data = new Uint8Array(cel.pixels);
      if (alpha < 1) for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * alpha);
      const bounds = alphaBounds(data, cel.width, cel.height);
      let found = -1;
      if (bounds) {
        const crop = new Uint8Array(bounds.width * bounds.height * 4);
        for (let row = 0; row < bounds.height; row++) {
          const from = ((bounds.y + row) * cel.width + bounds.x) * 4;
          crop.set(data.subarray(from, from + bounds.width * 4), row * bounds.width * 4);
        }
        const x = cel.x + bounds.x;
        const y = cel.y + bounds.y;
        const key = fingerprint(x, y, bounds.width, bounds.height, crop);
        if (!byKey.has(key)) {
          byKey.set(key, pictures.length);
          pictures.push({ width: bounds.width, height: bounds.height, x, y, data: crop });
        }
        found = byKey.get(key);
      }
      byCel.set(cel, found);
      return found;
    });
    if (pictures.length) slots.push({ name: layer.name || `layer ${index + 1}`, hidden: layer.hidden, pictures, shown });
  });

  // Animations: one per tag, or one for the whole file when it has frames but no tags.
  const tags = ase.tags.length ? ase.tags : ase.frames.length > 1 ? [{ name: stem, from: 0, to: ase.frames.length - 1, direction: DIRECTION.forward }] : [];
  const animations = tags.map((tag) => {
    let time = 0;
    const steps = tagFrames(tag)
      .filter((f) => f < ase.frames.length)
      .map((frame) => {
        const step = { frame, time };
        time = Math.round((time + ase.frames[frame].duration) * 1e6) / 1e6;
        return step;
      });
    return { name: tag.name || stem, steps, duration: time };
  });
  return { width: ase.width, height: ase.height, slots, animations, skipped: [...skipped] };
}
