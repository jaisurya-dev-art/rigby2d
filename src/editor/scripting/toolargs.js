// SPDX-License-Identifier: MIT OR Apache-2.0
// The values of a script tool's form (toolform.js shows it): which names a picker offers, what each
// field starts with, and values made valid for their field. No DOM, so it is tested under Node.

import { listConstraints } from '../../core/constraintdata.js';

export const PICKERS = ['bone', 'slot', 'animation', 'skin', 'event', 'constraint'];

/** The names a picker offers, from the open project. */
export function pickerNames(doc, kind) {
  switch (kind) {
    case 'bone':
      return doc.bones.map((b) => b.name);
    case 'slot':
      return doc.slots.map((s) => s.name);
    case 'animation':
      return doc.animations.map((a) => a.name);
    case 'skin':
      return ['default', ...doc.skins.map((s) => s.name)];
    case 'event':
      return doc.events.map((e) => e.name);
    case 'constraint':
      return listConstraints(doc).map((c) => c.name);
    default:
      return [];
  }
}

/** What a picker without a default starts on: the selection or what is open, else the first name. */
function pickerStart(app, kind, names) {
  const doc = app.doc;
  if (kind === 'bone') {
    const b = app.selectedBones?.()[0];
    if (b !== undefined && doc.bones[b]) return doc.bones[b].name;
    // Nothing selected: the first bone after the root, which a tool rarely means.
    return doc.bones[1]?.name ?? doc.bones[0]?.name ?? null;
  }
  if (kind === 'slot' && app.sel?.slot !== undefined && doc.slots[app.sel.slot]) return doc.slots[app.sel.slot].name;
  if (kind === 'animation' && app.anim !== null && app.anim !== undefined && doc.animations[app.anim]) return doc.animations[app.anim].name;
  if (kind === 'skin') return doc.skin ?? 'default';
  return names[0] ?? null;
}

/** A value made valid for its field (clamped, rounded, a known choice), or the field's fallback. */
export function cleanValue(field, value, names = []) {
  switch (field.kind) {
    case 'number':
    case 'integer': {
      let v = typeof value === 'number' && Number.isFinite(value) ? value : Number(field.default ?? 0);
      if (!Number.isFinite(v)) v = 0;
      if (field.kind === 'integer') v = Math.round(v);
      if (typeof field.min === 'number') v = Math.max(field.min, v);
      if (typeof field.max === 'number') v = Math.min(field.max, v);
      return v;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : !!field.default;
    case 'choice': {
      const choices = field.choices ?? [];
      return choices.includes(value) ? value : (choices.includes(field.default) ? field.default : choices[0] ?? null);
    }
    case 'text':
      return typeof value === 'string' ? value : String(field.default ?? '');
    default:
      // Pickers: a name that exists in the project.
      return names.includes(value) ? value : null;
  }
}

/** The values a form starts with: remembered ones that are still valid, else defaults, else a sensible pick. */
export function startValues(app, fieldsList, remembered = {}) {
  const out = {};
  for (const f of fieldsList) {
    const names = PICKERS.includes(f.kind) ? pickerNames(app.doc, f.kind) : [];
    const fromMemory = f.name in remembered ? cleanValue(f, remembered[f.name], names) : null;
    if (PICKERS.includes(f.kind)) out[f.name] = fromMemory ?? cleanValue(f, f.default, names) ?? pickerStart(app, f.kind, names);
    else out[f.name] = f.name in remembered ? cleanValue(f, remembered[f.name]) : cleanValue(f, f.default);
  }
  return out;
}
