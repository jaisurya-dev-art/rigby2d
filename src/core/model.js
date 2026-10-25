// SPDX-License-Identifier: MIT OR Apache-2.0
// The skeleton data model. Files are read and written as skeleton JSON (see interop.js);
// toObject/fromObject are an internal snapshot used for undo history and cloning, not a file format.
//
// The model is a superset of the common skeleton JSON format, so those files load natively
// (see interop.js). Bones, slots and constraints reference each other by array index.

import { pruneConstraints } from './constraintdata.js';
import { Animation, BONE_CHANNELS, SLOT_CHANNELS, emptyBoneTimeline, emptySlotTimeline, makeKey } from './animation.js';
import { LINEAR, cloneCurve } from './curve.js';
import { identityTransform } from './math.js';
import { readControllers, readPoses } from './poses.js';

/** Version tag of the internal snapshot format. */
export const FORMAT = 'rigby-snapshot/1';

/** How a bone inherits its parent's transform. */
export const INHERIT_MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
export const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'];
/** How images are sampled when drawn scaled: 'linear' (smooth) or 'nearest' (sharp pixel art). */
export const TEXTURE_FILTERS = ['linear', 'nearest'];
export const ATTACHMENT_TYPES = ['region', 'mesh', 'linkedmesh', 'boundingbox', 'path', 'point', 'clipping'];

/**
 * Output settings used when rendering animations: frame rate, frame size in pixels, background
 * (null = transparent, else [r, g, b, a] in 0..1) and the framed area: null fits the animation
 * automatically, else { x, y, scale } is the world point at the frame's center and the world units
 * per output pixel.
 */
export function defaultSettings() {
  return { fps: 30, width: 1920, height: 1080, background: null, frame: null };
}

export class LoadError extends Error {
  constructor(kind, message) {
    super(kind === 'json' ? `invalid JSON: ${message}` : `invalid skeleton: ${message}`);
    this.name = 'LoadError';
    this.kind = kind;
  }
}

export function makeBone(name, parent, setup, length) {
  return { name, parent, length, setup, inherit: 'normal', skinRequired: false, color: null };
}

/** A draw-order entry attached to a bone, holding the default skin's attachments. */
export function makeSlot(name, bone, attachment) {
  return {
    name,
    bone,
    attachments: attachment ? [attachment] : [],
    attachment: attachment ? attachment.name : null,
    color: [1, 1, 1, 1],
    dark: null,
    blend: 'normal',
  };
}

/** A textured quad positioned relative to its slot's bone. */
export function makeAttachment(name, image, offset, width, height) {
  return { name, type: 'region', image, offset, width, height, color: [1, 1, 1, 1] };
}

/** Finds an attachment of the default skin by name. */
export function findAttachment(slot, name) {
  return slot.attachments.find((a) => a.name === name);
}

/** Number of vertices of a mesh-like attachment. */
export function vertexCount(att) {
  if (att.weights) return att.weights.length;
  if (att.type === 'mesh') return att.uvs.length / 2;
  return att.vertexCount ?? (att.vertices?.length ?? 0) / 2;
}

/** A complete rig: bones, slots with their attachments, skins, constraints, events and animations. */
export class Skeleton {
  constructor() {
    this.format = FORMAT;
    this.name = 'untitled';
    /** Bones ordered so that every parent comes before its children. Bone 0 is the root. */
    this.bones = [makeBone('root', null, identityTransform(), 0)];
    /** Slots in draw order (first is drawn at the back). Their `attachments` are the default skin. */
    this.slots = [];
    /** Additional skins: { name, slots: [{ slot, attachments }], bones, ik, color, extra }. */
    this.skins = [];
    /** Active skin name (null = default skin only). */
    this.skin = null;
    /** IK constraints: { name, order, skinRequired, bones, target, mix, softness, bendPositive, compress, stretch, uniform }. */
    this.ik = [];
    /** Event definitions: { name, int, float, string, audio, volume, balance }. */
    this.events = [];
    /** @type {Animation[]} */
    this.animations = [];
    /** Source images used by attachments (editor projects): { name, path, width, height }. */
    this.images = [];
    /** Skeleton header (hash, version, bounds, fps, folders) when imported from skeleton JSON. */
    this.header = null;
    /** Data Rigby2D keeps for round trips: constraints in their file form and unknown fields. */
    this.extra = {};
    /** Output settings (see `defaultSettings`). */
    this.settings = defaultSettings();
    /** Whether the file this came from stored settings (then saving keeps them, even at defaults). */
    this.settingsInFile = false;
    /** Texture filtering for the viewport, renders and the exported atlas (see TEXTURE_FILTERS). */
    this.textureFilter = 'linear';
    /** Pose library: { name, bones: { bone name: local transform }, slots: { slot name: attachment } }. */
    this.poses = [];
    /** Facial controllers: { name, from (pose name or null = setup pose), to (pose name), value }. */
    this.controllers = [];
    /** Editor workspace the project is set up for ('game' or 'film'); null = the user's default. */
    this.workspace = null;
    /** Audio tracks: { sound (file in the work file), animation (name), offset (s), volume }. */
    this.audio = [];
  }

