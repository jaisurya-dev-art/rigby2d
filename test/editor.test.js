import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation, makeKey } from '../src/core/animation.js';
import { LINEAR } from '../src/core/curve.js';
import { keySlotTint } from '../src/core/keying.js';
import { makeSlot, Skeleton } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import { pack, packPages } from '../src/editor/pack.js';
import { robot } from '../src/editor/sample.js';

test('pack places without overlap', () => {
  const items = Array.from({ length: 19 }, (_, k) => ({ name: `i${k}`, width: 10 * (k + 1), height: 7 * (19 - k) }));
  const { width, height, regions } = pack(items);
  regions.forEach((a, i) => {
    assert.ok(a.x + a.width <= width && a.y + a.height <= height);
    for (const b of regions.slice(i + 1)) {
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
    }
  });
});

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('packPages keeps one page when everything fits', () => {
  const items = Array.from({ length: 19 }, (_, k) => ({ name: `i${k}`, width: 10 * (k + 1), height: 7 * (19 - k) }));
  assert.deepEqual(packPages(items), [pack(items)]);
});

test('packPages spreads images that do not fit in one page over more pages', () => {
  // Twelve 3000px images: no 8192px page holds more than four.
  const items = Array.from({ length: 12 }, (_, k) => ({ name: `big${k}`, width: 3000, height: 3000 }));
  assert.throws(() => pack(items), /do not fit in an 8192px atlas/);
  const pages = packPages(items);
  assert.equal(pages.length, 3);
  const names = pages.flatMap((p) => p.regions.map((r) => r.name)).sort();
  assert.deepEqual(names, items.map((i) => i.name).sort());
  for (const { width, height, regions } of pages) {
    assert.ok(width <= 8192 && height <= 8192);
    regions.forEach((a, i) => {
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= width && a.y + a.height <= height);
      for (const b of regions.slice(i + 1)) assert.ok(!overlaps(a, b), `${a.name} overlaps ${b.name}`);
    });
  }
  // Small images fill the pages the big ones leave room in, rather than opening new ones.
  const mixed = [...items, ...Array.from({ length: 40 }, (_, k) => ({ name: `s${k}`, width: 100, height: 100 }))];
  assert.equal(packPages(mixed).length, 3);
  // A smaller page size gives more pages.
  assert.equal(packPages(items.slice(0, 2), 4096).length, 2);
});

test('packPages gives an image as big as a page a page of its own', () => {
  const items = [{ name: 'bg', width: 8192, height: 8192 }, { name: 'sky', width: 8190, height: 3000 }, { name: 'a', width: 300, height: 200 }, { name: 'b', width: 64, height: 64 }];
  const pages = packPages(items);
  assert.deepEqual(pages[0], { width: 8192, height: 8192, regions: [{ name: 'bg', x: 0, y: 0, width: 8192, height: 8192 }] });
  assert.deepEqual(pages[1], { width: 8192, height: 4096, regions: [{ name: 'sky', x: 0, y: 0, width: 8190, height: 3000 }] });
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[2].regions.map((r) => r.name), ['a', 'b']);
});

test('packPages names the image that is too big for any page', () => {
  assert.throws(() => packPages([{ name: 'ok', width: 10, height: 10 }, { name: 'sky', width: 9000, height: 400 }]), /image 'sky' \(9000x400\) is bigger than an atlas page \(8192x8192 at most\)/);
});

test('sample is valid and roundtrips', () => {
  const names = new Set();
  const sk = robot({ insertRgba: (name) => names.add(name) });
  assert.equal(Skeleton.fromJson(sk.toJson()).toJson(), sk.toJson());
  assert.ok(sk.slots.every((s) => s.attachments.every((a) => names.has(a.image))));
  assert.deepEqual(sk.animations.map((a) => a.name), ['walk', 'idle']);
});

test('slot tint edits create an animation key without changing the setup tint', () => {
  const doc = new Skeleton();
  doc.slots.push(makeSlot('fx', 0, null));
  const { color } = doc.slots[0];
  const tl = new Animation('flash', 2).slotTimelineMut(0);
  keySlotTint(tl, color, 2, 'rgb', [0.5, 0, 1], LINEAR);
  keySlotTint(tl, color, 2, 'alpha', 0.25, LINEAR);
  assert.deepEqual(tl.color, [makeKey(2, [0.5, 0, 1, 0.25])]);
  assert.deepEqual(color, [1, 1, 1, 1]);
});

