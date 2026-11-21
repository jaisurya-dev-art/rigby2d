// SPDX-License-Identifier: MIT OR Apache-2.0
// Interoperability with the widely used third-party skeleton JSON + texture atlas format, written
// clean-room from its public documentation.
//
// Reading: 3.8 is implemented as documented. 4.x files are read tolerantly: the reader accepts
// both 3.8 field names and the 4.x variants (split X/Y timelines, rgba/rgb/alpha timelines,
// per-value bezier curves in absolute units, `inherit`, `drawOrder`, deform under `attachments`).
// The exact 4.x spellings are not publicly specified and must be verified with real exports.
//
// Writing: `writeSkeletonJson(sk, { version })` emits "3.8" (documented) or "4.2" (best effort).
// Transform, path and physics constraints and sequences are carried through unchanged (the
// constraints are evaluated by the runtime from that data).

import { Animation, emptyBoneTimeline, emptySlotTimeline, makeKey } from './animation.js';
import { Clipper } from './clipping.js';
import { LINEAR, STEPPED, bezierFor } from './curve.js';
import { Pose } from './pose.js';
import { INHERIT_MODES, Skeleton, makeBone } from './model.js';

// ---- helpers ----------------------------------------------------------------------------------

/** True when `obj` looks like a skeleton JSON file. */
export function isSkeletonJson(obj) {
  return !!obj && typeof obj === 'object' && !!obj.skeleton && typeof obj.skeleton === 'object' && Array.isArray(obj.bones);
}

export function hexToColor(hex, def) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return def.slice();
  const c = [];
  for (let i = 0; i < hex.length; i += 2) c.push(parseInt(hex.slice(i, i + 2), 16) / 255);
  if (c.length === 3 && def.length === 4) c.push(1);
  return c;
}

export function colorToHex(c, n = c.length) {
  return c
    .slice(0, n)
    .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
    .join('');
}

/** Name of the skeleton header field holding the format version (fixed by the file format). */
export const VERSION_FIELD = 'spine';

const WHITE = [1, 1, 1, 1];
const DEFAULT_ATTACHMENT_COLORS = { boundingbox: '60F000FF', path: 'FF7F00FF', point: 'F1F100FF', clipping: 'CE3A3AFF' };
const KNOWN_ATTACHMENT_FIELDS = new Set([
  'type', 'name', 'path', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'width', 'height', 'color', 'uvs', 'triangles', 'hull', 'edges',
  'vertices', 'vertexCount', 'parent', 'source', 'skin', 'deform', 'timelines', 'closed', 'constantSpeed', 'lengths', 'end', 'sequence',
]);
const rest = (o, known) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!known.has(k)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const entries = (o) => (o && typeof o === 'object' ? Object.entries(o) : []);

function usesAbsoluteCurves(obj) {
  const major = Number(String(obj.skeleton[VERSION_FIELD] ?? '3.8').split('.')[0]);
  if (major !== 0) return major >= 4;
  // Some exports use a placeholder version (0.0.00). 4.x rotation keys use value
  // where older exports use angle, even when a key's curve could fit either format.
  return entries(obj.animations).some(([, anim]) => entries(anim.bones).some(([, timeline]) =>
    Array.isArray(timeline.rotate) && timeline.rotate.some((key) => typeof key.value === 'number')));
}

/** Splits a packed vertex array into unweighted floats or per-vertex weights. */
function decodeVertices(vertices, count) {
  if (!Array.isArray(vertices)) return { vertices: [], weights: null };
  if (vertices.length <= count * 2) return { vertices: vertices.slice(), weights: null };
  const weights = [];
  for (let i = 0; i < vertices.length && weights.length < count; ) {
    const n = vertices[i++];
    const v = [];
    for (let j = 0; j < n; j++) v.push({ bone: vertices[i++], x: vertices[i++], y: vertices[i++], weight: vertices[i++] });
    weights.push(v);
  }
  return { vertices: null, weights };
}

function encodeVertices(att) {
  if (!att.weights) return (att.vertices ?? []).slice();
  const out = [];
  for (const v of att.weights) {
    out.push(v.length);
    for (const w of v) out.push(w.bone, w.x, w.y, w.weight);
  }
  return out;
}

// ---- reading ----------------------------------------------------------------------------------

/**
 * Converts a parsed skeleton JSON file into a Rigby2D Skeleton. Returns { skeleton, warnings }.
 * `name` becomes the skeleton name (the format does not store one).
 */