  static fromJson(json) {
    let obj;
    try {
      obj = JSON.parse(json);
    } catch (e) {
      throw new LoadError('json', e.message);
    }
    const sk = Skeleton.fromObject(obj);
    const err = sk.validate();
    if (err) throw new LoadError('invalid', err);
    return sk;
  }

  /** Builds a skeleton from parsed JSON, filling defaults. Throws LoadError on bad types. */
  static fromObject(o) {
    try {
      return readSkeleton(o);
    } catch (e) {
      if (e instanceof LoadError) throw e;
      throw new LoadError('json', e.message);
    }
  }

  toObject() {
    return writeSkeleton(this);
  }

  /** Compact JSON of the whole document (used for undo history and change tracking). */
  toSnapshot() {
    return JSON.stringify(this.toObject());
  }

  toJson() {
    return JSON.stringify(this.toObject(), null, 2);
  }

  clone() {
    return Skeleton.fromObject(this.toObject());
  }

  /** Checks structural invariants (parent ordering and index ranges). Returns an error or null. */
  validate() {
    const nb = this.bones.length;
    const ns = this.slots.length;
    if (nb === 0) return 'skeleton has no bones';
    for (let i = 0; i < nb; i++) {
      const p = this.bones[i].parent;
      if (p !== null && p >= i) return `bone '${this.bones[i].name}' must come after its parent`;
    }
    const checkWeights = (att, where) => {
      for (const v of att.weights ?? []) for (const w of v) if (w.bone >= nb) return `${where} references missing bone ${w.bone}`;
      return null;
    };
    for (const s of this.slots) {
      if (s.bone >= nb) return `slot '${s.name}' references missing bone ${s.bone}`;
      for (const a of s.attachments) {
        const e = checkWeights(a, `attachment '${a.name}'`);
        if (e) return e;
      }
    }
    for (const skin of this.skins) {
      for (const e of skin.slots) {
        if (e.slot >= ns) return `skin '${skin.name}' references missing slot ${e.slot}`;
        for (const a of e.attachments) {
          const err = checkWeights(a, `attachment '${a.name}'`);
          if (err) return err;
        }
      }
    }
    for (const c of this.ik) {
      if (c.target >= nb || c.bones.some((b) => b >= nb)) return `IK constraint '${c.name}' references a missing bone`;
    }
    for (const a of this.animations) {
      for (const t of a.bones) if (t.bone >= nb) return `animation '${a.name}' references missing bone ${t.bone}`;
      for (const t of a.slots) if (t.slot >= ns) return `animation '${a.name}' references missing slot ${t.slot}`;
      for (const t of a.deform) if (t.slot >= ns) return `animation '${a.name}' references missing slot ${t.slot}`;
      for (const t of a.ik) if (t.constraint >= this.ik.length) return `animation '${a.name}' references missing IK constraint`;
    }
    return null;
  }

  boneIndex(name) {
    const i = this.bones.findIndex((b) => b.name === name);
    return i < 0 ? null : i;
  }

  slotIndex(name) {
    const i = this.slots.findIndex((s) => s.name === name);
    return i < 0 ? null : i;
  }

  animation(name) {
    return this.animations.find((a) => a.name === name);
  }

  findSkin(name) {
    return this.skins.find((s) => s.name === name);
  }

  /** Attachments a skin defines for a slot (the default skin when `skinName` is null). */
  skinAttachments(slot, skinName) {
    if (skinName === null || skinName === undefined || skinName === 'default') return this.slots[slot]?.attachments ?? [];
    return this.findSkin(skinName)?.slots.find((e) => e.slot === slot)?.attachments ?? [];
  }

