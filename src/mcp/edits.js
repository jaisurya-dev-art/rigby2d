// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP editing tools: add bones and animations, change the setup pose, set and delete keys.
// Each call loads the project, applies one edit and saves it in the same format (a .rigby work
// file keeps its images byte for byte), atomically, in place or to `output`.

import fs from 'node:fs/promises';
import path from 'node:path';

import { Animation, setKey } from '../core/animation.js';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, STEPPED } from '../core/curve.js';
import { checkArguments } from './protocol.js';
import { writeSkeletonBinary } from '../core/binary.js';
import { writeSkeletonJson } from '../core/interop.js';
import { findAttachment, makeBone } from '../core/model.js';
import { transform } from '../core/math.js';
import { zip } from '../editor/zip.js';
import { ToolError } from './protocol.js';
import { PATH, loadProject } from './tools.js';
import { constraintTools } from './constrainttools.js';
import { authoringTools } from './authoring.js';

const CURVES = { linear: LINEAR, stepped: STEPPED, easeIn: EASE_IN, easeOut: EASE_OUT, easeInOut: EASE_IN_OUT };
const CHANNELS = ['rotate', 'translate', 'scale', 'shear'];
/** Keys closer than this (seconds) are the same key, as in the editor. */
const SAME_TIME = 5e-4;

export const OUTPUT = { type: 'string', description: 'Save to this file instead of changing the input (same format as the input, inside the workspace).' };
export const OVERWRITE = { type: 'boolean', description: 'Replace `output` if it already exists (default false).' };
export const EDIT = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
export const NAME = (what) => ({ type: 'string', description: `${what} name.` });

// ---- saving -----------------------------------------------------------------------------------

/** JSON format version to write an imported file back in, or null when Rigby2D cannot write it. */
function jsonVersion(doc) {
  const v = String(doc.header?.version ?? '4.3');
  if (v.startsWith('3.8')) return '3.8';
  if (v.startsWith('4.2')) return '4.2';
  if (v.startsWith('4.3')) return '4.3';
  return null;
}

/** Serializes a loaded project in its own format. */
function serialize(p) {
  const { doc } = p;
  if (p.format === 'rigby') {
    const enc = new TextEncoder();
    const images = [...p.entries].filter(([k]) => k !== 'project.json').map(([k, bytes]) => ({ path: k, bytes }));
    return zip([{ path: 'project.json', bytes: enc.encode(doc.toJson()) }, ...images]);
  }
  if (p.format === 'skel') {
    const { json } = writeSkeletonJson(doc, { version: '4.3', binary: true });
    return writeSkeletonBinary(json);
  }
  const version = jsonVersion(doc);
  const { json } = writeSkeletonJson(doc, { version });
  return new TextEncoder().encode(JSON.stringify(json, null, 2));
}

export async function save(ws, p, { output, overwrite = false }) {
  let target = p.file;
  if (output !== undefined) {
    target = await ws.writable(output);
    if (path.extname(target).toLowerCase() !== path.extname(p.file).toLowerCase()) {
      throw new ToolError(`The output must have the same extension as the input (${path.extname(p.file)}); use convert_project to change format.`);
    }
    if (target !== p.file && !overwrite && (await fs.stat(target).then(() => true, () => false))) {
      throw new ToolError(`${output} already exists. Pass overwrite: true to replace it.`);
    }
  }
  let bytes;
  try {
    bytes = serialize(p);
  } catch (e) {
    throw new ToolError(`Cannot save the edit in this format: ${e.message}`);
  }
  // Write next to the target, then rename: a failure never leaves a half-written project.
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, bytes);
  try {
    await fs.rename(temp, target);
  } catch (e) {
    await fs.rm(temp, { force: true });
    throw e;
  }
  return target;
}

