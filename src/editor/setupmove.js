// SPDX-License-Identifier: MIT OR Apache-2.0
// Moving a bone on its own in Setup mode: its child bones and its images stay where they are drawn,
// so a joint can be moved, turned or resized after the rig is built (Spine calls this compensation).
// No DOM, so it is unit-tested in Node; edit.js calls it for every Setup-mode bone edit while the
// toolbar's "Bone only" toggle is on.

import { Pose } from '../core/pose.js';
import { moveAttachment } from '../core/model.js';

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

/**
 * Sets `bone`'s setup transform to `setup` while its direct child bones, the attachments of its slots
 * and the weighted mesh vertices bound to it keep their place in the world. Grandchildren follow
 * their parents, so they stay too. Child bones in `follow` (selected along with it) move with it.
 */
export function setBoneSetupOnly(doc, bone, setup, follow = null) {
  const before = setupWorld(doc);
  doc.bones[bone].setup = setup;
  const after = setupWorld(doc);
  const inv = after[bone].inverse();
  // old bone space -> new bone space
  const toNew = inv.mul(before[bone]);
  doc.bones.forEach((b, i) => {
    if (b.parent === bone && !follow?.has(i)) b.setup = inv.mul(before[i]).decompose();
  });
  const seen = new Set();
  doc.slots.forEach((s, i) => {
    for (const att of slotAttachments(doc, i)) {
      if (!att || seen.has(att)) continue;
      seen.add(att);
      if (att.weights) {
        // Weighted vertices are in each bone's space: only the entries of this bone change.
        for (const v of att.weights) for (const w of v) if (w.bone === bone) [w.x, w.y] = toNew.apply([w.x, w.y]);
      } else if (s.bone === bone) {
        moveAttachment(att, toNew);
      }
    }
  });
}
