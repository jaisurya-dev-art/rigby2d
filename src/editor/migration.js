// SPDX-License-Identifier: MIT OR Apache-2.0
// Migration checker for skeleton JSON and binary .skel files (the format Spine exports): what a
// file holds, and how each feature carries over to Rigby2D. File ▸ Import ▸ Check a skeleton
// file, and docs/migrating-from-spine.md. No DOM: tests run it under Node.

import { isSkeletonJson, readSkeletonJson } from '../core/interop.js';

/** Status of a feature: 'ok' (plays as in the original), 'kept' (kept and exported, not shown in the editor), 'partial', 'no'. */
const FEATURES = [
  ['region', 'Region attachments', 'ok'],
  ['mesh', 'Meshes and weights', 'ok'],
  ['linkedmesh', 'Linked meshes', 'ok'],
  ['clipping', 'Clipping', 'ok'],
  ['path', 'Path attachments', 'ok'],
  ['boundingbox', 'Bounding boxes', 'kept', 'Kept and exported for game collision; not drawn.'],
  ['point', 'Points', 'kept', 'Kept and exported; not drawn.'],
  ['sequence', 'Image sequences', 'ok'],
  ['ik', 'IK constraints', 'ok'],
  ['transform', 'Transform constraints', 'ok'],
  ['pathConstraint', 'Path constraints', 'ok'],
  ['physics', 'Physics constraints', 'ok'],
  ['slider', 'Slider constraints', 'ok'],
  ['skins', 'Skins', 'ok'],
  ['events', 'Events (with audio)', 'ok'],
  ['blend', 'Blend modes', 'ok'],
  ['tint', 'Two-color tint', 'ok'],
];

/** The skeleton version from a parsed file: { text, major, minor }. */
function versionOf(obj) {
  const text = String(obj.skeleton?.spine ?? obj.skeleton?.version ?? '');
  const [major, minor] = text.split('.').map((n) => parseInt(n, 10));
  return { text, major: major || 0, minor: minor || 0 };
}

/** Counts of each feature in a parsed skeleton JSON object. */
export function featureCounts(obj) {
  const counts = Object.fromEntries(FEATURES.map(([id]) => [id, 0]));
  const skins = Array.isArray(obj.skins) ? obj.skins : Object.entries(obj.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  counts.skins = skins.length;
  for (const skin of skins) {
    for (const slot of Object.values(skin.attachments ?? {})) {
      for (const att of Object.values(slot ?? {})) {
        const type = att?.type ?? 'region';
        if (type in counts) counts[type]++;
        if (att?.sequence) counts.sequence++;
      }
    }
  }
  counts.ik = (obj.ik ?? []).length;
  counts.transform = (obj.transform ?? []).length;
  counts.pathConstraint = (obj.path ?? []).length;
  counts.physics = (obj.physics ?? []).length;
  for (const c of obj.constraints ?? []) {
    const type = c.type === 'path' ? 'pathConstraint' : c.type;
    if (type in counts) counts[type]++;
  }
  counts.events = Object.keys(obj.events ?? {}).length;
  counts.blend = (obj.slots ?? []).filter((s) => s.blend && s.blend !== 'normal').length;
  counts.tint = (obj.slots ?? []).filter((s) => s.dark).length;
  return counts;
}

/**
 * The migration report for a parsed skeleton file: { version, supported, summary, items, warnings }.
 * `items`: [{ feature, count, status, note }] for the features the file uses.
 */
export function checkSkeleton(obj, name = 'skeleton') {
  if (!isSkeletonJson(obj)) throw new Error('not a skeleton JSON file');
  const version = versionOf(obj);
  const notes = [];
  let supported = true;
  if (version.major === 3 && version.minor < 8) {
    supported = false;
    notes.push(`Format ${version.text} is older than 3.8. Export the project again as JSON 3.8 or newer (the original editor can open old projects and export them in a newer format).`);
  } else if (version.major > 4 || (version.major === 4 && version.minor > 3)) {
    notes.push(`Format ${version.text} is newer than 4.3: features added after 4.3 are kept as they are but not played.`);
  }
  let warnings = [];
  let summary = null;
  if (supported) {
    const { skeleton, warnings: w } = readSkeletonJson(obj, name);
    warnings = w;
    summary = { bones: skeleton.bones.length, slots: skeleton.slots.length, animations: skeleton.animations.length };
  }
  const counts = featureCounts(obj);
  const items = FEATURES.filter(([id]) => counts[id] > 0).map(([id, feature, status, note]) => ({ feature, count: counts[id], status, note: note ?? '' }));
  for (const w of warnings) items.push({ feature: 'Note', count: 0, status: /unsupported|not supported|kept but not/.test(w) ? 'partial' : 'kept', note: w });
  return { version: version.text || 'unknown', supported, summary, items, notes };
}
