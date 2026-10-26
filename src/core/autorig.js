// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby AutoRig: turns layered artwork (one image per body part, as a PSD import gives) into an
// editable rig. It identifies each part from its layer name (or its position), measures its shape
// from the image's opaque pixels, places joints where parts meet, builds a skeleton (spine, neck,
// head, arms, legs, face, tail, wings), attaches every part to its bone, makes bending parts into
// weighted meshes and adds IK for arms and legs. Everything it makes is ordinary rig data.

import { Affine, toAffine } from './math.js';
import { autoWeights, triangulateMesh } from './meshgeom.js';
import { makeBone } from './model.js';
import { Pose } from './pose.js';
import { PAIRED, classify } from './bodyparts.js';

const DEG = Math.PI / 180;
const ARM = ['upperarm', 'forearm', 'hand'];
const LEG = ['thigh', 'shin', 'foot'];
const FACE = new Set(['eye', 'pupil', 'brow', 'mouth', 'nose', 'jaw']);
/** IK bendPositive keeps a chain that turns counter-clockwise at its middle joint (cross > 0). */
const BEND_POSITIVE_IS_CCW = true;

/** Roles a part can be given (by name, position or by hand). 'extra' rides on the nearest bone. */
export const PART_ROLES = ['head', 'neck', 'torso', 'pelvis', 'upperarm', 'forearm', 'hand', 'arm', 'thigh', 'shin', 'foot', 'leg', 'eye', 'pupil', 'brow', 'mouth', 'nose', 'jaw', 'ear', 'hair', 'tail', 'wing', 'extra'];

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleOf = (v) => Math.atan2(v[1], v[0]) / DEG;

// ---- parts ------------------------------------------------------------------------------------

/** The image-pixel to world mapping of a slot's region attachment in the setup pose. */
function pixelToWorld(pose, slot, att, iw, ih) {
  const m = pose.world[slot.bone].mul(toAffine(att.offset));
  const sx = att.width / iw;
  const sy = att.height / ih;
  return m.mul(new Affine(sx, 0, 0, -sy, -att.width / 2, att.height / 2));
}

/**
 * Shape of a part from its opaque pixels: world sample points, centroid, main axis (u) and its
 * normal (v), extents along both, and area.
 */
function measure(pose, slot, att, alpha) {
  const iw = alpha?.width ?? Math.max(1, Math.round(att.width));
  const ih = alpha?.height ?? Math.max(1, Math.round(att.height));
  const toWorld = pixelToWorld(pose, slot, att, iw, ih);
  const step = Math.max(1, Math.ceil(Math.sqrt((iw * ih) / 6000)));
  const points = [];
  if (alpha) {
    for (let y = 0; y < ih; y += step) for (let x = 0; x < iw; x += step) if (alpha.data[y * iw + x] >= 64) points.push(toWorld.apply([x + 0.5, y + 0.5]));
  }
  if (points.length < 3) {
    for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++) points.push(toWorld.apply([(x / 10) * iw, (y / 10) * ih]));
  }
  const n = points.length;
  const c = points.reduce((s, p) => add(s, p), [0, 0]).map((v) => v / n);
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of points) {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  const u = [Math.cos(theta), Math.sin(theta)];
  const v = [-u[1], u[0]];
  let amin = Infinity;
  let amax = -Infinity;
  let pmin = Infinity;
  let pmax = -Infinity;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const d = sub(p, c);
    const a = d[0] * u[0] + d[1] * u[1];
    const b = d[0] * v[0] + d[1] * v[1];
    amin = Math.min(amin, a);
    amax = Math.max(amax, a);
    pmin = Math.min(pmin, b);
    pmax = Math.max(pmax, b);
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  const pixel = (att.width / iw) * (att.height / ih);
  return { points, c, u, v, amin, amax, pmin, pmax, box: { x0, y0, x1, y1 }, area: n * step * step * pixel, length: amax - amin, thickness: pmax - pmin, toWorld, iw, ih };
}

