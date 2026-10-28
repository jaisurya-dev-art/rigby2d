// SPDX-License-Identifier: MIT OR Apache-2.0
//! Scene composition: several characters (actors) acting together on a stage, with a camera and
//! parallax. A port of `src/core/scene.js`; it must match it frame by frame.
//!
//! The stage is an ordinary skeleton (backgrounds and props are its slots, the camera is its
//! `camera` bone, its animations are the shots). Each actor is a character skeleton placed on an
//! anchor bone of the stage, drawn where its slot sits in the stage's draw order, playing clips of
//! its own animations on the scene timeline. Scenes are exported from the editor as
//! `<name>.scene.json` (the manifest) next to the stage and character skeletons.
//!
//! ```no_run
//! use rigby_runtime::scene::load_scene;
//! let dir = std::path::Path::new("export");
//! let manifest = std::fs::read(dir.join("street.scene.json")).unwrap();
//! let mut player = load_scene(&manifest, |file| std::fs::read(dir.join(file)).map_err(|e| e.to_string())).unwrap();
//! player.play("intro", true);
//! player.update(1.0 / 60.0);
//! for layer in player.draw_list() {
//!     // draw stage slot `layer.slot`, or the character of `layer.actor` tinted by `layer.tint`
//! }
//! ```

use crate::json::Json;
use crate::math::Affine;
use crate::model::{Animation, SkeletonData};
use crate::pose::Pose;
use crate::reader::LoadError;

/// Default distance from the camera to the picture plane, in world units (parallax strength).
pub const DEFAULT_FOCAL: f64 = 1000.0;
/// Newest scene manifest format this runtime reads.
pub const SCENE_FORMAT: f64 = 1.0;

/// A clip of an actor's animation on the scene timeline.
#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub animation: String,
    /// Scene time the clip starts.
    pub start: f64,
    /// In and out points in animation seconds (out None = the animation's end).
    pub in_point: f64,
    pub out_point: Option<f64>,
    pub speed: f64,
    /// Times played; 0 repeats until the next clip.
    pub loops: i64,
    /// Crossfade from the clip before, in seconds.
    pub blend: f64,
}

/// A character placed on the stage.
#[derive(Clone, Debug, PartialEq)]
pub struct Actor {
    pub id: String,
    pub name: String,
    /// The stage bone it stands on and the stage slot it is drawn at.
    pub bone: String,
    pub slot: String,
    /// The character's skeleton file, relative to the manifest.
    pub skeleton: Option<String>,
    pub skin: Option<String>,
    pub flip: bool,
    /// How far the character is raised so its feet stand on the anchor.
    pub ground: f64,
    /// Clips by shot (stage animation name), sorted by start.
    pub clips: Vec<(String, Vec<Clip>)>,
}

impl Actor {
    pub fn clips(&self, shot: &str) -> &[Clip] {
        self.clips.iter().find(|(s, _)| s == shot).map(|(_, c)| c.as_slice()).unwrap_or(&[])
    }
}

/// A composed scene: its actors and the depth of stage layers for parallax.
#[derive(Clone, Debug, PartialEq)]
pub struct Scene {
    pub actors: Vec<Actor>,
    /// Depth by top-level stage bone name.
    pub depth: Vec<(String, f64)>,
    pub focal: f64,
}

/// A finite number of at least `min`, else `def` (like `readClip` in scene.js).
fn num(v: &Json, def: f64, min: f64) -> f64 {
    match v.as_f64() {
        Some(n) if n.is_finite() && n >= min => n,
        _ => def,
    }
}