export function readSkeletonJson(obj, name = 'skeleton') {
  if (!isSkeletonJson(obj)) throw new Error('not a skeleton JSON file');
  const v4 = usesAbsoluteCurves(obj);
  const warnings = [];
  const sk = new Skeleton();
  sk.name = name;
  const { [VERSION_FIELD]: version_, ...header } = obj.skeleton;
  sk.header = { version: version_ ?? null, ...clone(header) };
  if (typeof header.fps === 'number' && header.fps > 0) sk.settings.fps = header.fps;
  for (const key of Object.keys(obj)) {
    if (!['skeleton', 'bones', 'slots', 'constraints', 'ik', 'transform', 'path', 'physics', 'skins', 'events', 'animations'].includes(key)) {
      sk.extra[key] = clone(obj[key]);
    }
  }

  // Bones.
  const boneIndex = new Map();
  sk.bones = obj.bones.map((b, i) => {
    boneIndex.set(b.name, i);
    const parent = b.parent === undefined ? null : boneIndex.get(b.parent);
    if (parent === undefined) throw new Error(`bone '${b.name}' references unknown parent '${b.parent}'`);
    const bone = makeBone(
      b.name,
      parent,
      {
        x: b.x ?? 0,
        y: b.y ?? 0,
        rotation: b.rotation ?? 0,
        scale_x: b.scaleX ?? 1,
        scale_y: b.scaleY ?? 1,
        shear_x: b.shearX ?? 0,
        shear_y: b.shearY ?? 0,
      },
      b.length ?? 0,
    );
    const inherit = b.inherit ?? b.transform ?? 'normal';
    bone.inherit = INHERIT_MODES.includes(inherit) ? inherit : 'normal';
    bone.skinRequired = !!b.skin;
    bone.color = b.color ?? null;
    const extra = rest(b, new Set(['name', 'parent', 'length', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'inherit', 'transform', 'skin', 'color']));
    if (extra) bone.extra = extra;
    return bone;
  });
  const bone = (n) => {
    const i = boneIndex.get(n);
    if (i === undefined) throw new Error(`unknown bone '${n}'`);
    return i;
  };

  // Slots.
  const slotIndex = new Map();
  sk.slots = (obj.slots ?? []).map((s, i) => {
    slotIndex.set(s.name, i);
    const slot = {
      name: s.name,
      bone: bone(s.bone),
      attachments: [],
      attachment: s.attachment ?? null,
      color: hexToColor(s.color, WHITE),
      dark: s.dark ? hexToColor(s.dark, [0, 0, 0]) : null,
      blend: s.blend ?? 'normal',
    };
    const extra = rest(s, new Set(['name', 'bone', 'attachment', 'color', 'dark', 'blend']));
    if (extra) slot.extra = extra;
    return slot;
  });
  const slot = (n) => {
    const i = slotIndex.get(n);
    if (i === undefined) throw new Error(`unknown slot '${n}'`);
    return i;
  };

  // IK constraints (evaluated); transform, path, physics and other constraints are kept as-is.
  // Format 4.3+ lists every constraint in one `constraints` array, tagged by `type`; the array
  // position is the application order.
  const unified = Array.isArray(obj.constraints) ? obj.constraints : null;
  const ikSource = unified ? unified.map((c, i) => ({ ...c, order: c.order ?? i })).filter((c) => c.type === 'ik') : (obj.ik ?? []);
  if (unified) {
    const others = unified.map((data, index) => ({ index, data: clone(data) })).filter((e) => e.data.type !== 'ik');
    if (others.length) sk.extra.constraints = others;
    const skipped = others.filter((e) => !['transform', 'path', 'physics', 'slider'].includes(e.data.type)).length;
    if (skipped) warnings.push(`${skipped} constraint(s) of unknown types are kept but not evaluated`);
  }
  sk.ik = ikSource.map((c, i) => {
    const ik = {
      name: c.name,
      order: c.order ?? i,
      skinRequired: !!c.skin,
      bones: (c.bones ?? []).map(bone),
      target: bone(c.target),
      mix: c.mix ?? 1,
      softness: c.softness ?? 0,
      bendPositive: c.bendPositive ?? true,
      compress: !!c.compress,
      stretch: !!c.stretch,
      uniform: !!c.uniform,
    };
    const extra = rest(c, new Set(['type', 'name', 'order', 'skin', 'bones', 'target', 'mix', 'softness', 'bendPositive', 'compress', 'stretch', 'uniform']));
    if (extra) ik.extra = extra;
    return ik;
  });
  const ikIndex = new Map(sk.ik.map((c, i) => [c.name, i]));
  for (const key of ['transform', 'path', 'physics']) {
    if (obj[key]?.length) {
      sk.extra[key] = clone(obj[key]);
    }
  }

  // Skins (array since 3.8; a map of skin name -> slots before that).
  const skins = Array.isArray(obj.skins)
    ? obj.skins
    : entries(obj.skins).map(([skinName, attachments]) => ({ name: skinName, attachments }));
  for (const skin of skins) {
    const slotEntries = [];
    for (const [slotName, atts] of entries(skin.attachments)) {
      const s = slot(slotName);
      const list = entries(atts).map(([key, a]) => readAttachment(key, a, slot));
      if (skin.name === 'default') sk.slots[s].attachments.push(...list);
      else slotEntries.push({ slot: s, attachments: list });
    }
    if (skin.name === 'default') continue;
    const extra = {};
    for (const key of ['transform', 'path', 'physics']) if (skin[key]) extra[key] = clone(skin[key]);
    const other = rest(skin, new Set(['name', 'attachments', 'bones', 'ik', 'transform', 'path', 'physics', 'color']));
    if (other) Object.assign(extra, other);
    sk.skins.push({
      name: skin.name,
      slots: slotEntries,
      bones: (skin.bones ?? []).map(bone),
      ik: (skin.ik ?? []).map((n) => ikIndex.get(n)).filter((i) => i !== undefined),
      color: skin.color ?? null,
      extra,
    });
  }

  // Events.
  sk.events = entries(obj.events).map(([eventName, e]) => ({
    name: eventName,
    int: e.int ?? 0,
    float: e.float ?? 0,
    string: e.string ?? null,
    audio: e.audio ?? null,
    volume: e.volume ?? 1,
    balance: e.balance ?? 0,
  }));

  // Animations.
  const ctx = { v4, bone, slot, ikIndex, sk, warnings };
  sk.animations = entries(obj.animations).map(([animName, a]) => readAnimation(animName, a, ctx));

  const err = sk.validate();
  if (err) throw new Error(err);
  return { skeleton: sk, warnings };
}