  /** Resolves an attachment by slot and name: active skin first, then the default skin. */
  attachment(slot, name, skinName = this.skin) {
    if (name === null || name === undefined) return undefined;
    if (skinName) {
      const found = this.skinAttachments(slot, skinName).find((a) => a.name === name);
      if (found) return found;
    }
    return this.slots[slot]?.attachments.find((a) => a.name === name);
  }

  /** The mesh that holds geometry for `att` (itself, or the parent of a linked mesh). */
  meshSource(slot, att) {
    if (att.type !== 'linkedmesh') return att;
    const parent = this.skinAttachments(slot, att.skin).find((a) => a.name === att.parent) ?? this.attachment(slot, att.parent);
    return parent && parent.type === 'mesh' ? parent : null;
  }

  children(bone) {
    const out = [];
    this.bones.forEach((b, i) => {
      if (b.parent === bone) out.push(i);
    });
    return out;
  }

  /** Returns true if `bone` is `ancestor` or one of its descendants. */
  isDescendant(bone, ancestor) {
    let cur = bone;
    while (cur !== null && cur !== undefined) {
      if (cur === ancestor) return true;
      cur = this.bones[cur].parent;
    }
    return false;
  }

  /** Returns a name based on `base` that no bone uses yet. */
  uniqueBoneName(base) {
    return uniqueName(base, (n) => this.boneIndex(n) !== null);
  }

  uniqueSlotName(base) {
    return uniqueName(base, (n) => this.slotIndex(n) !== null);
  }

  /**
   * Adds a bone, inserting it right after its parent's subtree so ordering stays valid.
   * Returns the new bone's index.
   */
  addBone(bone) {
    bone.inherit ??= 'normal';
    bone.skinRequired ??= false;
    bone.color ??= null;
    let index;
    if (bone.parent === null) {
      index = this.bones.length;
    } else {
      const p = bone.parent;
      index = p + 1;
      while (index < this.bones.length && this.isDescendant(index, p)) index++;
    }
    this.bones.splice(index, 0, bone);
    const remap = (i) => (i >= index ? i + 1 : i);
    this.bones.forEach((b, i) => {
      if (i !== index && b.parent !== null) b.parent = remap(b.parent);
    });
    this.remapBoneRefs(remap);
    return index;
  }

  /** Removes a bone and its descendants, together with their slots, constraints and timelines. */
  removeBone(bone) {
    if (bone === 0) return;
    const removed = this.bones.map((_, i) => this.isDescendant(i, bone));
    const newIndex = [];
    let next = 0;
    for (const r of removed) newIndex.push(r ? null : next++);
    this.bones = this.bones.filter((_, i) => !removed[i]);
    for (const b of this.bones) b.parent = b.parent === null ? null : newIndex[b.parent];
    for (let s = this.slots.length - 1; s >= 0; s--) {
      if (removed[this.slots[s].bone]) this.removeSlot(s);
    }
    this.remapBoneRefs((i) => newIndex[i]);
    pruneConstraints(this);
  }

  /** Moves a bone (and its subtree) under a new parent, preserving bone ordering. */
  reparentBone(bone, newParent) {
    if (bone === 0 || this.isDescendant(newParent, bone)) return;
    const all = this.bones.map((_, i) => i);
    const subtree = all.filter((i) => this.isDescendant(i, bone));
    const order = all.filter((i) => !subtree.includes(i));
    let insertAt = order.indexOf(newParent) + 1;
    while (insertAt < order.length && this.isDescendant(order[insertAt], newParent)) insertAt++;
    const newOrder = [...order.slice(0, insertAt), ...subtree, ...order.slice(insertAt)];
    const newIndex = [];
    newOrder.forEach((old, n) => (newIndex[old] = n));
    this.bones[bone].parent = newParent;
    this.bones = newOrder.map((o) => this.bones[o]);
    for (const b of this.bones) if (b.parent !== null) b.parent = newIndex[b.parent];
    this.remapBoneRefs((i) => newIndex[i]);
  }

  removeSlot(slot) {
    this.slots.splice(slot, 1);
    this.remapSlotRefs((i) => (i === slot ? null : i > slot ? i - 1 : i));
    pruneConstraints(this);
  }

