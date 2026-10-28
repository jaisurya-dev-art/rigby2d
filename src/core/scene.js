// SPDX-License-Identifier: MIT OR Apache-2.0
// Scene composition: several characters (actors) acting together on a stage, with a camera,
// layered backgrounds and parallax.
//
// The stage is an ordinary skeleton: background and prop images are slots on its bones, the camera
// is its `camera` bone and its animations are the scene's shots. Each actor is a whole character
// project placed on the stage:
//   - it stands on an anchor bone of the stage (move, turn, scale and flip it by animating that bone),
//   - it is drawn where its slot sits in the stage's draw order (draw-order keys let actors pass in
//     front of each other; the slot's color tints and fades the actor),
//   - it plays clips of its own animations on the scene's timeline, NLE-style: each clip has a start,
//     an in and out point, a speed, a loop count and a crossfade from the clip before.
// Top-level stage bones can have a depth: under a moving camera, deeper layers drift less (parallax)
// while keeping the size they were drawn at.
//
// No DOM: the editor, the offline renderer, the MCP server and games share this file.

import { Affine, transform } from './math.js';
import { makeSlot } from './model.js';
import { Pose } from './pose.js';

/** Default distance from the camera to the picture plane, in world units (parallax strength). */
export const DEFAULT_FOCAL = 1000;

/** A clip with defaults for missing or invalid fields, or null when it has no animation. */
export function readClip(c) {
  if (!c || typeof c.animation !== 'string' || !c.animation) return null;
  const num = (v, def, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : def);
  const out = {
    animation: c.animation,
    start: num(c.start, 0, 0),
    in: num(c.in, 0, 0),
    out: c.out === null || c.out === undefined ? null : num(c.out, null, 0),
    speed: num(c.speed, 1, 0.01),
    loops: Math.round(num(c.loops, 1, 0)),
    blend: num(c.blend, 0.2, 0),
  };
  return out;
}

/** A scene with defaults (see the top of this file), or null for none. */
export function readScene(o) {
  if (!o || typeof o !== 'object') return null;
  const actors = (Array.isArray(o.actors) ? o.actors : [])
    .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.bone === 'string' && typeof a.slot === 'string')
    .map((a) => ({
      id: a.id,
      name: a.name,
      bone: a.bone,
      slot: a.slot,
      source: typeof a.source === 'string' ? a.source : null,
      skin: typeof a.skin === 'string' && a.skin ? a.skin : null,
      flip: !!a.flip,
      clips: Object.fromEntries(
        Object.entries(a.clips && typeof a.clips === 'object' ? a.clips : {}).map(([shot, list]) => [
          shot,
          (Array.isArray(list) ? list : [])
            .map(readClip)
            .filter(Boolean)
            .sort((x, y) => x.start - y.start),
        ]),
      ),
    }));
  const depth = {};
  for (const [bone, z] of Object.entries(o.depth && typeof o.depth === 'object' ? o.depth : {})) if (typeof z === 'number' && Number.isFinite(z) && z > -DEFAULT_FOCAL * 0.95) depth[bone] = z;
  const focal = typeof o.focal === 'number' && o.focal > 0 ? o.focal : DEFAULT_FOCAL;
  return { actors, depth, focal };
}

/** A new, empty scene. */
export function emptyScene() {
  return { actors: [], depth: {}, focal: DEFAULT_FOCAL };
}

/** `want`, or `want 2`, `want 3`… whichever `taken` does not reject. */
function unique(taken, want) {
  let n = want;
  for (let k = 2; taken(n); k++) n = `${want} ${k}`;
  return n;
}

/**
 * Puts a character on the stage: creates its anchor bone (a child of the root at `at`, in world
 * units) and its slot (on top of the draw order), both named after the actor, and adds the actor to
 * the scene (created if needed). `id` names the character's stored files. Returns the actor.
 */
export function addActorToStage(stage, { id, name, source = null, at = [0, 0] }) {
  stage.scene ??= emptyScene();
  const actorName = unique((n) => stage.scene.actors.some((a) => a.name === n), name);
  const bone = unique((n) => stage.bones.some((b) => b.name === n), actorName);
  const slot = unique((n) => stage.slots.some((s) => s.name === n), actorName);
  stage.bones.push({ name: bone, parent: 0, length: 0, setup: transform(at[0], at[1], 0), inherit: 'normal', skinRequired: false, color: 'ff8cd9ff' });
  stage.slots.push(makeSlot(slot, stage.bones.length - 1, null));
  const actor = { id, name: actorName, bone, slot, source, skin: null, flip: false, clips: {} };
  stage.scene.actors.push(actor);
  return actor;
}

// ---- clips --------------------------------------------------------------------------------------

/** The part of the animation a clip plays: [in, out] in animation seconds. */
export function clipSpan(clip, anim) {
  const end = anim ? anim.duration : 0;
  const out = clip.out === null ? end : Math.min(clip.out, end || clip.out);
  return [Math.min(clip.in, out), out];
}