function readAttachment(key, a, slot) {
  const type = a.type ?? 'region';
  const att = { name: key, type, image: a.path ?? a.name ?? key };
  if (a.name !== undefined && a.name !== key) att.sourceName = a.name;
  att.color = hexToColor(a.color, hexToColor(DEFAULT_ATTACHMENT_COLORS[type], WHITE));
  if (a.color !== undefined && DEFAULT_ATTACHMENT_COLORS[type]) att.colorSet = true;
  if (type === 'region' || type === 'point') {
    att.offset = { x: a.x ?? 0, y: a.y ?? 0, rotation: a.rotation ?? 0, scale_x: a.scaleX ?? 1, scale_y: a.scaleY ?? 1, shear_x: 0, shear_y: 0 };
  }
  if (type === 'region') {
    att.width = a.width ?? 0;
    att.height = a.height ?? 0;
  }
  if (type === 'mesh') {
    att.uvs = (a.uvs ?? []).slice();
    att.triangles = (a.triangles ?? []).slice();
    att.hull = a.hull ?? 0;
    att.edges = a.edges ? a.edges.slice() : null;
    att.width = a.width ?? 0;
    att.height = a.height ?? 0;
    Object.assign(att, decodeVertices(a.vertices, att.uvs.length / 2));
  }
  if (type === 'linkedmesh') {
    att.parent = a.parent ?? a.source;
    att.skin = a.skin ?? null;
    att.deform = a.deform ?? a.timelines ?? true;
    att.width = a.width ?? 0;
    att.height = a.height ?? 0;
  }
  if (type === 'boundingbox' || type === 'path' || type === 'clipping') {
    att.vertexCount = a.vertexCount ?? 0;
    Object.assign(att, decodeVertices(a.vertices, att.vertexCount));
  }
  if (type === 'path') {
    att.closed = !!a.closed;
    att.constantSpeed = a.constantSpeed ?? true;
    att.lengths = (a.lengths ?? []).slice();
  }
  if (type === 'clipping') att.end = a.end === undefined ? null : slot(a.end);
  if (a.sequence !== undefined) att.sequence = clone(a.sequence);
  const extra = rest(a, KNOWN_ATTACHMENT_FIELDS);
  if (extra) att.extra = extra;
  return att;
}

/** Number of interpolated values per key for each timeline kind. */
const VALUE_COUNT = { rotate: 1, translate: 2, scale: 2, shear: 2, translateX: 1, translateY: 1, scaleX: 1, scaleY: 1, shearX: 1, shearY: 1 };

/** Reads a key's curve. 3.8 uses normalized values; 4.x per-value absolute control points. */
function readCurve(key, next, values, nextValues, v4) {
  const c = key.curve;
  if (c === undefined || c === null) return LINEAR;
  if (c === 'stepped') return STEPPED;
  if (typeof c === 'number') return { bezier: [c, key.c2 ?? 0, key.c3 ?? 1, key.c4 ?? 1] };
  if (!Array.isArray(c)) return LINEAR;
  if (!v4 && c.length === 4) return { bezier: c.slice() };
  if (!next) return LINEAR;
  const curve = normalizeCurve(c, key, next, values, nextValues);
  // Keep the file's exact control points so untouched keys are written back unchanged.
  if (curve !== LINEAR) curve.src = { curve: c.slice(), t1: key.time ?? 0, t2: next.time ?? 0, v: values.slice(), nv: nextValues.slice() };
  return curve;
}