  /** Moves a slot in draw order from `from` to `to`. */
  moveSlot(from, to) {
    if (from === to || from >= this.slots.length || to >= this.slots.length) return;
    const [s] = this.slots.splice(from, 1);
    this.slots.splice(to, 0, s);
    this.remapSlotRefs((i) => {
      if (i === from) return to;
      if (from < to && i > from && i <= to) return i - 1;
      if (to < from && i >= to && i < from) return i + 1;
      return i;
    });
  }

  /** `map` returns the new index of a slot, or null if it was removed. */
  remapSlotRefs(map) {
    const keep = (i) => map(i) !== null && map(i) !== undefined;
    for (const skin of this.skins) {
      skin.slots = skin.slots.filter((e) => keep(e.slot));
      for (const e of skin.slots) e.slot = map(e.slot);
    }
    for (const a of this.animations) {
      a.slots = a.slots.filter((t) => keep(t.slot));
      for (const t of a.slots) t.slot = map(t.slot);
      a.deform = a.deform.filter((t) => keep(t.slot));
      for (const t of a.deform) t.slot = map(t.slot);
      for (const k of a.drawOrder) {
        if (!k.value) continue;
        k.value = k.value.filter((o) => keep(o.slot));
        for (const o of k.value) o.slot = map(o.slot);
      }
    }
    const clipEnd = (att) => {
      if (att.type === 'clipping' && att.end !== null && att.end !== undefined) att.end = keep(att.end) ? map(att.end) : null;
    };
    for (const s of this.slots) s.attachments.forEach(clipEnd);
    for (const skin of this.skins) for (const e of skin.slots) e.attachments.forEach(clipEnd);
  }

  /** `map` returns the new index of a bone, or null if it was removed. */
  remapBoneRefs(map) {
    const keep = (i) => map(i) !== null && map(i) !== undefined;
    const remapWeights = (att) => {
      for (const v of att.weights ?? []) for (const w of v) w.bone = map(w.bone) ?? 0;
    };
    for (const s of this.slots) {
      s.bone = map(s.bone) ?? 0;
      s.attachments.forEach(remapWeights);
    }
    for (const skin of this.skins) {
      skin.bones = skin.bones.filter(keep).map(map);
      for (const e of skin.slots) e.attachments.forEach(remapWeights);
    }
    const removedIk = [];
    this.ik = this.ik.filter((c, i) => {
      const ok = keep(c.target) && c.bones.every(keep);
      if (!ok) removedIk.push(i);
      return ok;
    });
    for (const c of this.ik) {
      c.target = map(c.target);
      c.bones = c.bones.map(map);
    }
    for (const a of this.animations) {
      a.bones = a.bones.filter((t) => keep(t.bone));
      for (const t of a.bones) t.bone = map(t.bone);
      if (removedIk.length) {
        a.ik = a.ik.filter((t) => !removedIk.includes(t.constraint));
        for (const t of a.ik) t.constraint -= removedIk.filter((r) => r < t.constraint).length;
      }
    }
  }
}

export function uniqueName(base, taken) {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base}${n}`;
    if (!taken(name)) return name;
  }
}

// ---- JSON reading / writing ------------------------------------------------------------------

function num(v, def, what) {
  if (v === undefined || v === null) {
    if (def === undefined) throw new LoadError('json', `missing field \`${what}\``);
    return def;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new LoadError('json', `\`${what}\` must be a number`);
  return v;
}

function index(v, what, optional = false) {
  if ((v === undefined || v === null) && optional) return null;
  if (!Number.isInteger(v) || v < 0) throw new LoadError('json', `\`${what}\` must be a non-negative integer`);
  return v;
}

function str(v, def, what) {
  if (v === undefined || v === null) {
    if (def === undefined) throw new LoadError('json', `missing field \`${what}\``);
    return def;
  }
  if (typeof v !== 'string') throw new LoadError('json', `\`${what}\` must be a string`);
  return v;
}

function arr(v, what) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new LoadError('json', `\`${what}\` must be an array`);
  return v;
}

function vec(v, n, what) {
  if (!Array.isArray(v) || (n !== null && v.length !== n)) throw new LoadError('json', `\`${what}\` must have ${n} numbers`);
  return v.map((x) => num(x, undefined, what));
}

