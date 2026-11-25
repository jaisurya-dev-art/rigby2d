// SPDX-License-Identifier: MIT OR Apache-2.0
// Rig and pose operations built on the core model, with no DOM: duplicating a bone's branch (plain, or
// mirrored to the other side), and copying a pose to paste it back, as it was or flipped left to
// right. Used by the Edit menu, the tree's menu and their shortcuts; tested under Node.

import { Pose } from '../core/pose.js';

// ---- Sides ----------------------------------------------------------------------------------------

/** Name patterns for a side, with what each turns into: arm_l ⇄ arm_r, Arm.L ⇄ Arm.R, leftArm ⇄ rightArm… */
const SIDES = [
  [/([_.\- ])l$/, '$1r'],
  [/([_.\- ])r$/, '$1l'],
  [/([_.\- ])L$/, '$1R'],
  [/([_.\- ])R$/, '$1L'],
  [/^l([_.\- ])/, 'r$1'],
  [/^r([_.\- ])/, 'l$1'],
  [/^L([_.\- ])/, 'R$1'],
  [/^R([_.\- ])/, 'L$1'],
  [/left/, 'right'],
  [/right/, 'left'],
  [/Left/, 'Right'],
  [/Right/, 'Left'],
  [/LEFT/, 'RIGHT'],
  [/RIGHT/, 'LEFT'],
];

/** The other side's name (`arm_l` → `arm_r`), or null for a name with no side. */
export function otherSide(name) {
  for (const [re, to] of SIDES) if (re.test(name)) return name.replace(re, to);
  return null;
}

// ---- Duplicating --------------------------------------------------------------------------------

const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * Duplicates bone `bone` with every bone below it, under the same parent. With `slots`, the slots on
 * those bones are copied too (their default-skin attachments), drawn on top. With `mirror`, the copy
 * is the other side: names swapped (`arm_l` → `arm_r`, otherwise `_mirror` added) and the setup pose
 * mirrored across the vertical line through the root, so building one arm gives you both. Returns
 * the new top bone's index. Names that are taken get a number.
 */
export function duplicateBranch(doc, bone, { slots = true, mirror = false } = {}) {
  if (bone === 0) throw new Error('The root bone cannot be duplicated');
  const branch = [bone];
  for (let i = bone + 1; i < doc.bones.length; i++) if (branch.includes(doc.bones[i].parent)) branch.push(i);
  const names = branch.map((i) => doc.bones[i].name);
  const newName = (name) => (mirror ? (otherSide(name) ?? `${name}_mirror`) : `${name}_copy`);
  // Setup-pose world transforms by name (indices shift as bones are inserted).
  const before = new Pose(doc);
  const worldOf = new Map(doc.bones.map((b, i) => [b.name, before.world[i]]));
  const created = new Map(); // old name -> new name
  for (const name of names) {
    const i = doc.boneIndex(name);
    const src = doc.bones[i];
    const copy = clone(src);
    copy.name = doc.uniqueBoneName(newName(name));
    const parentOld = src.parent;
    const parentName = doc.bones[parentOld].name;
    copy.parent = doc.boneIndex(created.get(parentName) ?? parentName);
    if (mirror) copy.setup = mirroredSetup(doc, worldOf.get(name), src.setup, copy.parent);
    doc.addBone(copy);
    created.set(name, copy.name);
  }
  if (slots) {
    const n = doc.slots.length;
    for (let s = 0; s < n; s++) {
      const src = doc.slots[s];
      const boneName = doc.bones[src.bone].name;
      if (!created.has(boneName)) continue;
      const copy = clone(src);
      copy.name = doc.uniqueSlotName(mirror ? (otherSide(src.name) ?? `${src.name}_mirror`) : `${src.name}_copy`);
      copy.bone = doc.boneIndex(created.get(boneName));
      for (const att of copy.attachments) copyAttachment(doc, att, { created, mirror, worldOf });
      doc.slots.push(copy);
    }
  }
  return doc.boneIndex(created.get(names[0]));
}

/**
 * Fits a copied attachment to the copied bones: weighted vertices move to the new bones; mirrored,
 * everything flips across the bone (y negated), the image too (a negative y scale). A weight on a
 * bone outside the branch is mirrored through the world, staying on that bone.
 */
function copyAttachment(doc, att, { created, mirror, worldOf }) {
  if (att.weights) {
    for (const v of att.weights) {
      for (const w of v) {
        const name = doc.bones[w.bone]?.name;
        if (created.has(name)) {
          w.bone = doc.boneIndex(created.get(name));
          if (mirror) w.y = -w.y;
        } else if (mirror && worldOf.has(name)) {
          const m = worldOf.get(name);
          const [wx, wy] = m.apply([w.x, w.y]);
          [w.x, w.y] = m.inverse().apply([-wx, wy]);
        }
      }
    }
    return;
  }
  if (!mirror) return;
  if (att.offset) Object.assign(att.offset, mirrorLocal(att.offset));
  else if (Array.isArray(att.vertices)) for (let i = 1; i < att.vertices.length; i += 2) att.vertices[i] = -att.vertices[i];
}

/** A local transform seen in a mirrored frame: rotation and shear turn the other way, y flips. */
function mirrorLocal(t) {
  return { ...t, y: -(t.y ?? 0), rotation: -(t.rotation ?? 0), scale_y: -(t.scale_y ?? 1), shear_x: -(t.shear_x ?? 0), shear_y: -(t.shear_y ?? 0) };
}

