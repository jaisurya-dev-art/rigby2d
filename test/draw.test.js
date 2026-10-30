// SPDX-License-Identifier: MIT OR Apache-2.0
// Drawing without a graphics API (draw.js): what the WebGL renderer and the engine runtimes (Cocos
// Creator) draw from. A real character's triangles land inside their atlas pages, with tint, and
// clipping masks what it covers.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { atlasLookup, drawSkeletonGeometry, imageLookup, parseAtlas, Pose, readSkeletonBinary, readSkeletonJson } from '../src/core/index.js';

test("NILA's export draws as triangles inside her atlas pages", () => {
  const sk = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync('branding/nila/export/nila.skel'))), 'nila').skeleton;
  const atlas = parseAtlas(fs.readFileSync('branding/nila/export/nila.atlas', 'utf8'));
  const page = { name: 'page' };
  const lookup = atlasLookup(atlas, () => page);
  const pose = new Pose(sk);
  pose.setToSetup(sk);
  pose.updateWorld(sk);
  let triangles = 0;
  let pieces = 0;
  drawSkeletonGeometry(sk, pose, lookup, (tex, blend, positions, uvs, tri, light) => {
    assert.equal(tex, page);
    assert.ok(['normal', 'additive', 'multiply', 'screen'].includes(blend));
    assert.equal(positions.length, uvs.length);
    for (const v of uvs) assert.ok(v >= -1e-6 && v <= 1 + 1e-6, `uv ${v}`);
    for (const t of tri) assert.ok(t < positions.length / 2);
    assert.equal(light.length, 4);
    triangles += tri.length / 3;
    pieces++;
  });
  assert.ok(pieces > 20 && triangles > 100, `${pieces} pieces, ${triangles} triangles`);
});

test('tint multiplies, skip leaves out, and images without an atlas work', () => {
  const sk = readSkeletonJson(
    {
      skeleton: { spine: '4.2.0' },
      bones: [{ name: 'root' }],
      slots: [
        { name: 'a', bone: 'root', attachment: 'a', color: 'ff000080' },
        { name: 'b', bone: 'root', attachment: 'b', blend: 'additive' },
      ],
      skins: [{ name: 'default', attachments: { a: { a: { width: 10, height: 10 } }, b: { b: { width: 4, height: 4 } } } }],
    },
    't',
  ).skeleton;
  const pose = new Pose(sk);
  pose.setToSetup(sk);
  pose.updateWorld(sk);
  const lookup = imageLookup({ a: 'texA', b: 'texB' });
  const seen = [];
  drawSkeletonGeometry(sk, pose, lookup, (tex, blend, p, uv, tri, light) => seen.push({ tex, blend, light }), { tint: [1, 1, 1, 0.5] });
  assert.deepEqual(
    seen.map((s) => [s.tex, s.blend]),
    [
      ['texA', 'normal'],
      ['texB', 'additive'],
    ],
  );
  assert.ok(Math.abs(seen[0].light[3] - 0.25) < 0.01, 'slot alpha times tint alpha');
  const skipped = [];
  drawSkeletonGeometry(sk, pose, lookup, (tex) => skipped.push(tex), { skip: (slot) => slot === 0 });
  assert.deepEqual(skipped, ['texB']);
});
