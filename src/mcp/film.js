// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tools for the editor's project features: workspace and film output settings, the pose
// library and face controls, audio tracks and lip-sync, and renaming or removing parts of a rig.
// Workspace, output, poses, face controls and audio live only in .rigby work files.

import fs from 'node:fs/promises';
import path from 'node:path';

import { frameLevels, sounds } from '../editor/audio.js';
import { FPS_PRESETS, hexToRgba, rgbaToHex } from '../editor/output.js';
import { applyAmount, blendPoses, capturePose } from '../core/poses.js';
import { poseAt, writeTargets } from '../core/keying.js';
import { findAttachment } from '../core/model.js';
import { VISEMES, keyLipSync, matchMouths, readTiming, tidy, timeTextByLoudness, visemeCues } from '../core/lipsync.js';
import { EDIT, NAME, OUTPUT, OVERWRITE, animationOf, boneIndex, checkName, edit, roundTime, slotIndex } from './edits.js';
import { ToolError } from './protocol.js';
import { PATH } from './tools.js';

const AUDIO_TYPES = ['.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac'];
const TIME = {
  time: { type: 'number', minimum: 0, description: 'Seconds. With an animation, keys are set at this time (default 0).' },
  frame: { type: 'integer', minimum: 0, description: "Frame number at the project's frame rate, instead of time." },
};
const ANIMATION = { type: 'string', description: 'Animation to key. Leave it out to change the setup pose instead.' };

function requireWorkFile(p, what) {
  if (p.format !== 'rigby') {
    throw new ToolError(`${what} are stored only in .rigby work files, and ${path.basename(p.file)} is a skeleton export. Open it in Rigby2D and save it as a .rigby work file first.`);
  }
}

/** Time in seconds from `time` or `frame` (rounded to the frame grid when a frame is given). */
function timeOf(doc, args) {
  if (args.frame !== undefined && args.time !== undefined) throw new ToolError("Give either 'time' or 'frame', not both.");
  if (args.frame !== undefined) return roundTime(args.frame / (doc.settings?.fps ?? 30));
  return roundTime(args.time ?? 0);
}

const poseOf = (doc, name) => doc.poses.find((p) => p.name === name) ?? fail(`No pose '${name}'. Poses: ${doc.poses.map((p) => p.name).join(', ') || 'none'}; add one with save_pose.`);
const controlOf = (doc, name) => doc.controllers.find((c) => c.name === name) ?? fail(`No face control '${name}'. Face controls: ${doc.controllers.map((c) => c.name).join(', ') || 'none'}.`);

function fail(message) {
  throw new ToolError(message);
}

/** The project's film data, for inspect_project. */
export function filmSummary(doc) {
  const s = doc.settings;
  return {
    output: {
      fps: s.fps,
      width: s.width,
      height: s.height,
      background: s.background ? rgbaToHex(s.background) : 'transparent',
      framing: s.frame?.camera ? 'camera' : s.frame ? 'fixed' : 'auto',
      ...(s.frame ? { frame: { x: s.frame.x, y: s.frame.y, scale: s.frame.scale } } : {}),
    },
    poses: doc.poses.map((p) => ({ name: p.name, bones: Object.keys(p.bones), slots: Object.keys(p.slots) })),
    faceControls: doc.controllers.map((c) => ({ name: c.name, from: c.from ?? 'setup pose', to: c.to, value: c.value })),
    audio: doc.audio.map((t) => ({ sound: t.sound, animation: t.animation, offset: t.offset, volume: t.volume })),
  };
}

