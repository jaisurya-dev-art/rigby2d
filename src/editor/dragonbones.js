// SPDX-License-Identifier: MIT OR Apache-2.0
// DragonBones import: converts a DragonBones project (the `_ske.json` skeleton, 5.x or 4.5 data,
// and its `_tex.json` texture atlas) into skeleton JSON (format 3.8) and an .atlas, which the
// regular skeleton import then opens (io.js). No DOM: tests run it under Node.
//
// DragonBones measures Y down with rotation as skew Y; skeleton JSON measures Y up with rotation and
// shear. A DragonBones transform (x, y, skX, skY, scX, scY) becomes x, -y, rotation -skY,
// shearY skY - skX, scale scX, scY: the same matrix mirrored across the X axis. IK bends flip too.

import { writeAtlas } from '../core/atlas.js';

/** Whether a parsed JSON file is DragonBones skeleton data. */
export function isDragonBones(obj) {
  return !!obj && typeof obj === 'object' && Array.isArray(obj.armature) && !obj.skeleton;
}

/** Whether a parsed JSON file is a DragonBones texture atlas (`_tex.json`). */
export function isDragonBonesAtlas(obj) {
  return !!obj && typeof obj === 'object' && Array.isArray(obj.SubTexture);
}

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round = (v) => Math.round(v * 1e4) / 1e4;
const hex2 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/** A DragonBones transform as skeleton JSON bone/attachment fields (Y up). */
function transformFields(t = {}) {
  const skX = num(t.skX);
  const skY = num(t.skY);
  const out = {};
  const put = (k, v, d) => {
    if (round(v) !== d) out[k] = round(v);
  };
  put('x', num(t.x), 0);
  put('y', -num(t.y), 0);
  put('rotation', -skY, 0);
  put('shearY', skY - skX, 0);
  put('scaleX', num(t.scX, 1), 1);
  put('scaleY', num(t.scY, 1), 1);
  return out;
}

/** 2D affine [a, b, c, d, tx, ty] (Y down) of a DragonBones transform. */
function matrixOf(t = {}) {
  const r = (num(t.skY) * Math.PI) / 180;
  const k = (num(t.skX) * Math.PI) / 180 - r;
  const sx = num(t.scX, 1);
  const sy = num(t.scY, 1);
  return [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r + k) * sy, Math.cos(r + k) * sy, num(t.x), num(t.y)];
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Skeleton JSON 3.8 color "RRGGBBAA" from a DragonBones color transform (multipliers 0-100). */
function colorOf(c) {
  if (!c) return null;
  const m = (k) => num(c[k], 100) / 100;
  return `${hex2(m('rM'))}${hex2(m('gM'))}${hex2(m('bM'))}${hex2(m('aM'))}`;
}

/**
 * The curve of a DragonBones key for skeleton JSON 3.8: stepped (no tween), linear (0), a quadratic
 * ease for tweenEasing in -1..1, or the first Bezier of a `curve` list.
 */
function curveOf(frame) {
  if (Array.isArray(frame.curve) && frame.curve.length >= 4) {
    const [x1, y1, x2, y2] = frame.curve;
    return { curve: round(x1), c2: round(y1), c3: round(x2), c4: round(y2) };
  }
  const e = frame.tweenEasing;
  if (e === null || e === undefined || Number.isNaN(e)) return { curve: 'stepped' };
  if (e === 0) return {};
  // Negative eases in, positive eases out, 2 eases in and out.
  if (e >= 2) return { curve: 0.42, c2: 0, c3: 0.58, c4: 1 };
  // Ease out (0, 0, 0.58, 1) and ease in (0.42, 0, 1, 1), scaled by the easing amount.
  const k = Math.min(1, Math.abs(e));
  return e > 0 ? { curve: 0, c2: 0, c3: round(1 - 0.42 * k), c4: 1 } : { curve: round(0.42 * k), c2: 0, c3: 1, c4: 1 };
}

/** Walks frames with durations (in frames): calls fn(frame, timeSeconds, isLast). */
function eachFrame(frames, fps, fn) {
  let t = 0;
  frames.forEach((f, i) => {
    fn(f, round(t / fps), i === frames.length - 1);
    t += num(f.duration, 1);
  });
}

