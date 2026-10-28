// SPDX-License-Identifier: MIT OR Apache-2.0
// Scene composition tools (see core/scene.js): put characters on a stage as actors, place them,
// give them clips of their animations on the scene's timeline, and set layer depths for parallax.
// Scenes live in .rigby work files; each actor's character is stored in it under actors/<id>/.

import fs from 'node:fs/promises';
import path from 'node:path';

import { Skeleton } from '../core/model.js';
import { addActorToStage, clipLength, groundOffset, readClip } from '../core/scene.js';
import { unzip } from '../editor/zip.js';
import { EDIT, NAME, OUTPUT, OVERWRITE, animationOf, boneIndex, edit } from './edits.js';
import { ToolError } from './protocol.js';
import { PATH } from './tools.js';

function requireScene(p) {
  if (p.format !== 'rigby') throw new ToolError(`Scenes are stored only in .rigby work files, and ${path.basename(p.file)} is a skeleton export.`);
}

function actorOf(doc, name) {
  const a = doc.scene?.actors.find((x) => x.name === name);
  if (!a) throw new ToolError(`No actor '${name}'. Actors: ${doc.scene?.actors.map((x) => x.name).join(', ') || 'none'}; add one with add_actor.`);
  return a;
}

/** The character document of an actor, from the work file's actors/<id>/project.json. */
function characterOf(p, actor) {
  const bytes = p.entries.get(`actors/${actor.id}/project.json`);
  if (!bytes) throw new ToolError(`The character of actor '${actor.name}' is missing from the work file.`);
  return Skeleton.fromJson(new TextDecoder().decode(bytes));
}

/** A short description of the scene for inspect_project. */
export function sceneSummary(doc) {
  if (!doc.scene) return undefined;
  return {
    actors: doc.scene.actors.map((a) => ({ name: a.name, bone: a.bone, slot: a.slot, source: a.source, flip: a.flip, skin: a.skin, clips: a.clips })),
    depth: doc.scene.depth,
  };
}

