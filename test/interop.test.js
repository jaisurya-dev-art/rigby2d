import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAtlas, regionPlacement, writeAtlas } from '../src/core/atlas.js';
import { Skeleton } from '../src/core/model.js';
import { Pose, applyDrawOrder } from '../src/core/pose.js';
import { VERSION_FIELD as V, hexToColor, isSkeletonJson, readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

// Hand-written fixture following the documented 3.8 format (not exported from another tool).
const FIXTURE_38 = {
  skeleton: { hash: 'abc', [V]: '3.8.99', x: -50, y: 0, width: 100, height: 200, fps: 30, images: './images/' },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', y: 100 },
    { name: 'upper', parent: 'hip', rotation: -90, length: 50, shearY: 10 },
    { name: 'lower', parent: 'upper', x: 50, length: 50, transform: 'noScale' },
    { name: 'target', parent: 'root', x: 60, y: 60, color: 'ff3f00ff' },
  ],
  slots: [
    { name: 'body', bone: 'hip', attachment: 'body', color: 'ff0000ff', blend: 'additive' },
    { name: 'leg', bone: 'upper', attachment: 'leg', dark: '102030' },
    { name: 'shape', bone: 'hip', attachment: 'shape' },
    { name: 'clip', bone: 'hip', attachment: 'clip' },
  ],
  ik: [{ name: 'leg-ik', bones: ['upper', 'lower'], target: 'target', bendPositive: false }],
  skins: [
    {
      name: 'default',
      attachments: {
        body: { body: { x: 1, y: 2, rotation: 3, width: 40, height: 60 } },
        leg: {
          leg: {
            type: 'mesh',
            path: 'legs/leg',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            hull: 4,
            // Weighted: per vertex: boneCount, then (bone, x, y, weight) per bone.
            vertices: [1, 2, 0, 10, 1, 1, 2, 50, 10, 1, 2, 2, 50, -10, 0.5, 3, 50, -10, 0.5, 1, 2, 0, -10, 1],
            width: 50,
            height: 20,
          },
        },
        shape: { shape: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 10, 0, 0, 10] } },
        clip: { clip: { type: 'clipping', end: 'leg', vertexCount: 3, vertices: [0, 0, 5, 0, 0, 5] } },
      },
    },
    {
      name: 'armored',
      attachments: {
        body: { body: { name: 'body-armor', width: 44, height: 64 } },
        leg: { leg: { type: 'linkedmesh', parent: 'leg', skin: 'default', path: 'legs/armor' } },
      },
    },
  ],
  events: { step: { int: 1, string: 'left' }, sfx: { audio: 'a.wav', volume: 0.5 } },
  animations: {
    walk: {
      bones: {
        hip: {
          rotate: [{ time: 0, angle: 0, curve: 'stepped' }, { time: 1, angle: 90 }],
          translate: [{ time: 0, x: 0, y: 0, curve: 0.25, c3: 0.75 }, { time: 1, x: 10, y: 20 }],
          shear: [{ time: 0.5, x: 5, y: 0 }],
        },
      },
      slots: {
        body: {
          attachment: [{ time: 0.5, name: null }],
          color: [{ time: 0, color: 'ffffffff' }, { time: 1, color: '00000000' }],
        },
        leg: { twoColor: [{ time: 0, light: 'ffffffff', dark: '000000' }] },
      },
      deform: { default: { leg: { leg: [{ time: 0 }, { time: 1, offset: 2, vertices: [1, 1] }] } } },
      draworder: [{ time: 0.5, offsets: [{ slot: 'body', offset: 2 }] }],
      events: [{ time: 0.25, name: 'step' }],
      ik: { 'leg-ik': [{ time: 0, mix: 0.5 }] },
    },
  },
};

test('detects skeleton JSON files', () => {
  assert.ok(isSkeletonJson(FIXTURE_38));
  assert.ok(!isSkeletonJson({ bones: [] }));
});

test('placeholder versions use absolute curves when rotation keys use 4.x values', () => {
  const json = {
    skeleton: { [V]: '0.0.00' },
    bones: [{ name: 'root' }],
    animations: { walk: { bones: { root: {
      rotate: [{ value: -20, curve: [0.25, -20, 0.75, 20] }, { time: 1, value: 20 }],
    } } } },
  };
  const { skeleton } = readSkeletonJson(json);
  assert.equal(skeleton.header.version, '0.0.00');
  assert.deepEqual(skeleton.animations[0].bones[0].rotate[0].curve.bezier, [0.25, 0, 0.75, 1]);
  const output = writeSkeletonJson(skeleton, { version: '4.2' }).json;
  assert.deepEqual(output.animations.walk.bones.root.rotate, json.animations.walk.bones.root.rotate);
});

