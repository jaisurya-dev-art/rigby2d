// SPDX-License-Identifier: MIT OR Apache-2.0
// Warp deformers: a lattice (a grid of points) over one or more meshes, in a bone's space. Moving
// its points reshapes the meshes smoothly; a child lattice can sit inside a parent, which bends the
// child's grid along with its meshes (a parent reshapes the whole part, children make local tweaks).
// Each vertex moves by a fixed bilinear mix of its cell's four points, so a warp's effect is linear in
// its points' offsets: it bakes exactly into ordinary mesh deform keys, and every runtime plays it.
//
// Editor data (work files only): doc.warps = [{ name, bone, parent, cols, rows, rect: { x, y, w, h },
// targets: [{ slot, attachment }], keys: { animation name: [{ time, curve, offsets }] } }] with
// offsets in the bone's space, (cols + 1) * (rows + 1) points, row by row from the bottom left; and
// doc.warpBase = { 'animation\nslot\nattachment': { keys, baked } }: the deform keys a mesh had of
// its own before warps added theirs, and the last keys baked, to notice changes made elsewhere.
// No DOM: tested under Node.

import { keyIndexAt, setKey } from '../core/animation.js';
import { LINEAR, STEPPED, ease } from '../core/curve.js';
import { Pose } from '../core/pose.js';

/** Frames per second warps are sampled at when a curve between keys is not straight. */
const BAKE_FPS = 30;

const pointsOf = (w) => (w.cols + 1) * (w.rows + 1);
const boneOf = (doc, w) => doc.boneIndex(w.bone);

/** The setup positions of a mesh's vertices in world space (flat x, y), no deform. */
function worldVertices(doc, pose, slot, att) {
  if (att.weights) {
    return att.weights.flatMap((v) => {
      let x = 0;
      let y = 0;
      for (const w of v) {
        const m = pose.world[w.bone];
        x += (m.a * w.x + m.c * w.y + m.tx) * w.weight;
        y += (m.b * w.x + m.d * w.y + m.ty) * w.weight;
      }
      return [x, y];
    });
  }
  const m = pose.world[doc.slots[slot].bone];
  const v = att.vertices ?? [];
  const out = [];
  for (let i = 0; i + 1 < v.length; i += 2) out.push(m.a * v[i] + m.c * v[i + 1] + m.tx, m.b * v[i] + m.d * v[i + 1] + m.ty);
  return out;
}

/** A world vector as local deltas for a mesh's deform keys (slot bone, or each weight's bone). */
function toDeform(doc, pose, slot, att, world) {
  const local = (bone, wx, wy) => {
    const m = pose.world[bone];
    const det = m.a * m.d - m.b * m.c || 1;
    return [(m.d * wx - m.c * wy) / det, (-m.b * wx + m.a * wy) / det];
  };
  const out = [];
  if (att.weights) {
    att.weights.forEach((v, i) => {
      for (const w of v) out.push(...local(w.bone, world[2 * i], world[2 * i + 1]));
    });
  } else {
    const bone = doc.slots[slot].bone;
    for (let i = 0; i < world.length; i += 2) out.push(...local(bone, world[i], world[i + 1]));
  }
  return out;
}

/** The meshes a warp moves: [{ slot, att }] that exist. */
function targetsOf(doc, w) {
  return w.targets
    .map((t) => {
      const slot = doc.slots.findIndex((s) => s.name === t.slot);
      const att = slot >= 0 ? doc.attachment(slot, t.attachment) : null;
      return att && att.type === 'mesh' ? { slot, att } : null;
    })
    .filter(Boolean);
}

/** A lattice's rest points in its bone's space: [x, y] row by row from the bottom left. */
export function latticePoints(w) {
  const out = [];
  for (let j = 0; j <= w.rows; j++) for (let i = 0; i <= w.cols; i++) out.push([w.rect.x + (w.rect.w * i) / w.cols, w.rect.y + (w.rect.h * j) / w.rows]);
  return out;
}

/**
 * The bilinear weights of a point (in the lattice's bone space) on the lattice's points: [index,
 * weight] pairs. Points outside the grid use its edge cells, extended (so a mesh a little larger
 * than its lattice still follows).
 */