/** The ends of a part along its main axis, nearer one first relative to `toward`, pulled in from the edge. */
function ends(g, toward, pull = 1) {
  const e1 = add(g.c, mul(g.u, g.amin));
  const e2 = add(g.c, mul(g.u, g.amax));
  const [near, far] = dist(e1, toward) <= dist(e2, toward) ? [e1, e2] : [e2, e1];
  const dir = mul(sub(far, near), 1 / Math.max(1e-6, dist(far, near)));
  // Joints sit inside rounded ends: about half the part's thickness from the edge.
  const inset = Math.min(g.thickness * 0.5, g.length * 0.25);
  return { near: add(near, mul(dir, inset * pull)), far: sub(far, mul(dir, inset * pull * 0.5)), dir };
}

/**
 * Finds the parts of unrigged artwork: one per slot on the root bone with an image (region)
 * attachment. `alphaOf(image)` gives { width, height, data (alpha 0-255 per pixel) } or null.
 * Returns parts with their role, side and how the role was found ('name', 'position', 'manual').
 */
export function findParts(doc, alphaOf, { roles = {}, sides = {} } = {}) {
  if (doc.bones.length > 1) throw new Error('AutoRig works on unrigged artwork: this project already has bones. Start from a new project with the imported layers.');
  const pose = new Pose(doc);
  const parts = [];
  doc.slots.forEach((slot, i) => {
    const att = slot.attachments.find((a) => a.name === slot.attachment) ?? slot.attachments[0];
    if (!att || att.type !== 'region') return;
    const g = measure(pose, slot, att, alphaOf(att.image ?? att.name));
    const found = classify(slot.name) ?? classify(att.name) ?? classify(att.image ?? '');
    const manual = roles[slot.name];
    const role = manual ?? found?.role ?? null;
    parts.push({
      slot: i,
      name: slot.name,
      att,
      g,
      role,
      // Only paired parts have sides: "mouth_viseme_L" is a mouth shape, not the mouth's left side.
      side: slot.name in sides ? sides[slot.name] : PAIRED.has(role) ? (found?.side ?? null) : null,
      index: found?.index ?? null,
      from: manual ? 'manual' : found ? 'name' : null,
    });
  });
  guessByPosition(parts);
  return parts;
}

