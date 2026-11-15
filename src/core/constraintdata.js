// SPDX-License-Identifier: MIT OR Apache-2.0
// Constraint authoring helpers. IK constraints live in `sk.ik`; transform, path, physics and
// slider constraints are kept in the skeleton JSON layout (bones and slots referenced by name)
// in `sk.extra.constraints` (4.3 layout, one list) or `sk.extra.transform|path|physics` (older
// files). These helpers list, create, order, rename and delete both kinds, and keep name
// references in step when bones, slots or constraints are renamed or removed.

import { renameFilmBone, renameFilmSlot } from './filmfx.js';

export const CONSTRAINT_TYPES = ['ik', 'transform', 'path', 'physics', 'slider'];
const LEGACY_TYPES = ['transform', 'path', 'physics'];

/**
 * Every constraint in application order: { type, name, order, ik } for IK (index into sk.ik) or
 * { type, name, order, data, entry } for the others (`data` is the editable JSON object).
 */
export function listConstraints(sk) {
  const out = sk.ik.map((c, ik) => ({ type: 'ik', name: c.name, order: c.order ?? ik, ik }));
  for (const entry of sk.extra?.constraints ?? []) out.push({ type: entry.data.type, name: entry.data.name, order: entry.index, data: entry.data, entry });
  for (const type of LEGACY_TYPES) {
    (sk.extra?.[type] ?? []).forEach((data, i) => out.push({ type, name: data.name, order: data.order ?? i, data, legacy: type }));
  }
  return out.sort((a, b) => a.order - b.order);
}

function setOrder(sk, c, order) {
  if (c.type === 'ik') sk.ik[c.ik].order = order;
  else if (c.entry) c.entry.index = order;
  else c.data.order = order;
}

/** Renumbers the application order 0..n-1, keeping the current order. */
export function normalizeOrder(sk) {
  listConstraints(sk).forEach((c, i) => setOrder(sk, c, i));
}

/** Moves a constraint one step earlier (-1) or later (+1) in application order. */
export function moveConstraint(sk, name, step) {
  normalizeOrder(sk);
  const list = listConstraints(sk);
  const i = list.findIndex((c) => c.name === name);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return false;
  setOrder(sk, list[i], j);
  setOrder(sk, list[j], i);
  return true;
}

export function constraintNameTaken(sk, name) {
  return listConstraints(sk).some((c) => c.name === name);
}

export function uniqueConstraintName(sk, base) {
  if (!constraintNameTaken(sk, base)) return base;
  for (let n = 2; ; n++) if (!constraintNameTaken(sk, `${base}${n}`)) return `${base}${n}`;
}

/** Adds a transform, path, physics or slider constraint (JSON layout, names) as the last one. */
export function addConstraint(sk, data) {
  normalizeOrder(sk);
  const order = listConstraints(sk).length;
  (sk.extra.constraints ??= []).push({ index: order, data });
  return data;
}

/** Adds an IK constraint (indices) as the last one. Returns its index in sk.ik. */
export function addIk(sk, ik) {
  normalizeOrder(sk);
  sk.ik.push({ order: listConstraints(sk).length, mix: 1, softness: 0, bendPositive: true, compress: false, stretch: false, uniform: false, skinRequired: false, ...ik });
  return sk.ik.length - 1;
}

/** Deletes a constraint by name, with its animation keys and skin memberships. */
export function removeConstraint(sk, name) {
  const c = listConstraints(sk).find((x) => x.name === name);
  if (!c) return false;
  if (c.type === 'ik') {
    sk.ik.splice(c.ik, 1);
    for (const a of sk.animations) {
      a.ik = a.ik.filter((t) => t.constraint !== c.ik);
      for (const t of a.ik) if (t.constraint > c.ik) t.constraint--;
    }
    for (const skin of sk.skins) skin.ik = skin.ik.filter((i) => i !== c.ik).map((i) => (i > c.ik ? i - 1 : i));
  } else {
    if (c.entry) sk.extra.constraints.splice(sk.extra.constraints.indexOf(c.entry), 1);
    else sk.extra[c.legacy].splice(sk.extra[c.legacy].indexOf(c.data), 1);
    for (const a of sk.animations) if (a.extra?.[c.type]) delete a.extra[c.type][name];
    for (const skin of sk.skins) for (const key of ['constraints', ...LEGACY_TYPES]) removeName(skin.extra?.[key], name);
  }
  normalizeOrder(sk);
  return true;
}

