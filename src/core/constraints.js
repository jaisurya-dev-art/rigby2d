// SPDX-License-Identifier: MIT OR Apache-2.0
// Transform, path and physics constraints: compiled from the constraint data kept in `sk.extra`
// (format 3.8, 4.2 and the 4.3 unified list), animated by the constraint timelines kept in
// `anim.extra`, and solved on a Pose's world transforms.

import { wrapDegrees } from './math.js';

const DEG = Math.PI / 180;
const EPSILON = 1e-5;
const PROPS = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
const OFFSET_FIELD = { rotate: 'rotation', x: 'x', y: 'y', scaleX: 'scaleX', scaleY: 'scaleY', shearY: 'shearY' };
const MIX_FIELD = { rotate: 'mixRotate', x: 'mixX', y: 'mixY', scaleX: 'mixScaleX', scaleY: 'mixScaleY', shearY: 'mixShearY' };

const cache = new WeakMap();

/**
 * Transform and path constraints of a skeleton in a solver-friendly form, cached until the
 * constraint data or bone/slot names change.
 */
export function compileConstraints(sk) {
  const hit = cache.get(sk);
  if (hit && sameSignature(hit.signature, sk)) return hit.list;
  const signature = constraintSignature(sk);
  const list = compile(sk);
  cache.set(sk, { signature, list });
  return list;
}

/**
 * Values whose change invalidates the compiled list (compared by identity). Renaming bones or
 * slots is not detected: editors call `invalidateConstraints` after changing a skeleton.
 */
function constraintSignature(sk) {
  const e = sk.extra ?? {};
  return [e.constraints, e.transform, e.path, sk.bones.length, sk.slots.length];
}

function sameSignature(sig, sk) {
  const e = sk.extra ?? {};
  return sig[0] === e.constraints && sig[1] === e.transform && sig[2] === e.path && sig[3] === sk.bones.length && sig[4] === sk.slots.length;
}

/** Drops the compiled constraints of `sk` so they are rebuilt on next use. */
export function invalidateConstraints(sk) {
  cache.delete(sk);
}

function compile(sk) {
  const boneIndex = new Map(sk.bones.map((b, i) => [b.name, i]));
  const slotIndex = new Map(sk.slots.map((s, i) => [s.name, i]));
  const entries = [];
  for (const e of sk.extra?.constraints ?? []) entries.push({ data: e.data, type: e.data.type, order: e.index });
  for (const type of ['transform', 'path', 'physics']) {
    (sk.extra?.[type] ?? []).forEach((data, i) => entries.push({ data, type, order: data.order ?? i }));
  }
  const out = [];
  for (const { data, type, order } of entries) {
    if (type === 'slider') {
      const animation = sk.animations.findIndex((a) => a.name === data.animation);
      const bone = data.bone === undefined ? null : boneIndex.get(data.bone);
      if (animation < 0 || bone === undefined) continue;
      out.push({
        name: data.name,
        order,
        skinRequired: !!data.skin,
        bones: bone === null ? [] : [bone],
        type,
        animation,
        bone,
        property: data.property ?? 'rotate',
        scale: data.scale ?? 1,
        offset: data.offset ?? 0,
        local: !!data.local,
        loop: !!data.loop,
        additive: !!data.additive,
        setup: { time: data.time ?? 0, mix: data.mix ?? 1 },
      });
      continue;
    }
    if (type === 'physics') {
      const bone = boneIndex.get(data.bone);
      if (bone === undefined) continue;
      out.push({ name: data.name, order, skinRequired: !!data.skin, bones: [bone], type, bone, ...physicsData(data) });
      continue;
    }
    const bones = (data.bones ?? []).map((n) => boneIndex.get(n));
    if (!bones.length || bones.some((b) => b === undefined)) continue;
    const base = { name: data.name, order, skinRequired: !!data.skin, bones };
    if (type === 'transform') {
      const source = boneIndex.get(data.source ?? data.target);
      if (source === undefined) continue;
      out.push({ ...base, type, source, ...transformData(data) });
    } else if (type === 'path') {
      const slot = slotIndex.get(data.slot ?? data.target);
      if (slot === undefined) continue;
      out.push({ ...base, type, slot, ...pathData(data) });
    }
  }
  return out;
}

