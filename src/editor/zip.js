// SPDX-License-Identifier: MIT OR Apache-2.0
// Minimal ZIP writer (stored, no compression), used to download projects in the browser build.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Builds a ZIP archive from `files` ([{ path, bytes }], '/'-separated paths). Returns a Uint8Array. */
export function zip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.bytes);
    const size = f.bytes.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, f.bytes);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + size;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

/**
 * Reads a ZIP archive: stored and deflated entries (those made by `zip`, GitHub's "Download ZIP",
 * and most zip tools). Returns a Map of path -> bytes. Throws on other compression methods or a
 * damaged archive.
 */
export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a ZIP archive');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const packed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0 && method !== 8) throw new Error(`compressed entry '${name}' is not supported`);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    const data = method === 8 ? inflateRaw(bytes.subarray(start, start + packed), size) : bytes.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error(`entry '${name}' is damaged`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---- inflate (RFC 1951), for deflated ZIP entries ----------------------------------------------

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman decoding table from code lengths: { counts, symbols }. */
function huffman(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offsets[lengths[s]]++] = s;
  return { counts, symbols };
}

let fixedTables = null;
function fixed() {
  if (!fixedTables) {
    const lit = new Uint8Array(288);
    lit.fill(8, 0, 144);
    lit.fill(9, 144, 256);
    lit.fill(7, 256, 280);
    lit.fill(8, 280, 288);
    fixedTables = [huffman(lit), huffman(new Uint8Array(30).fill(5))];
  }
  return fixedTables;
}

/** Inflates raw DEFLATE data into `size` bytes. */
export function inflateRaw(input, size) {
  const out = new Uint8Array(size);
  let o = 0;
  let pos = 0;
  let bit = 0;
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (pos >= input.length) throw new Error('damaged deflate data');
      v |= ((input[pos] >> bit) & 1) << i;
      if (++bit === 8) {
        bit = 0;
        pos++;
      }
    }
    return v;
  };
  const decode = ({ counts, symbols }) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = counts[len];
      if (code - first < count) return symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('damaged deflate data');
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      if (bit) {
        bit = 0;
        pos++;
      }
      const len = input[pos] | (input[pos + 1] << 8);
      pos += 4;
      if (o + len > size || pos + len > input.length) throw new Error('damaged deflate data');
      out.set(input.subarray(pos, pos + len), o);
      o += len;
      pos += len;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) [lit, dist] = fixed();
    else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) codeLengths[CODE_ORDER[i]] = bits(3);
      const codes = huffman(codeLengths);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(codes);
        if (sym < 16) lengths[i++] = sym;
        else {
          const [repeat, value] = sym === 16 ? [3 + bits(2), lengths[i - 1]] : sym === 17 ? [3 + bits(3), 0] : [11 + bits(7), 0];
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      lit = huffman(lengths.subarray(0, nlen));
      dist = huffman(lengths.subarray(nlen));
    } else throw new Error('damaged deflate data');
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        if (o >= size) throw new Error('damaged deflate data');
        out[o++] = sym;
      } else if (sym === 256) break;
      else {
        const l = LENGTH_BASE[sym - 257] + bits(LENGTH_EXTRA[sym - 257]);
        const ds = decode(dist);
        const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
        if (d > o || o + l > size) throw new Error('damaged deflate data');
        for (let i = 0; i < l; i++, o++) out[o] = out[o - d];
      }
    }
  }
  if (o !== size) throw new Error('damaged deflate data');
  return out;
}