function removeName(list, name) {
  if (!Array.isArray(list)) return;
  const i = list.indexOf(name);
  if (i >= 0) list.splice(i, 1);
}

/** Renames a constraint, keeping its animation keys and skin memberships. */
export function renameConstraint(sk, from, to) {
  if (from === to || constraintNameTaken(sk, to)) return false;
  const c = listConstraints(sk).find((x) => x.name === from);
  if (!c) return false;
  if (c.type === 'ik') sk.ik[c.ik].name = to;
  else {
    c.data.name = to;
    for (const a of sk.animations) {
      const keys = a.extra?.[c.type];
      if (keys && keys[from] !== undefined) {
        keys[to] = keys[from];
        delete keys[from];
      }
    }
    for (const skin of sk.skins) {
      for (const key of ['constraints', ...LEGACY_TYPES]) {
        const list = skin.extra?.[key];
        if (Array.isArray(list)) list.forEach((n, i) => n === from && (list[i] = to));
      }
    }
  }
  return true;
}

/**
 * Non-IK constraints, flagged `path` when `target`/`slot` name a slot (path constraints);
 * otherwise an older `target` names the source bone.
 */
function rawConstraints(sk) {
  return listConstraints(sk)
    .filter((c) => c.type !== 'ik')
    .map((c) => ({ ...c, path: c.type === 'path' }));
}

/** Updates constraint references after a bone is renamed. */
export function renameBoneRefs(sk, from, to) {
  renameFilmBone(sk, from, to);
  for (const c of rawConstraints(sk)) {
    const d = c.data;
    if (Array.isArray(d.bones)) d.bones = d.bones.map((n) => (n === from ? to : n));
    for (const key of ['bone', 'source']) if (d[key] === from) d[key] = to;
    if (!c.path && d.target === from) d.target = to;
  }
}

/** Updates constraint references (and per-slot attachment keys) after a slot is renamed. */
export function renameSlotRefs(sk, from, to) {
  renameFilmSlot(sk, from, to);
  // Attachment keys kept per slot name (image sequence keys).
  for (const a of sk.animations) {
    for (const slots of Object.values(a.extra?.attachments ?? {})) {
      if (slots[from] !== undefined) {
        slots[to] = slots[from];
        delete slots[from];
      }
    }
  }
  for (const c of rawConstraints(sk)) {
    if (!c.path) continue;
    if (c.data.slot === from) c.data.slot = to;
    if (c.data.target === from) c.data.target = to;
  }
}

/** Removes constraints that refer to bones or slots that no longer exist. Returns their names. */
export function pruneConstraints(sk) {
  const bones = new Set(sk.bones.map((b) => b.name));
  const slots = new Set(sk.slots.map((s) => s.name));
  const removed = [];
  for (const c of rawConstraints(sk)) {
    const d = c.data;
    const boneNames = [...(d.bones ?? []), ...['bone', 'source'].map((k) => d[k]).filter((v) => v !== undefined)];
    if (!c.path && d.target !== undefined) boneNames.push(d.target);
    const slotNames = c.path ? [d.slot ?? d.target].filter((v) => v !== undefined) : [];
    const missingBone = boneNames.some((n) => !bones.has(n));
    const emptyBones = Array.isArray(d.bones) && d.bones.length === 0 && c.type !== 'slider' && c.type !== 'physics';
    if (missingBone || emptyBones || slotNames.some((n) => !slots.has(n))) removed.push(c.name);
  }
  for (const name of removed) removeConstraint(sk, name);
  return removed;
}

