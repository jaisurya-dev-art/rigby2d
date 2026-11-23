// SPDX-License-Identifier: MIT OR Apache-2.0
// Mesh data edits that need no editor: turning a region into a mesh, the editable world-space form
// of a mesh and writing it back, binding to bones with automatic weights, and locked vertices.
// Shared by the editor's mesh tool and the MCP server (so it must stay importable under Node).

import { toAffine } from '../core/math.js';
import { autoWeights, deformLayout, edgeRings, triangulateMesh, triangulateRings } from '../core/meshgeom.js';
import { Pose } from '../core/pose.js';

/** Every list holding attachments (default skin per slot, then named skins). */
function attachmentLists(doc) {
  const lists = doc.slots.map((s) => s.attachments);
  for (const skin of doc.skins) for (const e of skin.slots) lists.push(e.attachments);
  return lists;
}

export function replaceAttachment(doc, old, neu) {
  for (const list of attachmentLists(doc)) {
    const i = list.indexOf(old);
    if (i >= 0) list[i] = neu;
  }
}

/** Removes deform keys of an attachment (they no longer match its vertices). Returns how many. */
export function dropDeformKeys(doc, slot, name) {
  let removed = 0;
  for (const anim of doc.animations) {
    const before = anim.deform.length;
    anim.deform = anim.deform.filter((d) => !(d.slot === slot && d.attachment === name));
    removed += before - anim.deform.length;
  }
  return removed;
}

/** Replaces a region attachment with a 4-vertex mesh covering the same image. */
export function regionToMesh(doc, slot, att) {
  const m = toAffine(att.offset);
  const hw = att.width / 2;
  const hh = att.height / 2;
  const corners = [
    [-hw, hh],
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
  ].map((p) => m.apply(p));
  const mesh = {
    name: att.name,
    type: 'mesh',
    image: att.image,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hull: 4,
    vertices: corners.flat(),
    width: att.width,
    height: att.height,
  };
  for (const key of ['color', 'sequence', 'sourceName', 'extra']) if (att[key] !== undefined) mesh[key] = att[key];
  replaceAttachment(doc, att, mesh);
  return mesh;
}

// ---- locked vertices and outline edges ---------------------------------------------------------

/** The key of a mesh in `doc.meshLocks`. */
export function lockKey(doc, slot, name) {
  return `${doc.slots[slot].name}/${name}`;
}

/** The locked vertex indices of a mesh (a new Set). */
export function meshLocks(doc, slot, name) {
  return new Set(doc.meshLocks[lockKey(doc, slot, name)] ?? []);
}

/** Stores the locked vertex indices of a mesh (an empty set removes the entry). */
export function setMeshLocks(doc, slot, name, locks) {
  const key = lockKey(doc, slot, name);
  const list = [...locks].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b);
  if (list.length) doc.meshLocks[key] = list;
  else delete doc.meshLocks[key];
}

/** Triangles for a mesh: its outlines from `edges` when it has holes or several shapes. */
export function triangulate(points, hull, edges) {
  const rings = edgeRings(edges, points.length);
  if (rings.length > 1) return triangulateRings(points, rings).triangles;
  return triangulateMesh(points, hull);
}

/** The mesh as editable world-space data: { points, uvs, weights (or null), hull, triangles, edges }. */
export function meshState(doc, slot, att) {
  const pose = new Pose(doc);
  const flat = pose.worldVertices(doc, slot, att);
  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  const uvs = [];
  for (let i = 0; i + 1 < att.uvs.length; i += 2) uvs.push([att.uvs[i], att.uvs[i + 1]]);
  const weights = att.weights ? att.weights.map((v) => v.map((w) => ({ bone: w.bone, weight: w.weight }))) : null;
  return { points, uvs, weights, hull: att.hull ?? points.length, triangles: att.triangles.slice(), edges: att.edges ? att.edges.slice() : null };
}

/**
 * Writes edited world-space data back into the mesh (re-triangulated). Returns the number of
 * deform keys removed: only when the deform layout changed (see deformLayout), as when vertices
 * are added or removed or a vertex gains or loses a bone.
 */
export function writeMesh(doc, slot, att, state, { topology = true } = {}) {
  const before = deformLayout(att);
  const pose = new Pose(doc);
  att.uvs = state.uvs.flat();
  att.hull = state.hull;
  if (topology) {
    // Meshes with holes or several shapes keep their outlines as edges; others drop edges, as
    // before (they described the old triangles).
    const keep = edgeRings(state.edges, state.points.length).length > 1;
    att.triangles = triangulate(state.points, state.hull, keep ? state.edges : null);
    if (keep) att.edges = state.edges.slice();
    else delete att.edges;
  }
  if (state.weights) {
    att.weights = state.points.map((p, i) =>
      state.weights[i].map(({ bone, weight }) => {
        const [x, y] = pose.world[bone].inverse().apply(p);
        return { bone, x, y, weight };
      }),
    );
    delete att.vertices;
  } else {
    const inv = pose.world[doc.slots[slot].bone].inverse();
    att.vertices = state.points.flatMap((p) => inv.apply(p));
    delete att.weights;
  }
  return deformLayout(att) === before ? 0 : dropDeformKeys(doc, slot, att.name);
}

/** Binds the mesh to bones with automatic weights. */
export function bindMesh(doc, slot, att, bones) {
  const pose = new Pose(doc);
  const state = meshState(doc, slot, att);
  const segments = bones.map((bone) => ({
    bone,
    from: pose.world[bone].apply([0, 0]),
    to: pose.world[bone].apply([doc.bones[bone].length, 0]),
  }));
  state.weights = autoWeights(state.points, segments);
  return writeMesh(doc, slot, att, state, { topology: false });
}

/** Removes the weights: vertices follow the slot's bone again. */
export function unbindMesh(doc, slot, att) {
  const state = meshState(doc, slot, att);
  state.weights = null;
  return writeMesh(doc, slot, att, state, { topology: false });
}