/** Physics values keys can animate, per constraint or for every constraint flagged global. */
const PHYSICS_VALUES = ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'];

/** Physics settings with their defaults; `setup` holds the values keys can animate. */
function physicsData(d) {
  const globals = {};
  for (const key of PHYSICS_VALUES) globals[key] = !!d[`${key}Global`];
  return {
    weights: { x: d.x ?? 0, y: d.y ?? 0, rotate: d.rotate ?? 0, scaleX: d.scaleX ?? 0, shearX: d.shearX ?? 0 },
    limit: d.limit ?? 5000,
    fps: d.fps ?? 60,
    globals,
    setup: {
      inertia: d.inertia ?? 0.5,
      strength: d.strength ?? 100,
      damping: d.damping ?? 0.85,
      mass: d.mass ?? 1,
      wind: d.wind ?? 0,
      gravity: d.gravity ?? 0,
      mix: d.mix ?? 1,
    },
  };
}

function transformData(d) {
  const legacy = d.rotateMix !== undefined || d.translateMix !== undefined || d.scaleMix !== undefined || d.shearMix !== undefined;
  const offsets = {};
  for (const p of PROPS) offsets[p] = d[OFFSET_FIELD[p]] ?? 0;
  let mix;
  if (legacy) {
    const t = d.translateMix ?? 1;
    const s = d.scaleMix ?? 1;
    mix = { rotate: d.rotateMix ?? 1, x: t, y: t, scaleX: s, scaleY: s, shearY: d.shearMix ?? 1 };
  } else {
    const x = d.mixX ?? 1;
    const sx = d.mixScaleX ?? 1;
    mix = { rotate: d.mixRotate ?? 1, x, y: d.mixY ?? x, scaleX: sx, scaleY: d.mixScaleY ?? sx, shearY: d.mixShearY ?? 1 };
  }
  // 4.3 maps source properties to target properties; older formats map each property to itself.
  let props;
  if (d.properties) {
    props = Object.entries(d.properties)
      .filter(([from]) => PROPS.includes(from))
      .map(([from, p]) => ({
        from,
        offset: p.offset ?? 0,
        to: Object.entries(p.to ?? {})
          .filter(([to]) => PROPS.includes(to))
          .map(([to, t]) => ({ prop: to, offset: t.offset ?? 0, max: t.max ?? 1, scale: t.scale ?? 1 })),
      }));
  } else {
    props = PROPS.map((p) => ({ from: p, offset: 0, to: [{ prop: p, offset: 0, max: 1, scale: 1 }] }));
  }
  const local = !!d.local;
  return {
    offsets,
    mix,
    props,
    localSource: d.localSource ?? local,
    localTarget: d.localTarget ?? local,
    additive: !!(d.additive ?? d.relative),
    clamp: !!d.clamp,
  };
}

function pathData(d) {
  const legacy = d.rotateMix !== undefined || d.translateMix !== undefined;
  const x = legacy ? (d.translateMix ?? 1) : (d.mixX ?? 1);
  return {
    positionMode: d.positionMode ?? 'percent',
    spacingMode: d.spacingMode ?? 'length',
    rotateMode: d.rotateMode ?? 'tangent',
    offsetRotation: d.rotation ?? 0,
    setup: {
      position: d.position ?? 0,
      spacing: d.spacing ?? 0,
      mixRotate: legacy ? (d.rotateMix ?? 1) : (d.mixRotate ?? 1),
      mixX: x,
      mixY: legacy ? x : (d.mixY ?? x),
    },
  };
}

/** Animatable state of each compiled constraint, at its setup values. */
export function constraintSetupState(list) {
  return list.map((c) => (c.type === 'transform' ? { mix: { ...c.mix } } : { ...c.setup }));
}

/** Resets animatable constraint state to the setup values in place. */
export function resetConstraintState(list, states) {
  list.forEach((c, i) => {
    if (c.type === 'transform') Object.assign(states[i].mix, c.mix);
    else Object.assign(states[i], c.setup);
  });
}

