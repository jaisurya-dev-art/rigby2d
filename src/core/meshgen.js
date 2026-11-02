// SPDX-License-Identifier: MIT OR Apache-2.0
// Generate a mesh from an image's alpha (issue #23): threshold the alpha, grow or shrink the shape,
// trace its outline, smooth it, simplify it to an exact number of points (Visvalingam-Whyatt),
// optionally add interior points, and triangulate. Works in image pixels; the caller maps the
// result onto its attachment.

import { triangulateMesh } from './meshgeom.js';

export const MESH_DEFAULTS = Object.freeze({ points: 24, threshold: 32, expand: 2, smoothing: 1, interior: 'low' });
/** Interior points per density: roughly this many cells across the shape's area. */
const DENSITY = { none: 0, low: 8, medium: 20, high: 45 };

/**
 * Generates a mesh from `alpha` ({ width, height, data: one byte per pixel }). Options: points
 * (outline vertices, 3 or more), threshold (alpha 0-255 counted as solid), expand (pixels, negative
 * shrinks), smoothing (passes), interior ('none' | 'low' | 'medium' | 'high'). Returns
 * { points ([x, y] image pixels, outline first), hull, uvs (flat, 0..1), triangles (flat),
 * islands (shapes found), area (solid pixels used) }, or null when nothing is solid.
 */
export function generateMesh(alpha, options = {}) {
  const o = { ...MESH_DEFAULTS, ...options };
  const { width: W, height: H } = alpha;
  let mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = alpha.data[i] >= Math.max(1, o.threshold) ? 1 : 0;
  // Grow or shrink by whole pixels (a padded grid, so growth past the image edge is kept).
  const pad = Math.max(0, Math.ceil(o.expand)) + 1;
  const GW = W + 2 * pad;
  const GH = H + 2 * pad;
  let grid = new Uint8Array(GW * GH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[(y + pad) * GW + x + pad] = mask[y * W + x];
  const steps = Math.round(Math.abs(o.expand));
  for (let s = 0; s < steps; s++) grid = morph(grid, GW, GH, o.expand > 0);

  const { label, count, sizes } = components(grid, GW, GH);
  if (!count) return null;
  let best = 1;
  for (let k = 2; k <= count; k++) if (sizes[k] > sizes[best]) best = k;
  let outline = trace(label, best, GW, GH);
  if (outline.length < 3) return null;
  // Smoothing rounds off pixel steps only: on a 1 px resampling, a pass moves points by under a
  // pixel, so corners stay where they are (on the corners-only ring it would cut them off).
  if (o.smoothing > 0) outline = resample(outline, 1);
  for (let s = 0; s < o.smoothing; s++) outline = smooth(outline);
  const target = Math.max(3, Math.round(o.points));
  // Fewer points than the outline has: simplify, then push edges out so the art stays inside.
  let ring = outline.length > target ? contain(outline, simplify(outline, target)) : refine(outline, target);
  // Back to image pixels (the grid was padded); clockwise in image space, like a drawn outline.
  ring = ring.map(([x, y]) => [x - pad, y - pad]);
  if (signedArea(ring) < 0) ring.reverse();

  const interior = interiorPoints(ring, sizes[best], DENSITY[o.interior] ?? 0);
  const points = [...ring, ...interior];
  const hull = ring.length;
  const triangles = triangulateMesh(points, hull);
  const uvs = points.flatMap(([x, y]) => [x / W, y / H]);
  return { points, hull, uvs, triangles, islands: count, area: sizes[best] };
}

/** One pass of dilation (grow) or erosion (shrink) with a 3x3 cross. */
function morph(g, W, H, grow) {
  const out = new Uint8Array(g.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = [g[i], x > 0 ? g[i - 1] : 0, x < W - 1 ? g[i + 1] : 0, y > 0 ? g[i - W] : 0, y < H - 1 ? g[i + W] : 0];
      out[i] = grow ? (n.some(Boolean) ? 1 : 0) : n.every(Boolean) ? 1 : 0;
    }
  }
  return out;
}