/** Roles and sides for parts their names do not explain, from where they are relative to the torso. */
function guessByPosition(parts) {
  const all = parts.filter((p) => p.role !== 'none');
  if (!all.length) return;
  const box = all.reduce((b, p) => ({ x0: Math.min(b.x0, p.g.box.x0), y0: Math.min(b.y0, p.g.box.y0), x1: Math.max(b.x1, p.g.box.x1), y1: Math.max(b.y1, p.g.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  let torso = all.find((p) => p.role === 'torso');
  if (!torso) {
    // The biggest unnamed part near the middle of the figure.
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    torso = all.filter((p) => !p.role && Math.abs(p.g.c[0] - cx) < w * 0.3 && Math.abs(p.g.c[1] - cy) < h * 0.3).sort((a, b) => b.g.area - a.g.area)[0];
    if (torso) Object.assign(torso, { role: 'torso', from: 'position' });
  }
  const t = torso?.g.box ?? box;
  const tcx = torso ? torso.g.c[0] : (box.x0 + box.x1) / 2;
  const tw = t.x1 - t.x0;
  for (const p of all) {
    if (p.role) continue;
    const [x, y] = p.g.c;
    p.from = 'position';
    if (y > t.y1 - (t.y1 - t.y0) * 0.1 && Math.abs(x - tcx) < tw) p.role = all.some((q) => q.role === 'head') ? 'extra' : 'head';
    else if (y < t.y0 + (t.y1 - t.y0) * 0.1) p.role = 'leg';
    else if (Math.abs(x - tcx) > tw * 0.4) p.role = 'arm';
    else p.role = 'extra';
  }
  // Limb parts without a side follow the limb they hang from: an upper arm (or leg) takes its side
  // from its position, then the forearm and hand take the side of the nearest arm part above them,
  // so a hand raised across the body stays on its own arm.
  const sideFromPosition = (p) => (p.g.c[0] >= tcx ? 'l' : 'r');
  for (const chain of [['upperarm', 'arm', 'forearm', 'hand'], ['thigh', 'leg', 'shin', 'foot']]) {
    chain.forEach((role, level) => {
      for (const p of all) {
        if (p.role !== role || p.side) continue;
        const above = all.filter((q) => q.side && chain.indexOf(q.role) >= 0 && chain.indexOf(q.role) < Math.max(level, 2) && q !== p);
        const nearest = level >= 2 ? above.sort((a, b) => dist(a.g.c, p.g.c) - dist(b.g.c, p.g.c))[0] : null;
        p.side = nearest ? nearest.side : sideFromPosition(p);
      }
    });
  }
  // Other paired parts without a side: the figure faces the viewer, so its left is on the image's right.
  for (const p of all) if (PAIRED.has(p.role) && !p.side) p.side = sideFromPosition(p);
}

// ---- rig --------------------------------------------------------------------------------------

/**
 * Builds the rig. Options: meshes ('deforming': meshes for parts that bend across bones,
 * 'all': every part, 'none'), ik (true: IK for two-bone arms and legs), roles and sides
 * ({ slotName: role / side } to override the detection; role 'none' leaves a part on the root).
 * Returns a report: { parts: [{ name, role, side, from, bone, mesh }], bones, ik, warnings }.
 */
export function autoRig(doc, alphaOf, options = {}) {
  const { meshes = 'deforming', ik = true } = options;
  const parts = findParts(doc, alphaOf, options).filter((p) => p.role !== 'none');
  const warnings = [];
  const frames = [new Pose(doc).world[0]];
  const tips = [[0, 0]];
  /** part -> bones it is weighted to (first one owns the slot). */
  const owners = new Map();

  const bone = (base, parent, head, tip) => {
    const length = dist(head, tip);
    const angle = length > 1e-6 ? angleOf(sub(tip, head)) : 0;
    const pw = frames[parent];
    const local = pw.inverse().apply(head);
    const name = doc.uniqueBoneName(base);
    doc.bones.push(makeBone(name, parent, { x: local[0], y: local[1], rotation: angle - pw.rotation(), scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 }, length));
    frames.push(new Affine(Math.cos(angle * DEG), Math.sin(angle * DEG), -Math.sin(angle * DEG), Math.cos(angle * DEG), head[0], head[1]));
    tips.push(tip);
    return doc.bones.length - 1;
  };
  const own = (part, ...bones) => owners.set(part, bones);
  const byRole = (role, side = undefined) => parts.filter((p) => p.role === role && (side === undefined || p.side === side)).sort((a, b) => b.g.area - a.g.area);
  const sfx = (side) => (side ? `_${side}` : '');

  // Spine: hip at the bottom of the torso, chest from its middle to the top.
  const [torso] = byRole('torso');
  const [pelvis] = byRole('pelvis');
  let hip;
  let chest = null;
  let neckBase;
  if (torso) {
    const g = torso.g;
    // The spine runs up the torso's main axis.
    const flip = g.u[1] < 0;
    const up = flip ? mul(g.u, -1) : g.u;
    const [lo, hi] = flip ? [-g.amax, -g.amin] : [g.amin, g.amax];
    const bottom = add(g.c, mul(up, lo + g.length * 0.08));
    const top = add(g.c, mul(up, hi - g.length * 0.05));
    const mid = lerp2(bottom, top, 0.45);
    const start = pelvis ? pelvis.g.c : bottom;
    hip = bone('hip', 0, start, mid);
    chest = bone('chest', hip, mid, top);
    neckBase = top;
    own(torso, ...(meshes === 'none' ? [chest] : [hip, chest]));
    if (pelvis) own(pelvis, hip);
  } else if (pelvis) {
    hip = bone('hip', 0, pelvis.g.c, add(pelvis.g.c, [0, pelvis.g.length * 0.5]));
    own(pelvis, hip);
    neckBase = tips[hip];
  } else {
    const ys = parts.map((p) => p.g.c);
    const c = ys.length ? mul(ys.reduce(add, [0, 0]), 1 / ys.length) : [0, 0];
    hip = bone('hip', 0, c, add(c, [0, 1]));
    neckBase = c;
    warnings.push('No torso found: name the body layer "torso" or "body" for a better spine.');
  }
  const upper = chest ?? hip;
  for (const extra of [...byRole('torso').slice(1), ...byRole('pelvis').slice(1)]) own(extra, extra.role === 'torso' ? upper : hip);

  // Neck and head.
  let headParent = upper;
  const [neck] = byRole('neck');
  if (neck) {
    const e = ends(neck.g, neckBase);
    headParent = bone('neck', upper, e.near, e.far);
    own(neck, headParent);
    neckBase = e.far;
  }
  const [head] = byRole('head');
  let headBone = headParent;
  if (head) {
    const g = head.g;
    // The head turns at its base: between the head and the top of the body when there is a gap,
    // otherwise a little inside the head.
    const bottom = [g.c[0], g.box.y0 + (g.box.y1 - g.box.y0) * 0.12];
    const base = neck ? neckBase : [g.c[0], neckBase[1] < g.box.y0 ? (neckBase[1] + g.box.y0) / 2 : bottom[1]];
    headBone = bone('head', headParent, base, [base[0], g.box.y1 - (g.box.y1 - g.box.y0) * 0.1]);
    own(head, headBone);
    for (const alt of byRole('head').slice(1)) own(alt, headBone);
  } else if (parts.some((p) => FACE.has(p.role) || p.role === 'hair' || p.role === 'ear')) {
    warnings.push('No head found: face parts are attached to the spine.');
  }

  // Face: a small bone per feature at its center; pupils follow their eye.
  const featureBones = new Map();
  const featureOrder = ['jaw', 'eye', 'brow', 'nose', 'mouth', 'pupil'];
  for (const role of featureOrder) {
    for (const p of byRole(role)) {
      const key = `${role}${sfx(p.side)}`;
      if (featureBones.has(key)) {
        own(p, featureBones.get(key));
        continue;
      }
      const parent = (role === 'pupil' && featureBones.get(`eye${sfx(p.side)}`)) || (role === 'mouth' && featureBones.get('jaw')) || headBone;
      const c = role === 'jaw' ? [p.g.c[0], p.g.box.y1] : p.g.c;
      const b = bone(key, parent, c, add(c, [Math.max(1, (p.g.box.x1 - p.g.box.x0) * 0.4), 0]));
      featureBones.set(key, b);
      own(p, b);
    }
  }

  // Chains along a part: hair and ears from the head, wings from the chest, tails from the hip.
  const chainOf = (p, base, parent, anchor, count) => {
    const e = ends(p.g, anchor);
    const bones = [];
    let prev = parent;
    for (let k = 0; k < count; k++) {
      prev = bone(`${base}${count > 1 ? k + 1 : ''}`, prev, lerp2(e.near, e.far, k / count), lerp2(e.near, e.far, (k + 1) / count));
      bones.push(prev);
    }
    own(p, ...bones);
  };
  const longParts = (role) => byRole(role).filter((p, i, list) => list.findIndex((q) => q.side === p.side && q.index === p.index) === i);
  for (const p of longParts('hair')) chainOf(p, `hair${sfx(p.side)}${p.index ?? ''}`, headBone, head ? head.g.c : neckBase, p.g.length > 2.5 * p.g.thickness ? 2 : 1);
  for (const p of longParts('ear')) chainOf(p, `ear${sfx(p.side)}`, headBone, head ? head.g.c : neckBase, 1);
  for (const p of longParts('wing')) chainOf(p, `wing${sfx(p.side)}`, upper, neckBase, 2);
  for (const p of longParts('tail')) chainOf(p, `tail${p.index ?? ''}`, hip, doc.bones[hip] ? frames[hip].apply([0, 0]) : [0, 0], p.g.length > 1.5 * p.g.thickness ? 3 : 1);
  for (const role of ['hair', 'ear', 'wing', 'tail']) for (const p of byRole(role)) if (!owners.has(p)) own(p, owners.get(byRole(role).find((q) => owners.has(q)))?.[0] ?? headBone);

  // Arms and legs.
  const iks = [];
  const limb = (names, generic, side, parent, anchor) => {
    const [upperRole, lowerRole, endRole] = names;
    const pick = (role) => byRole(role, side);
    const chain = [pick(upperRole)[0], pick(lowerRole)[0], pick(endRole)[0]];
    // Generic "arm" / "leg" layers fill the missing upper and lower parts, nearest the body first.
    const gen = pick(generic).sort((a, b) => dist(a.g.c, anchor) - dist(b.g.c, anchor));
    const spares = [...gen];
    for (const k of [0, 1]) if (!chain[k] && spares.length) chain[k] = spares.shift();
    // One layer for the whole upper and lower limb: split it in two bones so it bends.
    const split = chain[0] && !chain[1] && chain[0] !== chain[2] ? chain[0] : null;
    const present = chain.filter(Boolean);
    if (!present.length) return;
    let prev = parent;
    let from = anchor;
    const made = [];
    const ownerOf = new Map();
    present.forEach((p, k) => {
      const e = ends(p.g, from);
      const next = present[k + 1];
      const nextNear = next ? ends(next.g, e.far).near : null;
      const start = k === 0 ? e.near : from;
      const end = nextNear ? lerp2(e.far, nextNear, 0.5) : add(e.far, mul(e.dir, Math.min(p.g.thickness * 0.25, p.g.length * 0.1)));
      const role = chain.indexOf(p);
      if (p === split) {
        const mid = lerp2(start, end, 0.5);
        const a = bone(`${upperRole}${sfx(side)}`, prev, start, mid);
        const b = bone(`${lowerRole}${sfx(side)}`, a, mid, end);
        made.push(a, b);
        ownerOf.set(p, meshes === 'none' ? [a] : [a, b]);
        prev = b;
      } else {
        const b = bone(`${names[role]}${sfx(side)}`, prev, start, end);
        made.push(b);
        ownerOf.set(p, [b]);
        prev = b;
      }
      from = end;
    });
    for (const [p, bones] of ownerOf) own(p, ...bones);
    // Alternate images of the same part (an open and a closed hand) share its bone.
    for (const role of [...names, generic]) for (const p of byRole(role, side)) if (!owners.has(p)) own(p, owners.get(chain.find((q) => q && q.role === role) ?? present.at(-1))?.at(-1) ?? made.at(-1));
    if (ik && made.length >= 2) {
      const [a, b] = made;
      const target = bone(`ik_${names[2]}${sfx(side)}`, 0, tips[b], add(tips[b], [Math.max(1, doc.bones[b].length * 0.2), 0]));
      // Bend the way the artwork bends. A straight limb bends its middle joint away from the body
      // (elbows out and down, knees out); the IK settings can flip it.
      const root = frames[a].apply([0, 0]);
      const d1 = sub(tips[a], root);
      const d2 = sub(tips[b], tips[a]);
      let cross = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(cross) < 0.05 * Math.hypot(...d1) * Math.hypot(...d2)) {
        const along = sub(tips[b], root);
        const outward = root[0] >= neckBase[0] ? 1 : -1;
        const prefer = generic === 'arm' ? [outward, -0.5] : [outward, 0];
        let w = [-along[1], along[0]];
        if (w[0] * prefer[0] + w[1] * prefer[1] < 0) w = mul(w, -1);
        // A joint pushed toward w gives a chain whose cross product has the sign of -(along x w).
        cross = -(along[0] * w[1] - along[1] * w[0]);
      }
      const bendPositive = cross > 0 === BEND_POSITIVE_IS_CCW;
      doc.ik.push({ name: doc.bones[target].name, order: doc.ik.length, skinRequired: false, bones: [a, b], target, mix: 1, softness: 0, bendPositive, compress: false, stretch: false, uniform: false });
      iks.push(doc.bones[target].name);
    }
  };
  for (const side of ['l', 'r', null]) {
    limb(ARM, 'arm', side, upper, chest ? lerp2(frames[chest].apply([0, 0]), neckBase, 0.85) : neckBase);
    limb(LEG, 'leg', side, hip, frames[hip].apply([0, 0]));
  }

  // Anything else rides on the bone nearest to it.
  const segs = doc.bones.map((_, i) => i).filter((i) => i > 0 && !doc.bones[i].name.startsWith('ik_'));
  for (const p of parts) {
    if (owners.has(p)) continue;
    let best = upper;
    let bestD = Infinity;
    for (const i of segs) {
      const d = segmentDistance(p.g.c, frames[i].apply([0, 0]), tips[i]);
      if (d < bestD) [best, bestD] = [i, d];
    }
    own(p, best);
  }

  // Attach the parts, keeping them where they are; bending parts become weighted meshes.
  const pose = new Pose(doc);
  const report = [];
  for (const p of parts) {
    const bones = owners.get(p);
    const slot = doc.slots[p.slot];
    const wantMesh = meshes === 'all' || (meshes === 'deforming' && bones.length > 1);
    let mesh = null;
    if (wantMesh) {
      const m = stripMesh(doc, pose, p, bones);
      for (const list of [slot.attachments]) {
        const i = list.indexOf(p.att);
        if (i >= 0) list[i] = m;
      }
      mesh = bones.length > 1 ? 'weighted' : 'mesh';
    } else {
      const world = pose.world[slot.bone].mul(toAffine(p.att.offset));
      const local = pose.world[bones[0]].inverse().mul(world).decompose();
      p.att.offset = { x: local.x, y: local.y, rotation: local.rotation, scale_x: local.scale_x, scale_y: local.scale_y, shear_x: 0, shear_y: local.shear_y ?? 0 };
    }
    // Other images in the slot (alternates) keep their place too.
    for (const other of slot.attachments) {
      if (other === p.att || other.type !== 'region' || (mesh && other.name === p.att.name)) continue;
      const world = pose.world[slot.bone].mul(toAffine(other.offset));
      const local = pose.world[bones[0]].inverse().mul(world).decompose();
      other.offset = { x: local.x, y: local.y, rotation: local.rotation, scale_x: local.scale_x, scale_y: local.scale_y, shear_x: 0, shear_y: local.shear_y ?? 0 };
    }
    slot.bone = bones[0];
    report.push({ name: p.name, role: p.role, side: p.side, from: p.from, bone: doc.bones[bones[0]].name, ...(bones.length > 1 ? { bones: bones.map((b) => doc.bones[b].name) } : {}), mesh });
  }
  const unknown = report.filter((r) => r.role === 'extra').map((r) => r.name);
  if (unknown.length) warnings.push(`Not identified, attached to the nearest bone: ${unknown.join(', ')}. Rename the layers (e.g. "arm_l", "head") or set their roles to rig them.`);
  const err = doc.validate();
  if (err) throw new Error(`AutoRig made an invalid rig: ${err}`);
  return { parts: report, bones: doc.bones.slice(1).map((b) => b.name), ik: iks, warnings };
}

function segmentDistance(p, a, b) {
  const d = sub(b, a);
  const len2 = d[0] * d[0] + d[1] * d[1];
  const t = len2 > 1e-9 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2)) : 0;
  return dist(p, add(a, mul(d, t)));
}

/**
 * A mesh that follows a part along its main axis: slices across the part give an outline that
 * hugs the opaque pixels, with a row of inner vertices, so the part bends smoothly at joints.
 * Weighted to `bones` when there are several, otherwise in the slot bone's space.
 */
function stripMesh(doc, pose, part, bones) {
  const { g, att } = part;
  const n = Math.max(bones.length > 1 ? 6 : 4, Math.min(12, Math.round((g.length / Math.max(1, g.thickness)) * 2) + 2));
  const lo = new Array(n).fill(null);
  const hi = new Array(n).fill(null);
  const span = g.length / (n - 1);
  for (const p of g.points) {
    const d = sub(p, g.c);
    const a = d[0] * g.u[0] + d[1] * g.u[1];
    const b = d[0] * g.v[0] + d[1] * g.v[1];
    const k = Math.min(n - 1, Math.max(0, Math.round((a - g.amin) / Math.max(1e-6, span))));
    if (lo[k] === null || b < lo[k]) lo[k] = b;
    if (hi[k] === null || b > hi[k]) hi[k] = b;
  }
  // Empty slices take their neighbours' extents.
  for (let pass = 0; pass < n; pass++) {
    for (let k = 0; k < n; k++) {
      if (lo[k] !== null) continue;
      const near = [k - 1, k + 1].find((j) => j >= 0 && j < n && lo[j] !== null);
      if (near !== undefined) [lo[k], hi[k]] = [lo[near], hi[near]];
    }
  }
  const pad = Math.max(1, g.thickness * 0.04);
  const at = (k, b) => {
    const a = k === 0 ? g.amin - pad : k === n - 1 ? g.amax + pad : g.amin + span * k;
    return add(g.c, add(mul(g.u, a), mul(g.v, b)));
  };
  const points = [];
  for (let k = 0; k < n; k++) points.push(at(k, (lo[k] ?? g.pmin) - pad));
  for (let k = n - 1; k >= 0; k--) points.push(at(k, (hi[k] ?? g.pmax) + pad));
  const hull = points.length;
  for (let k = 1; k < n - 1; k++) points.push(at(k, ((lo[k] ?? g.pmin) + (hi[k] ?? g.pmax)) / 2));
  // Vertices stay on the image, so texture coordinates map exactly (no stretched edges).
  const toPixel = g.toWorld.inverse();
  const uvs = [];
  points.forEach((p, i) => {
    const [x, y] = toPixel.apply(p);
    const px = Math.min(g.iw, Math.max(0, x));
    const py = Math.min(g.ih, Math.max(0, y));
    points[i] = g.toWorld.apply([px, py]);
    uvs.push(px / g.iw, py / g.ih);
  });
  const mesh = { name: att.name, type: 'mesh', image: att.image, uvs, triangles: triangulateMesh(points, hull), hull, width: att.width, height: att.height };
  if (att.color) mesh.color = att.color;
  if (bones.length > 1) {
    const segments = bones.map((bone) => ({ bone, from: pose.world[bone].apply([0, 0]), to: pose.world[bone].apply([doc.bones[bone].length, 0]) }));
    mesh.weights = autoWeights(points, segments).map((list, i) =>
      list.map(({ bone, weight }) => {
        const [x, y] = pose.world[bone].inverse().apply(points[i]);
        return { bone, x, y, weight };
      }),
    );
  } else {
    const inv = pose.world[bones[0]].inverse();
    mesh.vertices = points.flatMap((p) => inv.apply(p));
  }
  return mesh;
}
