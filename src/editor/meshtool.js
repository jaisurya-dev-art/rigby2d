// SPDX-License-Identifier: MIT OR Apache-2.0
// Mesh authoring: turning images into meshes, editing vertices, binding meshes to bones and
// painting weights. Editing happens on the setup pose, in world space; the mesh is written back
// in the slot bone's space (unweighted) or each bone's space (weighted).

import { toAffine } from '../core/math.js';
import { autoWeights, deformLayout, edgeRings, paintWeights, triangulateMesh, triangulateRings, uvAt, weightsAt } from '../core/meshgeom.js';
import { generateMesh } from '../core/meshgen.js';
import { makeSlot } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { setKey } from '../core/animation.js';
import { FPS, Mode } from './app.js';
import { t } from './i18n.js';

const VERTEX_HIT = 7;
const EDGE_HIT = 8;

/** Every list holding attachments (default skin per slot, then named skins). */
function attachmentLists(doc) {
  const lists = doc.slots.map((s) => s.attachments);
  for (const skin of doc.skins) for (const e of skin.slots) lists.push(e.attachments);
  return lists;
}

function replaceAttachment(doc, old, neu) {
  for (const list of attachmentLists(doc)) {
    const i = list.indexOf(old);
    if (i >= 0) list[i] = neu;
  }
}

