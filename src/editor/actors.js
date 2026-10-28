// SPDX-License-Identifier: MIT OR Apache-2.0
// Actors of a scene (see core/scene.js): the characters placed on the stage. Each actor is a whole
// character project kept as it was loaded (its work file's entries), so a scene saves it back byte
// for byte under actors/<id>/ in its own work file. Their images live in the editor's image store
// as "@<id>/<image>" and their sounds as "@<id>/<sound>", so they never clash with the stage's own.

import { addActorToStage, emptyScene, groundOffset, poseActor } from '../core/scene.js';
import { Pose } from '../core/pose.js';
import { Skeleton } from '../core/model.js';
import { addSound, sounds } from './audio.js';
import { decodeImage } from './io.js';
import { unzip } from './zip.js';

/** Actor id -> { doc (Skeleton), files (Map path -> bytes, the actor's work file) }. */
export const actors = new Map();

export const imageKey = (id, name) => `@${id}/${name}`;
export const soundKey = (id, name) => `@${id}/${name}`;

/** Loads an actor's work-file entries: its document, images and sounds. Returns the document. */
export async function loadActor(id, files, images) {
  const project = files.get('project.json');
  if (!project) throw new Error('not a Rigby2D work file (project.json missing)');
  const doc = Skeleton.fromJson(new TextDecoder().decode(project));
  for (const [path, bytes] of files) {
    if (path.startsWith('images/') && path.endsWith('.png')) images.insert(imageKey(id, path.slice(7, -4)), await decodeImage(bytes));
    else if (path.startsWith('audio/')) await addSound(soundKey(id, path.slice(6)), bytes).catch(() => {});
  }
  actors.set(id, { doc, files });
  return doc;
}

/** Loads every actor stored in a scene's work file (entries actors/<id>/...). Returns warnings. */
export async function loadActors(entries, images) {
  actors.clear();
  const byId = new Map();
  for (const [path, bytes] of entries) {
    const m = /^actors\/([^/]+)\/(.+)$/.exec(path);
    if (!m) continue;
    if (!byId.has(m[1])) byId.set(m[1], new Map());
    byId.get(m[1]).set(m[2], bytes);
  }
  const warnings = [];
  for (const [id, files] of byId) await loadActor(id, files, images).catch((e) => warnings.push(`actor ${id}: ${e.message}`));
  return warnings;
}

