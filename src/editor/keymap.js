// SPDX-License-Identifier: MIT OR Apache-2.0
// Keyboard shortcuts: named actions and switchable presets.
//
// A binding is a lowercase combo string: optional "ctrl+", "shift+", "alt+" (in that order)
// followed by a key name ("c", "space", "arrowleft", "delete", "f", "pageup", ...). Ctrl also
// matches Cmd on macOS.
import { t, tn } from './i18n.js';

/** Actions in display order: [id, description]. */
export const ACTIONS = [
  ['tool.pose', tn('Pose tool')],
  ['tool.create', tn('Create bone tool')],
  ['tool.rotate', tn('Rotate tool')],
  ['tool.translate', tn('Translate tool')],
  ['tool.scale', tn('Scale tool')],
  ['tool.shear', tn('Shear tool')],
  ['mode.toggle', tn('Switch Setup / Animate')],
  ['play.forward', tn('Play forward / stop')],
  ['play.backward', tn('Play backward / stop')],
  ['time.start', tn('Go to first frame')],
  ['time.end', tn('Go to last key')],
  ['key.next', tn('Next key')],
  ['key.previous', tn('Previous key')],
  ['frame.next', tn('Next frame')],
  ['frame.previous', tn('Previous frame')],
  ['frame.next10', tn('Forward 10 frames')],
  ['frame.previous10', tn('Back 10 frames')],
  ['loop.toggle', tn('Toggle looping')],
  ['key.changed', tn('Key changed properties')],
  ['key.tool', tn('Key the current tool\'s property')],
  ['key.transforms', tn('Key all transforms of the selection')],
  ['key.shown', tn('Key everything shown in the dopesheet')],
  ['autokey.toggle', tn('Toggle auto key')],
  ['select.none', tn('Deselect')],
  ['view.fit', tn('Fit the skeleton in view')],
  ['view.actual', tn('Zoom to 100%')],
  ['view.overlays', tn('Hide or show overlays')],
  ['view.bones', tn('Show or hide bones')],
  ['edit.cutKeys', tn('Cut selected keys')],
  ['edit.copyKeys', tn('Copy selected keys')],
  ['edit.pasteKeys', tn('Paste keys at the playhead')],
  ['edit.delete', tn('Delete selected key, bone or slot')],
  ['edit.undo', tn('Undo')],
  ['edit.redo', tn('Redo')],
  ['file.open', tn('Open')],
  ['file.save', tn('Save')],
  ['file.saveAs', tn('Save as')],
  ['file.export', tn('Export')],
  ['menu.close', tn('Close menus')],
  ['app.preferences', tn('Preferences')],
];

const COMMON = {
  'edit.undo': ['ctrl+z'],
  'edit.redo': ['ctrl+shift+z', 'ctrl+y'],
  'file.open': ['ctrl+o'],
  'file.save': ['ctrl+s'],
  'file.saveAs': ['ctrl+shift+s'],
  'file.export': ['ctrl+e'],
  'edit.cutKeys': ['ctrl+x'],
  'edit.copyKeys': ['ctrl+c'],
  'edit.pasteKeys': ['ctrl+v'],
  'edit.delete': ['delete', 'backspace'],
  'menu.close': ['escape'],
  'app.preferences': ['ctrl+,'],
  'view.bones': ['ctrl+shift+b'],
};

/** Keymap presets: action id -> list of bindings. */
export const PRESETS = {
  // The id stays 'reference' so saved preferences keep working.
  reference: {
    label: tn('Spine-like (default)'),
    bindings: {
      ...COMMON,
      'tool.pose': ['b'],
      'tool.create': ['n'],
      'tool.rotate': ['c'],
      'tool.translate': ['v'],
      'tool.scale': ['x'],
      'tool.shear': ['z'],
      'mode.toggle': ['tab'],
      // Space plays and stops, as in most animation tools (and as the tutorials teach).
      'play.forward': ['space', 'd'],
      'play.backward': ['a'],
      'time.start': ['q'],
      'time.end': ['e'],
      'key.next': ['w'],
      'key.previous': ['s'],
      'frame.next': ['r', 'arrowright'],
      'frame.previous': ['f', 'arrowleft'],
      'frame.next10': ['shift+r'],
      'frame.previous10': ['shift+f'],
      'loop.toggle': ['ctrl+r'],
      'key.changed': ['k'],
      'key.tool': ['l'],
      'key.transforms': ['ctrl+l'],
      'key.shown': ['ctrl+shift+l'],
      'select.none': ['escape'],
      'view.fit': ['ctrl+shift+f'],
      'view.actual': ['ctrl+f'],
      'view.overlays': ['ctrl+shift+h'],
    },
  },
  blender: {
    label: tn('Blender-like'),
    bindings: {
      ...COMMON,
      'tool.rotate': ['r'],
      'tool.translate': ['g'],
      'tool.scale': ['s'],
      'tool.shear': ['h'],
      'tool.create': ['b'],
      'tool.pose': ['p'],
      'mode.toggle': ['tab'],
      'play.forward': ['space'],
      'play.backward': ['shift+space'],
      'time.start': ['home'],
      'time.end': ['end'],
      'key.next': ['arrowup'],
      'key.previous': ['arrowdown'],
      'frame.next': ['arrowright'],
      'frame.previous': ['arrowleft'],
      'frame.next10': ['shift+arrowright'],
      'frame.previous10': ['shift+arrowleft'],
      'loop.toggle': ['ctrl+r'],
      'key.changed': ['i'],
      'key.tool': ['k'],
      'key.transforms': ['ctrl+k'],
      'key.shown': ['ctrl+shift+k'],
      'select.none': ['alt+a', 'escape'],
      'view.fit': ['f', 'home'],
      'view.actual': ['ctrl+f'],
      'view.overlays': ['shift+alt+z'],
    },
  },
};