const optVec = (v, n, what) => (v === undefined || v === null ? null : vec(v, n, what));
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const raw = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/** Unknown data kept for round trips (e.g. nonessential fields from imported files) lives in `extra`. */
const extraOf = (o) => (o.extra && typeof o.extra === 'object' && Object.keys(o.extra).length ? { extra: raw(o.extra) } : {});
const writeExtra = (out, o) => {
  if (o.extra && Object.keys(o.extra).length) out.extra = raw(o.extra);
};

function readTransform(o) {
  return {
    x: num(o.x, 0, 'x'),
    y: num(o.y, 0, 'y'),
    rotation: num(o.rotation, 0, 'rotation'),
    scale_x: num(o.scale_x, 1, 'scale_x'),
    scale_y: num(o.scale_y, 1, 'scale_y'),
    shear_x: num(o.shear_x, 0, 'shear_x'),
    shear_y: num(o.shear_y, 0, 'shear_y'),
  };
}

function writeTransform(t) {
  const o = { x: t.x, y: t.y, rotation: t.rotation, scale_x: t.scale_x, scale_y: t.scale_y };
  if (t.shear_x) o.shear_x = t.shear_x;
  if (t.shear_y) o.shear_y = t.shear_y;
  return o;
}

function readKeys(list, what, readValue) {
  return arr(list, what).map((k) => makeKey(num(k.time, undefined, 'time'), readValue(k.value), cloneCurve(k.curve ?? LINEAR)));
}

function writeKeys(keys, writeValue) {
  return keys.map((k) => {
    const out = { time: k.time, value: writeValue(k.value) };
    if (k.curve !== LINEAR) out.curve = cloneCurve(k.curve);
    return out;
  });
}

const optName = (v) => (v === null || v === undefined ? null : str(v, undefined, 'value'));
const copy = (v) => (Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? raw(v) : v);

const BONE_VALUE = {
  rotate: (v) => num(v, undefined, 'value'),
  translate: (v) => vec(v, 2, 'value'),
  scale: (v) => vec(v, 2, 'value'),
  shear: (v) => vec(v, 2, 'value'),
  translateX: (v) => num(v, undefined, 'value'),
  translateY: (v) => num(v, undefined, 'value'),
  scaleX: (v) => num(v, undefined, 'value'),
  scaleY: (v) => num(v, undefined, 'value'),
  shearX: (v) => num(v, undefined, 'value'),
  shearY: (v) => num(v, undefined, 'value'),
  inherit: (v) => oneOf(v, INHERIT_MODES, 'normal'),
};

const SLOT_VALUE = {
  attachment: optName,
  color: (v) => vec(v, 4, 'value'),
  rgb: (v) => vec(v, 3, 'value'),
  alpha: (v) => num(v, undefined, 'value'),
  rgba2: (v) => vec(v, 7, 'value'),
  rgb2: (v) => vec(v, 6, 'value'),
};

function readAttachment(a) {
  const type = oneOf(a.type, ATTACHMENT_TYPES, 'region');
  const out = {
    name: str(a.name, undefined, 'name'),
    type,
    image: str(a.image, a.name, 'image'),
    color: a.color === undefined ? [1, 1, 1, 1] : vec(a.color, 4, 'color'),
  };
  if (type === 'region' || type === 'point') out.offset = readTransform(a);
  if (type === 'region' || a.width !== undefined) out.width = num(a.width, undefined, 'width');
  if (type === 'region' || a.height !== undefined) out.height = num(a.height, undefined, 'height');
  if (type === 'mesh') {
    out.uvs = vec(a.uvs, null, 'uvs');
    out.triangles = arr(a.triangles, 'triangles').map((i) => index(i, 'triangles'));
    out.hull = num(a.hull, 0, 'hull');
    out.edges = a.edges ? arr(a.edges, 'edges').map((i) => index(i, 'edges')) : null;
  }
  if (type === 'linkedmesh') {
    out.parent = str(a.parent, undefined, 'parent');
    out.skin = a.skin === undefined || a.skin === null ? null : str(a.skin, undefined, 'skin');
    out.deform = bool(a.deform, true);
  }
  if (['mesh', 'boundingbox', 'path', 'clipping'].includes(type)) {
    out.vertices = a.vertices ? vec(a.vertices, null, 'vertices') : null;
    out.weights = a.weights
      ? arr(a.weights, 'weights').map((v) =>
          arr(v, 'weights').map((w) => ({ bone: index(w.bone, 'bone'), x: num(w.x, 0, 'x'), y: num(w.y, 0, 'y'), weight: num(w.weight, 0, 'weight') })),
        )
      : null;
    if (type !== 'mesh') out.vertexCount = index(a.vertexCount ?? 0, 'vertexCount');
  }
  if (type === 'path') {
    out.closed = bool(a.closed, false);
    out.constantSpeed = bool(a.constantSpeed, true);
    out.lengths = a.lengths ? vec(a.lengths, null, 'lengths') : [];
  }
  if (type === 'clipping') out.end = index(a.end, 'end', true);
  if (a.sequence !== undefined) out.sequence = raw(a.sequence);
  if (a.colorSet) out.colorSet = true;
  Object.assign(out, extraOf(a));
  return out;
}

