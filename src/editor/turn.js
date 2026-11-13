// SPDX-License-Identifier: MIT OR Apache-2.0
// 2.5D turn: the parts on a bone (a head, a body) turn left and right as if they were 3D. Each part
// gets a depth (from the draw order: front parts near, back hair and ears far) on a curved surface
// (a cylinder through the parts' bounds); a turn rotates every vertex around a vertical axis and
// draws it flat again, so parts shift by their depth, edges foreshorten and back parts slide the
// other way. It is stored as ordinary skeleton data, so every runtime plays it: a "turn" animation
// of mesh deform keys sampled from full left (time 0) to full right (time 1), and a slider
// constraint whose time comes from a control bone's x. Tilting up and down is the same around the
// horizontal axis, from the control's y; both sliders are additive, so they combine. No DOM: tested
// under Node.

import { Animation, setKey } from '../core/animation.js';
import { addConstraint, listConstraints, removeConstraint, uniqueConstraintName } from '../core/constraintdata.js';
import { invalidateConstraints } from '../core/constraints.js';
import { toAffine, transform } from '../core/math.js';
import { makeBone, uniqueName } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { bakeWarps, createWarp, keyWarp, pointsOf, removeWarp } from './warp.js';

/** Keys of the turn animation, from full left to full right (odd, so straight ahead is one). */
export const TURN_SAMPLES = 9;
/**
 * Defaults: the largest turn and tilt (degrees), the surface's roundness (0 flat, 1 round), the
 * control's travel for a full turn or tilt.
 */
export const TURN_DEFAULTS = { angle: 20, tilt: 12, bulge: 0.4, reach: 100 };
/** Parts narrower than this share of the surface's radius move as one piece (features, not the face). */
const RIGID = 0.7;

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
  const radiusY = Math.max(1, (y1 - y0) / 2);
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
    radiusY,
    parts,
  };
}

/**
 * Deform deltas (in the attachment's own space, as deform keys store them) that turn `att` in
 * `slot` by `t` for `turn`, from the setup `pose`. `axis` 'x' turns (-1 full left .. 1 full
 * right, around the vertical axis); 'y' tilts (-1 down .. 1 up, around the horizontal axis).
 */
