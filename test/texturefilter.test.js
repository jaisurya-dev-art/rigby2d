// SPDX-License-Identifier: MIT OR Apache-2.0
// Texture filtering for pixel art: the project setting, its atlas `filter` line, and the round trip
// through .rigby work files and skeleton imports.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { atlasFilter, parseAtlas, textureFilterOf, writeAtlas } from '../src/core/atlas.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import { openProject } from '../src/editor/io.js';

const exportDir = new URL('../branding/rigbytron/export/', import.meta.url);
const skeletonJson = readFileSync(new URL('rigbytron.json', exportDir), 'utf8');
const atlasText = readFileSync(new URL('rigbytron.atlas', exportDir), 'utf8');
const withFilter = (text, filter) => text.replace(/^filter:.*$/m, `filter: ${filter}`);

/** Opens rigbytron.json next to the given atlas text. Images are left out: they only add warnings. */
async function importWithAtlas(atlas) {
  const files = new Map([
    ['proj/rigbytron.json', skeletonJson],
    ['proj/rigbytron.atlas', atlas],
  ]);
  const fs = {
    readText: async (p) => {
      if (!files.has(p)) throw new Error(`no file ${p}`);
      return files.get(p);
    },
    readFile: async (p) => {
      throw new Error(`no file ${p}`);
    },
    list: async () => [...files.keys()].map((p) => p.split('/').pop()),
  };
  const images = { clear() {}, insert() {} };
  return (await openProject('proj/rigbytron.json', fs, images)).doc;
}

test('atlas filter lines for each project setting', () => {
  assert.deepEqual(atlasFilter('nearest'), ['Nearest', 'Nearest']);
  assert.deepEqual(atlasFilter('linear'), ['Linear', 'Linear']);
  const page = { name: 'hero.png', width: 64, height: 64, filter: atlasFilter('nearest'), regions: [] };
  assert.match(writeAtlas([page]), /^filter: Nearest, Nearest$/m);
});

test('reading the project setting from atlas pages', () => {
  const pages = (...filters) => filters.map((filter) => ({ filter }));
  assert.equal(textureFilterOf(pages(['Nearest', 'Nearest'])), 'nearest');
  assert.equal(textureFilterOf(pages(['MipMapNearestNearest', 'Nearest'])), 'linear', 'judged by the min filter, as the runtimes do');
  assert.equal(textureFilterOf(pages(['Linear', 'Linear'])), 'linear');
  assert.equal(textureFilterOf(pages(['Nearest', 'Nearest'], ['Linear', 'Linear'])), 'linear', 'mixed pages stay smooth');
  assert.equal(textureFilterOf([]), 'linear');
  // A page without a filter line is Nearest by the format's default.
  assert.equal(textureFilterOf(parseAtlas('hero.png\nsize: 64, 64\nhead\nbounds: 0, 0, 8, 8\n').pages), 'nearest');
});

test('the setting is saved in the work file only when not the default', () => {
  const doc = Skeleton.fromJson(readSkeletonJson(JSON.parse(skeletonJson), 'rigbytron').skeleton.toJson());
  assert.equal(doc.textureFilter, 'linear');
  assert.equal('textureFilter' in doc.toObject(), false, 'files saved before the option existed are unchanged');
  doc.textureFilter = 'nearest';
  const reopened = Skeleton.fromJson(doc.toJson());
  assert.equal(reopened.textureFilter, 'nearest');
  assert.equal(Skeleton.fromObject(JSON.parse(doc.toSnapshot())).textureFilter, 'nearest', 'undo snapshots keep it');
  assert.equal(Skeleton.fromObject({ ...doc.toObject(), textureFilter: 'bilinear' }).textureFilter, 'linear', 'unknown values fall back');
});

test('importing a skeleton takes the setting from its atlas', async () => {
  assert.match(atlasText, /^filter: Linear, Linear$/m);
  assert.equal((await importWithAtlas(atlasText)).textureFilter, 'linear');
  const pixel = await importWithAtlas(withFilter(atlasText, 'Nearest, Nearest'));
  assert.equal(pixel.textureFilter, 'nearest');
  // ...and exporting writes it back.
  assert.deepEqual(atlasFilter(pixel.textureFilter), ['Nearest', 'Nearest']);
});