test('reads a 3.8 skeleton', () => {
  const { skeleton: sk, warnings } = readSkeletonJson(structuredClone(FIXTURE_38), 'hero');
  assert.deepEqual(warnings, []);
  assert.equal(sk.name, 'hero');
  assert.equal(sk.header.hash, 'abc');
  assert.deepEqual(sk.bones.map((b) => b.name), ['root', 'hip', 'upper', 'lower', 'target']);
  assert.equal(sk.bones[2].setup.shear_y, 10);
  assert.equal(sk.bones[3].inherit, 'noScale');
  assert.equal(sk.bones[4].color, 'ff3f00ff');
  assert.deepEqual(sk.slots[0].color, [1, 0, 0, 1]);
  assert.equal(sk.slots[0].blend, 'additive');
  assert.ok(close(sk.slots[1].dark[2], 0x30 / 255));

  const body = sk.slots[0].attachments[0];
  assert.deepEqual([body.offset.x, body.offset.y, body.offset.rotation, body.width], [1, 2, 3, 40]);
  const leg = sk.slots[1].attachments[0];
  assert.equal(leg.type, 'mesh');
  assert.equal(leg.image, 'legs/leg');
  assert.equal(leg.weights.length, 4);
  assert.deepEqual(leg.weights[2].map((w) => w.bone), [2, 3]);
  assert.equal(sk.slots[3].attachments[0].end, 1);

  const armored = sk.findSkin('armored');
  assert.equal(armored.slots.length, 2);
  assert.equal(armored.slots[0].attachments[0].image, 'body-armor');
  assert.equal(armored.slots[1].attachments[0].type, 'linkedmesh');

  assert.equal(sk.ik[0].bendPositive, false);
  assert.deepEqual(sk.ik[0].bones, [2, 3]);
  assert.deepEqual(sk.events.map((e) => e.name), ['step', 'sfx']);
  assert.equal(sk.events[1].volume, 0.5);

  const walk = sk.animations[0];
  assert.equal(walk.duration, 1);
  const hip = walk.boneTimeline(1);
  assert.equal(hip.rotate[0].curve, 'stepped');
  assert.deepEqual(hip.translate[0].curve, { bezier: [0.25, 0, 0.75, 1] });
  assert.deepEqual(hip.shear[0].value, [5, 0]);
  assert.equal(walk.slotTimeline(0).attachment[0].value, null);
  assert.equal(walk.slotTimeline(1).rgba2.length, 1);
  assert.equal(walk.deform[0].keys[1].value.offset, 2);
  assert.deepEqual(walk.drawOrder[0].value, [{ slot: 0, offset: 2 }]);
  assert.equal(walk.events[0].name, 'step');
  assert.equal(walk.ik[0].keys[0].value.mix, 0.5);
});

test('evaluates the 3.8 skeleton: skins, meshes, deform, draw order, IK', () => {
  const { skeleton: sk } = readSkeletonJson(structuredClone(FIXTURE_38), 'hero');
  const pose = new Pose(sk);

  // Two-bone IK: the lower bone's tip reaches the target.
  const tip = pose.world[3].apply([50, 0]);
  const target = pose.world[4].apply([0, 0]);
  assert.ok(Math.hypot(tip[0] - target[0], tip[1] - target[1]) < 0.5, `tip ${tip} target ${target}`);

  const drawn = pose.quads(sk);
  assert.deepEqual(drawn.map((d) => d.kind), ['region', 'mesh']);
  assert.equal(drawn[0].blend, 'additive');
  assert.equal(drawn[1].positions.length, 4);
  assert.equal(drawn[1].triangles.length, 6);

  // Skins: the armored skin swaps the body image; the linked mesh reuses the parent's geometry.
  sk.skin = 'armored';
  const armored = new Pose(sk).quads(sk);
  assert.equal(armored[0].attachment.image, 'body-armor');
  assert.equal(armored[1].attachment.type, 'linkedmesh');
  assert.equal(armored[1].positions.length, 4);
  sk.skin = null;

  // Animation: deform moves the second weighted vertex pair, draw order puts body on top.
  const anim = sk.animations[0];
  const before = new Pose(sk).worldVertices(sk, 1, sk.slots[1].attachments[0]);
  const p = new Pose(sk);
  p.apply(sk, anim, 1, 1);
  p.updateWorld(sk);
  const after = p.worldVertices(sk, 1, sk.slots[1].attachments[0]);
  assert.ok(Math.abs(after[2] - before[2]) > 0.1 || Math.abs(after[3] - before[3]) > 0.1, 'deform applied');
  assert.deepEqual(p.drawOrder, [1, 2, 0, 3]);
  assert.equal(p.attachment[0], null);
  assert.ok(close(p.color[0][0], 0));
  assert.equal(p.ik[0].mix, 0.5);
});

