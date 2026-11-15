import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSkeletonBinary, readSkeletonBinary, writeSkeletonBinary } from '../src/core/binary.js';
import { VERSION_FIELD as V, readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';
import { robot } from '../src/editor/sample.js';

// A hand-written 4.3 skeleton using every feature the binary encoder supports.
const FIXTURE = {
  skeleton: { hash: 'AAECAwQFBgc', [V]: '4.3.0', x: -10, y: 0, width: 120, height: 200, images: './images/', audio: null },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', y: 100, color: 'ff0000ff', icon: 'ik' },
    { name: 'upper', parent: 'hip', rotation: -90, length: 50, inherit: 'noScale' },
    { name: 'lower', parent: 'upper', x: 50, length: 50, scaleX: 1.5, shearY: 4 },
    { name: 'target', parent: 'root', x: 30, y: 20 },
  ],
  slots: [
    { name: 'body', bone: 'hip', attachment: 'body', color: '80ff80ff', blend: 'additive' },
    { name: 'leg', bone: 'upper', attachment: 'leg' },
  ],
  constraints: [{ type: 'ik', name: 'leg-ik', target: 'target', bones: ['upper', 'lower'], bendPositive: false }],
  skins: [
    {
      name: 'default',
      attachments: {
        body: { body: { x: 1, y: 2, rotation: 3, width: 40, height: 60 }, 'body-alt': { path: 'body2', width: 40, height: 60, scaleX: 2 } },
        leg: {
          leg: {
            type: 'mesh',
            path: 'legs/leg',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            vertices: [1, 2, 0, 10, 1, 2, 2, 50, 10, 0.5, 3, 0, 10, 0.5, 1, 3, 50, -10, 1, 1, 2, 0, -10, 1],
            hull: 4,
            edges: [0, 2, 2, 4, 4, 6, 6, 0],
            width: 50,
            height: 20,
          },
          flat: { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 0, 10], hull: 3, edges: [], width: 10, height: 10 },
        },
      },
    },
  ],
  events: { step: { int: 3, float: 0.5, string: 'left' } },
  animations: {
    run: {
      slots: {
        body: {
          attachment: [{ name: 'body-alt' }, { time: 0.5, name: 'body' }, { time: 0.75 }],
          rgba: [{ color: 'ffffffff', curve: [0.1, 1, 0.2, 0.5, 0.1, 1, 0.2, 0.5, 0.1, 1, 0.2, 0.5, 0.1, 1, 0.2, 0.5] }, { time: 0.3, color: '00000080' }],
        },
      },
      bones: {
        hip: {
          rotate: [{ value: 10, curve: 'stepped' }, { time: 0.5, value: -20, curve: [0.6, -20, 0.8, 5] }, { time: 1, value: 5 }],
          translate: [{ x: 1, curve: [0.1, 1, 0.2, 2, 0.1, 0, 0.2, 3] }, { time: 0.4, x: 2, y: 3 }],
          scaley: [{ value: 2 }],
          shear: [{ time: 0.2, x: 5 }],
        },
      },
      ik: { 'leg-ik': [{ mix: 0 }, { time: 0.5, mix: 0.5, softness: 10, stretch: true }, { time: 1, bendPositive: false }] },
      drawOrder: [{ time: 0.25, offsets: [{ slot: 'body', offset: 1 }] }, { time: 0.75 }],
      events: [{ time: 0.1, name: 'step' }, { time: 0.6, name: 'step', int: 7, string: 'right' }],
    },
  },
};

const near = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => near(a[k], b[k]));
  }
  return a === b;
};

const roundTrip = (fixture) => {
  const bytes = writeSkeletonBinary(structuredClone(fixture));
  assert.ok(isSkeletonBinary(bytes));
  const back = readSkeletonBinary(bytes);
  delete back._strings;
  return back;
};

test('binary round trip of the fixture is lossless', () => {
  const back = roundTrip(FIXTURE);
  assert.ok(near(back, FIXTURE), JSON.stringify(back).slice(0, 400));
});

