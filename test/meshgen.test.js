// SPDX-License-Identifier: MIT OR Apache-2.0
// Generate mesh from alpha (issue #23): outline tracing, exact point counts, coverage, islands.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coverage, generateMesh } from '../src/core/meshgen.js';

/** An alpha image from a predicate on pixel centres. */
function image(width, height, solid) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = solid(x + 0.5, y + 0.5) ? 255 : 0;
  return { width, height, data };
}

const circle = image(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 40);

test('a rectangle traces to its four corners', () => {
  const rect = image(40, 30, (x, y) => x > 10 && x < 30 && y > 5 && y < 25);
  const m = generateMesh(rect, { points: 4, expand: 0, smoothing: 0, interior: 'none' });
  assert.equal(m.hull, 4);
  const corners = m.points.map(([x, y]) => `${x},${y}`).sort();
  assert.deepEqual(corners, ['10,25', '10,5', '30,25', '30,5'].sort());
  assert.equal(m.triangles.length / 3, 2);
});

test('the outline has exactly the requested number of points and covers the art', () => {
  for (const points of [8, 24, 60]) {
    const m = generateMesh(circle, { points, expand: 2, interior: 'none' });
    assert.equal(m.hull, points);
    assert.equal(m.points.length, points);
    assert.ok(coverage(circle, m.points.slice(0, m.hull)) > (points >= 24 ? 0.995 : 0.97), `coverage with ${points} points`);
    // A simple outline triangulates into points - 2 triangles.
    assert.equal(m.triangles.length / 3, points - 2);
  }
});

test('more points than the outline needs are added along the longest edges', () => {
  const rect = image(20, 20, (x, y) => x > 4 && x < 16 && y > 4 && y < 16);
  const m = generateMesh(rect, { points: 12, expand: 0, smoothing: 0, interior: 'none' });
  assert.equal(m.hull, 12);
});

test('concave shapes stay concave', () => {
  const ell = image(60, 60, (x, y) => (x > 10 && x < 25 && y > 10 && y < 50) || (x > 10 && x < 50 && y > 35 && y < 50));
  const m = generateMesh(ell, { points: 12, expand: 0, smoothing: 0, interior: 'none' });
  const ring = m.points.slice(0, m.hull);
  assert.ok(coverage(ell, ring) > 0.99);
  // The empty corner of the L stays outside the mesh.
  const emptyCorner = image(60, 60, (x, y) => x > 30 && x < 48 && y > 12 && y < 30);
  assert.ok(coverage(emptyCorner, ring) < 0.02);
});

test('interior points fill the shape; triangles use every point', () => {
  const m = generateMesh(circle, { points: 24, interior: 'medium' });
  assert.ok(m.points.length > m.hull + 10, `${m.points.length - m.hull} interior points`);
  const used = new Set(m.triangles);
  assert.equal(used.size, m.points.length);
  assert.equal(m.triangles.length / 3, 2 * m.points.length - m.hull - 2);
  assert.equal(m.uvs.length, m.points.length * 2);
  for (const v of m.uvs) assert.ok(v >= -0.05 && v <= 1.05);
});

test('the largest island is used; others are counted', () => {
  const two = image(100, 50, (x, y) => Math.hypot(x - 25, y - 25) < 20 || Math.hypot(x - 80, y - 25) < 8);
  const m = generateMesh(two, { points: 16, interior: 'none' });
  assert.equal(m.islands, 2);
  const xs = m.points.map((p) => p[0]);
  assert.ok(Math.max(...xs) < 50, 'outline is around the big island');
});

test('expand grows the outline, a negative value shrinks it, and empty images give null', () => {
  const grown = generateMesh(circle, { points: 32, expand: 6, interior: 'none' });
  const shrunk = generateMesh(circle, { points: 32, expand: -6, interior: 'none' });
  const radius = (m) => Math.max(...m.points.map(([x, y]) => Math.hypot(x - 50, y - 50)));
  assert.ok(radius(grown) > 44 && radius(shrunk) < 36, `${radius(grown)} / ${radius(shrunk)}`);
  assert.equal(generateMesh(image(10, 10, () => false)), null);
});