/** Loads, checks it can be saved, applies `edit(doc, project)` (which returns a summary) and saves. */
export async function edit(ws, args, apply) {
  const p = await loadProject(await ws.existing(args.path));
  if (p.format === 'json' && !jsonVersion(p.doc)) {
    throw new ToolError(`Skeleton JSON ${p.version} cannot be written back. Convert it to 3.8, 4.2 or 4.3 with convert_project, then edit the copy.`);
  }
  const summary = await apply(p.doc, p);
  const err = p.doc.validate();
  if (err) throw new ToolError(`The edit would make the project invalid: ${err}`);
  const file = await save(ws, p, args);
  return { file, ...summary };
}

// ---- lookups ----------------------------------------------------------------------------------

export function boneIndex(doc, name) {
  const i = doc.bones.findIndex((b) => b.name === name);
  if (i < 0) throw new ToolError(`No bone '${name}'.`);
  return i;
}

export function slotIndex(doc, name) {
  const i = doc.slots.findIndex((s) => s.name === name);
  if (i < 0) throw new ToolError(`No slot '${name}'. Slots: ${doc.slots.map((s) => s.name).join(', ') || 'none'}.`);
  return i;
}

export function animationOf(doc, name) {
  const anim = doc.animations.find((a) => a.name === name);
  if (!anim) throw new ToolError(`No animation '${name}'. Animations: ${doc.animations.map((a) => a.name).join(', ') || 'none'}; add one with add_animation.`);
  return anim;
}

export function checkName(name, what) {
  if (!name.trim()) throw new ToolError(`The ${what} name must not be empty.`);
}

/** Key value of a bone channel from the call's value / x / y. */
function channelValue(channel, { value, x, y }) {
  if (channel === 'rotate') {
    if (value === undefined) throw new ToolError("A rotate key needs 'value' (degrees added to the setup rotation).");
    return value;
  }
  if (x === undefined && y === undefined) throw new ToolError(`A ${channel} key needs 'x' and/or 'y'.`);
  const base = channel === 'scale' ? 1 : 0;
  return [x ?? base, y ?? base];
}

const extend = (anim, time) => {
  if (time > anim.duration) anim.duration = time;
};

export const roundTime = (t) => Math.round(t * 1e6) / 1e6;