/** Removes deform keys of an attachment (they no longer match its vertices). Returns how many. */
function dropDeformKeys(doc, slot, name) {
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
function lockKey(doc, slot, name) {
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

/** Indices after inserting a vertex at `at` (later ones move up by one). */
function shiftUp(list, at) {
  return list.map((i) => (i >= at ? i + 1 : i));
}

/**
 * Mesh edges (Spine's form, indices times 2) after inserting vertex `at` on the edge from
 * `a` to `b` (indices before the insert); null edges stay null.
 */
function edgesAfterInsert(edges, at, a, b) {
  if (!edges) return null;
  const up = (i) => (i >= at ? i + 1 : i);
  const out = edges.map((e) => up(e / 2) * 2);
  const [na, nb] = [up(a), up(b)];
  for (let i = 0; i + 1 < out.length; i += 2) {
    const [p, q] = [out[i] / 2, out[i + 1] / 2];
    if ((p === na && q === nb) || (p === nb && q === na)) {
      out.splice(i, 2, p * 2, at * 2, at * 2, q * 2);
      break;
    }
  }
  return out;
}

/** Mesh edges after removing vertex `v`: its two outline neighbours are joined. */
function edgesAfterRemove(edges, v) {
  if (!edges) return null;
  const pairs = [];
  const around = [];
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const [p, q] = [edges[i] / 2, edges[i + 1] / 2];
    if (p === v) around.push(q);
    else if (q === v) around.push(p);
    else pairs.push([p, q]);
  }
  if (around.length === 2 && around[0] !== around[1]) pairs.push(around);
  const down = (i) => (i > v ? i - 1 : i);
  return pairs.flatMap(([p, q]) => [down(p) * 2, down(q) * 2]);
}

/** Triangles for a mesh: its outlines from `edges` when it has holes or several shapes. */
function triangulate(points, hull, edges) {
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

/**
 * Replaces the mesh with one generated from its image's alpha (see core/meshgen.js), keeping it
 * where it is: image pixels map to the world through the mesh's current texture mapping, and a
 * weighted mesh keeps its weights (interpolated at the new vertices). Locked vertices stay exactly
 * as they are (position, texture coordinates and weights) and stay locked. With `islands: 'split'`
 * every other shape becomes a mesh of its own, in a new slot just above this one (those made by an
 * earlier run, listed in `made`, are replaced). Returns the generator's result ({ hull, points,
 * islands, ... } plus removed deform keys and `made`: the new slots' names), or null when the
 * image is missing or has no pixels above the threshold.
 */
export function generateFromImage(app, slot, att, options, made = []) {
  const image = att.image ?? att.name;
  const canvas = app.images.get(image);
  if (!canvas || app.images.alphaAt(image, 0, 0) === null) return null;
  const doc = app.doc;
  const W = canvas.width;
  const H = canvas.height;
  const alpha = { width: W, height: H, data: app.images.map.get(image).alpha };
  const state = meshState(doc, slot, att);
  const outlineVerts = new Set([...Array(state.hull).keys(), ...edgeRings(state.edges, state.points.length).flat()]);
  const lockedIds = [...meshLocks(doc, slot, att.name)].filter((i) => i < state.points.length);
  const locked = lockedIds.map((i) => ({ x: state.uvs[i][0] * W, y: state.uvs[i][1] * H, outline: outlineVerts.has(i) }));
  const gen = generateMesh(alpha, { ...options, locked });
  if (!gen) return null;
  const toWorld = fitAffine(state.uvs, state.points);
  const weightsFor = (p) => {
    const w = weightsAt(p, state.points, state.weights, state.triangles);
    return w.length ? w : state.weights[0];
  };
  /** World-space mesh data for one generated mesh; locked vertices copied from the old mesh. */
  const stateOf = (m) => {
    const uvs = [];
    for (let i = 0; i < m.uvs.length; i += 2) uvs.push([m.uvs[i], m.uvs[i + 1]]);
    const points = uvs.map(toWorld);
    const weights = state.weights ? points.map(weightsFor) : null;
    const locks = new Set();
    for (const [k, i] of Object.entries(m.locked ?? {})) {
      const from = lockedIds[k];
      points[i] = state.points[from].slice();
      uvs[i] = state.uvs[from].slice();
      if (weights) weights[i] = state.weights[from].map((w) => ({ ...w }));
      locks.add(i);
    }
    return { points, uvs, weights, hull: m.hull, edges: m.edges, locks };
  };

  // Slots an earlier "one mesh per shape" run made are replaced.
  for (const name of made) {
    const i = doc.slotIndex(name);
    if (i !== null && i !== slot) {
      delete doc.meshLocks[lockKey(doc, i, doc.slots[i].attachment ?? '')];
      doc.removeSlot(i);
      if (i < slot) slot--;
    }
  }
  const first = stateOf(gen);
  const removed = writeMesh(doc, slot, att, first);
  setMeshLocks(doc, slot, att.name, first.locks);
  const names = [];
  (gen.meshes ?? []).slice(1).forEach((m, k) => {
    const s = stateOf(m);
    const slotName = doc.uniqueSlotName(`${doc.slots[slot].name}_${k + 2}`);
    const mesh = { name: `${att.name}_${k + 2}`, type: 'mesh', image, color: (att.color ?? [1, 1, 1, 1]).slice(), uvs: [], triangles: [], hull: 0, vertices: [], width: att.width, height: att.height };
    const base = doc.slots[slot];
    const neu = makeSlot(slotName, base.bone, mesh);
    if (base.color) neu.color = base.color.slice();
    doc.slots.push(neu);
    const at = doc.slots.length - 1;
    writeMesh(doc, at, mesh, s);
    setMeshLocks(doc, at, mesh.name, s.locks);
    // Just above the original in draw order.
    doc.moveSlot(at, slot + 1 + k);
    names.push(slotName);
  });
  return { ...gen, removed, made: names };
}

/**
 * The affine map from texture coordinates to world positions that best fits a mesh's vertices
 * (exact for a mesh that has not been warped). Returns a function [u, v] -> [x, y].
 */
function fitAffine(uvs, points) {
  // Least squares for x = a u + b v + c (and y the same), via the 3x3 normal equations.
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rx = [0, 0, 0];
  const ry = [0, 0, 0];
  uvs.forEach(([u, v], i) => {
    const r = [u, v, 1];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) m[a][b] += r[a] * r[b];
      rx[a] += r[a] * points[i][0];
      ry[a] += r[a] * points[i][1];
    }
  });
  const cx = solve3(m, rx);
  const cy = solve3(m, ry);
  return ([u, v]) => [cx[0] * u + cx[1] * v + cx[2], cy[0] * u + cy[1] * v + cy[2]];
}