/** How long a clip lasts on the scene timeline (Infinity for loops = 0, which repeats until the next clip). */
export function clipLength(clip, anim) {
  const [a, b] = clipSpan(clip, anim);
  if (clip.loops === 0) return Infinity;
  return ((b - a) * clip.loops) / clip.speed;
}

/** The animation time a clip shows at scene time `t` (holding its last frame once it is over). */
export function clipTime(clip, anim, t) {
  const [a, b] = clipSpan(clip, anim);
  const span = b - a;
  const local = Math.max(0, t - clip.start) * clip.speed;
  if (span <= 0) return a;
  const total = clip.loops === 0 ? Infinity : span * clip.loops;
  if (local >= total) return b;
  const r = local % span;
  // Exactly at the end of a loop (but not the last one) shows the start of the next.
  return a + r;
}

/**
 * What an actor shows at scene time `t` in `shot`: { clip, time } for the current clip and, while
 * crossfading from the clip before, `from: { clip, time }` and `alpha` (0 = all `from`, 1 = all
 * current). Null before the first clip (the actor stands in its setup pose).
 */
export function actorStateAt(actor, actorDoc, shot, t) {
  const clips = actor.clips[shot] ?? [];
  let k = -1;
  for (let i = 0; i < clips.length; i++) if (clips[i].start <= t + 1e-9) k = i;
  if (k < 0) return null;
  const anim = (c) => actorDoc.animations.find((x) => x.name === c.animation);
  const cur = clips[k];
  const state = { clip: cur, anim: anim(cur), time: clipTime(cur, anim(cur), t), from: null, alpha: 1 };
  if (k > 0 && cur.blend > 0 && t - cur.start < cur.blend) {
    const prev = clips[k - 1];
    state.from = { clip: prev, anim: anim(prev), time: clipTime(prev, anim(prev), t) };
    state.alpha = Math.max(0, Math.min(1, (t - cur.start) / cur.blend));
  }
  return state;
}

/** The scene time an actor's clips end in `shot` (finite clips only), for the shot's length. */
export function actorEnd(actor, actorDoc, shot) {
  let end = 0;
  for (const c of actor.clips[shot] ?? []) {
    const len = clipLength(c, actorDoc.animations.find((x) => x.name === c.animation));
    end = Math.max(end, c.start + (Number.isFinite(len) ? len : 0));
  }
  return end;
}

// ---- posing -------------------------------------------------------------------------------------

/** The placement of an actor: its anchor bone's world transform, mirrored when flipped. */
export function actorPlacement(stage, stagePose, actor) {
  const b = stage.bones.findIndex((x) => x.name === actor.bone);
  const w = b >= 0 ? stagePose.world[b].clone() : new Affine();
  if (actor.flip) {
    w.a = -w.a;
    w.b = -w.b;
  }
  return w;
}

/**
 * Poses an actor at scene time `t`: resets `pose`, applies its clip (crossfading from the previous
 * one), places it on its anchor bone and updates world transforms, simulating `physicsDelta`
 * seconds of physics. Returns the pose.
 */
export function poseActor(stage, stagePose, actor, actorDoc, shot, t, pose, physicsDelta = 0) {
  if (actor.skin !== null && actorDoc.skins.some((s) => s.name === actor.skin)) actorDoc.skin = actor.skin;
  pose.reset(actorDoc);
  const st = actorStateAt(actor, actorDoc, shot, t);
  if (st?.from?.anim) pose.apply(actorDoc, st.from.anim, st.from.time, 1);
  if (st?.anim) pose.apply(actorDoc, st.anim, st.time, st.from?.anim ? st.alpha : 1);
  // A pose made with `new Pose(actorDoc)` simulated its setup pose at the origin: start physics
  // afresh where the actor stands, or its hair would whip across the stage on the first frame.
  if (!pose.placement) pose.resetPhysics();
  pose.placement = actorPlacement(stage, stagePose, actor);
  pose.physicsDelta = physicsDelta;
  pose.updateWorld(actorDoc);
  return pose;
}

// ---- parallax -----------------------------------------------------------------------------------

/** Depth factor of a layer at depth `z`: how much of the camera's motion it keeps up with. */
export function depthFactor(z, focal = DEFAULT_FOCAL) {
  return focal / (focal + z);
}

/** World position of the stage's `camera` bone in `pose`, or null when there is none. */
export function cameraPosition(stage, pose) {
  const c = stage.bones.findIndex((b) => b.name === 'camera');
  return c >= 0 ? pose.world[c].apply([0, 0]) : null;
}

/**
 * Applies parallax to a posed stage: every bone with a depth moves, with its children, by
 * (1 - depthFactor) of how far the camera has moved from its setup position, so deep layers drift
 * behind near ones while keeping their drawn size. Does nothing without a camera bone or depths.
 */
