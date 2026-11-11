// SPDX-License-Identifier: MIT OR Apache-2.0
// Document edits shared by the viewport, inspector and hierarchy. In animate mode, bone
// changes are written as keyframes instead of changing the setup pose.

import { Animation, setKey } from '../core/animation.js';
import { EASE_IN_OUT, LINEAR, STEPPED, cloneCurve } from '../core/curve.js';
import { toAffine, transform } from '../core/math.js';
import { makeBone, moveAttachment } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { FPS, Mode, selBone, selSlot, snap } from './app.js';
import { CHANNEL_FIELDS, TRANSFORM_CHANNELS as CHANNELS } from './channels.js';
import { t } from './i18n.js';

/** Makes sure an animation exists and is selected, creating one if needed. Returns its index. */
export function ensureAnimation(app) {
  if (app.anim !== null && app.anim < app.doc.animations.length) return app.anim;
  if (!app.doc.animations.length) app.doc.animations.push(new Animation('animation', 1));
  app.anim = 0;
  app.changed();
  return 0;
}

const ratio = (v, setup) => (Math.abs(setup) < 1e-6 ? v : v / setup);

function growDuration(anim, time) {
  if (time > anim.duration) anim.duration = time;
}

const differs = (a, b, fields) => fields.some((f) => Math.abs((a[f] ?? 0) - (b[f] ?? 0)) > 1e-6);

