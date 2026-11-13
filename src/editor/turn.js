// SPDX-License-Identifier: MIT OR Apache-2.0
// 2.5D turn: the parts on a bone (a head, a body) turn left and right as if they were 3D. Each part
// gets a depth (from the draw order: front parts near, back hair and ears far) on a curved surface
// (a cylinder through the parts' bounds); a turn rotates every vertex around a vertical axis and
// draws it flat again, so parts shift by their depth, edges foreshorten and back parts slide the
// other way. It is stored as ordinary skeleton data, so every runtime plays it: a "turn" animation
// of mesh deform keys sampled from full left (time 0) to full right (time 1), and a slider
// constraint whose time comes from a control bone's x. No DOM: tested under Node.

import { Animation, setKey } from '../core/animation.js';
import { addConstraint, listConstraints, removeConstraint, uniqueConstraintName } from '../core/constraintdata.js';
import { invalidateConstraints } from '../core/constraints.js';
import { toAffine, transform } from '../core/math.js';
import { makeBone, uniqueName } from '../core/model.js';
import { Pose } from '../core/pose.js';

/** Keys of the turn animation, from full left to full right (odd, so straight ahead is one). */
export const TURN_SAMPLES = 9;
/** Defaults: the largest turn (degrees), the surface's roundness (0 flat, 1 a full cylinder), the control's travel for a full turn. */
export const TURN_DEFAULTS = { angle: 25, bulge: 0.6, reach: 100 };

/** Bones in `root`'s branch (itself and every bone below it). */
function branch(doc, root) {
  const out = new Set([root]);
  doc.bones.forEach((b, i) => {
    for (let p = b.parent; p !== null && p !== undefined; p = doc.bones[p].parent) {
      if (out.has(p)) {
        out.add(i);
        break;
      }
    }
  });
  // Parents precede children in a skeleton, but a second pass costs nothing and is safe.
  doc.bones.forEach((b, i) => out.has(b.parent) && out.add(i));
  return out;
}

/** The attachment a slot shows in the setup pose (default skin or the active one). */
function shown(doc, slot) {
  const s = doc.slots[slot];
  return s.attachment ? doc.attachment(slot, s.attachment) : null;
}

const turnable = (att) => att && (att.type === 'region' || att.type === 'mesh');

/** The slots a turn of `bone` moves: those on it and on the bones below it that show a picture. */
export function turnSlots(doc, bone) {
  const bones = branch(doc, bone);
  return doc.slots.map((s, i) => i).filter((i) => bones.has(doc.slots[i].bone) && turnable(shown(doc, i)));
}

/** World vertices (flat x, y) of a slot's shown picture in `pose`, without any deform. */
function worldPoints(doc, pose, slot, att) {
  if (att.type === 'region') {
    const m = toAffine(att.offset);
    const hw = att.width / 2;
    const hh = att.height / 2;
    const w = pose.world[doc.slots[slot].bone];
    return [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].flatMap((p) => w.apply(m.apply(p)));
  }
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
  const out = [];
  for (let i = 0; i + 1 < att.vertices.length; i += 2) out.push(m.a * att.vertices[i] + m.c * att.vertices[i + 1] + m.tx, m.b * att.vertices[i] + m.d * att.vertices[i + 1] + m.ty);
  return out;
}

/**
 * A new turn for the parts on `bone`: { name, bone, angle, bulge, reach, center: [x, y], radius,
 * parts: [{ slot, attachment, depth }] } (names, so it survives reordering). Depth comes from the
 * draw order, front parts nearest; null when the bone has no pictures.
 */
export function planTurn(doc, bone, pose = new Pose(doc)) {
  const slots = turnSlots(doc, bone);
  if (!slots.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of slots) {
    const pts = worldPoints(doc, pose, s, shown(doc, s));
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]);
      y1 = Math.max(y1, pts[i + 1]);
    }
  }
  const radius = Math.max(1, (x1 - x0) / 2);
  // Draw order: the first slot is at the back. Depths spread over half the radius, front positive.
  const n = slots.length;
  const parts = slots.map((s, k) => ({
    slot: doc.slots[s].name,
    attachment: doc.slots[s].attachment,
    depth: n > 1 ? Math.round(((k / (n - 1)) - 0.5) * radius * 0.5 * 100) / 100 : 0,
  }));
  return {
    name: `${doc.bones[bone].name}-turn`,
    bone: doc.bones[bone].name,
    ...TURN_DEFAULTS,
    center: [(x0 + x1) / 2, (y0 + y1) / 2],
    top: y1,
    radius,
    parts,
  };
}