function normalizeCurve(c, key, next, values, nextValues) {
  const t1 = key.time ?? 0;
  const t2 = next.time ?? 0;
  const dt = t2 - t1 || 1;
  // A component whose value does not change has no meaningful curve (null here); it takes the
  // shape of the others so shared curves collapse back to one.
  const beziers = [];
  for (let i = 0; i + 3 < c.length && beziers.length < values.length; i += 4) {
    const v1 = values[beziers.length];
    const dv = nextValues[beziers.length] - v1;
    if (Math.abs(dv) <= 1e-9) {
      beziers.push(null);
      continue;
    }
    beziers.push([(c[i] - t1) / dt, (c[i + 1] - v1) / dv, (c[i + 2] - t1) / dt, (c[i + 3] - v1) / dv]);
  }
  if (!beziers.length) return LINEAR;
  const known = beziers.filter(Boolean);
  if (!known.length) return { bezier: [(c[0] - t1) / dt, 0, (c[2] - t1) / dt, 1].map(round5) };
  const shared = known.every((b) => b.every((v, i) => Math.abs(v - known[0][i]) < 1e-4));
  if (beziers.length === 1 || shared) return { bezier: known[0].map(round5) };
  return { beziers: beziers.map((b) => (b ?? known[0]).map(round5)) };
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** Reads a list of keys with numeric values (one or more per key). */
function readNumericKeys(list, valuesOf, v4) {
  const keys = list ?? [];
  return keys.map((k, i) => {
    const values = valuesOf(k);
    const next = keys[i + 1];
    const curve = readCurve(k, next, values, next ? valuesOf(next) : values, v4);
    return makeKey(k.time ?? 0, values.length === 1 ? values[0] : values, curve);
  });
}

function readAnimation(name, a, { v4, bone, slot, ikIndex, sk, warnings }) {
  const anim = new Animation(name, 0);
  const val = (k, field, def) => k[field] ?? def;

  for (const [boneName, timelines] of entries(a.bones)) {
    const tl = emptyBoneTimeline(bone(boneName));
    for (const [kind, keys] of entries(timelines)) {
      switch (kind) {
        case 'rotate':
          tl.rotate = readNumericKeys(keys, (k) => [k.value ?? k.angle ?? 0], v4);
          break;
        case 'translate':
          tl.translate = readNumericKeys(keys, (k) => [val(k, 'x', 0), val(k, 'y', 0)], v4);
          break;
        case 'scale':
          tl.scale = readNumericKeys(keys, (k) => [val(k, 'x', 1), val(k, 'y', 1)], v4);
          break;
        case 'shear':
          tl.shear = readNumericKeys(keys, (k) => [val(k, 'x', 0), val(k, 'y', 0)], v4);
          break;
        case 'translatex':
        case 'translatey':
        case 'scalex':
        case 'scaley':
        case 'shearx':
        case 'sheary': {
          const channel = { translatex: 'translateX', translatey: 'translateY', scalex: 'scaleX', scaley: 'scaleY', shearx: 'shearX', sheary: 'shearY' }[kind];
          const def = kind.startsWith('scale') ? 1 : 0;
          tl[channel] = readNumericKeys(keys, (k) => [k.value ?? def], v4);
          break;
        }
        case 'inherit':
        case 'transform':
          tl.inherit = (keys ?? []).map((k) => makeKey(k.time ?? 0, k.inherit ?? k.value ?? 'normal', STEPPED));
          break;
        default:
          (anim.extra.bones ??= {})[boneName] = { ...(anim.extra.bones?.[boneName] ?? {}), [kind]: clone(keys) };
          warnings.push(`animation '${name}': unsupported bone timeline '${kind}' kept as-is`);
      }
    }
    anim.bones.push(tl);
  }

  for (const [slotName, timelines] of entries(a.slots)) {
    const tl = emptySlotTimeline(slot(slotName));
    for (const [kind, keys] of entries(timelines)) {
      switch (kind) {
        case 'attachment':
          tl.attachment = (keys ?? []).map((k) => makeKey(k.time ?? 0, k.name ?? null, STEPPED));
          break;
        case 'color':
        case 'rgba':
          tl.color = readNumericKeys(keys, (k) => hexToColor(k.color, WHITE), v4);
          break;
        case 'rgb':
          tl.rgb = readNumericKeys(keys, (k) => hexToColor(k.color, [1, 1, 1]), v4);
          break;
        case 'alpha':
          tl.alpha = readNumericKeys(keys, (k) => [k.value ?? 1], v4);
          break;
        case 'twoColor':
        case 'rgba2':
          tl.rgba2 = readNumericKeys(keys, (k) => [...hexToColor(k.light, WHITE), ...hexToColor(k.dark, [0, 0, 0])], v4);
          break;
        case 'rgb2':
          tl.rgb2 = readNumericKeys(keys, (k) => [...hexToColor(k.light, [1, 1, 1]), ...hexToColor(k.dark, [0, 0, 0])], v4);
          break;
        default:
          (anim.extra.slots ??= {})[slotName] = { ...(anim.extra.slots?.[slotName] ?? {}), [kind]: clone(keys) };
          warnings.push(`animation '${name}': unsupported slot timeline '${kind}' kept as-is`);
      }
    }
    anim.slots.push(tl);
  }

  const readDeform = (skinName, slotName, attName, keys) => {
    anim.deform.push({
      skin: skinName === 'default' ? null : skinName,
      slot: slot(slotName),
      attachment: attName,
      keys: (keys ?? []).map((k, i) => {
        const next = keys[i + 1];
        return makeKey(k.time ?? 0, { offset: k.offset ?? 0, vertices: (k.vertices ?? []).slice() }, readCurve(k, next, [0], [1], v4));
      }),
    });
  };
  for (const [skinName, slots] of entries(a.deform)) {
    for (const [slotName, atts] of entries(slots)) for (const [attName, keys] of entries(atts)) readDeform(skinName, slotName, attName, keys);
  }
  for (const [skinName, slots] of entries(a.attachments)) {
    for (const [slotName, atts] of entries(slots)) {
      for (const [attName, timelines] of entries(atts)) {
        if (timelines.deform) readDeform(skinName, slotName, attName, timelines.deform);
        const others = rest(timelines, new Set(['deform']));
        if (others) ((((anim.extra.attachments ??= {})[skinName] ??= {})[slotName] ??= {})[attName] = clone(others));
      }
    }
  }

  const drawOrder = a.drawOrder ?? a.draworder;
  anim.drawOrder = (drawOrder ?? []).map((k) =>
    makeKey(k.time ?? 0, k.offsets ? k.offsets.map((o) => ({ slot: slot(o.slot), offset: o.offset ?? 0 })) : null, STEPPED),
  );
  anim.events = (a.events ?? []).map((e) => ({ ...clone(e), time: e.time ?? 0 }));

  for (const [ikName, keys] of entries(a.ik)) {
    const constraint = ikIndex.get(ikName);
    if (constraint === undefined) continue;
    anim.ik.push({
      constraint,
      keys: (keys ?? []).map((k) => {
        const value = {
          mix: k.mix ?? 1,
          softness: k.softness ?? 0,
          bendPositive: k.bendPositive ?? true,
          compress: !!k.compress,
          stretch: !!k.stretch,
        };
        if (k.curve !== undefined) value.curve = clone(k.curve);
        return makeKey(k.time ?? 0, value, LINEAR);
      }),
    });
  }

  for (const key of ['transform', 'path', 'physics']) if (a[key]) anim.extra[key] = clone(a[key]);
  const unknown = rest(a, new Set(['bones', 'slots', 'deform', 'attachments', 'drawOrder', 'draworder', 'events', 'ik', 'transform', 'path', 'physics']));
  if (unknown) Object.assign(anim.extra, unknown);

  anim.duration = lastTime(a, anim);
  return anim;
}

function lastTime(raw, anim) {
  let max = anim.lastKeyTime();
  const scan = (v) => {
    if (Array.isArray(v)) {
      for (const k of v) if (k && typeof k === 'object' && typeof k.time === 'number') max = Math.max(max, k.time);
      v.forEach(scan);
    } else if (v && typeof v === 'object') Object.values(v).forEach(scan);
  };
  for (const key of ['transform', 'path', 'physics', 'attachments']) scan(raw[key]);
  return max;
}

// ---- writing ----------------------------------------------------------------------------------

/** JSON output rounds to 5 decimals; binary output keeps full float precision. */
let round = (v) => Math.round(v * 1e5) / 1e5;

/** Writes a key's curve in file form (`values`/`nextValues` are the key's numeric values). */
function writeCurve(key, next, values, nextValues, v4, out) {
  const c = key.curve;
  if (c === STEPPED) {
    out.curve = 'stepped';
    return;
  }
  if (c === LINEAR || !next || !bezierFor(c)) return;
  const src = c.src;
  const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  if (v4 && src && Math.abs(src.t1 - key.time) < 1e-6 && Math.abs(src.t2 - next.time) < 1e-6 && same(src.v, values) && same(src.nv, nextValues)) {
    out.curve = src.curve.slice();
    return;
  }
  if (!v4) {
    const [x1, y1, x2, y2] = bezierFor(c, 0);
    out.curve = round(x1);
    if (y1 !== 0) out.c2 = round(y1);
    if (x2 !== 1) out.c3 = round(x2);
    if (y2 !== 1) out.c4 = round(y2);
    return;
  }
  const t1 = key.time;
  const dt = next.time - t1;
  const arr = [];
  values.forEach((v1, i) => {
    const [x1, y1, x2, y2] = bezierFor(c, i);
    const dv = nextValues[i] - v1;
    arr.push(round(t1 + x1 * dt), round(v1 + y1 * dv), round(t1 + x2 * dt), round(v1 + y2 * dv));
  });
  out.curve = arr;
}

function writeNumericKeys(keys, toValues, toFields, v4, toNextValues = toValues) {
  return keys.map((k, i) => {
    const next = keys[i + 1];
    const values = toValues(k.value);
    const out = {};
    if (!v4 || k.time !== 0) out.time = round(k.time);
    Object.assign(out, toFields(k.value));
    writeCurve(k, next, values, next ? toNextValues(next.value) : values, v4, out);
    return out;
  });
}

const asArray = (v) => (Array.isArray(v) ? v : [v]);

const TRANSFORM_KEYS = [
  ['rotate', 'rotation', 'mixRotate'],
  ['x', 'x', 'mixX'],
  ['y', 'y', 'mixY'],
  ['scaleX', 'scaleX', 'mixScaleX'],
  ['scaleY', 'scaleY', 'mixScaleY'],
  ['shearY', 'shearY', 'mixShearY'],
];

/**
 * A constraint in the 4.3 layout converted to the 4.2 (`v42`) or 3.8 layout, or null when that
 * version has no such constraint. `warn` reports anything the older layout cannot express.
 */
function legacyConstraint(data, v42, warn) {
  const { type, ...d } = data;
  if (type === 'slider' || (type === 'physics' && !v42)) {
    warn(`${type} constraints need format 4.${type === 'slider' ? 3 : 2}; left out`);
    return null;
  }
  if (type === 'physics') return d;
  const mix = (key, fallback = 1) => d[key] ?? fallback;
  if (type === 'path') {
    const out = { name: d.name, ...(d.skin ? { skin: true } : {}), bones: d.bones, target: d.slot ?? d.target };
    for (const key of ['positionMode', 'spacingMode', 'rotateMode', 'rotation', 'position', 'spacing']) if (d[key] !== undefined) out[key] = d[key];
    if (v42) Object.assign(out, { mixRotate: mix('mixRotate'), mixX: mix('mixX'), mixY: mix('mixY', mix('mixX')) });
    else {
      out.rotateMix = mix('mixRotate');
      out.translateMix = mix('mixX');
      if (mix('mixY', mix('mixX')) !== out.translateMix) warn('3.8 has one translate mix; mix Y was dropped');
    }
    return out;
  }
  // Transform: each property must map onto itself unchanged.
  const props = d.properties ?? Object.fromEntries(TRANSFORM_KEYS.map(([p]) => [p, { to: { [p]: {} } }]));
  const mapped = new Set();
  for (const [from, entry] of Object.entries(props)) {
    for (const [to, t] of Object.entries(entry.to ?? {})) {
      if (to !== from || (entry.offset ?? 0) !== 0 || (t.offset ?? 0) !== 0 || (t.scale ?? 1) !== 1) warn(`property mapping ${from} -> ${to} was simplified`);
      mapped.add(to);
    }
  }
  if ((d.localSource ?? false) !== (d.localTarget ?? false)) warn('local source and local target differ; using local target');
  if (d.clamp) warn('clamp is not supported before 4.3; left out');
  const out = { name: d.name, ...(d.skin ? { skin: true } : {}), bones: d.bones, target: d.source ?? d.target };
  for (const [, offset] of TRANSFORM_KEYS) if (d[offset]) out[offset] = d[offset];
  const mixOf = (prop, key) => (mapped.has(prop) ? mix(key) : 0);
  if (v42) {
    for (const [prop, , key] of TRANSFORM_KEYS) out[key] = mixOf(prop, key);
  } else {
    out.rotateMix = mixOf('rotate', 'mixRotate');
    out.translateMix = mixOf('x', 'mixX');
    out.scaleMix = mixOf('scaleX', 'mixScaleX');
    out.shearMix = mixOf('shearY', 'mixShearY');
  }
  if (d.localTarget ?? d.local) out.local = true;
  if (d.additive ?? d.relative) out.relative = true;
  return out;
}

/** Axis-aligned bounds of the setup pose (stored in the skeleton header). */
function setupBounds(sk) {
  const pose = new Pose(sk);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (positions) => {
    for (let i = 0; i + 1 < positions.length; i += 2) {
      x0 = Math.min(x0, positions[i]);
      y0 = Math.min(y0, positions[i + 1]);
      x1 = Math.max(x1, positions[i]);
      y1 = Math.max(y1, positions[i + 1]);
    }
  };
  // What is visible: drawables, masked by clipping attachments.
  let clipper = null;
  let clipEnd = null;
  const quads = new Map(pose.quads(sk).map((q) => [q.slot, q]));
  for (const i of pose.drawOrder) {
    const att = pose.slotAttachment(sk, i);
    if (att?.type === 'clipping') {
      clipper = new Clipper(pose.worldVertices(sk, i, att));
      clipEnd = att.end === i ? null : (att.end ?? null); // ending at its own slot means: to the end
    } else if (quads.has(i)) {
      const q = quads.get(i);
      const positions = q.positions.flat();
      const triangles = q.kind === 'mesh' ? q.triangles : [0, 1, 2, 0, 2, 3];
      if (clipper) clipper.clip(positions, new Array(positions.length).fill(0), triangles, (p) => add(p));
      else add(positions);
    }
    if (clipper && clipEnd === i) clipper = null;
  }
  return Number.isFinite(x0) ? { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) } : { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Converts a Rigby2D Skeleton to a skeleton JSON object. `version` is "3.8" or "4.2".
 * Returns { json, warnings }.
 */
export function writeSkeletonJson(sk, { version = '3.8', binary = false } = {}) {
  const previous = round;
  if (binary) round = (v) => v;
  let result;
  try {
    result = writeJson(sk, version);
  } finally {
    round = previous;
  }
  // Binary-only data (`_` keys, e.g. the string table) is kept only when encoding to .skel.
  if (!binary) stripPrivate(result.json);
  return result;
}

function stripPrivate(o) {
  if (Array.isArray(o)) o.forEach(stripPrivate);
  else if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) {
      if (k.startsWith('_')) delete o[k];
      else stripPrivate(o[k]);
    }
  }
}

