// SPDX-License-Identifier: MIT OR Apache-2.0
// Animations: keyframed timelines for bones, slots, attachments, constraints, draw order and events.
//
// Bone timeline values are relative to the setup pose: rotation, translation and shear are added,
// scale is multiplied. A key is { time, value, curve }; vector values are arrays.

import { LINEAR, ease } from './curve.js';
import { lerp } from './math.js';

/** Bone channels edited with the transform tools. Each is also the timeline property holding its keys. */
export const CHANNELS = ['rotate', 'translate', 'scale', 'shear'];
/** Single-axis bone channels (keyed separately from their combined channel). */
export const SPLIT_CHANNELS = ['translateX', 'translateY', 'scaleX', 'scaleY', 'shearX', 'shearY'];
/** Every bone timeline channel, in application order. `inherit` keys hold an inherit mode name. */
export const BONE_CHANNELS = [...CHANNELS, ...SPLIT_CHANNELS, 'inherit'];
/** Slot timeline channels: attachment name, rgba, rgb, alpha, rgba2 (light rgba + dark rgb), rgb2. */
export const SLOT_CHANNELS = ['attachment', 'color', 'rgb', 'alpha', 'rgba2', 'rgb2'];

export function makeKey(time, value, curve = LINEAR) {
  return { time, value, curve };
}

function copyValue(v) {
  return Array.isArray(v) ? v.slice() : v;
}

function interpolate(a, b, t, curve) {
  if (typeof a === 'number') return lerp(a, b, ease(curve, t, 0));
  if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], ease(curve, t, i)));
  return a; // names and other discrete values hold until the next key
}

/** Samples a sorted key list at `time`. Returns `undefined` for an empty list. */
export function sample(keys, time) {
  if (!keys || keys.length === 0) return undefined;
  if (time <= keys[0].time) return copyValue(keys[0].value);
  const next = partitionPoint(keys, (k) => k.time <= time);
  if (next >= keys.length) return copyValue(keys[keys.length - 1].value);
  const a = keys[next - 1];
  const b = keys[next];
  const span = b.time - a.time;
  const t = span > 0 ? (time - a.time) / span : 1;
  return interpolate(a.value, b.value, t, a.curve);
}

const componentOf = (k, c) => (Array.isArray(k.value) ? k.value[c] : k.value);

/** Samples component `c` of numeric keys at `time` (keys must not be empty). */
export function sampleComponent(keys, time, c = 0) {
  if (time <= keys[0].time) return componentOf(keys[0], c);
  const next = partitionPoint(keys, (k) => k.time <= time);
  if (next >= keys.length) return componentOf(keys[keys.length - 1], c);
  const a = keys[next - 1];
  const b = keys[next];
  const span = b.time - a.time;
  const va = componentOf(a, c);
  return va + (componentOf(b, c) - va) * ease(a.curve, span > 0 ? (time - a.time) / span : 1, c);
}

/** Index of the last key at or before `time`, or -1. */
export function keyIndexAt(keys, time) {
  return partitionPoint(keys, (k) => k.time <= time) - 1;
}

function partitionPoint(keys, pred) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(keys[mid])) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Inserts or replaces the key at `time` (within half a millisecond), keeping keys sorted.
 * Returns the index of the key.
 */
export function setKey(keys, time, value, curve = LINEAR) {
  const i = keys.findIndex((k) => Math.abs(k.time - time) < 5e-4);
  if (i >= 0) {
    keys[i].value = value;
    return i;
  }
  const at = partitionPoint(keys, (k) => k.time < time);
  keys.splice(at, 0, makeKey(time, value, curve));
  return at;
}

/** Re-sorts keys after a time change, returning the new index of the key formerly at `index`. */
export function resort(keys, index) {
  let i = index;
  const swap = (x, y) => ([keys[x], keys[y]] = [keys[y], keys[x]]);
  while (i > 0 && keys[i - 1].time > keys[i].time) {
    swap(i - 1, i);
    i--;
  }
  while (i + 1 < keys.length && keys[i + 1].time < keys[i].time) {
    swap(i + 1, i);
    i++;
  }
  return i;
}

export function emptyBoneTimeline(bone) {
  const tl = { bone };
  for (const ch of BONE_CHANNELS) tl[ch] = [];
  return tl;
}

export function emptySlotTimeline(slot) {
  const tl = { slot };
  for (const ch of SLOT_CHANNELS) tl[ch] = [];
  return tl;
}

export class Animation {
  constructor(name = '', duration = 0) {
    this.name = name;
    this.duration = duration;
    /** Bone timelines: { bone, rotate, translate, scale, shear, translateX, ..., inherit }. */
    this.bones = [];
    /** Slot timelines: { slot, attachment, color, rgb, alpha, rgba2, rgb2 }. */
    this.slots = [];
    /**
     * Mesh deformation: { skin (name or null for the default skin), slot, attachment, keys }.
     * Key values are { offset, vertices }: deltas added to the setup vertices from `offset` on.
     */
    this.deform = [];
    /** Draw order keys; values are [{ slot, offset }] relative to setup order, or null for setup order. */
    this.drawOrder = [];
    /** Event keys: { time, name, int?, float?, string?, volume?, balance? }. */
    this.events = [];
    /** IK constraint timelines: { constraint, keys } with values { mix, softness, bendPositive, compress, stretch }. */
    this.ik = [];
    /** Timelines Rigby2D keeps but does not evaluate yet (transform/path/physics constraints, sequences). */
    this.extra = {};
    /** Named frames on the timeline, { time, name } (editor only: kept in work files, never exported). */
    this.markers = [];
  }

  boneTimeline(bone) {
    return this.bones.find((t) => t.bone === bone);
  }

  boneTimelineMut(bone) {
    let tl = this.boneTimeline(bone);
    if (!tl) {
      tl = emptyBoneTimeline(bone);
      this.bones.push(tl);
    }
    return tl;
  }

  slotTimeline(slot) {
    return this.slots.find((t) => t.slot === slot);
  }

  slotTimelineMut(slot) {
    let tl = this.slotTimeline(slot);
    if (!tl) {
      tl = emptySlotTimeline(slot);
      this.slots.push(tl);
    }
    return tl;
  }

  /** Drops empty timelines. */
  prune() {
    this.bones = this.bones.filter((t) => BONE_CHANNELS.some((ch) => t[ch].length));
    this.slots = this.slots.filter((t) => SLOT_CHANNELS.some((ch) => t[ch].length));
    this.deform = this.deform.filter((t) => t.keys.length);
    this.ik = this.ik.filter((t) => t.keys.length);
  }

  /** Time of the last key, useful to suggest a duration. */
  lastKeyTime() {
    let max = 0;
    const scan = (keys) => {
      for (const k of keys) max = Math.max(max, k.time);
    };
    for (const t of this.bones) for (const ch of BONE_CHANNELS) scan(t[ch]);
    for (const t of this.slots) for (const ch of SLOT_CHANNELS) scan(t[ch]);
    for (const t of this.deform) scan(t.keys);
    for (const t of this.ik) scan(t.keys);
    scan(this.drawOrder);
    scan(this.events);
    return max;
  }
}