/// Rounds like JavaScript's `Math.round` (halves up).
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// A clip with defaults for missing or invalid fields, or None when it has no animation.
pub fn read_clip(c: &Json) -> Option<Clip> {
    let animation = c.get("animation").as_str().filter(|s| !s.is_empty())?;
    let out = c.get("out");
    Some(Clip {
        animation: animation.to_string(),
        start: num(c.get("start"), 0.0, 0.0),
        in_point: num(c.get("in"), 0.0, 0.0),
        out_point: if out.is_null() { None } else { Some(num(out, f64::NAN, 0.0)).filter(|v| !v.is_nan()) },
        speed: num(c.get("speed"), 1.0, 0.01),
        loops: js_round(num(c.get("loops"), 1.0, 0.0)) as i64,
        blend: num(c.get("blend"), 0.2, 0.0),
    })
}

/// A scene with defaults (see `readScene` in scene.js).
pub fn read_scene(o: &Json) -> Scene {
    let mut actors = Vec::new();
    for a in o.get("actors").as_array() {
        let (Some(id), Some(name), Some(bone), Some(slot)) = (a.get("id").as_str(), a.get("name").as_str(), a.get("bone").as_str(), a.get("slot").as_str()) else { continue };
        let clips = a
            .get("clips")
            .entries()
            .iter()
            .map(|(shot, list)| {
                let mut v: Vec<Clip> = list.as_array().iter().filter_map(read_clip).collect();
                v.sort_by(|x, y| x.start.partial_cmp(&y.start).unwrap_or(std::cmp::Ordering::Equal));
                (shot.clone(), v)
            })
            .collect();
        let ground = a.get("ground").as_f64().filter(|g| g.is_finite()).unwrap_or(0.0);
        actors.push(Actor {
            id: id.to_string(),
            name: name.to_string(),
            bone: bone.to_string(),
            slot: slot.to_string(),
            skeleton: a.get("skeleton").as_str().map(str::to_string),
            skin: a.get("skin").as_str().filter(|s| !s.is_empty()).map(str::to_string),
            flip: a.truthy("flip"),
            ground,
            clips,
        });
    }
    let depth = o
        .get("depth")
        .entries()
        .iter()
        .filter_map(|(bone, z)| z.as_f64().filter(|z| z.is_finite() && *z > -DEFAULT_FOCAL * 0.95).map(|z| (bone.clone(), z)))
        .collect();
    let focal = o.get("focal").as_f64().filter(|f| *f > 0.0).unwrap_or(DEFAULT_FOCAL);
    Scene { actors, depth, focal }
}

/// A scene manifest (`<name>.scene.json`): the stage skeleton's file and the scene.
#[derive(Clone, Debug, PartialEq)]
pub struct SceneManifest {
    pub stage: String,
    pub scene: Scene,
}

pub fn read_scene_manifest(bytes: &[u8]) -> Result<SceneManifest, LoadError> {
    let text = std::str::from_utf8(bytes).map_err(|_| LoadError("the scene manifest is not UTF-8".into()))?;
    let o = Json::parse(text).map_err(|e| LoadError(format!("invalid JSON: {e}")))?;
    let Some(format) = o.get("rigbyScene").as_f64() else { return Err(LoadError("not a Rigby2D scene manifest".into())) };
    if format > SCENE_FORMAT {
        return Err(LoadError(format!("scene format {format} is newer than this runtime ({SCENE_FORMAT})")));
    }
    let stage = o.get("stage").as_str().ok_or_else(|| LoadError("the scene manifest names no stage skeleton".into()))?;
    Ok(SceneManifest { stage: stage.to_string(), scene: read_scene(&o) })
}

/// Loads an exported scene. `read(file)` returns the bytes of a file named in the manifest
/// (relative to it): the stage and character skeletons (JSON or `.skel`).
pub fn load_scene<E: std::fmt::Display>(manifest: &[u8], mut read: impl FnMut(&str) -> Result<Vec<u8>, E>) -> Result<ScenePlayer, LoadError> {
    let m = read_scene_manifest(manifest)?;
    let mut load = |file: &str| -> Result<SkeletonData, LoadError> {
        let bytes = read(file).map_err(|e| LoadError(format!("{file}: {e}")))?;
        crate::load_skeleton(&bytes).map_err(|e| LoadError(format!("{file}: {}", e.0)))
    };
    let stage = load(&m.stage)?;
    let mut characters: Vec<(String, SkeletonData)> = Vec::new();
    for a in &m.scene.actors {
        if characters.iter().any(|(id, _)| *id == a.id) {
            continue;
        }
        if let Some(file) = &a.skeleton {
            characters.push((a.id.clone(), load(file)?));
        }
    }
    Ok(ScenePlayer::new(stage, m.scene, characters))
}

