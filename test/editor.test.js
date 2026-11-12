import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Skeleton } from '../src/core/model.js';
import { pack } from '../src/editor/pack.js';
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

test('sample is valid and roundtrips', () => {
  const names = new Set();
  const sk = robot({ insertRgba: (name) => names.add(name) });
  assert.equal(Skeleton.fromJson(sk.toJson()).toJson(), sk.toJson());
  assert.ok(sk.slots.every((s) => s.attachments.every((a) => names.has(a.image))));
  assert.deepEqual(sk.animations.map((a) => a.name), ['walk', 'idle']);
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
