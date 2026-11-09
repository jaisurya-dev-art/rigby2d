// SPDX-License-Identifier: MIT OR Apache-2.0
// Mesh authoring: turning images into meshes, editing vertices, binding meshes to bones and
// painting weights. Editing happens on the setup pose, in world space; the mesh is written back
// in the slot bone's space (unweighted) or each bone's space (weighted).

import { toAffine } from '../core/math.js';
import { autoWeights, paintWeights, triangulateMesh, uvAt, weightsAt } from '../core/meshgeom.js';
import { generateMesh } from '../core/meshgen.js';
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

/** The mesh as editable world-space data: { points, uvs, weights (or null), hull }. */
export function meshState(doc, slot, att) {
  const pose = new Pose(doc);
  const flat = pose.worldVertices(doc, slot, att);
  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  const uvs = [];
  for (let i = 0; i + 1 < att.uvs.length; i += 2) uvs.push([att.uvs[i], att.uvs[i + 1]]);
  const weights = att.weights ? att.weights.map((v) => v.map((w) => ({ bone: w.bone, weight: w.weight }))) : null;
  return { points, uvs, weights, hull: att.hull ?? points.length, triangles: att.triangles.slice() };
}

/**
 * Writes edited world-space data back into the mesh (re-triangulated). Returns the number of
 * deform keys removed because the vertices changed.
 */
export function writeMesh(doc, slot, att, state, { topology = true } = {}) {
  const pose = new Pose(doc);
  att.uvs = state.uvs.flat();
  att.hull = state.hull;
  if (topology) {
    att.triangles = triangulateMesh(state.points, state.hull);
    delete att.edges;
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
  return dropDeformKeys(doc, slot, att.name);
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
 * weighted mesh keeps its weights (interpolated at the new vertices). Returns the generator's
 * result ({ hull, points, islands, ... } plus removed deform keys), or null when the image is
 * missing or has no pixels above the threshold.
 */
export function generateFromImage(app, slot, att, options) {
  const image = att.image ?? att.name;
  const canvas = app.images.get(image);
  if (!canvas || app.images.alphaAt(image, 0, 0) === null) return null;
  const alpha = { width: canvas.width, height: canvas.height, data: app.images.map.get(image).alpha };
  const gen = generateMesh(alpha, options);
  if (!gen) return null;
  const doc = app.doc;
  const state = meshState(doc, slot, att);
  const toWorld = fitAffine(state.uvs, state.points);
  const uvs = [];
  for (let i = 0; i < gen.uvs.length; i += 2) uvs.push([gen.uvs[i], gen.uvs[i + 1]]);
  const points = uvs.map(toWorld);
  const weights = state.weights ? points.map((p) => {
    const w = weightsAt(p, state.points, state.weights, state.triangles);
    return w.length ? w : state.weights[0];
  }) : null;
  const removed = writeMesh(doc, slot, att, { points, uvs, weights, hull: gen.hull });
  return { ...gen, removed };
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
    if (t.mode !== 'deform') return meshState(this.app.doc, t.slot, t.att).points;
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
    const changed = paintWeights(state.points, state.weights, bone, this.viewport.toWorld(pos), radius, (t.edit.strength ?? 0.5) * 0.25, this.drag.subtract);
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
    for (const i of sel) {
      if (i >= state.points.length) continue;
      state.points.splice(i, 1);
      state.uvs.splice(i, 1);
      if (state.weights) state.weights.splice(i, 1);
      if (i < state.hull) state.hull--;
    }
    t.edit.selection = new Set();
    t.edit.selected = null;
    this.commit(t, state);
    return true;
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
    const sel = this.selection(t);
    pts.forEach((p, i) => {
      const picked = sel.has(i);
      ctx.beginPath();
      ctx.arc(p[0], p[1], picked ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = weightsMode ? heat(weightOf(i)).replace(/[\d.]+\)$/, '1)') : picked ? 'white' : i < state.hull ? 'rgb(255,170,40)' : 'rgb(120,200,255)';
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