/** 8-connected components: { label (per pixel, 0 = empty), count, sizes (by label) }. */
function components(g, W, H) {
  const label = new Int32Array(g.length);
  const sizes = [0];
  let count = 0;
  const stack = [];
  for (let s = 0; s < g.length; s++) {
    if (!g[s] || label[s]) continue;
    count++;
    let size = 0;
    label[s] = count;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (g[j] && !label[j]) {
            label[j] = count;
            stack.push(j);
          }
        }
      }
    }
    sizes.push(size);
  }
  return { label, count, sizes };
}

/**
 * The outer boundary of component `k` along pixel edges (corner coordinates), as a closed ring
 * without collinear runs. Every edge between a pixel of `k` and anything else is directed with the
 * pixel on its right (clockwise on screen); the ring follows them from the top edge of the
 * component's top-left pixel, which is always on the outside. Where two edges leave one corner
 * (pixels touching only diagonally) it takes the leftmost turn, keeping them in one outline.
 */
function trace(label, k, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] === k;
  const key = (x, y) => y * (W + 1) + x;
  const out = new Map(); // corner -> outgoing edge directions
  const add = (x, y, d) => {
    const c = key(x, y);
    const list = out.get(c);
    if (list) list.push(d);
    else out.set(c, [d]);
  };
  let start = null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (!start) start = [x, y];
      if (!inside(x, y - 1)) add(x, y, 0); // top edge, going right
      if (!inside(x + 1, y)) add(x + 1, y, 1); // right edge, going down
      if (!inside(x, y + 1)) add(x + 1, y + 1, 2); // bottom edge, going left
      if (!inside(x - 1, y)) add(x, y + 1, 3); // left edge, going up
    }
  }
  if (!start) return [];
  // Directions: 0 right, 1 down, 2 left, 3 up (screen space).
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  let [x, y] = start;
  let d = 0;
  const pts = [];
  const limit = 4 * label.length + 8;
  for (let n = 0; n < limit; n++) {
    pts.push([x, y]);
    x += DX[d];
    y += DY[d];
    if (x === start[0] && y === start[1]) break;
    const options = out.get(key(x, y)) ?? [];
    // Prefer turning left (d + 3), then straight on, then right (d + 1).
    d = [(d + 3) % 4, d, (d + 1) % 4].find((c) => options.includes(c)) ?? (d + 2) % 4;
  }
  // Drop points in the middle of straight runs.
  const ring = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) ring.push(b);
  }
  return ring;
}

/** The ring with points added so that no edge is longer than `step` pixels. */
function resample(ring, step) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** One smoothing pass: each point moves halfway toward the average of its neighbours. */
function smooth(ring) {
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n];
    const c = ring[(i + 1) % n];
    return [p[0] * 0.5 + (a[0] + c[0]) * 0.25, p[1] * 0.5 + (a[1] + c[1]) * 0.25];
  });
}

/** Visvalingam-Whyatt: removes the point with the smallest triangle until `target` remain. */
function simplify(ring, target) {
  const n = ring.length;
  const prev = new Int32Array(n).map((_, i) => (i + n - 1) % n);
  const next = new Int32Array(n).map((_, i) => (i + 1) % n);
  const alive = new Uint8Array(n).fill(1);
  const area = (i) => Math.abs(triArea(ring[prev[i]], ring[i], ring[next[i]]));
  const cost = new Float64Array(n).map((_, i) => area(i));
  let left = n;
  // A simple scan per removal is fast enough for outlines of a few thousand points.
  while (left > target) {
    let best = -1;
    for (let i = 0; i < n; i++) if (alive[i] && (best < 0 || cost[i] < cost[best])) best = i;
    alive[best] = 0;
    left--;
    const a = prev[best];
    const c = next[best];
    next[a] = c;
    prev[c] = a;
    cost[a] = area(a);
    cost[c] = area(c);
  }
  const out = [];
  let i = alive.findIndex(Boolean);
  for (let k = 0; k < left; k++, i = next[i]) out.push(i);
  return out; // indices into `ring`, in order
}

