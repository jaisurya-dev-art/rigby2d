// SPDX-License-Identifier: MIT OR Apache-2.0
// Show and lock toggles for bones and slots (the tree's eye and lock buttons). A hidden bone isn't
// drawn in the viewport and can't be picked there; a hidden slot's images aren't drawn there. A
// locked bone or slot is still drawn but can't be picked or dragged in the viewport (select it in
// the tree instead). Editor view state only: stored by name in the work file (doc.hidden,
// doc.locked) and part of undo, but renders, exports and runtimes never see it.

/** The name set of `kind` ('hidden' or 'locked') for bones or slots. */
const namesOf = (doc, kind, what) => doc[kind]?.[what] ?? [];

export const isBoneHidden = (doc, i) => namesOf(doc, 'hidden', 'bones').includes(doc.bones[i]?.name);
export const isBoneLocked = (doc, i) => namesOf(doc, 'locked', 'bones').includes(doc.bones[i]?.name);
export const isSlotHidden = (doc, i) => namesOf(doc, 'hidden', 'slots').includes(doc.slots[i]?.name);
export const isSlotLocked = (doc, i) => namesOf(doc, 'locked', 'slots').includes(doc.slots[i]?.name);

/** Whether any bone or slot is hidden or locked (so drawing and picking can skip the checks). */
export const hasViewState = (doc) => ['hidden', 'locked'].some((k) => namesOf(doc, k, 'bones').length || namesOf(doc, k, 'slots').length);

/** A bone index and every bone below it. */
export function branchBones(doc, bone) {
  const out = [bone];
  for (let i = bone + 1; i < doc.bones.length; i++) if (out.includes(doc.bones[i].parent)) out.push(i);
  return out;
}

/**
 * Turns `kind` ('hidden' or 'locked') on or off for bones and slots (indices), all to `on`.
 * Returns true when anything changed.
 */
export function setViewState(doc, kind, { bones = [], slots = [] }, on) {
  doc[kind] ??= { bones: [], slots: [] };
  let changed = false;
  const apply = (what, names) => {
    const set = new Set(doc[kind][what]);
    for (const n of names) {
      if (on === set.has(n)) continue;
      if (on) set.add(n);
      else set.delete(n);
      changed = true;
    }
    doc[kind][what] = [...set];
  };
  apply('bones', bones.map((i) => doc.bones[i].name));
  apply('slots', slots.map((i) => doc.slots[i].name));
  return changed;
}

/**
 * The tree's toggle on a bone: flips `kind` for the bone, or with `branch` for the bone, every bone
 * below it and all their slots (on when the clicked bone was off).
 */
export function toggleBone(doc, kind, bone, branch = false) {
  const on = !(kind === 'hidden' ? isBoneHidden : isBoneLocked)(doc, bone);
  const bones = branch ? branchBones(doc, bone) : [bone];
  const slots = branch ? doc.slots.flatMap((s, i) => (bones.includes(s.bone) ? [i] : [])) : [];
  setViewState(doc, kind, { bones, slots }, on);
  return on;
}

/** The tree's toggle on a slot. */
export function toggleSlot(doc, kind, slot) {
  const on = !(kind === 'hidden' ? isSlotHidden : isSlotLocked)(doc, slot);
  setViewState(doc, kind, { slots: [slot] }, on);
  return on;
}

/** Shows and unlocks everything. Returns true when anything changed. */
export function clearViewState(doc) {
  const had = hasViewState(doc);
  doc.hidden = { bones: [], slots: [] };
  doc.locked = { bones: [], slots: [] };
  return had;
}

/**
 * drawSkeleton's `skip(slot, attachment)` for hidden slots (their images are left out; a clipping
 * mask still clips, since it is part of how the rest looks), combined with `other`; undefined when
 * nothing is hidden and there is no `other`.
 */
export function hiddenSlotSkip(doc, other = null) {
  if (!namesOf(doc, 'hidden', 'slots').length) return other ?? undefined;
  const hidden = new Set(doc.slots.flatMap((s, i) => (isSlotHidden(doc, i) ? [i] : [])));
  return (slot, att) => (hidden.has(slot) && att?.type !== 'clipping') || !!other?.(slot, att);
}