/**
 * The setup transform of the mirrored copy of bone `i`, under `parent` (already created): its world
 * position mirrored across x = 0 and its direction turned to match, so the copy points the other way.
 */
function mirroredSetup(doc, w, src, parent) {
  const [ox, oy] = w.apply([0, 0]);
  const [tx, ty] = w.apply([1, 0]);
  // Mirrored world origin and direction.
  const mo = [-ox, oy];
  const md = [-(tx - ox), ty - oy];
  // The parent's world transform: an already-mirrored copy is computed fresh from the document.
  const pw = new Pose(doc).world[parent];
  const inv = pw.inverse();
  const lo = inv.apply(mo);
  const ld = inv.applyVector(md);
  return { ...src, x: lo[0], y: lo[1], rotation: (Math.atan2(ld[1], ld[0]) * 180) / Math.PI, shear_x: -(src.shear_x ?? 0), shear_y: -(src.shear_y ?? 0) };
}

// ---- Poses ----------------------------------------------------------------------------------------

const FIELDS = ['x', 'y', 'rotation', 'scale_x', 'scale_y', 'shear_x', 'shear_y'];

/** The pose of `bones` (indices; every bone when empty) as plain local transforms by bone name. */
export function copyPose(doc, pose, bones = []) {
  const list = bones.length ? bones : doc.bones.map((_, i) => i);
  const out = {};
  for (const i of list) out[doc.bones[i].name] = Object.fromEntries(FIELDS.map((f) => [f, pose.local[i][f] ?? 0]));
  return out;
}

/**
 * Where a copied pose goes: [[bone index, local transform]]. As copied, each bone gets its own
 * values. Flipped, a side bone takes its other side's motion and centre bones turn the other way:
 * each bone's change from its setup pose is mirrored (rotation and shear negated, the local y offset
 * negated; for the root, x), then added to the target's setup pose. Bones not in the document are
 * skipped.
 */
export function pastePose(doc, copied, { flipped = false } = {}) {
  const out = [];
  for (const [name, t] of Object.entries(copied)) {
    const from = doc.boneIndex(name);
    if (from === null) continue;
    if (!flipped) {
      out.push([from, { ...t }]);
      continue;
    }
    const targetName = otherSide(name) ?? name;
    const to = doc.boneIndex(targetName);
    if (to === null) continue;
    const s = doc.bones[from].setup;
    const d = Object.fromEntries(FIELDS.map((f) => [f, (t[f] ?? 0) - (s[f] ?? (f.startsWith('scale') ? 1 : 0))]));
    const ts = doc.bones[to].setup;
    const root = doc.bones[to].parent === null;
    const base = (f) => ts[f] ?? (f.startsWith('scale') ? 1 : 0);
    out.push([
      to,
      {
        x: base('x') + (root ? -d.x : d.x),
        y: base('y') + (root ? d.y : -d.y),
        rotation: base('rotation') - d.rotation,
        scale_x: base('scale_x') + d.scale_x,
        scale_y: base('scale_y') + d.scale_y,
        shear_x: base('shear_x') - d.shear_x,
        shear_y: base('shear_y') - d.shear_y,
      },
    ]);
  }
  return out;
}

// ---- IK / FK switching ----------------------------------------------------------------------------

/** A pose of `anim` at `time` (worlds included), with IK constraint `ik`'s mix forced to `mix`. */
export function poseWithIkMix(doc, anim, time, ik, mix) {
  const pose = new Pose(doc);
  if (anim) pose.apply(doc, anim, time, 1);
  if (pose.ik?.[ik]) pose.ik[ik].mix = mix;
  pose.updateWorld(doc);
  return pose;
}

/**
 * Switching an IK chain to FK without a jump: the local transforms that put its bones where IK has
 * them now ([[bone, local]]), to key, after which the mix can go to 0.
 */
export function fkMatchingIk(doc, anim, time, ik) {
  const pose = poseWithIkMix(doc, anim, time, ik, doc.ik[ik].mix ?? 1);
  const live = new Pose(doc);
  if (anim) live.apply(doc, anim, time, 1);
  return doc.ik[ik].bones.map((b) => {
    const parent = doc.bones[b].parent;
    const local = parent === null ? pose.world[b].decompose() : pose.world[parent].inverse().mul(pose.world[b]).decompose();
    // Keep the bone's own position (IK only turns bones); take the rotation, scale and shear.
    return [b, { ...live.local[b], rotation: local.rotation, scale_x: local.scale_x, scale_y: local.scale_y, shear_x: local.shear_x ?? 0, shear_y: local.shear_y ?? 0 }];
  });
}

/**
 * Switching an FK chain to IK without a jump: where the IK target goes (its local transform) so it
 * sits at the tip of the chain as FK has it now, after which the mix can go to 1.
 */
export function ikTargetMatchingFk(doc, anim, time, ik) {
  const c = doc.ik[ik];
  const fk = poseWithIkMix(doc, anim, time, ik, 0);
  const last = c.bones[c.bones.length - 1];
  const tip = fk.world[last].apply([doc.bones[last].length, 0]);
  const target = c.target;
  const parent = doc.bones[target].parent;
  const at = parent === null ? tip : fk.world[parent].inverse().apply(tip);
  const live = new Pose(doc);
  if (anim) live.apply(doc, anim, time, 1);
  return [target, { ...live.local[target], x: at[0], y: at[1] }];
}
