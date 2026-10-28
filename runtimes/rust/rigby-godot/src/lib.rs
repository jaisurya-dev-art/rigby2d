// SPDX-License-Identifier: MIT OR Apache-2.0
//! Rigby2D runtime for Godot 4: the `RigbySkeleton2D` node plays skeleton JSON / binary `.skel`
//! exports with their `.atlas`, and `RigbyScene2D` plays scenes exported from the editor
//! (`.scene.json`: a stage, several characters, clips, camera and parallax). Both use the Rust
//! runtime (`rigby-runtime`) for animation and the RenderingServer for drawing (one mesh per atlas
//! page and blend mode run, two-color tint and premultiplied-alpha pages handled by a small shader).

use godot::classes::rendering_server::{ArrayCustomFormat, ArrayFormat, CanvasItemTextureFilter, PrimitiveType};
use godot::classes::{FileAccess, INode2D, Node2D, RenderingServer, Texture2D};
use godot::prelude::*;
use rigby_runtime::model::Blend;
use rigby_runtime::scene::{load_scene, read_scene_manifest, ScenePlayer};
use rigby_runtime::{load_skeleton, Atlas, AnimationState, Pose, RegionLookup, RenderOutput, SkeletonData, StateEventKind};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

struct RigbyExtension;

#[gdextension]
unsafe impl ExtensionLibrary for RigbyExtension {
    fn on_stage_deinit(stage: InitStage) {
        // Release cached textures and shaders while the engine is still running.
        if stage == InitStage::Scene {
            CACHE.with(|c| c.borrow_mut().clear());
            SHADERS.with(|s| {
                let mut rs = RenderingServer::singleton();
                for (_, shader) in s.borrow_mut().drain() {
                    rs.free_rid(shader);
                }
            });
        }
    }
}

/// An atlas loaded for a skeleton: where its images are and the page textures.
struct Pages {
    lookup: RegionLookup,
    textures: Vec<Gd<Texture2D>>,
    pma: Vec<bool>,
    filters: Vec<CanvasItemTextureFilter>,
}

/// Loaded skeleton data with its atlas, shared by every node using the same files.
struct Loaded {
    data: SkeletonData,
    pages: Pages,
}

thread_local! {
    static CACHE: RefCell<HashMap<(String, String), Rc<Loaded>>> = RefCell::new(HashMap::new());
    static SHADERS: RefCell<HashMap<Blend, Rid>> = RefCell::new(HashMap::new());
}

fn load_files(skeleton: &str, atlas: &str) -> Result<Rc<Loaded>, String> {
    let key = (skeleton.to_string(), atlas.to_string());
    if let Some(hit) = CACHE.with(|c| c.borrow().get(&key).cloned()) {
        return Ok(hit);
    }
    let bytes = FileAccess::get_file_as_bytes(skeleton);
    if bytes.is_empty() {
        return Err(format!("cannot read '{skeleton}'"));
    }
    let data = load_skeleton(bytes.as_slice()).map_err(|e| format!("'{skeleton}': {e}"))?;
    let atlas_text = FileAccess::get_file_as_string(atlas).to_string();
    if atlas_text.is_empty() {
        return Err(format!("cannot read '{atlas}'"));
    }
    let pages = load_pages(&data, skeleton, atlas, &atlas_text)?;
    for w in &data.warnings {
        godot_warn!("Rigby2D: '{skeleton}': {w}");
    }
    let loaded = Rc::new(Loaded { data, pages });
    CACHE.with(|c| c.borrow_mut().insert(key, loaded.clone()));
    Ok(loaded)
}

/// Loads the page textures of an atlas (from the atlas's folder) for a skeleton.
fn load_pages(data: &SkeletonData, skeleton: &str, atlas: &str, atlas_text: &str) -> Result<Pages, String> {
    let atlas_data = Atlas::parse(atlas_text);
    let dir = atlas.rsplit_once('/').map_or("", |(d, _)| d);
    let mut pages = Vec::new();
    for page in &atlas_data.pages {
        let path = if dir.is_empty() { page.name.clone() } else { format!("{dir}/{}", page.name) };
        let tex = godot::tools::try_load::<Texture2D>(&path).map_err(|e| format!("atlas page '{path}': {e}"))?;
        pages.push(tex);
    }
    let filters = atlas_data
        .pages
        .iter()
        .map(|p| {
            let min = p.filter[0].as_str();
            match (min.starts_with("Nearest"), min.contains("MipMap")) {
                (true, false) => CanvasItemTextureFilter::NEAREST,
                (true, true) => CanvasItemTextureFilter::NEAREST_WITH_MIPMAPS,
                (false, true) => CanvasItemTextureFilter::LINEAR_WITH_MIPMAPS,
                (false, false) => CanvasItemTextureFilter::LINEAR,
            }
        })
        .collect();
    let lookup = RegionLookup::new(data, &atlas_data);
    let missing = lookup.missing(data);
    if !missing.is_empty() {
        godot_warn!("Rigby2D: {} image(s) of '{skeleton}' are not in '{atlas}': {}", missing.len(), missing.join(", "));
    }
    Ok(Pages { pma: atlas_data.pages.iter().map(|p| p.pma).collect(), lookup, textures: pages, filters })
}