function writeAttachment(a) {
  const o = { name: a.name };
  if (a.type !== 'region') o.type = a.type;
  if (a.image !== a.name) o.image = a.image;
  if (a.offset) Object.assign(o, writeTransform(a.offset));
  if (a.width !== undefined) o.width = a.width;
  if (a.height !== undefined) o.height = a.height;
  if (a.color && a.color.some((c) => c !== 1)) o.color = a.color.slice();
  for (const k of ['uvs', 'triangles', 'hull', 'edges', 'vertices', 'vertexCount', 'parent', 'skin', 'deform', 'closed', 'constantSpeed', 'lengths', 'end']) {
    if (a[k] !== undefined && a[k] !== null) o[k] = copy(a[k]);
  }
  if (a.weights) o.weights = a.weights.map((v) => v.map((w) => ({ ...w })));
  if (a.sequence !== undefined) o.sequence = raw(a.sequence);
  if (a.colorSet) o.colorSet = true;
  writeExtra(o, a);
  return o;
}

function readSkeleton(o) {
  if (o === null || typeof o !== 'object') throw new LoadError('json', 'expected an object');
  const sk = new Skeleton();
  sk.format = str(o.format, FORMAT, 'format');
  sk.name = str(o.name, '', 'name');
  if (!Array.isArray(o.bones)) throw new LoadError('json', 'missing field `bones`');
  sk.bones = o.bones.map((b) => ({
    ...makeBone(str(b.name, undefined, 'name'), index(b.parent, 'parent', true), readTransform(b), num(b.length, 0, 'length')),
    inherit: oneOf(b.inherit, INHERIT_MODES, 'normal'),
    skinRequired: bool(b.skinRequired, false),
    color: b.color === undefined || b.color === null ? null : str(b.color, undefined, 'color'),
    ...extraOf(b),
  }));
  sk.slots = arr(o.slots, 'slots').map((s) => ({
    name: str(s.name, undefined, 'name'),
    bone: index(s.bone, 'bone'),
    attachments: arr(s.attachments, 'attachments').map(readAttachment),
    attachment: s.attachment === undefined || s.attachment === null ? null : str(s.attachment, undefined, 'attachment'),
    color: s.color === undefined ? [1, 1, 1, 1] : vec(s.color, 4, 'color'),
    dark: optVec(s.dark, 3, 'dark'),
    blend: oneOf(s.blend, BLEND_MODES, 'normal'),
    ...extraOf(s),
  }));
  sk.skins = arr(o.skins, 'skins').map((skin) => ({
    name: str(skin.name, undefined, 'name'),
    slots: arr(skin.slots, 'slots').map((e) => ({ slot: index(e.slot, 'slot'), attachments: arr(e.attachments, 'attachments').map(readAttachment) })),
    bones: arr(skin.bones, 'bones').map((b) => index(b, 'bones')),
    ik: arr(skin.ik, 'ik').map((i) => index(i, 'ik')),
    color: skin.color ?? null,
    extra: raw(skin.extra) ?? {},
  }));
  sk.skin = o.skin === undefined || o.skin === null ? null : str(o.skin, undefined, 'skin');
  sk.ik = arr(o.ik, 'ik').map((c) => ({
    name: str(c.name, undefined, 'name'),
    order: num(c.order, 0, 'order'),
    skinRequired: bool(c.skinRequired, false),
    bones: arr(c.bones, 'bones').map((b) => index(b, 'bones')),
    target: index(c.target, 'target'),
    mix: num(c.mix, 1, 'mix'),
    softness: num(c.softness, 0, 'softness'),
    bendPositive: bool(c.bendPositive, true),
    compress: bool(c.compress, false),
    stretch: bool(c.stretch, false),
    uniform: bool(c.uniform, false),
    ...extraOf(c),
  }));
  sk.events = arr(o.events, 'events').map((e) => ({
    name: str(e.name, undefined, 'name'),
    int: num(e.int, 0, 'int'),
    float: num(e.float, 0, 'float'),
    string: e.string === undefined || e.string === null ? null : str(e.string, undefined, 'string'),
    audio: e.audio === undefined || e.audio === null ? null : str(e.audio, undefined, 'audio'),
    volume: num(e.volume, 1, 'volume'),
    balance: num(e.balance, 0, 'balance'),
    ...extraOf(e),
  }));
  sk.animations = arr(o.animations, 'animations').map((a) => {
    const anim = new Animation(str(a.name, undefined, 'name'), num(a.duration, undefined, 'duration'));
    anim.bones = arr(a.bones, 'bones').map((t) => {
      const tl = emptyBoneTimeline(index(t.bone, 'bone'));
      for (const ch of BONE_CHANNELS) tl[ch] = readKeys(t[ch], ch, BONE_VALUE[ch]);
      return tl;
    });
    anim.slots = arr(a.slots, 'slots').map((t) => {
      const tl = emptySlotTimeline(index(t.slot, 'slot'));
      for (const ch of SLOT_CHANNELS) tl[ch] = readKeys(t[ch], ch, SLOT_VALUE[ch]);
      return tl;
    });
    anim.deform = arr(a.deform, 'deform').map((t) => ({
      skin: t.skin ?? null,
      slot: index(t.slot, 'slot'),
      attachment: str(t.attachment, undefined, 'attachment'),
      keys: readKeys(t.keys, 'keys', (v) => ({ offset: index(v?.offset ?? 0, 'offset'), vertices: vec(v?.vertices ?? [], null, 'vertices') })),
    }));
    anim.drawOrder = readKeys(a.drawOrder, 'drawOrder', (v) =>
      v === null || v === undefined ? null : arr(v, 'value').map((e) => ({ slot: index(e.slot, 'slot'), offset: num(e.offset, 0, 'offset') })),
    );
    anim.events = arr(a.events, 'events').map((e) => ({ ...raw(e), time: num(e.time, 0, 'time'), name: str(e.name, undefined, 'name') }));
    anim.ik = arr(a.ik, 'ik').map((t) => ({ constraint: index(t.constraint, 'constraint'), keys: readKeys(t.keys, 'keys', (v) => ({ ...raw(v) })) }));
    anim.extra = raw(a.extra) ?? {};
    return anim;
  });
  sk.images = arr(o.images, 'images').map((i) => ({
    name: str(i.name, undefined, 'name'),
    path: i.path === undefined || i.path === null ? null : str(i.path, undefined, 'path'),
    width: index(i.width, 'width'),
    height: index(i.height, 'height'),
  }));
  sk.header = raw(o.header) ?? null;
  sk.extra = raw(o.extra) ?? {};
  sk.settings = readSettings(o.settings);
  sk.settingsInFile = o.settings !== undefined;
  sk.textureFilter = oneOf(o.textureFilter, TEXTURE_FILTERS, 'linear');
  sk.poses = readPoses(o.poses);
  sk.controllers = readControllers(o.controllers);
  sk.workspace = oneOf(o.workspace, ['game', 'film'], null);
  sk.audio = arr(o.audio, 'audio')
    .filter((t) => t && typeof t.sound === 'string' && typeof t.animation === 'string')
    .map((t) => ({ sound: t.sound, animation: t.animation, offset: Number.isFinite(t.offset) ? t.offset : 0, volume: Number.isFinite(t.volume) ? Math.max(0, t.volume) : 1 }));
  return sk;
}

