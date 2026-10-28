// SPDX-License-Identifier: MIT OR Apache-2.0
// Evaluated skeleton state: local and world transforms of every bone, slot state, mesh
// deformation, draw order and constraints (IK, transform and path).

import { keyIndexAt, sample, sampleComponent } from './animation.js';
import { ease } from './curve.js';
import {
  applyConstraintTimelines,
  compileConstraints,
  constraintActive,
  constraintSetupState,
  resetConstraintState,
  solvePath,
  solvePhysics,
  solveSlider,
  solveTransform,
} from './constraints.js';
import { Affine, cloneTransform, copyTransform, lerp, toAffine, wrapDegrees } from './math.js';
import { sequenceFrameName, sequenceIndexAt, sequenceSetupIndex } from './sequence.js';
import { vertexCount } from './model.js';

const DEG = Math.PI / 180;
const angleOf = (v) => Math.atan2(v[1], v[0]) / DEG;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
/** Scratch matrix for local transforms while computing world transforms. */
const LOCAL = new Affine();

/**
 * A mutable pose for a skeleton. Create it with `new Pose(skeleton)`, apply animations, then
 * call `updateWorld` before reading world transforms or vertices.
 *
 * `local` holds the animated local transforms; `applied` holds them after constraints and is
 * what `world` is computed from.
 */
export class Pose {
  constructor(sk) {
    this.applied = [];
    this.world = [];
    this.constraintList = null;
    /**
     * Physics simulation state by constraint name. It survives `reset`: keep the pose (or share
     * this map between poses) to simulate over time, and clear it with `resetPhysics`.
     */
    this.physics = new Map();
    /** Seconds of physics to simulate in the next `updateWorld` (0 = only apply offsets). */
    this.physicsDelta = 0;
    /**
     * Where the whole skeleton sits in a larger space (an Affine applied above its root bones), as
     * when a character is an actor in a scene; null = at the origin. Constraints and physics work in
     * the placed space, so an actor walking across a scene swings its hair.
     */
    this.placement = null;
    this.setToSetup(sk);
  }

  /** Resets everything to the setup pose and recomputes world transforms. */
  setToSetup(sk) {
    this.reset(sk);
    this.updateWorld(sk);
  }