/// Canvas shader: two-color tint (texture c maps to light * c + dark * (1 - c)), straight or
/// premultiplied-alpha pages, one render mode per blend mode.
fn shader_for(blend: Blend) -> Rid {
    SHADERS.with(|s| {
        *s.borrow_mut().entry(blend).or_insert_with(|| {
            let (mode, out) = match blend {
                Blend::Normal => ("blend_mix", "COLOR = vec4(rgb, a);"),
                Blend::Additive => ("blend_add", "COLOR = vec4(rgb, a);"),
                // Premultiplied multiply: dst * (c * a + 1 - a).
                Blend::Multiply => ("blend_mul", "COLOR = vec4(mix(vec3(1.0), rgb, a), 1.0);"),
                // Screen has no fixed-function equivalent here: premultiplied, with the brightest
                // channel as coverage (exact for grey, close for colors).
                Blend::Screen => ("blend_premul_alpha", "vec3 p = rgb * a; COLOR = vec4(p, max(p.r, max(p.g, p.b)));"),
            };
            let code = format!(
                "shader_type canvas_item;\nrender_mode {mode};\nuniform bool pma = false;\nvarying vec4 light;\nvarying vec4 dark;\n\
                 void vertex() {{ light = COLOR; dark = CUSTOM0; }}\n\
                 void fragment() {{\n  vec4 t = texture(TEXTURE, UV);\n  vec3 c = pma ? (t.a > 0.0 ? t.rgb / t.a : vec3(0.0)) : t.rgb;\n  float a = t.a * light.a;\n  vec3 rgb = c * light.rgb + (vec3(1.0) - c) * dark.rgb * dark.a;\n  {out}\n}}\n"
            );
            let mut rs = RenderingServer::singleton();
            let shader = rs.shader_create();
            rs.shader_set_code(shader, &code);
            shader
        })
    })
}

/// Plays a Rigby2D skeleton (skeleton JSON or `.skel` export plus `.atlas`).
#[derive(GodotClass)]
#[class(base = Node2D, tool)]
pub struct RigbySkeleton2D {
    base: Base<Node2D>,

    /// Skeleton export: binary `.skel` or skeleton `.json`.
    #[var(set = set_skeleton_file)]
    #[export(file = "*.skel,*.json")]
    skeleton_file: GString,
    /// Texture atlas of the skeleton (its page images are loaded from the same folder).
    #[var(set = set_atlas_file)]
    #[export(file = "*.atlas,*.atlas.txt")]
    atlas_file: GString,
    /// Animation played on track 0 when the node starts (and when changed in the inspector).
    #[var(set = set_animation)]
    #[export]
    animation: GString,
    /// Whether `animation` loops.
    #[var(set = set_looping)]
    #[export]
    looping: bool,
    /// Advances animations every frame (also in the editor, for previews).
    #[var]
    #[export]
    playing: bool,
    /// Playback speed multiplier.
    #[var]
    #[export(range = (0.0, 4.0, 0.01, or_greater))]
    speed: f64,
    /// Skin shown (empty = default skin only).
    #[var(set = set_skin)]
    #[export]
    skin: GString,
    /// Draws bones over the skeleton.
    #[var(set = set_show_bones)]
    #[export]
    show_bones: bool,

    loaded: Option<Rc<Loaded>>,
    pose: Option<Pose>,
    state: AnimationState,
    out: RenderOutput,
    canvas: Canvas,
    load_error: Option<String>,
    /// Files of the last load attempt, so `ready` does not load them again.
    attempted: (GString, GString),
}

#[godot_api]
impl INode2D for RigbySkeleton2D {
    fn init(base: Base<Node2D>) -> Self {
        RigbySkeleton2D {
            base,
            skeleton_file: GString::new(),
            atlas_file: GString::new(),
            animation: GString::new(),
            looping: true,
            playing: true,
            speed: 1.0,
            skin: GString::new(),
            show_bones: false,
            loaded: None,
            pose: None,
            state: AnimationState::new(),
            out: RenderOutput::default(),
            canvas: Canvas::default(),
            load_error: None,
            attempted: (GString::new(), GString::new()),
        }
    }

