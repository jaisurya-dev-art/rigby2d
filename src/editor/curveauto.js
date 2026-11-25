// SPDX-License-Identifier: MIT OR Apache-2.0
// "Auto smooth" curves (the dopesheet and graph's right-click menu): the curve between each key and
// the next is shaped from its neighbours so the motion flows through keys without overshooting
// them, like Blender's auto-clamped handles and Harmony's smooth keys. A key that is a peak or a
// valley (or the first or last) gets a flat tangent, so values never go past what was keyed. No DOM;
// tested under Node.

const n3 = (v) => Math.round(v * 1e6) / 1e6;

/** A key's numbers: one for rotation, [x, y] for translate/scale/shear. */
const components = (v) => (Array.isArray(v) ? v : typeof v === 'number' ? [v] : null);

/**
 * The tangent (value per second) of component `c` at key `i` of `keys`: the slope across its two
 * neighbours, or 0 at an end, a peak or a valley.
 */
function tangent(keys, i, c) {
  const prev = keys[i - 1];
  const next = keys[i + 1];
  if (!prev || !next) return 0;
  const a = components(prev.value)[c];
  const b = components(keys[i].value)[c];
  const z = components(next.value)[c];
  if ((b - a) * (z - b) <= 0) return 0; // a turn: hold flat, never overshoot
  return (z - a) / (next.time - prev.time);
}

/**
 * The curve for the segment from key `i` to key `i + 1`: a normalized bezier per component (one shared
 * one when there is a single component), its handles a third of the way in, along each key's
 * tangent, clamped to the segment so the value stays between the two keys.
 */
export function autoCurve(keys, i) {
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const v0 = components(k0?.value);
  const v1 = components(k1?.value);
  if (!k1 || !v0 || !v1 || v0.length !== v1.length) return 'linear';
  const dt = k1.time - k0.time;
  const beziers = v0.map((a, c) => {
    const dv = v1[c] - a;
    if (Math.abs(dv) < 1e-9 || dt <= 0) return [1 / 3, 0, 2 / 3, 1];
    const clamp = (y) => Math.min(1, Math.max(0, y));
    const y1 = clamp((tangent(keys, i, c) * dt) / 3 / dv);
    const y2 = clamp(1 - (tangent(keys, i + 1, c) * dt) / 3 / dv);
    return [n3(1 / 3), n3(y1), n3(2 / 3), n3(y2)];
  });
  return beziers.length === 1 ? { bezier: beziers[0] } : { beziers };
}

/**
 * Sets the auto-smooth curve on every key of `keys` (a track's sorted key list) that is in `selected`
 * (all of them when it isn't given). Keys without numbers (images, events) are left alone. Returns
 * how many changed.
 */
export function applyAutoCurves(keys, selected = null) {
  let n = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (selected && !selected.has(keys[i])) continue;
    if (!components(keys[i].value)) continue;
    keys[i].curve = autoCurve(keys, i);
    n++;
  }
  return n;
}
