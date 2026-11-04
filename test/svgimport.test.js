// SPDX-License-Identifier: MIT OR Apache-2.0
// SVG import (svgimport.js): the drawing's size from its units and viewBox, and layer names as
// Inkscape and Affinity write them. Drawing the layers needs a browser and is checked there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { layerLabel, svgSize } from '../src/editor/svgimport.js';

test('the drawing size follows its units, falling back to the viewBox', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  const mm = svgSize({ width: '80mm', height: '120mm', viewBox: '0 0 80 120' });
  near(mm.width, (80 * 96) / 25.4);
  near(mm.height, (120 * 96) / 25.4);
  assert.deepEqual(mm.viewBox, [0, 0, 80, 120]);
  // Affinity writes 100% width and height: the viewBox gives the size.
  assert.deepEqual(svgSize({ width: '100%', height: '100%', viewBox: '0 0 300 400' }), { width: 300, height: 400, viewBox: [0, 0, 300, 400] });
  // One side given: the other keeps the viewBox's proportions.
  assert.equal(svgSize({ width: '600', viewBox: '0,0,300,400' }).height, 800);
  assert.equal(svgSize({ width: '2in', height: '1in' }).width, 192);
  assert.deepEqual(svgSize({ width: '2in', height: '1in' }).viewBox, [0, 0, 192, 96]);
  assert.equal(svgSize({}), null);
  assert.equal(svgSize({ viewBox: '0 0 0 10' }), null);
});

test('layer names: Inkscape labels, Affinity names, meaningful ids, then numbers', () => {
  assert.equal(layerLabel({ label: 'arm left', id: 'layer3' }), 'arm left');
  assert.equal(layerLabel({ serif: 'Ear L', id: 'Ear-L' }), 'Ear L');
  assert.equal(layerLabel({ id: 'Head' }), 'Head');
  // Generated ids are not names.
  assert.equal(layerLabel({ id: 'g1234' }, 2), 'layer 3');
  assert.equal(layerLabel({ id: 'layer7' }, 0), 'layer 1');
  assert.equal(layerLabel({ id: '_x31_' }, 4), 'layer 5');
  assert.equal(layerLabel({ label: '  ' }, 1), 'layer 2');
});

test('the sample drawings are valid SVG with layers to find', () => {
  const ink = fs.readFileSync(new URL('./fixtures/svg/inkscape-character.svg', import.meta.url), 'utf8');
  const aff = fs.readFileSync(new URL('./fixtures/svg/affinity-character.svg', import.meta.url), 'utf8');
  assert.equal((ink.match(/inkscape:groupmode="layer"/g) ?? []).length, 7);
  assert.equal((aff.match(/serif:id=/g) ?? []).length, 5);
});