/** Actions that repeat while their key is held. */
export const REPEATING = new Set(['frame.next', 'frame.previous', 'frame.next10', 'frame.previous10', 'key.next', 'key.previous']);

const KEY_NAMES = { ' ': 'space', esc: 'escape', del: 'delete' };

/** Combo string for a keyboard event, e.g. "ctrl+shift+l". */
export function comboOf(e) {
  let key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  key = KEY_NAMES[key] ?? key;
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return '';
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

/** The action bound to `combo` in `preset`, or null. */
export function actionFor(presetId, combo) {
  const bindings = (PRESETS[presetId] ?? PRESETS.reference).bindings;
  for (const [action, combos] of Object.entries(bindings)) if (combos.includes(combo)) return action;
  return null;
}

/** Every action bound to `combo` in `preset`. */
export function actionsFor(presetId, combo) {
  const bindings = (PRESETS[presetId] ?? PRESETS.reference).bindings;
  return Object.entries(bindings)
    .filter(([, combos]) => combos.includes(combo))
    .map(([action]) => action);
}

/** Human-readable combo ("ctrl+shift+l" -> "Ctrl+Shift+L"). */
export function comboLabel(combo) {
  return combo
    .split('+')
    .map((p) => (p.length === 1 ? p.toUpperCase() : p.replace(/^arrow/, '').replace(/^./, (c) => c.toUpperCase())))
    .join('+');
}

/** Human-readable shortcut for an action ("Ctrl+Shift+L"), or ''. */
export function shortcutLabel(presetId, action) {
  const combo = (PRESETS[presetId] ?? PRESETS.reference).bindings[action]?.[0];
  return combo ? comboLabel(combo) : '';
}

/** A tooltip with the action's shortcut: "Undo (Ctrl+Z)", or the text alone when it has none. */
export function withShortcut(text, presetId, action) {
  const key = shortcutLabel(presetId, action);
  return key ? `${text} (${key})` : text;
}

// ---- custom keymap ------------------------------------------------------------------------------
//
// A custom keymap is a built-in preset (its base) plus the actions the user changed, each with its
// full list of combos (an empty list leaves the action without a shortcut). Registered, it is the
// preset 'custom', so every lookup above works with it unchanged.

/** Combos that stay with the editor: Ctrl+Alt+1..9 recall window layouts. */
export function reservedCombo(combo) {
  return /^ctrl\+alt\+[1-9]$/.test(combo);
}

/** The bindings of a custom keymap: its base preset with the changes applied. */
export function customBindings(custom) {
  const base = PRESETS[custom.base] && custom.base !== 'custom' ? PRESETS[custom.base] : PRESETS.reference;
  const out = {};
  for (const [action, combos] of Object.entries(base.bindings)) out[action] = [...combos];
  for (const [action, combos] of Object.entries(custom.changes)) out[action] = [...combos];
  return out;
}

/** A custom keymap starting from preset `base`, with no changes. */
export function newCustom(base) {
  return { base: PRESETS[base] && base !== 'custom' ? base : 'reference', changes: {} };
}

/**
 * Actions other than `action` that `combo` is bound to in `bindings`. "Close menus" shares Escape
 * with deselecting by design, so it never conflicts.
 */
export function conflictsFor(bindings, combo, action) {
  return Object.entries(bindings)
    .filter(([a, combos]) => a !== action && a !== 'menu.close' && action !== 'menu.close' && combos.includes(combo))
    .map(([a]) => a);
}

/** Records a change: `action` gets `combos`. A change equal to the base preset is dropped. */
function withCombos(custom, action, combos) {
  const changes = { ...custom.changes };
  const base = PRESETS[custom.base]?.bindings[action] ?? [];
  if (combos.length === base.length && combos.every((c, i) => c === base[i])) delete changes[action];
  else changes[action] = combos;
  return { base: custom.base, changes };
}

/**
 * Binds `combo` to `action` in a custom keymap (added to its other combos, or replacing combo
 * `replace`). Other actions that used `combo` lose it. Returns { custom, moved: [actions] }.
 */
export function bindCombo(custom, action, combo, replace = null) {
  const bindings = customBindings(custom);
  const moved = conflictsFor(bindings, combo, action);
  let next = custom;
  for (const other of moved) next = withCombos(next, other, bindings[other].filter((c) => c !== combo));
  const own = (bindings[action] ?? []).filter((c) => c !== combo && c !== replace);
  const at = replace ? (bindings[action] ?? []).indexOf(replace) : -1;
  if (at >= 0) own.splice(Math.min(at, own.length), 0, combo);
  else own.push(combo);
  next = withCombos(next, action, own);
  return { custom: next, moved };
}

/** Removes `combo` from `action`. */
export function unbindCombo(custom, action, combo) {
  return withCombos(custom, action, (customBindings(custom)[action] ?? []).filter((c) => c !== combo));
}

/** Puts `action` back to its base preset's keys (or every action, without one). */
export function resetCustom(custom, action = null) {
  if (!action) return { base: custom.base, changes: {} };
  const changes = { ...custom.changes };
  delete changes[action];
  return { base: custom.base, changes };
}

/** A combo as comboOf writes it: modifiers in order, then one key name (letters, f5, arrowleft, ","...). */
const COMBO = /^(ctrl\+)?(shift\+)?(alt\+)?[^\s+]+$/;
const ACTION_IDS = new Set(ACTIONS.map(([id]) => id));

/** A custom keymap from parsed data (storage or a file); unknown actions and bad combos are dropped. */
export function readCustom(data) {
  if (!data || typeof data !== 'object') return null;
  const custom = newCustom(typeof data.base === 'string' ? data.base : 'reference');
  const changes = data.changes && typeof data.changes === 'object' ? data.changes : {};
  for (const [action, combos] of Object.entries(changes)) {
    if (!ACTION_IDS.has(action) || !Array.isArray(combos)) continue;
    custom.changes[action] = [...new Set(combos.filter((c) => typeof c === 'string' && COMBO.test(c) && !reservedCombo(c)))];
  }
  return custom;
}

/** A keymap file: base preset and changes, readable by importKeymapFile. */
export function keymapFile(custom) {
  return `${JSON.stringify({ rigby2dKeymap: 1, base: custom.base, changes: custom.changes }, null, 2)}\n`;
}

/** Parses a keymap file. Throws when it is not one. */
export function importKeymapFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a Rigby2D keymap file');
  }
  if (!data || data.rigby2dKeymap !== 1) throw new Error('not a Rigby2D keymap file');
  return readCustom(data);
}