  /**
   * Resets local state to the setup pose without computing world transforms (call
   * `updateWorld` after applying animations). Reuses this pose's storage.
   */
  reset(sk) {
    const bones = sk.bones;
    const slots = sk.slots;
    if (!this.local || this.local.length !== bones.length) {
      this.local = bones.map((b) => cloneTransform(b.setup));
      this.inherit = bones.map((b) => b.inherit ?? 'normal');
    } else {
      for (let i = 0; i < bones.length; i++) {
        copyTransform(bones[i].setup, this.local[i]);
        this.inherit[i] = bones[i].inherit ?? 'normal';
      }
    }
    if (!this.attachment || this.attachment.length !== slots.length) {
      this.attachment = slots.map((s) => s.attachment);
      this.color = slots.map((s) => s.color.slice());
      this.dark = slots.map((s) => (s.dark ? s.dark.slice() : null));
      this.drawOrder = slots.map((_, i) => i);
      this.sequence = slots.map(() => -1);
    } else {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        this.attachment[i] = s.attachment;
        this.sequence[i] = -1;
        const color = this.color[i];
        for (let k = 0; k < 4; k++) color[k] = s.color[k];
        if (s.dark) {
          const dark = this.dark[i] ?? (this.dark[i] = [0, 0, 0]);
          for (let k = 0; k < 3; k++) dark[k] = s.dark[k];
        } else {
          this.dark[i] = null;
        }
        this.drawOrder[i] = i;
      }
    }
    /** Deform deltas keyed by `${slot}/${attachment name}`. */
    if (this.deform) this.deform.clear();
    else this.deform = new Map();
    if (!this.ik || this.ik.length !== sk.ik.length) this.ik = sk.ik.map(() => ({}));
    sk.ik.forEach((c, i) => {
      const s = this.ik[i];
      s.mix = c.mix;
      s.softness = c.softness;
      s.bendPositive = c.bendPositive;
      s.compress = c.compress;
      s.stretch = c.stretch;
    });
    const list = this.ensureConstraints(sk);
    resetConstraintState(list, this.constraintState);
  }

  /** Transform and path constraints of `sk`, with their animated state reset when they change. */
  ensureConstraints(sk) {
    const list = compileConstraints(sk);
    if (list !== this.constraintList) {
      this.constraintList = list;
      this.constraintState = constraintSetupState(list);
    }
    return list;
  }

  /** Applies `anim` at `time` on top of the current pose, blended by `alpha` (1 = fully). */
  apply(sk, anim, time, alpha) {
    const hold = alpha >= 0.5;
    for (const t of anim.bones) {
      const bone = sk.bones[t.bone];
      if (!bone) continue;
      const setup = bone.setup;
      const L = this.local[t.bone];
      let { x, y, rotation, scale_x: sx, scale_y: sy, shear_x: hx, shear_y: hy } = L;
      const has = (keys) => keys !== undefined && keys.length > 0;
      if (has(t.rotate)) rotation = setup.rotation + sampleComponent(t.rotate, time, 0);
      if (has(t.translate)) {
        x = setup.x + sampleComponent(t.translate, time, 0);
        y = setup.y + sampleComponent(t.translate, time, 1);
      }
      if (has(t.translateX)) x = setup.x + sampleComponent(t.translateX, time, 0);
      if (has(t.translateY)) y = setup.y + sampleComponent(t.translateY, time, 0);
      if (has(t.scale)) {
        sx = setup.scale_x * sampleComponent(t.scale, time, 0);
        sy = setup.scale_y * sampleComponent(t.scale, time, 1);
      }
      if (has(t.scaleX)) sx = setup.scale_x * sampleComponent(t.scaleX, time, 0);
      if (has(t.scaleY)) sy = setup.scale_y * sampleComponent(t.scaleY, time, 0);
      if (has(t.shear)) {
        hx = (setup.shear_x ?? 0) + sampleComponent(t.shear, time, 0);
        hy = (setup.shear_y ?? 0) + sampleComponent(t.shear, time, 1);
      }
      if (has(t.shearX)) hx = (setup.shear_x ?? 0) + sampleComponent(t.shearX, time, 0);
      if (has(t.shearY)) hy = (setup.shear_y ?? 0) + sampleComponent(t.shearY, time, 0);
      if (hold && has(t.inherit)) this.inherit[t.bone] = sample(t.inherit, time);
      if (alpha >= 1) {
        L.x = x;
        L.y = y;
        L.rotation = rotation;
        L.scale_x = sx;
        L.scale_y = sy;
        L.shear_x = hx;
        L.shear_y = hy;
      } else {
        L.x = lerp(L.x, x, alpha);
        L.y = lerp(L.y, y, alpha);
        L.rotation = lerp(L.rotation, rotation, alpha);
        L.scale_x = lerp(L.scale_x, sx, alpha);
        L.scale_y = lerp(L.scale_y, sy, alpha);
        L.shear_x = lerp(L.shear_x ?? 0, hx ?? 0, alpha);
        L.shear_y = lerp(L.shear_y ?? 0, hy ?? 0, alpha);
      }
    }
    for (const t of anim.slots) {
      const i = t.slot;
      if (i >= this.attachment.length) continue;
      let s;
      if (hold && (s = sample(t.attachment, time)) !== undefined) this.attachment[i] = s;
      const color = this.color[i].slice();
      let dark = this.dark[i] ? this.dark[i].slice() : null;
      if ((s = sample(t.color, time)) !== undefined) color.splice(0, 4, ...s);
      if ((s = sample(t.rgb, time)) !== undefined) color.splice(0, 3, ...s);
      if ((s = sample(t.alpha, time)) !== undefined) color[3] = s;
      if ((s = sample(t.rgba2, time)) !== undefined) {
        color.splice(0, 4, ...s.slice(0, 4));
        dark = s.slice(4, 7);
      }
      if ((s = sample(t.rgb2, time)) !== undefined) {
        color.splice(0, 3, ...s.slice(0, 3));
        dark = s.slice(3, 6);
      }
      const current = this.color[i];
      for (let k = 0; k < 4; k++) current[k] = lerp(current[k], color[k], alpha);
      if (dark) this.dark[i] = (this.dark[i] ?? dark).map((c, k) => lerp(c, dark[k], alpha));
    }
    for (const t of anim.deform) {
      if (!t.keys.length) continue;
      const slot = sk.slots[t.slot];
      const att = slot && sk.attachment(t.slot, t.attachment, t.skin ?? sk.skin);
      if (!att) continue;
      const source = sk.meshSource(t.slot, att) ?? att;
      const deltas = sampleDeform(t.keys, time, deformLength(source));
      const key = `${t.slot}/${t.attachment}`;
      const prev = this.deform.get(key);
      this.deform.set(key, prev && alpha < 1 ? prev.map((p, j) => lerp(p, deltas[j], alpha)) : deltas);
    }
    // Sequence keys: the frame of the image sequence a slot's attachment shows.
    if (hold && anim.extra?.attachments) {
      for (const [skin, slots] of Object.entries(anim.extra.attachments)) {
        for (const [slotName, atts] of Object.entries(slots)) {
          const slot = sk.slots.findIndex((s) => s.name === slotName);
          if (slot < 0) continue;
          for (const [name, timelines] of Object.entries(atts)) {
            if (!Array.isArray(timelines.sequence) || this.attachment[slot] !== name) continue;
            const att = sk.attachment(slot, name, skin === 'default' ? null : skin) ?? sk.attachment(slot, name);
            if (!att?.sequence) continue;
            const index = sequenceIndexAt(timelines.sequence, time, att.sequence.count ?? 1);
            if (index !== null) this.sequence[slot] = index;
          }
        }
      }
    }
    if (hold && anim.drawOrder.length) {
      const i = keyIndexAt(anim.drawOrder, time);
      if (i >= 0) this.drawOrder = applyDrawOrder(sk.slots.length, anim.drawOrder[i].value);
    }
    applyConstraintTimelines(this.ensureConstraints(sk), this.constraintState, anim, time, alpha);
    for (const t of anim.ik) {
      const state = this.ik[t.constraint];
      if (!state) continue;
      const i = keyIndexAt(t.keys, time);
      if (i < 0) continue;
      const a = t.keys[i];
      const b = t.keys[i + 1];
      const frac = b && b.time > a.time && a.curve !== 'stepped' ? (time - a.time) / (b.time - a.time) : 0;
      const num = (field, def) => {
        const va = a.value[field] ?? def;
        const vb = b ? (b.value[field] ?? def) : va;
        return lerp(va, vb, frac);
      };
      state.mix = lerp(state.mix, num('mix', 1), alpha);
      state.softness = lerp(state.softness, num('softness', 0), alpha);
      if (hold) {
        state.bendPositive = a.value.bendPositive ?? true;
        state.compress = a.value.compress ?? false;
        state.stretch = a.value.stretch ?? false;
      }
    }
  }

  /** Recomputes world transforms from local transforms, then applies constraints in order. */
  updateWorld(sk) {
    const n = this.local.length;
    for (let i = 0; i < n; i++) this.applied[i] = this.applied[i] ? copyTransform(this.local[i], this.applied[i]) : cloneTransform(this.local[i]);
    this.applied.length = n;
    this.computeWorld(sk);
    const list = this.ensureConstraints(sk);
    const delta = this.physicsDelta;
    this.physicsDelta = 0;
    const steps = [...sk.ik.map((c, i) => ({ order: c.order, ik: i })), ...list.map((c, i) => ({ order: c.order, other: i }))];
    steps.sort((x, y) => x.order - y.order);
    for (const step of steps) {
      if (step.ik !== undefined) {
        const c = sk.ik[step.ik];
        if (c.skinRequired && !this.skinActive(sk, (skin) => skin.ik.includes(step.ik))) continue;
        this.solveIk(sk, c, this.ik[step.ik]);
        continue;
      }
      const c = list[step.other];
      if (!constraintActive(sk, c)) continue;
      const state = this.constraintState[step.other];
      let result;
      if (c.type === 'transform') result = solveTransform(this, c, state);
      else if (c.type === 'path') result = solvePath(sk, this, c, state);
      else if (c.type === 'slider') result = solveSlider(sk, this, c, state);
      else {
        let sim = this.physics.get(c.name);
        if (!sim) this.physics.set(c.name, (sim = {}));
        result = solvePhysics(sk, this, c, state, sim, delta);
      }
      if (result?.all) this.computeWorld(sk);
      else if (result?.world) this.setWorlds(sk, result.world);
      else if (result?.local) for (const b of result.local) this.updateBranch(sk, b);
    }
  }

  /** Clears physics so every simulated bone starts again from its animated pose. */
  resetPhysics() {
    this.physics.clear();
  }

  /**
   * Sets the world transforms of some bones (a map of bone -> Affine), updating their applied
   * local transforms to match and moving their descendants along.
   */
  setWorlds(sk, desired) {
    const dirty = this.dirtyFlags(sk);
    const bones = sk.bones;
    let first = bones.length;
    for (const b of desired.keys()) first = Math.min(first, b);
    for (let i = first; i < bones.length; i++) {
      const p = bones[i].parent;
      const want = desired.get(i);
      if (want) {
        this.applied[i] = p === null && this.placement ? localFromWorld(this.placement, want, 'normal') : localFromWorld(p === null ? null : this.world[p], want, this.inherit[i]);
        this.world[i] = want;
        dirty[i] = 1;
      } else if (p !== null && dirty[p]) {
        this.updateBone(sk, i);
        dirty[i] = 1;
      }
    }
  }

  /** Cleared per-bone flags, reused between calls. */
  dirtyFlags(sk) {
    const n = sk.bones.length;
    if (!this.dirty || this.dirty.length !== n) this.dirty = new Uint8Array(n);
    else this.dirty.fill(0);
    return this.dirty;
  }

  /** Recomputes the world transform of `root` and its descendants (parents precede children). */
  updateBranch(sk, root) {
    const dirty = this.dirtyFlags(sk);
    const bones = sk.bones;
    dirty[root] = 1;
    this.updateBone(sk, root);
    for (let i = root + 1; i < bones.length; i++) {
      const p = bones[i].parent;
      if (p !== null && dirty[p]) {
        dirty[i] = 1;
        this.updateBone(sk, i);
      }
    }
  }

  /** Recomputes one bone's world transform from its applied local transform, in place. */
  updateBone(sk, i) {
    const p = sk.bones[i].parent;
    const w = this.world[i] ?? (this.world[i] = new Affine());
    if (p === null) {
      if (this.placement) Affine.multiply(this.placement, toAffine(this.applied[i], LOCAL), w);
      else toAffine(this.applied[i], w);
    }
    else inheritWorld(this.world[p], toAffine(this.applied[i], LOCAL), this.inherit[i], w);
  }

  skinActive(sk, has) {
    const skin = sk.skin ? sk.findSkin(sk.skin) : null;
    return !!skin && has(skin);
  }

  computeWorld(sk) {
    this.world.length = sk.bones.length;
    for (let i = 0; i < sk.bones.length; i++) this.updateBone(sk, i);
  }

  /** Rotates (and optionally stretches) the constrained bones so the chain reaches the target. */
  solveIk(sk, c, state) {
    const mix = state.mix;
    if (mix <= 0 || !c.bones.length) return;
    const target = this.world[c.target].apply([0, 0]);
    const parentSign = (b) => {
      const p = sk.bones[b].parent;
      return p !== null && this.world[p].determinant() < 0 ? -1 : 1;
    };
    const aim = (b, from, tip) => {
      const delta = wrapDegrees(angleOf(sub(target, from)) - angleOf(sub(tip, from)));
      this.applied[b].rotation += delta * mix * parentSign(b);
    };
    if (c.bones.length === 1) {
      const b = c.bones[0];
      const w = this.world[b];
      const origin = w.apply([0, 0]);
      aim(b, origin, w.apply([1, 0]));
      const boneLen = sk.bones[b].length * len([w.a, w.b]);
      const dist = len(sub(target, origin));
      if (boneLen > 1e-4 && ((state.compress && dist < boneLen) || (state.stretch && dist > boneLen))) {
        const s = (dist / boneLen - 1) * mix + 1;
        this.applied[b].scale_x *= s;
        if (c.uniform) this.applied[b].scale_y *= s;
      }
      this.updateBranch(sk, b);
      return;
    }
    const [p, ch] = c.bones;
    let P = this.world[p].apply([0, 0]);
    let C = this.world[ch].apply([0, 0]);
    const tip = this.world[ch].apply([sk.bones[ch].length, 0]);
    const a = len(sub(C, P));
    const bLen = len(sub(tip, C));
    if (a < 1e-4 || bLen < 1e-4) {
      aim(p, P, C.some((v, k) => v !== P[k]) ? C : this.world[p].apply([1, 0]));
      this.updateBranch(sk, p);
      return;
    }
    let d = len(sub(target, P));
    if (state.stretch && d > a + bLen) {
      const s = (d / (a + bLen) - 1) * mix + 1;
      this.applied[p].scale_x *= s;
      if (c.uniform) this.applied[p].scale_y *= s;
      this.updateBranch(sk, p);
      P = this.world[p].apply([0, 0]);
      C = this.world[ch].apply([0, 0]);
      return this.finishTwoBone(sk, p, ch, target, mix, state, parentSign);
    }
    const soft = state.softness;
    if (soft > 0 && d > a + bLen - soft) d = a + bLen - soft * Math.exp(-(d - (a + bLen - soft)) / soft);
    d = Math.min(Math.max(d, Math.abs(a - bLen) + 1e-6), a + bLen - 1e-6);
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - bLen * bLen) / (2 * a * d)));
    const A = Math.acos(cosA) / DEG;
    // A mirrored chain bends the other way on screen.
    const bend = (state.bendPositive ? 1 : -1) * (this.world[p].determinant() < 0 ? -1 : 1);
    const desired = angleOf(sub(target, P)) - bend * A;
    const delta = wrapDegrees(desired - angleOf(sub(C, P)));
    this.applied[p].rotation += delta * mix * parentSign(p);
    this.updateBranch(sk, p);
    this.finishTwoBone(sk, p, ch, target, mix, state, parentSign);
  }

  finishTwoBone(sk, p, ch, target, mix, state, parentSign) {
    const C = this.world[ch].apply([0, 0]);
    const tip = this.world[ch].apply([Math.max(sk.bones[ch].length, 1e-3), 0]);
    const delta = wrapDegrees(angleOf(sub(target, C)) - angleOf(sub(tip, C)));
    this.applied[ch].rotation += delta * mix * parentSign(ch);
    this.updateBranch(sk, ch);
  }

  /** Image an attachment shows in a slot: its image, or the current frame of its sequence. */
  imageOf(slot, att) {
    if (!att.sequence) return att.image ?? att.name;
    const index = this.sequence?.[slot] ?? -1;
    return sequenceFrameName(att, index >= 0 ? index : sequenceSetupIndex(att));
  }

  /** World transform of a region or point attachment. */
  attachmentWorld(sk, slot, att) {
    return this.world[sk.slots[slot].bone].mul(toAffine(att.offset));
  }

  /** The attachment currently shown in a slot, resolved through the active skin. */
  slotAttachment(sk, slot) {
    return sk.attachment(slot, this.attachment[slot]);
  }

  /** World positions of a mesh-like attachment's vertices as a flat [x, y, ...] array. */
  worldVertices(sk, slot, att) {
    const source = sk.meshSource(slot, att);
    if (!source) return [];
    const deformKey = att.type === 'linkedmesh' && att.deform ? `${slot}/${att.parent}` : `${slot}/${att.name}`;
    const deform = this.deform.get(deformKey);
    const out = [];
    if (source.weights) {
      let k = 0;
      for (const v of source.weights) {
        let x = 0;
        let y = 0;
        for (const w of v) {
          const bx = w.x + (deform ? deform[k] : 0);
          const by = w.y + (deform ? deform[k + 1] : 0);
          k += 2;
          const m = this.world[w.bone];
          x += (m.a * bx + m.c * by + m.tx) * w.weight;
          y += (m.b * bx + m.d * by + m.ty) * w.weight;
        }
        out.push(x, y);
      }
    } else {
      const m = this.world[sk.slots[slot].bone];
      const verts = source.vertices ?? [];
      for (let i = 0; i + 1 < verts.length; i += 2) {
        const vx = verts[i] + (deform ? deform[i] : 0);
        const vy = verts[i + 1] + (deform ? deform[i + 1] : 0);
        out.push(m.a * vx + m.c * vy + m.tx, m.b * vx + m.d * vy + m.ty);
      }
    }
    return out;
  }

  /**
   * Visible drawables in draw order. Regions: { kind: 'region', slot, attachment, positions,
   * uvs, color, blend } with positions/UVs in TL, TR, BR, BL order. Meshes: { kind: 'mesh', ...,
   * positions (world vertex pairs), uvs (normalized, per vertex), triangles }.
   */
  quads(sk) {
    const out = [];
    for (const i of this.drawOrder) {
      const slot = sk.slots[i];
      if (!slot) continue;
      const att = this.slotAttachment(sk, i);
      if (!att) continue;
      const tint = this.color[i];
      const color = att.color ? tint.map((c, k) => c * att.color[k]) : tint;
      const blend = slot.blend ?? 'normal';
      if (att.type === 'region' || att.type === undefined) {
        const m = this.attachmentWorld(sk, i, att);
        const hw = att.width * 0.5;
        const hh = att.height * 0.5;
        out.push({
          kind: 'region',
          image: this.imageOf(i, att),
          slot: i,
          attachment: att,
          positions: [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map((p) => m.apply(p)),
          uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
          color,
          blend,
        });
      } else if (att.type === 'mesh' || att.type === 'linkedmesh') {
        const source = sk.meshSource(i, att);
        if (!source) continue;
        const flat = this.worldVertices(sk, i, att);
        const positions = [];
        for (let k = 0; k + 1 < flat.length; k += 2) positions.push([flat[k], flat[k + 1]]);
        out.push({ kind: 'mesh', slot: i, attachment: att, image: this.imageOf(i, att.type === 'linkedmesh' ? att : source), positions, uvs: uvPairs(source), triangles: source.triangles, color, blend });
      }
    }
    return out;
  }
}

