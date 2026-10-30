// SPDX-License-Identifier: MIT OR Apache-2.0
// Nested armatures for the DragonBones importer (dragonbones.js). A DragonBones slot can show another
// armature (a weapon, a flame, a muzzle flash) that plays its own animations. Skeleton JSON has no
// such display, so each one is flattened into the parent: the child's bones hang from the slot's bone
// (placed with the display's transform), its slots draw where the parent slot draws, and its
// animations are baked into every parent animation, following the child's default animation and the
// parent's `gotoAndPlay` actions. The child shows only while the parent slot shows that display, and
// takes the parent slot's color.

const EPS = 1e-4;
const round = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Grafts each nested armature into `json` (skeleton JSON 3.8, edited in place).
 * `instances`: [{ slot, display, index, transform, child: { json, info } }] where child.json is the
 * child converted (and itself flattened) and child.info its { durations, playTimes, defaultClip }.
 * `parent`: { info, displayKeys, actions, setupIndex } for the parent armature:
 *   displayKeys: animation -> slot -> [{ time, index }]; actions: animation -> slot -> [{ time, clip }];
 *   setupIndex: slot -> display index at setup.
 */
export function graftNested(json, instances, parent, fields, warn) {
  for (const inst of instances) graft(json, inst, parent, fields, warn);
}

