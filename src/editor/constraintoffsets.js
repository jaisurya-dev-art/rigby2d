// SPDX-License-Identifier: MIT OR Apache-2.0
// Transform constraint offsets that keep a constrained bone where it is: used when a constraint is
// created (nothing jumps), when its driven bone is moved in Setup mode (the move sets the offset)
// and by "Offsets from current pose". No DOM: tested under Node.

import { listConstraints } from '../core/constraintdata.js';
import { compileConstraints, invalidateConstraints, targetValues } from '../core/constraints.js';
import { wrapDegrees } from '../core/math.js';
import { Pose } from '../core/pose.js';

const OFFSET_FIELD = { rotate: 'rotation', x: 'x', y: 'y', scaleX: 'scaleX', scaleY: 'scaleY', shearY: 'shearY' };
const MIX_FIELDS = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY', 'rotateMix', 'translateMix', 'scaleMix', 'shearMix'];
const DEG = 180 / Math.PI;
const angle = (x, y) => Math.atan2(y, x) * DEG;

/** The setup pose with transform constraint data `d` switched off (its mixes at 0 while evaluating). */
function poseWithout(doc, d) {
  const saved = MIX_FIELDS.map((k) => [k, d[k]]);
  for (const k of MIX_FIELDS) if (k.startsWith('mix') || d[k] !== undefined) d[k] = 0;
  invalidateConstraints(doc);
  const pose = new Pose(doc);
  for (const [k, v] of saved) {
    if (v === undefined) delete d[k];
    else d[k] = v;
  }
  invalidateConstraints(doc);
  return pose;
}

/** What the bone has before the constraint, as the constraint reads it (world or local values). */
function boneValues(pose, b, local) {
  if (local) {
    const t = pose.applied[b];
    return { rotate: t.rotation, x: t.x, y: t.y, scaleX: t.scale_x, scaleY: t.scale_y, shearY: t.shear_y ?? 0 };
  }
  const m = pose.world[b];
  const xAngle = angle(m.a, m.b);
  return { rotate: xAngle, x: m.tx, y: m.ty, scaleX: Math.hypot(m.a, m.b), scaleY: Math.hypot(m.c, m.d), shearY: wrapDegrees(angle(m.c, m.d) - xAngle - 90) };
}

/**
 * Sets the offsets of transform constraint data `d` (in `doc`) so that `bone` (by name; default its
 * first constrained bone) stays exactly where it is in the setup pose, whatever the mix. Offsets are
 * shared by all of a constraint's bones, so only that bone is kept. Returns false when the bone or
 * the source is missing.
 */
export function keepPoseOffsets(doc, d, bone = d.bones?.[0]) {
  const b = doc.bones.findIndex((x) => x.name === bone);
  const source = doc.bones.findIndex((x) => x.name === (d.source ?? d.target));
  if (b < 0 || source < 0 || b === source) return false;
  for (const f of Object.values(OFFSET_FIELD)) delete d[f];
  invalidateConstraints(doc);
  const pose = poseWithout(doc, d);
  const c = compileConstraints(doc).find((x) => x.name === d.name);
  if (!c) return false;
  const v0 = targetValues(pose, c);
  const have = boneValues(pose, b, c.localTarget);
  const want = c.additive ? { rotate: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, shearY: 0 } : have;
  const reflected = !c.localSource && pose.world[source].determinant() < 0;
  const off = {};
  // World x/y read from x/y go through the source bone: the offset is a point in its space.
  const point = (p) => !c.localSource && c.props.some((m) => (m.from === 'x' || m.from === 'y') && m.to.some((t) => t.prop === p));
  if (point('x') || point('y')) {
    const s = pose.world[source];
    const dx = v0.x === undefined ? 0 : want.x - v0.x;
    const dy = v0.y === undefined ? 0 : want.y - v0.y;
    [off.x, off.y] = s.inverse().apply([s.tx + dx, s.ty + dy]);
  }
  for (const p of Object.keys(OFFSET_FIELD)) {
    if (v0[p] === undefined || ((p === 'x' || p === 'y') && point(p))) continue;
    let delta = want[p] - v0[p];
    if (p === 'rotate' || p === 'shearY') delta = wrapDegrees(delta) * (reflected ? -1 : 1);
    off[p] = delta;
  }
  for (const [p, v] of Object.entries(off)) if (Math.abs(v) > 1e-6) d[OFFSET_FIELD[p]] = Math.round(v * 1e4) / 1e4;
  invalidateConstraints(doc);
  return true;
}

/** Transform constraints (data) in `doc` whose offsets keep `bone` (by name): it is their first bone. */
export function constraintsKeeping(doc, bone) {
  return listConstraints(doc)
    .filter((c) => c.type === 'transform' && c.data.bones?.[0] === bone && (c.data.source ?? c.data.target) !== bone)
    .map((c) => c.data);
}