/** The work-file entries that store the actors a scene uses. */
export function actorEntries(doc) {
  const out = [];
  for (const a of doc.scene?.actors ?? []) {
    const lib = actors.get(a.id);
    if (!lib) continue;
    for (const [path, bytes] of lib.files) out.push({ path: `actors/${a.id}/${path}`, bytes });
  }
  // One copy per id, even if several actors share a character.
  const seen = new Set();
  return out.filter((e) => !seen.has(e.path) && seen.add(e.path));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'actor';

/**
 * Adds a character to the scene from its work file (`name` is the file's name, `bytes` its data).
 * A stage bone and slot named after the actor are created at `at` (world), the slot on top of the
 * draw order. Returns the new actor.
 */
export async function addActor(app, name, bytes, at = [0, 0]) {
  const files = unzip(bytes);
  const doc = app.doc;
  doc.scene ??= emptyScene();
  const base = slug(name.replace(/\.rigby$/i, ''));
  let id = base;
  for (let n = 2; actors.has(id); n++) id = `${base}${n}`;
  const actorDoc = await loadActor(id, files, app.images);
  const raw = actorDoc.name && actorDoc.name !== 'untitled' ? actorDoc.name : base;
  const actor = addActorToStage(doc, { id, name: raw[0].toUpperCase() + raw.slice(1), source: name, at, ground: groundOffset(actorDoc) });
  return actor;
}

/** Removes an actor with its stage bone and slot (the bone only when nothing else uses it). */
export function removeActor(app, actor) {
  const doc = app.doc;
  doc.scene.actors = doc.scene.actors.filter((a) => a !== actor);
  const s = doc.slotIndex(actor.slot);
  if (s !== null) {
    doc.slots.splice(s, 1);
    for (const anim of doc.animations) {
      anim.slots = anim.slots.filter((t) => t.slot !== s).map((t) => (t.slot > s ? { ...t, slot: t.slot - 1 } : t));
      anim.drawOrder = [];
    }
  }
  const b = doc.boneIndex(actor.bone);
  if (b !== null && b > 0 && !doc.slots.some((x) => x.bone === b) && !doc.bones.some((x) => x.parent === b)) {
    doc.bones.splice(b, 1);
    for (const x of doc.slots) if (x.bone > b) x.bone--;
    for (const x of doc.bones) if (x.parent !== null && x.parent > b) x.parent--;
    for (const anim of doc.animations) anim.bones = anim.bones.filter((t) => t.bone !== b).map((t) => (t.bone > b ? { ...t, bone: t.bone - 1 } : t));
  }
  if (!doc.scene.actors.some((a) => a.id === actor.id)) actors.delete(actor.id);
}

/** The actor whose anchor bone is `bone` (an index of the stage), if any. */
export function actorOfBone(doc, bone) {
  const name = doc.bones[bone]?.name;
  return name === undefined ? null : (doc.scene?.actors.find((a) => a.bone === name) ?? null);
}

// ---- posing ------------------------------------------------------------------------------------

/** Per-actor poses kept across frames (physics state lives in them). */
const poses = new Map();

/**
 * Poses every actor for the stage pose `stagePose` at the editor's time (setup poses outside
 * Animate mode). Physics runs while playing (`physicsDelta` seconds since the last frame).
 * Returns Map actor name -> { actor, doc, pose }.
 */
export function poseActors(app, stagePose, physicsDelta = 0) {
  const out = new Map();
  const scene = app.doc.scene;
  if (!scene?.actors.length) return out;
  const anim = app.mode === 'animate' ? app.currentAnimation() : null;
  for (const actor of scene.actors) {
    const lib = actors.get(actor.id);
    if (!lib) continue;
    let pose = poses.get(actor.name);
    if (!pose || pose.local?.length !== lib.doc.bones.length) poses.set(actor.name, (pose = new Pose(lib.doc)));
    if (!app.playing) pose.resetPhysics();
    poseActor(app.doc, stagePose, actor, lib.doc, anim?.name ?? '', anim ? app.time : -1, pose, app.playing ? physicsDelta : 0);
    out.set(actor.name, { actor, doc: lib.doc, pose });
  }
  return out;
}

/** World bounds [x0, y0, x1, y1] of a posed actor, or null. */
export function actorBounds(doc, pose) {
  let b = null;
  for (const q of pose.quads(doc)) {
    for (const [x, y] of q.positions) b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
  }
  return b;
}

// ---- audio --------------------------------------------------------------------------------------

/**
 * Audio carried by actor clips in `shot`: each clip of an animation with audio tracks plays them
 * from where the clip starts (offset by its in point) until it ends. Clips at another speed than 1
 * stay silent. Returns tracks { sound, offset, volume, from, duration } for startAudio / mixBuffer.
 */
export function clipTracks(doc, shot) {
  const out = [];
  for (const actor of doc.scene?.actors ?? []) {
    const lib = actors.get(actor.id);
    if (!lib) continue;
    for (const clip of actor.clips[shot] ?? []) {
      if (Math.abs(clip.speed - 1) > 1e-6) continue;
      const anim = lib.doc.animations.find((a) => a.name === clip.animation);
      if (!anim) continue;
      const out0 = clip.out ?? anim.duration;
      const length = clip.loops === 0 ? Infinity : Math.max(0, out0 - clip.in);
      for (const t of lib.doc.audio.filter((x) => x.animation === clip.animation)) {
        const sound = soundKey(actor.id, t.sound);
        if (!sounds.get(sound)?.buffer) continue;
        // Where the sound sits on the scene timeline, and which part of it the clip lets through.
        const at = clip.start + t.offset - clip.in;
        const from = Math.max(0, clip.in - t.offset);
        const start = Math.max(at, clip.start);
        out.push({ sound, offset: start, volume: t.volume, from, duration: Number.isFinite(length) ? Math.max(0, clip.start + length - start) : undefined });
      }
    }
  }
  return out;
}
