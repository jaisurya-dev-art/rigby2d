// SPDX-License-Identifier: MIT OR Apache-2.0
// Mesh geometry for authoring: triangulating a hull polygon with interior points, mapping points
// to texture coordinates, and computing or painting bone weights. Points are [x, y] pairs.

const EPS = 1e-9;

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function polygonArea(points, count) {
  let a = 0;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    const q = points[(i + 1) % count];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Barycentric coordinates of p in triangle abc (null for a degenerate triangle). */
export function barycentric(p, a, b, c) {
  const d = cross(a, b, c);
  if (Math.abs(d) < EPS) return null;
  const u = cross(p, b, c) / d;
  const v = cross(a, p, c) / d;
  return [u, v, 1 - u - v];
}

/**
 * Triangulates a mesh: points[0..hull) are the outline in order, the rest are interior points.
 * The outline is ear-clipped, interior points split the triangle they fall in, then edges are
 * flipped toward a Delaunay triangulation (outline edges are kept). Every point is used, so a
 * simple outline gives 2 x points - hull - 2 triangles. Returns a flat index array.
 */
export function triangulateMesh(points, hull) {
  if (hull < 3) return [];
  // Work with a counter-clockwise outline.
  const ccw = polygonArea(points, hull) > 0;
  const ring = [];
  for (let i = 0; i < hull; i++) ring.push(ccw ? i : hull - 1 - i);
  const tris = [];
  let guard = 0;
  while (ring.length > 3 && guard++ < 100000) {
    let clipped = false;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[(k + ring.length - 1) % ring.length];
      const b = ring[k];
      const c = ring[(k + 1) % ring.length];
      if (cross(points[a], points[b], points[c]) <= EPS) continue;
      const blocked = ring.some((q) => {
        if (q === a || q === b || q === c) return false;
        const w = barycentric(points[q], points[a], points[b], points[c]);
        return w && w[0] >= -EPS && w[1] >= -EPS && w[2] >= -EPS;
      });
      if (blocked) continue;
      tris.push([a, b, c]);
      ring.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate or self-intersecting outline: clip the first corner anyway.
      tris.push([ring[ring.length - 1], ring[0], ring[1]]);
      ring.splice(0, 1);
    }
  }
  if (ring.length === 3) tris.push([ring[0], ring[1], ring[2]]);

  // Interior points split the triangle that contains them (or the nearest one).
  for (let i = hull; i < points.length; i++) {
    const p = points[i];
    let best = -1;
    let bestScore = -Infinity;
    tris.forEach((t, k) => {
      const w = barycentric(p, points[t[0]], points[t[1]], points[t[2]]);
      if (!w) return;
      const score = Math.min(...w);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    });
    if (best < 0) continue;
    const [a, b, c] = tris[best];
    tris.splice(best, 1, [a, b, i], [b, c, i], [c, a, i]);
  }

  // Lawson flips toward Delaunay, never across outline edges.
  const isHullEdge = (a, b) => a < hull && b < hull && (Math.abs(a - b) === 1 || Math.abs(a - b) === hull - 1);
  const inCircle = (a, b, c, d) => {
    const [ax, ay] = [a[0] - d[0], a[1] - d[1]];
    const [bx, by] = [b[0] - d[0], b[1] - d[1]];
    const [cx, cy] = [c[0] - d[0], c[1] - d[1]];
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay) > EPS;
  };
  for (let pass = 0; pass < 50; pass++) {
    let flipped = false;
    for (let i = 0; i < tris.length; i++) {
      for (let e = 0; e < 3; e++) {
        const a = tris[i][e];
        const b = tris[i][(e + 1) % 3];
        const c = tris[i][(e + 2) % 3];
        if (isHullEdge(a, b)) continue;
        const j = tris.findIndex((t, k) => k !== i && t.includes(a) && t.includes(b));
        if (j < 0) continue;
        const d = tris[j].find((v) => v !== a && v !== b);
        // Orient abc counter-clockwise for the in-circle test.
        const [pa, pb, pc] = cross(points[a], points[b], points[c]) > 0 ? [a, b, c] : [b, a, c];
        if (!inCircle(points[pa], points[pb], points[pc], points[d])) continue;
        // Flip only when the quad a-c-b-d is convex (both new triangles keep positive area).
        if (cross(points[c], points[d], points[a]) * cross(points[c], points[d], points[b]) >= 0) continue;
        tris[i] = [c, a, d];
        tris[j] = [c, d, b];
        flipped = true;
      }
    }
    if (!flipped) break;
  }
  // Consistent counter-clockwise winding.
  return tris.flatMap((t) => (cross(points[t[0]], points[t[1]], points[t[2]]) >= 0 ? t : [t[0], t[2], t[1]]));
}