    fn ready(&mut self) {
        if self.attempted != (self.skeleton_file.clone(), self.atlas_file.clone()) {
            self.reload();
        }
    }

    fn process(&mut self, delta: f64) {
        if self.loaded.is_none() {
            return;
        }
        if self.playing {
            self.advance(delta * self.speed);
        }
    }

    fn exit_tree(&mut self) {
        self.canvas.free();
    }

    fn draw(&mut self) {
        if !self.show_bones {
            return;
        }
        let (Some(loaded), Some(pose)) = (self.loaded.clone(), self.pose.as_ref()) else { return };
        let lines: Vec<(Vector2, Vector2)> = loaded
            .data
            .bones
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let m = pose.world[i];
                let (x0, y0) = m.apply(0.0, 0.0);
                let (x1, y1) = m.apply(b.length.max(4.0), 0.0);
                (Vector2::new(x0 as f32, -y0 as f32), Vector2::new(x1 as f32, -y1 as f32))
            })
            .collect();
        for (a, b) in lines {
            self.base_mut().draw_line_ex(a, b, Color::from_rgba(1.0, 0.6, 0.1, 0.9)).width(2.0).done();
            self.base_mut().draw_circle(a, 3.0, Color::from_rgba(1.0, 0.6, 0.1, 0.9));
        }
    }
}

#[godot_api]
impl RigbySkeleton2D {
    /// An event key fired: track, event name, its int, float and string values, and audio path.
    #[signal]
    fn animation_event(track: i64, event_name: GString, int_value: i64, float_value: f64, string_value: GString, audio_path: GString);
    /// An animation started on a track.
    #[signal]
    fn animation_started(track: i64, animation_name: GString);
    /// An animation reached its end (every loop for looping animations).
    #[signal]
    fn animation_completed(track: i64, animation_name: GString);
    /// An animation stopped affecting the pose (replaced, faded out or cleared).
    #[signal]
    fn animation_ended(track: i64, animation_name: GString);

    #[func]
    fn set_skeleton_file(&mut self, path: GString) {
        self.skeleton_file = path;
        self.reload();
    }

    #[func]
    fn set_atlas_file(&mut self, path: GString) {
        self.atlas_file = path;
        self.reload();
    }

    #[func]
    fn set_animation(&mut self, name: GString) {
        self.animation = name;
        self.start_default_animation();
    }

    #[func]
    fn set_looping(&mut self, looping: bool) {
        self.looping = looping;
        self.start_default_animation();
    }

    #[func]
    fn set_skin(&mut self, name: GString) {
        self.skin = name;
        if let (Some(loaded), Some(pose)) = (&self.loaded, self.pose.as_mut()) {
            let s = self.skin.to_string();
            pose.skin = if s.is_empty() || s == "default" { None } else { loaded.data.find_skin(&s) };
            if !s.is_empty() && s != "default" && pose.skin.is_none() {
                godot_warn!("Rigby2D: no skin '{s}'");
            }
        }
        self.refresh();
    }

    #[func]
    fn set_show_bones(&mut self, show: bool) {
        self.show_bones = show;
        self.base_mut().queue_redraw();
    }

    /// Plays `name` on track 0, crossfading over `mix` seconds. Returns false if not found.
    #[func]
    fn play(&mut self, name: GString, looping: bool, mix: f64) -> bool {
        self.set_animation_on(0, name, looping, mix)
    }

    /// Starts `name` on `track` now (crossfading over `mix` seconds, dropping queued entries).
    #[func]
    fn set_animation_on(&mut self, track: i64, name: GString, looping: bool, mix: f64) -> bool {
        let Some(loaded) = self.loaded.clone() else { return false };
        let ok = self.state.set_animation(&loaded.data, track.max(0) as usize, &name.to_string(), looping, mix).is_some();
        if !ok {
            godot_warn!("Rigby2D: no animation '{name}'");
        }
        self.refresh();
        ok
    }

    /// Queues `name` on `track` after the current entry; `delay` < 0 starts it when that one ends.
    #[func]
    fn queue(&mut self, track: i64, name: GString, looping: bool, mix: f64, delay: f64) -> bool {
        let Some(loaded) = self.loaded.clone() else { return false };
        self.state.add_animation(&loaded.data, track.max(0) as usize, &name.to_string(), looping, mix, if delay < 0.0 { None } else { Some(delay) }).is_some()
    }