/**
 * Converts DragonBones skeleton data and its texture atlas to { json, atlas, warnings }:
 * skeleton JSON 3.8 and atlas text for the regular skeleton import. `armatureName` picks the
 * armature (default: the first).
 */
export function dragonBonesToSkeleton(ske, tex, { armatureName = null } = {}) {
  const warnings = [];
  const warn = (msg) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  const arm = (armatureName ? ske.armature.find((a) => a.name === armatureName) : null) ?? ske.armature[0];
  if (!arm) throw new Error('the DragonBones file has no armature');
  if (ske.armature.length > 1) warn(`the file has ${ske.armature.length} armatures; imported '${arm.name}'`);
  const fps = num(arm.frameRate, num(ske.frameRate, 24)) || 24;
  const version = String(ske.version ?? '5.5');

  // Texture sizes, for region attachments and meshes.
  const textures = new Map();
  for (const st of tex?.SubTexture ?? []) textures.set(st.name, { width: num(st.frameWidth, st.width), height: num(st.frameHeight, st.height) });

  // Bones, with their setup matrices (Y down) for weighted meshes.
  const dbBones = arm.bone ?? [];
  const boneIndex = new Map(dbBones.map((b, i) => [b.name, i]));
  const world = [];
  const bones = dbBones.map((b, i) => {
    const local = matrixOf(b.transform);
    const p = b.parent !== undefined ? boneIndex.get(b.parent) : undefined;
    world[i] = p === undefined ? local : multiply(world[p], local);
    const out = { name: b.name, ...(b.parent !== undefined ? { parent: b.parent } : {}), ...(num(b.length) ? { length: round(num(b.length)) } : {}), ...transformFields(b.transform) };
    if (b.inheritRotation === false && b.inheritScale === false) out.transform = 'onlyTranslation';
    else if (b.inheritRotation === false) out.transform = 'noRotationOrReflection';
    else if (b.inheritScale === false) out.transform = 'noScale';
    if (b.inheritTranslation === false) warn(`bone '${b.name}': not inheriting translation is not supported; it inherits it`);
    return out;
  });

  // Slots and their displays.
  const dbSlots = arm.slot ?? [];
  const slotByName = new Map(dbSlots.map((s) => [s.name, s]));
  const skins = [];
  const displays = new Map(); // slot -> [display names] (the default skin's), for display frames
  const meshes = new Map(); // `${skin}/${slot}/${display}` -> { weighted, bones, worldVertices } for deform keys
  for (const skin of arm.skin ?? []) {
    const name = skin.name || 'default';
    const attachments = {};
    for (const s of skin.slot ?? []) {
      const slot = slotByName.get(s.name);
      const bone = slot ? boneIndex.get(slot.parent) : undefined;
      const list = [];
      const out = {};
      for (const d of s.display ?? []) {
        if (!d) {
          list.push(null);
          continue;
        }
        const type = d.type ?? 'image';
        const image = d.path ?? d.name;
        list.push(d.name);
        if (type === 'image') {
          const size = textures.get(image) ?? { width: 0, height: 0 };
          if (!textures.has(image)) warn(`image '${image}' is not in the texture atlas`);
          if (d.pivot && (num(d.pivot.x, 0.5) !== 0.5 || num(d.pivot.y, 0.5) !== 0.5)) warn(`image '${d.name}': a pivot other than the center is not supported`);
          out[d.name] = { ...(image !== d.name ? { path: image } : {}), ...transformFields(d.transform), width: size.width, height: size.height };
        } else if (type === 'mesh') {
          const mesh = convertMesh(d, image, textures, world, bone, warn);
          out[d.name] = mesh.attachment;
          meshes.set(`${name}/${s.name}/${d.name}`, mesh);
        } else if (type === 'boundingBox') {
          const v = d.vertices ?? [];
          const m = matrixOf(d.transform);
          const pts = [];
          for (let i = 0; i + 1 < v.length; i += 2) {
            const [x, y] = apply(m, v[i], v[i + 1]);
            pts.push(round(x), round(-y));
          }
          out[d.name] = { type: 'boundingbox', vertexCount: pts.length / 2, vertices: pts };
        } else warn(`'${type}' displays (in slot '${s.name}') are not supported and were left out`);
      }
      if (Object.keys(out).length) attachments[s.name] = out;
      if (name === 'default' || !displays.has(s.name)) displays.set(s.name, list);
    }
    skins.push({ name, attachments });
  }
  if (!skins.some((s) => s.name === 'default')) skins.unshift({ name: 'default', attachments: {} });

  const slots = dbSlots.map((s) => {
    const index = s.displayIndex === undefined ? 0 : s.displayIndex;
    const att = index >= 0 ? (displays.get(s.name)?.[index] ?? null) : null;
    const out = { name: s.name, bone: s.parent };
    const color = colorOf(s.color);
    if (color && color !== 'ffffffff') out.color = color;
    if (att) out.attachment = att;
    const blend = { add: 'additive', multiply: 'multiply', screen: 'screen' }[s.blendMode];
    if (blend) out.blend = blend;
    else if (s.blendMode && s.blendMode !== 'normal') warn(`slot '${s.name}': blend mode '${s.blendMode}' is drawn as normal`);
    return out;
  });

  const ik = (arm.ik ?? []).map((c, order) => {
    const end = c.bone;
    const parent = dbBones[boneIndex.get(end)]?.parent;
    const chain = num(c.chain) >= 1 && parent ? [parent, end] : [end];
    return { name: c.name, order, bones: chain, target: c.target, mix: round(num(c.weight, 1) > 1 ? num(c.weight) / 100 : num(c.weight, 1)), bendPositive: c.bendPositive === false };
  });

  // Animations.
  const events = {};
  const animations = {};
  for (const a of arm.animation ?? []) {
    const anim = {};
    const animFps = num(a.frameRate, fps) || fps;
    const bonesOut = {};
    for (const tl of a.bone ?? []) {
      const out = {};
      if (tl.translateFrame) {
        out.translate = [];
        eachFrame(tl.translateFrame, animFps, (f, time) => out.translate.push({ time, x: round(num(f.x)), y: round(-num(f.y)), ...curveOf(f) }));
      }
      if (tl.rotateFrame) {
        out.rotate = [];
        eachFrame(tl.rotateFrame, animFps, (f, time) => out.rotate.push({ time, angle: round(-num(f.rotate)), ...curveOf(f) }));
        if (tl.rotateFrame.some((f) => num(f.skew))) warn(`animation '${a.name}': skew keys are not supported and were left out`);
      }
      if (tl.scaleFrame) {
        out.scale = [];
        eachFrame(tl.scaleFrame, animFps, (f, time) => out.scale.push({ time, x: round(num(f.x, 1)), y: round(num(f.y, 1)), ...curveOf(f) }));
      }
      if (tl.frame) {
        // DragonBones 4.5 / 5.0: one combined transform per key.
        out.translate = [];
        out.rotate = [];
        out.scale = [];
        eachFrame(tl.frame, animFps, (f, time) => {
          const t = f.transform ?? {};
          const c = curveOf(f);
          out.translate.push({ time, x: round(num(t.x)), y: round(-num(t.y)), ...c });
          out.rotate.push({ time, angle: round(-num(t.skY)), ...c });
          out.scale.push({ time, x: round(num(t.scX, 1)), y: round(num(t.scY, 1)), ...c });
        });
      }
      if (Object.keys(out).length) bonesOut[tl.name] = out;
    }
    if (Object.keys(bonesOut).length) anim.bones = bonesOut;

    const slotsOut = {};
    for (const tl of a.slot ?? []) {
      const out = {};
      const names = displays.get(tl.name) ?? [];
      const displayFrames = tl.displayFrame ?? (tl.frame ? tl.frame.filter((f) => f.displayIndex !== undefined).map((f) => ({ ...f, value: f.displayIndex })) : null);
      if (displayFrames?.length) {
        out.attachment = [];
        eachFrame(displayFrames, animFps, (f, time) => {
          const v = f.value ?? f.displayIndex ?? 0;
          out.attachment.push({ time, name: v >= 0 ? (names[v] ?? null) : null });
        });
      }
      const colorFrames = tl.colorFrame ?? (tl.frame ? tl.frame.map((f) => ({ ...f, value: f.color })) : null);
      if (colorFrames?.some((f) => f.value)) {
        out.color = [];
        eachFrame(colorFrames, animFps, (f, time) => out.color.push({ time, color: colorOf(f.value ?? {}) ?? 'ffffffff', ...curveOf(f) }));
      }
      if (Object.keys(out).length) slotsOut[tl.name] = out;
    }
    if (Object.keys(slotsOut).length) anim.slots = slotsOut;

    const deform = {};
    for (const tl of a.ffd ?? a.mesh ?? []) {
      const skin = tl.skin || 'default';
      const slot = tl.slot ?? tl.name;
      const mesh = meshes.get(`${skin}/${slot}/${tl.name}`) ?? meshes.get(`default/${slot}/${tl.name}`);
      if (!mesh) {
        warn(`animation '${a.name}': mesh '${tl.name}' for its deform keys was not found`);
        continue;
      }
      const keys = [];
      eachFrame(tl.frame ?? [], animFps, (f, time) => {
        const vertices = deformVertices(mesh, num(f.offset), f.vertices ?? []);
        keys.push({ time, ...(vertices.length ? { offset: 0, vertices } : {}), ...curveOf(f) });
      });
      ((deform[skin] ??= {})[slot] ??= {})[tl.name] = keys;
    }
    if (Object.keys(deform).length) anim.deform = deform;

    const ikOut = {};
    for (const tl of a.ik ?? []) {
      ikOut[tl.name] = [];
      eachFrame(tl.frame ?? [], animFps, (f, time) => ikOut[tl.name].push({ time, mix: round(num(f.weight, 1) > 1 ? num(f.weight) / 100 : num(f.weight, 1)), bendPositive: f.bendPositive === false, ...curveOf(f) }));
    }
    if (Object.keys(ikOut).length) anim.ik = ikOut;

    const zFrames = a.zOrder?.frame;
    if (zFrames?.length) {
      anim.drawOrder = [];
      eachFrame(zFrames, animFps, (f, time) => {
        const z = f.zOrder ?? [];
        const offsets = [];
        for (let i = 0; i + 1 < z.length; i += 2) if (dbSlots[z[i]]) offsets.push({ slot: dbSlots[z[i]].name, offset: z[i + 1] });
        anim.drawOrder.push(offsets.length ? { time, offsets } : { time });
      });
    }

    const eventKeys = [];
    eachFrame(a.frame ?? [], animFps, (f, time) => {
      const list = f.events ?? (f.event ? [{ name: f.event }] : []);
      for (const e of list) {
        if (!e?.name) continue;
        events[e.name] ??= {};
        const key = { time, name: e.name };
        const ints = e.ints ?? (e.int !== undefined ? [e.int] : []);
        const floats = e.floats ?? (e.float !== undefined ? [e.float] : []);
        const strings = e.strings ?? (e.string !== undefined ? [e.string] : []);
        if (ints.length) key.int = ints[0];
        if (floats.length) key.float = floats[0];
        if (strings.length) key.string = strings[0];
        eventKeys.push(key);
      }
      if (f.sound) warn(`animation '${a.name}': sound '${f.sound}' left out (add audio in Rigby2D)`);
    });
    if (eventKeys.length) anim.events = eventKeys;
    if (a.ffd === undefined && a.mesh === undefined && (a.surface || a.timeline)) warn(`animation '${a.name}': surface and custom timelines are not supported`);
    animations[a.name] = anim;
  }

  const json = {
    skeleton: { spine: '3.8.99', images: '', fps, ...(arm.aabb ? { x: num(arm.aabb.x), y: -num(arm.aabb.y) - num(arm.aabb.height), width: num(arm.aabb.width), height: num(arm.aabb.height) } : {}) },
    bones,
    slots,
    ...(ik.length ? { ik } : {}),
    skins,
    ...(Object.keys(events).length ? { events } : {}),
    animations,
  };
  if (!version.startsWith('5') && !version.startsWith('4.5')) warn(`DragonBones data version ${version}: only 4.5 and 5.x were tested`);

  return { json, atlas: tex ? atlasText(tex, warn) : null, warnings };
}