/** Deform deltas at `time`: each key's sparse values expanded, interpolated along its curve. */
function sampleDeform(keys, time, n) {
  const expand = (k) => {
    const d = new Float64Array(n);
    const { offset = 0, vertices = [] } = k.value ?? {};
    for (let j = 0; j < vertices.length && offset + j < n; j++) d[offset + j] = vertices[j];
    return d;
  };
  const i = Math.max(0, keyIndexAt(keys, time));
  const a = keys[i];
  const b = keys[i + 1];
  const from = expand(a);
  if (!b || time <= a.time || a.curve === 'stepped') return from;
  const to = expand(b);
  const e = ease(a.curve, (time - a.time) / (b.time - a.time), 0);
  for (let j = 0; j < n; j++) from[j] += (to[j] - from[j]) * e;
  return from;
}

/** Number of floats a deform key covers for `att` (one x/y pair per vertex or per bone weight). */
function deformLength(att) {
  if (att.weights) return att.weights.reduce((n, v) => n + v.length * 2, 0);
  return (att.vertices?.length ?? vertexCount(att) * 2) | 0;
}

/** The local transform that gives world transform `world` under `parent` and inherit `mode`. */
function localFromWorld(parent, world, mode) {
  if (!parent) return world.decompose();
  // Translation always goes through the full parent transform; the linear part through the part
  // of the parent the inherit mode keeps.
  const [x, y] = parent.inverse().apply([world.tx, world.ty]);
  const keep = inheritWorld(parent, new Affine(), mode);
  keep.tx = 0;
  keep.ty = 0;
  const linear = keep.inverse().mul(new Affine(world.a, world.b, world.c, world.d, 0, 0));
  linear.tx = x;
  linear.ty = y;
  return linear.decompose();
}

