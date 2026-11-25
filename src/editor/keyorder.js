// SPDX-License-Identifier: MIT OR Apache-2.0
// The dopesheet's rows and the order its keys appear in, and addressing a key selection by index.
// Split out of timeline.js so it depends only on the core model (no DOM, no app.js): both the
// editor and the detached panel windows build the same key order from the same document, so a
// selection can cross windows as plain indices (see panelsync.js / panel.js), and the round trip
// can be unit-tested in Node.

import { BONE_CHANNELS, SLOT_CHANNELS } from '../core/animation.js';
import { listConstraints } from '../core/constraintdata.js';
import { channelKeys, keyedChannels } from '../core/constraintkeys.js';
import { t, tn } from './i18n.js';

/** Timeline channel names as track labels show them (bone names stay as they are). */
const CHANNEL_LABELS = {
  rotate: tn('rotate'),
  translate: tn('translate'),
  scale: tn('scale'),
  shear: tn('shear'),
  translateX: tn('translate x'),
  translateY: tn('translate y'),
  scaleX: tn('scale x'),
  scaleY: tn('scale y'),
  shearX: tn('shear x'),
  shearY: tn('shear y'),
  inherit: tn('inherit'),
  attachment: tn('image'),
  color: tn('color'),
  rgb: tn('rgb'),
  alpha: tn('alpha'),
  rgba2: tn('two-color'),
  rgb2: tn('two-color rgb'),
  mix: tn('mix'),
};

/** A channel's label in the interface language (unknown channels as they are). */
export const channelLabel = (ch) => (CHANNEL_LABELS[ch] ? t(CHANNEL_LABELS[ch]) : ch.replace(/([A-Z])/g, ' $1').toLowerCase());

/**
 * Rows of the dopesheet for the current animation: [{ track, label, group, owner, part }]. Bones come
 * in hierarchy order (parents first) with their channels together, then slots in draw order with
 * their image, colour and deform tracks together; `group` names the bone or slot a row belongs to,
 * `owner` its name and `part` the channel, so the dopesheet can label a group once.
 */
export function tracks(app, anim) {
  const out = [];
  const label = channelLabel;
  for (const tl of [...anim.bones].sort((a, b) => a.bone - b.bone)) {
    const name = app.doc.bones[tl.bone]?.name ?? `#${tl.bone}`;
    for (const channel of BONE_CHANNELS) {
      if (tl[channel].length) out.push({ track: { bone: tl.bone, channel }, label: `${name} · ${label(channel)}`, group: `bone:${tl.bone}`, owner: name, part: label(channel) });
    }
  }
  const deformOf = new Map();
  anim.deform.forEach((d, i) => {
    if (!deformOf.has(d.slot)) deformOf.set(d.slot, []);
    deformOf.get(d.slot).push([d, i]);
  });
  const slotIds = [...new Set([...anim.slots.map((tl) => tl.slot), ...deformOf.keys()])].sort((a, b) => a - b);
  for (const slot of slotIds) {
    const tl = anim.slots.find((x) => x.slot === slot);
    const name = app.doc.slots[slot]?.name ?? `#${slot}`;
    for (const channel of tl ? SLOT_CHANNELS : []) {
      if (tl[channel].length) out.push({ track: { slot, channel }, label: `${name} · ${channelLabel(channel)}`, group: `slot:${slot}`, owner: name, part: channelLabel(channel) });
    }
    for (const [d, i] of deformOf.get(slot) ?? []) {
      const part = `${t('deform')} ${d.attachment}`;
      out.push({ track: { deform: i, slot: d.slot }, label: `${name} · ${part}`, group: `slot:${slot}`, owner: name, part });
    }
  }
  anim.ik.forEach((k, i) => out.push({ track: { ik: i }, label: `IK ${app.doc.ik[k.constraint]?.name ?? '?'}` }));
  for (const [skin, slots] of Object.entries(anim.extra?.attachments ?? {})) {
    for (const [slot, atts] of Object.entries(slots)) {
      for (const [attachment, timelines] of Object.entries(atts)) {
        if (Array.isArray(timelines.sequence) && timelines.sequence.length) {
          out.push({ track: { sequence: { skin, slot, attachment } }, label: `${slot} · ${t('sequence')}${skin === 'default' ? '' : ` [${skin}]`}` });
        }
      }
    }
  }
  for (const c of keyedChannels(anim, listConstraints(app.doc))) {
    out.push({ track: { raw: { type: c.type, name: c.name, channel: c.channel } }, label: `${c.name} · ${channelLabel(c.channel ?? 'mix')}` });
  }
  if (anim.drawOrder.length) out.push({ track: { drawOrder: true }, label: t('draw order') });
  if (anim.events.length) out.push({ track: { events: true }, label: t('events') });
  for (const row of out) {
    row.group ??= row.label;
    row.owner ??= row.label;
    row.part ??= '';
  }
  return out;
}

/**
 * The rows the dopesheet shows: all of them, or with *Selected only* on and something selected, the
 * selected bones' rows and their slots' (a selected slot: its own). Key order across windows uses
 * the full list (orderedKeys), so the filter never changes which key an index means.
 */
export function shownTracks(app, anim) {
  const all = tracks(app, anim);
  if (!app.dopesheetSelectedOnly) return all;
  const bones = new Set(app.selectedBones?.() ?? []);
  const slot = app.sel?.slot ?? null;
  if (!bones.size && slot === null) return all;
  const slots = new Set(slot !== null ? [slot] : app.doc.slots.flatMap((s, i) => (bones.has(s.bone) ? [i] : [])));
  return all.filter(({ track }) => (track.bone !== undefined && track.channel ? bones.has(track.bone) : track.slot !== undefined && slots.has(track.slot)));
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

/** Whether a track's keys blend into each other. Images, draw order, events, sequences and bone
 *  inherit switch at each key instead, so they never tween. */
export function tweens(track) {
  if (track.drawOrder || track.events || track.sequence) return false;
  if (track.raw || track.ik !== undefined || track.deform !== undefined) return true;
  if (track.slot !== undefined) return (track.channel ?? 'attachment') !== 'attachment';
  return track.channel !== 'inherit';
}

/** The tweens of a track, as [from, to] key index pairs: each key to the next one, except after a
 *  stepped key (it holds its value until the next key). */
export function tweenSpans(track, keys) {
  if (!keys || keys.length < 2 || !tweens(track)) return [];
  const out = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    if (keys[i].curve === 'stepped' || !((keys[i + 1].time ?? 0) > (keys[i].time ?? 0))) continue;
    out.push([i, i + 1]);
  }
  return out;
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