/** Whether a skin-required constraint is active for the skeleton's current skin. */
export function constraintActive(sk, c) {
  if (!c.skinRequired) return true;
  const skin = sk.skin ? sk.findSkin(sk.skin) : null;
  if (!skin) return false;
  const e = skin.extra ?? {};
  return [e.constraints, e.transform, e.path, e.physics].some((names) => Array.isArray(names) && names.includes(c.name));
}

// ---- animation ---------------------------------------------------------------------------------

/** Applies the constraint timelines of `anim` at `time` to `states`, blended by `alpha`. */
export function applyConstraintTimelines(list, states, anim, time, alpha) {
  const extra = anim.extra ?? {};
  if (!extra.transform && !extra.path && !extra.physics && !extra.slider) return;
  list.forEach((c, i) => {
    const state = states[i];
    if (c.type === 'transform') {
      const keys = extra.transform?.[c.name];
      if (!Array.isArray(keys) || !keys.length) return;
      const legacy = keys.some((k) => k.rotateMix !== undefined || k.translateMix !== undefined || k.scaleMix !== undefined || k.shearMix !== undefined);
      const values = legacy
        ? sampleRaw(keys, time, (k) => {
            const t = k.translateMix ?? 1;
            const s = k.scaleMix ?? 1;
            return [k.rotateMix ?? 1, t, t, s, s, k.shearMix ?? 1];
          })
        : sampleRaw(keys, time, (k) => {
            const x = k.mixX ?? 1;
            const sx = k.mixScaleX ?? 1;
            return [k.mixRotate ?? 1, x, k.mixY ?? x, sx, k.mixScaleY ?? sx, k.mixShearY ?? 1];
          });
      PROPS.forEach((p, j) => (state.mix[p] += (values[j] - state.mix[p]) * alpha));
    } else if (c.type === 'slider') {
      const t = extra.slider?.[c.name];
      if (!t) return;
      for (const key of ['time', 'mix']) {
        if (!Array.isArray(t[key]) || !t[key].length) continue;
        const [v] = sampleRaw(t[key], time, (k) => [k.value ?? (key === 'mix' ? 1 : 0)]);
        state[key] += (v - state[key]) * alpha;
      }
    } else if (c.type === 'physics') {
      // Keys of this constraint, then skeleton-wide keys ("") for values flagged global.
      for (const [source, global] of [
        [extra.physics?.[c.name], false],
        [extra.physics?.[''], true],
      ]) {
        if (!source) continue;
        for (const key of PHYSICS_VALUES) {
          const keys = source[key];
          if (!Array.isArray(keys) || !keys.length || (global && !c.globals[key])) continue;
          const [v] = sampleRaw(keys, time, (k) => [k.value ?? 0]);
          state[key] += (v - state[key]) * alpha;
        }
      }
    } else if (c.type === 'path') {
      const t = extra.path?.[c.name];
      if (!t) return;
      if (t.position?.length) {
        const [v] = sampleRaw(t.position, time, (k) => [k.value ?? k.position ?? 0]);
        state.position += (v - state.position) * alpha;
      }
      if (t.spacing?.length) {
        const [v] = sampleRaw(t.spacing, time, (k) => [k.value ?? k.spacing ?? 0]);
        state.spacing += (v - state.spacing) * alpha;
      }
      if (t.mix?.length) {
        const [r, x, y] = sampleRaw(t.mix, time, (k) =>
          k.rotateMix !== undefined || k.translateMix !== undefined
            ? [k.rotateMix ?? 1, k.translateMix ?? 1, k.translateMix ?? 1]
            : [k.mixRotate ?? 1, k.mixX ?? 1, k.mixY ?? k.mixX ?? 1],
        );
        state.mixRotate += (r - state.mixRotate) * alpha;
        state.mixX += (x - state.mixX) * alpha;
        state.mixY += (y - state.mixY) * alpha;
      }
    }
  });
}

/**
 * Samples raw keys (as stored in the file) at `time`. `read(key)` returns the key's values.
 * Curves: "stepped", 4.x absolute control points (4 per value), or 3.8 normalized control points.
 */