function writeJson(sk, version) {
  const v4 = version.startsWith('4');
  const minor = Number(version.split('.')[1] ?? 0);
  const v42 = v4 && minor >= 2;
  const v43 = v4 && minor >= 3;
  const warnings = [];
  const boneName = (i) => sk.bones[i].name;
  const slotName = (i) => sk.slots[i].name;

  const header = { ...(clone(sk.header) ?? {}) };
  delete header.version;
  // The project frame rate is the format's dopesheet frame rate (left out at its default, 30).
  const fps = sk.settings?.fps ?? 30;
  if (fps !== 30) header.fps = fps;
  else delete header.fps;
  const keptVersion = sk.header?.version && String(sk.header.version).startsWith(version) ? sk.header.version : `${version}.0`;
  // Keep the stored bounds while they still describe the setup pose, so unchanged files round-trip.
  const bounds = setupBounds(sk);
  const hasStored = ['x', 'y', 'width', 'height'].every((k) => typeof header[k] === 'number');
  const empty = bounds.width === 0 && bounds.height === 0;
  // Stored bounds may cover every skin or differ by rounding; keep them while the setup pose fits.
  const tolerance = Math.max(2, 0.01 * Math.max(bounds.width, bounds.height));
  const fits =
    hasStored &&
    bounds.x >= header.x - tolerance &&
    bounds.y >= header.y - tolerance &&
    bounds.x + bounds.width <= header.x + header.width + tolerance &&
    bounds.y + bounds.height <= header.y + header.height + tolerance;
  const stored = hasStored && (empty || fits);
  const json = { skeleton: { hash: '', ...header, [VERSION_FIELD]: keptVersion, ...(stored ? {} : bounds) } };

  json.bones = sk.bones.map((b) => {
    const o = { name: b.name };
    if (b.parent !== null) o.parent = boneName(b.parent);
    if (b.length) o.length = round(b.length);
    const t = b.setup;
    if (t.x) o.x = round(t.x);
    if (t.y) o.y = round(t.y);
    if (t.rotation) o.rotation = round(t.rotation);
    if (t.scale_x !== 1) o.scaleX = round(t.scale_x);
    if (t.scale_y !== 1) o.scaleY = round(t.scale_y);
    if (t.shear_x) o.shearX = round(t.shear_x);
    if (t.shear_y) o.shearY = round(t.shear_y);
    if (b.inherit && b.inherit !== 'normal') o[v42 ? 'inherit' : 'transform'] = b.inherit;
    if (b.skinRequired) o.skin = true;
    if (b.color) o.color = b.color;
    if (b.extra) Object.assign(o, clone(b.extra));
    return o;
  });

  json.slots = sk.slots.map((s) => {
    const o = { name: s.name, bone: boneName(s.bone) };
    if (s.color.some((c) => c !== 1)) o.color = colorToHex(s.color, 4);
    if (s.dark) o.dark = colorToHex(s.dark, 3);
    if (s.attachment !== null) o.attachment = s.attachment;
    if (s.blend && s.blend !== 'normal') o.blend = s.blend;
    if (s.extra) Object.assign(o, clone(s.extra));
    return o;
  });

  if (v43) {
    // One `constraints` array in application order, each tagged with its type.
    const all = sk.ik.map((c) => {
      const o = { type: 'ik', name: c.name, target: boneName(c.target), bones: c.bones.map(boneName) };
      if (c.skinRequired) o.skin = true;
      if (c.mix !== 1) o.mix = c.mix;
      if (c.softness) o.softness = c.softness;
      if (!c.bendPositive) o.bendPositive = false;
      if (c.compress) o.compress = true;
      if (c.stretch) o.stretch = true;
      if (c.uniform) o.uniform = true;
      if (c.extra) Object.assign(o, clone(c.extra));
      return { order: c.order, data: o };
    });
    for (const e of sk.extra.constraints ?? []) all.push({ order: e.index, data: clone(e.data) });
    for (const key of ['transform', 'path', 'physics']) {
      for (const c of sk.extra[key] ?? []) all.push({ order: c.order ?? all.length, data: { type: key, ...clone(c) } });
    }
    if (all.length) json.constraints = all.sort((a, b) => a.order - b.order).map((e) => e.data);
  } else if (sk.ik.length) {
    json.ik = sk.ik.map((c) => {
      const o = { name: c.name, order: c.order };
      if (c.skinRequired) o.skin = true;
      o.bones = c.bones.map(boneName);
      o.target = boneName(c.target);
      if (c.mix !== 1) o.mix = c.mix;
      if (c.softness) o.softness = c.softness;
      o.bendPositive = c.bendPositive;
      if (c.compress) o.compress = true;
      if (c.stretch) o.stretch = true;
      if (c.uniform) o.uniform = true;
      if (c.extra) Object.assign(o, clone(c.extra));
      return o;
    });
  }
  if (!v43) {
    for (const key of ['transform', 'path', 'physics']) if (sk.extra[key]) json[key] = clone(sk.extra[key]);
    for (const e of sk.extra.constraints ?? []) {
      const converted = legacyConstraint(clone(e.data), v42, (msg) => warnings.push(`constraint '${e.data.name}': ${msg}`));
      if (converted) (json[e.data.type] ??= []).push({ order: e.index, ...converted });
    }
  }

  const writeAttachments = (list) => {
    const out = {};
    for (const a of list) out[a.name] = writeAttachment(a, slotName, v43);
    return out;
  };
  const defaultSkin = { name: 'default', attachments: {} };
  sk.slots.forEach((s) => {
    if (s.attachments.length) defaultSkin.attachments[s.name] = writeAttachments(s.attachments);
  });
  json.skins = [defaultSkin];
  for (const skin of sk.skins) {
    const o = { name: skin.name, attachments: {} };
    for (const e of skin.slots) o.attachments[slotName(e.slot)] = writeAttachments(e.attachments);
    if (skin.bones.length) o.bones = skin.bones.map(boneName);
    if (skin.ik.length) o.ik = skin.ik.map((i) => sk.ik[i]?.name).filter(Boolean);
    if (skin.color) o.color = skin.color;
    Object.assign(o, clone(skin.extra) ?? {});
    json.skins.push(o);
  }

  if (sk.events.length) {
    json.events = {};
    for (const e of sk.events) {
      const o = {};
      if (e.int) o.int = e.int;
      if (e.float) o.float = e.float;
      if (e.string !== null) o.string = e.string;
      if (e.audio !== null) {
        o.audio = e.audio;
        if (e.volume !== 1) o.volume = e.volume;
        if (e.balance) o.balance = e.balance;
      }
      json.events[e.name] = o;
    }
  }

  json.animations = {};
  for (const anim of sk.animations) json.animations[anim.name] = writeAnimation(anim, sk, { v4, v42, boneName, slotName, warnings });
  for (const [k, v] of Object.entries(sk.extra)) if (!['transform', 'path', 'physics', 'constraints'].includes(k)) json[k] = clone(v);
  return { json, warnings };
}