test('draw order offsets', () => {
  assert.deepEqual(applyDrawOrder(4, [{ slot: 0, offset: 2 }]), [1, 2, 0, 3]);
  assert.deepEqual(applyDrawOrder(4, [{ slot: 3, offset: -3 }]), [3, 0, 1, 2]);
  assert.deepEqual(applyDrawOrder(3, null), [0, 1, 2]);
});

test('3.8 write -> read round trip preserves the rig', () => {
  const { skeleton: sk } = readSkeletonJson(structuredClone(FIXTURE_38), 'hero');
  const { json, warnings } = writeSkeletonJson(sk, { version: '3.8' });
  assert.deepEqual(warnings, []);
  assert.equal(json.skeleton[V], '3.8.99');
  assert.equal(json.bones[3].transform, 'noScale');
  assert.equal(json.skins[0].attachments.leg.leg.vertices.length, FIXTURE_38.skins[0].attachments.leg.leg.vertices.length);
  assert.equal(json.animations.walk.bones.hip.rotate[1].angle, 90); // the 0 at the first key is a default and is omitted
  assert.ok(json.animations.walk.deform);
  const back = readSkeletonJson(JSON.parse(JSON.stringify(json)), 'hero').skeleton;
  back.header = sk.header;
  assert.equal(back.toJson(), sk.toJson());
});

test('4.x features: split timelines, rgba/alpha, absolute per-value curves', () => {
  const file = {
    skeleton: { [V]: '4.2.11' },
    bones: [{ name: 'root' }, { name: 'b', parent: 'root', inherit: 'onlyTranslation' }],
    slots: [{ name: 's', bone: 'b' }],
    animations: {
      a: {
        bones: {
          b: {
            rotate: [{ value: 0, curve: [0.25, 0, 0.75, 90] }, { time: 1, value: 90 }],
            translatex: [{ value: 0 }, { time: 2, value: 10 }],
            translate: [{ x: 0, y: 0, curve: [0.5, 0, 1, 10, 0.5, 0, 1, 0] }, { time: 2, x: 10, y: 0 }],
            inherit: [{ time: 0.5, inherit: 'noScale' }],
          },
        },
        slots: { s: { rgba: [{ color: 'ffffffff' }, { time: 1, color: '000000ff' }], alpha: [{ value: 0.5 }] } },
        drawOrder: [{ time: 1 }],
      },
    },
  };
  const { skeleton: sk } = readSkeletonJson(file, 'x');
  assert.equal(sk.bones[1].inherit, 'onlyTranslation');
  const tl = sk.animations[0].boneTimeline(1);
  assert.deepEqual(tl.rotate[0].curve.bezier, [0.25, 0, 0.75, 1]);
  assert.equal(tl.translateX.length, 2);
  // y does not change between the keys, so only the x curve matters and it is shared.
  assert.deepEqual(tl.translate[0].curve.bezier, [0.25, 0, 0.5, 1]);
  assert.equal(tl.inherit[0].value, 'noScale');
  assert.equal(sk.animations[0].slotTimeline(0).alpha[0].value, 0.5);
  assert.equal(sk.animations[0].duration, 2);

  const { json } = writeSkeletonJson(sk, { version: '4.2' });
  const rotate = json.animations.a.bones.b.rotate;
  assert.equal(rotate[0].time, undefined);
  assert.deepEqual(rotate[0].curve, [0.25, 0, 0.75, 90]);
  assert.equal(json.bones[1].inherit, 'onlyTranslation');
  assert.ok(json.animations.a.slots.s.rgba);
  const back = readSkeletonJson(JSON.parse(JSON.stringify(json)), 'x').skeleton;
  back.header = sk.header;
  assert.equal(back.toJson(), sk.toJson());
});

test('internal snapshot keeps imported-only data', () => {
  const { skeleton: sk } = readSkeletonJson(structuredClone(FIXTURE_38), 'hero');
  const back = Skeleton.fromJson(sk.toJson());
  assert.equal(back.toJson(), sk.toJson());
  assert.equal(back.skins.length, 1);
  assert.equal(back.slots[1].attachments[0].weights.length, 4);
});