/**
 * Deform deltas (in the attachment's own space, as deform keys store them) that turn `att` in
 * `slot` by `t` (-1 full left .. 1 full right) for `turn`, from the setup `pose`.
 */
export function turnDeltas(doc, pose, turn, slot, att, depth, t) {
  const theta = (t * turn.angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const [cx] = turn.center;
  const r = turn.radius;
  const pts = worldPoints(doc, pose, slot, att);
  // The world offset of each vertex: rotated around the vertical axis through the centre, drawn flat.
  const dx = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] - cx;
    const z = depth + turn.bulge * Math.sqrt(Math.max(0, r * r - x * x));
    dx.push(x * cos + z * sin - x);
  }
  // Into the space deform keys use: the slot's bone, or each weight's bone (weights sum to 1).
  const local = (bone, wx) => {
    const m = pose.world[bone];
    const det = m.a * m.d - m.b * m.c || 1;
    return [(m.d * wx) / det, (-m.b * wx) / det];
  };
  const out = [];
  if (att.weights) {
    att.weights.forEach((v, i) => {
      for (const w of v) out.push(...local(w.bone, dx[i]));
    });
  } else {
    const bone = doc.slots[slot].bone;
    dx.forEach((d) => out.push(...local(bone, d)));
  }
  return out.map((v) => Math.round(v * 1000) / 1000);
}

/** A region as a grid mesh (so a turn can curve it), `cells` across its longer side. */
export function regionToGrid(att, cells) {
  const m = toAffine(att.offset);
  const ratio = att.width / att.height;
  const cols = Math.max(1, ratio >= 1 ? cells : Math.round(cells * ratio));
  const rows = Math.max(1, ratio >= 1 ? Math.round(cells / ratio) : cells);
  const vertices = [];
  const uvs = [];
  // Outline first (Spine's hull), clockwise from the top left, then the inside points.
  const ring = [];
  for (let c = 0; c <= cols; c++) ring.push([c, 0]);
  for (let r = 1; r <= rows; r++) ring.push([cols, r]);
  for (let c = cols - 1; c >= 0; c--) ring.push([c, rows]);
  for (let r = rows - 1; r >= 1; r--) ring.push([0, r]);
  const inside = [];
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) inside.push([c, r]);
  const index = new Map();
  [...ring, ...inside].forEach(([c, r], i) => {
    index.set(`${c},${r}`, i);
    const u = c / cols;
    const v = r / rows;
    const [x, y] = m.apply([(u - 0.5) * att.width, (0.5 - v) * att.height]);
    vertices.push(x, y);
    uvs.push(u, v);
  });
  const triangles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = index.get(`${c},${r}`);
      const b = index.get(`${c + 1},${r}`);
      const d = index.get(`${c},${r + 1}`);
      const e = index.get(`${c + 1},${r + 1}`);
      triangles.push(a, b, e, a, e, d);
    }
  }
  const mesh = { name: att.name, type: 'mesh', image: att.image, uvs, triangles, hull: ring.length, vertices, width: att.width, height: att.height };
  for (const key of ['color', 'sequence', 'sourceName', 'extra']) if (att[key] !== undefined) mesh[key] = att[key];
  return mesh;
}

/** Replaces `old` with `neu` wherever it is listed (default skin and other skins). */
function replaceAttachment(doc, old, neu) {
  const lists = doc.slots.map((s) => s.attachments);
  for (const skin of doc.skins) for (const e of skin.slots) lists.push(e.attachments);
  for (const list of lists) {
    const i = list.indexOf(old);
    if (i >= 0) list[i] = neu;
  }
}

/**
 * Takes a turn's skeleton data out: its animation and constraint, and its control bone unless
 * `keepControl` (a rebuild keeps it, with any keys animators gave it). The meshes stay.
 */