    /// Stops a track.
    #[func]
    fn clear_track(&mut self, track: i64) {
        self.state.clear_track(track.max(0) as usize);
        self.refresh();
    }

    /// Stops every track and returns to the setup pose.
    #[func]
    fn stop(&mut self) {
        self.state.stop();
        self.refresh();
    }

    /// Influence of a layered track (1 = full).
    #[func]
    fn set_track_alpha(&mut self, track: i64, alpha: f64) {
        if let Some(e) = self.state.current_mut(track.max(0) as usize) {
            e.alpha = alpha;
        }
    }

    /// Speed of one track (1 = normal).
    #[func]
    fn set_track_time_scale(&mut self, track: i64, scale: f64) {
        if let Some(e) = self.state.current_mut(track.max(0) as usize) {
            e.time_scale = scale;
        }
    }

    /// Name of the animation playing on `track` (empty when none).
    #[func]
    fn get_current_animation(&self, track: i64) -> GString {
        match (&self.loaded, self.state.current(track.max(0) as usize)) {
            (Some(l), Some(e)) => GString::from(l.data.animations[e.animation].name.as_str()),
            _ => GString::new(),
        }
    }

    /// Seconds played on `track` (-1 when nothing plays).
    #[func]
    fn get_current_time(&self, track: i64) -> f64 {
        self.state.current(track.max(0) as usize).map_or(-1.0, |e| e.time)
    }

    /// Advances playback by `seconds` and redraws (use with `playing` off to drive time yourself).
    #[func]
    fn advance(&mut self, seconds: f64) {
        let Some(loaded) = self.loaded.clone() else { return };
        self.state.update(&loaded.data, seconds);
        self.refresh();
    }

    #[func]
    fn get_animation_names(&self) -> PackedStringArray {
        self.loaded.as_ref().map_or_else(PackedStringArray::new, |l| l.data.animations.iter().map(|a| GString::from(a.name.as_str())).collect())
    }

    /// Duration of an animation in seconds (-1 if not found).
    #[func]
    fn get_animation_duration(&self, name: GString) -> f64 {
        let n = name.to_string();
        self.loaded.as_ref().and_then(|l| l.data.animations.iter().find(|a| a.name == n)).map_or(-1.0, |a| a.duration)
    }

    #[func]
    fn get_skin_names(&self) -> PackedStringArray {
        let mut names = PackedStringArray::new();
        names.push("default");
        if let Some(l) = &self.loaded {
            for s in &l.data.skins {
                names.push(s.name.as_str());
            }
        }
        names
    }

    #[func]
    fn get_bone_names(&self) -> PackedStringArray {
        self.loaded.as_ref().map_or_else(PackedStringArray::new, |l| l.data.bones.iter().map(|b| GString::from(b.name.as_str())).collect())
    }

    #[func]
    fn get_event_names(&self) -> PackedStringArray {
        self.loaded.as_ref().map_or_else(PackedStringArray::new, |l| l.data.events.iter().map(|e| GString::from(e.name.as_str())).collect())
    }

    /// A bone's current transform in this node's space (Godot axes: Y down), or identity if not
    /// found. Attach other nodes to bones with it.
    #[func]
    fn get_bone_transform(&self, bone: GString) -> Transform2D {
        let (Some(l), Some(pose)) = (&self.loaded, &self.pose) else { return Transform2D::IDENTITY };
        let Some(i) = l.data.find_bone(&bone.to_string()) else { return Transform2D::IDENTITY };
        let m = pose.world[i];
        // Flip Y: (x, y) -> (x, -y) on both sides of the matrix.
        Transform2D::from_cols(Vector2::new(m.a as f32, -m.b as f32), Vector2::new(-m.c as f32, m.d as f32), Vector2::new(m.tx as f32, -m.ty as f32))
    }

    /// A bone's position in this node's space.
    #[func]
    fn get_bone_position(&self, bone: GString) -> Vector2 {
        self.get_bone_transform(bone).origin
    }

    /// Restarts physics simulation from the current pose.
    #[func]
    fn reset_physics(&mut self) {
        if let Some(p) = self.pose.as_mut() {
            p.reset_physics();
        }
    }

    /// Error from loading the files, or empty.
    #[func]
    fn get_load_error(&self) -> GString {
        GString::from(self.load_error.as_deref().unwrap_or(""))
    }

    /// Number of draw batches in the last frame (for profiling).
    #[func]
    fn get_draw_batch_count(&self) -> i64 {
        self.out.batches().len() as i64
    }
}

