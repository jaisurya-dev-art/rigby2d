// SPDX-License-Identifier: MIT OR Apache-2.0
// Onion skinning settings: which bones are ghosted and with which frame counts and colors. Kept
// free of the DOM and app.js so it can be unit-tested in Node; App delegates here.
//
// Per-bone overrides are keyed by bone name, not index: indices shift when bones are deleted or
// reparented and when undo rebuilds the document, names do not.

/** A bone's own override (by bone index), or undefined. */
export function onionOverride(doc, onion, bone) {
  const name = doc.bones[bone]?.name;
  return name === undefined ? undefined : onion.perBone.get(name);
}

/** Sets a bone's own override (by bone index), or removes it when `entry` is null. */
export function setOnionOverride(doc, onion, bone, entry) {
  const name = doc.bones[bone]?.name;
  if (name === undefined) return;
  if (entry) onion.perBone.set(name, entry);
  else onion.perBone.delete(name);
}

/** How many bones of `doc` have their own settings. Entries for bones that no longer exist
 *  (deleted, or from another document) are ignored, so they cannot mask the whole skeleton. */
export function onionOverrideCount(doc, onion) {
  if (onion.perBone.size === 0) return 0;
  let n = 0;
  for (const b of doc.bones) if (onion.perBone.has(b.name)) n++;
  return n;
}

/** Moves a bone's override to its new name when the bone is renamed. */
export function renameOnionBone(onion, from, to) {
  const entry = onion.perBone.get(from);
  if (!entry || from === to) return;
  onion.perBone.delete(from);
  onion.perBone.set(to, entry);
}

/**
 * Carries overrides across a rebuild of the document (undo, redo, an edit adopted from a detached
 * panel) that renamed bones, which renameOnionBone() alone cannot see: undoing a rename brings the
 * old name back while the override stays under the new one. A rename keeps the bone count and the
 * bone's index, so only same-index bones whose old name is gone and whose new name is new count;
 * deletes and reparenting keep their names and need nothing here.
 */
export function followBoneRenames(onion, before, after) {
  if (onion.perBone.size === 0 || before.bones.length !== after.bones.length) return;
  const oldNames = new Set(before.bones.map((b) => b.name));
  const newNames = new Set(after.bones.map((b) => b.name));
  before.bones.forEach((b, i) => {
    const to = after.bones[i].name;
    if (!newNames.has(b.name) && !oldNames.has(to) && !onion.perBone.has(to)) renameOnionBone(onion, b.name, to);
  });
}

/**
 * The settings in effect for a bone: its own override, or the nearest ancestor's (so enabling a
 * parent ghosts its children), or the global defaults when no bone has its own. Returns null when
 * the bone is not ghosted. `overrides` is onionOverrideCount(), when the caller already has it.
 */
export function onionFor(doc, onion, bone, overrides = onionOverrideCount(doc, onion)) {
  const base = (ov = {}) => ({
    future: (ov.showFuture ?? onion.showFuture) ? ((ov.future ?? onion.future) | 0) : 0,
    past: (ov.showPast ?? onion.showPast) ? ((ov.past ?? onion.past) | 0) : 0,
    futureColor: ov.futureColor ?? onion.futureColor,
    pastColor: ov.pastColor ?? onion.pastColor,
  });
  if (overrides === 0) return base();
  for (let b = bone; b !== null && b !== undefined; b = doc.bones[b]?.parent ?? null) {
    const ov = onionOverride(doc, onion, b);
    if (ov) return base(ov);
  }
  return null;
}
