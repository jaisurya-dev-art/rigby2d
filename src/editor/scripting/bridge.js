// SPDX-License-Identifier: MIT OR Apache-2.0
// The editor side of the Python `rigby` module. Scripts call `call(name, argsJson)`; arguments
// and results are JSON, so no Python or JavaScript objects are shared between the two. Every
// function works on the open project; the script runner turns a whole script or tool run into one
// undo step (or rolls it back when the script fails).

import { Animation, CHANNELS, setKey } from '../../core/animation.js';
import { addConstraint, addIk, constraintNameTaken, listConstraints, removeConstraint } from '../../core/constraintdata.js';
import { constraintChannels, setConstraintKey, setIkKey } from '../../core/constraintkeys.js';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, STEPPED, isBezier } from '../../core/curve.js';
import { makeBone, makeSlot, vertexCount } from '../../core/model.js';
import { transform } from '../../core/math.js';
import { applyDrawOrder } from '../../core/pose.js';
import { keepPoseOffsets } from '../constraintoffsets.js';

const CURVES = { linear: LINEAR, stepped: STEPPED, ease_in: EASE_IN, ease_out: EASE_OUT, ease_in_out: EASE_IN_OUT };
const SETUP_FIELDS = ['x', 'y', 'rotation', 'scale_x', 'scale_y', 'shear_x', 'shear_y'];
/** Keys closer than this (seconds) are the same key, as in the editor. */
const SAME_TIME = 5e-4;

/** An error a script can fix (wrong name, bad value): shown without the editor's stack. */
export class ScriptApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RigbyError';
  }
}

const fail = (message) => {
  throw new ScriptApiError(message);
};

function boneIndex(doc, name) {
  const i = doc.bones.findIndex((b) => b.name === name);
  if (i < 0) fail(`No bone '${name}'`);
  return i;
}

function slotIndex(doc, name) {
  const i = doc.slots.findIndex((s) => s.name === name);
  if (i < 0) fail(`No slot '${name}'`);
  return i;
}

function animationOf(app, name) {
  if (name === null || name === undefined) {
    const anim = app.currentAnimation();
    if (!anim) fail('No current animation: pass an animation name or open one');
    return anim;
  }
  return app.doc.animations.find((a) => a.name === name) ?? fail(`No animation '${name}'`);
}