impl RigbySkeleton2D {
    fn reload(&mut self) {
        self.loaded = None;
        self.pose = None;
        self.state = AnimationState::new();
        self.load_error = None;
        self.attempted = (self.skeleton_file.clone(), self.atlas_file.clone());
        let (skel, atlas) = (self.skeleton_file.to_string(), self.atlas_file.to_string());
        if skel.is_empty() || atlas.is_empty() {
            self.refresh();
            return;
        }
        match load_files(&skel, &atlas) {
            Ok(l) => {
                self.pose = Some(Pose::new(&l.data));
                self.loaded = Some(l);
                let skin = self.skin.clone();
                self.set_skin(skin);
                self.start_default_animation();
            }
            Err(e) => {
                godot_error!("Rigby2D: {e}");
                self.load_error = Some(e);
            }
        }
        self.refresh();
    }

    fn start_default_animation(&mut self) {
        let Some(loaded) = self.loaded.clone() else { return };
        let name = self.animation.to_string();
        if name.is_empty() {
            self.state.clear_track(0);
        } else if self.state.set_animation(&loaded.data, 0, &name, self.looping, 0.0).is_none() {
            godot_warn!("Rigby2D: no animation '{name}'");
        }
        self.refresh();
    }

    /// Applies the animation state, emits queued callbacks as signals and redraws.
    fn refresh(&mut self) {
        let (Some(loaded), Some(mut pose)) = (self.loaded.clone(), self.pose.take()) else {
            self.canvas.clear_items(0);
            return;
        };
        self.state.apply(&loaded.data, &mut pose);
        self.out.build(&loaded.data, &pose, &loaded.pages.lookup, [1.0; 4]);
        self.pose = Some(pose);
        let parent = self.base().get_canvas_item();
        self.canvas.submit(parent, &self.out, &[&loaded.pages]);
        if self.show_bones {
            self.base_mut().queue_redraw();
        }
        for e in self.state.drain_events() {
            let track = e.track as i64;
            let name = GString::from(loaded.data.animations[e.animation].name.as_str());
            match e.kind {
                StateEventKind::Start => self.base_mut().emit_signal("animation_started", &[track.to_variant(), name.to_variant()]),
                StateEventKind::End => self.base_mut().emit_signal("animation_ended", &[track.to_variant(), name.to_variant()]),
                StateEventKind::Complete => self.base_mut().emit_signal("animation_completed", &[track.to_variant(), name.to_variant()]),
                StateEventKind::Event(ev) => self.base_mut().emit_signal(
                    "animation_event",
                    &[
                        track.to_variant(),
                        GString::from(ev.name.as_str()).to_variant(),
                        ev.int.to_variant(),
                        ev.float.to_variant(),
                        GString::from(ev.string.as_deref().unwrap_or("")).to_variant(),
                        GString::from(ev.audio.as_deref().unwrap_or("")).to_variant(),
                    ],
                ),
            };
        }
    }
}

/// The RenderingServer items a node draws with: one child canvas item + mesh per batch.
#[derive(Default)]
struct Canvas {
    items: Vec<Rid>,
    meshes: Vec<Rid>,
    materials: HashMap<(Blend, bool), Rid>,
}

impl Canvas {
    fn material(&mut self, blend: Blend, pma: bool) -> Rid {
        *self.materials.entry((blend, pma)).or_insert_with(|| {
            let mut rs = RenderingServer::singleton();
            let m = rs.material_create();
            rs.material_set_shader(m, shader_for(blend));
            rs.material_set_param(m, "pma", &pma.to_variant());
            m
        })
    }