// Constraints, extra skins and the remaining attachment and key types.
const RICH = structuredClone(FIXTURE);
RICH.slots.push({ name: 'rope', bone: 'hip', attachment: 'rope-path' }, { name: 'mask', bone: 'hip', attachment: 'mask' });
RICH.slots[1].dark = '102030';
RICH.constraints.push(
  {
    type: 'transform',
    name: 'follow',
    source: 'hip',
    bones: ['target'],
    x: 4,
    rotation: 15,
    properties: { x: { to: { x: { max: 100 } } }, rotate: { offset: 2, to: { rotate: { max: 100, scale: 0.5 } } } },
    mixX: 0.5,
    mixRotate: 0.25,
  },
  { type: 'path', name: 'along', slot: 'rope', bones: ['upper', 'lower'], spacingMode: 'percent', rotateMode: 'chainScale', spacing: 0.5, mixX: 0.75 },
  { type: 'ik', name: 'reach', target: 'target', bones: ['hip'], mix: 0.4, skin: true },
);
const atts = RICH.skins[0].attachments;
atts.body.tinted = { name: 'body-tint', color: '80ff80ff', width: 10, height: 10 };
atts.body.hitbox = { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 10, 0, 0, 10] };
atts.mask = { mask: { type: 'clipping', end: 'leg', vertexCount: 3, vertices: [0, 0, 5, 0, 0, 5], color: 'ce3a3aff' } };
atts.rope = {
  'rope-path': { type: 'path', vertexCount: 3, lengths: [42], vertices: [1, 2, 0, 0, 1, 1, 2, 10, 0, 1, 1, 3, 20, 0, 1] },
};
RICH.skins.push({
  name: 'armor',
  bones: ['target'],
  ik: ['reach'],
  attachments: {
    leg: { leg: { type: 'linkedmesh', name: 'leg-armor', source: 'leg', width: 50, height: 20 } },
    body: { body: { path: 'armor/body', width: 44, height: 64, rotation: 5 } },
  },
});
const run = RICH.animations.run;
run.slots.leg = { rgba2: [{ light: 'ffffffff', dark: '000000', curve: [0.1, 1, 0.2, 1, 0.1, 1, 0.2, 1, 0.1, 1, 0.2, 1, 0.1, 1, 0.2, 1, 0.1, 0, 0.2, 0.1, 0.1, 0, 0.2, 0.1, 0.1, 0, 0.2, 0.1] }, { time: 0.4, light: 'ff0000ff', dark: '102030' }] };
run.ik['leg-ik'][0].curve = [0.1, 0, 0.3, 0.5, 0.1, 0, 0.3, 10];
run.transform = { follow: [{ mixX: 0, mixRotate: 0.5, curve: 'stepped' }, { time: 0.5, mixX: 0.5 }] };
run.attachments = {
  default: { leg: { leg: { deform: [{ curve: [0.1, 0, 0.2, 1] }, { time: 0.5, offset: 2, vertices: [1, 2, 3, 4] }, { time: 1 }] } } },
};

test('binary round trip with constraints, skins and every supported attachment type', () => {
  const back = roundTrip(RICH);
  assert.ok(near(back, RICH), JSON.stringify(back).slice(0, 600));
});

test('the document model loads the rich fixture from binary', () => {
  const { skeleton } = readSkeletonJson(roundTrip(RICH), 'rich');
  assert.equal(skeleton.skins.length, 1);
  assert.equal(skeleton.skins[0].slots.find((e) => e.attachments[0].type === 'linkedmesh').attachments[0].parent, 'leg');
  assert.equal(skeleton.ik.length, 2);
  assert.equal(skeleton.extra.constraints.length, 2);
  assert.equal(skeleton.animations[0].deform.length, 1);
});

test('binary through the document model', () => {
  const { skeleton } = readSkeletonJson(structuredClone(FIXTURE), 'fixture');
  const bytes = writeSkeletonBinary(writeSkeletonJson(skeleton, { version: '4.3', binary: true }).json);
  const again = readSkeletonJson(readSkeletonBinary(bytes), 'fixture').skeleton;
  // Rig data is identical; the header bounds are recomputed and the string table is carried along.
  const rig = (sk) => { const o = sk.toObject(); delete o.header; delete o.extra; return JSON.stringify(o); };
  assert.equal(rig(again), rig(skeleton));
  // Exported JSON never contains binary-only data.
  assert.ok(!JSON.stringify(writeSkeletonJson(again, { version: '4.3' }).json).includes('"_'));
});

test('the sample robot exports to binary', () => {
  const sk = robot({ insertRgba: () => {} });
  const bytes = writeSkeletonBinary(writeSkeletonJson(sk, { version: '4.3', binary: true }).json);
  const back = readSkeletonJson(readSkeletonBinary(bytes), 'robot').skeleton;
  assert.equal(back.bones.length, sk.bones.length);
  assert.equal(back.animations.length, 2);
});

test('unsupported features stop with a clear error', () => {
  const withPoint = structuredClone(FIXTURE);
  withPoint.skins[0].attachments.body.marker = { type: 'point', x: 1, y: 2 };
  assert.throws(() => writeSkeletonBinary(withPoint), /not supported in \.skel/);
  const withRgb = structuredClone(FIXTURE);
  withRgb.animations.run.slots.body.rgb = [{ color: 'ff0000' }];
  assert.throws(() => writeSkeletonBinary(withRgb), /not supported in \.skel/);
  const pingPong = structuredClone(FIXTURE);
  pingPong.skins[0].attachments.body.body.sequence = { count: 3 };
  pingPong.animations.run.attachments = { default: { body: { body: { sequence: [{ mode: 'pingpong', delay: 0.1 }] } } } };
  assert.throws(() => writeSkeletonBinary(pingPong), /not supported in \.skel/);
  assert.ok(!isSkeletonBinary(new TextEncoder().encode('{"skeleton":{}}')));
});

