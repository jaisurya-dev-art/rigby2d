// SPDX-License-Identifier: MIT OR Apache-2.0
// Editor preferences (Edit ▸ Preferences): one JSON object kept between sessions. Each preference
// has a default and a range; values read back from storage are checked against them, so a stale
// or hand-edited value can never break the editor. No DOM here: tests run it under Node.

export const STORAGE_KEY = 'rigby.prefs';

/** Preference definitions: default, plus `min`/`max` for numbers or `options` for choices. */
export const PREFS = {
  'interface.scale': { default: 1, min: 0.75, max: 2 },
  'editing.undoSteps': { default: 200, min: 20, max: 1000 },
  'files.backups': { default: 1, min: 0, max: 9 },
  'files.autosave': { default: true },
  'files.autosaveMinutes': { default: 2, min: 1, max: 60 },
  'files.reopenLast': { default: false },
  'addons.enabled': { default: {} },
};

/** `value` if it is valid for preference `key`, otherwise its default. */
export function validPref(key, value) {
  const def = PREFS[key];
  if (!def) return undefined;
  const d = def.default;
  if (typeof d === 'boolean') return typeof value === 'boolean' ? value : d;
  if (typeof d === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return d;
    return Math.min(def.max, Math.max(def.min, value));
  }
  if (def.options) return def.options.includes(value) ? value : d;
  if (d && typeof d === 'object') return value && typeof value === 'object' && !Array.isArray(value) ? value : { ...d };
  return typeof value === typeof d ? value : d;
}

/**
 * Preferences backed by a Storage-like object (`getItem`/`setItem`; localStorage in the editor).
 * `get(key)`, `set(key, value)` (saves at once), `reset(key?)`, and `onChange(fn)`.
 */
export function createPrefs(storage = globalThis.localStorage) {
  let values = {};
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') values = parsed;
  } catch {
    // Unreadable preferences fall back to the defaults.
  }
  const listeners = new Set();
  const persist = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {
      // Preferences are a convenience; storage errors leave them for this session only.
    }
  };
  const notify = (key) => {
    for (const fn of listeners) fn(key);
  };
  return {
    get: (key) => validPref(key, values[key]),
    set(key, value) {
      if (!(key in PREFS)) throw new Error(`unknown preference '${key}'`);
      values[key] = validPref(key, value);
      persist();
      notify(key);
    },
    /** Puts one preference, or all of them, back to the default. */
    reset(key) {
      if (key) delete values[key];
      else values = {};
      persist();
      notify(key ?? null);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