export function latticeWeights(w, x, y) {
  const u = ((x - w.rect.x) / w.rect.w) * w.cols;
  const v = ((y - w.rect.y) / w.rect.h) * w.rows;
  const i = Math.min(w.cols - 1, Math.max(0, Math.floor(u)));
  const j = Math.min(w.rows - 1, Math.max(0, Math.floor(v)));
  const fu = u - i;
  const fv = v - j;
  const at = (ci, cj) => cj * (w.cols + 1) + ci;
  return [
    [at(i, j), (1 - fu) * (1 - fv)],
    [at(i + 1, j), fu * (1 - fv)],
    [at(i, j + 1), (1 - fu) * fv],
    [at(i + 1, j + 1), fu * fv],
  ];
}

/** The warps above `w` (its parent first, then the parent's parent...). */
function ancestors(doc, w) {
  const out = [];
  const seen = new Set([w.name]);
  for (let p = w.parent; p; ) {
    const parent = doc.warps.find((x) => x.name === p);
    if (!parent || seen.has(parent.name)) break;
    seen.add(parent.name);
    out.push(parent);
    p = parent.parent;
  }
  return out;
}

/**
 * How each point of lattice `w` moves (in world space, flat x, y) for the given offsets of every
 * warp (`offsets`: Map of warp name to its offsets in its bone's space): its own offsets plus what
 * its parents' lattices do where it sits.
 */
function latticeMotion(doc, pose, w, offsets) {
  const m = pose.world[boneOf(doc, w)];
  const own = offsets.get(w.name);
  const motion = [];
  const rest = latticePoints(w);
  for (let k = 0; k < rest.length; k++) {
    const ox = own ? own[2 * k] : 0;
    const oy = own ? own[2 * k + 1] : 0;
    motion.push(m.a * ox + m.c * oy, m.b * ox + m.d * oy);
  }
  if (w.parent) {
    const parent = doc.warps.find((x) => x.name === w.parent);
    if (parent && !ancestors(doc, w).some((a) => a === w)) {
      const pm = latticeMotion(doc, pose, parent, offsets);
      const pBone = pose.world[boneOf(doc, parent)].inverse();
      rest.forEach(([x, y], k) => {
        const [px, py] = pBone.apply(m.apply([x, y]));
        for (const [idx, wt] of latticeWeights(parent, px, py)) {
          motion[2 * k] += pm[2 * idx] * wt;
          motion[2 * k + 1] += pm[2 * idx + 1] * wt;
        }
      });
    }
  }
  return motion;
}

/**
 * Deform deltas for every mesh under warp `w`, for the warps' `offsets` (a Map by warp name):
 * [{ slot, att, deltas }]. Linear in the offsets.
 */
export function warpDeltas(doc, w, offsets, pose = new Pose(doc)) {
  const bone = boneOf(doc, w);
  if (bone === null || bone < 0) return [];
  const motion = latticeMotion(doc, pose, w, offsets);
  const toBone = pose.world[bone].inverse();
  return targetsOf(doc, w).map(({ slot, att }) => {
    const verts = worldVertices(doc, pose, slot, att);
    const world = [];
    for (let i = 0; i < verts.length; i += 2) {
      const [x, y] = toBone.apply([verts[i], verts[i + 1]]);
      let dx = 0;
      let dy = 0;
      for (const [idx, wt] of latticeWeights(w, x, y)) {
        dx += motion[2 * idx] * wt;
        dy += motion[2 * idx + 1] * wt;
      }
      world.push(dx, dy);
    }
    return { slot, att, deltas: toDeform(doc, pose, slot, att, world) };
  });
}

/** A warp's offsets at `time` in animation `name` (null when it has no keys there). */
export function warpOffsetsAt(w, name, time) {
  const keys = w.keys?.[name];
  if (!keys?.length) return null;
  const i = Math.max(0, keyIndexAt(keys, time));
  const a = keys[i];
  const b = keys[i + 1];
  if (!b || time <= a.time || a.curve === STEPPED) return a.offsets.slice();
  const e = ease(a.curve ?? LINEAR, (time - a.time) / (b.time - a.time), 0);
  return a.offsets.map((v, k) => v + (b.offsets[k] - v) * e);
}

/**
 * A new warp over the meshes `slots` (slot indices) showing now, on bone `bone`: a lattice of
 * `cols` x `rows` cells around their setup bounds (with a margin), in the bone's space.
 */
