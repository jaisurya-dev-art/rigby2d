// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP constraint tools: add IK, transform, path, physics and slider constraints, change their
// settings, and delete them. Built on the same helpers as the editor's constraint panel
// (core/constraintdata.js), so a constraint made here is the one the editor would make. Settings
// use skeleton JSON 4.3 spelling. Returned as edit tools (createEditTools), so batch_edit takes them.

import { addConstraint, addIk, constraintNameTaken, listConstraints, removeConstraint, renameConstraint } from '../core/constraintdata.js';
import { invalidateConstraints } from '../core/constraints.js';
import { keepPoseOffsets } from '../editor/constraintoffsets.js';
import { ToolError } from './protocol.js';

const TYPES = ['ik', 'transform', 'path', 'physics', 'slider'];
const TRANSFORM_PROPERTIES = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
/** IK settings the model stores, and their skeleton JSON names. */
const IK_FIELDS = ['mix', 'softness', 'bendPositive', 'compress', 'stretch', 'uniform', 'skinRequired'];

const boneOf = (doc, name) => {
  const i = doc.bones.findIndex((b) => b.name === name);
  if (i < 0) throw new ToolError(`No bone '${name}'.`);
  return i;
};
const slotOf = (doc, name) => {
  if (!doc.slots.some((s) => s.name === name)) throw new ToolError(`No slot '${name}'.`);
  return name;
};
const findConstraint = (doc, name) => listConstraints(doc).find((c) => c.name === name) ?? fail(`No constraint '${name}'. Constraints: ${listConstraints(doc).map((c) => c.name).join(', ') || 'none'}.`);

function fail(message) {
  throw new ToolError(message);
}

/** Applies skeleton-JSON settings to an IK constraint (model fields). */
function setIk(doc, ik, settings) {
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'bendPositive' || k === 'compress' || k === 'stretch' || k === 'uniform' || k === 'skinRequired') ik[k] = !!v;
    else if (k === 'mix' || k === 'softness') {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(`IK '${k}' must be a number.`);
      ik[k] = v;
    } else if (k === 'target') ik.target = boneOf(doc, v);
    else fail(`IK constraints have no setting '${k}'. Settings: ${IK_FIELDS.join(', ')}, target.`);
  }
}

/** Applies settings to a transform, path, physics or slider constraint (JSON data), checking names it refers to. */
function setData(doc, data, settings) {
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'type' || k === 'name') fail(`'${k}' cannot be changed here${k === 'name' ? ': use the rename argument' : ''}.`);
    if (v === null) delete data[k];
    else data[k] = v;
  }
  if (data.source !== undefined) boneOf(doc, data.source);
  if (data.bone !== undefined) boneOf(doc, data.bone);
  for (const b of data.bones ?? []) boneOf(doc, b);
  if (data.type === 'path' && data.slot !== undefined) slotOf(doc, data.slot);
  if (data.type === 'slider' && data.animation !== undefined && !doc.animations.some((a) => a.name === data.animation)) fail(`No animation '${data.animation}'.`);
}

const SETTINGS = {
  type: 'object',
  description:
    'Settings in skeleton JSON 4.3 spelling. IK: mix, softness, bendPositive, compress, stretch, uniform. Transform: properties ({ from: { offset, to: { to: { offset, max, scale } } } }), offsetX, offsetY, offsetRotation, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, localSource, localTarget, additive, clamp. Path: positionMode, spacingMode, rotateMode, position, spacing, mixRotate, mixX, mixY. Physics: x, y, rotate, scaleX, shearX, inertia, strength, damping, mass, wind, gravity, mix, limit, fps. Slider: animation, loop, bone, property, scale, offset, local, additive, time, mix. On set_constraint, null removes a setting.',
};