/**
 * The simplified ring (`kept`: indices into `outline`) with every edge moved outward past the
 * outline points it skipped, and corners where neighbouring moved edges meet. The outline runs
 * clockwise on screen, so outward is the left of each edge.
 */
function contain(outline, kept) {
  const n = kept.length;
  const N = outline.length;
  const lines = [];
  for (let k = 0; k < n; k++) {
    const ia = kept[k];
    const ib = kept[(k + 1) % n];
    const a = outline[ia];
    const b = outline[ib];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / len;
    const ny = -(b[0] - a[0]) / len;
    let dev = 0;
    for (let i = ia; i !== ib; i = (i + 1) % N) dev = Math.max(dev, (outline[i][0] - a[0]) * nx + (outline[i][1] - a[1]) * ny);
    lines.push({ a: [a[0] + nx * dev, a[1] + ny * dev], d: [b[0] - a[0], b[1] - a[1]], dev });
  }
  return kept.map((idx, k) => {
    const p = lines[(k + n - 1) % n];
    const q = lines[k];
    const o = outline[idx];
    const den = p.d[0] * q.d[1] - p.d[1] * q.d[0];
    const limit = 3 * Math.max(p.dev, q.dev) + 1;
    if (Math.abs(den) > 1e-9) {
      const t = ((q.a[0] - p.a[0]) * q.d[1] - (q.a[1] - p.a[1]) * q.d[0]) / den;
      const x = p.a[0] + p.d[0] * t;
      const y = p.a[1] + p.d[1] * t;
      if (Math.hypot(x - o[0], y - o[1]) <= limit) return [x, y];
    }
    // Nearly parallel edges or a very sharp corner: move the corner out by the larger push.
    const dx = q.a[0] - outline[idx][0] + (p.a[0] + p.d[0] - o[0]);
    const dy = q.a[1] - outline[idx][1] + (p.a[1] + p.d[1] - o[1]);
    const m = Math.hypot(dx, dy) || 1;
    const push = Math.max(p.dev, q.dev);
    return [o[0] + (dx / m) * push, o[1] + (dy / m) * push];
  });
}

/** Adds points to the longest edges until the ring has `target` points. */
function refine(ring, target) {
  const out = ring.slice();
  while (out.length < target) {
    let best = 0;
    let len = -1;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > len) {
        len = l;
        best = i;
      }
    }
    const a = out[best];
    const b = out[(best + 1) % out.length];
    out.splice(best + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/** Interior points on a staggered grid inside the outline, kept clear of its edges. */
function interiorPoints(ring, area, cells) {
  if (!cells) return [];
  const step = Math.sqrt(area / cells);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const out = [];
  let row = 0;
  for (let y = y0 + step / 2; y < y1; y += step * 0.866, row++) {
    for (let x = x0 + step / 2 + (row % 2 ? step / 2 : 0); x < x1; x += step) {
      if (inside(ring, x, y) && edgeDistance(ring, x, y) > step * 0.45) out.push([x, y]);
    }
  }
  return out;
}

function inside(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function edgeDistance(ring, x, y) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

const triArea = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    s += ax * by - bx * ay;
  }
  return s / 2;
}

/** Share (0..1) of the solid pixels (alpha >= threshold) inside the outline: how well it covers the art. */
export function coverage(alpha, ring, threshold = MESH_DEFAULTS.threshold) {
  let solid = 0;
  let covered = 0;
  for (let y = 0; y < alpha.height; y++) {
    for (let x = 0; x < alpha.width; x++) {
      if (alpha.data[y * alpha.width + x] < threshold) continue;
      solid++;
      if (inside(ring, x + 0.5, y + 0.5)) covered++;
    }
  }
  return solid ? covered / solid : 1;
}
