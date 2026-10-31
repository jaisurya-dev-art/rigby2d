// SPDX-License-Identifier: MIT OR Apache-2.0
// Keyboard shortcuts: named actions and switchable presets.
//
// A binding is a lowercase combo string: optional "ctrl+", "shift+", "alt+" (in that order)
// followed by a key name ("c", "space", "arrowleft", "delete", "f", "pageup", ...). Ctrl also
// matches Cmd on macOS.

/** Actions in display order: [id, description]. */
export const ACTIONS = [
  ['tool.pose', 'Pose tool'],
  ['tool.create', 'Create bone tool'],
  ['tool.rotate', 'Rotate tool'],
  ['tool.translate', 'Translate tool'],
  ['tool.scale', 'Scale tool'],
  ['tool.shear', 'Shear tool'],
  ['mode.toggle', 'Switch Setup / Animate'],
  ['play.forward', 'Play forward / stop'],
  ['play.backward', 'Play backward / stop'],
  ['time.start', 'Go to first frame'],
  ['time.end', 'Go to last key'],
  ['key.next', 'Next key'],
  ['key.previous', 'Previous key'],
  ['frame.next', 'Next frame'],
  ['frame.previous', 'Previous frame'],
  ['frame.next10', 'Forward 10 frames'],
  ['frame.previous10', 'Back 10 frames'],
  ['loop.toggle', 'Toggle looping'],
  ['key.changed', 'Key changed properties'],
  ['key.tool', 'Key the current tool\'s property'],
  ['key.transforms', 'Key all transforms of the selection'],
  ['key.shown', 'Key everything shown in the dopesheet'],
  ['autokey.toggle', 'Toggle auto key'],
  ['select.none', 'Deselect'],
  ['view.fit', 'Fit the skeleton in view'],
  ['view.actual', 'Zoom to 100%'],
  ['edit.copyKeys', 'Copy selected keys'],
  ['edit.pasteKeys', 'Paste keys at the playhead'],
  ['edit.delete', 'Delete selected key, bone or slot'],
  ['edit.undo', 'Undo'],
  ['edit.redo', 'Redo'],
  ['file.open', 'Open'],
  ['file.save', 'Save'],
  ['file.saveAs', 'Save as'],
  ['file.export', 'Export'],
  ['menu.close', 'Close menus'],
  ['app.preferences', 'Preferences'],
];

const COMMON = {
  'edit.undo': ['ctrl+z'],
  'edit.redo': ['ctrl+shift+z', 'ctrl+y'],
  'file.open': ['ctrl+o'],
  'file.save': ['ctrl+s'],
  'file.saveAs': ['ctrl+shift+s'],
  'file.export': ['ctrl+e'],
  'edit.copyKeys': ['ctrl+c'],
  'edit.pasteKeys': ['ctrl+v'],
  'edit.delete': ['delete', 'backspace'],
  'menu.close': ['escape'],
  'app.preferences': ['ctrl+,'],
};

/** Keymap presets: action id -> list of bindings. */
export const PRESETS = {
  reference: {
    label: 'Reference (default)',
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
    },
  },
  blender: {
    label: 'Blender-like',
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

/** Human-readable shortcut for an action ("Ctrl+Shift+L"), or ''. */
export function shortcutLabel(presetId, action) {
  const combo = (PRESETS[presetId] ?? PRESETS.reference).bindings[action]?.[0];
  if (!combo) return '';
  return combo
    .split('+')
    .map((p) => (p.length === 1 ? p.toUpperCase() : p.replace(/^arrow/, '').replace(/^./, (c) => c.toUpperCase())))
    .join('+');
}

const STORAGE_KEY = 'rigby2d.keymap';

/** The keymap preset remembered on this machine (falls back to the reference preset). */
export function loadPreset() {
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