/**
 * Texture coordinates for point p from an existing triangle mesh (points, uvs, triangles): the
 * containing triangle's mapping, or the nearest triangle's extrapolated outside the mesh.
 */
export function uvAt(p, points, uvs, triangles) {
  let best = null;
  let bestScore = -Infinity;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const w = barycentric(p, points[a], points[b], points[c]);
    if (!w) continue;
    const score = Math.min(...w);
    if (score > bestScore) {
      bestScore = score;
      best = [w, a, b, c];
    }
  }
  if (!best) return [0, 0];
  const [w, a, b, c] = best;
  return [0, 1].map((k) => w[0] * uvs[a][k] + w[1] * uvs[b][k] + w[2] * uvs[c][k]);
}

/** Weights at p interpolated from the containing triangle: [{ bone, weight }]. */
export function weightsAt(p, points, weights, triangles) {
  let best = null;
  let bestScore = -Infinity;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const w = barycentric(p, points[tri[0]], points[tri[1]], points[tri[2]]);
    if (!w) continue;
    const score = Math.min(...w);
    if (score > bestScore) {
      bestScore = score;
      best = [w, tri];
    }
  }
  if (!best) return [];
  const sum = new Map();
  best[1].forEach((v, k) => {
    for (const { bone, weight } of weights[v]) sum.set(bone, (sum.get(bone) ?? 0) + Math.max(0, best[0][k]) * weight);
  });
  return normalizeWeights([...sum].map(([bone, weight]) => ({ bone, weight })));
}

/** Keeps the 4 largest weights above a small threshold, scaled to sum to 1. */
export function normalizeWeights(list, max = 4, { keepOrder = false } = {}) {
  let kept = list
    .filter((w) => w.weight > 1e-3)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
  // keepOrder: the strongest `max` influences, but in the order they came (deform keys hold one
  // offset per influence in that order, so reordering would make them wrong).
  if (keepOrder) kept = list.filter((w) => kept.includes(w));
  const total = kept.reduce((s, w) => s + w.weight, 0);
  if (total <= 0) return list.length ? [{ bone: list[0].bone, weight: 1 }] : [];
  return kept.map((w) => ({ bone: w.bone, weight: w.weight / total }));
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > EPS ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/**
 * Automatic weights: each point is weighted to the bones (given as world segments
 * { bone, from, to }) by inverse distance to the bone, sharpened so the nearest bone dominates.
 */
export function autoWeights(points, bones) {
  return points.map((p) => {
    const raw = bones.map(({ bone, from, to }) => ({ bone, weight: 1 / Math.pow(distanceToSegment(p, from, to) + 1, 4) }));
    // Relative weights first: far from every bone the raw values are tiny, and dropping small
    // weights before scaling would hand the vertex to the first bone instead of the nearest.
    const total = raw.reduce((s, w) => s + w.weight, 0);
    return normalizeWeights(total > 0 ? raw.map((w) => ({ bone: w.bone, weight: w.weight / total })) : raw);
  });
}

/**
 * Paints weight for `bone` around world point `center`: vertices within `radius` move toward 1
 * (add) or 0 (subtract) by `strength` scaled by a smooth falloff; the other bones of each touched
 * vertex share the rest. Returns the indices changed.
 */
export function paintWeights(points, weights, bone, center, radius, strength, subtract = false) {
  const changed = [];
  points.forEach((p, i) => {
    const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
    if (d > radius) return;
    const x = 1 - d / radius;
    const amount = Math.min(1, strength * x * x * (3 - 2 * x));
    const list = weights[i];
    const own = list.find((w) => w.bone === bone)?.weight ?? 0;
    const target = subtract ? own * (1 - amount) : own + (1 - own) * amount;
    const others = list.filter((w) => w.bone !== bone);
    const rest = others.reduce((s, w) => s + w.weight, 0);
    if (subtract && rest <= 0) return; // nothing to give the weight to
    // Each vertex keeps its bones in their order (a new bone goes last), so painting weights
    // doesn't invalidate deform keys (#36).
    const scale = (w) => (rest > 0 ? (w.weight / rest) * (1 - target) : 0);
    const next = list.map((w) => ({ bone: w.bone, weight: w.bone === bone ? target : scale(w) }));
    if (!list.some((w) => w.bone === bone) && target > 0) next.push({ bone, weight: target });
    weights[i] = normalizeWeights(next, 4, { keepOrder: true });
    changed.push(i);
  });
  return changed;
}

/**
 * What a mesh's deform keys depend on: the vertex count, and for a weighted mesh each vertex's
 * bones in order (a weighted deform key holds one offset per bone influence). Weight values,
 * vertex positions and triangles can change without making the keys wrong.
 */
export function deformLayout(att) {
  if (att.weights) return `w:${att.weights.map((v) => v.map((w) => w.bone).join(',')).join('|')}`;
  return `v:${(att.vertices?.length ?? 0) / 2}`;
}
