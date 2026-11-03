// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';

import { defoldAtlas, frameCount, frameName, opaqueRect, packRects } from '../src/editor/spritesheet.js';

test('a loop leaves out its last frame, a one-shot keeps it', () => {
  assert.equal(frameCount(1, 30, true), 30);
  assert.equal(frameCount(1, 30, false), 31);
  assert.equal(frameName('walk', 7), 'walk_007');
});

test('packed rectangles never overlap and stay inside the sheet', () => {
  const sizes = [
    { w: 40, h: 30 },
    { w: 10, h: 50 },
    { w: 25, h: 25 },
    { w: 60, h: 10 },
  ];
  for (const layout of ['packed', 'grid']) {
    const { width, height, places } = packRects(sizes, { layout, padding: 2 });
    places.forEach((p, i) => {
      assert.ok(p.x + sizes[i].w <= width && p.y + sizes[i].h <= height);
      places.forEach((q, j) => {
        if (i >= j) return;
        const apart = p.x + sizes[i].w <= q.x || q.x + sizes[j].w <= p.x || p.y + sizes[i].h <= q.y || q.y + sizes[j].h <= p.y;
        assert.ok(apart, `${layout}: ${i} and ${j} overlap`);
      });
    });
  }
});

test('opaque rect finds the visible pixels', () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  rgba[(1 * 4 + 2) * 4 + 3] = 255;
  rgba[(2 * 4 + 1) * 4 + 3] = 10;
  assert.deepEqual(opaqueRect(rgba, 4, 4), { x: 1, y: 1, w: 2, h: 2 });
  assert.equal(opaqueRect(new Uint8ClampedArray(16), 2, 2), null);
});

test('Defold atlas lists one animation per animation', () => {
  const text = defoldAtlas([{ name: 'walk_000', animation: 'walk' }, { name: 'walk_001', animation: 'walk' }], { folder: 'hero', fps: 30, loop: true });
  assert.match(text, /id: "walk"/);
  assert.match(text, /image: "\/hero\/walk_001.png"/);
  assert.match(text, /PLAYBACK_LOOP_FORWARD/);
});

test('Rigbytron renders into a trimmed, deduplicated sheet with its JSON', async () => {
  const fs = await import('node:fs');
  const { parseAtlas } = await import('../src/core/atlas.js');
  const { readSkeletonBinary } = await import('../src/core/binary.js');
  const { readSkeletonJson } = await import('../src/core/interop.js');
  const { atlasLookup } = await import('../src/core/draw.js');
  const { decodePng } = await import('../src/mcp/png.js');
  const { buildSpriteSheet } = await import('../src/editor/spritesheet.js');
  const dir = new URL('../branding/rigbytron/export/', import.meta.url);
  const sk = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('rigbytron.skel', dir)))), 'rigbytron').skeleton;
  const atlas = parseAtlas(fs.readFileSync(new URL('rigbytron.atlas', dir), 'utf8'));
  const lookup = atlasLookup(atlas, (page) => ({ ...decodePng(new Uint8Array(fs.readFileSync(new URL(page.name, dir)))), pma: page.pma }));
  const { files, summary } = buildSpriteSheet(sk, lookup, { name: 'r', animations: ['hold'], fps: 10, scale: 0.1 });
  assert.deepEqual(files.map((f) => f.path), ['r.png', 'r.json']);
  const data = JSON.parse(files[1].text);
  assert.equal(Object.keys(data.frames).length, summary.frames);
  assert.equal(data.meta.frameTags[0].name, 'hold');
  const png = files[0].png;
  let opaque = 0;
  for (let i = 3; i < png.rgba.length; i += 4) if (png.rgba[i] === 255) opaque++;
  assert.ok(opaque > 1000, 'the sheet has visible pixels');
  // Every frame lies inside the sheet.
  for (const f of Object.values(data.frames)) assert.ok(f.frame.x + f.frame.w <= png.width && f.frame.y + f.frame.h <= png.height);
});
