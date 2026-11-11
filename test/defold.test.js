// SPDX-License-Identifier: MIT OR Apache-2.0
// Defold game objects (src/editor/defold.js): the .go, script and preview picture written for an
// exported skeleton, checked on the Rigbytron export of the Defold demo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { parseAtlas } from '../src/core/atlas.js';
import { readSkeletonBinary } from '../src/core/binary.js';
import { atlasLookup } from '../src/core/draw.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { decodePng } from '../src/mcp/png.js';
import { defoldFiles, defoldFolderOf, previewAtlasText, scriptText, setupPicture } from '../src/editor/defold.js';

const assets = new URL('../runtimes/defold/assets/', import.meta.url);

function rigbytron() {
  const doc = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('rigbytron.skel', assets)))), 'rigbytron').skeleton;
  const atlas = parseAtlas(fs.readFileSync(new URL('rigbytron.atlas', assets), 'utf8'));
  const pages = new Map(atlas.pages.map((p) => [p.name, { ...decodePng(fs.readFileSync(new URL(p.name, assets))), pma: p.pma }]));
  return { doc, lookup: atlasLookup(atlas, (p) => pages.get(p.name)) };
}

test('a Defold game object: script, piece factory and a preview sprite over the skeleton', () => {
  const { doc, lookup } = rigbytron();
  const files = defoldFiles({ doc, lookup, name: 'rigbytron', folder: '/assets/', skeleton: 'rigbytron.skel', animation: 'hold' });
  assert.deepEqual(files.map((f) => f.path), ['rigbytron.go', 'rigbytron.script', 'rigbytron_preview.atlas', 'rigbytron_preview.png']);
  const go = files[0].text;
  assert.match(go, /component: "\/assets\/rigbytron.script"/);
  assert.match(go, /prototype: \\"\/rigby2d\/piece.go\\"/);
  assert.match(go, /id: "preview"\n {2}type: "sprite"/);
  assert.match(go, /default_animation: \\"rigbytron_preview\\"/);
  assert.match(go, /texture: \\"\/assets\/rigbytron_preview.atlas\\"/);
  const script = files[1].text;
  assert.match(script, /go.property\("animation", hash\("hold"\)\)/);
  assert.match(script, /skeleton = "\/assets\/rigbytron.skel"/);
  assert.match(script, /atlas = "\/assets\/rigbytron.atlas"/);
  assert.match(script, /preview = true/);
  assert.equal(files[2].text, previewAtlasText('/assets/rigbytron_preview.png'));
  const png = files[3].png;
  assert.ok(Math.max(png.width, png.height) <= 1024);
  assert.equal(png.rgba.length, png.width * png.height * 4);
});

test('the preview picture covers the setup pose, centred where the sprite sits', () => {
  const { doc, lookup } = rigbytron();
  const pic = setupPicture(doc, lookup, { maxSide: 256 });
  assert.equal(Math.max(pic.width, pic.height), 256);
  // Every drawn vertex lies inside the picture's world rectangle.
  const halfW = (pic.width * pic.scale) / 2;
  const halfH = (pic.height * pic.scale) / 2;
  for (const q of new Pose(doc).quads(doc)) {
    if (q.color[3] <= 0) continue;
    for (const [x, y] of q.positions) {
      assert.ok(Math.abs(x - pic.center[0]) <= halfW + 1e-6 && Math.abs(y - pic.center[1]) <= halfH + 1e-6, `${x}, ${y}`);
    }
  }
  // Something opaque was drawn, and the edges (the margin) are clear.
  let opaque = 0;
  for (let i = 3; i < pic.rgba.length; i += 4) if (pic.rgba[i] > 0) opaque++;
  assert.ok(opaque > 1000);
  for (let x = 0; x < pic.width; x++) assert.equal(pic.rgba[x * 4 + 3], 0);
  // Small skeletons are not enlarged.
  assert.equal(setupPicture(doc, lookup, { maxSide: 100000 }).scale, 1);
});

test('the active skin is left as it was', () => {
  const { doc, lookup } = rigbytron();
  doc.skin = null;
  setupPicture(doc, lookup, { skin: 'default' });
  assert.equal(doc.skin, null);
});

test('scripts escape their strings and say when there is no preview', () => {
  const text = scriptText({ name: 'a"b', skeleton: '/x/a"b.skel', atlas: '/x/a"b.atlas', preview: false });
  assert.match(text, /skeleton = "\/x\/a\\"b.skel"/);
  assert.match(text, /preview = false/);
});

test('the Defold folder of an export comes from the game.project above it', async () => {
  const projects = new Set(['D:/games/hero']);
  const has = async (root) => projects.has(root);
  assert.equal(await defoldFolderOf('D:\\games\\hero\\assets\\knight', has), '/assets/knight');
  assert.equal(await defoldFolderOf('D:/games/hero', has), '/');
  assert.equal(await defoldFolderOf('D:/elsewhere', has), null);
});
