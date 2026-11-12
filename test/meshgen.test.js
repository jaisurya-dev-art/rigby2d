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

test('smoothing rounds pixel steps but keeps corners, so blocky shapes stay covered', () => {
  // A bar and a stem, like the top of a 5: long straight edges meeting at sharp corners.
  const five = image(120, 120, (x, y) => (x > 20 && x < 100 && y > 10 && y < 30) || (x > 20 && x < 40 && y > 10 && y < 90));
  for (const smoothing of [1, 3]) {
    const m = generateMesh(five, { points: 12, expand: 0, smoothing, interior: 'none' });
    const ring = m.points.slice(0, m.hull);
    assert.ok(coverage(five, ring) > 0.995, `coverage with smoothing ${smoothing}: ${coverage(five, ring)}`);
    assert.ok(Math.max(...ring.map((p) => p[0])) > 98, 'the bar keeps its far end');
  }
});

/** Share (0..1) of the image's solid pixels whose centre is inside a mesh triangle. */
function meshCoverage(img, m, solidWanted = true) {
  let total = 0;
  let hit = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((img.data[y * img.width + x] > 0) !== solidWanted) continue;
      total++;
      const p = [x + 0.5, y + 0.5];
      for (let t = 0; t < m.triangles.length; t += 3) {
        const [a, b, c] = [m.points[m.triangles[t]], m.points[m.triangles[t + 1]], m.points[m.triangles[t + 2]]];
        const s = (u, v) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
        const [d1, d2, d3] = [s(a, b), s(b, c), s(c, a)];
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) {
          hit++;
          break;
        }
      }
    }
  }
  return total ? hit / total : 1;
}

const ring = image(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 40 && Math.hypot(x - 50, y - 50) > 18);

test('holes: the inner contour is traced and the hole stays out of the mesh', () => {
  const filled = generateMesh(ring, { points: 32, interior: 'none' });
  assert.equal(filled.edges, null);
  const holed = generateMesh(ring, { points: 32, interior: 'none', holes: true });
  assert.equal(holed.outlines, 2);
  // Every outline edge is kept as a mesh edge (Spine's form: index pairs times 2).
  assert.equal(holed.edges.length, holed.points.length * 2);
  assert.ok(holed.edges.every((e) => e % 2 === 0));
  // The outline points are shared by the two outlines, by length.
  assert.equal(holed.points.length, 32);
  assert.ok(meshCoverage(ring, holed) > 0.995, 'the art is covered');
  const hole = image(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 14);
  assert.ok(meshCoverage(hole, holed) < 0.05, 'the hole is empty');
  assert.ok(meshCoverage(hole, filled) > 0.95, 'without holes, it is filled');
});

const pair = image(100, 50, (x, y) => Math.hypot(x - 25, y - 25) < 20 || Math.hypot(x - 75, y - 25) < 15);

test('islands: merge meshes every shape, split gives one mesh per shape', () => {
  const merged = generateMesh(pair, { points: 30, interior: 'low', islands: 'merge' });
  assert.equal(merged.outlines, 2);
  assert.ok(meshCoverage(pair, merged) > 0.99);
  // The gap between the shapes is not meshed.
  const gap = image(100, 50, (x, y) => x > 47 && x < 58 && y > 20 && y < 30);
  assert.ok(meshCoverage(gap, merged) < 0.05);
  const split = generateMesh(pair, { points: 20, interior: 'none', islands: 'split' });
  assert.equal(split.meshes.length, 2);
  for (const m of split.meshes) {
    assert.equal(m.hull, 20);
    assert.equal(m.edges, null);
  }
  // Biggest first.
  assert.ok(Math.max(...split.meshes[0].points.map((p) => p[0])) < 50);
  assert.ok(Math.min(...split.meshes[1].points.map((p) => p[0])) > 50);
});

test('specks are ignored when meshing every shape', () => {
  const dotted = image(100, 50, (x, y) => Math.hypot(x - 25, y - 25) < 20 || (x > 80 && x < 81.5 && y > 10 && y < 11.5));
  const m = generateMesh(dotted, { points: 16, expand: 0, interior: 'none', islands: 'split' });
  assert.equal(m.meshes, undefined);
  assert.equal(m.hull, 16);
});

test('locked vertices stay exactly where they are; the point count is for the rest', () => {
  const locked = [
    { x: 50, y: 7, outline: true },
    { x: 47.5, y: 52.25, outline: false },
  ];
  const m = generateMesh(circle, { points: 20, interior: 'low', locked });
  assert.equal(m.hull, 21);
  assert.deepEqual(m.points[m.locked[0]], [50, 7]);
  assert.ok(m.locked[0] < m.hull, 'the outline one is on the outline');
  assert.deepEqual(m.points[m.locked[1]], [47.5, 52.25]);
  assert.ok(m.locked[1] >= m.hull, 'the inside one stays inside');
  // No generated interior point crowds the locked one.
  const close = m.points.filter((p, i) => i !== m.locked[1] && i >= m.hull && Math.hypot(p[0] - 47.5, p[1] - 52.25) < 5);
  assert.equal(close.length, 0);
  assert.ok(new Set(m.triangles).size === m.points.length);
});

test('minimum angle adds interior points until triangles are not thin', () => {
  const minAngle = (m) => {
    let worst = 180;
    for (let t = 0; t < m.triangles.length; t += 3) {
      const v = [0, 1, 2].map((k) => m.points[m.triangles[t + k]]);
      for (let k = 0; k < 3; k++) {
        const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]];
        const u = [b[0] - a[0], b[1] - a[1]];
        const w = [c[0] - a[0], c[1] - a[1]];
        worst = Math.min(worst, (Math.acos((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))) * 180) / Math.PI);
      }
    }
    return worst;
  };
  const plain = generateMesh(circle, { points: 48, interior: 'medium' });
  const better = generateMesh(circle, { points: 48, interior: 'medium', minAngle: 25 });
  assert.equal(better.hull, plain.hull, 'the outline keeps its exact points');
  assert.ok(better.points.length > plain.points.length);
  assert.ok(minAngle(better) > minAngle(plain), `${minAngle(plain)} -> ${minAngle(better)}`);
  assert.ok(meshCoverage(circle, better) > 0.995);
});
