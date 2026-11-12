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
 * Constrained Delaunay triangulation of a shape made of closed rings (outlines and holes, any
 * number): `rings` are lists of point indices; the inside follows the even-odd rule, so a ring
 * inside another is a hole and a ring inside a hole is an island again. Every point is used and
 * every ring edge is kept. `minAngle` (degrees, 0 = off) adds points inside the shape until no
 * triangle has a smaller angle, at most `maxExtra` of them; ring edges are never split, so the
 * outlines keep their exact points. Returns { points (the input plus added ones), triangles }.
 */
export function triangulateRings(points, rings, { minAngle = 0, maxExtra = 0 } = {}) {
  const pts = points.map((p) => [p[0], p[1]]);
  const n0 = pts.length;
  rings = rings.filter((r) => r.length >= 3);
  if (!rings.length || n0 < 3) return { points: pts, triangles: [] };
  const constraint = new Set();
  const ckey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const r of rings) for (let i = 0; i < r.length; i++) constraint.add(ckey(r[i], r[(i + 1) % r.length]));
  const polys = rings.map((r) => r.map((i) => pts[i]));
  const insideShape = (p) => {
    let c = false;
    for (const poly of polys) if (pointInRing(p, poly)) c = !c;
    return c;
  };

  // Delaunay of every point (Bowyer-Watson) inside a large super triangle.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const span = Math.max(x1 - x0, y1 - y0, 1) * 50;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const s0 = pts.length;
  pts.push([cx - span, cy - span], [cx + span, cy - span], [cx, cy + span]);
  let tris = [[s0, s0 + 1, s0 + 2]];
  const ccwTri = (t) => (cross(pts[t[0]], pts[t[1]], pts[t[2]]) >= 0 ? t : [t[0], t[2], t[1]]);
  const inCircumcircle = (t, p) => {
    const [a, b, c] = t.map((i) => pts[i]);
    const [ax, ay] = [a[0] - p[0], a[1] - p[1]];
    const [bx, by] = [b[0] - p[0], b[1] - p[1]];
    const [cx2, cy2] = [c[0] - p[0], c[1] - p[1]];
    return (ax * ax + ay * ay) * (bx * cy2 - cx2 * by) - (bx * bx + by * by) * (ax * cy2 - cx2 * ay) + (cx2 * cx2 + cy2 * cy2) * (ax * by - bx * ay) > EPS;
  };
  /** Inserts point `pi`: removes the triangles whose circumcircle holds it (a connected cavity
   *  grown from `seed`, never across a constrained edge when `respect`) and fans the hole. */
  const insert = (pi, seed, respect) => {
    const p = pts[pi];
    const edgeTris = new Map();
    tris.forEach((t, k) => {
      for (let e = 0; e < 3; e++) {
        const key = ckey(t[e], t[(e + 1) % 3]);
        const list = edgeTris.get(key);
        if (list) list.push(k);
        else edgeTris.set(key, [k]);
      }
    });
    const bad = new Set([seed]);
    const stack = [seed];
    while (stack.length) {
      const k = stack.pop();
      const t = tris[k];
      for (let e = 0; e < 3; e++) {
        const key = ckey(t[e], t[(e + 1) % 3]);
        if (respect && constraint.has(key)) continue;
        for (const j of edgeTris.get(key)) {
          if (bad.has(j) || !inCircumcircle(tris[j], p)) continue;
          bad.add(j);
          stack.push(j);
        }
      }
    }
    // The cavity's boundary: edges of bad triangles not shared with another bad triangle.
    const boundary = [];
    for (const k of bad) {
      const t = tris[k];
      for (let e = 0; e < 3; e++) {
        const a = t[e];
        const b = t[(e + 1) % 3];
        if (edgeTris.get(ckey(a, b)).filter((j) => bad.has(j)).length === 1) boundary.push([a, b]);
      }
    }
    tris = tris.filter((_, k) => !bad.has(k));
    for (const [a, b] of boundary) if (Math.abs(cross(pts[a], pts[b], p)) > EPS) tris.push(ccwTri([a, b, pi]));
  };
  const locate = (p) => {
    let best = 0;
    let score = -Infinity;
    tris.forEach((t, k) => {
      const w = barycentric(p, pts[t[0]], pts[t[1]], pts[t[2]]);
      if (!w) return;
      const s = Math.min(...w);
      if (s > score) {
        score = s;
        best = k;
      }
    });
    return best;
  };
  for (let i = 0; i < n0; i++) insert(i, locate(pts[i]), false);

  // Recover ring edges the Delaunay triangulation crossed, by flipping (Sloan).
  const hasEdge = (a, b) => tris.some((t) => t.includes(a) && t.includes(b));
  const segmentsCross = (p1, p2, q1, q2) => cross(p1, p2, q1) * cross(p1, p2, q2) < -EPS && cross(q1, q2, p1) * cross(q1, q2, p2) < -EPS;
  for (const key of constraint) {
    const [a, b] = key.split(',').map(Number);
    for (let guard = 0; guard < 2000 && !hasEdge(a, b); guard++) {
      // An edge crossing a-b whose two triangles form a convex quad: flip it.
      let flipped = false;
      for (let i = 0; i < tris.length && !flipped; i++) {
        for (let e = 0; e < 3 && !flipped; e++) {
          const u = tris[i][e];
          const v = tris[i][(e + 1) % 3];
          if (u === a || u === b || v === a || v === b) continue;
          if (!segmentsCross(pts[a], pts[b], pts[u], pts[v])) continue;
          const j = tris.findIndex((t, k) => k !== i && t.includes(u) && t.includes(v));
          if (j < 0) continue;
          const c = tris[i].find((x) => x !== u && x !== v);
          const d = tris[j].find((x) => x !== u && x !== v);
          if (cross(pts[c], pts[d], pts[u]) * cross(pts[c], pts[d], pts[v]) >= 0) continue;
          tris[i] = ccwTri([c, d, u]);
          tris[j] = ccwTri([c, d, v]);
          flipped = true;
        }
      }
      if (!flipped) break;
    }
  }
  // Delaunay again away from the constraints.
  for (let pass = 0; pass < 50; pass++) {
    let flipped = false;
    for (let i = 0; i < tris.length; i++) {
      for (let e = 0; e < 3; e++) {
        const a = tris[i][e];
        const b = tris[i][(e + 1) % 3];
        if (constraint.has(ckey(a, b))) continue;
        const j = tris.findIndex((t, k) => k !== i && t.includes(a) && t.includes(b));
        if (j < 0) continue;
        const c = tris[i][(e + 2) % 3];
        const d = tris[j].find((v) => v !== a && v !== b);
        if (!inCircumcircle(tris[i], pts[d])) continue;
        if (cross(pts[c], pts[d], pts[a]) * cross(pts[c], pts[d], pts[b]) >= 0) continue;
        tris[i] = ccwTri([c, a, d]);
        tris[j] = ccwTri([c, d, b]);
        flipped = true;
      }
    }
    if (!flipped) break;
  }
  const centroid = (t) => [(pts[t[0]][0] + pts[t[1]][0] + pts[t[2]][0]) / 3, (pts[t[0]][1] + pts[t[1]][1] + pts[t[2]][1]) / 3];
  tris = tris.filter((t) => t.every((i) => i < s0) && insideShape(centroid(t)));

  // Quality: add circumcenters of the thinnest triangles (inside the shape, away from the rings).
  if (minAngle > 0 && maxExtra > 0) {
    const limit = (Math.min(minAngle, 33) * Math.PI) / 180;
    const angleOf = (t) => {
      const [a, b, c] = t.map((i) => pts[i]);
      const ang = (p, q, r) => {
        const u = [q[0] - p[0], q[1] - p[1]];
        const v = [r[0] - p[0], r[1] - p[1]];
        return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1))));
      };
      return Math.min(ang(a, b, c), ang(b, c, a), ang(c, a, b));
    };
    const segments = [...constraint].map((k) => k.split(',').map(Number));
    // Ring edges are never split, so a circumcenter close to one (for the triangle's size) would
    // only make another thin triangle against that edge: such triangles are left as they are.
    const encroaches = (p, radius) => segments.some(([a, b]) => distanceToSegment(p, pts[a], pts[b]) < radius * 0.5);
    const skip = new Set();
    let added = 0;
    for (let guard = 0; guard < maxExtra * 4 && added < maxExtra; guard++) {
      let worst = -1;
      let worstAngle = limit;
      tris.forEach((t, k) => {
        if (skip.has(t.join(','))) return;
        const a = angleOf(t);
        if (a < worstAngle) {
          worstAngle = a;
          worst = k;
        }
      });
      if (worst < 0) break;
      const t = tris[worst];
      const c = circumcenter(pts[t[0]], pts[t[1]], pts[t[2]]);
      const near = c && pts.slice(0, s0).concat(pts.slice(s0 + 3)).some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 1e-3);
      if (!c || near || !insideShape(c) || encroaches(c, Math.hypot(c[0] - pts[t[0]][0], c[1] - pts[t[0]][1]))) {
        skip.add(t.join(','));
        continue;
      }
      const seed = tris.findIndex((u) => {
        const w = barycentric(c, pts[u[0]], pts[u[1]], pts[u[2]]);
        return w && w[0] >= -EPS && w[1] >= -EPS && w[2] >= -EPS;
      });
      if (seed < 0) {
        skip.add(t.join(','));
        continue;
      }
      pts.push(c);
      insert(pts.length - 1, seed, true);
      added++;
    }
  }
  // Drop the super triangle's points (added points come after them, so shift those down).
  const out = pts.slice(0, s0).concat(pts.slice(s0 + 3));
  const remap = (i) => (i < s0 ? i : i - 3);
  return { points: out, triangles: tris.flatMap((t) => ccwTri(t).map(remap)) };
}

function pointInRing(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function circumcenter(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < EPS) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

/** Ring edges as a mesh's `edges` (Spine's form: vertex index pairs, each index times 2). */
export function ringEdges(rings) {
  const out = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) out.push(r[i] * 2, r[(i + 1) % r.length] * 2);
  return out;
}

/** The closed rings in a mesh's `edges` (vertices with two ring edges, followed around). */
export function edgeRings(edges, count) {
  if (!edges?.length) return [];
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const a = edges[i] / 2;
    const b = edges[i + 1] / 2;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a >= count || b >= count || a === b) continue;
    link(a, b);
    link(b, a);
  }
  const seen = new Set();
  const rings = [];
  for (const start of adj.keys()) {
    if (seen.has(start) || adj.get(start).length !== 2) continue;
    const ring = [start];
    seen.add(start);
    let prev = start;
    let cur = adj.get(start)[0];
    while (cur !== start && !seen.has(cur) && adj.get(cur)?.length === 2) {
      ring.push(cur);
      seen.add(cur);
      const next = adj.get(cur).find((v) => v !== prev);
      prev = cur;
      cur = next;
    }
    if (cur === start && ring.length >= 3) rings.push(ring);
  }
  return rings;
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