    /// Sends the batches to the RenderingServer under `parent`. A batch's `source` picks its atlas
    /// in `pages`.
    fn submit(&mut self, parent: Rid, out: &RenderOutput, pages: &[&Pages]) {
        let count = out.batches().len();
        let mut rs = RenderingServer::singleton();
        while self.items.len() < count {
            let item = rs.canvas_item_create();
            rs.canvas_item_set_parent(item, parent);
            rs.canvas_item_set_draw_index(item, self.items.len() as i32);
            self.items.push(item);
            self.meshes.push(rs.mesh_create());
        }
        // CUSTOM0 holds RGBA floats (ARRAY_CUSTOM_RGBA_FLOAT << ARRAY_FORMAT_CUSTOM0_SHIFT).
        let custom0 = ArrayFormat::from_ord((ArrayCustomFormat::RGBA_FLOAT.ord() as u64) << 13);
        for (k, b) in out.batches().iter().enumerate() {
            let Some(atlas) = pages.get(b.source) else { continue };
            let material = self.material(b.blend, atlas.pma.get(b.page).copied().unwrap_or(false));
            let mut arrays = VarArray::new();
            arrays.resize(13, &Variant::nil());
            arrays.set(0, &b.positions.iter().map(|p| Vector2::new(p[0], -p[1])).collect::<PackedVector2Array>().to_variant());
            arrays.set(3, &b.colors.iter().map(|c| Color::from_rgba(c[0], c[1], c[2], c[3])).collect::<PackedColorArray>().to_variant());
            arrays.set(4, &b.uvs.iter().map(|t| Vector2::new(t[0], t[1])).collect::<PackedVector2Array>().to_variant());
            arrays.set(6, &b.darks.iter().flat_map(|d| d.iter().copied()).collect::<PackedFloat32Array>().to_variant());
            arrays.set(12, &b.indices.iter().map(|&i| i as i32).collect::<PackedInt32Array>().to_variant());
            let (item, mesh) = (self.items[k], self.meshes[k]);
            rs.canvas_item_clear(item);
            rs.mesh_clear(mesh);
            rs.mesh_add_surface_from_arrays_ex(mesh, PrimitiveType::TRIANGLES, &arrays).compress_format(custom0).done();
            rs.canvas_item_set_material(item, material);
            rs.canvas_item_set_default_texture_filter(item, atlas.filters.get(b.page).copied().unwrap_or(CanvasItemTextureFilter::LINEAR));
            let texture = atlas.textures.get(b.page).map_or(Rid::Invalid, |t| t.get_rid());
            rs.canvas_item_add_mesh_ex(item, mesh).texture(texture).done();
        }
        self.clear_items(count);
    }

    /// Empties the canvas items from `from` on (they are reused next frame).
    fn clear_items(&mut self, from: usize) {
        if self.items.len() <= from {
            return;
        }
        let mut rs = RenderingServer::singleton();
        for &item in &self.items[from..] {
            rs.canvas_item_clear(item);
        }
    }

    fn free(&mut self) {
        let mut rs = RenderingServer::singleton();
        for rid in self.items.drain(..).chain(self.meshes.drain(..)).chain(self.materials.drain().map(|(_, m)| m)) {
            rs.free_rid(rid);
        }
    }
}

/// Godot's axes (Y down) for a runtime matrix.
fn to_godot(m: &rigby_runtime::math::Affine) -> Transform2D {
    Transform2D::from_cols(Vector2::new(m.a as f32, -m.b as f32), Vector2::new(-m.c as f32, m.d as f32), Vector2::new(m.tx as f32, -m.ty as f32))
}

/// Plays a scene exported from the Rigby2D editor (File > Export scene for runtimes): the stage
/// (backgrounds, camera, parallax), its characters and their clips, drawn in the stage's order.
#[derive(GodotClass)]
#[class(base = Node2D, tool)]
pub struct RigbyScene2D {
    base: Base<Node2D>,

    /// Scene manifest (`<name>.scene.json`); the skeletons and atlases it names sit next to it.
    #[var(set = set_scene_file)]
    #[export(file = "*.scene.json")]
    scene_file: GString,
    /// Shot (stage animation) played when the node starts; empty = the first one.
    #[var(set = set_shot)]
    #[export]
    shot: GString,
    /// Whether the shot starts again when it ends.
    #[var(set = set_looping)]
    #[export]
    looping: bool,
    /// Advances the scene every frame (also in the editor, for previews).
    #[var]
    #[export]
    playing: bool,
    /// Playback speed multiplier.
    #[var]
    #[export(range = (0.0, 4.0, 0.01, or_greater))]
    speed: f64,

    player: Option<ScenePlayer>,
    /// Atlas of the stage (0) and of each character (1 + its index in the player).
    pages: Vec<Pages>,
    out: RenderOutput,
    canvas: Canvas,
    load_error: Option<String>,
    attempted: GString,
    finished: bool,
}

#[godot_api]
impl INode2D for RigbyScene2D {
    fn init(base: Base<Node2D>) -> Self {
        RigbyScene2D {
            base,
            scene_file: GString::new(),
            shot: GString::new(),
            looping: true,
            playing: true,
            speed: 1.0,
            player: None,
            pages: Vec::new(),
            out: RenderOutput::default(),
            canvas: Canvas::default(),
            load_error: None,
            attempted: GString::new(),
            finished: false,
        }
    }

    fn ready(&mut self) {
        if self.attempted != self.scene_file {
            self.reload();
        }
    }

    fn process(&mut self, delta: f64) {
        if self.player.is_some() && self.playing {
            self.advance(delta * self.speed);
        }
    }

    fn exit_tree(&mut self) {
        self.canvas.free();
    }
}