export function turnDeltas(doc, pose, turn, slot, att, depth, t, axis = 'x') {
  const tilt = axis === 'y';
  const theta = (t * (tilt ? turn.tilt ?? TURN_DEFAULTS.tilt : turn.angle) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const c = turn.center[tilt ? 1 : 0];
  const r = tilt ? turn.radiusY ?? Math.max(1, turn.top - turn.center[1]) : turn.radius;
  const pts = worldPoints(doc, pose, slot, att);
  // How far each vertex moves along the axis: rotated around the centre in 3D, drawn flat again.
  const along = [];
  for (let i = 0; i < pts.length; i += 2) along.push(pts[i + (tilt ? 1 : 0)] - c);
  const height = (u) => turn.bulge * Math.sqrt(Math.max(0, r * r - u * u));
  const project = (u) => u * cos + (depth + height(u)) * sin - u;
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  let moves;
  if (hi - lo < r * RIGID) {
    // A small part (an eye, a nose, a mouth) moves as one piece, like a drawing on the surface: it
    // slides with its centre and squashes by the surface's slope there, but does not bend.
    const uc = (lo + hi) / 2;
    const root = Math.sqrt(Math.max(1e-6, r * r - uc * uc));
    const slope = cos - ((turn.bulge * uc) / root) * sin;
    const mc = project(uc);
    moves = along.map((u) => mc + (u - uc) * (slope - 1));
  } else {
    // A big part (the face, the hair) follows the curved surface.
    moves = along.map(project);
  }
  // Into the space deform keys use: the slot's bone, or each weight's bone (weights sum to 1).
  const local = (bone, d) => {
    const m = pose.world[bone];
    const det = m.a * m.d - m.b * m.c || 1;
    const wx = tilt ? 0 : d;
    const wy = tilt ? d : 0;
    return [(m.d * wx - m.c * wy) / det, (-m.b * wx + m.a * wy) / det];
  };
  const out = [];
  if (att.weights) {
    att.weights.forEach((v, i) => {
      for (const w of v) out.push(...local(w.bone, moves[i]));
    });
  } else {
    const bone = doc.slots[slot].bone;
    moves.forEach((d) => out.push(...local(bone, d)));
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
  for (const name of [turn.constraint, turn.tiltConstraint]) if (name && listConstraints(doc).some((c) => c.name === name)) removeConstraint(doc, name);
  for (const name of [turn.animation, turn.tiltAnimation]) {
    const anim = doc.animations.findIndex((a) => a.name === name);
    if (anim >= 0) doc.animations.splice(anim, 1);
  }
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
  // Two animations of deform keys, from one extreme (0) through straight ahead (0.5) to the other
  // (1): the turn (left to right) and the tilt (down to up). Each plays from an additive slider on
  // the control (its x, its y), so turn and tilt combine, and add to the meshes' own deform keys.
  const made = {};
  for (const axis of ['x', 'y']) {
    const base = axis === 'x' ? turn.name : `${turn.name}-tilt`;
    const name = uniqueName(base, (n) => doc.animations.some((a) => a.name === n));
    const anim = new Animation(name, 1);
    for (const part of parts) {
      const keys = [];
      for (let k = 0; k < TURN_SAMPLES; k++) {
        const time = k / (TURN_SAMPLES - 1);
        setKey(keys, time, { offset: 0, vertices: turnDeltas(doc, pose, turn, part.index, part.att, part.depth, time * 2 - 1, axis) });
      }
      anim.deform.push({ slot: part.index, attachment: part.att.name, skin: null, keys });
    }
    doc.animations.push(anim);
    const constraint = uniqueConstraintName(doc, base);
    // Straight ahead is where the control rests (its setup position), not 0.
    const scale = 1 / (2 * turn.reach);
    const rest = doc.bones[doc.boneIndex(control)].setup[axis];
    addConstraint(doc, { type: 'slider', name: constraint, animation: name, bone: control, property: axis, local: true, additive: true, scale, offset: Math.round((0.5 - rest * scale) * 1e9) / 1e9 });
    made[axis] = { name, constraint, rest };
  }
  invalidateConstraints(doc);
  const stored = {
    ...TURN_DEFAULTS,
    ...turn,
    parts: parts.map(({ slot, attachment, depth }) => ({ slot, attachment, depth })),
    control,
    animation: made.x.name,
    constraint: made.x.constraint,
    tiltAnimation: made.y.name,
    tiltConstraint: made.y.constraint,
    rest: [made.x.rest, made.y.rest],
  };
  doc.turns.push(stored);
  // Sides shaped by hand (shapeSide) are baked again into the new turn animations.
  if (doc.warps?.length) bakeWarps(doc);
  return stored;
}

/** Removes a turn: its control bone, animation and constraint (the meshes stay). */
export function removeTurn(doc, name) {
  const i = doc.turns.findIndex((x) => x.name === name);
  if (i < 0) return false;
  clearTurn(doc, doc.turns[i]);
  doc.turns.splice(i, 1);
  if (removeWarp(doc, `${name}-shape`)) bakeWarps(doc);
  return true;
}

/** Where each side of a turn is: its animation and time, and where the control goes to show it. */
export const SIDES = { left: ['x', 0, -1], right: ['x', 1, 1], down: ['y', 0, -1], up: ['y', 1, 1] };

/**
 * Gets a side of `turn` ready to shape by hand: a lattice over the turned parts (one per turn,
 * "<turn>-shape"), with a key at straight ahead that changes nothing (so other angles stay as they
 * are) and one at the side. Dragging the lattice's points then keys that side, and every angle in
 * between blends to it. Returns { warp, anim, time, axis, sign }.
 */
export function shapeSide(doc, turn, side) {
  const [axis, time, sign] = SIDES[side];
  const name = `${turn.name}-shape`;
  let warp = doc.warps.find((w) => w.name === name);
  if (!warp) {
    const taken = new Set(doc.warps.flatMap((w) => w.targets.map((x) => `${x.slot}/${x.attachment}`)));
    const slots = turn.parts.map((p) => doc.slots.findIndex((s) => s.name === p.slot)).filter((s) => s >= 0 && !taken.has(`${doc.slots[s].name}/${doc.slots[s].attachment}`));
    warp = createWarp(doc, { name, bone: doc.boneIndex(turn.bone), slots, cols: 4, rows: 4, parent: null });
    if (!warp) return null;
  }
  const anim = axis === 'x' ? turn.animation : turn.tiltAnimation;
  const zeros = new Array(pointsOf(warp) * 2).fill(0);
  const has = (t) => warp.keys?.[anim]?.some((k) => Math.abs(k.time - t) < 1e-4);
  if (!has(0.5)) keyWarp(warp, anim, 0.5, zeros);
  if (!has(time)) keyWarp(warp, anim, time, zeros);
  return { warp, anim, time, axis, sign };
}

/** Has the side been shaped (any point moved)? */
export function sideShaped(doc, turn, side) {
  const [axis, time] = SIDES[side];
  const warp = doc.warps.find((w) => w.name === `${turn.name}-shape`);
  const anim = axis === 'x' ? turn.animation : turn.tiltAnimation;
  const key = warp?.keys?.[anim]?.find((k) => Math.abs(k.time - time) < 1e-4);
  return !!key && key.offsets.some((v) => Math.abs(v) > 1e-6);
}

/** The turn of `bone` (by name), or null. */
export function turnOf(doc, bone) {
  return doc.turns.find((x) => x.bone === doc.bones[bone]?.name) ?? null;
}