test('slot tint edits follow imported channel precedence and preserve dark tint', () => {
  const doc = new Skeleton();
  doc.slots.push(makeSlot('fx', 0, null));
  const anim = new Animation('flash', 1);
  doc.animations.push(anim);
  const tl = anim.slotTimelineMut(0);
  tl.color.push(makeKey(0, [1, 1, 1, 1]));
  tl.rgba2.push(makeKey(0, [0.2, 0.3, 0.4, 1, 0.1, 0.2, 0.3]));
  tl.rgb2.push(makeKey(0, [1, 1, 0, 0.4, 0.5, 0.6]));
  const { color } = doc.slots[0];
  keySlotTint(tl, color, 0.5, 'rgb', [0.5, 1, 0], LINEAR);
  keySlotTint(tl, color, 0.5, 'alpha', 0.25, LINEAR);
  assert.deepEqual(tl.rgba2[1].value, [0.2, 0.3, 0.4, 0.25, 0.1, 0.2, 0.3]);
  const pose = new Pose(doc);
  pose.apply(doc, anim, 0.5, 1);
  assert.deepEqual(pose.color[0], [0.5, 1, 0, 0.25]);
  assert.deepEqual(pose.dark[0], [0.4, 0.5, 0.6]);
  assert.deepEqual(tl.color, [makeKey(0, [1, 1, 1, 1])]);
});

test('zip writes a valid stored archive', async () => {
  const { zip, crc32 } = await import('../src/editor/zip.js');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = zip([{ path: 'a/b.txt', bytes: new TextEncoder().encode('hi') }]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 1);
});

test('unzip reads what zip writes', async () => {
  const { zip, unzip } = await import('../src/editor/zip.js');
  const enc = new TextEncoder();
  const files = unzip(zip([{ path: 'project.json', bytes: enc.encode('{"a":1}') }, { path: 'images/a b/c.png', bytes: new Uint8Array([1, 2, 3]) }]));
  assert.deepEqual([...files.keys()], ['project.json', 'images/a b/c.png']);
  assert.equal(new TextDecoder().decode(files.get('project.json')), '{"a":1}');
  assert.deepEqual([...files.get('images/a b/c.png')], [1, 2, 3]);
});

test('point bones: a length 0 bone poses, parents and round-trips through JSON and .skel', async () => {
  const { makeBone } = await import('../src/core/model.js');
  const { transform } = await import('../src/core/math.js');
  const { Pose } = await import('../src/core/pose.js');
  const { writeSkeletonJson, readSkeletonJson } = await import('../src/core/interop.js');
  const { writeSkeletonBinary, readSkeletonBinary } = await import('../src/core/binary.js');
  const doc = robot({ insertRgba: () => {} });
  const at = doc.addBone(makeBone('pivot', 0, transform(37, -12, 30), 0));
  const child = doc.addBone(makeBone('arm', at, transform(0, 0, 0), 50));
  const pose = new Pose(doc);
  const tip = pose.world[child].apply([50, 0]);
  const root = pose.world[0];
  const o = root.apply([37, -12]);
  const r = (30 * Math.PI) / 180;
  const want = root.apply([37 + 50 * Math.cos(r), -12 + 50 * Math.sin(r)]);
  assert.ok(Math.hypot(pose.world[at].apply([0, 0])[0] - o[0], pose.world[at].apply([0, 0])[1] - o[1]) < 1e-6);
  assert.ok(Math.hypot(tip[0] - want[0], tip[1] - want[1]) < 1e-6);
  const json = readSkeletonJson(writeSkeletonJson(doc, { version: '4.3' }).json).skeleton;
  assert.equal(json.bones[json.boneIndex('pivot')].length, 0);
  assert.equal(json.bones[json.boneIndex('arm')].parent, json.boneIndex('pivot'));
  const bin = readSkeletonJson(readSkeletonBinary(writeSkeletonBinary(writeSkeletonJson(doc, { version: '4.3', binary: true }).json))).skeleton;
  assert.equal(bin.bones[bin.boneIndex('pivot')].length, 0);
});

test('locked mesh vertices are saved in work files and undo, never in exports', async () => {
  const { writeSkeletonJson } = await import('../src/core/interop.js');
  const doc = robot({ insertRgba: () => {} });
  doc.meshLocks = { 'body/body': [3, 1, 1, -2, 'x'] };
  const again = Skeleton.fromObject(JSON.parse(doc.toSnapshot()));
  assert.deepEqual(again.meshLocks, { 'body/body': [1, 3] });
  assert.ok(!JSON.stringify(writeSkeletonJson(doc, { version: '4.3' }).json).includes('meshLocks'));
  // No locks: nothing is written.
  doc.meshLocks = {};
  assert.ok(!doc.toSnapshot().includes('meshLocks'));
});