function multiply(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

/**
 * A mesh display as a skeleton JSON mesh attachment. Unweighted vertices are moved into bone space
 * (the display's transform applied, Y flipped); weighted ones are stored per influencing bone in
 * that bone's setup space, as skeleton JSON expects.
 */
function convertMesh(d, image, textures, world, bone, warn) {
  const v = d.vertices ?? [];
  const count = v.length / 2;
  const size = textures.get(image) ?? { width: num(d.width), height: num(d.height) };
  const attachment = { type: 'mesh', ...(image !== d.name ? { path: image } : {}), uvs: (d.uvs ?? []).map(round), triangles: d.triangles ?? [], width: size.width, height: size.height };
  // The outline: DragonBones lists hull edges first; their vertex count is the hull.
  const edges = d.edges ?? [];
  attachment.hull = edges.length ? Math.min(count, new Set(edges).size) : count;
  if (Array.isArray(d.weights) && d.weights.length) {
    // slotPose: the slot's display matrix at setup, so vertices are in armature space.
    const slotPose = d.slotPose?.length === 6 ? d.slotPose : [1, 0, 0, 1, 0, 0];
    const bonePose = new Map();
    for (let i = 0; i + 6 < (d.bonePose ?? []).length; i += 7) bonePose.set(d.bonePose[i], d.bonePose.slice(i + 1, i + 7));
    const out = [];
    const inverses = [];
    let w = 0;
    for (let i = 0; i < count; i++) {
      const [gx, gy] = apply(slotPose, v[i * 2], v[i * 2 + 1]);
      const n = d.weights[w++];
      out.push(n);
      const entries = [];
      for (let k = 0; k < n; k++) {
        const b = d.weights[w++];
        const weight = d.weights[w++];
        const inv = invert(bonePose.get(b) ?? world[b] ?? [1, 0, 0, 1, 0, 0]);
        const [lx, ly] = apply(inv, gx, gy);
        out.push(b, round(lx), round(-ly), round(weight));
        entries.push({ bone: b, inv });
      }
      inverses.push(entries);
    }
    attachment.vertices = out;
    return { attachment, weighted: true, inverses, count };
  }
  const m = matrixOf(d.transform);
  const out = [];
  for (let i = 0; i < count; i++) {
    const [x, y] = apply(m, v[i * 2], v[i * 2 + 1]);
    out.push(round(x), round(-y));
  }
  if (bone === undefined) warn(`mesh '${d.name}' is in a slot without a bone`);
  attachment.vertices = out;
  return { attachment, weighted: false, linear: m, count };
}

/** DragonBones deform offsets (armature or display space, Y down) as skeleton JSON deform vertices. */
function deformVertices(mesh, offset, values) {
  const deltas = new Array(mesh.count * 2).fill(0);
  for (let i = 0; i < values.length; i++) if (offset + i < deltas.length) deltas[offset + i] = values[i];
  if (!mesh.weighted) {
    const m = mesh.linear;
    const out = [];
    for (let i = 0; i < mesh.count; i++) {
      const x = deltas[i * 2];
      const y = deltas[i * 2 + 1];
      out.push(round(m[0] * x + m[2] * y), round(-(m[1] * x + m[3] * y)));
    }
    return trimZeros(out);
  }
  // Weighted: each bone's share of the vertex moves in that bone's setup space.
  const out = [];
  mesh.inverses.forEach((entries, i) => {
    const x = deltas[i * 2];
    const y = deltas[i * 2 + 1];
    for (const { inv } of entries) out.push(round(inv[0] * x + inv[2] * y), round(-(inv[1] * x + inv[3] * y)));
  });
  return trimZeros(out);
}

const trimZeros = (list) => (list.every((v) => v === 0) ? [] : list);

/** The DragonBones texture atlas (`_tex.json`) as .atlas text. */
function atlasText(tex, warn) {
  const width = num(tex.width);
  const height = num(tex.height);
  const regions = (tex.SubTexture ?? []).map((st) => {
    const w = num(st.width);
    const h = num(st.height);
    const ow = num(st.frameWidth, w);
    const oh = num(st.frameHeight, h);
    const left = -num(st.frameX);
    const top = -num(st.frameY);
    if (st.rotated) warn(`texture '${st.name}' is rotated in the atlas; check that it looks right`);
    return { name: st.name, x: num(st.x), y: num(st.y), width: w, height: h, originalWidth: ow, originalHeight: oh, offsetX: left, offsetY: oh - h - top, ...(st.rotated ? { rotate: 90 } : {}) };
  });
  return writeAtlas([{ name: tex.imagePath ?? `${tex.name}_tex.png`, width, height, regions }]);
}
