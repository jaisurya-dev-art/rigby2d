// SPDX-License-Identifier: MIT OR Apache-2.0
// Writing poses into a skeleton without the editor: as the setup pose, or as keys of an animation
// at a time (the same values the editor's key buttons write). Used by the MCP server.

import { sample, setKey } from './animation.js';
import { LINEAR, STEPPED } from './curve.js';
import { Pose } from './pose.js';

const ratio = (v, setup) => (Math.abs(setup) < 1e-6 ? v : v / setup);

/** Key value of a bone channel for local transform `t`, relative to the setup pose. */
export function channelValue(channel, t, setup) {
  switch (channel) {
    case 'rotate':
      return t.rotation - setup.rotation;
    case 'translate':
      return [t.x - setup.x, t.y - setup.y];
    case 'scale':
      return [ratio(t.scale_x, setup.scale_x), ratio(t.scale_y, setup.scale_y)];
    default:
      return [t.shear_x - setup.shear_x, t.shear_y - setup.shear_y];
  }
}

/** The pose of `doc` at `time` in `anim` (the setup pose when `anim` is null). */
export function poseAt(doc, anim, time) {
  const pose = new Pose(doc);
  if (anim) {
    pose.apply(doc, anim, time, 1);
    pose.updateWorld(doc);
  }
  return pose;
}

/** Keys RGB or alpha without replacing the slot's other color components. */
export function keySlotTint(tl, setup, time, component, value, curve) {
  const rgb = component === 'rgb';
  // Match Pose.apply's precedence for split and two-color timelines.
  const channels = rgb ? ['rgb2', 'rgba2', 'rgb', 'color'] : ['rgba2', 'alpha', 'color'];
  const channel = channels.find((name) => tl[name].length)
    ?? (tl.rgb.length || tl.alpha.length || tl.rgb2.length ? component : 'color');
  let tint = value;
  if (channel !== component) {
    tint = sample(tl[channel], time) ?? setup.slice();
    if (rgb) tint.splice(0, 3, ...value);
    else tint[3] = value;
  }
  setKey(tl[channel], time, tint, curve);
}

/**
 * Writes `targets` ({ bones: Map(bone -> local transform), slots: Map(slot -> attachment) }):
 * into the setup pose when `anim` is null, otherwise as keys at `time` (bones: every transform
 * channel, linear; slots: stepped attachment keys). Returns the number of bones and slots written.
 */
export function writeTargets(doc, targets, anim = null, time = 0) {
  for (const [bone, t] of targets.bones) {
    const b = doc.bones[bone];
    if (!anim) {
      b.setup = { ...b.setup, ...t };
      continue;
    }
    const tl = anim.boneTimelineMut(bone);
    for (const ch of ['rotate', 'translate', 'scale', 'shear']) setKey(tl[ch], time, channelValue(ch, { ...b.setup, ...t }, b.setup), LINEAR);
  }
  for (const [slot, name] of targets.slots) {
    if (!anim) doc.slots[slot].attachment = name;
    else setKey(anim.slotTimelineMut(slot).attachment, time, name, STEPPED);
  }
  if (anim && time > anim.duration) anim.duration = time;
  return { bones: targets.bones.size, slots: targets.slots.size };
}
