// SPDX-License-Identifier: MIT OR Apache-2.0
// Time operations on an animation, with no DOM (tested under Node): inserting or deleting time at a
// frame (every key after it moves, in every track: bones, slots, deform, IK, constraints, sequences,
// draw order, events and markers), and the breakdown pose between a bone's previous and next keys.

import { Pose } from '../core/pose.js';

const EPS = 1e-6;

/** Every key list of an animation: any array whose items are objects with a numeric `time`. */
export function keyLists(anim) {
  const out = [];
  const walk = (v, depth) => {
    if (depth > 6 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (v.length && v.every((k) => k && typeof k === 'object' && typeof k.time === 'number')) {
        out.push(v);
        return; // key values themselves hold no keys
      }
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'name') walk(x, depth + 1);
  };
  walk(anim, 0);
  return out;
}

/**
 * Inserts `seconds` of time at `at`: keys after `at` (a key exactly there stays) move later, and the
 * animation grows by as much. Returns how many keys moved.
 */
export function insertTime(anim, at, seconds) {
  let moved = 0;
  for (const keys of keyLists(anim)) {
    for (const k of keys) {
      if (k.time > at + EPS) {
        k.time += seconds;
        moved++;
      }
    }
  }
  anim.duration += seconds;
  return moved;
}

/**
 * Deletes the time from `from` to `to` (seconds): keys inside it are removed (a key at `from` stays),
 * later keys move back, and the animation shrinks by as much (never below `to - from` of length).
 * Returns { removed, moved }.
 */
export function deleteTime(anim, from, to) {
  const span = to - from;
  let removed = 0;
  let moved = 0;
  for (const keys of keyLists(anim)) {
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k.time > from + EPS && k.time < to + EPS) {
        keys.splice(i, 1);
        removed++;
      } else if (k.time >= to + EPS) {
        k.time -= span;
        moved++;
      }
    }
  }
  anim.duration = Math.max(span > 0 ? EPS : 0, anim.duration - span);
  return { removed, moved };
}

// ---- Breakdowns ---------------------------------------------------------------------------------

const FIELDS = ['x', 'y', 'rotation', 'scale_x', 'scale_y', 'shear_x', 'shear_y'];

/** The times of a bone's keys (any transform channel) in an animation, sorted. */
function boneKeyTimes(anim, bone) {
  const tl = anim.boneTimeline(bone);
  if (!tl) return [];
  return [...new Set(Object.values(tl).filter(Array.isArray).flatMap((keys) => keys.map((k) => k.time)))].sort((a, b) => a - b);
}

/**
 * The breakdown pose of `bones` at `time`: for each, the pose `f` of the way (0 to 1) from its pose at
 * the previous key to its pose at the next one, as local transforms ([[bone, local]]). Bones without
 * a key on both sides are left out. Like Blender's breakdowner and Harmony's: favour one key without
 * retiming anything.
 */
export function breakdownPose(doc, anim, bones, time, f) {
  const at = (t) => {
    const p = new Pose(doc);
    p.apply(doc, anim, t, 1);
    return p.local;
  };
  const out = [];
  for (const b of bones) {
    const times = boneKeyTimes(anim, b);
    const prev = [...times].reverse().find((t) => t < time - EPS);
    const next = times.find((t) => t > time + EPS);
    if (prev === undefined || next === undefined) continue;
    const a = at(prev)[b];
    const z = at(next)[b];
    out.push([b, Object.fromEntries(FIELDS.map((k) => [k, (a[k] ?? 0) + ((z[k] ?? 0) - (a[k] ?? 0)) * f]))]);
  }
  return out;
}