function graft(json, inst, parent, fields, warn) {
  const child = inst.child.json;
  const info = inst.child.info;
  const prefix = `${inst.slot}/${inst.display}/`;
  const name = (n) => `${prefix}${n}`;
  const parentSlot = json.slots.find((s) => s.name === inst.slot);
  if (!parentSlot) return;

  // Bones: an instance bone under the slot's bone, holding the display's transform; the child's root
  // bones hang from it. Weighted meshes refer to bones by index, so indices are remapped.
  const instanceBone = { name: prefix.slice(0, -1), parent: parentSlot.bone, ...fields(inst.transform) };
  const boneIndex = new Map();
  json.bones.push(instanceBone);
  child.bones.forEach((b, i) => {
    boneIndex.set(i, json.bones.length);
    const out = { ...b, name: name(b.name), parent: b.parent === undefined ? instanceBone.name : name(b.parent) };
    // A child's root bone has no parent inside its armature, so its inherit flags change nothing
    // there: the whole child follows the slot, scale and mirroring included.
    if (b.parent === undefined) delete out.transform;
    json.bones.push(out);
  });

  // Slots, drawn where the parent slot is drawn; visible at setup when the slot shows this display.
  const visibleAtSetup = (parent.setupIndex.get(inst.slot) ?? 0) === inst.index;
  const parentColor = parentSlot.color ?? 'ffffffff';
  // After the parent slot and any armatures already grafted there, so displays keep their order.
  let at = json.slots.indexOf(parentSlot) + 1;
  while (at < json.slots.length && json.slots[at].name.startsWith(`${inst.slot}/`)) at++;
  const childSetup = new Map(child.slots.map((s) => [s.name, s]));
  json.slots.splice(
    at,
    0,
    ...child.slots.map((s) => {
      const out = { ...s, name: name(s.name), bone: name(s.bone) };
      if (!visibleAtSetup) delete out.attachment;
      const color = multiplyColors(s.color ?? 'ffffffff', parentColor);
      if (color !== 'ffffffff') out.color = color;
      else delete out.color;
      return out;
    }),
  );

  // Attachments, in the skin of the same name (the default skin otherwise).
  for (const skin of child.skins ?? []) {
    let target = json.skins.find((s) => s.name === skin.name) ?? json.skins.find((s) => s.name === 'default');
    if (!target) json.skins.push((target = { name: 'default', attachments: {} }));
    for (const [slot, atts] of Object.entries(skin.attachments ?? {})) {
      const out = {};
      for (const [attName, att] of Object.entries(atts)) out[attName] = remapWeights(att, boneIndex);
      target.attachments[name(slot)] = out;
    }
  }

  // IK constraints and event names.
  const ikOrder = (json.ik ?? []).length;
  for (const c of child.ik ?? []) (json.ik ??= []).push({ ...c, name: name(c.name), order: ikOrder + (c.order ?? 0), bones: c.bones.map(name), target: name(c.target) });
  for (const [e, def] of Object.entries(child.events ?? {})) (json.events ??= {})[e] ??= def;

  if (Object.values(child.animations ?? {}).some((a) => a.drawOrder)) warn(`nested armature '${inst.display}': its draw order keys are not supported and were left out`);

  // Animations: the child's clips baked into every parent animation.
  for (const [animName, anim] of Object.entries(json.animations)) {
    const duration = parent.info.durations[animName] ?? 0;
    // As the DragonBones runtime does: when the parent starts an animation, a child with an
    // animation of the same name plays it; a child the slot switches to starts over with the
    // display's actions (or its default animation); and the parent's actions start other clips.
    const shownClip = inst.play && child.animations[inst.play] ? inst.play : info.defaultClip;
    const keys = parent.displayKeys.get(animName)?.get(inst.slot) ?? [];
    const starts = [{ time: 0, clip: child.animations[animName] ? animName : shownClip }];
    keys.forEach((k, i) => {
      const before = i ? keys[i - 1].index : (parent.setupIndex.get(inst.slot) ?? 0);
      if (k.index === inst.index && before !== inst.index && k.time > 0) starts.push({ time: k.time, clip: shownClip });
    });
    const acted = (parent.actions.get(animName)?.get(inst.slot) ?? []).filter((a) => a.time <= duration && child.animations[a.clip]);
    const segments = [...starts.filter((st) => !acted.some((a) => Math.abs(a.time - st.time) < EPS)), ...acted].filter((sg) => sg.clip).sort((x, y) => x.time - y.time);
    if (!segments.length || segments[0].time > 0) segments.unshift({ time: 0, clip: info.defaultClip });
    const bake = (getKeys, setup, kind) => bakeKeys(segments, duration, info, getKeys, setup, kind);

    for (const b of child.bones) {
      const out = {};
      for (const [tl, setup] of [
        ['rotate', { angle: 0 }],
        ['translate', { x: 0, y: 0 }],
        ['scale', { x: 1, y: 1 }],
        ['shear', { x: 0, y: 0 }],
      ]) {
        if (!Object.values(child.animations).some((a) => a.bones?.[b.name]?.[tl])) continue;
        out[tl] = bake((clip) => child.animations[clip]?.bones?.[b.name]?.[tl], setup, 'numbers');
      }
      if (Object.keys(out).length) (anim.bones ??= {})[name(b.name)] = out;
    }

    // Visibility: the parent slot's display keys; color: the parent slot's color keys.
    const shown = stepFunction(parent.displayKeys.get(animName)?.get(inst.slot)?.map((k) => ({ time: k.time, value: k.index === inst.index })), visibleAtSetup);
    const parentColorKeys = anim.slots?.[inst.slot]?.color;
    for (const s of child.slots) {
      const out = {};
      const setupAtt = childSetup.get(s.name).attachment ?? null;
      const attKeys = bake((clip) => child.animations[clip]?.slots?.[s.name]?.attachment, { name: setupAtt }, 'step');
      const times = uniqueTimes([...attKeys.map((k) => k.time), ...shown.times, 0]);
      const attachment = times.map((t) => ({ time: t, name: shown.at(t) ? valueAt(attKeys, t, { name: setupAtt }, 'step').name : null }));
      if (attachment.some((k) => k.name !== (visibleAtSetup ? setupAtt : null))) out.attachment = compactSteps(attachment, 'name');

      const childColor = Object.values(child.animations).some((a) => a.slots?.[s.name]?.color);
      if (childColor || parentColorKeys) {
        const own = childColor ? bake((clip) => child.animations[clip]?.slots?.[s.name]?.color, { color: s.color ?? 'ffffffff' }, 'color') : [{ time: 0, color: s.color ?? 'ffffffff' }];
        const theirs = parentColorKeys ?? [{ time: 0, color: parentColor }];
        out.color = uniqueTimes([...own.map((k) => k.time), ...theirs.map((k) => k.time)]).map((t) => {
          const key = { time: t, color: multiplyColors(valueAt(own, t, { color: 'ffffffff' }, 'color').color, valueAt(theirs, t, { color: parentColor }, 'color').color) };
          // Keep the curve of whichever timeline has a key here.
          const from = own.find((k) => k.time === t && k.curve !== undefined) ?? theirs.find((k) => k.time === t && k.curve !== undefined);
          if (from) Object.assign(key, curveFields(from));
          return key;
        });
      }
      if (Object.keys(out).length) (anim.slots ??= {})[name(s.name)] = out;
    }

    // Mesh deformation.
    const deformSlots = new Map();
    for (const a of Object.values(child.animations)) for (const [skin, slots] of Object.entries(a.deform ?? {})) for (const [slot, atts] of Object.entries(slots)) for (const att of Object.keys(atts)) deformSlots.set(`${skin}\u0000${slot}\u0000${att}`, [skin, slot, att]);
    for (const [skin, slot, att] of deformSlots.values()) {
      const keys = bake((clip) => child.animations[clip]?.deform?.[skin]?.[slot]?.[att], { vertices: [] }, 'vertices');
      ((((anim.deform ??= {})[skin] ??= {})[name(slot)] ??= {})[att] = keys);
    }

    // IK mixes.
    for (const c of child.ik ?? []) {
      if (!Object.values(child.animations).some((a) => a.ik?.[c.name])) continue;
      (anim.ik ??= {})[name(c.name)] = bake((clip) => child.animations[clip]?.ik?.[c.name], { mix: c.mix ?? 1, bendPositive: c.bendPositive ?? true }, 'numbers');
    }

    // Events the child fires while it plays.
    const events = [];
    forEachPlay(segments, duration, info, (clip, offset, from, to) => {
      for (const e of child.animations[clip]?.events ?? []) {
        const t = round(e.time + offset);
        if (t >= from - EPS && t < to - EPS) events.push({ ...e, time: t });
      }
    });
    if (events.length) anim.events = [...(anim.events ?? []), ...events].sort((a, b) => a.time - b.time);
  }
}