#[godot_api]
impl RigbyScene2D {
    /// The shot reached its end (each time round when looping).
    #[signal]
    fn shot_finished(shot: GString);

    #[func]
    fn set_scene_file(&mut self, path: GString) {
        self.scene_file = path;
        self.reload();
    }

    #[func]
    fn set_shot(&mut self, name: GString) {
        self.shot = name;
        self.start();
    }

    #[func]
    fn set_looping(&mut self, looping: bool) {
        self.looping = looping;
        if let Some(p) = self.player.as_mut() {
            p.looping = looping;
        }
    }

    /// Plays a shot from its start. Returns false if the stage has no such animation.
    #[func]
    fn play(&mut self, shot: GString, looping: bool) -> bool {
        let Some(p) = self.player.as_mut() else { return false };
        let name = shot.to_string();
        if p.stage.find_animation(&name).is_none() {
            godot_warn!("Rigby2D: no shot '{name}'");
            return false;
        }
        self.looping = looping;
        p.play(&name, looping);
        self.finished = false;
        self.redraw();
        true
    }

    /// Advances the scene by `seconds` and redraws (use with `playing` off to drive time yourself).
    #[func]
    fn advance(&mut self, seconds: f64) {
        let Some(p) = self.player.as_mut() else { return };
        let before = p.time;
        p.update(seconds);
        let d = p.duration();
        let ended = d > 0.0 && if p.looping { p.time < before } else { p.time >= d };
        let shot = p.shot.clone().unwrap_or_default();
        self.redraw();
        // A held (non-looping) shot reports its end once.
        if ended && (self.looping || !self.finished) {
            self.finished = true;
            self.base_mut().emit_signal("shot_finished", &[GString::from(shot.as_str()).to_variant()]);
        }
    }

    /// Jumps to `seconds` into the current shot (physics starts again from there).
    #[func]
    fn seek(&mut self, seconds: f64) {
        let Some(p) = self.player.as_mut() else { return };
        for c in &mut p.characters {
            c.pose.reset_physics();
        }
        p.time = seconds.clamp(0.0, p.duration().max(0.0));
        p.evaluate(0.0);
        self.finished = false;
        self.redraw();
    }

    #[func]
    fn get_shot_names(&self) -> PackedStringArray {
        self.player.as_ref().map_or_else(PackedStringArray::new, |p| p.stage.animations.iter().map(|a| GString::from(a.name.as_str())).collect())
    }

    /// Name of the shot playing.
    #[func]
    fn get_current_shot(&self) -> GString {
        GString::from(self.player.as_ref().and_then(|p| p.shot.as_deref()).unwrap_or(""))
    }

    /// Seconds into the shot.
    #[func]
    fn get_time(&self) -> f64 {
        self.player.as_ref().map_or(0.0, |p| p.time)
    }

    /// Length of the current shot: its stage animation or its last clip, whichever ends later.
    #[func]
    fn get_duration(&self) -> f64 {
        self.player.as_ref().map_or(0.0, |p| p.duration())
    }

    #[func]
    fn get_actor_names(&self) -> PackedStringArray {
        self.player.as_ref().map_or_else(PackedStringArray::new, |p| p.scene.actors.iter().map(|a| GString::from(a.name.as_str())).collect())
    }

    /// The stage's `camera` bone in this node's space (follow it with a Camera2D), or identity.
    #[func]
    fn get_camera_transform(&self) -> Transform2D {
        self.get_stage_bone_transform(GString::from("camera"))
    }

    /// A stage bone's transform in this node's space (Godot axes), or identity if not found.
    #[func]
    fn get_stage_bone_transform(&self, bone: GString) -> Transform2D {
        let Some(p) = &self.player else { return Transform2D::IDENTITY };
        p.stage.find_bone(&bone.to_string()).map_or(Transform2D::IDENTITY, |i| to_godot(&p.pose.world[i]))
    }

    /// A bone of an actor (by actor name) in this node's space, or identity if not found. Attach
    /// props or effects to characters with it.
    #[func]
    fn get_actor_bone_transform(&self, actor: GString, bone: GString) -> Transform2D {
        let Some(p) = &self.player else { return Transform2D::IDENTITY };
        let name = actor.to_string();
        let Some(c) = p.scene.actors.iter().position(|a| a.name == name).and_then(|a| p.character(a)) else { return Transform2D::IDENTITY };
        c.data.find_bone(&bone.to_string()).map_or(Transform2D::IDENTITY, |i| to_godot(&c.pose.world[i]))
    }

    /// Error from loading the files, or empty.
    #[func]
    fn get_load_error(&self) -> GString {
        GString::from(self.load_error.as_deref().unwrap_or(""))
    }

