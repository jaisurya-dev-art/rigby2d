// SPDX-License-Identifier: MIT OR Apache-2.0
// Drawing a posed skeleton, without any graphics API: what every renderer needs (the WebGL renderer
// in src/webgl, and the engine runtimes that draw with their engine's renderer, such as Cocos
// Creator). It walks the draw order, applies clipping attachments, maps each image onto its atlas
// page and works out the two-color tint, then hands each piece to the renderer as triangles.
//
//   const lookup = atlasLookup(atlas, (page) => myTextureFor(page));      // image name -> entry
//   drawSkeletonGeometry(sk, pose, lookup, (texture, blend, positions, uvs, triangles, light, dark) => {
//     // positions: flat world [x, y, ...] (Y up); uvs: flat page UVs; triangles: vertex indices;
//     // light: [r, g, b, a] tint; dark: [r, g, b] dark tint or null; blend: normal / additive / multiply / screen
//   });

import { regionPlacement } from './atlas.js';
import { Clipper } from './clipping.js';

export const QUAD = [0, 1, 2, 0, 2, 3];
const identity = (u, v, out) => ((out[0] = u), (out[1] = v), out);

/**
 * The texture entry of an atlas region: { tex, trim, map(u, v, out) }. `trim` is the packed part of
 * the image in image UVs; `map` turns image UVs into page UVs (trimming and rotation included).
 */
export function regionEntry(tex, r, pageWidth, pageHeight) {
  const p = regionPlacement(r);
  const ow = Math.max(1, p.originalWidth);
  const oh = Math.max(1, p.originalHeight);
  const { x: dx, y: dy, width: w, height: h } = p.dst;
  // Rotation: the page holds the packed image rotated by -rotate degrees about its center.
  const rad = (-p.rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e6) / 1e6;
  const sin = Math.round(Math.sin(rad) * 1e6) / 1e6;
  const cx = p.src.width / 2;
  const cy = p.src.height / 2;
  return {
    tex,
    trim: [dx / ow, dy / oh, (dx + w) / ow, (dy + h) / oh],
    map(u, v, out) {
      // Pixel in the packed image, clamped so UVs never reach neighbouring regions.
      const qx = Math.min(w, Math.max(0, u * ow - dx)) - w / 2;
      const qy = Math.min(h, Math.max(0, v * oh - dy)) - h / 2;
      out[0] = (p.src.x + cx + qx * cos - qy * sin) / pageWidth;
      out[1] = (p.src.y + cy + qx * sin + qy * cos) / pageHeight;
      return out;
    },
  };
}

/**
 * An image-name lookup for an atlas. `textureOf(page)` gives each page's texture (any object the
 * renderer understands; null skips the page) and may report its size as { width, height }.
 */
export function atlasLookup(atlas, textureOf) {
  const regions = new Map();
  for (const page of atlas.pages) {
    const tex = textureOf(page);
    if (!tex) continue;
    const pw = page.width || tex.width || 1;
    const ph = page.height || tex.height || 1;
    for (const r of page.regions) regions.set(r.index >= 0 ? `${r.name}${r.index}` : r.name, regionEntry(tex, r, pw, ph));
  }
  return (name) => regions.get(name) ?? null;
}

/** A lookup for loose images (no atlas): `textures` maps image names to textures. */
export function imageLookup(textures) {
  const entries = new Map();
  for (const [name, tex] of textures instanceof Map ? textures : Object.entries(textures)) entries.set(name, { tex, trim: [0, 0, 1, 1], map: identity });
  return (name) => entries.get(name) ?? null;
}

/**
 * A cache for drawSkeletonGeometry, for runtimes whose skeleton data doesn't change while it plays:
 * each attachment's atlas UVs are worked out once, and the arrays handed to `emit` are reused from
 * one attachment to the next (copy what you keep). Not for the editor, where UVs change in place.
 */
export function geometryCache() {
  return { uvs: new WeakMap(), positions: [], regionUvs: [], light: [0, 0, 0, 0] };
}

/**
 * A weighted mesh's world vertices (as Pose.worldVertices), from its weights packed once into a
 * flat array: per vertex, the bone count, then bone, x, y, weight for each bone.
 */
function weightedVertices(pose, slot, att, source, cache) {
  let packed = cache.uvs.get(source.weights);
  if (!packed) {
    const flat = [];
    for (const v of source.weights) {
      flat.push(v.length);
      for (const w of v) flat.push(w.bone, w.x, w.y, w.weight);
    }
    cache.uvs.set(source.weights, (packed = Float64Array.from(flat)));
  }
  const deform = pose.deformOf(slot, att);
  const world = pose.world;
  const out = cache.positions;
  const n = source.weights.length;
  out.length = n * 2;
  let p = 0;
  let k = 0;
  for (let vi = 0; vi < n; vi++) {
    const count = packed[p++];
    let x = 0;
    let y = 0;
    for (let wi = 0; wi < count; wi++, p += 4, k += 2) {
      const m = world[packed[p]];
      const bx = deform ? packed[p + 1] + deform[k] : packed[p + 1];
      const by = deform ? packed[p + 2] + deform[k + 1] : packed[p + 2];
      const wt = packed[p + 3];
      x += (m.a * bx + m.c * by + m.tx) * wt;
      y += (m.b * bx + m.d * by + m.ty) * wt;
    }
    out[2 * vi] = x;
    out[2 * vi + 1] = y;
  }
  return out;
}