function solve3(m, r) {
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m) || 1e-12;
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / d);
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/**
 * Viewport tool for the mesh being edited (`app.meshEdit = { slot, name, mode, bone, ... }`).
 * Vertices mode: click inside to add a vertex, near (or outside) the outline to add an outline
 * vertex, drag to move a vertex over the image, Delete removes the selected one. Weights mode:
 * drag to paint the chosen bone's weight (Shift or the Subtract option removes weight).
 */
export class MeshTool {
  constructor(app, viewport) {
    this.app = app;
    this.viewport = viewport;
    this.drag = null;
    this.hover = null;
  }

  /** The edited slot and mesh, or null when not editing. */
  target() {
    const app = this.app;
    const e = app.meshEdit;
    if (!e) return null;
    // Animate mode deforms the mesh; Setup mode edits vertices and weights.
    const animate = app.mode === Mode.Animate;
    if (animate && !app.currentAnimation()) return null;
    const att = app.doc.attachment(e.slot, e.name);
    if (!att || att.type !== 'mesh') return null;
    const mode = animate ? 'deform' : e.mode === 'deform' ? 'vertices' : e.mode;
    return { slot: e.slot, att, edit: e, mode };
  }

  /** Vertex positions as shown: the setup pose, or the animated pose when deforming. */
  shownPoints(t) {
    // Painting weights on a test pose: the brush and the colors follow the posed mesh.
    const posed = t.mode === 'weights' && t.att.weights && (this.app.testPose.size || this.app.wiggle.on);
    if (t.mode !== 'deform' && !posed) return meshState(this.app.doc, t.slot, t.att).points;
    const flat = this.app.pose().worldVertices(this.app.doc, t.slot, t.att);
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    return pts;
  }

  get active() {
    return this.target() !== null;
  }

  screen(p) {
    return this.viewport.toScreen(p);
  }