/** A key's curve argument: a preset name, or a custom cubic bezier [cx1, cy1, cx2, cy2]. */
export const CURVE = {
  description:
    "Interpolation to the next key: 'linear' (default), 'stepped', 'easeIn', 'easeOut', 'easeInOut', or a custom cubic bezier [cx1, cy1, cx2, cy2] with control points in key-to-key space (time 0..1 on x, value 0..1 on y; x must stay within 0..1), as in CSS cubic-bezier().",
  anyOf: [
    { type: 'string', enum: ['linear', 'stepped', 'easeIn', 'easeOut', 'easeInOut'] },
    { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
  ],
};

/** The curve for a key from a curve argument (see CURVE). */
export function curveOf(curve = 'linear') {
  if (typeof curve === 'string') {
    if (!(curve in CURVES)) throw new ToolError(`Unknown curve '${curve}'. Use ${Object.keys(CURVES).join(', ')}, or [cx1, cy1, cx2, cy2].`);
    return CURVES[curve];
  }
  if (!Array.isArray(curve) || curve.length !== 4 || !curve.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new ToolError('A custom curve is four numbers: [cx1, cy1, cx2, cy2].');
  }
  if (curve[0] < 0 || curve[0] > 1 || curve[2] < 0 || curve[2] > 1) throw new ToolError('A custom curve keeps cx1 and cx2 (time) within 0..1.');
  return { bezier: curve.slice() };
}

// ---- tools ------------------------------------------------------------------------------------

/** The editing tools, bound to a workspace. */
export function createEditTools(ws) {
  const base = { path: PATH, output: OUTPUT, overwrite: OVERWRITE };
  const tools = [
    {
      name: 'add_bone',
      title: 'Add bone',
      description: 'Add a bone as a child of an existing bone, with its setup pose relative to the parent (x, y, rotation in degrees, length). Saves the project.',
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          name: NAME('New bone'),
          parent: NAME('Parent bone'),
          x: { type: 'number' },
          y: { type: 'number' },
          rotation: { type: 'number' },
          length: { type: 'number', minimum: 0 },
        },
        required: ['path', 'name', 'parent'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        checkName(args.name, 'bone');
        if (doc.bones.some((b) => b.name === args.name)) throw new ToolError(`A bone named '${args.name}' already exists.`);
        const parent = boneIndex(doc, args.parent);
        // Appending keeps every parent before its children and leaves existing indices unchanged.
        doc.bones.push(makeBone(args.name, parent, transform(args.x ?? 0, args.y ?? 0, args.rotation ?? 0), args.length ?? 0));
        return { added: args.name, parent: args.parent, bones: doc.bones.length };
      },
    },
    {
      name: 'set_bone_setup',
      title: 'Set bone setup pose',
      description: "Change a bone's setup (rest) pose relative to its parent: x, y, rotation, scaleX, scaleY, shearX, shearY (degrees for angles) and length. Only the given fields change. Saves the project.",
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          bone: NAME('Bone'),
          x: { type: 'number' },
          y: { type: 'number' },
          rotation: { type: 'number' },
          scaleX: { type: 'number' },
          scaleY: { type: 'number' },
          shearX: { type: 'number' },
          shearY: { type: 'number' },
          length: { type: 'number', minimum: 0 },
        },
        required: ['path', 'bone'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        const bone = doc.bones[boneIndex(doc, args.bone)];
        const fields = { x: 'x', y: 'y', rotation: 'rotation', scaleX: 'scale_x', scaleY: 'scale_y', shearX: 'shear_x', shearY: 'shear_y' };
        const changed = [];
        for (const [arg, field] of Object.entries(fields)) {
          if (args[arg] === undefined) continue;
          bone.setup[field] = args[arg];
          changed.push(arg);
        }
        if (args.length !== undefined) {
          bone.length = args.length;
          changed.push('length');
        }
        if (!changed.length) throw new ToolError('Give at least one field to change.');
        return { bone: bone.name, changed };
      },
    },
    {
      name: 'add_animation',
      title: 'Add animation',
      description: 'Add an empty animation. Its duration grows as keys are set later. Saves the project.',
      inputSchema: {
        type: 'object',
        properties: { ...base, name: NAME('Animation'), duration: { type: 'number', minimum: 0, description: 'Initial duration in seconds (default 0).' } },
        required: ['path', 'name'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        checkName(args.name, 'animation');
        if (doc.animations.some((a) => a.name === args.name)) throw new ToolError(`An animation named '${args.name}' already exists.`);
        doc.animations.push(new Animation(args.name, args.duration ?? 0));
        return { added: args.name, animations: doc.animations.map((a) => a.name) };
      },
    },
    {
      name: 'set_bone_key',
      title: 'Set bone key',
      description:
        'Set a key on a bone in an animation (replacing a key at the same time). Values are relative to the setup pose: rotate takes value (degrees added); translate and shear take x/y (added); scale takes x/y (multiplied). curve shapes the motion to the next key. The animation grows to include the key. Saves the project.',
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          animation: NAME('Animation'),
          bone: NAME('Bone'),
          channel: { type: 'string', enum: CHANNELS },
          time: { type: 'number', minimum: 0, description: 'Seconds.' },
          value: { type: 'number', description: 'rotate: degrees added to the setup rotation.' },
          x: { type: 'number', description: 'translate/shear: added to the setup value; scale: factor.' },
          y: { type: 'number', description: 'translate/shear: added to the setup value; scale: factor.' },
          curve: CURVE,
        },
        required: ['path', 'animation', 'bone', 'channel', 'time'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        const anim = animationOf(doc, args.animation);
        const bone = boneIndex(doc, args.bone);
        const value = channelValue(args.channel, args);
        const keys = anim.boneTimelineMut(bone)[args.channel];
        const time = roundTime(args.time);
        const i = setKey(keys, time, value);
        keys[i].curve = curveOf(args.curve);
        extend(anim, time);
        return { animation: anim.name, bone: args.bone, channel: args.channel, time, value, keys: keys.length, duration: anim.duration };
      },
    },
    {
      name: 'delete_bone_key',
      title: 'Delete bone key',
      description: 'Delete the key of a bone channel at a time in an animation. Saves the project.',
      inputSchema: {
        type: 'object',
        properties: { ...base, animation: NAME('Animation'), bone: NAME('Bone'), channel: { type: 'string', enum: CHANNELS }, time: { type: 'number', minimum: 0 } },
        required: ['path', 'animation', 'bone', 'channel', 'time'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        const anim = animationOf(doc, args.animation);
        const tl = anim.boneTimeline(boneIndex(doc, args.bone));
        const keys = tl?.[args.channel] ?? [];
        const i = keys.findIndex((k) => Math.abs(k.time - args.time) < SAME_TIME);
        if (i < 0) throw new ToolError(`No ${args.channel} key on '${args.bone}' at ${args.time} s in '${anim.name}'. Keys at: ${keys.map((k) => k.time).join(', ') || 'none'}.`);
        keys.splice(i, 1);
        anim.prune();
        return { animation: anim.name, bone: args.bone, channel: args.channel, deleted: args.time, keysLeft: keys.length };
      },
    },
    {
      name: 'set_attachment_key',
      title: 'Set attachment key',
      description: "Show an attachment in a slot from a time on in an animation (an image swap), or hide the slot's attachment with hide: true. The attachment must belong to the slot. Saves the project.",
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          animation: NAME('Animation'),
          slot: NAME('Slot'),
          time: { type: 'number', minimum: 0 },
          attachment: { type: 'string', description: 'Attachment to show (see describe_rig).' },
          hide: { type: 'boolean', description: 'Hide the attachment instead.' },
        },
        required: ['path', 'animation', 'slot', 'time'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        const anim = animationOf(doc, args.animation);
        const slot = slotIndex(doc, args.slot);
        if (args.hide === true && args.attachment !== undefined) throw new ToolError("Give either 'attachment' or hide: true, not both.");
        let name = null;
        if (!args.hide) {
          if (args.attachment === undefined) throw new ToolError("Give 'attachment', or hide: true.");
          const inSkins = doc.skins.some((s) => s.slots.some((e) => e.slot === slot && e.attachments.some((a) => a.name === args.attachment)));
          if (!findAttachment(doc.slots[slot], args.attachment) && !inSkins) throw new ToolError(`Slot '${args.slot}' has no attachment '${args.attachment}'.`);
          name = args.attachment;
        }
        const time = roundTime(args.time);
        const keys = anim.slotTimelineMut(slot).attachment;
        const i = setKey(keys, time, name, STEPPED);
        keys[i].curve = STEPPED;
        extend(anim, time);
        return { animation: anim.name, slot: args.slot, time, attachment: name };
      },
    },
    {
      name: 'set_event_key',
      title: 'Set event key',
      description: 'Fire an event at a time in an animation (games receive it during playback). Creates the event definition if it does not exist; int, float and string override its default values. Saves the project.',
      inputSchema: {
        type: 'object',
        properties: {
          ...base,
          animation: NAME('Animation'),
          event: NAME('Event'),
          time: { type: 'number', minimum: 0 },
          int: { type: 'integer' },
          float: { type: 'number' },
          string: { type: 'string' },
        },
        required: ['path', 'animation', 'event', 'time'],
        additionalProperties: false,
      },
      annotations: EDIT,
      apply: (doc, args) => {
        checkName(args.event, 'event');
        const anim = animationOf(doc, args.animation);
        let created = false;
        if (!doc.events.some((e) => e.name === args.event)) {
          doc.events.push({ name: args.event, int: 0, float: 0, string: null, audio: null, volume: 1, balance: 0 });
          created = true;
        }
        const time = roundTime(args.time);
        anim.events = anim.events.filter((e) => !(e.name === args.event && Math.abs(e.time - time) < SAME_TIME));
        const key = { time, name: args.event };
        for (const field of ['int', 'float', 'string']) if (args[field] !== undefined) key[field] = args[field];
        anim.events.push(key);
        anim.events.sort((a, b) => a.time - b.time);
        extend(anim, time);
        return { animation: anim.name, event: args.event, time, createdDefinition: created };
      },
    },
    ...constraintTools(base, EDIT),
    ...authoringTools(base, EDIT),
  ];
  // Each tool loads the project, applies its edit, validates and saves.
  for (const t of tools) t.handler = (args) => edit(ws, args, (doc, p) => t.apply(doc, args, p));
  return [...tools, batchTool(ws, tools)];
}