function writeAttachment(a, slotName, v43) {
  const o = {};
  if (a.type !== 'region') o.type = a.type;
  if (a.sourceName !== undefined) o.name = a.sourceName;
  if (a.image !== (a.sourceName ?? a.name)) o.path = a.image;
  if (a.offset) {
    if (a.offset.x) o.x = round(a.offset.x);
    if (a.offset.y) o.y = round(a.offset.y);
    if (a.offset.scale_x !== 1) o.scaleX = round(a.offset.scale_x);
    if (a.offset.scale_y !== 1) o.scaleY = round(a.offset.scale_y);
    if (a.offset.rotation) o.rotation = round(a.offset.rotation);
  }
  if (a.type === 'mesh') {
    o.uvs = a.uvs.slice();
    o.triangles = a.triangles.slice();
    o.vertices = encodeVertices(a);
    o.hull = a.hull;
    if (a.edges) o.edges = a.edges.slice();
  }
  if (a.type === 'linkedmesh') {
    if (a.skin) o.skin = a.skin;
    o[v43 ? 'source' : 'parent'] = a.parent;
    if (a.deform === false) o[v43 ? 'timelines' : 'deform'] = false;
  }
  if (a.type === 'boundingbox' || a.type === 'path' || a.type === 'clipping') {
    o.vertexCount = a.vertexCount;
    o.vertices = encodeVertices(a);
  }
  if (a.type === 'path') {
    if (a.closed) o.closed = true;
    if (!a.constantSpeed) o.constantSpeed = false;
    o.lengths = a.lengths.slice();
  }
  if (a.type === 'clipping' && a.end !== null && a.end !== undefined) o.end = slotName(a.end);
  if (a.width !== undefined && (a.type === 'region' || a.width)) o.width = round(a.width);
  if (a.height !== undefined && (a.type === 'region' || a.height)) o.height = round(a.height);
  const def = hexToColor(DEFAULT_ATTACHMENT_COLORS[a.type], WHITE);
  if (a.color && (a.colorSet || a.color.some((c, i) => Math.abs(c - def[i]) > 1e-3))) o.color = colorToHex(a.color, 4);
  if (a.sequence !== undefined) o.sequence = clone(a.sequence);
  if (a.extra) Object.assign(o, clone(a.extra));
  return o;
}