/** The constraint tools (edit tools: they get `path`, `output`, `overwrite` and saving from createEditTools). */
export function constraintTools(base, EDIT) {
  return [
    {
      name: 'add_constraint',
      title: 'Add constraint',
      description:
        "Add a constraint, applied after the existing ones. ik: 'bones' is the chain (1 or 2 bones), 'target' the target bone. transform: 'bones' follow 'target' (the source bone); by default every property is mapped and offsets keep the current pose (nothing jumps). path: 'bones' along the path attachment in slot 'target'. physics: one constraint per bone in 'bones' (names get a number), with rotate 1 unless 'settings' say otherwise. slider: 'settings.animation' is the animation it plays; optional 'target' is the bone that drives it. Saves the project.",
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          type: { type: 'string', enum: TYPES },
          name: { type: 'string', description: 'Constraint name (must be new).' },
          bones: { type: 'array', items: { type: 'string' }, description: 'Constrained bones (see the description per type).' },
          target: { type: 'string', description: 'IK target bone, transform source bone, path slot, or the bone driving a slider.' },
          keepPose: { type: 'boolean', description: 'Transform only: set offsets so the bones stay where they are (default true).' },
          settings: SETTINGS,
        },
        required: ['path', 'type', 'name'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        const { type, name } = args;
        const settings = args.settings ?? {};
        if (!name.trim()) fail('The constraint name must not be empty.');
        const bones = args.bones ?? [];
        const taken = (n) => constraintNameTaken(doc, n);
        if (type !== 'physics' && taken(name)) fail(`A constraint named '${name}' already exists.`);
        let made = [name];
        if (type === 'ik') {
          if (bones.length < 1 || bones.length > 2) fail("An IK constraint takes 1 or 2 bones in 'bones' (the chain).");
          if (!args.target) fail("An IK constraint needs 'target' (the target bone).");
          const chain = bones.map((b) => boneOf(doc, b));
          if (chain.length === 2 && doc.bones[chain[1]].parent !== chain[0]) fail(`'${bones[1]}' must be a child of '${bones[0]}' for a two-bone IK chain.`);
          const i = addIk(doc, { name, bones: chain, target: boneOf(doc, args.target) });
          setIk(doc, doc.ik[i], settings);
        } else if (type === 'transform') {
          if (!bones.length) fail("A transform constraint needs 'bones' (the bones that follow).");
          if (!args.target) fail("A transform constraint needs 'target' (the source bone they follow).");
          const data = { type, name, bones: bones.slice(), source: args.target, properties: Object.fromEntries(TRANSFORM_PROPERTIES.map((p) => [p, { to: { [p]: {} } }])) };
          setData(doc, data, settings);
          addConstraint(doc, data);
          invalidateConstraints(doc);
          // Offsets that keep the bones where they are, unless the caller gave offsets or asked not to.
          const hasOffsets = Object.keys(settings).some((k) => k.startsWith('offset'));
          if (args.keepPose !== false && !hasOffsets) keepPoseOffsets(doc, data);
        } else if (type === 'path') {
          if (!bones.length) fail("A path constraint needs 'bones'.");
          if (!args.target) fail("A path constraint needs 'target' (the slot holding the path attachment).");
          const data = { type, name, bones: bones.slice(), slot: slotOf(doc, args.target), rotateMode: 'chain' };
          setData(doc, data, settings);
          addConstraint(doc, data);
        } else if (type === 'physics') {
          if (!bones.length) fail("A physics constraint needs 'bones' (one constraint is made per bone).");
          made = [];
          bones.forEach((b, k) => {
            const n = bones.length === 1 ? name : `${name}${k + 1}`;
            if (taken(n)) fail(`A constraint named '${n}' already exists.`);
            const data = { type, name: n, bone: b, rotate: 1 };
            setData(doc, data, settings);
            addConstraint(doc, data);
            made.push(n);
          });
        } else if (type === 'slider') {
          const animation = settings.animation;
          if (!animation) fail("A slider needs 'settings.animation' (the animation it plays).");
          const data = { type, name, animation, loop: true };
          if (args.target) Object.assign(data, { bone: args.target, property: 'rotate', scale: 1 / 360, local: true });
          setData(doc, data, settings);
          addConstraint(doc, data);
        }
        invalidateConstraints(doc);
        return { added: made, type, constraints: listConstraints(doc).map((c) => c.name) };
      },
    },
    {
      name: 'set_constraint',
      title: 'Change constraint',
      description: "Change a constraint's settings (skeleton JSON 4.3 spelling; null removes one), rename it, or move it in the application order. IK also takes 'target' in settings. Saves the project.",
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          constraint: { type: 'string', description: 'Constraint name.' },
          settings: SETTINGS,
          rename: { type: 'string', description: 'New name (keys and skins follow).' },
          order: { type: 'integer', minimum: 0, description: 'New position in the application order (0 = first).' },
        },
        required: ['path', 'constraint'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        const c = findConstraint(doc, args.constraint);
        if (args.settings) {
          if (c.type === 'ik') setIk(doc, doc.ik[c.ik], args.settings);
          else setData(doc, c.data, args.settings);
        }
        let name = c.name;
        if (args.rename !== undefined && args.rename !== name) {
          if (!args.rename.trim()) fail('The new name must not be empty.');
          if (!renameConstraint(doc, name, args.rename)) fail(`A constraint named '${args.rename}' already exists.`);
          name = args.rename;
        }
        if (args.order !== undefined) {
          const list = listConstraints(doc).filter((x) => x.name !== name);
          const target = Math.min(args.order, list.length);
          const moved = listConstraints(doc).find((x) => x.name === name);
          list.splice(target, 0, moved);
          list.forEach((x, i) => {
            if (x.type === 'ik') doc.ik[x.ik].order = i;
            else if (x.entry) x.entry.index = i;
            else x.data.order = i;
          });
        }
        invalidateConstraints(doc);
        return { constraint: name, order: listConstraints(doc).map((x) => x.name) };
      },
    },
    {
      name: 'delete_constraint',
      title: 'Delete constraint',
      description: 'Delete a constraint with its animation keys and skin memberships. Saves the project.',
      inputSchema: {
        type: 'object',
        properties: { ...base, constraint: { type: 'string', description: 'Constraint name.' } },
        required: ['path', 'constraint'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        findConstraint(doc, args.constraint);
        removeConstraint(doc, args.constraint);
        invalidateConstraints(doc);
        return { deleted: args.constraint, constraints: listConstraints(doc).map((c) => c.name) };
      },
    },
  ];
}