/** Page UVs of an attachment for an atlas entry, from the cache (computed the first time). */
function cachedUvs(cache, key, entry, compute) {
  let hit = cache.uvs.get(key);
  if (!hit || hit.entry !== entry) cache.uvs.set(key, (hit = { entry, uvs: compute() }));
  return hit.uvs;
}

/**
 * Walks every visible region and mesh of a posed skeleton in draw order, masked by clipping
 * attachments, and calls `emit(tex, blend, positions, uvs, triangles, light, dark)` for each.
 * `tint` multiplies every color; `skip(slot, attachment)` leaves attachments out; `between(slot)` is
 * called as each slot's turn comes, before its attachment (a scene draws its actors there). With a
 * `cache` (geometryCache()), the arrays passed to `emit` are only valid during the call.
 */
export function drawSkeletonGeometry(sk, pose, lookup, emit, { tint = [1, 1, 1, 1], skip = null, between = null, cache = null } = {}) {
  let clipper = null;
  let clipEnd = null;
  const uv = [0, 0];
  for (const i of pose.drawOrder) {
    const slot = sk.slots[i];
    between?.(i);
    const att = slot ? pose.slotAttachment(sk, i) : null;
    const type = att ? (att.type ?? 'region') : null;
    if (att && type === 'clipping' && !skip?.(i, att)) {
      clipper = new Clipper(pose.worldVertices(sk, i, att));
      clipEnd = att.end === i ? null : (att.end ?? null); // ending at its own slot means: to the end
    } else if (att && (type === 'region' || type === 'mesh' || type === 'linkedmesh') && !skip?.(i, att)) {
      attachmentGeometry(sk, pose, i, att, type, lookup, tint, clipper, uv, emit, cache);
    }
    if (clipper && clipEnd === i) clipper = null;
  }
}

const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function attachmentGeometry(sk, pose, i, att, type, lookup, tint, clipper, uv, emit, cache) {
  const source = type === 'region' ? att : sk.meshSource(i, att);
  if (!source) return;
  const entry = lookup(pose.imageOf(i, type === 'mesh' ? source : att));
  if (!entry) return;
  const c = pose.color[i];
  const ac = att.color ?? [1, 1, 1, 1];
  const light = cache ? cache.light : [0, 0, 0, 0];
  light[0] = c[0] * ac[0] * tint[0];
  light[1] = c[1] * ac[1] * tint[1];
  light[2] = c[2] * ac[2] * tint[2];
  light[3] = c[3] * ac[3] * tint[3];
  const dark = pose.dark[i];
  const blend = sk.slots[i].blend ?? 'normal';
  let positions;
  let uvs;
  let triangles;
  if (type === 'region') {
    // The packed (trimmed) part of the image, as corners of the attachment quad.
    const m = pose.attachmentWorld(sk, i, att);
    const [u0, v0, u1, v1] = entry.trim;
    const hw = att.width / 2;
    const hh = att.height / 2;
    positions = cache ? cache.positions : [];
    positions.length = 8;
    for (let k = 0; k < 4; k++) {
      const u = CORNERS[k][0] ? u1 : u0;
      const v = CORNERS[k][1] ? v1 : v0;
      const lx = -hw + u * att.width;
      const ly = hh - v * att.height;
      positions[2 * k] = m.a * lx + m.c * ly + m.tx;
      positions[2 * k + 1] = m.b * lx + m.d * ly + m.ty;
    }
    const corners = () => {
      const out = new Array(8);
      for (let k = 0; k < 4; k++) {
        entry.map(CORNERS[k][0] ? u1 : u0, CORNERS[k][1] ? v1 : v0, uv);
        out[2 * k] = uv[0];
        out[2 * k + 1] = uv[1];
      }
      return out;
    };
    uvs = cache ? cachedUvs(cache, att, entry, corners) : corners();
    triangles = QUAD;
  } else {
    positions = cache && source.weights ? weightedVertices(pose, i, att, source, cache) : pose.worldVertices(sk, i, att, cache ? cache.positions : undefined);
    const n = positions.length / 2;
    const mapped = () => {
      const out = new Array(n * 2);
      for (let k = 0; k < n; k++) {
        entry.map(source.uvs[2 * k], source.uvs[2 * k + 1], uv);
        out[2 * k] = uv[0];
        out[2 * k + 1] = uv[1];
      }
      return out;
    };
    // Keyed by the UV array itself: a linked mesh shares its parent's UVs and image placement.
    uvs = cache ? cachedUvs(cache, source.uvs, entry, mapped) : mapped();
    triangles = source.triangles;
  }
  if (clipper) clipper.clip(positions, uvs, triangles, (p, t, tri) => emit(entry.tex, blend, p, t, tri, light, dark));
  else emit(entry.tex, blend, positions, uvs, triangles, light, dark);
}