export function applyParallax(stage, scene, pose, setupCamera) {
  if (!scene || !Object.keys(scene.depth).length) return;
  const cam = cameraPosition(stage, pose);
  if (!cam || !setupCamera) return;
  const dx = cam[0] - setupCamera[0];
  const dy = cam[1] - setupCamera[1];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
  const desired = new Map();
  for (const [name, z] of Object.entries(scene.depth)) {
    const b = stage.bones.findIndex((x) => x.name === name);
    if (b < 0 || !z) continue;
    const k = 1 - depthFactor(z, scene.focal);
    const w = pose.world[b].clone();
    w.tx += dx * k;
    w.ty += dy * k;
    desired.set(b, w);
  }
  if (desired.size) pose.setWorlds(stage, desired);
}

/** The camera bone's setup-pose world position, the reference for parallax. */
export function setupCameraPosition(stage) {
  return cameraPosition(stage, new Pose(stage));
}

// ---- playback -----------------------------------------------------------------------------------

/**
 * Plays a composed scene: the stage animation (`shot`), parallax and every actor's clips. For games
 * and players; the editor uses the same functions.
 *
 *   const player = new ScenePlayer(stage, actorDocs);   // actorDocs: Map actor id -> Skeleton
 *   player.play('intro');
 *   // every frame:
 *   player.update(dt);
 *   player.draw((sk, pose, actor) => renderer.drawSkeleton(sk, pose, lookupFor(actor)));
 */
export class ScenePlayer {
  constructor(stage, actorDocs) {
    this.stage = stage;
    this.scene = stage.scene ?? emptyScene();
    this.actorDocs = actorDocs;
    this.pose = new Pose(stage);
    this.actorPoses = new Map(this.scene.actors.map((a) => [a.id, actorDocs.get(a.id) ? new Pose(actorDocs.get(a.id)) : null]));
    this.setupCamera = setupCameraPosition(stage);
    this.shot = stage.animations[0]?.name ?? null;
    this.time = 0;
    this.looping = false;
    this.pending = 0;
  }

  play(shot, looping = false) {
    this.shot = shot;
    this.time = 0;
    this.looping = looping;
    for (const p of this.actorPoses.values()) p?.resetPhysics();
    this.evaluate(0);
  }

  /** The shot's length: its stage animation, or the end of its last finite clip if later. */
  duration() {
    const anim = this.stage.animations.find((a) => a.name === this.shot);
    let end = anim?.duration ?? 0;
    for (const a of this.scene.actors) if (this.actorDocs.get(a.id)) end = Math.max(end, actorEnd(a, this.actorDocs.get(a.id), this.shot));
    return end;
  }

  update(dt) {
    let t = this.time + dt;
    const d = this.duration();
    if (d > 0 && t > d) t = this.looping ? t % d : d;
    this.time = t;
    this.evaluate(dt);
  }

  evaluate(dt) {
    const anim = this.stage.animations.find((a) => a.name === this.shot);
    this.pose.reset(this.stage);
    if (anim) this.pose.apply(this.stage, anim, Math.min(this.time, anim.duration), 1);
    this.pose.physicsDelta = dt;
    this.pose.updateWorld(this.stage);
    applyParallax(this.stage, this.scene, this.pose, this.setupCamera);
    for (const a of this.scene.actors) {
      const doc = this.actorDocs.get(a.id);
      const pose = this.actorPoses.get(a.id);
      if (doc && pose) poseActor(this.stage, this.pose, a, doc, this.shot, this.time, pose, dt);
    }
  }

  /**
   * Calls `drawStage(from, to)` for runs of stage slots and `drawActor(doc, pose, actor, tint)` at
   * each actor's slot, back to front. Simpler: `draw(fn)` with fn(sk, pose, actor) (see above).
   */
  forEachLayer(drawActor) {
    for (const item of sceneDrawList(this.stage, this.scene, this.pose)) {
      if (!item.actor) continue;
      const doc = this.actorDocs.get(item.actor.id);
      const pose = this.actorPoses.get(item.actor.id);
      if (doc && pose) drawActor(doc, pose, item.actor, item.tint);
    }
  }
}

/**
 * The stage's draw order with actors in place: [{ slot, actor (or null), tint }] back to front.
 * An actor is drawn at its slot, tinted by the slot's color. Hidden when its slot's alpha is 0.
 */
export function sceneDrawList(stage, scene, pose) {
  const bySlot = new Map((scene?.actors ?? []).map((a) => [a.slot, a]));
  const out = [];
  for (const i of pose.drawOrder) {
    const slot = stage.slots[i];
    if (!slot) continue;
    const actor = bySlot.get(slot.name) ?? null;
    out.push({ slot: i, actor, tint: pose.color[i] });
  }
  return out;
}

/** Map slot index -> actor for a scene (for renderers that walk the stage's draw order). */
export function actorSlots(stage, scene) {
  const out = new Map();
  for (const a of scene?.actors ?? []) {
    const i = stage.slots.findIndex((s) => s.name === a.slot);
    if (i >= 0) out.set(i, a);
  }
  return out;
}
