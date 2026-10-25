// SPDX-License-Identifier: MIT OR Apache-2.0
// The dopesheet's rows and the order its keys appear in, and addressing a key selection by index.
// Split out of timeline.js so it depends only on the core model (no DOM, no app.js): both the
// editor and the detached panel windows build the same key order from the same document, so a
// selection can cross windows as plain indices (see panelsync.js / panel.js), and the round trip
// can be unit-tested in Node.

import { BONE_CHANNELS, SLOT_CHANNELS } from '../core/animation.js';
import { listConstraints } from '../core/constraintdata.js';
import { channelKeys, keyedChannels } from '../core/constraintkeys.js';

/** Rows of the dopesheet for the current animation: [{ track, label }]. */
export function tracks(app, anim) {
  const out = [];
  const label = (ch) => ch.replace(/([A-Z])/g, ' $1').toLowerCase();
  for (const tl of anim.bones) {
    const name = app.doc.bones[tl.bone]?.name ?? `#${tl.bone}`;
    for (const channel of BONE_CHANNELS) {
      if (tl[channel].length) out.push({ track: { bone: tl.bone, channel }, label: `${name} · ${label(channel)}` });
    }
  }
  for (const tl of anim.slots) {
    const name = app.doc.slots[tl.slot]?.name ?? `#${tl.slot}`;
    for (const channel of SLOT_CHANNELS) {
      if (tl[channel].length) out.push({ track: { slot: tl.slot, channel }, label: `${name} · ${channel === 'attachment' ? 'image' : channel}` });
    }
  }
  anim.deform.forEach((d, i) => {
    out.push({ track: { deform: i, slot: d.slot }, label: `${app.doc.slots[d.slot]?.name ?? '?'} · deform ${d.attachment}` });
  });
  anim.ik.forEach((k, i) => out.push({ track: { ik: i }, label: `IK ${app.doc.ik[k.constraint]?.name ?? '?'}` }));
  for (const [skin, slots] of Object.entries(anim.extra?.attachments ?? {})) {
    for (const [slot, atts] of Object.entries(slots)) {
      for (const [attachment, timelines] of Object.entries(atts)) {
        if (Array.isArray(timelines.sequence) && timelines.sequence.length) {
          out.push({ track: { sequence: { skin, slot, attachment } }, label: `${slot} · sequence${skin === 'default' ? '' : ` [${skin}]`}` });
        }
      }
    }
  }
  for (const t of keyedChannels(anim, listConstraints(app.doc))) {
    out.push({ track: { raw: { type: t.type, name: t.name, channel: t.channel } }, label: `${t.name} · ${t.channel ?? 'mix'}` });
  }
  if (anim.drawOrder.length) out.push({ track: { drawOrder: true }, label: 'draw order' });
  if (anim.events.length) out.push({ track: { events: true }, label: 'events' });
  return out;
}

export function trackKeys(anim, track) {
  if (track.raw) return channelKeys(anim, track.raw.type, track.raw.name, track.raw.channel);
  if (track.sequence) {
    const keys = anim.extra?.attachments?.[track.sequence.skin]?.[track.sequence.slot]?.[track.sequence.attachment]?.sequence;
    for (const k of keys ?? []) k.time ??= 0;
    return keys;
  }
  if (track.deform !== undefined) return anim.deform[track.deform]?.keys;
  if (track.ik !== undefined) return anim.ik[track.ik]?.keys;
  if (track.drawOrder) return anim.drawOrder;
  if (track.events) return anim.events;
  if (track.slot !== undefined) return anim.slotTimeline(track.slot)?.[track.channel ?? 'attachment'];
  return anim.boneTimeline(track.bone)?.[track.channel];
}

/** Every key of an animation in a fixed order, so a selection can be addressed by index. Both the
 *  editor and the detached window build the same order from the same document. */
export function orderedKeys(app, anim) {
  const out = [];
  for (const { track } of tracks(app, anim)) for (const k of trackKeys(anim, track) ?? []) out.push(k);
  return out;
}

/** The selected keys as indices into orderedKeys, for sending the selection between windows. */
export function keySelectionIndices(app) {
  const anim = app.currentAnimation();
  if (!anim || !app.selectedKeys.size) return [];
  const order = orderedKeys(app, anim);
  const out = [];
  order.forEach((k, i) => {
    if (app.selectedKeys.has(k)) out.push(i);
  });
  return out;
}

/** Resolves selection indices back to the current animation's key objects. */
export function applyKeySelection(app, indices) {
  const anim = app.currentAnimation();
  if (!anim) return (app.selectedKeys = new Set());
  const order = orderedKeys(app, anim);
  app.selectedKeys = new Set((indices ?? []).map((i) => order[i]).filter(Boolean));
}