/** Output settings with defaults for missing or invalid values. */
export function readSettings(o) {
  const d = defaultSettings();
  if (!o || typeof o !== 'object') return d;
  const positive = (v, def, max) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : def);
  const color = (c) => (Array.isArray(c) && c.length === 4 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 1) ? c.slice() : null);
  const f = o.frame;
  const frame =
    f && typeof f === 'object' && [f.x, f.y].every((v) => typeof v === 'number' && Number.isFinite(v)) && positive(f.scale, 0, 1e6) > 0 ? { x: f.x, y: f.y, scale: f.scale, ...(f.camera ? { camera: true } : {}) } : null;
  return {
    fps: positive(o.fps, d.fps, 240),
    width: Math.round(positive(o.width, d.width, 16384)),
    height: Math.round(positive(o.height, d.height, 16384)),
    background: color(o.background),
    frame,
  };
}

function writeSkeleton(sk) {
  const out = {
    format: sk.format,
    name: sk.name,
    bones: sk.bones.map((b) => {
      const o = { name: b.name };
      if (b.parent !== null) o.parent = b.parent;
      o.length = b.length;
      Object.assign(o, writeTransform(b.setup));
      if (b.inherit && b.inherit !== 'normal') o.inherit = b.inherit;
      if (b.skinRequired) o.skinRequired = true;
      if (b.color) o.color = b.color;
      writeExtra(o, b);
      return o;
    }),
    slots: sk.slots.map((s) => {
      const o = { name: s.name, bone: s.bone, attachments: s.attachments.map(writeAttachment) };
      if (s.attachment !== null) o.attachment = s.attachment;
      o.color = s.color.slice();
      if (s.dark) o.dark = s.dark.slice();
      if (s.blend && s.blend !== 'normal') o.blend = s.blend;
      writeExtra(o, s);
      return o;
    }),
  };
  if (sk.skins.length) {
    out.skins = sk.skins.map((skin) => {
      const o = { name: skin.name, slots: skin.slots.map((e) => ({ slot: e.slot, attachments: e.attachments.map(writeAttachment) })) };
      if (skin.bones.length) o.bones = skin.bones.slice();
      if (skin.ik.length) o.ik = skin.ik.slice();
      if (skin.color) o.color = skin.color;
      if (Object.keys(skin.extra ?? {}).length) o.extra = raw(skin.extra);
      return o;
    });
  }
  if (sk.skin) out.skin = sk.skin;
  if (sk.ik.length) out.ik = sk.ik.map((c) => ({ ...c, bones: c.bones.slice() }));
  if (sk.events.length) out.events = sk.events.map((e) => ({ ...e }));
  out.animations = sk.animations.map((a) => {
    const o = { name: a.name, duration: a.duration };
    if (a.bones.length) {
      o.bones = a.bones.map((t) => {
        const tl = { bone: t.bone };
        for (const ch of BONE_CHANNELS) if (t[ch].length) tl[ch] = writeKeys(t[ch], copy);
        return tl;
      });
    }
    if (a.slots.length) {
      o.slots = a.slots.map((t) => {
        const tl = { slot: t.slot };
        for (const ch of SLOT_CHANNELS) if (t[ch].length) tl[ch] = writeKeys(t[ch], copy);
        return tl;
      });
    }
    if (a.deform.length) {
      o.deform = a.deform.map((t) => ({
        skin: t.skin,
        slot: t.slot,
        attachment: t.attachment,
        keys: writeKeys(t.keys, (v) => ({ offset: v.offset, vertices: v.vertices.slice() })),
      }));
    }
    if (a.drawOrder.length) o.drawOrder = writeKeys(a.drawOrder, (v) => (v ? v.map((e) => ({ ...e })) : null));
    if (a.events.length) o.events = a.events.map((e) => ({ ...e }));
    if (a.ik.length) o.ik = a.ik.map((t) => ({ constraint: t.constraint, keys: writeKeys(t.keys, (v) => ({ ...v })) }));
    if (Object.keys(a.extra).length) o.extra = raw(a.extra);
    return o;
  });
  if (sk.images.length) {
    out.images = sk.images.map((i) => {
      const o = { name: i.name };
      if (i.path !== null) o.path = i.path;
      o.width = i.width;
      o.height = i.height;
      return o;
    });
  }
  if (sk.header) out.header = raw(sk.header);
  if (Object.keys(sk.extra).length) out.extra = raw(sk.extra);
  // Only when set: saving a file that never had settings must not add them.
  if (sk.settingsInFile || JSON.stringify(sk.settings) !== JSON.stringify(defaultSettings())) out.settings = raw(sk.settings);
  // Only when not the default, so files saved before the option existed are unchanged.
  if (sk.textureFilter !== 'linear') out.textureFilter = sk.textureFilter;
  if (sk.poses.length) out.poses = raw(sk.poses);
  if (sk.controllers.length) out.controllers = raw(sk.controllers);
  if (sk.workspace) out.workspace = sk.workspace;
  if (sk.audio.length) out.audio = raw(sk.audio);
  return out;
}