/** Decodes a PCM or float WAV file into an AudioBuffer-like object (for lip-sync). */
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new ToolError('Not a WAV file.');
  let fmt = null;
  let data = null;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const size = v.getUint32(o + 4, true);
    if (tag(o) === 'fmt ') {
      fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
      // WAVE_FORMAT_EXTENSIBLE: the real format is the start of the sub-format GUID.
      if (fmt.format === 0xfffe && size >= 40) fmt.format = v.getUint16(o + 32, true);
    }
    if (tag(o) === 'data') data = { offset: o + 8, size: Math.min(size, bytes.length - o - 8) };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new ToolError('The WAV file has no audio data.');
  const width = fmt.bits / 8;
  const float = fmt.format === 3;
  if (![1, 3].includes(fmt.format) || ![8, 16, 24, 32].includes(fmt.bits) || (float && fmt.bits !== 32)) throw new ToolError(`Unsupported WAV encoding (format ${fmt.format}, ${fmt.bits}-bit); use 8/16/24/32-bit PCM or 32-bit float.`);
  const frames = Math.floor(data.size / (width * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = data.offset + (i * fmt.channels + c) * width;
      let x;
      if (float) x = v.getFloat32(o, true);
      else if (width === 1) x = (v.getUint8(o) - 128) / 128;
      else if (width === 2) x = v.getInt16(o, true) / 32768;
      else if (width === 3) x = ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608);
      else x = v.getInt32(o, true) / 2147483648;
      sum += x;
    }
    mono[i] = sum / fmt.channels;
  }
  return { sampleRate: fmt.rate, length: frames, duration: frames / fmt.rate, numberOfChannels: 1, getChannelData: () => mono };
}