export function sampleRaw(keys, time, read) {
  if (time < (keys[0].time ?? 0)) return read(keys[0]);
  let i = 0;
  while (i + 1 < keys.length && (keys[i + 1].time ?? 0) <= time) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const va = read(a);
  if (!b || a.curve === 'stepped') return va;
  const vb = read(b);
  const t0 = a.time ?? 0;
  const t1 = b.time ?? 0;
  if (t1 <= t0) return vb;
  const c = a.curve;
  return va.map((v0, j) => {
    const v1 = vb[j];
    if (Array.isArray(c) && c.length >= 4 * (j + 1) && c.length >= 4 * va.length) {
      return bezierAt(t0, v0, c[4 * j], c[4 * j + 1], c[4 * j + 2], c[4 * j + 3], t1, v1, time);
    }
    let u = (time - t0) / (t1 - t0);
    if (typeof c === 'number') u = normalizedBezier(c, a.c2 ?? 0, a.c3 ?? 1, a.c4 ?? 1, u);
    else if (Array.isArray(c) && c.length === 4) u = normalizedBezier(c[0], c[1], c[2], c[3], u);
    return v0 + (v1 - v0) * u;
  });
}

function cubic(p0, p1, p2, p3, s) {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

/** Value of an absolute bezier segment from (x0, y0) to (x3, y3) at x. */
function bezierAt(x0, y0, x1, y1, x2, y2, x3, y3, x) {
  let lo = 0;
  let hi = 1;
  let s = (x - x0) / (x3 - x0);
  for (let k = 0; k < 40; k++) {
    const v = cubic(x0, x1, x2, x3, s);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return cubic(y0, y1, y2, y3, s);
}

function normalizedBezier(x1, y1, x2, y2, x) {
  return bezierAt(0, 0, x1, y1, x2, y2, 1, 1, x);
}

// ---- solving -----------------------------------------------------------------------------------

/** Rotates the linear part of `m` by `deg` degrees. */
function rotateLinear(m, deg) {
  if (!deg) return;
  const cos = Math.cos(deg * DEG);
  const sin = Math.sin(deg * DEG);
  const { a, b, c, d } = m;
  m.a = cos * a - sin * b;
  m.b = sin * a + cos * b;
  m.c = cos * c - sin * d;
  m.d = sin * c + cos * d;
}

const axisAngle = (x, y) => Math.atan2(y, x) / DEG;

/** Source property values of a transform constraint (world or local). */
function sourceValues(pose, c) {
  if (c.localSource) {
    const t = pose.applied[c.source];
    return { rotate: t.rotation, x: t.x, y: t.y, scaleX: t.scale_x, scaleY: t.scale_y, shearY: t.shear_y ?? 0 };
  }
  const s = pose.world[c.source];
  const [x, y] = s.apply([c.offsets.x, c.offsets.y]);
  const xAngle = axisAngle(s.a, s.b);
  return {
    rotate: xAngle,
    x,
    y,
    scaleX: Math.hypot(s.a, s.b),
    scaleY: Math.hypot(s.c, s.d),
    shearY: wrapDegrees(axisAngle(s.c, s.d) - xAngle - 90),
  };
}

/** Target property values after the property mapping and offsets. */
function targetValues(pose, c) {
  const src = sourceValues(pose, c);
  const reflected = !c.localSource && pose.world[c.source].determinant() < 0;
  const out = {};
  for (const p of c.props) {
    const from = src[p.from] - p.offset;
    for (const t of p.to) {
      let v = from * t.scale + t.offset;
      if (c.clamp) v = Math.min(Math.max(v, Math.min(t.offset, t.max)), Math.max(t.offset, t.max));
      // World x/y offsets are already applied through the source bone.
      const pointOffset = !c.localSource && (t.prop === 'x' || t.prop === 'y') && (p.from === 'x' || p.from === 'y');
      let off = pointOffset ? 0 : c.offsets[t.prop];
      if (reflected && (t.prop === 'rotate' || t.prop === 'shearY')) off = -off;
      out[t.prop] = (out[t.prop] ?? 0) + v + off;
    }
  }
  return out;
}

/** Solves a transform constraint. Returns desired world matrices (world target) or null. */
export function solveTransform(pose, c, state) {
  const mix = state.mix;
  if (!PROPS.some((p) => mix[p] !== 0)) return null;
  const v = targetValues(pose, c);
  if (c.localTarget) {
    for (const b of c.bones) {
      const t = pose.applied[b];
      const m = (p) => (v[p] === undefined ? 0 : mix[p]);
      if (c.additive) {
        if (m('rotate')) t.rotation += v.rotate * mix.rotate;
        if (m('x')) t.x += v.x * mix.x;
        if (m('y')) t.y += v.y * mix.y;
        if (m('scaleX')) t.scale_x *= (v.scaleX - 1) * mix.scaleX + 1;
        if (m('scaleY')) t.scale_y *= (v.scaleY - 1) * mix.scaleY + 1;
        if (m('shearY')) t.shear_y = (t.shear_y ?? 0) + v.shearY * mix.shearY;
      } else {
        if (m('rotate')) t.rotation += wrapDegrees(v.rotate - t.rotation) * mix.rotate;
        if (m('x')) t.x += (v.x - t.x) * mix.x;
        if (m('y')) t.y += (v.y - t.y) * mix.y;
        if (m('scaleX')) t.scale_x += (v.scaleX - t.scale_x) * mix.scaleX;
        if (m('scaleY')) t.scale_y += (v.scaleY - t.scale_y) * mix.scaleY;
        if (m('shearY')) t.shear_y = (t.shear_y ?? 0) + wrapDegrees(v.shearY - (t.shear_y ?? 0)) * mix.shearY;
      }
    }
    return { local: c.bones };
  }
  const desired = new Map();
  for (const b of c.bones) {
    const m = pose.world[b].clone();
    if (v.rotate !== undefined && mix.rotate) {
      const r = c.additive ? v.rotate : wrapDegrees(v.rotate - axisAngle(m.a, m.b));
      rotateLinear(m, r * mix.rotate);
    }
    if (v.x !== undefined && mix.x) m.tx += c.additive ? v.x * mix.x : (v.x - m.tx) * mix.x;
    if (v.y !== undefined && mix.y) m.ty += c.additive ? v.y * mix.y : (v.y - m.ty) * mix.y;
    const scaleAxis = (value, mixValue, ax, ay) => {
      const s = Math.hypot(m[ax], m[ay]);
      if (s < EPSILON) return;
      const f = c.additive ? (value - 1) * mixValue + 1 : (s + (value - s) * mixValue) / s;
      m[ax] *= f;
      m[ay] *= f;
    };
    if (v.scaleX !== undefined && mix.scaleX) scaleAxis(v.scaleX, mix.scaleX, 'a', 'b');
    if (v.scaleY !== undefined && mix.scaleY) scaleAxis(v.scaleY, mix.scaleY, 'c', 'd');
    if (v.shearY !== undefined && mix.shearY) {
      const xAngle = axisAngle(m.a, m.b);
      const gap = wrapDegrees(axisAngle(m.c, m.d) - xAngle);
      const want = c.additive ? gap + v.shearY * mix.shearY : gap + wrapDegrees(90 + v.shearY - gap) * mix.shearY;
      const len = Math.hypot(m.c, m.d);
      m.c = Math.cos((xAngle + want) * DEG) * len;
      m.d = Math.sin((xAngle + want) * DEG) * len;
    }
    desired.set(b, m);
  }
  return { world: desired };
}

/** Solves a path constraint. Returns desired world matrices, or null when it has no effect. */
export function solvePath(sk, pose, c, state) {
  const { mixRotate, mixX, mixY } = state;
  if (mixRotate === 0 && mixX === 0 && mixY === 0) return null;
  const att = pose.slotAttachment(sk, c.slot);
  if (!att || att.type !== 'path') return null;
  const verts = pose.worldVertices(sk, c.slot, att);
  const path = buildPath(verts, att);
  if (!path) return null;

  const n = c.bones.length;
  const tangents = c.rotateMode === 'tangent';
  const chainScale = c.rotateMode === 'chainScale';
  const count = tangents ? n : n + 1;
  const lengths = c.bones.map((b) => sk.bones[b].length * Math.hypot(pose.world[b].a, pose.world[b].b));
  const spaces = new Array(count).fill(0);
  const percentSpacing = c.spacingMode === 'percent';
  for (let i = 0; i < count - 1; i++) {
    const len = lengths[i];
    switch (c.spacingMode) {
      case 'percent':
      case 'fixed':
        spaces[i + 1] = state.spacing;
        break;
      case 'proportional':
        spaces[i + 1] = len;
        break;
      default: // length
        spaces[i + 1] = len < EPSILON ? 0 : len + state.spacing;
    }
  }
  if (c.spacingMode === 'proportional') {
    const sum = spaces.reduce((s, v) => s + v, 0);
    if (sum > EPSILON) for (let i = 1; i < count; i++) spaces[i] *= (path.length * (1 - Math.min(1, state.spacing))) / sum;
  }
  let position = state.position;
  if (c.positionMode === 'percent') position *= path.length;
  const points = [];
  let p = position;
  for (let i = 0; i < count; i++) {
    p += percentSpacing ? spaces[i] * path.length : spaces[i];
    points.push(path.at(p));
  }

  const desired = new Map();
  const reflect = (m) => (m.determinant() < 0 ? -1 : 1);
  for (let i = 0; i < n; i++) {
    const b = c.bones[i];
    const m = pose.world[b].clone();
    const [x, y, angle] = points[i];
    m.tx += (x - m.tx) * mixX;
    m.ty += (y - m.ty) * mixY;
    if (mixRotate > 0) {
      let r;
      if (tangents) {
        r = angle;
      } else {
        const [nx, ny] = points[i + 1];
        const dx = nx - m.tx;
        const dy = ny - m.ty;
        if (chainScale && lengths[i] >= EPSILON) {
          const s = (Math.hypot(dx, dy) / lengths[i] - 1) * mixRotate + 1;
          m.a *= s;
          m.b *= s;
        }
        r = Math.hypot(dx, dy) > EPSILON ? axisAngle(dx, dy) : angle;
      }
      r = wrapDegrees(r - axisAngle(m.a, m.b) + c.offsetRotation * reflect(m));
      rotateLinear(m, r * mixRotate);
    }
    desired.set(b, m);
  }
  return { world: desired };
}

/**
 * A path from world vertices laid out as [in-handle, point, out-handle] per path point. Returns
 * { length, at(distance) -> [x, y, tangent degrees] }.
 */
function buildPath(v, att) {
  const pointCount = Math.floor(v.length / 6);
  if (pointCount < 2 && !(att.closed && pointCount >= 1)) return null;
  const curves = [];
  const curveCount = att.closed ? pointCount : pointCount - 1;
  for (let i = 0; i < curveCount; i++) {
    const o = 6 * i;
    const next = att.closed && i === pointCount - 1 ? 0 : o + 6;
    curves.push([v[o + 2], v[o + 3], v[o + 4], v[o + 5], v[next], v[next + 1], v[next + 2], v[next + 3]]);
  }
  const SEGMENTS = 16;
  // Cumulative arc length table per curve (constant speed) or the stored lengths.
  const tables = curves.map((cv) => {
    const t = [0];
    let [px, py] = [cv[0], cv[1]];
    for (let s = 1; s <= SEGMENTS; s++) {
      const u = s / SEGMENTS;
      const x = cubic(cv[0], cv[2], cv[4], cv[6], u);
      const y = cubic(cv[1], cv[3], cv[5], cv[7], u);
      t.push(t[s - 1] + Math.hypot(x - px, y - py));
      [px, py] = [x, y];
    }
    return t;
  });
  const ends = [];
  if (att.constantSpeed || !att.lengths?.length) {
    let sum = 0;
    for (const t of tables) ends.push((sum += t[SEGMENTS]));
  } else {
    for (let i = 0; i < curveCount; i++) ends.push(att.lengths[i] ?? ends[i - 1] ?? 0);
  }
  const length = ends[ends.length - 1] ?? 0;
  if (length < EPSILON) return null;

  const evaluate = (i, u) => {
    const cv = curves[i];
    const x = cubic(cv[0], cv[2], cv[4], cv[6], u);
    const y = cubic(cv[1], cv[3], cv[5], cv[7], u);
    // Derivative for the tangent.
    const d = (p0, p1, p2, p3) => 3 * (1 - u) * (1 - u) * (p1 - p0) + 6 * (1 - u) * u * (p2 - p1) + 3 * u * u * (p3 - p2);
    let dx = d(cv[0], cv[2], cv[4], cv[6]);
    let dy = d(cv[1], cv[3], cv[5], cv[7]);
    if (Math.hypot(dx, dy) < EPSILON) [dx, dy] = [cv[6] - cv[0], cv[7] - cv[1]];
    return [x, y, axisAngle(dx, dy)];
  };

  const at = (dist) => {
    if (att.closed) {
      dist %= length;
      if (dist < 0) dist += length;
    } else if (dist < 0) {
      const cv = curves[0];
      const ang = axisAngle(cv[2] - cv[0], cv[3] - cv[1]);
      return [cv[0] + Math.cos(ang * DEG) * dist, cv[1] + Math.sin(ang * DEG) * dist, ang];
    } else if (dist > length) {
      const cv = curves[curves.length - 1];
      const ang = axisAngle(cv[6] - cv[4], cv[7] - cv[5]);
      const over = dist - length;
      return [cv[6] + Math.cos(ang * DEG) * over, cv[7] + Math.sin(ang * DEG) * over, ang];
    }
    let i = 0;
    while (i < ends.length - 1 && dist > ends[i]) i++;
    const start = i > 0 ? ends[i - 1] : 0;
    const span = ends[i] - start;
    const f = span > EPSILON ? (dist - start) / span : 0;
    if (!(att.constantSpeed || !att.lengths?.length)) return evaluate(i, f);
    // Constant speed: invert the arc length table.
    const t = tables[i];
    const target = f * t[SEGMENTS];
    let s = 1;
    while (s < SEGMENTS && t[s] < target) s++;
    const segLen = t[s] - t[s - 1];
    const u = (s - 1 + (segLen > EPSILON ? (target - t[s - 1]) / segLen : 0)) / SEGMENTS;
    return evaluate(i, u);
  };
  return { length, at };
}

// ---- physics -----------------------------------------------------------------------------------

/** Wind and gravity values are scaled by this to accelerations in skeleton units per second². */
const FORCE_SCALE = 100;
/** Tip distance used for rotation, scale and shear of bones without a length. */
const MIN_TIP = 10;

/**
 * Simulates a physics constraint. The bone's origin and tip each follow the animated pose through
 * a damped spring: when the animated bone moves, `inertia` of the movement is left behind as an
 * offset that `strength` pulls back, with `damping` as the velocity kept per 1/60 s, `limit`
 * as the top speed and wind (+X) and gravity (-Y) as constant forces. The origin offset moves
 * the bone (x, y weights); the tip offset rotates it (rotate), stretches it (scaleX) and tilts
 * its X axis (shearX). `sim` is the persistent state; `delta` the seconds to simulate (0 =
 * only apply the current offsets).
 */
export function solvePhysics(sk, pose, c, state, sim, delta) {
  const w = c.weights;
  const mix = state.mix;
  const m = pose.world[c.bone];
  // A placed skeleton (a scene actor) simulates in its own units, so a character shown at half size
  // swings like it does at full size: positions are divided by the placement's scale going in and
  // the result multiplied by it coming out. Unplaced skeletons are unchanged (ps = 1).
  const ps = pose.placement ? Math.sqrt(Math.abs(pose.placement.determinant())) || 1 : 1;
  const axis = Math.hypot(m.a, m.b) || 1;
  const len = Math.max(MIN_TIP, (sk.bones[c.bone].length * axis) / ps);
  const origin = [m.tx / ps, m.ty / ps];
  const tip = [origin[0] + (m.a / axis) * len, origin[1] + (m.b / axis) * len];
  if (!sim.ready) {
    Object.assign(sim, { ready: true, rest: 0, o: [0, 0], ov: [0, 0], t: [0, 0], tv: [0, 0], lastOrigin: origin, lastTip: tip });
  }
  if (delta > 0) {
    const step = 1 / Math.max(1, c.fps);
    sim.rest += delta;
    let steps = Math.floor(sim.rest / step);
    sim.rest -= steps * step;
    steps = Math.min(steps, Math.max(1, c.fps)); // at most one second of catching up
    if (steps > 0) {
      // Inertia: part of the animated movement since the last update is left behind.
      for (let k = 0; k < 2; k++) {
        sim.o[k] -= (origin[k] - sim.lastOrigin[k]) * state.inertia;
        sim.t[k] -= (tip[k] - sim.lastTip[k]) * state.inertia;
      }
      const massInv = state.mass > 0 ? 1 / state.mass : 1;
      const keep = Math.pow(Math.min(1, Math.max(0, state.damping)), 60 * step);
      const force = [state.wind * FORCE_SCALE, -state.gravity * FORCE_SCALE];
      for (let n = 0; n < steps; n++) {
        for (const [p, v] of [
          [sim.o, sim.ov],
          [sim.t, sim.tv],
        ]) {
          for (let k = 0; k < 2; k++) v[k] = (v[k] + (force[k] - state.strength * p[k]) * massInv * step) * keep;
          const speed = Math.hypot(v[0], v[1]);
          if (speed > c.limit) {
            v[0] *= c.limit / speed;
            v[1] *= c.limit / speed;
          }
          p[0] += v[0] * step;
          p[1] += v[1] * step;
        }
      }
      sim.lastOrigin = origin;
      sim.lastTip = tip;
    }
  }
  if (mix === 0) return null;
  const out = m.clone();
  out.tx += sim.o[0] * w.x * mix * ps;
  out.ty += sim.o[1] * w.y * mix * ps;
  if (w.rotate || w.scaleX || w.shearX) {
    const from = [tip[0] - origin[0], tip[1] - origin[1]];
    const to = [from[0] + sim.t[0], from[1] + sim.t[1]];
    const angle = wrapDegrees(axisAngle(to[0], to[1]) - axisAngle(from[0], from[1]));
    rotateLinear(out, angle * w.rotate * mix);
    if (w.shearX) {
      // Tilt only the X axis.
      const r = angle * w.shearX * mix * DEG;
      const [a, b] = [out.a, out.b];
      out.a = a * Math.cos(r) - b * Math.sin(r);
      out.b = a * Math.sin(r) + b * Math.cos(r);
    }
    if (w.scaleX) {
      const f = (Math.hypot(to[0], to[1]) / len - 1) * w.scaleX * mix + 1;
      out.a *= f;
      out.b *= f;
    }
  }
  return { world: new Map([[c.bone, out]]) };
}

// ---- slider --------------------------------------------------------------------------------------

/**
 * Slider constraint: poses the skeleton with an animation whose time comes from a bone property
 * (value x scale + offset; the bone's local value when `local`) or, without a bone, from the
 * constraint's own time. The animation is applied over the current pose with the constraint's mix.
 */
export function solveSlider(sk, pose, c, state) {
  const anim = sk.animations[c.animation];
  if (!anim || state.mix <= 0) return null;
  let time = state.time;
  if (c.bone !== null) {
    const value = c.local ? localProperty(pose.applied[c.bone], c.property) : worldProperty(pose.world[c.bone], c.property);
    time = value * c.scale + c.offset;
  }
  const d = anim.duration;
  if (d > 0) time = c.loop ? ((time % d) + d) % d : Math.min(d, Math.max(0, time));
  // Apply onto the constrained (applied) transforms, then recompute world transforms.
  const local = pose.local;
  pose.local = pose.applied;
  try {
    pose.apply(sk, anim, time, Math.min(1, state.mix));
  } finally {
    pose.local = local;
  }
  return { all: true };
}

function localProperty(t, property) {
  switch (property) {
    case 'x':
      return t.x;
    case 'y':
      return t.y;
    case 'scaleX':
      return t.scale_x;
    case 'scaleY':
      return t.scale_y;
    case 'shearY':
      return t.shear_y ?? 0;
    default:
      return t.rotation;
  }
}

function worldProperty(m, property) {
  switch (property) {
    case 'x':
      return m.tx;
    case 'y':
      return m.ty;
    case 'scaleX':
      return Math.hypot(m.a, m.b);
    case 'scaleY':
      return Math.hypot(m.c, m.d);
    case 'shearY':
      return wrapDegrees(axisAngle(m.c, m.d) - axisAngle(m.a, m.b) - 90);
    default:
      return axisAngle(m.a, m.b);
  }
}
