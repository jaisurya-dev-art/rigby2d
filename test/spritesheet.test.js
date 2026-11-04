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

/** Distinct frames with opaque corners (so trimming keeps the whole frame and nothing is deduplicated). */
function solidFrames(count, w, h, animation = (i) => 'a') {
  return Array.from({ length: count }, (_, i) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    rgba[3] = rgba[(w * h - 1) * 4 + 3] = 255;
    rgba[0] = i;
    return { name: `f${i}`, animation: animation(i), index: i, rgba };
  });
}

test('frames that do not fit one sheet go on more sheets, each within the max size', async () => {
  const { packSheet } = await import('../src/editor/spritesheet.js');
  const rendered = { width: 1500, height: 1500, origin: [0, 0], frames: solidFrames(20, 1500, 1500, (i) => (i < 10 ? 'a' : 'b')) };
  for (const layout of ['packed', 'grid']) {
    const sheet = packSheet(rendered, { trim: true, dedupe: true, maxWidth: 4096, layout });
    assert.ok(sheet.pages.length > 1, `${layout}: several sheets`);
    for (const p of sheet.pages) assert.ok(p.width <= 4096 && p.height <= 4096, `${layout}: ${p.width}x${p.height} within 4096`);
    for (const s of sheet.sprites) {
      const p = sheet.pages[s.page];
      assert.ok(s.frame.x + s.frame.w <= p.width && s.frame.y + s.frame.h <= p.height, `${layout}: frame inside its sheet`);
    }
    for (const a of sheet.sprites) {
      for (const b of sheet.sprites) {
        if (a === b || a.page !== b.page) continue;
        const apart = a.frame.x + a.frame.w <= b.frame.x || b.frame.x + b.frame.w <= a.frame.x || a.frame.y + a.frame.h <= b.frame.y || b.frame.y + b.frame.h <= a.frame.y;
        assert.ok(apart, `${layout}: frames on one sheet don't overlap`);
      }
    }
  }
  const pot = packSheet(rendered, { maxWidth: 4096, pot: true });
  for (const p of pot.pages) assert.ok(Number.isInteger(Math.log2(p.width)) && Number.isInteger(Math.log2(p.height)), 'power-of-two sheets');
  // A single frame larger than any image can be still fails, with advice.
  const huge = { width: 33000, height: 1, origin: [0, 0], frames: [{ name: 'x', animation: 'a', index: 0, rgba: new Uint8ClampedArray(33000 * 4).fill(255) }] };
  assert.throws(() => packSheet(huge, { maxWidth: 4096 }), /larger than one image can be.*PNG frames format/s);
});

test('several sheets are written as name-N.png + name-N.json (PixiJS) and a Phaser multi-atlas', async () => {
  const { multiAtlasJson, sheetJson, packSheet } = await import('../src/editor/spritesheet.js');
  const frames = solidFrames(6, 1000, 1000, () => 'run');
  const rendered = { width: 1000, height: 1000, origin: [500, 900], frames };
  const sheet = packSheet(rendered, { maxWidth: 2048 });
  assert.ok(sheet.pages.length >= 2);
  const images = sheet.pages.map((_, i) => `hero-${i}.png`);
  const multi = JSON.parse(multiAtlasJson(sheet, rendered, { images, fps: 30 }));
  assert.equal(multi.textures.length, sheet.pages.length);
  assert.deepEqual(multi.textures.map((t) => t.image), images);
  assert.deepEqual(multi.textures.flatMap((t) => t.frames.map((f) => f.filename)).sort(), frames.map((f) => f.name).sort());
  assert.deepEqual(multi.meta.frameTags, [{ name: 'run', from: 0, to: 5, direction: 'forward' }]);
  const page0 = JSON.parse(sheetJson(sheet, rendered, { image: images[0], fps: 30, page: 0, related: ['hero-1.json'] }));
  assert.deepEqual(page0.meta.related_multi_packs, ['hero-1.json']);
  assert.equal(page0.meta.size.w, sheet.pages[0].width);
  assert.ok(Object.keys(page0.frames).length < frames.length);
});

test('the estimate gives the frame size and sheet count before drawing, and the largest size on one sheet', async () => {
  const fs = await import('node:fs');
  const { readSkeletonBinary } = await import('../src/core/binary.js');
  const { readSkeletonJson } = await import('../src/core/interop.js');
  const { estimateSheet } = await import('../src/editor/spritesheet.js');
  const dir = new URL('../branding/rigbytron/export/', import.meta.url);
  const sk = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('rigbytron.skel', dir)))), 'rigbytron').skeleton;
  const names = sk.animations.map((a) => a.name);
  const big = estimateSheet(sk, names, { fps: 30, scale: 1, maxWidth: 2048 }, [0.25, 0.5, 1]);
  const small = estimateSheet(sk, names, { fps: 30, scale: 0.25, maxWidth: 2048 });
  assert.ok(big.frameWidth > 3 * small.frameWidth);
  assert.ok(big.sheets > 1);
  assert.ok(big.width <= 2048 && big.height <= 2048);
  assert.ok(big.fitsOne === null || big.fitsOne < 1);
  assert.equal(big.frames, small.frames);
});

test('frames the GPU draws empty are drawn again on the CPU', async () => {
  const fs = await import('node:fs');
  const { parseAtlas } = await import('../src/core/atlas.js');
  const { readSkeletonBinary } = await import('../src/core/binary.js');
  const { readSkeletonJson } = await import('../src/core/interop.js');
  const { atlasLookup } = await import('../src/core/draw.js');
  const { decodePng } = await import('../src/mcp/png.js');
  const { renderFrames } = await import('../src/editor/spritesheet.js');
  const dir = new URL('../branding/rigbytron/export/', import.meta.url);
  const sk = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('rigbytron.skel', dir)))), 'rigbytron').skeleton;
  const atlas = parseAtlas(fs.readFileSync(new URL('rigbytron.atlas', dir), 'utf8'));
  const lookup = atlasLookup(atlas, (page) => ({ ...decodePng(new Uint8Array(fs.readFileSync(new URL(page.name, dir)))), pma: page.pma }));
  let disposed = false;
  // A GPU whose readback is empty, as a lost WebGL context gives.
  const blank = (w, h) => ({ gpu: true, clear() {}, drawSkeleton() {}, resolve: () => new Uint8ClampedArray(w * h * 4), dispose: () => (disposed = true) });
  const r = renderFrames(sk, lookup, ['hold'], { fps: 5, scale: 0.05, renderer: blank });
  assert.equal(r.gpu, false);
  assert.match(r.gpuIssue, /empty/);
  assert.ok(disposed, 'the GPU renderer is released');
  assert.ok(r.frames.some((f) => f.rgba.some((v, i) => i % 4 === 3 && v > 0)), 'the CPU drew the frames');
});