/** The tools. */
export function createFilmTools(ws) {
  const base = { path: PATH, output: OUTPUT, overwrite: OVERWRITE };
  const tool = (name, title, description, properties, required, handler) => ({
    name,
    title,
    description,
    inputSchema: { type: 'object', properties: { ...base, ...properties }, required: ['path', ...required], additionalProperties: false },
    annotations: EDIT,
    handler: (args) => edit(ws, args, (doc, p) => handler(args, doc, p)),
  });

  return [
    // ---- workspace and output ----------------------------------------------------------------
    tool(
      'set_workspace',
      'Set workspace',
      "Set the project's workspace: 'game' (for game engines; skeleton exports) or 'film' (for film and video: output settings, renders, face controls, audio). It only changes which tools the editor shows; animation data is untouched. Saves the work file.",
      { workspace: { type: 'string', enum: ['game', 'film'] } },
      ['workspace'],
      (args, doc, p) => {
        requireWorkFile(p, 'Workspaces');
        doc.workspace = args.workspace;
        return { workspace: args.workspace };
      },
    ),
    tool(
      'set_output',
      'Set output settings',
      `Set the film output: frame rate (presets: ${FPS_PRESETS.join(', ')}; any rate up to 240), size in pixels, background ('transparent' or a #rrggbb color), and framing: 'auto' (fit the animation), 'fixed' (center frame_x, frame_y and frame_scale world units per pixel), or 'camera' (follow a bone named 'camera', created if missing). Only the given fields change. Saves the work file.`,
      {
        fps: { type: 'number', exclusiveMinimum: 0, maximum: 240 },
        width: { type: 'integer', minimum: 1, maximum: 16384 },
        height: { type: 'integer', minimum: 1, maximum: 16384 },
        background: { type: 'string', description: "'transparent' or #rrggbb." },
        framing: { type: 'string', enum: ['auto', 'fixed', 'camera'] },
        frame_x: { type: 'number' },
        frame_y: { type: 'number' },
        frame_scale: { type: 'number', exclusiveMinimum: 0, description: 'World units per output pixel.' },
      },
      [],
      (args, doc, p) => {
        requireWorkFile(p, 'Output settings');
        const s = doc.settings;
        if (args.fps !== undefined) s.fps = args.fps;
        if (args.width !== undefined) s.width = args.width;
        if (args.height !== undefined) s.height = args.height;
        if (args.background !== undefined) {
          if (args.background === 'transparent') s.background = null;
          else if (/^#[0-9a-f]{6}$/i.test(args.background)) s.background = hexToRgba(args.background);
          else throw new ToolError("background must be 'transparent' or a #rrggbb color.");
        }
        const frameArgs = ['frame_x', 'frame_y', 'frame_scale'].some((k) => args[k] !== undefined);
        const framing = args.framing ?? (frameArgs ? (s.frame?.camera ? 'camera' : 'fixed') : undefined);
        if (framing === 'auto') {
          if (frameArgs) throw new ToolError("frame_x, frame_y and frame_scale need framing 'fixed' or 'camera'.");
          s.frame = null;
        } else if (framing) {
          const f = s.frame ?? { x: 0, y: 0, scale: 1 };
          s.frame = { x: args.frame_x ?? f.x, y: args.frame_y ?? f.y, scale: args.frame_scale ?? f.scale, ...(framing === 'camera' ? { camera: true } : {}) };
          if (framing === 'camera' && !doc.bones.some((b) => b.name === 'camera')) {
            doc.bones.push({ name: 'camera', parent: 0, length: 100, setup: { x: s.frame.x, y: s.frame.y, rotation: 0, scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 }, inherit: 'normal', skinRequired: false, color: null });
          }
        }
        return filmSummary(doc).output;
      },
    ),

    // ---- poses -------------------------------------------------------------------------------
    tool(
      'save_pose',
      'Save pose',
      "Save a pose to the pose library: the local transforms of the given bones (default: every bone) and the attachments their slots show (mouth shapes, eyes). Taken from the setup pose, or from an animation at a time. Replaces a pose with the same name only with replace: true. Saves the work file.",
      { name: NAME('Pose'), bones: { type: 'array', items: { type: 'string' }, description: 'Bone names (default: all).' }, animation: { type: 'string', description: 'Take the pose from this animation (default: setup pose).' }, ...TIME, replace: { type: 'boolean' } },
      ['name'],
      (args, doc, p) => {
        requireWorkFile(p, 'Poses');
        checkName(args.name, 'pose');
        const existing = doc.poses.findIndex((x) => x.name === args.name);
        if (existing >= 0 && !args.replace) throw new ToolError(`A pose named '${args.name}' exists. Pass replace: true to replace it.`);
        const bones = args.bones?.length ? args.bones.map((b) => boneIndex(doc, b)) : doc.bones.map((_, i) => i);
        const set = new Set(bones);
        const slots = doc.slots.map((s, i) => (set.has(s.bone) ? i : -1)).filter((i) => i >= 0);
        const anim = args.animation ? animationOf(doc, args.animation) : null;
        const pose = capturePose(doc, poseAt(doc, anim, timeOf(doc, args)), args.name, bones, slots);
        if (existing >= 0) doc.poses[existing] = pose;
        else doc.poses.push(pose);
        return { pose: args.name, bones: Object.keys(pose.bones).length, slots: Object.keys(pose.slots).length, replaced: existing >= 0 };
      },
    ),
    tool(
      'apply_pose',
      'Apply pose',
      'Apply a saved pose at an amount (0 to 1; image swaps switch at 0.5). Without an animation it changes the setup pose; with one it sets keys at the time (all transform channels of the pose\'s bones, attachment keys for its slots). Saves the work file.',
      { pose: NAME('Pose'), amount: { type: 'number', minimum: 0, maximum: 1, description: 'Default 1.' }, animation: ANIMATION, ...TIME },
      ['pose'],
      (args, doc, p) => {
        requireWorkFile(p, 'Poses');
        const saved = poseOf(doc, args.pose);
        const anim = args.animation ? animationOf(doc, args.animation) : null;
        const time = timeOf(doc, args);
        const amount = args.amount ?? 1;
        // A blend from the current pose to the saved one, as the editor's "Apply at".
        const n = writeTargets(doc, applyAmount(doc, poseAt(doc, anim, time), saved, amount), anim, time);
        return { pose: args.pose, amount, ...(anim ? { animation: anim.name, time } : { setupPose: true }), ...n };
      },
    ),
    tool(
      'delete_pose',
      'Delete pose',
      'Delete a pose from the pose library. Face controls that use it are deleted too. Saves the work file.',
      { name: NAME('Pose') },
      ['name'],
      (args, doc, p) => {
        requireWorkFile(p, 'Poses');
        poseOf(doc, args.name);
        doc.poses = doc.poses.filter((x) => x.name !== args.name);
        const removed = doc.controllers.filter((c) => c.to === args.name || c.from === args.name).map((c) => c.name);
        doc.controllers = doc.controllers.filter((c) => !removed.includes(c.name));
        return { deleted: args.name, faceControlsDeleted: removed };
      },
    ),

    // ---- face controls -----------------------------------------------------------------------
    tool(
      'add_face_control',
      'Add face control',
      "Add a face control: a slider from 0 to 1 that blends from one pose ('from', default the setup pose) to another ('to'), such as brows up, eyes closed or mouth open. Saves the work file.",
      { name: NAME('Face control'), to: { type: 'string', description: 'Pose at value 1.' }, from: { type: 'string', description: 'Pose at value 0 (default: setup pose).' } },
      ['name', 'to'],
      (args, doc, p) => {
        requireWorkFile(p, 'Face controls');
        checkName(args.name, 'face control');
        if (doc.controllers.some((c) => c.name === args.name)) throw new ToolError(`A face control named '${args.name}' already exists.`);
        poseOf(doc, args.to);
        if (args.from) poseOf(doc, args.from);
        doc.controllers.push({ name: args.name, from: args.from ?? null, to: args.to, value: 0 });
        return { added: args.name, from: args.from ?? 'setup pose', to: args.to };
      },
    ),
    tool(
      'set_face_control',
      'Set face control',
      'Set a face control to a value (0 to 1). Without an animation it changes the setup pose; with one it keys the face at the time, like dragging the slider in Animate mode. Saves the work file.',
      { control: NAME('Face control'), value: { type: 'number', minimum: 0, maximum: 1 }, animation: ANIMATION, ...TIME },
      ['control', 'value'],
      (args, doc, p) => {
        requireWorkFile(p, 'Face controls');
        const c = controlOf(doc, args.control);
        const to = poseOf(doc, c.to);
        const from = c.from ? poseOf(doc, c.from) : null;
        const anim = args.animation ? animationOf(doc, args.animation) : null;
        const time = timeOf(doc, args);
        writeTargets(doc, blendPoses(doc, poseAt(doc, anim, time), from, to, args.value), anim, time);
        c.value = args.value;
        return { control: c.name, value: args.value, ...(anim ? { animation: anim.name, time } : { setupPose: true }) };
      },
    ),
    tool(
      'delete_face_control',
      'Delete face control',
      'Delete a face control (its poses stay in the library). Saves the work file.',
      { name: NAME('Face control') },
      ['name'],
      (args, doc, p) => {
        requireWorkFile(p, 'Face controls');
        controlOf(doc, args.name);
        doc.controllers = doc.controllers.filter((c) => c.name !== args.name);
        return { deleted: args.name };
      },
    ),

    // ---- audio -------------------------------------------------------------------------------
    tool(
      'add_audio_track',
      'Add audio track',
      `Add a sound file (${AUDIO_TYPES.join(', ')}) as an audio track of an animation, starting at 'offset' seconds. The file is stored inside the work file; it plays with the timeline, drives lip-sync, and is mixed into renders. Saves the work file.`,
      {
        audio_file: { type: 'string', description: 'Sound file inside the workspace.' },
        animation: NAME('Animation'),
        offset: { type: 'number', description: 'Start time in seconds (default 0; negative skips the start of the sound).' },
        volume: { type: 'number', minimum: 0, description: 'Default 1.' },
        replace: { type: 'boolean', description: 'Replace a stored sound with the same file name.' },
      },
      ['audio_file', 'animation'],
      async (args, doc, p) => {
        requireWorkFile(p, 'Audio tracks');
        const anim = animationOf(doc, args.animation);
        const file = await ws.existing(args.audio_file);
        const ext = path.extname(file).toLowerCase();
        if (!AUDIO_TYPES.includes(ext)) throw new ToolError(`Unsupported sound file '${ext}'; use ${AUDIO_TYPES.join(', ')}.`);
        const name = path.basename(file);
        const bytes = new Uint8Array(await fs.readFile(file));
        const key = `audio/${name}`;
        const stored = p.entries.get(key);
        if (stored && !args.replace && !sameBytes(stored, bytes)) throw new ToolError(`The work file already has a different sound named '${name}'. Pass replace: true, or rename the file.`);
        p.entries.set(key, bytes);
        doc.audio.push({ sound: name, animation: anim.name, offset: args.offset ?? 0, volume: args.volume ?? 1 });
        return { sound: name, animation: anim.name, offset: args.offset ?? 0, volume: args.volume ?? 1, bytes: bytes.length };
      },
    ),
    tool(
      'set_audio_track',
      'Set audio track',
      "Change an audio track's start time (offset, seconds) or volume. Saves the work file.",
      { sound: NAME('Sound'), animation: NAME('Animation'), offset: { type: 'number' }, volume: { type: 'number', minimum: 0 } },
      ['sound', 'animation'],
      (args, doc, p) => {
        requireWorkFile(p, 'Audio tracks');
        const t = trackOf(doc, args);
        if (args.offset !== undefined) t.offset = args.offset;
        if (args.volume !== undefined) t.volume = args.volume;
        return { ...t };
      },
    ),
    tool(
      'remove_audio_track',
      'Remove audio track',
      'Remove an audio track from an animation. The sound file is removed from the work file when no other track uses it. Saves the work file.',
      { sound: NAME('Sound'), animation: NAME('Animation') },
      ['sound', 'animation'],
      (args, doc, p) => {
        requireWorkFile(p, 'Audio tracks');
        const t = trackOf(doc, args);
        doc.audio = doc.audio.filter((x) => x !== t);
        const fileRemoved = !doc.audio.some((x) => x.sound === t.sound);
        if (fileRemoved) p.entries.delete(`audio/${t.sound}`);
        return { removed: t.sound, animation: t.animation, fileRemoved };
      },
    ),
    tool(
      'lip_sync',
      'Lip-sync',
      'Lip-sync an animation to one of its audio tracks. With `text` (the words spoken) or `timing_file` (ElevenLabs timestamps or Whisper/word-timing JSON, Rhubarb Lip Sync .tsv/.json, Papagayo .dat), keys mouth shapes (visemes A, E, I, O, U, MBP, FV, L and rest) as image swaps on a mouth slot, each landing a little before its sound; the slot and the shape-to-image mapping are found from image names unless given. Without them, keys a face control (such as \'mouth open\') from the loudness of the track instead. Reading the audio (text or loudness) needs a WAV track; a timing file does not. Saves the work file.',
      {
        animation: NAME('Animation'),
        sound: { type: 'string', description: "Audio track to follow (default: the animation's first)." },
        text: { type: 'string', description: 'The words spoken in the track, timed against its loudness (viseme lip-sync).' },
        timing_file: { type: 'string', description: 'A timing file inside the workspace: ElevenLabs timestamps, Whisper or [{ word, start, end }] JSON, Rhubarb (.tsv/.json) or Papagayo (.dat). Times are from the start of the sound.' },
        slot: { type: 'string', description: 'Mouth slot for viseme lip-sync (default: the slot whose images cover the most mouth shapes).' },
        mouths: { type: 'object', additionalProperties: { type: ['string', 'null'] }, description: "Override the image used for mouth shapes: { A: 'mouth_open', rest: 'mouth_smile', ... }." },
        lead: { type: 'integer', minimum: 0, maximum: 6, description: 'Frames each mouth lands before its sound (default 2).' },
        min_hold: { type: 'integer', minimum: 1, maximum: 8, description: 'Frames a mouth shape is held at least (default about 0.05 s).' },
        control: { type: 'string', description: 'Face control to key from loudness (when neither text nor timing_file is given).' },
      },
      ['animation'],
      async (args, doc, p) => {
        requireWorkFile(p, 'Lip-sync');
        const anim = animationOf(doc, args.animation);
        const tracks = doc.audio.filter((t) => t.animation === anim.name && (!args.sound || t.sound === args.sound));
        const track = tracks[0] ?? fail(args.sound ? `No audio track '${args.sound}' on '${anim.name}'.` : `'${anim.name}' has no audio tracks; add one with add_audio_track.`);
        const bytes = p.entries.get(`audio/${track.sound}`) ?? fail(`The sound file '${track.sound}' is missing from the work file.`);
        const fps = doc.settings.fps;
        const frames = Math.max(1, Math.round(anim.duration * fps)) + 1;
        const isWav = /\.wav$/i.test(track.sound);
        const levelsOf = () => {
          if (!isWav) throw new ToolError(`Reading the audio through MCP needs a WAV track; '${track.sound}' is not one. Give a timing_file, use the Lip-sync dialog in the editor, or add a WAV version of the track.`);
          sounds.set(track.sound, { bytes, buffer: decodeWav(bytes) });
          try {
            return { levels: frameLevels(track, fps, frames), length: sounds.get(track.sound).buffer.duration };
          } finally {
            sounds.delete(track.sound);
          }
        };

        if (args.text !== undefined || args.timing_file !== undefined) {
          // Viseme lip-sync on a mouth slot.
          const candidates = doc.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.attachments.length > 1);
          const covered = (s) => Object.values(matchMouths(s.attachments.map((a) => a.name))).filter(Boolean).length;
          const si = args.slot !== undefined ? slotIndex(doc, args.slot) : (candidates.sort((a, b) => covered(b.s) - covered(a.s))[0]?.i ?? fail('No mouth slot found: lip-sync needs a slot with several mouth images.'));
          const slot = doc.slots[si];
          const mouths = { ...matchMouths(slot.attachments.map((a) => a.name)), ...(args.mouths ?? {}) };
          for (const [v, name] of Object.entries(args.mouths ?? {})) {
            if (!VISEMES.includes(v)) throw new ToolError(`Unknown mouth shape '${v}'; use ${VISEMES.join(', ')}.`);
            if (name !== null && !slot.attachments.some((a) => a.name === name)) throw new ToolError(`Slot '${slot.name}' has no image '${name}'.`);
          }
          const opts = { fps, lead: args.lead ?? 2, minHold: args.min_hold ?? Math.max(2, Math.round(fps * 0.05)) };
          let cues;
          let offset = track.offset;
          let length;
          let source;
          if (args.timing_file !== undefined) {
            const file = await ws.existing(args.timing_file);
            let timing;
            try {
              timing = readTiming(await fs.readFile(file, 'utf8'), { name: path.basename(file) });
            } catch (e) {
              throw new ToolError(e.message);
            }
            cues = timing.words ? visemeCues(timing.words, opts) : tidy(timing.cues.map((c) => ({ time: Math.max(0, c.time - opts.lead / fps), viseme: c.viseme })), opts.minHold / fps);
            source = timing.words ? `${timing.words.length} words (${timing.kind})` : `${timing.cues.length} mouth cues (${timing.kind})`;
            length = isWav ? levelsOf().length : (cues.at(-1)?.time ?? 0) + 0.5;
          } else {
            const { levels, length: l } = levelsOf();
            const words = timeTextByLoudness(args.text, levels, fps);
            cues = visemeCues(words, opts);
            offset = 0;
            length = l;
            source = `${words.length} words, timed by loudness`;
          }
          const start = Math.max(0, track.offset);
          const end = Math.min(anim.duration, track.offset + length);
          const keys = keyLipSync(anim, si, cues, mouths, { start, end, offset });
          return { mode: 'visemes', animation: anim.name, sound: track.sound, slot: slot.name, source, keys, mouths };
        }

        if (args.control === undefined) throw new ToolError('Give text or timing_file for viseme lip-sync, or control for loudness lip-sync.');
        const c = controlOf(doc, args.control);
        if (!isWav) throw new ToolError(`Lip-sync through MCP reads WAV files; '${track.sound}' is not one. Use the Lip-sync button in the editor, or add a WAV version of the track.`);
        const to = poseOf(doc, c.to);
        const from = c.from ? poseOf(doc, c.from) : null;
        const { levels } = levelsOf();
        for (let f = 0; f < frames; f++) {
          const time = roundTime(f / fps);
          writeTargets(doc, blendPoses(doc, poseAt(doc, anim, time), from, to, levels[f]), anim, time);
        }
        const open = [...levels].filter((v) => v > 0).length;
        return { control: c.name, animation: anim.name, sound: track.sound, frames, fps, framesOpen: open };
      },
    ),

    // ---- structure ---------------------------------------------------------------------------
    tool(
      'rename_bone',
      'Rename bone',
      'Rename a bone. Poses that store the bone follow the new name. Saves the project.',
      { bone: NAME('Bone'), name: NAME('New') },
      ['bone', 'name'],
      (args, doc) => {
        const bone = doc.bones[boneIndex(doc, args.bone)];
        checkName(args.name, 'bone');
        if (doc.bones.some((b) => b.name === args.name)) throw new ToolError(`A bone named '${args.name}' already exists.`);
        bone.name = args.name;
        for (const pose of doc.poses ?? []) {
          if (args.bone in pose.bones) {
            pose.bones[args.name] = pose.bones[args.bone];
            delete pose.bones[args.bone];
          }
        }
        return { renamed: args.bone, to: args.name };
      },
    ),
    tool(
      'rename_animation',
      'Rename animation',
      'Rename an animation. Its audio tracks follow. Saves the project.',
      { animation: NAME('Animation'), name: NAME('New') },
      ['animation', 'name'],
      (args, doc) => {
        const anim = animationOf(doc, args.animation);
        checkName(args.name, 'animation');
        if (doc.animations.some((a) => a.name === args.name)) throw new ToolError(`An animation named '${args.name}' already exists.`);
        anim.name = args.name;
        for (const t of doc.audio ?? []) if (t.animation === args.animation) t.animation = args.name;
        return { renamed: args.animation, to: args.name };
      },
    ),
    tool(
      'delete_animation',
      'Delete animation',
      'Delete an animation and its audio tracks. Saves the project.',
      { animation: NAME('Animation') },
      ['animation'],
      (args, doc, p) => {
        const anim = animationOf(doc, args.animation);
        doc.animations = doc.animations.filter((a) => a !== anim);
        const tracks = (doc.audio ?? []).filter((t) => t.animation === anim.name);
        doc.audio = (doc.audio ?? []).filter((t) => t.animation !== anim.name);
        if (p.entries) for (const t of tracks) if (!doc.audio.some((x) => x.sound === t.sound)) p.entries.delete(`audio/${t.sound}`);
        return { deleted: anim.name, animations: doc.animations.map((a) => a.name), audioTracksRemoved: tracks.length };
      },
    ),
    tool(
      'set_slot',
      'Set slot',
      "Change a slot's setup: the attachment it shows (or hide: true to show none) and its color (#rrggbb or #rrggbbaa). Saves the project.",
      { slot: NAME('Slot'), attachment: { type: 'string' }, hide: { type: 'boolean' }, color: { type: 'string', description: '#rrggbb or #rrggbbaa.' } },
      ['slot'],
      (args, doc) => {
        const slot = doc.slots[slotIndex(doc, args.slot)];
        if (args.hide && args.attachment !== undefined) throw new ToolError("Give either 'attachment' or hide: true, not both.");
        if (args.attachment !== undefined) {
          if (!findAttachment(slot, args.attachment)) throw new ToolError(`Slot '${slot.name}' has no attachment '${args.attachment}'. Attachments: ${slot.attachments.map((a) => a.name).join(', ') || 'none'}.`);
          slot.attachment = args.attachment;
        }
        if (args.hide) slot.attachment = null;
        if (args.color !== undefined) {
          const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(args.color) ?? fail('color must be #rrggbb or #rrggbbaa.');
          slot.color = [...hexToRgba(`#${m[1]}`).slice(0, 3), m[2] ? parseInt(m[2], 16) / 255 : 1];
        }
        if (args.attachment === undefined && !args.hide && args.color === undefined) throw new ToolError('Give attachment, hide or color.');
        return { slot: slot.name, attachment: slot.attachment, color: rgbaToHex(slot.color) + Math.round(slot.color[3] * 255).toString(16).padStart(2, '0') };
      },
    ),
  ];
}

function trackOf(doc, { sound, animation }) {
  return doc.audio.find((t) => t.sound === sound && t.animation === animation) ?? fail(`No audio track '${sound}' on animation '${animation}'.`);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
