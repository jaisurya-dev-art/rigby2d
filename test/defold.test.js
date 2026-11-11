// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D models for Defold (src/editor/defold.js): the files of a .rigbymodel component, and
// unpacking a packed atlas into its images, checked on the Rigbytron export of the Defold demo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { parseAtlas } from '../src/core/atlas.js';
import { isSkeletonBinary, readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { decodePng } from '../src/mcp/png.js';
import { usedImages } from '../src/editor/io.js';
import { defoldAtlasText, defoldFolderOf, defoldModelFiles, rigbyModelText, unpackAtlas } from '../src/editor/defold.js';

const assets = new URL('../runtimes/defold/assets/', import.meta.url);

function rigbytron() {
  const doc = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('rigbytron.skel', assets)))), 'rigbytron').skeleton;
  const atlas = parseAtlas(fs.readFileSync(new URL('rigbytron.atlas', assets), 'utf8'));
  const pages = new Map(atlas.pages.map((p) => [p.name, decodePng(fs.readFileSync(new URL(p.name, assets)))]));
  return { doc, atlas, pages };
}

test('a packed atlas unpacks into every image at its original size', () => {
  const { atlas, pages } = rigbytron();
  const images = unpackAtlas(atlas, pages);
  const regions = atlas.pages.flatMap((p) => p.regions);
  assert.equal(images.size, regions.length);
  for (const r of regions) {
    const img = images.get(r.name);
    assert.equal(img.width, r.originalWidth);
    assert.equal(img.height, r.originalHeight);
    let opaque = 0;
    for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 0) opaque++;
    assert.ok(opaque > img.width * img.height * 0.05, `${r.name} has its pixels`);
  }
});

test('a Rigby2D model: skeleton, Defold atlas named by image, component and game object', () => {
  const { doc, atlas, pages } = rigbytron();
  const all = unpackAtlas(atlas, pages);
  const images = new Map(usedImages(doc).map((n) => [n, all.get(n)]));
  const files = defoldModelFiles({ doc, images, name: 'hero', folder: '/assets/hero/', animation: 'hold' });
  const paths = files.map((f) => f.path);
  assert.deepEqual(paths.slice(0, 1), ['hero.rigbyskel']);
  assert.deepEqual(paths.slice(-3), ['hero.atlas', 'hero.rigbymodel', 'hero.go']);
  assert.equal(paths.filter((p) => p.startsWith('images/')).length, images.size);
  // The skeleton is a binary export the runtimes read back.
  const skel = files[0].bytes;
  assert.ok(isSkeletonBinary(skel));
  assert.equal(readSkeletonJson(readSkeletonBinary(skel), 'hero').skeleton.animations.length, doc.animations.length);
  // Atlas animation ids are the image names, so the runtime finds every image.
  const atlasText = files.find((f) => f.path === 'hero.atlas').text;
  for (const n of images.keys()) assert.match(atlasText, new RegExp(`id: "${n}"`));
  assert.match(atlasText, /image: "\/assets\/hero\/images\/head\.png"/);
  assert.equal(files.find((f) => f.path === 'hero.rigbymodel').text, 'skeleton: "/assets/hero/hero.rigbyskel"\natlas: "/assets/hero/hero.atlas"\ndefault_animation: "hold"\n');
  assert.match(files.find((f) => f.path === 'hero.go').text, /component: "\/assets\/hero\/hero\.rigbymodel"/);
});

test('image names with folders or symbols get safe, unique file names', () => {
  const pic = { width: 1, height: 1, rgba: new Uint8ClampedArray(4) };
  const doc = readSkeletonJson({ skeleton: { spine: '4.2.0' }, bones: [{ name: 'root' }], slots: [] }, 'x').skeleton;
  const images = new Map([['arm/left', pic], ['arm_left', pic], ['é"', pic]]);
  const files = defoldModelFiles({ doc, images, name: 'x', folder: '/x' });
  assert.deepEqual(files.filter((f) => f.path.startsWith('images/')).map((f) => f.path), ['images/arm_left.png', 'images/arm_left_2.png', 'images/image.png']);
  const atlasText = files.find((f) => f.path === 'x.atlas').text;
  assert.match(atlasText, /id: "arm\/left"/);
  assert.match(atlasText, /id: "é\\""/);
});

test('model and atlas text', () => {
  assert.equal(rigbyModelText({ skeleton: '/a.rigbyskel', atlas: '/a.atlas', skin: 'red', loop: false }), 'skeleton: "/a.rigbyskel"\natlas: "/a.atlas"\nskin: "red"\nloop: false\n');
  assert.match(defoldAtlasText([]), /^margin: 0\nextrude_borders: 2\ninner_padding: 0\n$/);
});

test('the Defold folder of an export comes from the game.project above it', async () => {
  const projects = new Set(['D:/games/hero']);
  const has = async (root) => projects.has(root);
  assert.equal(await defoldFolderOf('D:\\games\\hero\\assets\\knight', has), '/assets/knight');
  assert.equal(await defoldFolderOf('D:/games/hero', has), '/');
  assert.equal(await defoldFolderOf('D:/elsewhere', has), null);
});