/** Skeleton JSON weighted mesh vertices refer to bones by index: renumbers them for the parent. */
function remapWeights(att, boneIndex) {
  if (att.type !== 'mesh' || !att.vertices || !att.uvs || att.vertices.length <= att.uvs.length) return att;
  const v = [...att.vertices];
  for (let i = 0; i < v.length; ) {
    const n = v[i++];
    for (let k = 0; k < n; k++, i += 4) v[i] = boneIndex.get(v[i]) ?? v[i];
  }
  return { ...att, vertices: v };
}

/**
 * Calls fn(clip, offset, from, to) for every loop of every play: a clip started at a segment's time
 * plays (looping as its playTimes says) until the next segment or the end of the parent animation.
 */
function forEachPlay(segments, duration, info, fn) {
  segments.forEach((seg, i) => {
    const end = i + 1 < segments.length ? segments[i + 1].time : duration;
    const length = info.durations[seg.clip] ?? 0;
    const times = info.playTimes[seg.clip] ?? 1;
    for (let k = 0; ; k++) {
      const offset = seg.time + k * length;
      fn(seg.clip, offset, Math.max(seg.time, offset), Math.min(end, offset + length) + (i + 1 === segments.length ? EPS * 2 : 0));
      if (length <= 0 || offset + length >= end - EPS || (times > 0 && k + 1 >= times)) break;
    }
  });
}

/**
 * The keys of a child timeline over the parent animation: for each play of a clip, the clip's keys
 * shifted to where it plays (looped, held at its end), cut where the next play starts, with keys
 * added at the cuts so values change only there. `kind`: numbers, color, vertices or step.
 */