    /// Number of draw batches in the last frame (for profiling).
    #[func]
    fn get_draw_batch_count(&self) -> i64 {
        self.out.batches().len() as i64
    }
}

impl RigbyScene2D {
    fn reload(&mut self) {
        self.player = None;
        self.pages.clear();
        self.load_error = None;
        self.attempted = self.scene_file.clone();
        let file = self.scene_file.to_string();
        if !file.is_empty() {
            match Self::load(&file) {
                Ok((player, pages)) => {
                    self.player = Some(player);
                    self.pages = pages;
                    self.start();
                }
                Err(e) => {
                    godot_error!("Rigby2D: {e}");
                    self.load_error = Some(e);
                }
            }
        }
        self.redraw();
    }

    fn load(file: &str) -> Result<(ScenePlayer, Vec<Pages>), String> {
        let dir = file.rsplit_once('/').map_or(String::new(), |(d, _)| format!("{d}/"));
        let manifest = FileAccess::get_file_as_bytes(file);
        if manifest.is_empty() {
            return Err(format!("cannot read '{file}'"));
        }
        let manifest = manifest.as_slice().to_vec();
        let read = |f: &str| {
            let bytes = FileAccess::get_file_as_bytes(&format!("{dir}{f}"));
            if bytes.is_empty() {
                Err(format!("cannot read '{dir}{f}'"))
            } else {
                Ok(bytes.as_slice().to_vec())
            }
        };
        let player = load_scene(&manifest, read).map_err(|e| format!("'{file}': {e}"))?;
        // Each skeleton's atlas is `<skeleton without extension>.atlas` next to it (none for a
        // stage without images).
        let stage_file = read_scene_manifest(&manifest).map_err(|e| e.to_string())?.stage;
        let mut files = vec![(stage_file, &player.stage)];
        for c in &player.characters {
            let f = player.scene.actors.iter().find(|a| a.id == c.id).and_then(|a| a.skeleton.clone()).unwrap_or_default();
            files.push((f, &c.data));
        }
        let mut pages = Vec::new();
        for (skeleton, data) in files {
            let atlas = format!("{dir}{}.atlas", skeleton.rsplit_once('.').map_or(skeleton.as_str(), |(s, _)| s));
            let text = if FileAccess::file_exists(&atlas) { FileAccess::get_file_as_string(&atlas).to_string() } else { String::new() };
            pages.push(load_pages(data, &format!("{dir}{skeleton}"), &atlas, &text)?);
            for w in &data.warnings {
                godot_warn!("Rigby2D: '{dir}{skeleton}': {w}");
            }
        }
        Ok((player, pages))
    }

    fn start(&mut self) {
        let Some(p) = self.player.as_mut() else { return };
        let name = self.shot.to_string();
        let shot = if name.is_empty() { p.stage.animations.first().map(|a| a.name.clone()) } else { Some(name.clone()) };
        match shot {
            Some(s) if p.stage.find_animation(&s).is_some() => p.play(&s, self.looping),
            _ => {
                if !name.is_empty() {
                    godot_warn!("Rigby2D: no shot '{name}'");
                }
                p.evaluate(0.0);
            }
        }
        self.finished = false;
        self.redraw();
    }

    /// Builds the stage and characters in the stage's draw order and sends them to the server:
    /// runs of stage slots between the characters, each character tinted by its slot's color.
    fn redraw(&mut self) {
        let Some(p) = &self.player else {
            self.canvas.clear_items(0);
            return;
        };
        self.out.clear();
        let mut run: Vec<usize> = Vec::new();
        for layer in p.draw_list() {
            let character = layer.actor.and_then(|a| p.characters.iter().position(|c| c.id == p.scene.actors[a].id));
            let Some(c) = character else {
                run.push(layer.slot);
                continue;
            };
            if !run.is_empty() {
                self.out.append(&p.stage, &p.pose, &self.pages[0].lookup, [1.0; 4], &run, 0);
                run.clear();
            }
            let ch = &p.characters[c];
            if layer.tint[3] > 0.0 {
                self.out.append(&ch.data, &ch.pose, &self.pages[1 + c].lookup, layer.tint, &ch.pose.draw_order, 1 + c);
            }
        }
        if !run.is_empty() {
            self.out.append(&p.stage, &p.pose, &self.pages[0].lookup, [1.0; 4], &run, 0);
        }
        let parent = self.base().get_canvas_item();
        let pages: Vec<&Pages> = self.pages.iter().collect();
        self.canvas.submit(parent, &self.out, &pages);
    }
}