export function createSceneTools(ws) {
  const base = { path: PATH, output: OUTPUT, overwrite: OVERWRITE };
  const tool = (name, title, description, properties, required, handler) => ({
    name,
    title,
    description,
    inputSchema: { type: 'object', properties: { ...base, ...properties }, required: ['path', ...required], additionalProperties: false },
    annotations: EDIT,
    handler: (args) =>
      edit(ws, args, (doc, p) => {
        requireScene(p);
        return handler(args, doc, p);
      }),
  });

  const clipProps = {
    shot: NAME('Shot (an animation of the scene)'),
    animation: { type: 'string', description: "The character's animation to play." },
    start: { type: 'number', minimum: 0, description: 'When the clip starts on the shot, in seconds.' },
    in: { type: 'number', minimum: 0, description: 'Where in the animation to start (seconds, default 0).' },
    out: { type: 'number', minimum: 0, description: 'Where in the animation to stop (seconds, default its end).' },
    speed: { type: 'number', minimum: 0.01, description: 'Playback speed (default 1).' },
    loops: { type: 'integer', minimum: 0, description: 'How many times it plays (default 1; 0 = repeats until the next clip).' },
    blend: { type: 'number', minimum: 0, description: 'Crossfade from the previous clip, in seconds (default 0.25 after another clip).' },
  };

  return [
    tool(
      'add_actor',
      'Add actor',
      'Put a character (another .rigby work file) into this scene as an actor. Its whole project is stored inside the scene, and a stage bone and slot named after it are created: the bone places it (animate it to move, turn or scale the actor), the slot sets where it is drawn among the other layers. The character stands with its feet on the bone (y is the ground line), however it was drawn. Optionally give it a first clip. Saves the work file.',
      {
        character: { type: 'string', description: 'The character: a .rigby work file inside the workspace.' },
        name: { type: 'string', description: "Actor name (default: the character's name)." },
        x: { type: 'number', description: 'Position on the stage (default 0).' },
        y: { type: 'number', description: 'Position on the stage (default 0, the ground line).' },
        scale: { type: 'number', exclusiveMinimum: 0, description: 'Size (default 1).' },
        flip: { type: 'boolean', description: 'Face the other way.' },
        ...clipProps,
        start: { ...clipProps.start, description: 'When the first clip starts (default 0), when animation is given.' },
      },
      ['character'],
      async (args, doc, p) => {
        const file = await ws.existing(args.character);
        if (!file.toLowerCase().endsWith('.rigby')) throw new ToolError('The character must be a .rigby work file.');
        const files = unzip(new Uint8Array(await fs.readFile(file)));
        const project = files.get('project.json');
        if (!project) throw new ToolError(`${path.basename(file)} is not a Rigby2D work file.`);
        const character = Skeleton.fromJson(new TextDecoder().decode(project));
        const base =
          path
            .basename(file, '.rigby')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '') || 'actor';
        let id = base;
        for (let n = 2; [...p.entries.keys()].some((k) => k.startsWith(`actors/${id}/`)); n++) id = `${base}${n}`;
        for (const [k, bytes] of files) p.entries.set(`actors/${id}/${k}`, bytes);
        const derived = character.name && character.name !== 'untitled' ? character.name : base;
        const raw = args.name ?? derived[0].toUpperCase() + derived.slice(1);
        const actor = addActorToStage(doc, { id, name: raw, source: path.basename(file), at: [args.x ?? 0, args.y ?? 0], ground: groundOffset(character) });
        const bone = doc.bones[doc.boneIndex(actor.bone)];
        if (args.scale !== undefined) bone.setup.scale_x = bone.setup.scale_y = args.scale;
        actor.flip = !!args.flip;
        let clip = null;
        if (args.animation) {
          if (!character.animations.some((a) => a.name === args.animation)) throw new ToolError(`${raw} has no animation '${args.animation}'. Animations: ${character.animations.map((a) => a.name).join(', ')}.`);
          const shot = args.shot ? animationOf(doc, args.shot) : doc.animations[0];
          if (!shot) throw new ToolError('The scene has no shot (animation) yet; add one with add_animation, or omit animation.');
          clip = readClip({ animation: args.animation, start: args.start ?? 0, in: args.in, out: args.out, speed: args.speed, loops: args.loops, blend: 0 });
          (actor.clips[shot.name] ??= []).push(clip);
          const len = clipLength(clip, character.animations.find((a) => a.name === args.animation));
          if (Number.isFinite(len)) shot.duration = Math.max(shot.duration, clip.start + len);
        }
        return { actor: actor.name, bone: actor.bone, slot: actor.slot, animations: character.animations.map((a) => `${a.name} (${a.duration.toFixed(2)} s)`), clip };
      },
    ),
    tool(
      'add_clip',
      'Add clip',
      "Place a clip of an actor's animation on a shot of the scene, NLE-style: from 'start' it plays the animation between 'in' and 'out' at 'speed', 'loops' times, crossfading from the actor's previous clip over 'blend' seconds; after it ends the actor holds the last frame until its next clip. The shot grows to fit. Saves the work file.",
      { actor: NAME('Actor'), ...clipProps },
      ['actor', 'shot', 'animation', 'start'],
      (args, doc, p) => {
        const actor = actorOf(doc, args.actor);
        const shot = animationOf(doc, args.shot);
        const character = characterOf(p, actor);
        const anim = character.animations.find((a) => a.name === args.animation);
        if (!anim) throw new ToolError(`${actor.name} has no animation '${args.animation}'. Animations: ${character.animations.map((a) => a.name).join(', ')}.`);
        const list = (actor.clips[shot.name] ??= []);
        const clip = readClip({ animation: anim.name, start: args.start, in: args.in, out: args.out, speed: args.speed, loops: args.loops, blend: args.blend ?? (list.length ? 0.25 : 0) });
        list.push(clip);
        list.sort((a, b) => a.start - b.start);
        const len = clipLength(clip, anim);
        if (Number.isFinite(len)) shot.duration = Math.max(shot.duration, clip.start + len);
        return { actor: actor.name, shot: shot.name, clip, clips: list.length, shotDuration: shot.duration };
      },
    ),
    tool(
      'remove_clip',
      'Remove clip',
      "Remove an actor's clip that starts at 'start' (seconds) on a shot. Saves the work file.",
      { actor: NAME('Actor'), shot: NAME('Shot'), start: { type: 'number', minimum: 0 } },
      ['actor', 'shot', 'start'],
      (args, doc) => {
        const actor = actorOf(doc, args.actor);
        const list = actor.clips[args.shot] ?? [];
        const i = list.findIndex((c) => Math.abs(c.start - args.start) < 1e-3);
        if (i < 0) throw new ToolError(`${actor.name} has no clip at ${args.start} s on '${args.shot}'. Clips start at: ${list.map((c) => c.start).join(', ') || 'none'}.`);
        const [removed] = list.splice(i, 1);
        return { removed };
      },
    ),
    tool(
      'set_actor',
      'Set actor',
      "Change an actor: its setup position, size, facing, skin or name. To move it over time, key its bone (named in add_actor's result) with set_bone_key. Saves the work file.",
      {
        actor: NAME('Actor'),
        x: { type: 'number' },
        y: { type: 'number' },
        scale: { type: 'number', exclusiveMinimum: 0 },
        flip: { type: 'boolean' },
        skin: { type: 'string', description: "One of the character's skins ('' for the default)." },
        rename: { type: 'string', description: 'New actor name.' },
      },
      ['actor'],
      (args, doc, p) => {
        const actor = actorOf(doc, args.actor);
        const bone = doc.bones[boneIndex(doc, actor.bone)];
        if (args.x !== undefined) bone.setup.x = args.x;
        if (args.y !== undefined) bone.setup.y = args.y;
        if (args.scale !== undefined) bone.setup.scale_x = bone.setup.scale_y = args.scale;
        if (args.flip !== undefined) actor.flip = args.flip;
        if (args.skin !== undefined) {
          if (args.skin && !characterOf(p, actor).skins.some((s) => s.name === args.skin)) throw new ToolError(`${actor.name} has no skin '${args.skin}'.`);
          actor.skin = args.skin || null;
        }
        if (args.rename) {
          if (doc.scene.actors.some((a) => a !== actor && a.name === args.rename)) throw new ToolError(`There is already an actor named '${args.rename}'.`);
          actor.name = args.rename;
        }
        return { actor: actor.name, x: bone.setup.x, y: bone.setup.y, scale: bone.setup.scale_x, flip: actor.flip, skin: actor.skin };
      },
    ),
    tool(
      'set_layer_depth',
      'Set layer depth',
      "Set the depth of a top-level stage bone (a background or foreground layer) for parallax: when the 'camera' bone moves, a layer at depth z keeps up with focal / (focal + z) of the motion (focal 1000 by default), keeping its drawn size. 0 = no parallax; negative = in front of the picture plane (moves faster). Saves the work file.",
      { bone: NAME('Bone'), depth: { type: 'number' }, focal: { type: 'number', exclusiveMinimum: 0, description: 'Optional: the focal distance for the whole scene.' } },
      ['bone', 'depth'],
      (args, doc) => {
        const b = boneIndex(doc, args.bone);
        if (doc.bones[b].parent !== 0) throw new ToolError(`Depth applies to layers directly under the root; '${args.bone}' is under '${doc.bones[doc.bones[b].parent].name}'.`);
        doc.scene ??= { actors: [], depth: {}, focal: 1000 };
        if (args.focal !== undefined) doc.scene.focal = args.focal;
        if (args.depth <= -doc.scene.focal * 0.95) throw new ToolError(`Depth must be more than ${-doc.scene.focal * 0.95}.`);
        if (args.depth) doc.scene.depth[args.bone] = args.depth;
        else delete doc.scene.depth[args.bone];
        return { bone: args.bone, depth: args.depth, focal: doc.scene.focal };
      },
    ),
  ];
}