test('hex colors', () => {
  assert.deepEqual(hexToColor('ff000080', [1, 1, 1, 1]).map((v) => Math.round(v * 255)), [255, 0, 0, 128]);
  assert.deepEqual(hexToColor('00ff00', [1, 1, 1, 1]), [0, 1, 0, 1]);
  assert.deepEqual(hexToColor(undefined, [1, 1, 1, 1]), [1, 1, 1, 1]);
});

test('atlas: current and legacy formats', () => {
  const current = `﻿hero.png
size: 512, 256
filter: Linear, Linear
pma: true
arm
bounds: 2, 4, 40, 120
offsets: 1, 3, 44, 126
rotate: 90
head
bounds: 50, 4, 64, 64

hero2.png
size: 128, 128
foot
bounds: 0, 0, 10, 10
index: 3
`;
  const { pages } = parseAtlas(current);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].pma, true);
  assert.deepEqual([pages[0].width, pages[0].height], [512, 256]);
  const arm = pages[0].regions[0];
  assert.deepEqual([arm.x, arm.y, arm.width, arm.height, arm.rotate], [2, 4, 40, 120, 90]);
  assert.deepEqual([arm.offsetX, arm.offsetY, arm.originalWidth, arm.originalHeight], [1, 3, 44, 126]);
  const place = regionPlacement(arm);
  assert.deepEqual(place.src, { x: 2, y: 4, width: 120, height: 40 });
  assert.deepEqual(place.dst, { x: 1, y: 3, width: 40, height: 120 });
  assert.equal(pages[0].regions[1].originalWidth, 64);
  assert.equal(pages[1].regions[0].index, 3);

  const legacy = `
legacy.png
size: 64,64
format: RGBA8888
filter: Linear,Linear
repeat: none
a
  rotate: true
  xy: 2, 2
  size: 10, 20
  orig: 12, 22
  offset: 1, 1
  index: -1
`;
  const old = parseAtlas(legacy).pages[0].regions[0];
  assert.deepEqual([old.x, old.y, old.width, old.height, old.rotate, old.originalWidth, old.offsetX], [2, 2, 10, 20, 90, 12, 1]);

  const again = parseAtlas(writeAtlas(pages)).pages;
  assert.deepEqual(again.map((p) => p.regions.map((r) => [r.name, r.x, r.y, r.width, r.height, r.rotate, r.index])), pages.map((p) => p.regions.map((r) => [r.name, r.x, r.y, r.width, r.height, r.rotate, r.index])));
});

test('names starting with _ survive JSON export; only binary-only fields are dropped (#50)', () => {
  // Names a rig from another tool may use, including ones spelled like the binary-only fields.
  const json = {
    skeleton: { [V]: '4.2.0' },
    bones: [{ name: 'root' }, { name: '_pivot', parent: 'root', _iconA: 2, _visible: false }],
    slots: [
      { name: '_fx', bone: '_pivot', attachment: '_trans4x4' },
      { name: 'body', bone: 'root', attachment: '_color' },
    ],
    skins: [{ name: 'default', attachments: { _fx: { _trans4x4: { width: 4, height: 4 } }, body: { _color: { width: 8, height: 8 } } } }],
    events: { _hit: { int: 1 } },
    animations: { _walk: { events: [{ time: 0.5, name: '_hit' }] } },
  };
  const { skeleton } = readSkeletonJson(json, 'pluto');
  for (const version of ['3.8', '4.2', '4.3']) {
    const out = writeSkeletonJson(skeleton, { version }).json;
    assert.deepEqual(out.slots.map((s) => [s.name, s.attachment]), [['_fx', '_trans4x4'], ['body', '_color']], version);
    const skin = Array.isArray(out.skins) ? out.skins[0].attachments : out.skins.default;
    assert.deepEqual(Object.keys(skin._fx), ['_trans4x4'], version);
    assert.deepEqual(Object.keys(skin.body), ['_color'], version);
    assert.ok(out.animations._walk && out.events._hit, version);
    // The binary-only bone fields are gone.
    assert.equal(out.bones[1]._iconA, undefined, version);
    assert.equal(out.bones[1]._visible, undefined, version);
    // And the export reads back with every name.
    const back = readSkeletonJson(out, 'pluto').skeleton;
    assert.deepEqual(back.slots.map((s) => s.attachments.map((a) => a.name)), [['_trans4x4'], ['_color']], version);
  }
});
