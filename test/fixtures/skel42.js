// SPDX-License-Identifier: MIT OR Apache-2.0
// A small format 4.2 binary skeleton, encoded byte by byte from the layout documented in
// src/core/binary.js (clean-room: our own data, no third-party files). Used by test/binary42.test.js,
// and written to test/fixtures/sample-4.2.skel by make-skel42.mjs for the runtimes' golden tests.

/** The binary primitives: big-endian floats, varints, length+1 strings, string-table refs. */
export class Encoder {
  constructor() {
    this.out = [];
  }
  byte(b) {
    this.out.push(b & 0xff);
    return this;
  }
  bool(v) {
    return this.byte(v ? 1 : 0);
  }
  varint(n) {
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      this.byte(b);
    } while (n);
    return this;
  }
  float(...vs) {
    for (const v of vs) {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setFloat32(0, v);
      for (let i = 0; i < 4; i++) this.byte(dv.getUint8(i));
    }
    return this;
  }
  string(s) {
    if (s === null) return this.varint(0);
    const b = new TextEncoder().encode(s);
    this.varint(b.length + 1);
    for (const x of b) this.byte(x);
    return this;
  }
  color(hex) {
    const v = parseInt(hex, 16);
    return this.byte(v >>> 24).byte(v >>> 16).byte(v >>> 8).byte(v);
  }
  bytes() {
    return new Uint8Array(this.out);
  }
}

const STRINGS = ['body', 'leg', 'spine'];
const ref = (name) => STRINGS.indexOf(name) + 1;

/** A 4.2 skeleton: four bones, three slots, an IK, a transform and a path constraint, a region, a
 *  weighted mesh, a weighted path, and an animation with rotate, IK mix and deform keys. */
export function encode42({ slotColor = 'ffffffff' } = {}) {
  const e = new Encoder();
  for (let i = 0; i < 8; i++) e.byte(i);
  e.string('4.2.43').float(-50, 0, 100, 200, 100).bool(true).float(30).string('./images/').string(null);
  e.varint(STRINGS.length);
  for (const s of STRINGS) e.string(s);

  // Bones: name, parent, rotation x y scaleX scaleY shearX shearY, length, inherit, skin-only, and the
  // nonessential colour, icon and one more byte.
  const bone = (name, parent, t, length, inherit, color, icon, extra) => {
    e.string(name);
    if (parent !== null) e.varint(parent);
    e.float(...t, length).byte(inherit).bool(false).color(color).string(icon).byte(extra);
  };
  e.varint(4);
  bone('root', null, [0, 0, 0, 1, 1, 0, 0], 0, 0, '9b9b9bff', null, 1);
  bone('hip', 0, [0, 0, 100, 1, 1, 0, 0], 30, 0, 'ff0000ff', 'ik', 0);
  bone('upper', 1, [-90, 0, 0, 1, 1, 0, 0], 50, 3, '9b9b9bff', null, 1);
  bone('target', 0, [0, 30, 20, 1, 1, 0, 0], 0, 0, '9b9b9bff', null, 1);

  // Slots: name, bone, colour, dark colour, attachment, blend, nonessential visibility.
  e.varint(3);
  for (const [name, b, att] of [['body', 1, 'body'], ['leg', 2, 'leg'], ['path', 0, 'spine']]) {
    e.string(name).varint(b).color(name === 'body' ? slotColor : 'ffffffff').color('ffffffff').varint(ref(att)).byte(0).bool(true);
  }

  // IK: name, order, bones, target, flags (0x20 mix 1, 0x02 bend positive: off here).
  e.varint(1).string('leg-ik').varint(0).varint(1).varint(2).varint(3).byte(0x20);
  // Transform: name, order, bones, target, offsets present (rotation, x), then shearY and mixes.
  e.varint(1).string('hip-follow').varint(1).varint(1).varint(2).varint(1).byte(0x18).float(15, 5).byte(0x02).float(0.5);
  // Path: name, order, skin-only, bones, target slot, modes (percent position, chain rotate), then
  // position, spacing and the three mixes.
  e.varint(1).string('spine-follow').varint(2).bool(false).varint(1).varint(1).varint(2).byte(0x09).float(0, 0, 1, 1, 1);
  e.varint(0); // physics

  // The default skin: slots, then per slot its attachments (name ref, flags, data).
  e.varint(3);
  e.varint(0).varint(1).varint(ref('body')).byte(0x80).float(5, 1, 2, 1, 1, 40, 60);
  e.varint(1).varint(1).varint(ref('leg')).byte(0x82).varint(3).varint(3);
  e.varint(1).varint(2).float(0, 0, 1);
  e.varint(2).varint(2).float(50, 0, 0.5).varint(1).float(50, -30, 0.5);
  e.varint(1).varint(2).float(0, 10, 1);
  e.float(0, 0, 1, 0, 0, 1).varint(0).varint(1).varint(2);
  e.varint(6).varint(0).varint(2).varint(2).varint(4).varint(4).varint(0).float(50, 10);
  e.varint(2).varint(1).varint(ref('spine')).byte(0x64).varint(3);
  for (const [x, y] of [[0, 0], [10, 50], [0, 100]]) e.varint(1).varint(0).float(x, y, 1);
  e.float(100).color('ff8800ff');
  e.varint(0).varint(0); // named skins, events

  // One animation: rotate keys on 'upper' (bezier between them), an IK mix key, a deform key.
  e.varint(1).string('walk').varint(3).varint(0);
  e.varint(1).varint(2).varint(1).byte(0).varint(2).varint(1);
  e.float(0, 10).float(0.5, -20).byte(2).float(0.1, 10, 0.4, -20);
  e.varint(1).varint(0).varint(1).varint(0).byte(0x0a).float(0.25);
  e.varint(0).varint(0).varint(0);
  e.varint(1).varint(0).varint(1).varint(1).varint(1).varint(ref('leg')).byte(0).varint(1).varint(0);
  e.float(0).varint(2).varint(2).float(3, -3);
  e.varint(0).varint(0); // draw order, events
  return e.bytes();
}