/** The key value of `channel` for local transform `t` (relative to the bone's setup pose). */
function channelValue(channel, t, setup) {
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

/** The curve new transform keys start with (Preferences ▸ Editing). */
function newKeyCurve(app) {
  const pref = app.prefs?.get('editing.keyCurve');
  return pref === 'ease' ? EASE_IN_OUT : pref === 'stepped' ? STEPPED : LINEAR;
}

/** Writes keys for `channels` of `bone` at the current time from local transform `t`. */
function writeKeys(app, bone, t, channels) {
  const time = snap(app.time);
  const anim = app.doc.animations[ensureAnimation(app)];
  const tl = anim.boneTimelineMut(bone);
  const setup = app.doc.bones[bone].setup;
  const curve = newKeyCurve(app);
  for (const ch of channels) setKey(tl[ch], time, channelValue(ch, t, setup), cloneCurve(curve));
  growDuration(anim, time);
  const pending = app.pending.get(bone);
  if (pending) {
    for (const ch of channels) delete pending[ch];
    if (!Object.keys(pending).length) app.pending.delete(bone);
  }
}

/** Keys every transform channel of `bone` at the current time to local transform `t` (Animate mode). */
export function keyBoneTransform(app, bone, t) {
  writeKeys(app, bone, t, CHANNELS);
}

/**
 * Sets a bone's local transform. Setup mode changes the setup pose. Animate mode writes keys when
 * auto key is on; otherwise the change is kept as an unkeyed change until it is keyed.
 */
export function setBoneLocal(app, bone, t) {
  if (app.mode === Mode.Setup) {
    app.doc.bones[bone].setup = t;
  } else {
    const current = app.pose().local[bone];
    const changed = CHANNELS.filter((ch) => differs(t, current, CHANNEL_FIELDS[ch]));
    if (app.autoKey) {
      writeKeys(app, bone, t, changed);
    } else if (changed.length) {
      const pending = app.pending.get(bone) ?? {};
      for (const ch of changed) pending[ch] = Object.fromEntries(CHANNEL_FIELDS[ch].map((f) => [f, t[f]]));
      app.pending.set(bone, pending);
    }
  }
  app.changed();
}

/** Key button state of a bone channel: 'changed' (unkeyed change), 'keyed' (key at this frame) or 'none'. */
export function channelState(app, bone, channel) {
  if (app.pending.get(bone)?.[channel]) return 'changed';
  return isKeyed(app, bone, channel) ? 'keyed' : 'none';
}

/** Keys `channels` of `bones` with their current values. */
export function keyChannels(app, bones, channels) {
  if (app.mode !== Mode.Animate) {
    app.setStatus(t('Switch to Animate mode to set keys'));
    return;
  }
  if (!bones.length) {
    app.setStatus(t('Select bones to key'));
    return;
  }
  const pose = app.pose();
  for (const b of bones) writeKeys(app, b, pose.local[b], channels);
  app.setStatus(t('Keyed {channels} of {bones} at frame {frame}', { channels: channels.join(', '), bones: bones.length === 1 ? app.doc.bones[bones[0]].name : t('{count} bones', { count: bones.length }), frame: Math.round(snap(app.time) * FPS) }));
}

/** Keys every unkeyed change (K). */
export function keyChanged(app) {
  if (!app.pending.size) {
    app.setStatus(app.mode === Mode.Animate ? t('No unkeyed changes to key') : t('Switch to Animate mode to set keys'));
    return;
  }
  const pose = app.pose();
  let count = 0;
  for (const [bone, channels] of [...app.pending]) {
    const list = Object.keys(channels);
    writeKeys(app, bone, pose.local[bone], list);
    count += list.length;
  }
  app.setStatus(t('Keyed {count} changed propert(ies) at frame {frame}', { count, frame: Math.round(snap(app.time) * FPS) }));
}

/** Keys the property of the current tool for the selection (L). */
export function keyTool(app) {
  const channels = { rotate: ['rotate'], translate: ['translate'], scale: ['scale'], shear: ['shear'], pose: ['rotate', 'translate'] }[app.tool];
  if (!channels) {
    app.setStatus(t('The current tool has no keyable property'));
    return;
  }
  keyChannels(app, app.selectedBones(), channels);
}

/** Keys rotate, translate, scale and shear of the selection (Ctrl+L). */
export function keyTransforms(app) {
  keyChannels(app, app.selectedBones(), CHANNELS);
}

/** Keys every bone timeline shown in the dopesheet, plus unkeyed changes (Ctrl+Shift+L). */
export function keyShown(app) {
  const anim = app.currentAnimation();
  if (app.mode !== Mode.Animate || !anim) {
    app.setStatus(t('Switch to Animate mode to set keys'));
    return;
  }
  const pose = app.pose();
  let count = 0;
  for (const tl of anim.bones) {
    const channels = CHANNELS.filter((ch) => tl[ch].length);
    writeKeys(app, tl.bone, pose.local[tl.bone], channels);
    count += channels.length;
  }
  if (app.pending.size) {
    for (const [bone, channels] of [...app.pending]) writeKeys(app, bone, pose.local[bone], Object.keys(channels));
  }
  app.setStatus(t('Keyed {count} timeline(s) at frame {frame}', { count, frame: Math.round(snap(app.time) * FPS) }));
}

/** Shows an attachment (or none) in a slot: setup value or a stepped key. */
export function setSlotAttachment(app, slot, name) {
  if (app.mode === Mode.Setup) {
    app.doc.slots[slot].attachment = name;
  } else {
    const time = snap(app.time);
    const anim = app.doc.animations[ensureAnimation(app)];
    setKey(anim.slotTimelineMut(slot).attachment, time, name, STEPPED);
    growDuration(anim, time);
  }
  app.changed();
}

/** Keys everything about the selection: all transforms of selected bones, or a slot's attachment. */
export function keySelection(app) {
  if (app.mode !== Mode.Animate) {
    app.setStatus(t('Switch to Animate mode (Tab) to set keys'));
    return;
  }
  const s = selSlot(app.sel);
  if (s !== null) setSlotAttachment(app, s, app.pose().attachment[s]);
  else keyTransforms(app);
}

export function deleteSelection(app) {
  const bones = app.selectedBones();
  const s = selSlot(app.sel);
  if (bones.length) {
    // Delete by name: removing a bone also removes its descendants and shifts indices.
    const names = bones.filter((b) => b !== 0).map((b) => app.doc.bones[b].name);
    for (const name of names) {
      const i = app.doc.boneIndex(name);
      if (i !== null) app.doc.removeBone(i);
    }
    app.pending.clear();
    if (bones.includes(0)) app.setStatus(t('The root bone cannot be deleted'));
  } else if (s !== null) {
    app.doc.removeSlot(s);
  }
  app.deselect();
}

/**
 * Adds a child bone under `parent` pointing along the parent's direction, as long as the parent
 * (so a chain made this way keeps its size instead of shrinking with every bone).
 */
export function addChildBone(app, parent) {
  const len = Math.max(app.doc.bones[parent].length, 40);
  const name = app.doc.uniqueBoneName('bone');
  const setup = transform(app.doc.bones[parent].length, 0, 0);
  const i = app.doc.addBone(makeBone(name, parent, setup, len));
  app.select({ bone: i });
  return i;
}

/** Reparents a bone while keeping it where it is in the world (setup pose). */
export function reparentBoneKeepWorld(app, bone, newParent) {
  if (bone === 0 || app.doc.isDescendant(newParent, bone)) {
    app.setStatus('A bone cannot be parented to itself or its children');
    return;
  }
  const setup = new Pose(app.doc);
  app.doc.bones[bone].setup = setup.world[newParent].inverse().mul(setup.world[bone]).decompose();
  const name = app.doc.bones[bone].name;
  app.doc.reparentBone(bone, newParent);
  const i = app.doc.boneIndex(name);
  if (i !== null) app.select({ bone: i });
  app.changed();
}

/** Moves a slot to another bone while keeping its attachments in place (setup pose). */
export function setSlotBoneKeepWorld(app, slot, newBone) {
  const setup = new Pose(app.doc);
  const old = setup.world[app.doc.slots[slot].bone];
  const toNew = setup.world[newBone].inverse().mul(old);
  for (const att of app.doc.slots[slot].attachments) moveAttachment(att, toNew);
  app.doc.slots[slot].bone = newBone;
  app.changed();
}

/** Returns whether `channel` of `bone` has a key at the current frame. */
export function isKeyed(app, bone, channel) {
  const tl = app.currentAnimation()?.boneTimeline(bone);
  if (!tl) return false;
  const t = snap(app.time);
  return tl[channel].some((k) => Math.abs(k.time - t) < 5e-4);
}
