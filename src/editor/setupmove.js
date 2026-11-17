// SPDX-License-Identifier: MIT OR Apache-2.0
// Moving a bone on its own in Setup mode: its child bones and its images stay where they are drawn,
// so a joint can be moved, turned or resized after the rig is built (Spine calls this compensation).
// No DOM, so it is unit-tested in Node; edit.js calls it for every Setup-mode bone edit while the
// toolbar's "Bone only" toggle is on.

import { Pose } from '../core/pose.js';
import { moveAttachment } from '../core/model.js';
import { cloneTransform } from '../core/math.js';

/** World transforms of the setup pose without constraints (the rest pose the setup values describe). */
export function setupWorld(doc) {
  const pose = new Pose(doc);
  pose.applied = pose.local.map((l) => ({ ...l }));
  pose.computeWorld(doc);
  return pose.world;
}

// Every attachment of a slot: the default skin and the other skins.
function slotAttachments(doc, slot) {
  const out = [...(doc.slots[slot].attachments ?? [])];
  for (const skin of doc.skins) for (const e of skin.slots) if (e.slot === slot) out.push(...(e.attachments ?? []));
  return out;
}

const EPS = 1e-6;
const sameAffine = (m, n) =>
  Math.abs(m.a - n.a) < EPS && Math.abs(m.b - n.b) < EPS && Math.abs(m.c - n.c) < EPS && Math.abs(m.d - n.d) < EPS && Math.abs(m.tx - n.tx) < 1e-4 && Math.abs(m.ty - n.ty) < 1e-4;
const sameTransform = (a, b) => ['x', 'y', 'rotation', 'scale_x', 'scale_y', 'shear_x', 'shear_y'].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-6);

/**
 * Sets `bone`'s setup transform to `setup` while nothing else moves on screen, measured in the pose
 * as shown (constraints applied):
 * - its direct child bones keep their place (grandchildren follow their parents);
 * - in an IK chain the solver owns the bone's rotation, so the bone just moves to its new place, and
 *   each IK target the change affects is moved with the end of its chain, so the chain solves to the
 *   same pose instead of turning (the other bones of the chain stay as they are);
 * - its images and weighted vertices (and those of any bone that still ends up elsewhere) are
 *   re-expressed so they stay where they are drawn.
 * Child bones in `follow` (selected along with it) move with it, and their pictures too.
 */
export function setBoneSetupOnly(doc, bone, setup, follow = null) {
  const shown = () => new Pose(doc);
  const start = shown();
  const before = start.world.map((m) => m.clone());
  const chained = new Set(doc.ik.flatMap((k) => k.bones));
  // Bones another kind of constraint places (posed differently from their setup values): left to it.
  const driven = new Set();
  start.local.forEach((l, i) => {
    if (!chained.has(i) && start.applied[i] && !sameTransform(start.applied[i], l)) driven.add(i);
  });
  // Bones carried along: those selected with it and everything under them.
  const carried = new Set();
  doc.bones.forEach((b, i) => {
    if (i !== bone && (follow?.has(i) || (b.parent !== null && carried.has(b.parent)))) carried.add(i);
  });

  doc.bones[bone].setup = setup;
  // Where the edited bone goes. In an IK chain only its place changes: its turn is the solver's.
  let moved;
  if (chained.has(bone)) {
    const p = doc.bones[bone].parent;
    const [tx, ty] = p === null ? [setup.x, setup.y] : before[p].apply([setup.x, setup.y]);
    moved = before[bone].clone();
    moved.tx = tx;
    moved.ty = ty;
  } else {
    moved = shown().world[bone].clone();
  }
  // Direct children keep their place, worked out against the bone's new place with each child's
  // own inheritance (a foot that does not inherit rotation, say).
  const children = doc.bones.map((b, i) => i).filter((i) => doc.bones[i].parent === bone && !carried.has(i) && !driven.has(i));
  if (children.length) {
    const pose = shown();
    pose.setWorlds(doc, new Map([[bone, moved], ...children.map((i) => [i, before[i]])]));
    for (const i of children) doc.bones[i].setup = cloneTransform(pose.applied[i]);
  }

  // IK targets: moved until the end of each chain is where it should be (only the edited bone may
  // have moved), so the solver gives the pose as drawn. A few steps cover softness and stretch.
  for (const c of doc.ik) {
    if (!c.bones.length || c.mix <= 0 || c.target === bone || carried.has(c.target)) continue;
    const end = c.bones[c.bones.length - 1];
    if (carried.has(end)) continue;
    const reach = doc.bones[end].length || 1;
    const want = (end === bone ? moved : before[end]).apply([reach, 0]);
    const t = doc.bones[c.target];
    // The chain's end for the target at local (x, y): Newton steps with a measured 2x2 Jacobian
    // (softness makes the response non-linear near full reach).
    const tipAt = (x, y) => {
      t.setup = { ...t.setup, x, y };
      return shown().world[end].apply([reach, 0]);
    };
    // First guess: the target carried along with the end of the chain.
    let x = t.setup.x;
    let y = t.setup.y;
    if (end === bone) {
      const pose = shown();
      const goal = moved.mul(before[end].inverse()).apply(before[c.target].apply([0, 0]));
      [x, y] = t.parent === null ? goal : pose.world[t.parent].inverse().apply(goal);
    }
    const err = (g) => Math.hypot(want[0] - g[0], want[1] - g[1]);
    let got = tipAt(x, y);
    for (let k = 0; k < 16 && err(got) > 1e-9; k++) {
      const h = 0.01;
      const gx = tipAt(x + h, y);
      const gy = tipAt(x, y + h);
      const j11 = (gx[0] - got[0]) / h;
      const j21 = (gx[1] - got[1]) / h;
      const j12 = (gy[0] - got[0]) / h;
      const j22 = (gy[1] - got[1]) / h;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-9) break;
      const ex = want[0] - got[0];
      const ey = want[1] - got[1];
      let dx = (j22 * ex - j12 * ey) / det;
      let dy = (j11 * ey - j21 * ex) / det;
      // Halve a step that makes it worse (it can jump to the chain's other bend).
      let next = tipAt(x + dx, y + dy);
      for (let s = 0; s < 8 && err(next) >= err(got); s++) {
        dx /= 2;
        dy /= 2;
        next = tipAt(x + dx, y + dy);
      }
      if (err(next) >= err(got)) break;
      x += dx;
      y += dy;
      got = next;
    }
    t.setup = { ...t.setup, x, y };
  }
  const after = shown().world;

  // old bone space -> new bone space, for every bone that ended up somewhere else.
  const toNew = new Map();
  after.forEach((m, i) => {
    if (!carried.has(i) && !sameAffine(m, before[i])) toNew.set(i, m.inverse().mul(before[i]));
  });
  const seen = new Set();
  doc.slots.forEach((s, i) => {
    for (const att of slotAttachments(doc, i)) {
      if (!att || seen.has(att)) continue;
      seen.add(att);
      if (att.weights) {
        // Weighted vertices are in each bone's space: only the entries of moved bones change.
        for (const v of att.weights) for (const w of v) if (toNew.has(w.bone)) [w.x, w.y] = toNew.get(w.bone).apply([w.x, w.y]);
      } else if (toNew.has(s.bone)) {
        moveAttachment(att, toNew.get(s.bone));
      }
    }
  });
}
