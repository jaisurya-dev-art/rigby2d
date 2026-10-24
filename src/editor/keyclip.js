// SPDX-License-Identifier: MIT OR Apache-2.0
// Copy and paste of dopesheet keys: the clipboard model and the paste math, kept free of the DOM
// and app.js so the overflow decision and the selection -> clipboard -> animation round trip can be
// unit-tested in Node. timeline.js owns the UI and supplies the per-track key lookup (`resolve`).

/** A deep copy of a key object. Keys are plain JSON (time, value, curve, or event fields), so this
 *  covers bone/slot values and curves, deform { offset, vertices }, draw order and events alike. */
export function cloneKey(k) {
  return JSON.parse(JSON.stringify(k));
}

/**
 * Builds a clipboard from the selected keys grouped by track. `groups` is
 * [{ track, keys: [keyObject, ...] }] already filtered to the selection. Times are stored absolute;
 * `origin` is the earliest, so on paste the first key lands on the playhead. Returns null when empty.
 */
export function makeClipboard(groups) {
  const picked = groups.filter((g) => g.keys.length);
  if (!picked.length) return null;
  let origin = Infinity;
  let last = -Infinity;
  const out = [];
  for (const g of picked) {
    const keys = g.keys.map(cloneKey);
    for (const k of keys) {
      origin = Math.min(origin, k.time);
      last = Math.max(last, k.time);
    }
    out.push({ track: g.track, keys });
  }
  return { origin, span: last - origin, groups: out, count: out.reduce((s, g) => s + g.keys.length, 0) };
}

/**
 * How a paste at `pasteTime` (seconds) lands against an animation of `duration` seconds at `fps`.
 * Frame counts are compared so a key sitting exactly on the last frame still counts as fitting.
 */
export function planPaste(clip, pasteTime, duration, fps) {
  const lastTime = pasteTime + clip.span;
  const haveFrames = Math.round(duration * fps);
  const needFrames = Math.round(lastTime * fps);
  return { lastTime, fits: needFrames <= haveFrames, extraFrames: Math.max(0, needFrames - haveFrames) };
}

/**
 * The absolute times each clipboard key would occupy if pasted at `pasteTime`, grouped by track.
 * Mirrors pasteClipboard's offset without mutating anything, for drawing the paste preview.
 */
export function previewKeys(clip, pasteTime) {
  return clip.groups.map((g) => ({ track: g.track, times: g.keys.map((k) => pasteTime + (k.time - clip.origin)) }));
}

/** Inserts `key` into a sorted key list, replacing any key within half a millisecond of its time. */
function putKey(keys, key) {
  const i = keys.findIndex((k) => Math.abs(k.time - key.time) < 5e-4);
  if (i >= 0) {
    keys[i] = key;
    return keys[i];
  }
  let at = 0;
  while (at < keys.length && keys[at].time < key.time) at++;
  keys.splice(at, 0, key);
  return key;
}

/**
 * Pastes the clipboard at `pasteTime`. `resolve(track)` returns the key array to paste into (creating
 * the timeline when needed), or null to skip the track. `mode` is 'all' (the caller has already grown
 * the duration to fit) or 'clip' (drop keys that land past `limit` seconds). `snap(t)` rounds a time
 * to the frame grid. Returns the pasted key objects, for selecting them afterwards.
 */
export function pasteClipboard(clip, pasteTime, { mode, limit, snap }, resolve) {
  const pasted = [];
  const eps = 1e-6;
  for (const g of clip.groups) {
    const keys = resolve(g.track);
    if (!keys) continue;
    for (const k of g.keys) {
      const t = snap(pasteTime + (k.time - clip.origin));
      if (mode === 'clip' && t > limit + eps) continue;
      const nk = cloneKey(k);
      nk.time = t;
      pasted.push(putKey(keys, nk));
    }
  }
  return pasted;
}