const uvCache = new WeakMap();

/** A mesh's UVs as [u, v] pairs, cached per attachment (rebuilt if the UV array is replaced). */
function uvPairs(source) {
  const hit = uvCache.get(source);
  if (hit && hit.uvs === source.uvs) return hit.pairs;
  const pairs = [];
  for (let k = 0; k + 1 < source.uvs.length; k += 2) pairs.push([source.uvs[k], source.uvs[k + 1]]);
  uvCache.set(source, { uvs: source.uvs, pairs });
  return pairs;
}

/**
 * Child world transform for the given inherit mode, written into `out` (which may be `local`).
 * Translation always goes through the full parent transform; the linear part through the part
 * of the parent that the mode keeps.
 */
function inheritWorld(parent, local, mode, out = new Affine()) {
  if (mode === 'normal' || !mode) return Affine.multiply(parent, local, out);
  const tx = parent.a * local.tx + parent.c * local.ty + parent.tx;
  const ty = parent.b * local.tx + parent.d * local.ty + parent.ty;
  const sx = Math.hypot(parent.a, parent.b);
  const det = parent.determinant();
  let pa;
  let pb;
  let pc;
  let pd;
  switch (mode) {
    case 'onlyTranslation':
      [pa, pb, pc, pd] = [1, 0, 0, 1];
      break;
    case 'noRotationOrReflection':
      [pa, pb, pc, pd] = [sx, 0, 0, sx > 1e-12 ? Math.abs(det) / sx : 0];
      break;
    case 'noScale':
    case 'noScaleOrReflection': {
      const ux = sx > 1e-12 ? parent.a / sx : 1;
      const uy = sx > 1e-12 ? parent.b / sx : 0;
      const flip = mode === 'noScale' && det < 0 ? -1 : 1;
      [pa, pb, pc, pd] = [ux, uy, -uy * flip, ux * flip];
      break;
    }
    default:
      return Affine.multiply(parent, local, out);
  }
  return out.set(pa * local.a + pc * local.b, pb * local.a + pd * local.b, pa * local.c + pc * local.d, pb * local.c + pd * local.d, tx, ty);
}

/** Slot order for a draw order key: `offsets` move slots relative to their setup index. */
export function applyDrawOrder(count, offsets) {
  const identity = Array.from({ length: count }, (_, i) => i);
  if (!offsets || !offsets.length) return identity;
  const order = new Array(count).fill(-1);
  const unchanged = [];
  let original = 0;
  for (const { slot, offset } of [...offsets].sort((x, y) => x.slot - y.slot)) {
    if (slot >= count) continue;
    while (original < slot) unchanged.push(original++);
    const at = original + offset;
    if (at >= 0 && at < count && order[at] === -1) order[at] = original;
    else unchanged.push(original);
    original++;
  }
  while (original < count) unchanged.push(original++);
  for (let i = count - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop();
  return order;
}