  vertexAt(state, pos) {
    let best = -1;
    let bestD = VERTEX_HIT;
    state.points.forEach((p, i) => {
      const s = this.screen(p);
      const d = Math.hypot(s[0] - pos[0], s[1] - pos[1]);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Index of the outline edge nearest to a screen point and its screen distance. */
  nearestEdge(state, pos) {
    let best = { index: 0, d: Infinity };
    for (let i = 0; i < state.hull; i++) {
      const d = distToSegment(pos, this.screen(state.points[i]), this.screen(state.points[(i + 1) % state.hull]));
      if (d < best.d) best = { index: i, d };
    }
    return best;
  }

  commit(tgt, state, opts) {
    const removed = writeMesh(this.app.doc, tgt.slot, tgt.att, state, opts);
    if (removed) this.app.setStatus(t('Mesh changed: removed {count} deform timeline(s) that no longer match it', { count: removed }));
    this.app.changed();
  }

  /** Selected vertex indices (the last clicked one is `edit.selected`). */
  selection(tgt) {
    tgt.edit.selection ??= new Set(tgt.edit.selected !== null && tgt.edit.selected !== undefined ? [tgt.edit.selected] : []);
    return tgt.edit.selection;
  }

  /** Click on a vertex: select it (Ctrl adds or removes it). */
  pick(t, hit, add) {
    const sel = this.selection(t);
    if (add) {
      if (sel.has(hit)) sel.delete(hit);
      else sel.add(hit);
    } else if (!sel.has(hit)) {
      sel.clear();
      sel.add(hit);
    }
    t.edit.selected = sel.has(hit) ? hit : [...sel].at(-1) ?? null;
  }

  down(pos, e) {
    const tgt = this.target();
    if (!tgt) return;
    const add = e.ctrlKey || e.metaKey;
    const state = meshState(this.app.doc, tgt.slot, tgt.att);
    const world = this.viewport.toWorld(pos);
    if (tgt.mode === 'weights') {
      if (!state.weights) {
        this.app.setStatus(t('Bind the mesh to bones first (properties panel)'));
        return;
      }
      this.drag = { kind: 'paint', subtract: e.shiftKey || tgt.edit.subtract };
      this.paint(tgt, pos);
      return;
    }
    const shown = this.shownPoints(tgt);
    const hit = this.vertexAt({ points: shown }, pos);
    if (hit >= 0) {
      this.pick(tgt, hit, add);
      const indices = [...this.selection(tgt)];
      this.drag = { kind: tgt.mode === 'deform' ? 'deform' : 'vertex', indices, start: state, shown, from: world, moved: false };
      this.app.changed();
      return;
    }
    // Empty space: Ctrl (or any drag while deforming) draws a selection box.
    if (add || tgt.mode === 'deform') {
      if (!add) this.selection(tgt).clear();
      this.drag = { kind: 'box', from: pos, to: pos, add };
      this.app.changed();
      return;
    }
    // Add a vertex: near or outside the outline extends the outline, inside adds an interior one.
    const uv = uvAt(world, state.points, state.uvs, state.triangles);
    const weights = state.weights ? weightsAt(world, state.points, state.weights, state.triangles) : null;
    const edge = this.nearestEdge(state, pos);
    const outline = state.points.slice(0, state.hull);
    let index;
    if (edge.d <= EDGE_HIT || !pointInPolygon(world, outline)) {
      index = edge.index + 1;
      state.edges = edgesAfterInsert(state.edges, index, edge.index, (edge.index + 1) % state.hull);
      const doc = this.app.doc;
      setMeshLocks(doc, tgt.slot, tgt.att.name, shiftUp([...meshLocks(doc, tgt.slot, tgt.att.name)], index));
      state.points.splice(index, 0, world);
      state.uvs.splice(index, 0, uv);
      if (weights) state.weights.splice(index, 0, weights.length ? weights : state.weights[edge.index].map((w) => ({ ...w })));
      state.hull++;
    } else {
      index = state.points.length;
      state.points.push(world);
      state.uvs.push(uv);
      if (weights) state.weights.push(weights.length ? weights : state.weights[0].map((w) => ({ ...w })));
    }
    tgt.edit.selection = new Set([index]);
    tgt.edit.selected = index;
    this.commit(tgt, state);
    const next = meshState(this.app.doc, tgt.slot, tgt.att);
    this.drag = { kind: 'vertex', indices: [index], start: next, shown: next.points, from: world };
  }

  move(pos) {
    this.hover = pos;
    const t = this.target();
    if (!t || !this.drag) return;
    const d = this.drag;
    if (d.kind === 'paint') {
      this.paint(t, pos);
      return;
    }
    if (d.kind === 'box') {
      d.to = pos;
      this.app.changed();
      return;
    }
    const world = this.viewport.toWorld(pos);
    const delta = [world[0] - d.from[0], world[1] - d.from[1]];
    if (d.kind === 'deform') {
      deformVertices(this.app, t.slot, t.att, d.indices.map((i) => [i, [d.shown[i][0] + delta[0], d.shown[i][1] + delta[1]]]));
      return;
    }
    // Moved by hand: locked, so generating the mesh again keeps them where they are.
    if (!d.locked) {
      d.locked = true;
      const doc = this.app.doc;
      const locks = meshLocks(doc, t.slot, t.att.name);
      for (const i of d.indices) locks.add(i);
      setMeshLocks(doc, t.slot, t.att.name, locks);
    }
    // Move the vertices over the image: their texture coordinates follow their positions.
    const start = d.start;
    const state = { ...start, points: start.points.slice(), uvs: start.uvs.slice() };
    for (const i of d.indices) {
      const p = [start.points[i][0] + delta[0], start.points[i][1] + delta[1]];
      state.points[i] = p;
      state.uvs[i] = uvAt(p, start.points, start.uvs, start.triangles);
    }
    this.commit(t, state);
  }

  up() {
    const tgt = this.target();
    const d = this.drag;
    this.drag = null;
    if (!tgt || d?.kind !== 'box') return;
    const [x0, x1] = [Math.min(d.from[0], d.to[0]), Math.max(d.from[0], d.to[0])];
    const [y0, y1] = [Math.min(d.from[1], d.to[1]), Math.max(d.from[1], d.to[1])];
    const sel = this.selection(tgt);
    this.shownPoints(tgt).forEach((p, i) => {
      const [sx, sy] = this.screen(p);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) sel.add(i);
    });
    tgt.edit.selected = [...sel].at(-1) ?? null;
    this.app.setStatus(t('{count} vertex(es) selected', { count: sel.size }));
    this.app.changed();
  }

  paint(t, pos) {
    const app = this.app;
    const state = meshState(app.doc, t.slot, t.att);
    const bone = t.edit.bone ?? state.weights[0]?.[0]?.bone ?? 0;
    const radius = (t.edit.radius ?? 40) / app.view.zoom;
    const changed = paintWeights(this.shownPoints(t), state.weights, bone, this.viewport.toWorld(pos), radius, (t.edit.strength ?? 0.5) * 0.25, this.drag.subtract);
    if (changed.length) this.commit(t, state, { topology: false });
  }

  /** Deletes the selected vertices. Returns false when there is nothing to delete. */
  deleteSelected() {
    const t = this.target();
    if (!t || t.mode === 'deform') return false;
    const sel = [...this.selection(t)].sort((a, b) => b - a);
    if (!sel.length) return false;
    const state = meshState(this.app.doc, t.slot, t.att);
    const hullLeft = state.hull - sel.filter((i) => i < state.hull).length;
    if (hullLeft < 3) {
      this.app.setStatus('A mesh outline needs at least 3 vertices');
      return true;
    }
    const doc = this.app.doc;
    let locks = [...meshLocks(doc, t.slot, t.att.name)];
    for (const i of sel) {
      if (i >= state.points.length) continue;
      state.edges = edgesAfterRemove(state.edges, i);
      locks = locks.filter((k) => k !== i).map((k) => (k > i ? k - 1 : k));
      state.points.splice(i, 1);
      state.uvs.splice(i, 1);
      if (state.weights) state.weights.splice(i, 1);
      if (i < state.hull) state.hull--;
    }
    setMeshLocks(doc, t.slot, t.att.name, locks);
    t.edit.selection = new Set();
    t.edit.selected = null;
    this.commit(t, state);
    return true;
  }

  /** Locks the selected vertices, or unlocks them when all are locked. Returns the count, or 0. */
  toggleLockSelected() {
    const tgt = this.target();
    if (!tgt || tgt.mode === 'deform') return 0;
    const sel = [...this.selection(tgt)];
    if (!sel.length) return 0;
    const doc = this.app.doc;
    const locks = meshLocks(doc, tgt.slot, tgt.att.name);
    const unlock = sel.every((i) => locks.has(i));
    for (const i of sel) unlock ? locks.delete(i) : locks.add(i);
    setMeshLocks(doc, tgt.slot, tgt.att.name, locks);
    this.app.setStatus(unlock ? t('Unlocked {count} vertex(es)', { count: sel.length }) : t('Locked {count} vertex(es): generating the mesh again keeps them', { count: sel.length }));
    this.app.changed();
    return sel.length;
  }

  draw(ctx) {
    const t = this.target();
    if (!t) return;
    const state = meshState(this.app.doc, t.slot, t.att);
    const pts = this.shownPoints(t).map((p) => this.screen(p));
    const weightsMode = t.mode === 'weights' && state.weights;
    const bone = t.edit.bone ?? state.weights?.[0]?.[0]?.bone;
    const weightOf = (i) => state.weights[i].find((w) => w.bone === bone)?.weight ?? 0;
    const heat = (w) => `rgba(${Math.round(255 * w)},${Math.round(80 + 60 * (1 - Math.abs(w - 0.5) * 2))},${Math.round(255 * (1 - w))},0.55)`;
    ctx.save();
    ctx.lineWidth = 1;
    for (let k = 0; k + 2 < state.triangles.length; k += 3) {
      const tri = [state.triangles[k], state.triangles[k + 1], state.triangles[k + 2]];
      ctx.beginPath();
      tri.forEach((v, n) => (n ? ctx.lineTo(pts[v][0], pts[v][1]) : ctx.moveTo(pts[v][0], pts[v][1])));
      ctx.closePath();
      if (weightsMode) {
        ctx.fillStyle = heat((weightOf(tri[0]) + weightOf(tri[1]) + weightOf(tri[2])) / 3);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(120,200,255,0.55)';
      ctx.stroke();
    }
    // Outline.
    ctx.strokeStyle = 'rgb(255,170,40)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < state.hull; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
    // Every outline (holes and other shapes too, from the mesh's edges).
    const rings = edgeRings(state.edges, pts.length);
    if (rings.length > 1) {
      ctx.lineWidth = 1.5;
      for (const ring of rings.slice(1)) {
        ctx.beginPath();
        ring.forEach((v, n) => (n ? ctx.lineTo(pts[v][0], pts[v][1]) : ctx.moveTo(pts[v][0], pts[v][1])));
        ctx.closePath();
        ctx.stroke();
      }
    }
    const sel = this.selection(t);
    const locks = meshLocks(this.app.doc, t.slot, t.att.name);
    const onRing = new Set(rings.flat());
    pts.forEach((p, i) => {
      const picked = sel.has(i);
      ctx.beginPath();
      // Locked vertices are squares.
      if (locks.has(i)) ctx.rect(p[0] - (picked ? 5 : 4), p[1] - (picked ? 5 : 4), picked ? 10 : 8, picked ? 10 : 8);
      else ctx.arc(p[0], p[1], picked ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = weightsMode ? heat(weightOf(i)).replace(/[\d.]+\)$/, '1)') : picked ? 'white' : i < state.hull || onRing.has(i) ? 'rgb(255,170,40)' : 'rgb(120,200,255)';
      ctx.fill();
      ctx.strokeStyle = picked ? 'rgb(255,170,40)' : 'black';
      ctx.lineWidth = picked ? 2 : 1;
      ctx.stroke();
    });
    if (this.drag?.kind === 'box') {
      const { from, to } = this.drag;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgb(255,170,40)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(from[0], to[0]) + 0.5, Math.min(from[1], to[1]) + 0.5, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      ctx.setLineDash([]);
    }
    if (t.mode === 'weights' && this.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(this.hover[0], this.hover[1], t.edit.radius ?? 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Moves mesh vertices to world positions ([index, [x, y]] pairs) in the current animation frame
 * by keying their deform offsets. Weighted vertices get the same world movement through each of
 * their bones.
 */
export function deformVertices(app, slot, att, moves) {
  const doc = app.doc;
  const anim = app.currentAnimation();
  if (!anim || !moves.length) return;
  const time = Math.round(app.time * FPS) / FPS;
  const pose = app.pose();
  const flat = pose.worldVertices(doc, slot, att);
  const n = att.weights ? att.weights.reduce((s, v) => s + v.length * 2, 0) : att.vertices.length;
  const deltas = Array.from(pose.deform.get(`${slot}/${att.name}`) ?? new Float64Array(n));
  const offsets = [];
  if (att.weights) {
    let k = 0;
    for (const v of att.weights) {
      offsets.push(k);
      k += v.length * 2;
    }
  }
  for (const [index, world] of moves) {
    const move = [world[0] - flat[2 * index], world[1] - flat[2 * index + 1]];
    const local = (bone) => pose.world[bone].inverse().applyVector(move);
    if (att.weights) {
      let k = offsets[index];
      for (const w of att.weights[index]) {
        const [dx, dy] = local(w.bone);
        deltas[k++] += dx;
        deltas[k++] += dy;
      }
    } else {
      const [dx, dy] = local(doc.slots[slot].bone);
      deltas[2 * index] += dx;
      deltas[2 * index + 1] += dy;
    }
  }
  // The deform timeline of this attachment in the skin that holds it.
  const skin = doc.slots[slot].attachments.includes(att) ? null : doc.skin;
  let timeline = anim.deform.find((d) => d.slot === slot && d.attachment === att.name && (d.skin ?? null) === skin);
  if (!timeline) anim.deform.push((timeline = { slot, attachment: att.name, skin, keys: [] }));
  setKey(timeline.keys, time, { offset: 0, vertices: deltas });
  app.changed();
}