function checkNumber(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a number`);
  return v;
}

function checkName(name, what) {
  if (typeof name !== 'string' || !name.trim()) fail(`The ${what} name must be a non-empty string`);
}

const curveName = (c) => (c === STEPPED ? 'stepped' : isBezier(c) ? Object.entries(CURVES).find(([, v]) => v === c)?.[0] ?? 'bezier' : 'linear');

const boneInfo = (doc, b) => ({ name: b.name, parent: b.parent === null ? null : doc.bones[b.parent].name, length: b.length, ...Object.fromEntries(SETUP_FIELDS.map((f) => [f, b.setup[f]])) });

const slotInfo = (doc, s) => ({ name: s.name, bone: doc.bones[s.bone].name, attachment: s.attachment, attachments: s.attachments.map((a) => a.name), color: [...s.color] });

/** Key value from a script value: rotate takes a number, the other channels [x, y]. */
function keyValue(channel, value) {
  if (!CHANNELS.includes(channel)) fail(`Unknown channel '${channel}'; use one of ${CHANNELS.join(', ')}`);
  if (channel === 'rotate') return checkNumber(value, 'A rotate key value');
  if (!Array.isArray(value) || value.length !== 2) fail(`A ${channel} key value must be [x, y]`);
  return [checkNumber(value[0], `${channel} x`), checkNumber(value[1], `${channel} y`)];
}

const roundTime = (t) => Math.round(Math.max(0, checkNumber(t, 'time')) * 1e6) / 1e6;

function curveOf(curve) {
  if (!(curve in CURVES)) fail(`Unknown curve '${curve}'; use one of ${Object.keys(CURVES).join(', ')}`);
  return CURVES[curve];
}

/** Sets a key in a sorted key list (replacing one at the same time) and stretches the animation to it. */
function putKey(anim, keys, time, value, curve) {
  const i = setKey(keys, time, value);
  keys[i].curve = curveOf(curve);
  if (time > anim.duration) anim.duration = time;
  return keys[i];
}

function removeKeyAt(keys, time) {
  const i = keys.findIndex((k) => Math.abs(k.time - time) < SAME_TIME);
  if (i < 0) return false;
  keys.splice(i, 1);
  return true;
}

function checkColor(v, what = 'color') {
  if (!Array.isArray(v) || v.length !== 4) fail(`${what} must be [r, g, b, a] with values 0..1`);
  return v.map((c, i) => Math.max(0, Math.min(1, checkNumber(c, `${what}[${i}]`))));
}

/** snake_case script names to the camelCase of the file format: bend_positive -> bendPositive. */
const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function skinOf(doc, name) {
  if (name === null || name === undefined || name === 'default') return null;
  return doc.findSkin(name) ?? fail(`No skin '${name}'`);
}

/** A slot's attachment by name, in `skin` (null: what the editor shows, through the active skins). */
function attachmentOf(doc, slot, name, skin = null) {
  const att = skin === null || skin === undefined ? doc.attachment(slot, name) : doc.skinAttachments(slot, skinOf(doc, skin) ? skin : null).find((a) => a.name === name);
  return att ?? fail(`Slot '${doc.slots[slot].name}' has no attachment '${name}'${skin ? ` in skin '${skin}'` : ''}`);
}

const pairs = (flat) => Array.from({ length: Math.floor((flat?.length ?? 0) / 2) }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);

function checkPairs(list, count, what) {
  if (!Array.isArray(list) || list.length !== count) fail(`${what} must be a list of ${count} (x, y) pairs`);
  return list.flatMap((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) fail(`${what}[${i}] must be (x, y)`);
    return [checkNumber(p[0], `${what}[${i}] x`), checkNumber(p[1], `${what}[${i}] y`)];
  });
}

function meshInfo(doc, slot, att) {
  const source = doc.meshSource(slot, att);
  const out = { name: att.name, type: att.type, slot: doc.slots[slot].name, image: att.image ?? null, vertex_count: source ? vertexCount(source) : 0, weighted: !!source?.weights };
  if (!source) return out;
  out.uvs = pairs(source.uvs);
  out.triangles = Array.from({ length: Math.floor((source.triangles?.length ?? 0) / 3) }, (_, i) => source.triangles.slice(3 * i, 3 * i + 3));
  out.hull = source.hull ?? 0;
  if (source.weights) out.weights = source.weights.map((v) => v.map((w) => ({ bone: doc.bones[w.bone].name, x: w.x, y: w.y, weight: w.weight })));
  else out.vertices = pairs(source.vertices);
  return out;
}

/** The slot order of a draw order key's offsets, as slot names. */
const orderNames = (doc, offsets) => applyDrawOrder(doc.slots.length, offsets).map((i) => doc.slots[i].name);

function constraintInfo(doc, c) {
  if (c.type === 'ik') {
    const ik = doc.ik[c.ik];
    return { name: c.name, type: 'ik', order: c.order, bones: ik.bones.map((b) => doc.bones[b].name), target: doc.bones[ik.target].name, mix: ik.mix, softness: ik.softness, bend_positive: ik.bendPositive, compress: ik.compress, stretch: ik.stretch, uniform: ik.uniform };
  }
  const data = JSON.parse(JSON.stringify(c.data));
  return { ...Object.fromEntries(Object.entries(data).map(([k, v]) => [snake(k), v])), name: c.name, type: c.type, order: c.order };
}

const constraintOf = (doc, name) => listConstraints(doc).find((c) => c.name === name) ?? fail(`No constraint '${name}'`);

/** Fields scripts may set on a constraint (besides any number or true/false it already has). */
const CONSTRAINT_FIELDS = {
  ik: { mix: 'number', softness: 'number', bendPositive: 'boolean', compress: 'boolean', stretch: 'boolean', uniform: 'boolean' },
  transform: { mixRotate: 'number', mixX: 'number', mixY: 'number', mixScaleX: 'number', mixScaleY: 'number', mixShearY: 'number', local: 'boolean', additive: 'boolean' },
  path: { position: 'number', spacing: 'number', mixRotate: 'number', mixX: 'number', mixY: 'number' },
  physics: { inertia: 'number', strength: 'number', damping: 'number', mass: 'number', wind: 'number', gravity: 'number', mix: 'number', step: 'number', limit: 'number', x: 'number', y: 'number', rotate: 'number', scaleX: 'number', shearX: 'number' },
  slider: { time: 'number', mix: 'number', loop: 'boolean', scale: 'number', offset: 'number', local: 'boolean' },
};

function newConstraintName(doc, name) {
  checkName(name, 'constraint');
  if (constraintNameTaken(doc, name)) fail(`A constraint named '${name}' already exists`);
}

/** The API functions, by name. Each takes the app and the call's arguments object. */
export const API = {
  info(app) {
    const anim = app.currentAnimation();
    return {
      path: app.path,
      workspace: app.workspace,
      fps: app.doc.settings?.fps ?? 30,
      mode: app.mode,
      time: app.time,
      animation: anim?.name ?? null,
      skin: app.doc.skin ?? null,
    };
  },

  bones: (app) => app.doc.bones.map((b) => boneInfo(app.doc, b)),
  bone: (app, { name }) => boneInfo(app.doc, app.doc.bones[boneIndex(app.doc, name)]),

  add_bone(app, { name, parent = 'root', x = 0, y = 0, rotation = 0, length = 0 }) {
    const doc = app.doc;
    checkName(name, 'bone');
    if (doc.bones.some((b) => b.name === name)) fail(`A bone named '${name}' already exists`);
    const p = boneIndex(doc, parent);
    // Appending keeps every parent before its children and existing indices unchanged.
    doc.bones.push(makeBone(name, p, transform(checkNumber(x, 'x'), checkNumber(y, 'y'), checkNumber(rotation, 'rotation')), Math.max(0, checkNumber(length, 'length'))));
    return boneInfo(doc, doc.bones[doc.bones.length - 1]);
  },

  /** Changes a bone's setup pose (relative to its parent) and length. */
  set_bone(app, { name, fields }) {
    const bone = app.doc.bones[boneIndex(app.doc, name)];
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (k === 'length') bone.length = Math.max(0, checkNumber(v, 'length'));
      else if (SETUP_FIELDS.includes(k)) bone.setup[k] = checkNumber(v, k);
      else if (k === 'name') {
        checkName(v, 'bone');
        if (v !== bone.name && app.doc.bones.some((b) => b.name === v)) fail(`A bone named '${v}' already exists`);
        bone.name = v;
      } else fail(`Bones have no field '${k}'`);
    }
    return boneInfo(app.doc, bone);
  },

  /** A bone's world transform in the pose shown (the animation frame in Animate mode). */
  world(app, { name }) {
    const i = boneIndex(app.doc, name);
    const m = app.pose().world[i];
    return {
      x: m.tx,
      y: m.ty,
      rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      scale_x: Math.hypot(m.a, m.b),
      scale_y: Math.hypot(m.c, m.d),
    };
  },

  slots: (app) => app.doc.slots.map((s) => slotInfo(app.doc, s)),

  /** Changes a slot's setup attachment (a name, or null to show nothing) and color [r, g, b, a]. */
  set_slot(app, { name, fields }) {
    const slot = app.doc.slots[slotIndex(app.doc, name)];
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (k === 'attachment') {
        if (v !== null && !slot.attachments.some((a) => a.name === v)) fail(`Slot '${slot.name}' has no attachment '${v}'`);
        slot.attachment = v;
      } else if (k === 'color') {
        if (!Array.isArray(v) || v.length !== 4) fail('color must be [r, g, b, a] with values 0..1');
        slot.color = v.map((c, i) => Math.max(0, Math.min(1, checkNumber(c, `color[${i}]`))));
      } else fail(`Slots have no field '${k}'`);
    }
    return slotInfo(app.doc, slot);
  },

  animations: (app) => app.doc.animations.map((a) => ({ name: a.name, duration: a.duration })),

  add_animation(app, { name, duration = 0 }) {
    checkName(name, 'animation');
    if (app.doc.animations.some((a) => a.name === name)) fail(`An animation named '${name}' already exists`);
    app.doc.animations.push(new Animation(name, Math.max(0, checkNumber(duration, 'duration'))));
    return { name, duration };
  },

  set_duration(app, { animation, duration }) {
    const anim = animationOf(app, animation);
    anim.duration = Math.max(0, checkNumber(duration, 'duration'));
    return { name: anim.name, duration: anim.duration };
  },

  /**
   * Sets a bone key (replacing one at the same time). Values are relative to the setup pose, as in
   * the editor: rotate adds degrees, translate and shear add [x, y], scale multiplies by [x, y].
   */
  set_key(app, { animation = null, bone, channel, time = null, value, curve = 'linear' }) {
    const anim = animationOf(app, animation);
    const b = boneIndex(app.doc, bone);
    const v = keyValue(channel, value);
    if (!(curve in CURVES)) fail(`Unknown curve '${curve}'; use one of ${Object.keys(CURVES).join(', ')}`);
    const t = Math.round(Math.max(0, checkNumber(time ?? app.time, 'time')) * 1e6) / 1e6;
    const keys = anim.boneTimelineMut(b)[channel];
    const i = setKey(keys, t, v);
    keys[i].curve = CURVES[curve];
    if (t > anim.duration) anim.duration = t;
    return { animation: anim.name, bone, channel, time: t, keys: keys.length };
  },

  delete_key(app, { animation = null, bone, channel, time = null }) {
    const anim = animationOf(app, animation);
    const b = boneIndex(app.doc, bone);
    if (!CHANNELS.includes(channel)) fail(`Unknown channel '${channel}'`);
    const t = time ?? app.time;
    const tl = anim.boneTimeline(b);
    const keys = tl?.[channel] ?? [];
    const i = keys.findIndex((k) => Math.abs(k.time - t) < SAME_TIME);
    if (i < 0) return false;
    keys.splice(i, 1);
    anim.prune();
    return true;
  },

  keys(app, { animation = null, bone, channel }) {
    const anim = animationOf(app, animation);
    if (!CHANNELS.includes(channel)) fail(`Unknown channel '${channel}'`);
    const tl = anim.boneTimeline(boneIndex(app.doc, bone));
    return (tl?.[channel] ?? []).map((k) => ({ time: k.time, value: Array.isArray(k.value) ? [...k.value] : k.value, curve: curveName(k.curve) }));
  },

  remove_bone(app, { name }) {
    const i = boneIndex(app.doc, name);
    if (i === 0) fail('The root bone cannot be removed');
    app.doc.removeBone(i);
    app.sel = null;
    app.multi = new Set();
    return true;
  },

  // ---- slots and draw order -------------------------------------------------------------------

  add_slot(app, { name, bone = 'root' }) {
    const doc = app.doc;
    checkName(name, 'slot');
    if (doc.slots.some((s) => s.name === name)) fail(`A slot named '${name}' already exists`);
    doc.slots.push(makeSlot(name, boneIndex(doc, bone), null));
    return slotInfo(doc, doc.slots.at(-1));
  },

  remove_slot(app, { name }) {
    app.doc.removeSlot(slotIndex(app.doc, name));
    return true;
  },

  /** Slot names in setup draw order, back to front. */
  draw_order: (app) => app.doc.slots.map((s) => s.name),

  /** Reorders the setup draw order: `names` lists every slot once, back to front. */
  set_draw_order(app, { names }) {
    const doc = app.doc;
    if (!Array.isArray(names) || names.length !== doc.slots.length || new Set(names).size !== names.length) fail(`set_draw_order needs every slot exactly once (${doc.slots.length} names)`);
    const wanted = names.map((n) => slotIndex(doc, n));
    // Move the slots into place one by one; each move keeps every reference to them.
    for (let to = 0; to < wanted.length; to++) {
      const from = doc.slots.findIndex((s) => s.name === names[to]);
      doc.moveSlot(from, to);
    }
    return doc.slots.map((s) => s.name);
  },

  /** A draw order key: `names` (every slot once, back to front), or null for the setup order. */
  key_draw_order(app, { animation = null, time = null, names }) {
    const doc = app.doc;
    const anim = animationOf(app, animation);
    const t = roundTime(time ?? app.time);
    let offsets = null;
    if (names !== null && names !== undefined) {
      if (!Array.isArray(names) || names.length !== doc.slots.length || new Set(names).size !== names.length) fail(`A draw order key needs every slot exactly once (${doc.slots.length} names)`);
      // Every slot with its exact place: applyDrawOrder then reproduces `names` whatever moved.
      offsets = names.map((n, at) => ({ slot: slotIndex(doc, n), offset: at - slotIndex(doc, n) })).sort((a, b) => a.slot - b.slot);
      if (offsets.every((o) => o.offset === 0)) offsets = null;
    }
    putKey(anim, anim.drawOrder, t, offsets, 'stepped');
    return { animation: anim.name, time: t, order: orderNames(doc, offsets) };
  },

  draw_order_keys(app, { animation = null }) {
    const anim = animationOf(app, animation);
    return anim.drawOrder.map((k) => ({ time: k.time, order: orderNames(app.doc, k.value) }));
  },

  delete_draw_order_key(app, { animation = null, time = null }) {
    const anim = animationOf(app, animation);
    return removeKeyAt(anim.drawOrder, time ?? app.time);
  },

  // ---- slot keys --------------------------------------------------------------------------------

  /** Keys which attachment a slot shows (`name`, or null to show nothing). */
  key_attachment(app, { animation = null, slot, time = null, name }) {
    const doc = app.doc;
    const anim = animationOf(app, animation);
    const s = slotIndex(doc, slot);
    if (name !== null && name !== undefined) attachmentOf(doc, s, name);
    const t = roundTime(time ?? app.time);
    putKey(anim, anim.slotTimelineMut(s).attachment, t, name ?? null, 'stepped');
    return { animation: anim.name, slot, time: t };
  },

  /** Keys a slot's color [r, g, b, a] (multiplied with the image; alpha fades). */
  key_color(app, { animation = null, slot, time = null, color, curve = 'linear' }) {
    const doc = app.doc;
    const anim = animationOf(app, animation);
    const s = slotIndex(doc, slot);
    const t = roundTime(time ?? app.time);
    putKey(anim, anim.slotTimelineMut(s).color, t, checkColor(color), curve);
    return { animation: anim.name, slot, time: t };
  },

  slot_keys(app, { animation = null, slot, channel }) {
    const anim = animationOf(app, animation);
    if (channel !== 'attachment' && channel !== 'color') fail("Slot key channels are 'attachment' and 'color'");
    const tl = anim.slotTimeline(slotIndex(app.doc, slot));
    return (tl?.[channel] ?? []).map((k) => ({ time: k.time, value: Array.isArray(k.value) ? [...k.value] : k.value, curve: curveName(k.curve) }));
  },

  delete_slot_key(app, { animation = null, slot, channel, time = null }) {
    const anim = animationOf(app, animation);
    if (channel !== 'attachment' && channel !== 'color') fail("Slot key channels are 'attachment' and 'color'");
    const tl = anim.slotTimeline(slotIndex(app.doc, slot));
    const done = removeKeyAt(tl?.[channel] ?? [], time ?? app.time);
    if (done) anim.prune();
    return done;
  },

  // ---- meshes -----------------------------------------------------------------------------------

  /** A mesh (or any attachment): vertices (bone space; or weights), uvs, triangles, hull. */
  mesh(app, { slot, name = null, skin = null }) {
    const doc = app.doc;
    const s = slotIndex(doc, slot);
    const att = attachmentOf(doc, s, name ?? doc.slots[s].attachment ?? fail(`Slot '${slot}' shows no attachment; pass a name`), skin);
    return meshInfo(doc, s, att);
  },

  /** A mesh's vertices in world space, in the pose shown. */
  mesh_world(app, { slot, name = null }) {
    const doc = app.doc;
    const s = slotIndex(doc, slot);
    const att = attachmentOf(doc, s, name ?? doc.slots[s].attachment ?? fail(`Slot '${slot}' shows no attachment; pass a name`));
    if (!doc.meshSource(s, att)) fail(`'${att.name}' is not a mesh`);
    return pairs(app.pose().worldVertices(doc, s, att));
  },

  /** Moves an unweighted mesh's setup vertices (bone space). */
  set_mesh_vertices(app, { slot, name, vertices, skin = null }) {
    const doc = app.doc;
    const s = slotIndex(doc, slot);
    const att = attachmentOf(doc, s, name, skin);
    if (att.type !== 'mesh') fail(`'${name}' is not a mesh${att.type === 'linkedmesh' ? ' (a linked mesh: change its parent mesh)' : ''}`);
    if (att.weights) fail(`'${name}' is weighted: its vertices belong to bones; move the bones instead`);
    att.vertices = checkPairs(vertices, vertexCount(att), 'vertices');
    return meshInfo(doc, s, att);
  },

  /** A deform key: offsets [(dx, dy), ...] added to each vertex of an unweighted mesh. */
  key_deform(app, { animation = null, slot, name, time = null, offsets, curve = 'linear', skin = null }) {
    const doc = app.doc;
    const anim = animationOf(app, animation);
    const s = slotIndex(doc, slot);
    const att = attachmentOf(doc, s, name, skin);
    if (att.type !== 'mesh') fail(`'${name}' is not a mesh`);
    if (att.weights) fail(`'${name}' is weighted: deform keys of weighted meshes are not in the scripting API yet`);
    const flat = checkPairs(offsets, vertexCount(att), 'offsets');
    const t = roundTime(time ?? app.time);
    const skinName = skin && skin !== 'default' ? skin : null;
    let tl = anim.deform.find((d) => d.slot === s && d.attachment === name && (d.skin ?? null) === skinName);
    if (!tl) anim.deform.push((tl = { skin: skinName, slot: s, attachment: name, keys: [] }));
    putKey(anim, tl.keys, t, { offset: 0, vertices: flat }, curve);
    return { animation: anim.name, slot, attachment: name, time: t, keys: tl.keys.length };
  },

  deform_keys(app, { animation = null, slot, name, skin = null }) {
    const anim = animationOf(app, animation);
    const s = slotIndex(app.doc, slot);
    const skinName = skin && skin !== 'default' ? skin : null;
    const tl = anim.deform.find((d) => d.slot === s && d.attachment === name && (d.skin ?? null) === skinName);
    return (tl?.keys ?? []).map((k) => {
      const n = vertexCount(attachmentOf(app.doc, s, name, skin));
      const full = new Array(n * 2).fill(0);
      (k.value?.vertices ?? []).forEach((v, i) => (full[(k.value.offset ?? 0) + i] = v));
      return { time: k.time, offsets: pairs(full), curve: curveName(k.curve) };
    });
  },

  // ---- skins ------------------------------------------------------------------------------------

  skins: (app) => ({ names: ['default', ...app.doc.skins.map((s) => s.name)], active: app.doc.skin ?? 'default' }),

  add_skin(app, { name, copy = null }) {
    const doc = app.doc;
    checkName(name, 'skin');
    if (name === 'default' || doc.findSkin(name)) fail(`A skin named '${name}' already exists`);
    const from = copy === null || copy === undefined ? null : skinOf(doc, copy) ?? fail('Copy a named skin; the default skin is every slot\'s own attachments');
    doc.skins.push(from ? { ...JSON.parse(JSON.stringify(from)), name } : { name, slots: [], bones: [], ik: [], color: null, extra: {} });
    return name;
  },

  remove_skin(app, { name }) {
    const doc = app.doc;
    const skin = skinOf(doc, name) ?? fail('The default skin cannot be removed');
    doc.skins.splice(doc.skins.indexOf(skin), 1);
    if (doc.skin === name) doc.skin = null;
    doc.extraSkins = (doc.extraSkins ?? []).filter((n) => n !== name);
    for (const a of doc.animations) a.deform = a.deform.filter((d) => d.skin !== name);
    return true;
  },

  /** Shows a skin (null or 'default' for the default skin only). */
  set_skin(app, { name }) {
    const doc = app.doc;
    doc.skin = skinOf(doc, name) ? name : null;
    return doc.skin ?? 'default';
  },

  /** The attachments a skin defines: [{ slot, name, type }]. */
  skin_attachments(app, { name }) {
    const doc = app.doc;
    const skin = skinOf(doc, name);
    if (!skin) return doc.slots.flatMap((s) => s.attachments.map((a) => ({ slot: s.name, name: a.name, type: a.type })));
    return skin.slots.flatMap((e) => e.attachments.map((a) => ({ slot: doc.slots[e.slot].name, name: a.name, type: a.type })));
  },

  /** Puts a copy of an attachment (found in `source`, default: the default skin) into a skin. */
  skin_add(app, { name, slot, attachment, source = 'default' }) {
    const doc = app.doc;
    const skin = skinOf(doc, name) ?? fail('Add attachments to a named skin; the default skin holds each slot\'s own');
    const s = slotIndex(doc, slot);
    const att = attachmentOf(doc, s, attachment, source);
    let entry = skin.slots.find((e) => e.slot === s);
    if (!entry) skin.slots.push((entry = { slot: s, attachments: [] }));
    entry.attachments = entry.attachments.filter((a) => a.name !== attachment).concat(JSON.parse(JSON.stringify(att)));
    return { skin: name, slot, attachment };
  },

  skin_remove(app, { name, slot, attachment }) {
    const doc = app.doc;
    const skin = skinOf(doc, name) ?? fail('The default skin is each slot\'s own attachments');
    const entry = skin.slots.find((e) => e.slot === slotIndex(doc, slot));
    const before = entry?.attachments.length ?? 0;
    if (entry) entry.attachments = entry.attachments.filter((a) => a.name !== attachment);
    skin.slots = skin.slots.filter((e) => e.attachments.length);
    return (entry?.attachments.length ?? 0) < before;
  },

  // ---- events -----------------------------------------------------------------------------------

  events: (app) => app.doc.events.map((e) => ({ name: e.name, int: e.int ?? 0, float: e.float ?? 0, string: e.string ?? '', audio: e.audio ?? null })),

  add_event(app, { name, int = 0, float = 0, string = '' }) {
    const doc = app.doc;
    checkName(name, 'event');
    if (doc.events.some((e) => e.name === name)) fail(`An event named '${name}' already exists`);
    if (!Number.isInteger(int)) fail('int must be a whole number');
    doc.events.push({ name, int, float: checkNumber(float, 'float'), string: String(string), audio: null, volume: 1, balance: 0 });
    return name;
  },

  remove_event(app, { name }) {
    const doc = app.doc;
    const i = doc.events.findIndex((e) => e.name === name);
    if (i < 0) fail(`No event '${name}'`);
    doc.events.splice(i, 1);
    for (const a of doc.animations) a.events = a.events.filter((k) => k.name !== name);
    return true;
  },

  /** Fires event `name` at `time`; int, float and string override its defaults for this key. */
  key_event(app, { animation = null, name, time = null, int = null, float = null, string = null }) {
    const doc = app.doc;
    const anim = animationOf(app, animation);
    if (!doc.events.some((e) => e.name === name)) fail(`No event '${name}'; add it with rigby.add_event first`);
    const t = roundTime(time ?? app.time);
    const key = { time: t, name };
    if (int !== null) {
      if (!Number.isInteger(int)) fail('int must be a whole number');
      key.int = int;
    }
    if (float !== null) key.float = checkNumber(float, 'float');
    if (string !== null) key.string = String(string);
    anim.events = anim.events.filter((k) => !(k.name === name && Math.abs(k.time - t) < SAME_TIME));
    anim.events.push(key);
    anim.events.sort((a, b) => a.time - b.time);
    if (t > anim.duration) anim.duration = t;
    return { animation: anim.name, name, time: t };
  },

  event_keys(app, { animation = null }) {
    return animationOf(app, animation).events.map((k) => ({ ...k }));
  },

  delete_event_key(app, { animation = null, name, time = null }) {
    const anim = animationOf(app, animation);
    const t = time ?? app.time;
    const before = anim.events.length;
    anim.events = anim.events.filter((k) => !(k.name === name && Math.abs(k.time - t) < SAME_TIME));
    return anim.events.length < before;
  },

  // ---- constraints ------------------------------------------------------------------------------

  constraints: (app) => listConstraints(app.doc).map((c) => constraintInfo(app.doc, c)),
  constraint: (app, { name }) => constraintInfo(app.doc, constraintOf(app.doc, name)),

  /** IK: `bones` (one, or a parent and its child) reach for `target`. */
  add_ik(app, { name, bones, target, bend_positive = true, mix = 1 }) {
    const doc = app.doc;
    newConstraintName(doc, name);
    if (!Array.isArray(bones) || bones.length < 1 || bones.length > 2) fail('IK takes one bone, or two (a parent and its child)');
    const chain = bones.map((b) => boneIndex(doc, b));
    if (chain.length === 2 && doc.bones[chain[1]].parent !== chain[0]) fail(`'${bones[1]}' must be a child of '${bones[0]}' for a two-bone IK`);
    const t = boneIndex(doc, target);
    if (chain.includes(t)) fail('The target cannot be one of the IK bones');
    addIk(doc, { name, bones: chain, target: t, bendPositive: !!bend_positive, mix: checkNumber(mix, 'mix') });
    return constraintInfo(doc, constraintOf(doc, name));
  },

  /** Transform: `bone` follows `source`, keeping where it is now (offsets from the current pose). */
  add_transform(app, { name, bone, source }) {
    const doc = app.doc;
    newConstraintName(doc, name);
    boneIndex(doc, bone);
    boneIndex(doc, source);
    if (bone === source) fail('A bone cannot follow itself');
    const props = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
    const d = addConstraint(doc, { type: 'transform', name, bones: [bone], source, properties: Object.fromEntries(props.map((p) => [p, { to: { [p]: {} } }])) });
    keepPoseOffsets(doc, d);
    return constraintInfo(doc, constraintOf(doc, name));
  },

  /** Physics on one bone: it lags, sways and settles (rotate, x, y: how much each is simulated). */
  add_physics(app, { name, bone, rotate = 1, x = 0, y = 0 }) {
    const doc = app.doc;
    newConstraintName(doc, name);
    boneIndex(doc, bone);
    const data = { type: 'physics', name, bone, rotate: checkNumber(rotate, 'rotate') };
    if (x) data.x = checkNumber(x, 'x');
    if (y) data.y = checkNumber(y, 'y');
    addConstraint(doc, data);
    return constraintInfo(doc, constraintOf(doc, name));
  },

  /** Changes a constraint's settings (mix, softness, bend_positive, ...; see the guide per type). */
  set_constraint(app, { name, fields }) {
    const doc = app.doc;
    const c = constraintOf(doc, name);
    const target = c.type === 'ik' ? doc.ik[c.ik] : c.data;
    for (const [key, v] of Object.entries(fields ?? {})) {
      const k = camel(key);
      const kind = CONSTRAINT_FIELDS[c.type]?.[k] ?? (typeof target[k] === 'number' || typeof target[k] === 'boolean' ? typeof target[k] : null);
      if (!kind) fail(`${c.type} constraints have no setting '${key}'`);
      if (kind === 'boolean') {
        if (typeof v !== 'boolean') fail(`${key} must be True or False`);
        target[k] = v;
      } else target[k] = checkNumber(v, key);
    }
    return constraintInfo(doc, c);
  },

  remove_constraint(app, { name }) {
    constraintOf(app.doc, name);
    return removeConstraint(app.doc, name);
  },

  /** Keys a constraint's settings at `time`: ik mix/softness/bend_positive/..., transform and path mixes, physics and slider values. */
  key_constraint(app, { animation = null, name, time = null, values }) {
    const doc = app.doc;
    const anim = animationOf(app, animation);
    const c = constraintOf(doc, name);
    const t = roundTime(time ?? app.time);
    const given = Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [camel(k), v]));
    if (!Object.keys(given).length) fail('Pass the values to key, for example mix=0.5');
    if (c.type === 'ik') {
      const ik = doc.ik[c.ik];
      const value = { mix: ik.mix, softness: ik.softness, bendPositive: ik.bendPositive, compress: ik.compress, stretch: ik.stretch };
      for (const [k, v] of Object.entries(given)) {
        if (!(k in value)) fail(`IK keys hold mix, softness, bend_positive, compress and stretch, not '${snake(k)}'`);
        value[k] = typeof value[k] === 'boolean' ? !!v : checkNumber(v, snake(k));
      }
      setIkKey(anim, c.ik, t, value);
    } else {
      const channels = constraintChannels(c.type);
      for (const [k, v] of Object.entries(given)) {
        const multi = channels.find((ch) => ch.fields.includes(k) && !(ch.fields.length === 1 && ch.fields[0] === 'value'));
        const single = channels.find((ch) => ch.channel === k && ch.fields.length === 1 && ch.fields[0] === 'value');
        if (multi) setConstraintKey(anim, c.type, name, multi.channel, t, { [k]: checkNumber(v, snake(k)) });
        else if (single) setConstraintKey(anim, c.type, name, single.channel, t, { value: checkNumber(v, snake(k)) });
        else fail(`${c.type} keys hold ${channels.flatMap((ch) => (ch.fields[0] === 'value' ? [ch.channel] : ch.fields)).map(snake).join(', ')}, not '${snake(k)}'`);
      }
    }
    if (t > anim.duration) anim.duration = t;
    return { animation: anim.name, name, time: t };
  },

  selection: (app) => app.selectedBones().map((i) => app.doc.bones[i].name),

  select(app, { names }) {
    const indices = (names ?? []).map((n) => boneIndex(app.doc, n));
    app.sel = indices.length ? { bone: indices[0] } : null;
    app.multi = new Set(indices);
    return indices.length;
  },

  set_time(app, { time }) {
    app.playing = false;
    app.time = Math.max(0, checkNumber(time, 'time'));
    return app.time;
  },

  set_animation(app, { name }) {
    const i = app.doc.animations.findIndex((a) => a.name === name);
    if (i < 0) fail(`No animation '${name}'`);
    app.anim = i;
    return name;
  },

  set_mode(app, { mode }) {
    if (mode !== 'setup' && mode !== 'animate') fail("mode must be 'setup' or 'animate'");
    if (mode === 'animate' && app.anim === null) fail('Open or add an animation before switching to animate mode');
    app.playing = false;
    app.mode = mode;
    return mode;
  },
};

/**
 * Calls API function `name` with JSON arguments; returns JSON. `hooks` receives log and status
 * calls (`log(level, text)`, `status(text)`), which are not project edits.
 */
export function callApi(app, hooks, name, argsJson) {
  const args = argsJson ? JSON.parse(argsJson) : {};
  if (name === 'log') return JSON.stringify(hooks.log(args.level, args.text) ?? null);
  if (name === 'status') return JSON.stringify(hooks.status(args.text) ?? null);
  const fn = Object.hasOwn(API, name) ? API[name] : null;
  if (!fn) throw new ScriptApiError(`Unknown function '${name}'`);
  return JSON.stringify(fn(app, args) ?? null);
}