export function clearTurn(doc, turn, keepControl = false) {
  if (turn.constraint && listConstraints(doc).some((c) => c.name === turn.constraint)) removeConstraint(doc, turn.constraint);
  const anim = doc.animations.findIndex((a) => a.name === turn.animation);
  if (anim >= 0) doc.animations.splice(anim, 1);
  const control = doc.bones.findIndex((b) => b.name === turn.control);
  if (control > 0 && !keepControl) doc.removeBone(control);
  invalidateConstraints(doc);
}

/**
 * Builds (or rebuilds) `turn` in `doc`: region parts become grid meshes, then a control bone above
 * the turned bone, the turn animation (deform keys from full left to full right) and a slider
 * constraint that plays it from the control's x. Stores the turn in `doc.turns`. Returns it.
 */
export function buildTurn(doc, turn) {
  const existing = doc.turns.findIndex((x) => x.name === turn.name);
  let kept = null;
  if (existing >= 0) {
    kept = doc.turns[existing].control;
    clearTurn(doc, doc.turns[existing], true);
    doc.turns.splice(existing, 1);
  }
  const bone = doc.bones.findIndex((b) => b.name === turn.bone);
  if (bone < 0) throw new Error(`no bone '${turn.bone}'`);
  // Regions cannot bend: they become grid meshes (finer for bigger pictures).
  const parts = [];
  for (const part of turn.parts) {
    const slot = doc.slots.findIndex((s) => s.name === part.slot);
    if (slot < 0) continue;
    let att = doc.attachment(slot, part.attachment);
    if (!turnable(att)) continue;
    if (att.type === 'region') {
      const mesh = regionToGrid(att, Math.min(8, Math.max(2, Math.round(Math.max(att.width, att.height) / 24))));
      replaceAttachment(doc, att, mesh);
      att = mesh;
    }
    parts.push({ ...part, index: slot, att });
  }
  const pose = new Pose(doc);
  // The control: a point bone above the turned bone; its x (in the turned bone's space) turns it.
  let control = kept && doc.bones.some((b) => b.name === kept) ? kept : null;
  if (!control) {
    control = uniqueName(`${turn.name}-control`, (n) => doc.bones.some((b) => b.name === n));
    const above = pose.world[bone].inverse().apply([turn.center[0], turn.top + turn.radius * 0.35]);
    doc.addBone(makeBone(control, bone, transform(above[0], above[1], 0), 0));
  }
  // The animation: deform keys from full left (0) through straight ahead (0.5) to full right (1).
  const name = uniqueName(turn.name, (n) => doc.animations.some((a) => a.name === n));
  const anim = new Animation(name, 1);
  for (const part of parts) {
    const keys = [];
    for (let k = 0; k < TURN_SAMPLES; k++) {
      const time = k / (TURN_SAMPLES - 1);
      setKey(keys, time, { offset: 0, vertices: turnDeltas(doc, pose, turn, part.index, part.att, part.depth, time * 2 - 1) });
    }
    anim.deform.push({ slot: part.index, attachment: part.att.name, skin: null, keys });
  }
  doc.animations.push(anim);
  // The slider: control x -reach .. reach plays the animation's 0 .. 1.
  const constraint = uniqueConstraintName(doc, turn.name);
  addConstraint(doc, { type: 'slider', name: constraint, animation: name, bone: control, property: 'x', local: true, scale: 1 / (2 * turn.reach), offset: 0.5 });
  invalidateConstraints(doc);
  const stored = { ...turn, parts: parts.map(({ slot, attachment, depth }) => ({ slot, attachment, depth })), control, animation: name, constraint };
  doc.turns.push(stored);
  return stored;
}

/** Removes a turn: its control bone, animation and constraint (the meshes stay). */
export function removeTurn(doc, name) {
  const i = doc.turns.findIndex((x) => x.name === name);
  if (i < 0) return false;
  clearTurn(doc, doc.turns[i]);
  doc.turns.splice(i, 1);
  return true;
}

/** The turn of `bone` (by name), or null. */
export function turnOf(doc, bone) {
  return doc.turns.find((x) => x.bone === doc.bones[bone]?.name) ?? null;
}