// ---- clips ---------------------------------------------------------------------------------------

/// The part of the animation a clip plays: (in, out) in animation seconds.
pub fn clip_span(clip: &Clip, anim: Option<&Animation>) -> (f64, f64) {
    let end = anim.map_or(0.0, |a| a.duration);
    let out = match clip.out_point {
        None => end,
        Some(o) => o.min(if end != 0.0 && !end.is_nan() { end } else { o }),
    };
    (clip.in_point.min(out), out)
}

/// How long a clip lasts on the scene timeline (infinite for loops = 0).
pub fn clip_length(clip: &Clip, anim: Option<&Animation>) -> f64 {
    let (a, b) = clip_span(clip, anim);
    if clip.loops == 0 {
        return f64::INFINITY;
    }
    ((b - a) * clip.loops as f64) / clip.speed
}

/// The animation time a clip shows at scene time `t` (holding its last frame once it is over).
pub fn clip_time(clip: &Clip, anim: Option<&Animation>, t: f64) -> f64 {
    let (a, b) = clip_span(clip, anim);
    let span = b - a;
    let local = (t - clip.start).max(0.0) * clip.speed;
    if span <= 0.0 {
        return a;
    }
    let total = if clip.loops == 0 { f64::INFINITY } else { span * clip.loops as f64 };
    if local >= total {
        return b;
    }
    a + local % span
}

/// What an actor shows at a scene time: the current clip's animation and time and, while
/// crossfading, the previous clip's (`from`) with `alpha` (0 = all `from`, 1 = all current).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ActorState {
    pub anim: Option<usize>,
    pub time: f64,
    pub from: Option<(usize, f64)>,
    pub alpha: f64,
}

/// The actor's state at scene time `t` in `shot`, or None before its first clip (setup pose).
pub fn actor_state_at(actor: &Actor, data: &SkeletonData, shot: &str, t: f64) -> Option<ActorState> {
    let clips = actor.clips(shot);
    let k = clips.iter().rposition(|c| c.start <= t + 1e-9)?;
    let anim = |c: &Clip| data.find_animation(&c.animation);
    let get = |i: Option<usize>| i.map(|i| &data.animations[i]);
    let cur = &clips[k];
    let mut state = ActorState { anim: anim(cur), time: clip_time(cur, get(anim(cur)), t), from: None, alpha: 1.0 };
    if k > 0 && cur.blend > 0.0 && t - cur.start < cur.blend {
        let prev = &clips[k - 1];
        if let Some(p) = anim(prev) {
            state.from = Some((p, clip_time(prev, get(Some(p)), t)));
        }
        state.alpha = ((t - cur.start) / cur.blend).clamp(0.0, 1.0);
    }
    Some(state)
}

/// The scene time an actor's finite clips end in `shot`.
pub fn actor_end(actor: &Actor, data: &SkeletonData, shot: &str) -> f64 {
    let mut end: f64 = 0.0;
    for c in actor.clips(shot) {
        let len = clip_length(c, data.find_animation(&c.animation).map(|i| &data.animations[i]));
        end = end.max(c.start + if len.is_finite() { len } else { 0.0 });
    }
    end
}

// ---- posing --------------------------------------------------------------------------------------

/// The placement of an actor: its anchor bone's world transform, mirrored when flipped, raised by
/// its ground offset.
pub fn actor_placement(stage: &SkeletonData, stage_pose: &Pose, actor: &Actor) -> Affine {
    let mut w = stage.find_bone(&actor.bone).map_or(Affine::IDENTITY, |b| stage_pose.world[b]);
    if actor.flip {
        w.a = -w.a;
        w.b = -w.b;
    }
    let g = actor.ground;
    if g != 0.0 {
        w.tx += w.c * g;
        w.ty += w.d * g;
    }
    w
}