test('sequences, sliders, path keys, weighted clipping and stepped IK round-trip through .skel', () => {
  const json = structuredClone(FIXTURE);
  const body = json.skins[0].attachments.body.body;
  body.sequence = { count: 4, start: 0, digits: 2 };
  json.constraints.push({ type: 'slider', name: 'spin', animation: 'run', bone: 'hip', property: 'rotate', scale: 0.01, local: true, loop: true, time: 0.5 });
  const run = json.animations.run;
  run.attachments = { default: { body: { body: { sequence: [{ mode: 'loop', delay: 0.1 }, { time: 0.4 }, { time: 0.5, mode: 'onceReverse', index: 2, delay: 0.05 }] } } } };
  run.slider = { spin: { mix: [{}, { time: 0.5, value: 0 }] } };
  const back = readSkeletonBinary(writeSkeletonBinary(structuredClone(json)));
  assert.deepEqual(back.skins[0].attachments.body.body.sequence, body.sequence);
  assert.deepEqual(back.constraints.find((c) => c.type === 'slider'), json.constraints.at(-1));
  assert.deepEqual(back.animations.run.attachments.default.body.body.sequence, run.attachments.default.body.body.sequence);
  assert.deepEqual(back.animations.run.slider, run.slider);
});

test('physics constraints and wind keys round-trip through .skel', () => {
  const json = structuredClone(FIXTURE);
  json.constraints.push(
    { type: 'physics', name: 'sway', bone: 'hip', rotate: 1, scaleX: 0.5, limit: 1500, inertia: 0.25, strength: 80, damping: 0.75, mass: 2, windGlobal: true },
    { type: 'physics', name: 'bounce', bone: 'hip', x: 0.5, y: 0.75 },
  );
  const anim = Object.values(json.animations)[0];
  anim.physics = {
    sway: { wind: [{ value: -12.5 }, { time: 0.5, value: 20, curve: 'stepped' }, { time: 1 }] },
    '': { wind: [{ value: 3 }, { time: 1, value: -3 }] },
  };
  const back = readSkeletonBinary(writeSkeletonBinary(structuredClone(json)));
  assert.deepEqual(back.constraints.filter((c) => c.type === 'physics'), json.constraints.filter((c) => c.type === 'physics'));
  assert.deepEqual(Object.values(back.animations)[0].physics, anim.physics);
});

test('transform constraint options (local source / target, additive, clamp) round-trip through .skel', async () => {
  const { Pose } = await import('../src/core/pose.js');
  const rig = (options) => ({
    skeleton: { [V]: '4.3.0' },
    bones: [
      { name: 'root' },
      { name: 'driver', parent: 'root', x: 100, y: 50, rotation: 30 },
      { name: 'follower', parent: 'root', x: -40, rotation: 10 },
    ],
    slots: [],
    constraints: [{ type: 'transform', name: 't', bones: ['follower'], source: 'driver', x: 5, properties: { rotate: { to: { rotate: { max: 20 } } }, x: { to: { x: {} } } }, ...options }],
    skins: [{ name: 'default', attachments: {} }],
    animations: {},
  });
  const KEYS = ['localSource', 'localTarget', 'additive', 'clamp'];
  for (let bits = 0; bits < 16; bits++) {
    const options = Object.fromEntries(KEYS.filter((_, i) => bits & (1 << i)).map((k) => [k, true]));
    const json = rig(options);
    const back = readSkeletonBinary(writeSkeletonBinary(json));
    const c = back.constraints.find((x) => x.name === 't');
    for (const k of KEYS) assert.equal(!!c[k], !!options[k], `${k} with options ${JSON.stringify(options)}`);
    // Both files pose the follower the same way.
    const a = readSkeletonJson(json).skeleton;
    const b = readSkeletonJson(back).skeleton;
    const wa = new Pose(a).world[a.bones.findIndex((x) => x.name === 'follower')];
    const wb = new Pose(b).world[b.bones.findIndex((x) => x.name === 'follower')];
    for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty']) assert.ok(Math.abs(wa[k] - wb[k]) < 1e-4, `${k} with options ${JSON.stringify(options)}`);
  }
  // The flags byte: (property count << 5) | options; written with the older names too.
  const bytes = writeSkeletonBinary(rig({ local: true, relative: true }));
  const back = readSkeletonBinary(bytes).constraints.find((x) => x.name === 't');
  assert.deepEqual([back.localSource, back.localTarget, back.additive], [true, true, true]);
});