function writeAnimation(anim, sk, { v4, boneName, slotName, warnings }) {
  const out = {};
  // Values equal to the default are omitted, as exporters do.
  const xy = (def) => (v) => {
    const o = {};
    if (round(v[0]) !== def) o.x = round(v[0]);
    if (round(v[1]) !== def) o.y = round(v[1]);
    return o;
  };
  const single = (field, def) => (v) => (round(v) !== def ? { [field]: round(v) } : {});

  for (const tl of anim.bones) {
    const o = {};
    if (tl.rotate.length) o.rotate = writeNumericKeys(tl.rotate, asArray, single(v4 ? 'value' : 'angle', 0), v4);
    for (const ch of ['translate', 'scale', 'shear']) if (tl[ch].length) o[ch] = writeNumericKeys(tl[ch], (v) => v, xy(ch === 'scale' ? 1 : 0), v4);
    for (const ch of ['translateX', 'translateY', 'scaleX', 'scaleY', 'shearX', 'shearY']) {
      if (!tl[ch].length) continue;
      if (!v4) {
        warnings.push(`'${anim.name}': ${ch} keys need format 4.x and were skipped`);
        continue;
      }
      o[ch.toLowerCase()] = writeNumericKeys(tl[ch], asArray, single('value', ch.startsWith('scale') ? 1 : 0), v4);
    }
    if (tl.inherit.length) {
      if (v4) o.inherit = tl.inherit.map((k) => ({ ...(k.time ? { time: round(k.time) } : {}), inherit: k.value }));
      else warnings.push(`'${anim.name}': inherit keys need format 4.2 and were skipped`);
    }
    const extra = anim.extra.bones?.[boneName(tl.bone)];
    if (extra) Object.assign(o, clone(extra));
    if (Object.keys(o).length) (out.bones ??= {})[boneName(tl.bone)] = o;
  }

  for (const tl of anim.slots) {
    const o = {};
    if (tl.attachment.length) o.attachment = tl.attachment.map((k) => ({ ...(v4 && !k.time ? {} : { time: round(k.time) }), ...(k.value === null && v4 ? {} : { name: k.value }) }));
    if (tl.color.length) o[v4 ? 'rgba' : 'color'] = writeNumericKeys(tl.color, (v) => v, (v) => ({ color: colorToHex(v, 4) }), v4);
    if (tl.rgba2.length) {
      o[v4 ? 'rgba2' : 'twoColor'] = writeNumericKeys(tl.rgba2, (v) => v, (v) => ({ light: colorToHex(v.slice(0, 4), 4), dark: colorToHex(v.slice(4, 7), 3) }), v4);
    }
    if (v4) {
      if (tl.rgb.length) o.rgb = writeNumericKeys(tl.rgb, (v) => v, (v) => ({ color: colorToHex(v, 3) }), v4);
      if (tl.alpha.length) o.alpha = writeNumericKeys(tl.alpha, asArray, single('value', 1), v4);
      if (tl.rgb2.length) o.rgb2 = writeNumericKeys(tl.rgb2, (v) => v, (v) => ({ light: colorToHex(v.slice(0, 3), 3), dark: colorToHex(v.slice(3, 6), 3) }), v4);
    } else if (tl.rgb.length || tl.alpha.length || tl.rgb2.length) {
      warnings.push(`'${anim.name}': separate rgb/alpha keys need format 4.x and were skipped`);
    }
    const extra = anim.extra.slots?.[slotName(tl.slot)];
    if (extra) Object.assign(o, clone(extra));
    if (Object.keys(o).length) (out.slots ??= {})[slotName(tl.slot)] = o;
  }

  if (anim.ik.length) {
    out.ik = {};
    for (const t of anim.ik) {
      out.ik[sk.ik[t.constraint].name] = t.keys.map((k) => {
        const { curve, ...v } = k.value;
        const o = {};
        if (!v4 || k.time) o.time = round(k.time);
        if (v.mix !== 1) o.mix = v.mix;
        if (v.softness) o.softness = v.softness;
        if (!v4 || !v.bendPositive) o.bendPositive = v.bendPositive;
        if (v.compress) o.compress = true;
        if (v.stretch) o.stretch = true;
        if (curve !== undefined) o.curve = clone(curve);
        return o;
      });
    }
  }
  for (const key of ['transform', 'path', 'physics']) if (anim.extra[key]) out[key] = clone(anim.extra[key]);

  if (anim.deform.length) {
    const root = {};
    for (const t of anim.deform) {
      const keys = writeNumericKeys(t.keys, () => [0], (v) => {
        const o = {};
        if (v.offset) o.offset = v.offset;
        if (v.vertices.length) o.vertices = v.vertices.map(round);
        return o;
      }, v4, () => [1]);
      // 3.8 deform curves are written as if the value went 0 -> 1, which matches normalized form.
      const skin = t.skin ?? 'default';
      const slotKey = slotName(t.slot);
      if (v4) (((root[skin] ??= {})[slotKey] ??= {})[t.attachment] ??= {}).deform = keys;
      else ((root[skin] ??= {})[slotKey] ??= {})[t.attachment] = keys;
    }
    if (v4) out.attachments = root;
    else out.deform = root;
  }
  if (anim.extra.attachments && v4) {
    for (const [skin, slots] of Object.entries(anim.extra.attachments)) {
      for (const [slotKey, atts] of Object.entries(slots)) {
        for (const [attName, timelines] of Object.entries(atts)) Object.assign((((out.attachments ??= {})[skin] ??= {})[slotKey] ??= {})[attName] ??= {}, clone(timelines));
      }
    }
  }

  if (anim.drawOrder.length) {
    out[v4 ? 'drawOrder' : 'draworder'] = anim.drawOrder.map((k) => {
      const o = {};
      if (!v4 || k.time) o.time = round(k.time);
      if (k.value) o.offsets = k.value.map((e) => ({ slot: slotName(e.slot), offset: e.offset }));
      return o;
    });
  }
  if (anim.events.length) {
    out.events = anim.events.map((e) => {
      const { time, ...rest } = clone(e);
      return v4 && !time ? rest : { time: round(time), ...rest };
    });
  }
  for (const [k, v] of Object.entries(anim.extra)) {
    if (!['bones', 'slots', 'attachments', 'transform', 'path', 'physics'].includes(k)) out[k] = clone(v);
  }
  return out;
}