/// Poses an actor at scene time `t`: resets `pose`, applies its clip (crossfading from the previous
/// one), places it on its anchor bone and updates world transforms, simulating `physics_delta`
/// seconds of physics.
#[allow(clippy::too_many_arguments)]
pub fn pose_actor(stage: &SkeletonData, stage_pose: &Pose, actor: &Actor, data: &SkeletonData, shot: &str, t: f64, pose: &mut Pose, physics_delta: f64) {
    if let Some(skin) = actor.skin.as_deref().and_then(|s| data.find_skin(s)) {
        pose.skin = Some(skin);
    }
    pose.reset(data);
    let st = actor_state_at(actor, data, shot, t);
    if let Some(st) = st {
        if let Some((from, time)) = st.from {
            pose.apply(data, from, time, 1.0);
        }
        if let Some(anim) = st.anim {
            pose.apply(data, anim, st.time, if st.from.is_some() { st.alpha } else { 1.0 });
        }
    }
    // A new pose simulated its setup pose at the origin: start physics afresh where the actor stands.
    if pose.placement.is_none() {
        pose.reset_physics();
    }
    pose.placement = Some(actor_placement(stage, stage_pose, actor));
    pose.physics_delta = physics_delta;
    pose.update_world(data);
}

// ---- parallax ------------------------------------------------------------------------------------

/// Depth factor of a layer at depth `z`: how much of the camera's motion it keeps up with.
pub fn depth_factor(z: f64, focal: f64) -> f64 {
    focal / (focal + z)
}

/// World position of the stage's `camera` bone, or None when there is none.
pub fn camera_position(stage: &SkeletonData, pose: &Pose) -> Option<(f64, f64)> {
    stage.find_bone("camera").map(|c| pose.world[c].apply(0.0, 0.0))
}

/// Moves every bone with a depth, with its children, by (1 - depth factor) of how far the camera
/// has moved from `setup_camera`.
pub fn apply_parallax(stage: &SkeletonData, scene: &Scene, pose: &mut Pose, setup_camera: Option<(f64, f64)>) {
    if scene.depth.is_empty() {
        return;
    }
    let (Some(cam), Some(setup)) = (camera_position(stage, pose), setup_camera) else { return };
    let (dx, dy) = (cam.0 - setup.0, cam.1 - setup.1);
    if dx.abs() < 1e-9 && dy.abs() < 1e-9 {
        return;
    }
    let mut desired: Vec<(usize, Affine)> = Vec::new();
    for (name, z) in &scene.depth {
        let Some(b) = stage.find_bone(name) else { continue };
        if *z == 0.0 {
            continue;
        }
        let k = 1.0 - depth_factor(*z, scene.focal);
        let mut w = pose.world[b];
        w.tx += dx * k;
        w.ty += dy * k;
        desired.retain(|d| d.0 != b);
        desired.push((b, w));
    }
    if !desired.is_empty() {
        pose.set_worlds(stage, &desired);
    }
}

/// The camera bone's setup-pose world position, the reference for parallax.
pub fn setup_camera_position(stage: &SkeletonData) -> Option<(f64, f64)> {
    camera_position(stage, &Pose::new(stage))
}

// ---- playback ------------------------------------------------------------------------------------

/// A character of a scene: its skeleton and pose (shared by actors with the same id).
pub struct SceneCharacter {
    pub id: String,
    pub data: SkeletonData,
    pub pose: Pose,
}

/// One entry of the stage's draw order: a stage slot, or the actor drawn at it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SceneLayer {
    pub slot: usize,
    /// Index into `scene.actors` when an actor is drawn here.
    pub actor: Option<usize>,
    /// The slot's color, which tints and fades the actor.
    pub tint: [f64; 4],
}