// ---- batch ------------------------------------------------------------------------------------

/** The arguments of a tool's operation inside a batch: the tool's own, without the file ones. */
function operationSchema(tool) {
  const { path: _path, output: _output, overwrite: _overwrite, ...properties } = tool.inputSchema.properties;
  return {
    type: 'object',
    properties: { op: { type: 'string' }, ...properties },
    required: ['op', ...tool.inputSchema.required.filter((r) => r !== 'path')],
    additionalProperties: false,
  };
}

/**
 * batch_edit: many edits in one call. The project is loaded once, every operation is applied in
 * order, the result is validated once and saved once, atomically. If any operation fails, nothing
 * is saved, and the error says which operation and why.
 */
function batchTool(ws, tools) {
  const ops = new Map(tools.map((t) => [t.name, { tool: t, schema: operationSchema(t) }]));
  const names = [...ops.keys()];
  return {
    name: 'batch_edit',
    title: 'Batch edit',
    description: `Apply many edits in one call, loading and saving the project once, atomically: all of them are saved, or none. Each operation is { op, ...arguments } where op is one of ${names.join(', ')} and the arguments are that tool's (without path, output and overwrite). Operations run in order, so later ones can use what earlier ones created (add_animation, then its keys). Much faster than one call per key for building animations. Curves can be presets or a custom bezier [cx1, cy1, cx2, cy2].`,
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH,
        operations: {
          type: 'array',
          description: `The edits, in order: { op, ...that tool's arguments } with op one of ${names.join(', ')}.`,
          items: { type: 'object', properties: { op: { type: 'string', enum: names } }, required: ['op'] },
        },
        output: OUTPUT,
        overwrite: OVERWRITE,
      },
      required: ['path', 'operations'],
      additionalProperties: false,
    },
    annotations: { ...EDIT, idempotentHint: false },
    handler: async (args) => {
      if (!args.operations.length) throw new ToolError("'operations' is empty: give at least one edit.");
      // Every operation's arguments are checked before the project is touched.
      args.operations.forEach((o, i) => {
        const op = ops.get(o?.op);
        if (!op) throw new ToolError(`Operation ${i + 1}: unknown op '${o?.op}'. Use one of ${names.join(', ')}.`);
        const problems = checkArguments(op.schema, o);
        if (problems.length) throw new ToolError(`Operation ${i + 1} (${o.op}): ${problems.join('; ')}.`);
      });
      return edit(ws, args, (doc, p) => {
        const counts = {};
        args.operations.forEach((o, i) => {
          try {
            ops.get(o.op).tool.apply(doc, o, p);
          } catch (e) {
            throw new ToolError(`Operation ${i + 1} (${o.op}) failed, so nothing was saved: ${e.message}`);
          }
          counts[o.op] = (counts[o.op] ?? 0) + 1;
        });
        return { applied: args.operations.length, operations: counts, animations: doc.animations.map((a) => ({ name: a.name, duration: a.duration })) };
      });
    },
  };
}

