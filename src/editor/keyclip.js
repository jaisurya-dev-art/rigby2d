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
 * A dopesheet track named instead of numbered: bones, slots and IK constraints by name, deform tracks
 * by skin, slot and attachment. Indices shift when bones are added or deleted, and deform and IK
 * indices differ between animations, so the clipboard keeps these refs and finds the live track on
 * paste (findTrack). Other tracks (constraints, sequences, draw order, events) are named already.
 */
export function trackRef(doc, anim, track) {
  if (track.deform !== undefined) {
    const d = anim.deform[track.deform];
    return d ? { deform: { skin: d.skin ?? null, slot: doc.slots[d.slot]?.name, attachment: d.attachment } } : null;
  }
  if (track.ik !== undefined) {
    const c = anim.ik[track.ik];
    return c ? { ik: doc.ik[c.constraint]?.name } : null;
  }
  if (track.bone !== undefined) return { bone: doc.bones[track.bone]?.name, channel: track.channel };
  if (track.slot !== undefined) return { slot: doc.slots[track.slot]?.name, channel: track.channel };
  return track;
}

/**
 * The live track `ref` (from trackRef) names in `anim`, or null when its bone, slot or constraint no
 * longer exists. A deform or IK track the animation does not have yet is added when `create` is set
 * (pasting into another animation), else null.
 */
export function findTrack(doc, anim, ref, create = false) {
  const named = (list, name) => (name === undefined ? -1 : list.findIndex((x) => x.name === name));
  if (ref.deform) {
    const slot = named(doc.slots, ref.deform.slot);
    if (slot < 0) return null;
    const same = (d) => d.slot === slot && d.attachment === ref.deform.attachment && (d.skin ?? null) === ref.deform.skin;
    let i = anim.deform.findIndex(same);
    if (i < 0 && create) i = anim.deform.push({ skin: ref.deform.skin, slot, attachment: ref.deform.attachment, keys: [] }) - 1;
    return i < 0 ? null : { deform: i, slot };
  }
  if (ref.ik !== undefined) {
    const constraint = named(doc.ik, ref.ik);
    if (constraint < 0) return null;
    let i = anim.ik.findIndex((c) => c.constraint === constraint);
    if (i < 0 && create) i = anim.ik.push({ constraint, keys: [] }) - 1;
    return i < 0 ? null : { ik: i };
  }
  if (ref.bone !== undefined) {
    const bone = named(doc.bones, ref.bone);
    return bone < 0 ? null : { bone, channel: ref.channel };
  }
  if (ref.slot !== undefined) {
    const slot = named(doc.slots, ref.slot);
    return slot < 0 ? null : { slot, channel: ref.channel };
  }
  return ref;
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

/** Removes every key of `keys` whose time falls within [from, to] (inclusive, frame-grid tolerant). */
export function clearSpan(keys, from, to) {
  const eps = 1e-6;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i].time >= from - eps && keys[i].time <= to + eps) keys.splice(i, 1);
  }
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
export function pasteClipboard(clip, pasteTime, { mode, limit, snap, replace }, resolve) {
  const pasted = [];
  const eps = 1e-6;
  for (const g of clip.groups) {
    const keys = resolve(g.track);
    if (!keys) continue;
    // Replace mode: the copied block's blank spaces erase existing keys, so clear the whole pasted
    // span in this track first (only this track — other tracks keep their keys). Then the copy is
    // laid down, so the destination region ends up matching the copy exactly. The span is the copied
    // AREA (`clip.cover`, the blank columns the selection swept included), falling back to the keys'
    // extent when a clipboard carries no area (e.g. older callers / unit fixtures).
    if (replace) {
      const from = pasteTime + (clip.cover?.start ?? 0);
      const end0 = pasteTime + (clip.cover?.end ?? clip.span);
      const end = mode === 'clip' ? Math.min(end0, limit) : end0;
      clearSpan(keys, from, end);
    }
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
