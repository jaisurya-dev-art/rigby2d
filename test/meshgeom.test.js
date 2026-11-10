import assert from 'node:assert/strict';
import { test } from 'node:test';

import { autoWeights, deformLayout, paintWeights, triangulateMesh, uvAt, weightsAt } from '../src/core/meshgeom.js';

const area = (pts, t) => {
  let a = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [p, q, r] = [pts[t[i]], pts[t[i + 1]], pts[t[i + 2]]];
    a += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
  }
  return a;
};

test('triangulation covers the outline, uses every point and has 2n - h - 2 triangles', () => {
  // Concave L outline (clockwise) with two interior points.
  const pts = [[0, 0], [0, 20], [10, 20], [10, 10], [20, 10], [20, 0], [5, 5], [5, 15]];
  const tris = triangulateMesh(pts, 6);
  assert.equal(tris.length / 3, 2 * pts.length - 6 - 2);
  assert.ok(Math.abs(area(pts, tris) - 300) < 1e-6, 'covers the L exactly, counter-clockwise');
  for (let i = 0; i < pts.length; i++) assert.ok(tris.includes(i), `uses point ${i}`);
});

test('UVs and weights interpolate inside the mesh', () => {
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const tris = triangulateMesh(pts, 4);
  assert.deepEqual(uvAt([5, 5], pts, uvs, tris).map((v) => +v.toFixed(6)), [0.5, 0.5]);
  assert.deepEqual(uvAt([15, 5], pts, uvs, tris).map((v) => +v.toFixed(6)), [1.5, 0.5]); // extrapolated
  const weights = [[{ bone: 1, weight: 1 }], [{ bone: 2, weight: 1 }], [{ bone: 2, weight: 1 }], [{ bone: 1, weight: 1 }]];
  const w = weightsAt([5, 5], pts, weights, tris);
  assert.deepEqual(w.map((x) => [x.bone, +x.weight.toFixed(3)]).sort(), [[1, 0.5], [2, 0.5]]);
});

test('automatic weights follow the nearest bone; painting adds and removes weight', () => {
  const pts = [[0, 0], [100, 0]];
  const bones = [
    { bone: 1, from: [0, -10], to: [0, 10] },
    { bone: 2, from: [100, -10], to: [100, 10] },
  ];
  const w = autoWeights(pts, bones);
  assert.equal(w[0][0].bone, 1);
  assert.ok(w[0][0].weight > 0.99);
  const changed = paintWeights(pts, w, 2, [0, 0], 20, 0.5);
  assert.deepEqual(changed, [0]);
  const two = w[0].find((x) => x.bone === 2).weight;
  assert.ok(two > 0.4 && two < 0.6, String(two));
  assert.ok(Math.abs(w[0].reduce((s, x) => s + x.weight, 0) - 1) < 1e-9);
  paintWeights(pts, w, 2, [0, 0], 20, 1, true);
  assert.ok(!w[0].some((x) => x.bone === 2));
});

// Issue #36: painting weights cleared a mesh's deform keys even though they still fit it.
test('deform keys only depend on the vertices and their bones, not on weight values', () => {
  const v = (bone, weight) => ({ bone, x: 10, y: 5, weight });
  const mesh = { weights: [[v(1, 0.6), v(2, 0.4)], [v(1, 1)], [v(2, 0.5), v(3, 0.5)]] };
  const layout = deformLayout(mesh);
  // Strengthening a vertex's main bone (same bones, same order): the keys still fit.
  const painted = { weights: [[v(1, 0.7), v(2, 0.3)], [v(1, 1)], [v(2, 0.5), v(3, 0.5)]] };
  assert.equal(deformLayout(painted), layout);
  // Moved vertices keep their keys too (deform offsets are per influence).
  assert.equal(deformLayout({ weights: mesh.weights.map((w) => w.map((i) => ({ ...i, x: i.x + 3 }))) }), layout);
  // A vertex gaining or losing a bone, bones reordered, or a vertex added: the keys no longer fit.
  assert.notEqual(deformLayout({ weights: [[v(1, 0.6), v(2, 0.3), v(4, 0.1)], [v(1, 1)], [v(2, 0.5), v(3, 0.5)]] }), layout);
  assert.notEqual(deformLayout({ weights: [[v(2, 0.4), v(1, 0.6)], [v(1, 1)], [v(2, 0.5), v(3, 0.5)]] }), layout);
  assert.notEqual(deformLayout({ weights: [...mesh.weights, [v(1, 1)]] }), layout);
  // Unweighted meshes: only the vertex count matters; binding or unbinding changes the layout.
  assert.equal(deformLayout({ vertices: [0, 0, 1, 0, 1, 1] }), deformLayout({ vertices: [5, 5, 6, 0, 1, 9] }));
  assert.notEqual(deformLayout({ vertices: [0, 0, 1, 0, 1, 1] }), deformLayout({ vertices: [0, 0, 1, 0] }));
  assert.notEqual(deformLayout({ vertices: [0, 0, 1, 0, 1, 1] }), deformLayout({ weights: [[v(1, 1)], [v(1, 1)], [v(1, 1)]] }));
});

test("painting keeps each vertex's bones in their order, so deform keys survive (#36)", () => {
  const points = [[0, 0], [100, 0]];
  const weights = [
    [
      { bone: 1, weight: 0.6 },
      { bone: 2, weight: 0.4 },
    ],
    [
      { bone: 2, weight: 0.7 },
      { bone: 1, weight: 0.3 },
    ],
  ];
  const before = deformLayout({ weights });
  // Strengthen bone 1 on the first vertex (its main bone), then bone 1 on the second until it leads.
  paintWeights(points, weights, 1, [0, 0], 10, 0.3);
  paintWeights(points, weights, 1, [100, 0], 10, 0.9);
  assert.ok(weights[0][0].weight > 0.6 && weights[1][1].weight > weights[1][0].weight, 'the weights changed');
  assert.equal(deformLayout({ weights }), before, 'same bones, same order');
  // Painting a bone a vertex didn't have adds it last (a layout change, as it must be).
  paintWeights(points, weights, 3, [0, 0], 10, 0.5);
  assert.deepEqual(weights[0].map((w) => w.bone), [1, 2, 3]);
});