/** Makes `custom` the preset 'custom' (or removes it, with null). */
export function registerCustom(custom) {
  if (custom) PRESETS.custom = { label: t('Custom'), bindings: customBindings(custom) };
  else delete PRESETS.custom;
}

const STORAGE_KEY = 'rigby2d.keymap';
const CUSTOM_STORAGE_KEY = 'rigby2d.keymap.custom';

/** The custom keymap remembered on this machine (registered as the preset 'custom'), or null. */
export function loadCustom() {
  let custom = null;
  try {
    custom = readCustom(JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) ?? 'null'));
  } catch {
    custom = null;
  }
  registerCustom(custom);
  return custom;
}

/** Remembers the custom keymap on this machine and registers it (null forgets it). */
export function saveCustom(custom) {
  registerCustom(custom);
  try {
    if (custom) localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify({ base: custom.base, changes: custom.changes }));
    else localStorage.removeItem(CUSTOM_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the keymap then lasts for this session only.
  }
}

/** Calls `fn()` when another window of the editor changes the keymap (detached panels). */
export function onKeymapStorage(fn) {
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === CUSTOM_STORAGE_KEY) fn();
  });
}

/** The keymap preset remembered on this machine (falls back to the reference preset). */
export function loadPreset() {
  loadCustom();
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id && PRESETS[id] ? id : 'reference';
  } catch {
    return 'reference';
  }
}

export function savePreset(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this session only.
  }
}