export function createWarp(doc, { name, bone, slots, cols = 4, rows = 4, parent = null }) {
  const pose = new Pose(doc);
  const toBone = pose.world[bone].inverse();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const targets = [];
  for (const s of slots) {
    const slot = doc.slots[s];
    const att = slot.attachment ? doc.attachment(s, slot.attachment) : null;
    if (!att || att.type !== 'mesh') continue;
    targets.push({ slot: slot.name, attachment: att.name });
    const v = worldVertices(doc, pose, s, att);
    for (let i = 0; i < v.length; i += 2) {
      const [x, y] = toBone.apply([v[i], v[i + 1]]);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (!targets.length) return null;
  const mx = Math.max(1, (x1 - x0) * 0.05);
  const my = Math.max(1, (y1 - y0) * 0.05);
  const warp = { name, bone: doc.bones[bone].name, parent, cols, rows, rect: { x: x0 - mx, y: y0 - my, w: x1 - x0 + 2 * mx, h: y1 - y0 + 2 * my }, targets, keys: {} };
  doc.warps.push(warp);
  return warp;
}

/**
 * Changes a lattice's grid (and, with `rect`, its area) keeping every key's deformation: the new
 * points take the old lattice's motion where they sit (Live2D 5.3's "resize keeping deformation").
 */
export function resizeWarp(w, cols, rows, rect = w.rect) {
  const old = { ...w, rect: { ...w.rect } };
  const next = { ...w, cols, rows, rect: { ...rect } };
  const pts = latticePoints(next);
  for (const keys of Object.values(w.keys ?? {})) {
    for (const key of keys) {
      const offsets = [];
      for (const [x, y] of pts) {
        let ox = 0;
        let oy = 0;
        for (const [idx, wt] of latticeWeights(old, x, y)) {
          ox += key.offsets[2 * idx] * wt;
          oy += key.offsets[2 * idx + 1] * wt;
        }
        offsets.push(ox, oy);
      }
      key.offsets = offsets;
    }
  }
  w.cols = cols;
  w.rows = rows;
  w.rect = { ...rect };
}

/** Sets warp `w`'s key at `time` in animation `name` to `offsets`. */
export function keyWarp(w, name, time, offsets) {
  w.keys ??= {};
  w.keys[name] ??= [];
  const keys = w.keys[name];
  const i = keys.findIndex((k) => Math.abs(k.time - time) < 5e-4);
  if (i >= 0) keys[i].offsets = offsets.slice();
  else {
    keys.push({ time, curve: LINEAR, offsets: offsets.slice() });
    keys.sort((a, b) => a.time - b.time);
  }
}

/**
 * Reshapes the setup pose: moves warp `w`'s meshes by `offsets` for good (their setup vertices,
 * or each weight's position), as in Setup mode, where a lattice edit is a shape change.
 */
export function applyToSetup(doc, w, offsets) {
  const map = new Map([[w.name, offsets]]);
  for (const { att, deltas } of warpDeltas(doc, w, map)) {
    if (att.weights) {
      let k = 0;
      for (const v of att.weights) {
        for (const wt of v) {
          wt.x += deltas[k++];
          wt.y += deltas[k++];
        }
      }
    } else {
      for (let i = 0; i < att.vertices.length; i++) att.vertices[i] += deltas[i];
    }
  }
}

const baseKey = (anim, slot, attachment) => `${anim}\n${slot}\n${attachment}`;
const zeros = (n) => new Array(n).fill(0);

/** Deform deltas a deform timeline gives at `time` (dense, length `n`). */
function sampleDense(keys, time, n) {
  const dense = (k) => {
    const d = zeros(n);
    const { offset = 0, vertices = [] } = k.value ?? {};
    for (let j = 0; j < vertices.length && offset + j < n; j++) d[offset + j] = vertices[j];
    return d;
  };
  if (!keys?.length) return zeros(n);
  const i = Math.max(0, keyIndexAt(keys, time));
  const a = keys[i];
  const b = keys[i + 1];
  const from = dense(a);
  if (!b || time <= a.time || a.curve === STEPPED) return from;
  const to = dense(b);
  const e = ease(a.curve, (time - a.time) / (b.time - a.time), 0);
  return from.map((v, j) => v + (to[j] - v) * e);
}

/**
 * Bakes every warp into the animations' mesh deform keys: each warped mesh's keys become its own
 * keys plus what the warps do. A mesh's own keys are kept in doc.warpBase, so baking again (after
 * an edit) never adds a warp twice; if its keys were changed elsewhere since the last bake (a turn
 * rebuilt, a vertex keyed by hand), the change is kept. Returns the number of timelines written.
 */
export function bakeWarps(doc) {
  doc.warpBase ??= {};
  const pose = new Pose(doc);
  let written = 0;
  const seen = new Set();
  for (const anim of doc.animations) {
    // The warps keyed in this animation, and the meshes they move (innermost warp per mesh).
    const keyed = doc.warps.filter((w) => w.keys?.[anim.name]?.length || ancestors(doc, w).some((a) => a.keys?.[anim.name]?.length));
    for (const w of keyed) {
      for (const { slot, att } of targetsOf(doc, w)) {
        const slotName = doc.slots[slot].name;
        const id = baseKey(anim.name, slotName, att.name);
        seen.add(id);
        let timeline = anim.deform.find((d) => d.slot === slot && d.attachment === att.name && (d.skin ?? null) === null);
        const stored = doc.warpBase[id];
        const current = timeline ? JSON.stringify(timeline.keys) : '[]';
        // The mesh's own keys: as stored, unless they were changed elsewhere since the last bake.
        const base = stored && stored.baked === current ? stored.keys : timeline ? JSON.parse(current) : [];
        const n = att.weights ? att.weights.reduce((s, v) => s + v.length * 2, 0) : att.vertices.length;
        // Times to key: every key of the warp, its parents and the mesh, and each frame between keys
        // whose curve is not straight (the bake is exact at its keys, and linear between them).
        const chain = [w, ...ancestors(doc, w)];
        const times = new Set(base.map((k) => k.time));
        let bent = base.some((k) => k.curve && k.curve !== LINEAR);
        for (const x of chain) {
          for (const k of x.keys?.[anim.name] ?? []) {
            times.add(k.time);
            if (k.curve && k.curve !== LINEAR) bent = true;
          }
        }
        if (bent) for (let t = 0; t <= anim.duration + 1e-9; t += 1 / BAKE_FPS) times.add(Math.round(t * 1e6) / 1e6);
        const keys = [];
        for (const time of [...times].sort((a, b) => a - b)) {
          const offsets = new Map();
          for (const x of chain) {
            const o = warpOffsetsAt(x, anim.name, time);
            if (o) offsets.set(x.name, o);
          }
          const own = sampleDense(base, time, n);
          const warp = offsets.size ? warpDeltas(doc, w, offsets, pose).find((d) => d.slot === slot && d.att === att)?.deltas ?? zeros(n) : zeros(n);
          setKey(keys, time, { offset: 0, vertices: own.map((v, j) => Math.round((v + warp[j]) * 1000) / 1000) }, LINEAR);
        }
        if (!timeline) anim.deform.push((timeline = { slot, attachment: att.name, skin: null, keys: [] }));
        timeline.keys = keys;
        doc.warpBase[id] = { keys: base, baked: JSON.stringify(keys) };
        written++;
      }
    }
  }
  // Meshes no warp moves any more get their own keys back.
  for (const [id, stored] of Object.entries(doc.warpBase)) {
    if (seen.has(id)) continue;
    const [animName, slotName, attName] = id.split('\n');
    const anim = doc.animations.find((a) => a.name === animName);
    const slot = doc.slots.findIndex((s) => s.name === slotName);
    if (anim && slot >= 0) {
      const timeline = anim.deform.find((d) => d.slot === slot && d.attachment === attName);
      if (timeline && JSON.stringify(timeline.keys) === stored.baked) {
        if (stored.keys.length) timeline.keys = stored.keys;
        else anim.deform.splice(anim.deform.indexOf(timeline), 1);
      }
    }
    delete doc.warpBase[id];
  }
  return written;
}

/** Removes a warp (its children move up to its parent); then bake again. */
export function removeWarp(doc, name) {
  const w = doc.warps.find((x) => x.name === name);
  if (!w) return false;
  for (const child of doc.warps) if (child.parent === name) child.parent = w.parent;
  doc.warps.splice(doc.warps.indexOf(w), 1);
  return true;
}

/** Number of lattice points of a warp. */
export { pointsOf };