/// Plays a composed scene: the stage animation (shot), parallax and every actor's clips.
pub struct ScenePlayer {
    pub stage: SkeletonData,
    pub scene: Scene,
    pub pose: Pose,
    pub characters: Vec<SceneCharacter>,
    pub setup_camera: Option<(f64, f64)>,
    pub shot: Option<String>,
    pub time: f64,
    pub looping: bool,
}

impl ScenePlayer {
    pub fn new(stage: SkeletonData, scene: Scene, characters: Vec<(String, SkeletonData)>) -> ScenePlayer {
        let characters = characters
            .into_iter()
            .map(|(id, data)| {
                let pose = Pose::new(&data);
                SceneCharacter { id, data, pose }
            })
            .collect();
        ScenePlayer {
            pose: Pose::new(&stage),
            setup_camera: setup_camera_position(&stage),
            shot: stage.animations.first().map(|a| a.name.clone()),
            stage,
            scene,
            characters,
            time: 0.0,
            looping: false,
        }
    }

    /// The character an actor shows.
    pub fn character(&self, actor: usize) -> Option<&SceneCharacter> {
        let id = &self.scene.actors.get(actor)?.id;
        self.characters.iter().find(|c| c.id == *id)
    }

    /// Starts a shot from its beginning.
    pub fn play(&mut self, shot: &str, looping: bool) {
        self.shot = Some(shot.to_string());
        self.time = 0.0;
        self.looping = looping;
        for c in &mut self.characters {
            c.pose.reset_physics();
        }
        self.evaluate(0.0);
    }

    /// The shot's length: its stage animation, or the end of its last finite clip if later.
    pub fn duration(&self) -> f64 {
        let shot = self.shot.as_deref().unwrap_or("");
        let mut end = self.stage.find_animation(shot).map_or(0.0, |a| self.stage.animations[a].duration);
        for a in &self.scene.actors {
            if let Some(c) = self.characters.iter().find(|c| c.id == a.id) {
                end = end.max(actor_end(a, &c.data, shot));
            }
        }
        end
    }

    /// Advances the scene by `dt` seconds (looping or holding at the end) and poses everything.
    pub fn update(&mut self, dt: f64) {
        let mut t = self.time + dt;
        let d = self.duration();
        if d > 0.0 && t > d {
            t = if self.looping { t % d } else { d };
        }
        self.time = t;
        self.evaluate(dt);
    }

    /// Poses the stage and every actor at the current time, simulating `dt` seconds of physics.
    pub fn evaluate(&mut self, dt: f64) {
        let shot = self.shot.clone().unwrap_or_default();
        self.pose.reset(&self.stage);
        if let Some(a) = self.stage.find_animation(&shot) {
            self.pose.apply(&self.stage, a, self.time.min(self.stage.animations[a].duration), 1.0);
        }
        self.pose.physics_delta = dt;
        self.pose.update_world(&self.stage);
        apply_parallax(&self.stage, &self.scene, &mut self.pose, self.setup_camera);
        for a in &self.scene.actors {
            if let Some(c) = self.characters.iter_mut().find(|c| c.id == a.id) {
                pose_actor(&self.stage, &self.pose, a, &c.data, &shot, self.time, &mut c.pose, dt);
            }
        }
    }

    /// The stage's draw order with actors in place, back to front.
    pub fn draw_list(&self) -> Vec<SceneLayer> {
        scene_draw_list(&self.stage, &self.scene, &self.pose)
    }
}

/// The stage's draw order with actors at their slots, back to front.
pub fn scene_draw_list(stage: &SkeletonData, scene: &Scene, pose: &Pose) -> Vec<SceneLayer> {
    pose.draw_order
        .iter()
        .filter(|&&i| i < stage.slots.len())
        .map(|&i| SceneLayer { slot: i, actor: scene.actors.iter().rposition(|a| a.slot == stage.slots[i].name), tint: pose.color[i] })
        .collect()
}
