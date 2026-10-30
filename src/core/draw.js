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
 * Walks every visible region and mesh of a posed skeleton in draw order, masked by clipping
 * attachments, and calls `emit(tex, blend, positions, uvs, triangles, light, dark)` for each.
 * `tint` multiplies every color; `skip(slot, attachment)` leaves attachments out; `between(slot)` is
 * called as each slot's turn comes, before its attachment (a scene draws its actors there).
 */
export function drawSkeletonGeometry(sk, pose, lookup, emit, { tint = [1, 1, 1, 1], skip = null, between = null } = {}) {
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
      attachmentGeometry(sk, pose, i, att, type, lookup, tint, clipper, uv, emit);
    }
    if (clipper && clipEnd === i) clipper = null;
  }
}

function attachmentGeometry(sk, pose, i, att, type, lookup, tint, clipper, uv, emit) {
  const source = type === 'region' ? att : sk.meshSource(i, att);
  if (!source) return;
  const entry = lookup(pose.imageOf(i, type === 'mesh' ? source : att));
  if (!entry) return;
  const c = pose.color[i];
  const ac = att.color ?? [1, 1, 1, 1];
  const light = [c[0] * ac[0] * tint[0], c[1] * ac[1] * tint[1], c[2] * ac[2] * tint[2], c[3] * ac[3] * tint[3]];
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
    positions = [];
    uvs = [];
    for (const [u, v] of [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]) {
      const lx = -hw + u * att.width;
      const ly = hh - v * att.height;
      positions.push(m.a * lx + m.c * ly + m.tx, m.b * lx + m.d * ly + m.ty);
      entry.map(u, v, uv);
      uvs.push(uv[0], uv[1]);
    }
    triangles = QUAD;
  } else {
    positions = pose.worldVertices(sk, i, att);
    const n = positions.length / 2;
    uvs = new Array(n * 2);
    for (let k = 0; k < n; k++) {
      entry.map(source.uvs[2 * k], source.uvs[2 * k + 1], uv);
      uvs[2 * k] = uv[0];
      uvs[2 * k + 1] = uv[1];
    }
    triangles = source.triangles;
  }
  if (clipper) clipper.clip(positions, uvs, triangles, (p, t, tri) => emit(entry.tex, blend, p, t, tri, light, dark));
  else emit(entry.tex, blend, positions, uvs, triangles, light, dark);
}