function bakeKeys(segments, duration, info, getKeys, setup, kind) {
  const out = [];
  const push = (key) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.time - key.time) < EPS / 2) out[out.length - 1] = key;
    else out.push(key);
  };
  segments.forEach((seg, i) => {
    const end = i + 1 < segments.length ? segments[i + 1].time : duration;
    const keys = getKeys(seg.clip);
    if (!keys?.length) {
      push({ time: round(seg.time), ...setup, ...(kind === 'step' ? {} : { curve: 'stepped' }) });
      return;
    }
    const length = info.durations[seg.clip] ?? 0;
    const times = info.playTimes[seg.clip] ?? 1;
    const localAt = (t) => {
      if (length <= 0) return 0;
      const k = Math.floor((t - seg.time) / length + EPS);
      if (times > 0 && k >= times) return length;
      return Math.min(length, Math.max(0, t - seg.time - k * length));
    };
    const stamps = [seg.time];
    for (let k = 0; length > 0; k++) {
      const offset = seg.time + k * length;
      if (offset >= end - EPS || (times > 0 && k >= times)) break;
      for (const key of keys) if (key.time + offset < end - EPS) stamps.push(key.time + offset);
    }
    const last = i + 1 === segments.length;
    // The cut: the value just before the next play takes over (or at the end of the animation).
    const cut = last ? end : end - EPS;
    if (cut > seg.time) stamps.push(cut);
    for (const t of uniqueTimes(stamps)) {
      const local = localAt(t);
      const exact = keys.find((k) => Math.abs(k.time - local) < EPS);
      const value = exact ? withoutTime(exact) : { ...valueAt(keys, local, setup, kind) };
      if (!exact && kind !== 'step') delete value.curve;
      if (!exact && t >= cut - EPS / 2 && !last) value.curve = 'stepped';
      push({ time: round(t), ...value });
    }
  });
  return out;
}

const withoutTime = ({ time, ...rest }) => rest;
const curveFields = (k) => Object.fromEntries(['curve', 'c2', 'c3', 'c4'].filter((f) => k[f] !== undefined).map((f) => [f, k[f]]));
const uniqueTimes = (list) => [...new Set(list.map((t) => round(t)))].sort((a, b) => a - b);

/** The value of keyed timeline `keys` at `time` (linear between keys, held outside them). */
function valueAt(keys, time, setup, kind) {
  if (!keys?.length) return setup;
  if (time <= keys[0].time) return withoutTime(keys[0]);
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= b.time) continue;
    if (kind === 'step' || a.curve === 'stepped') return withoutTime(a);
    const f = (time - a.time) / (b.time - a.time || 1);
    return interpolate(a, b, f, kind);
  }
  return withoutTime(keys[keys.length - 1]);
}

function interpolate(a, b, f, kind) {
  if (kind === 'color') return { color: mixColors(a.color, b.color, f) };
  if (kind === 'vertices') {
    const va = expand(a);
    const vb = expand(b);
    const n = Math.max(va.length, vb.length);
    return { offset: 0, vertices: Array.from({ length: n }, (_, i) => round((va[i] ?? 0) + ((vb[i] ?? 0) - (va[i] ?? 0)) * f)) };
  }
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 'time' || ['curve', 'c2', 'c3', 'c4'].includes(k)) continue;
    out[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? round(a[k] + (b[k] - a[k]) * f) : a[k];
  }
  return out;
}

const expand = (k) => [...new Array(k.offset ?? 0).fill(0), ...(k.vertices ?? [])];

/** A step function from [{ time, value }] keys: { at(t), times }. */
function stepFunction(keys, initial) {
  const list = keys?.length ? keys : [];
  return {
    times: list.map((k) => k.time),
    at: (t) => {
      let v = list.length ? list[0].value : initial;
      for (const k of list) if (k.time <= t + EPS / 2) v = k.value;
      return v;
    },
  };
}

/** Drops keys that repeat the previous value. */
function compactSteps(keys, field) {
  return keys.filter((k, i) => i === 0 || k[field] !== keys[i - 1][field]);
}

const channels = (hex) => [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toHex = (c) => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

/** RRGGBBAA colors multiplied, as a display's color multiplies its parent slot's. */
export function multiplyColors(a, b) {
  const x = channels(a);
  const y = channels(b);
  return toHex(x.map((v, i) => v * y[i]));
}

function mixColors(a, b, f) {
  const x = channels(a);
  const y = channels(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * f));
}
