// SPDX-License-Identifier: MIT OR Apache-2.0
// Body part names: what a layer or bone name means ("L_UpperArm", "forearm.r", "Left Eye",
// "shoe_right") as a role and a side. AutoRig uses it to identify artwork layers; retargeting
// uses it to match bones between characters whose names differ.

/** Roles, most specific first (so "eyebrow" is a brow, not an eye, and "forearm" not an arm). */
export const ROLES = [
  ['pupil', ['pupil', 'pupils', 'iris']],
  ['brow', ['brow', 'brows', 'eyebrow', 'eyebrows']],
  ['eye', ['eye', 'eyes', 'eyeball', 'eyeballs', 'sclera', 'eyelid', 'eyelids', 'lid', 'lids']],
  ['mouth', ['mouth', 'lips', 'lip', 'teeth', 'tongue', 'smile']],
  ['nose', ['nose', 'snout', 'beak']],
  ['ear', ['ear', 'ears', 'earring', 'earrings']],
  ['jaw', ['jaw', 'chin']],
  ['hair', ['hair', 'bangs', 'fringe', 'ponytail', 'pigtail', 'braid', 'hat', 'cap', 'helmet', 'horn', 'horns', 'antenna']],
  ['neck', ['neck']],
  ['forearm', ['forearm', 'lowerarm', 'elbow']],
  ['upperarm', ['upperarm', 'bicep', 'biceps', 'shoulder', 'sleeve']],
  ['hand', ['hand', 'hands', 'fist', 'palm', 'glove', 'gloves', 'finger', 'fingers', 'thumb', 'claw', 'mitt', 'wrist']],
  ['thigh', ['thigh', 'thighs', 'upperleg']],
  ['shin', ['shin', 'shins', 'calf', 'calves', 'lowerleg', 'knee']],
  ['foot', ['foot', 'feet', 'shoe', 'shoes', 'boot', 'boots', 'toe', 'toes', 'paw', 'paws', 'ankle', 'heel']],
  ['arm', ['arm', 'arms']],
  ['leg', ['leg', 'legs']],
  ['tail', ['tail']],
  ['wing', ['wing', 'wings']],
  ['pelvis', ['pelvis', 'hip', 'hips', 'waist', 'pants', 'shorts', 'skirt', 'butt', 'belt', 'groin']],
  ['head', ['head', 'face', 'skull', 'blush', 'bindi', 'freckles']],
  ['torso', ['torso', 'body', 'chest', 'trunk', 'belly', 'abdomen', 'stomach', 'shirt', 'spine', 'ribs', 'jacket', 'coat', 'dress', 'top', 'upperbody']],
];

const ROLE_OF = new Map(ROLES.flatMap(([role, words]) => words.map((w) => [w, role])));
const LEFT = new Set(['l', 'left', 'lft', 'lt']);
const RIGHT = new Set(['r', 'right', 'rgt', 'rt']);
/** Words that never decide a role on their own. */
const NOISE = new Set(['copy', 'layer', 'group', 'the', 'of', 'and', 'front', 'back', 'base', 'main', 'part', 'img', 'image', 'art', 'char', 'character']);

/** Lower-case words of a name: camelCase, digits and separators split ("L_UpperArm2" -> l upper arm 2). */
export function words(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * What a name means: { role, side ('l', 'r' or null), index (a number in the name, or null) },
 * or null when no word names a body part.
 */
export function classify(name) {
  const w = words(name);
  let side = null;
  let index = null;
  const kept = [];
  for (const t of w) {
    if (LEFT.has(t)) side = 'l';
    else if (RIGHT.has(t)) side = 'r';
    else if (/^\d+$/.test(t)) index = Number(t);
    else if (!NOISE.has(t)) kept.push(t);
  }
  // Single words, and adjacent pairs written apart ("upper arm", "lower leg", "eye brow").
  const candidates = [...kept, ...kept.slice(1).map((t, i) => kept[i] + t)];
  const synonyms = { lowerarm: 'forearm', forearms: 'forearm', upperleg: 'thigh', lowerleg: 'shin', foreleg: 'shin', hindleg: 'thigh' };
  let best = null;
  for (const c of candidates) {
    const role = ROLE_OF.get(c) ?? ROLE_OF.get(synonyms[c]) ?? ROLE_OF.get(c.replace(/s$/, ''));
    if (!role) continue;
    const rank = ROLES.findIndex(([r]) => r === role);
    if (!best || rank < best.rank) best = { role, rank };
  }
  if (!best) return null;
  return { role: best.role, side, index };
}

/** Roles that come in left and right pairs. */
export const PAIRED = new Set(['eye', 'pupil', 'brow', 'ear', 'upperarm', 'forearm', 'hand', 'arm', 'thigh', 'shin', 'foot', 'leg', 'wing']);

const CONTROL = new Set(['ik', 'target', 'ctrl', 'control', 'goal', 'handle', 'pole']);

/**
 * A stable key for matching bones of different characters: role, side and index. Control bones
 * (IK targets) get their own keys, so 'ik_hand_l' never matches 'hand_l'.
 */
export function boneKey(name) {
  const c = classify(name);
  if (!c) return null;
  const control = words(name).some((t) => CONTROL.has(t)) ? 'control:' : '';
  return `${control}${c.role}${c.side ? `.${c.side}` : ''}${c.index !== null ? `#${c.index}` : ''}`;
}

/**
 * Name with case, separators and side words normalized, the side last ("Arm_Left", "arm.L" and
 * "L_arm" all give "arm l").
 */
export function normalizedName(name) {
  const w = words(name);
  const side = w.filter((t) => LEFT.has(t) || RIGHT.has(t)).map((t) => (LEFT.has(t) ? 'l' : 'r'));
  return [...w.filter((t) => !LEFT.has(t) && !RIGHT.has(t)), ...side].join(' ');
}
