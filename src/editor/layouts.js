// SPDX-License-Identifier: MIT OR Apache-2.0
// Named window layouts ("workstations"): which panels are popped out into their own OS windows and
// where (logical px), saved so the whole arrangement can be recalled at once — useful on
// multi-monitor setups. This file is the store only (no DOM, so it can be unit-tested): the UI is
// layoutui.js and the windows are driven by panelsync.js.
//
// A layout is { id, name, hotkey, panels }, where hotkey is a digit 0–9 (an optional
// Ctrl+Alt+<digit> shortcut) or null, and panels is { [panelId]: { x, y, w, h } } — a panel listed
// here is detached at that spot; one left out is docked.

const STORE = 'rigby.layouts';

let seq = 0;
/** A short unique id for a new layout. */
export function newLayoutId() {
  return `L${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** The Ctrl+Alt+<digit> label for a hotkey, or '' when there is none. */
export function hotkeyLabel(hotkey) {
  return hotkey === null || hotkey === undefined ? '' : `Ctrl+Alt+${hotkey}`;
}

function valid(l) {
  return !!l && typeof l.name === 'string' && !!l.panels && typeof l.panels === 'object';
}

/** The saved layouts (an empty list when none or unreadable). `storage` is injectable for tests. */
export function loadLayouts(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(STORE) ?? '[]');
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

/** Persists the layouts (a convenience; failure leaves them working for this session). */
export function saveLayouts(list, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORE, JSON.stringify(list.filter(valid)));
  } catch {
    // ignore: storage may be unavailable (private window, cleared site data)
  }
}

// A hotkey is unique: assigning one to a layout clears it from any other that held it.
function clearDuplicateHotkey(list, keepId, hotkey) {
  if (hotkey === null || hotkey === undefined) return list;
  return list.map((l) => (l.id !== keepId && l.hotkey === hotkey ? { ...l, hotkey: null } : l));
}

/** Adds a layout, or replaces the one with the same id. Returns the new list. */
export function upsertLayout(list, layout) {
  const i = list.findIndex((l) => l.id === layout.id);
  const next = i >= 0 ? [...list.slice(0, i), layout, ...list.slice(i + 1)] : [...list, layout];
  return clearDuplicateHotkey(next, layout.id, layout.hotkey);
}

export function removeLayout(list, id) {
  return list.filter((l) => l.id !== id);
}

export function renameLayout(list, id, name) {
  return list.map((l) => (l.id === id ? { ...l, name } : l));
}

/** Binds (or clears, with null) the Ctrl+Alt+<digit> shortcut of a layout, keeping hotkeys unique. */
export function assignHotkey(list, id, hotkey) {
  return clearDuplicateHotkey(list.map((l) => (l.id === id ? { ...l, hotkey } : l)), id, hotkey);
}

/** Replaces a layout's captured panel arrangement (Manage ▸ Update to current). */
export function updatePanels(list, id, panels) {
  return list.map((l) => (l.id === id ? { ...l, panels } : l));
}

/** The layout bound to a Ctrl+Alt+<digit> shortcut, or null. */
export function byHotkey(list, hotkey) {
  return list.find((l) => l.hotkey === hotkey) ?? null;
}
