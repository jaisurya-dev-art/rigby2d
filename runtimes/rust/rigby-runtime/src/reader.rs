// SPDX-License-Identifier: MIT OR Apache-2.0
//! Reads skeleton JSON (formats 3.8, 4.x; binary `.skel` files are first converted to the same
//! structure by `binary::read_skeleton_binary`) into `SkeletonData`.

use crate::curve::{Curve, RawCurve, RawKey};
use crate::json::Json;
use crate::math::Transform;
use crate::model::*;
use std::collections::HashMap;
use std::fmt;

/// Name of the skeleton header field holding the format version (fixed by the file format).
pub const VERSION_FIELD: &str = "spine";

#[derive(Debug, Clone)]
pub struct LoadError(pub String);

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for LoadError {}

fn err<T>(msg: impl Into<String>) -> Result<T, LoadError> {
    Err(LoadError(msg.into()))
}

/// True when `obj` looks like a skeleton JSON file.
pub fn is_skeleton_json(obj: &Json) -> bool {
    obj.get("skeleton").is_object() && obj.get("bones").is_array()
}

/// JavaScript `Math.round`.
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

fn round5(v: f64) -> f64 {
    js_round(v * 1e5) / 1e5
}

/// Parses "rrggbb" or "rrggbbaa" into 0..1 components; `def` when invalid. A 6-digit color gets
/// alpha 1 when `def` has 4 components.
pub fn hex_to_color(hex: &Json, def: &[f64]) -> Vec<f64> {
    let Some(s) = hex.as_str() else { return def.to_vec() };
    if !(s.len() == 6 || s.len() == 8) || !s.bytes().all(|c| c.is_ascii_hexdigit()) {
        return def.to_vec();
    }
    let mut c: Vec<f64> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap() as f64 / 255.0).collect();
    if c.len() == 3 && def.len() == 4 {
        c.push(1.0);
    }
    c
}

fn color4(v: &[f64]) -> [f64; 4] {
    [v.first().copied().unwrap_or(1.0), v.get(1).copied().unwrap_or(1.0), v.get(2).copied().unwrap_or(1.0), v.get(3).copied().unwrap_or(1.0)]
}

const WHITE: [f64; 4] = [1.0, 1.0, 1.0, 1.0];

fn default_attachment_color(kind: &str) -> [f64; 4] {
    let hex = match kind {
        "boundingbox" => "60F000FF",
        "path" => "FF7F00FF",
        "point" => "F1F100FF",
        "clipping" => "CE3A3AFF",
        _ => return WHITE,
    };
    color4(&hex_to_color(&Json::Str(hex.to_string()), &WHITE))
}

fn nums(v: &Json) -> Vec<f64> {
    v.as_array().iter().map(|x| x.as_f64().unwrap_or(0.0)).collect()
}

/// Splits a packed vertex array into plain floats or per-vertex weights.
fn decode_vertices(vertices: &Json, count: usize) -> Vertices {
    let Json::Arr(list) = vertices else { return Vertices::Plain(Vec::new()) };
    let v: Vec<f64> = list.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect();
    if v.len() <= count * 2 {
        return Vertices::Plain(v);
    }
    let mut weights = Vec::new();
    let mut i = 0;
    while i < v.len() && weights.len() < count {
        let n = v[i] as usize;
        i += 1;
        let mut w = Vec::with_capacity(n);
        for _ in 0..n {
            if i + 3 >= v.len() {
                break;
            }
            w.push(Weight { bone: v[i] as usize, x: v[i + 1], y: v[i + 2], weight: v[i + 3] });
            i += 4;
        }
        weights.push(w);
    }
    Vertices::Weighted(weights)
}

struct Ctx<'a> {
    v4: bool,
    bones: HashMap<&'a str, usize>,
    slots: HashMap<&'a str, usize>,
}

impl Ctx<'_> {
    fn bone(&self, name: &Json) -> Result<usize, LoadError> {
        let n = name.as_str().unwrap_or("");
        self.bones.get(n).copied().ok_or_else(|| LoadError(format!("unknown bone '{n}'")))
    }
    fn slot(&self, name: &Json) -> Result<usize, LoadError> {
        let n = name.as_str().unwrap_or("");
        self.slots.get(n).copied().ok_or_else(|| LoadError(format!("unknown slot '{n}'")))
    }
}

/// Detects 4.x absolute curve points when an export uses the 0.0.00 version placeholder.
fn uses_absolute_curves(obj: &Json, major: f64) -> bool {
    if major != 0.0 {
        return major >= 4.0;
    }
    obj.get("animations").entries().iter().any(|(_, anim)| {
        anim.get("bones").entries().iter().any(|(_, timeline)| {
            timeline.get("rotate").as_array().iter().any(|key| key.get("value").as_f64().is_some())
        })
    })
}

/// Converts a parsed skeleton JSON file into `SkeletonData`.
pub fn read_skeleton_json(obj: &Json) -> Result<SkeletonData, LoadError> {
    if !is_skeleton_json(obj) {
        return err("not a skeleton JSON file");
    }
    let header = obj.get("skeleton");
    let version_text = match header.get(VERSION_FIELD) {
        Json::Str(s) => s.clone(),
        Json::Num(n) => n.to_string(),
        _ => "3.8".to_string(),
    };
    let major: f64 = version_text.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(3.0);
    let v4 = uses_absolute_curves(obj, major);

    let mut sk = SkeletonData { version: header.get(VERSION_FIELD).as_str().map(str::to_string), ..Default::default() };

    // Bones.
    let mut bone_index: HashMap<&str, usize> = HashMap::new();
    for (i, b) in obj.get("bones").as_array().iter().enumerate() {
        let name = b.str_or("name", "");
        let parent = match b.get("parent") {
            Json::Null => None,
            p => Some(*bone_index.get(p.as_str().unwrap_or("")).ok_or_else(|| LoadError(format!("bone '{name}' references unknown parent '{}'", p.as_str().unwrap_or(""))))?),
        };
        bone_index.insert(name, i);
        let inherit = b.get("inherit").as_str().or_else(|| b.get("transform").as_str()).unwrap_or("normal");
        sk.bones.push(BoneData {
            name: name.to_string(),
            parent,
            length: b.num("length", 0.0),
            setup: Transform {
                x: b.num("x", 0.0),
                y: b.num("y", 0.0),
                rotation: b.num("rotation", 0.0),
                scale_x: b.num("scaleX", 1.0),
                scale_y: b.num("scaleY", 1.0),
                shear_x: b.num("shearX", 0.0),
                shear_y: b.num("shearY", 0.0),
            },
            inherit: Inherit::parse(inherit).unwrap_or_default(),
            skin_required: b.truthy("skin"),
        });
    }

    let mut ctx = Ctx { v4, bones: bone_index, slots: HashMap::new() };

    // Slots.
    for (i, s) in obj.get("slots").as_array().iter().enumerate() {
        let name = s.str_or("name", "");
        ctx.slots.insert(name, i);
        let bone = ctx.bone(s.get("bone"))?;
        let attachment = s.get("attachment").as_str().map(|n| sk.intern(n));
        let dark = if s.truthy("dark") {
            let d = hex_to_color(s.get("dark"), &[0.0, 0.0, 0.0]);
            Some([d[0], d[1], d[2]])
        } else {
            None
        };
        sk.slots.push(SlotData {
            name: name.to_string(),
            bone,
            attachment,
            color: color4(&hex_to_color(s.get("color"), &WHITE)),
            dark,
            blend: Blend::parse(s.str_or("blend", "normal")),
            attachments: Vec::new(),
        });
    }

    // IK constraints; the others are compiled once animations are known (sliders name one).
    let unified = obj.get("constraints").is_array();
    let mut ik_source: Vec<(&Json, f64)> = Vec::new();
    if unified {
        for (i, c) in obj.get("constraints").as_array().iter().enumerate() {
            if c.get("type").as_str() == Some("ik") {
                ik_source.push((c, c.num("order", i as f64)));
            }
        }
    } else {
        for (i, c) in obj.get("ik").as_array().iter().enumerate() {
            ik_source.push((c, c.num("order", i as f64)));
        }
    }
    for (c, order) in ik_source {
        sk.ik.push(IkData {
            name: c.str_or("name", "").to_string(),
            order,
            skin_required: c.truthy("skin"),
            bones: c.get("bones").as_array().iter().map(|b| ctx.bone(b)).collect::<Result<_, _>>()?,
            target: ctx.bone(c.get("target"))?,
            mix: c.num("mix", 1.0),
            softness: c.num("softness", 0.0),
            bend_positive: c.flag("bendPositive", true),
            compress: c.truthy("compress"),
            stretch: c.truthy("stretch"),
            uniform: c.truthy("uniform"),
        });
    }
    let ik_index: HashMap<String, usize> = sk.ik.iter().enumerate().map(|(i, c)| (c.name.clone(), i)).collect();
    if unified {
        let skipped = obj
            .get("constraints")
            .as_array()
            .iter()
            .filter(|c| !matches!(c.get("type").as_str(), Some("ik" | "transform" | "path" | "physics" | "slider")))
            .count();
        if skipped > 0 {
            sk.warnings.push(format!("{skipped} constraint(s) of unknown types are kept but not evaluated"));
        }
    }

    // Skins (an array since 3.8; a map of skin name -> slots before).
    let skins: Vec<(String, &Json)> = match obj.get("skins") {
        Json::Arr(list) => list.iter().map(|s| (s.str_or("name", "").to_string(), s)).collect(),
        Json::Obj(entries) => entries.iter().map(|(k, v)| (k.clone(), v)).collect(),
        _ => Vec::new(),
    };
    let skins_are_array = obj.get("skins").is_array();
    for (skin_name, skin) in &skins {
        let attachments = if skins_are_array { skin.get("attachments") } else { *skin };
        let mut entries = Vec::new();
        for (slot_name, atts) in attachments.entries() {
            let s = ctx.slot(&Json::Str(slot_name.clone()))?;
            let mut list = Vec::new();
            for (key, a) in atts.entries() {
                list.push(read_attachment(&mut sk, &ctx, key, a)?);
            }
            if skin_name == "default" {
                sk.slots[s].attachments.extend(list);
            } else {
                entries.push((s, list));
            }
        }
        if skin_name == "default" {
            continue;
        }
        let mut constraints = Vec::new();
        if skins_are_array {
            for key in ["constraints", "transform", "path", "physics"] {
                for n in skin.get(key).as_array() {
                    if let Some(n) = n.as_str() {
                        constraints.push(n.to_string());
                    }
                }
            }
        }
        let (bones, ik) = if skins_are_array {
            (
                skin.get("bones").as_array().iter().map(|b| ctx.bone(b)).collect::<Result<Vec<_>, _>>()?,
                skin.get("ik").as_array().iter().filter_map(|n| n.as_str().and_then(|n| ik_index.get(n).copied())).collect(),
            )
        } else {
            (Vec::new(), Vec::new())
        };
        sk.skins.push(SkinData { name: skin_name.clone(), slots: entries, bones, ik, constraints });
    }

    // Events.
    for (name, e) in obj.get("events").entries() {
        sk.events.push(EventData {
            name: name.clone(),
            int: e.num("int", 0.0) as i64,
            float: e.num("float", 0.0),
            string: e.get("string").as_str().map(str::to_string),
            audio: e.get("audio").as_str().map(str::to_string),
            volume: e.num("volume", 1.0),
            balance: e.num("balance", 0.0),
        });
    }

    // Constraints other than IK (compiled; sliders need the animation names).
    let animation_names: Vec<&str> = obj.get("animations").entries().iter().map(|(k, _)| k.as_str()).collect();
    compile_constraints(&mut sk, obj, &ctx, &animation_names)?;

    // Animations.
    for (name, a) in obj.get("animations").entries() {
        let anim = read_animation(&mut sk, &ctx, &ik_index, name, a)?;
        sk.animations.push(anim);
    }
    validate(&sk)?;
    Ok(sk)
}

fn validate(sk: &SkeletonData) -> Result<(), LoadError> {
    if sk.bones.is_empty() {
        return err("skeleton has no bones");
    }
    for (i, b) in sk.bones.iter().enumerate() {
        if let Some(p) = b.parent {
            if p >= i {
                return err(format!("bone '{}' comes before its parent", b.name));
            }
        }
    }
    Ok(())
}

fn read_transform_offset(a: &Json) -> Transform {
    Transform {
        x: a.num("x", 0.0),
        y: a.num("y", 0.0),
        rotation: a.num("rotation", 0.0),
        scale_x: a.num("scaleX", 1.0),
        scale_y: a.num("scaleY", 1.0),
        shear_x: 0.0,
        shear_y: 0.0,
    }
}

fn read_attachment(sk: &mut SkeletonData, ctx: &Ctx, key: &str, a: &Json) -> Result<Attachment, LoadError> {
    let kind_name = a.str_or("type", "region");
    let image_name = a.get("path").as_str().or_else(|| a.get("name").as_str()).unwrap_or(key).to_string();
    let color = color4(&hex_to_color(a.get("color"), &default_attachment_color(kind_name)));
    let kind = match kind_name {
        "region" => AttachmentKind::Region { offset: read_transform_offset(a), width: a.num("width", 0.0), height: a.num("height", 0.0) },
        "point" => AttachmentKind::Point { offset: read_transform_offset(a) },
        "mesh" => {
            let uvs = nums(a.get("uvs"));
            let count = uvs.len() / 2;
            AttachmentKind::Mesh {
                triangles: a.get("triangles").as_array().iter().map(|t| t.as_f64().unwrap_or(0.0) as u32).collect(),
                hull: a.num("hull", 0.0) as usize,
                vertices: decode_vertices(a.get("vertices"), count),
                width: a.num("width", 0.0),
                height: a.num("height", 0.0),
                uvs,
            }
        }
        "linkedmesh" => {
            let parent = a.get("parent").as_str().or_else(|| a.get("source").as_str()).unwrap_or("");
            let deform = match (a.get("deform"), a.get("timelines")) {
                (Json::Null, Json::Null) => true,
                (Json::Null, t) => !matches!(t, Json::Bool(false) | Json::Num(0.0)),
                (d, _) => !matches!(d, Json::Bool(false) | Json::Num(0.0)),
            };
            AttachmentKind::LinkedMesh {
                parent: sk.intern(parent),
                skin: a.get("skin").as_str().map(str::to_string),
                deform,
                width: a.num("width", 0.0),
                height: a.num("height", 0.0),
            }
        }
        "boundingbox" | "path" | "clipping" => {
            let count = a.num("vertexCount", 0.0) as usize;
            let vertices = decode_vertices(a.get("vertices"), count);
            match kind_name {
                "boundingbox" => AttachmentKind::BoundingBox { vertices },
                "path" => AttachmentKind::Path {
                    vertices,
                    closed: a.truthy("closed"),
                    constant_speed: a.flag("constantSpeed", true),
                    lengths: nums(a.get("lengths")),
                },
                _ => AttachmentKind::Clipping { vertices, end: if a.get("end").is_null() { None } else { Some(ctx.slot(a.get("end"))?) } },
            }
        }
        other => return err(format!("unknown attachment type '{other}' ('{key}')")),
    };
    let image = sk.intern(&image_name);
    let sequence = if a.get("sequence").is_object() {
        let s = a.get("sequence");
        let count = s.num("count", 1.0) as i64;
        let start = s.num("start", 1.0) as i64;
        let digits = s.num("digits", 0.0) as usize;
        let frames = (0..count.max(1)).map(|i| sk.intern(&format!("{image_name}{:0>width$}", start + i, width = digits))).collect();
        Some(Sequence { count, start, digits, setup: s.num("setup", 0.0) as i64, frames })
    } else {
        None
    };
    Ok(Attachment { name: sk.intern(key), image, color, kind, sequence })
}

// ---- constraints --------------------------------------------------------------------------------

const PROP_NAMES: [&str; PROPS] = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"];
const OFFSET_FIELDS: [&str; PROPS] = ["rotation", "x", "y", "scaleX", "scaleY", "shearY"];

fn prop_index(name: &str) -> Option<usize> {
    PROP_NAMES.iter().position(|p| *p == name)
}

fn compile_constraints(sk: &mut SkeletonData, obj: &Json, ctx: &Ctx, animation_names: &[&str]) -> Result<(), LoadError> {
    let mut entries: Vec<(&Json, String, f64)> = Vec::new();
    if obj.get("constraints").is_array() {
        for (i, c) in obj.get("constraints").as_array().iter().enumerate() {
            let t = c.str_or("type", "");
            if t != "ik" {
                entries.push((c, t.to_string(), i as f64));
            }
        }
    }
    for t in ["transform", "path", "physics"] {
        for (i, c) in obj.get(t).as_array().iter().enumerate() {
            entries.push((c, t.to_string(), c.num("order", i as f64)));
        }
    }
    for (d, t, order) in entries {
        let name = d.str_or("name", "").to_string();
        let skin_required = d.truthy("skin");
        let bone_of = |n: &Json| n.as_str().and_then(|n| ctx.bones.get(n).copied());
        match t.as_str() {
            "slider" => {
                let Some(animation) = d.get("animation").as_str().and_then(|n| animation_names.iter().position(|a| *a == n)) else { continue };
                let bone = match d.get("bone") {
                    Json::Null => None,
                    b => match bone_of(b) {
                        Some(b) => Some(b),
                        None => continue,
                    },
                };
                let property = match d.str_or("property", "rotate") {
                    "x" => Property::X,
                    "y" => Property::Y,
                    "scaleX" => Property::ScaleX,
                    "scaleY" => Property::ScaleY,
                    "shearY" => Property::ShearY,
                    _ => Property::Rotate,
                };
                sk.constraints.push(ConstraintData {
                    name,
                    order,
                    skin_required,
                    bones: bone.into_iter().collect(),
                    kind: ConstraintKind::Slider(SliderData {
                        animation,
                        bone,
                        property,
                        scale: d.num("scale", 1.0),
                        offset: d.num("offset", 0.0),
                        local: d.truthy("local"),
                        looping: d.truthy("loop"),
                        additive: d.truthy("additive"),
                        setup: [d.num("time", 0.0), d.num("mix", 1.0)],
                    }),
                });
            }
            "physics" => {
                let Some(bone) = bone_of(d.get("bone")) else { continue };
                let mut globals = [false; 7];
                for (i, key) in PHYSICS_VALUES.iter().enumerate() {
                    globals[i] = d.truthy(&format!("{key}Global"));
                }
                sk.constraints.push(ConstraintData {
                    name,
                    order,
                    skin_required,
                    bones: vec![bone],
                    kind: ConstraintKind::Physics(PhysicsData {
                        bone,
                        x: d.num("x", 0.0),
                        y: d.num("y", 0.0),
                        rotate: d.num("rotate", 0.0),
                        scale_x: d.num("scaleX", 0.0),
                        shear_x: d.num("shearX", 0.0),
                        limit: d.num("limit", 5000.0),
                        fps: d.num("fps", 60.0),
                        globals,
                        setup: [
                            d.num("inertia", 0.5),
                            d.num("strength", 100.0),
                            d.num("damping", 0.85),
                            d.num("mass", 1.0),
                            d.num("wind", 0.0),
                            d.num("gravity", 0.0),
                            d.num("mix", 1.0),
                        ],
                    }),
                });
            }
            "transform" | "path" => {
                let bones: Vec<Option<usize>> = d.get("bones").as_array().iter().map(bone_of).collect();
                if bones.is_empty() || bones.iter().any(Option::is_none) {
                    continue;
                }
                let bones: Vec<usize> = bones.into_iter().flatten().collect();
                if t == "transform" {
                    let src = if d.has("source") { d.get("source") } else { d.get("target") };
                    let Some(source) = bone_of(src) else { continue };
                    sk.constraints.push(ConstraintData { name, order, skin_required, bones, kind: ConstraintKind::Transform(transform_data(d, source)) });
                } else {
                    let slot_name = if d.has("slot") { d.get("slot") } else { d.get("target") };
                    let Some(slot) = slot_name.as_str().and_then(|n| ctx.slots.get(n).copied()) else { continue };
                    sk.constraints.push(ConstraintData { name, order, skin_required, bones, kind: ConstraintKind::Path(path_data(d, slot)) });
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn transform_data(d: &Json, source: usize) -> TransformData {
    let legacy = d.has("rotateMix") || d.has("translateMix") || d.has("scaleMix") || d.has("shearMix");
    let mut offsets = [0.0; PROPS];
    for (i, f) in OFFSET_FIELDS.iter().enumerate() {
        offsets[i] = d.num(f, 0.0);
    }
    let mix = if legacy {
        let t = d.num("translateMix", 1.0);
        let s = d.num("scaleMix", 1.0);
        [d.num("rotateMix", 1.0), t, t, s, s, d.num("shearMix", 1.0)]
    } else {
        let x = d.num("mixX", 1.0);
        let sx = d.num("mixScaleX", 1.0);
        [d.num("mixRotate", 1.0), x, d.num("mixY", x), sx, d.num("mixScaleY", sx), d.num("mixShearY", 1.0)]
    };
    let props = if d.get("properties").is_object() {
        d.get("properties")
            .entries()
            .iter()
            .filter_map(|(from, p)| {
                let from = prop_index(from)?;
                Some(PropMap {
                    from,
                    offset: p.num("offset", 0.0),
                    to: p
                        .get("to")
                        .entries()
                        .iter()
                        .filter_map(|(to, t)| Some(PropTarget { prop: prop_index(to)?, offset: t.num("offset", 0.0), max: t.num("max", 1.0), scale: t.num("scale", 1.0) }))
                        .collect(),
                })
            })
            .collect()
    } else {
        (0..PROPS).map(|p| PropMap { from: p, offset: 0.0, to: vec![PropTarget { prop: p, offset: 0.0, max: 1.0, scale: 1.0 }] }).collect()
    };
    let local = d.truthy("local");
    TransformData {
        source,
        offsets,
        mix,
        props,
        local_source: d.flag("localSource", local),
        local_target: d.flag("localTarget", local),
        additive: if d.has("additive") { d.truthy("additive") } else { d.truthy("relative") },
        clamp: d.truthy("clamp"),
    }
}

fn path_data(d: &Json, slot: usize) -> PathData {
    let legacy = d.has("rotateMix") || d.has("translateMix");
    let x = if legacy { d.num("translateMix", 1.0) } else { d.num("mixX", 1.0) };
    PathData {
        slot,
        position_mode: if d.str_or("positionMode", "percent") == "fixed" { PositionMode::Fixed } else { PositionMode::Percent },
        spacing_mode: match d.str_or("spacingMode", "length") {
            "fixed" => SpacingMode::Fixed,
            "percent" => SpacingMode::Percent,
            "proportional" => SpacingMode::Proportional,
            _ => SpacingMode::Length,
        },
        rotate_mode: match d.str_or("rotateMode", "tangent") {
            "chain" => RotateMode::Chain,
            "chainScale" => RotateMode::ChainScale,
            _ => RotateMode::Tangent,
        },
        offset_rotation: d.num("rotation", 0.0),
        setup: PathState {
            position: d.num("position", 0.0),
            spacing: d.num("spacing", 0.0),
            mix_rotate: if legacy { d.num("rotateMix", 1.0) } else { d.num("mixRotate", 1.0) },
            mix_x: x,
            mix_y: if legacy { x } else { d.num("mixY", x) },
        },
    }
}

// ---- curves and keys -----------------------------------------------------------------------------

/// Reads a key's curve. 3.8 uses normalized values; 4.x per-value absolute control points.
fn read_curve(key: &Json, next: Option<&Json>, values: &[f64], next_values: &[f64], v4: bool) -> Curve {
    match key.get("curve") {
        Json::Null => Curve::Linear,
        Json::Str(s) if s == "stepped" => Curve::Stepped,
        Json::Num(c) => Curve::Bezier([*c, key.num("c2", 0.0), key.num("c3", 1.0), key.num("c4", 1.0)]),
        Json::Arr(_) => {
            let c = nums(key.get("curve"));
            if !v4 && c.len() == 4 {
                return Curve::Bezier([c[0], c[1], c[2], c[3]]);
            }
            let Some(next) = next else { return Curve::Linear };
            normalize_curve(&c, key.num("time", 0.0), next.num("time", 0.0), values, next_values)
        }
        _ => Curve::Linear,
    }
}

fn normalize_curve(c: &[f64], t1: f64, t2: f64, values: &[f64], next_values: &[f64]) -> Curve {
    let dt = if t2 - t1 != 0.0 { t2 - t1 } else { 1.0 };
    // A component whose value does not change has no meaningful curve; it takes the shape of the others.
    let mut beziers: Vec<Option<[f64; 4]>> = Vec::new();
    let mut i = 0;
    while i + 3 < c.len() && beziers.len() < values.len() {
        let v1 = values[beziers.len()];
        let dv = next_values.get(beziers.len()).copied().unwrap_or(f64::NAN) - v1;
        if dv.abs() <= 1e-9 {
            beziers.push(None);
        } else {
            beziers.push(Some([(c[i] - t1) / dt, (c[i + 1] - v1) / dv, (c[i + 2] - t1) / dt, (c[i + 3] - v1) / dv]));
        }
        i += 4;
    }
    if beziers.is_empty() {
        return Curve::Linear;
    }
    let known: Vec<[f64; 4]> = beziers.iter().flatten().copied().collect();
    let r = |b: [f64; 4]| b.map(round5);
    if known.is_empty() {
        return Curve::Bezier(r([(c[0] - t1) / dt, 0.0, (c[2] - t1) / dt, 1.0]));
    }
    let shared = known.iter().all(|b| b.iter().zip(known[0].iter()).all(|(v, k)| (v - k).abs() < 1e-4));
    if beziers.len() == 1 || shared {
        return Curve::Bezier(r(known[0]));
    }
    Curve::Beziers(beziers.iter().map(|b| r(b.unwrap_or(known[0]))).collect())
}

fn read_numeric_keys(list: &Json, v4: bool, values_of: impl Fn(&Json) -> Vec<f64>) -> Vec<Key> {
    let keys = list.as_array();
    keys.iter()
        .enumerate()
        .map(|(i, k)| {
            let values = values_of(k);
            let next = keys.get(i + 1);
            let next_values = next.map(&values_of).unwrap_or_else(|| values.clone());
            let curve = read_curve(k, next, &values, &next_values, v4);
            Key { time: k.num("time", 0.0), values, curve }
        })
        .collect()
}

fn raw_keys(list: &Json, read: impl Fn(&Json) -> Vec<f64>) -> Vec<RawKey> {
    list.as_array()
        .iter()
        .map(|k| RawKey {
            time: k.num("time", 0.0),
            values: read(k),
            curve: match k.get("curve") {
                Json::Str(s) if s == "stepped" => RawCurve::Stepped,
                Json::Num(c) => RawCurve::Normalized([*c, k.num("c2", 0.0), k.num("c3", 1.0), k.num("c4", 1.0)]),
                Json::Arr(_) => RawCurve::Absolute(nums(k.get("curve"))),
                _ => RawCurve::Linear,
            },
        })
        .collect()
}

/// `k[field] ?? def` for numbers.
fn val(k: &Json, field: &str, def: f64) -> f64 {
    match k.get(field) {
        Json::Null => def,
        v => v.as_f64().unwrap_or(f64::NAN),
    }
}

fn read_animation(sk: &mut SkeletonData, ctx: &Ctx, ik_index: &HashMap<String, usize>, name: &str, a: &Json) -> Result<Animation, LoadError> {
    let v4 = ctx.v4;
    let mut anim = Animation { name: name.to_string(), ..Default::default() };

    for (bone_name, timelines) in a.get("bones").entries() {
        let mut tl = BoneTimeline { bone: ctx.bone(&Json::Str(bone_name.clone()))?, ..Default::default() };
        for (kind, keys) in timelines.entries() {
            match kind.as_str() {
                "rotate" => tl.channels[CH_ROTATE] = read_numeric_keys(keys, v4, |k| vec![if k.has("value") { val(k, "value", 0.0) } else { val(k, "angle", 0.0) }]),
                "translate" => tl.channels[CH_TRANSLATE] = read_numeric_keys(keys, v4, |k| vec![val(k, "x", 0.0), val(k, "y", 0.0)]),
                "scale" => tl.channels[CH_SCALE] = read_numeric_keys(keys, v4, |k| vec![val(k, "x", 1.0), val(k, "y", 1.0)]),
                "shear" => tl.channels[CH_SHEAR] = read_numeric_keys(keys, v4, |k| vec![val(k, "x", 0.0), val(k, "y", 0.0)]),
                "translatex" | "translatey" | "scalex" | "scaley" | "shearx" | "sheary" => {
                    let ch = match kind.as_str() {
                        "translatex" => CH_TRANSLATE_X,
                        "translatey" => CH_TRANSLATE_Y,
                        "scalex" => CH_SCALE_X,
                        "scaley" => CH_SCALE_Y,
                        "shearx" => CH_SHEAR_X,
                        _ => CH_SHEAR_Y,
                    };
                    let def = if kind.starts_with("scale") { 1.0 } else { 0.0 };
                    tl.channels[ch] = read_numeric_keys(keys, v4, |k| vec![val(k, "value", def)]);
                }
                "inherit" | "transform" => {
                    tl.inherit = keys
                        .as_array()
                        .iter()
                        .map(|k| {
                            let mode = k.get("inherit").as_str().or_else(|| k.get("value").as_str()).unwrap_or("normal");
                            (k.num("time", 0.0), Inherit::parse(mode).unwrap_or_default())
                        })
                        .collect();
                }
                other => sk.warnings.push(format!("animation '{name}': unsupported bone timeline '{other}'")),
            }
        }
        anim.bones.push(tl);
    }

    for (slot_name, timelines) in a.get("slots").entries() {
        let mut tl = SlotTimeline { slot: ctx.slot(&Json::Str(slot_name.clone()))?, ..Default::default() };
        for (kind, keys) in timelines.entries() {
            match kind.as_str() {
                "attachment" => {
                    tl.attachment = keys.as_array().iter().map(|k| (k.num("time", 0.0), k.get("name").as_str().map(|n| sk.intern(n)))).collect();
                }
                "color" | "rgba" => tl.color = read_numeric_keys(keys, v4, |k| hex_to_color(k.get("color"), &WHITE)),
                "rgb" => tl.rgb = read_numeric_keys(keys, v4, |k| hex_to_color(k.get("color"), &[1.0, 1.0, 1.0])),
                "alpha" => tl.alpha = read_numeric_keys(keys, v4, |k| vec![val(k, "value", 1.0)]),
                "twoColor" | "rgba2" => {
                    tl.rgba2 = read_numeric_keys(keys, v4, |k| {
                        let mut v = hex_to_color(k.get("light"), &WHITE);
                        v.extend(hex_to_color(k.get("dark"), &[0.0, 0.0, 0.0]));
                        v
                    })
                }
                "rgb2" => {
                    tl.rgb2 = read_numeric_keys(keys, v4, |k| {
                        let mut v = hex_to_color(k.get("light"), &[1.0, 1.0, 1.0]);
                        v.extend(hex_to_color(k.get("dark"), &[0.0, 0.0, 0.0]));
                        v
                    })
                }
                other => sk.warnings.push(format!("animation '{name}': unsupported slot timeline '{other}'")),
            }
        }
        anim.slots.push(tl);
    }

    let read_deform = |sk: &mut SkeletonData, anim: &mut Animation, skin: &str, slot_name: &str, att: &str, keys: &Json| -> Result<(), LoadError> {
        let list = keys.as_array();
        let keys = list
            .iter()
            .enumerate()
            .map(|(i, k)| DeformKey {
                time: k.num("time", 0.0),
                offset: k.num("offset", 0.0) as usize,
                vertices: nums(k.get("vertices")),
                curve: read_curve(k, list.get(i + 1), &[0.0], &[1.0], v4),
            })
            .collect();
        anim.deform.push(DeformTimeline {
            skin: if skin == "default" { None } else { Some(skin.to_string()) },
            slot: ctx.slot(&Json::Str(slot_name.to_string()))?,
            attachment: sk.intern(att),
            keys,
        });
        Ok(())
    };
    for (skin, slots) in a.get("deform").entries() {
        for (slot_name, atts) in slots.entries() {
            for (att, keys) in atts.entries() {
                read_deform(sk, &mut anim, skin, slot_name, att, keys)?;
            }
        }
    }
    for (skin, slots) in a.get("attachments").entries() {
        for (slot_name, atts) in slots.entries() {
            for (att, timelines) in atts.entries() {
                if timelines.has("deform") {
                    read_deform(sk, &mut anim, skin, slot_name, att, timelines.get("deform"))?;
                }
                if timelines.get("sequence").is_array() {
                    let Some(slot) = ctx.slots.get(slot_name.as_str()).copied() else { continue };
                    let keys = timelines
                        .get("sequence")
                        .as_array()
                        .iter()
                        .map(|k| SequenceKey {
                            time: k.num("time", 0.0),
                            mode: match k.str_or("mode", "hold") {
                                "once" => SequenceMode::Once,
                                "loop" => SequenceMode::Loop,
                                "pingpong" => SequenceMode::PingPong,
                                "onceReverse" => SequenceMode::OnceReverse,
                                "loopReverse" => SequenceMode::LoopReverse,
                                "pingpongReverse" => SequenceMode::PingPongReverse,
                                _ => SequenceMode::Hold,
                            },
                            index: k.num("index", 0.0) as i64,
                            delay: k.get("delay").as_f64(),
                        })
                        .collect();
                    anim.sequences.push(SequenceTimeline {
                        skin: if skin == "default" { None } else { Some(skin.clone()) },
                        slot,
                        attachment: sk.intern(att),
                        keys,
                    });
                }
            }
        }
    }

    let draw_order = if a.has("drawOrder") { a.get("drawOrder") } else { a.get("draworder") };
    for k in draw_order.as_array() {
        let offsets = if k.get("offsets").is_array() {
            let mut list = Vec::new();
            for o in k.get("offsets").as_array() {
                list.push((ctx.slot(o.get("slot"))?, o.num("offset", 0.0) as i64));
            }
            Some(list)
        } else {
            None
        };
        anim.draw_order.push((k.num("time", 0.0), offsets));
    }

    for e in a.get("events").as_array() {
        anim.events.push(EventKey {
            time: e.num("time", 0.0),
            name: e.str_or("name", "").to_string(),
            int: e.get("int").as_f64().map(|v| v as i64),
            float: e.get("float").as_f64(),
            string: e.get("string").as_str().map(str::to_string),
            volume: e.get("volume").as_f64(),
            balance: e.get("balance").as_f64(),
        });
    }

    for (ik_name, keys) in a.get("ik").entries() {
        let Some(&constraint) = ik_index.get(ik_name) else { continue };
        anim.ik.push(IkTimeline {
            constraint,
            keys: keys
                .as_array()
                .iter()
                .map(|k| IkKey {
                    time: k.num("time", 0.0),
                    mix: k.num("mix", 1.0),
                    softness: k.num("softness", 0.0),
                    bend_positive: k.flag("bendPositive", true),
                    compress: k.truthy("compress"),
                    stretch: k.truthy("stretch"),
                })
                .collect(),
        });
    }

    // Transform, path, physics and slider keys, by compiled constraint.
    anim.has_constraint_keys = ["transform", "path", "physics", "slider"].iter().any(|k| !a.get(k).is_null() && !matches!(a.get(k), Json::Bool(false)));
    for (index, c) in sk.constraints.iter().enumerate() {
        let mut tl = ConstraintTimeline { constraint: index, ..Default::default() };
        let mut any = false;
        match &c.kind {
            ConstraintKind::Transform(_) => {
                let keys = a.get("transform").get(&c.name);
                if !keys.as_array().is_empty() {
                    let legacy = keys.as_array().iter().any(|k| k.has("rotateMix") || k.has("translateMix") || k.has("scaleMix") || k.has("shearMix"));
                    tl.transform = raw_keys(keys, |k| {
                        if legacy {
                            let t = val(k, "translateMix", 1.0);
                            let s = val(k, "scaleMix", 1.0);
                            vec![val(k, "rotateMix", 1.0), t, t, s, s, val(k, "shearMix", 1.0)]
                        } else {
                            let x = val(k, "mixX", 1.0);
                            let sx = val(k, "mixScaleX", 1.0);
                            vec![val(k, "mixRotate", 1.0), x, val(k, "mixY", x), sx, val(k, "mixScaleY", sx), val(k, "mixShearY", 1.0)]
                        }
                    });
                    any = true;
                }
            }
            ConstraintKind::Slider(_) => {
                let t = a.get("slider").get(&c.name);
                if t.is_object() {
                    tl.slider_time = raw_keys(t.get("time"), |k| vec![val(k, "value", 0.0)]);
                    tl.slider_mix = raw_keys(t.get("mix"), |k| vec![val(k, "value", 1.0)]);
                    any = true;
                }
            }
            ConstraintKind::Physics(_) => {
                for (global, source) in [(false, a.get("physics").get(&c.name)), (true, a.get("physics").get(""))] {
                    if !source.is_object() {
                        continue;
                    }
                    for (i, key) in PHYSICS_VALUES.iter().enumerate() {
                        let keys = raw_keys(source.get(key), |k| vec![val(k, "value", 0.0)]);
                        if global {
                            tl.physics_global[i] = keys;
                        } else {
                            tl.physics[i] = keys;
                        }
                    }
                    any = true;
                }
            }
            ConstraintKind::Path(_) => {
                let t = a.get("path").get(&c.name);
                if t.is_object() {
                    tl.position = raw_keys(t.get("position"), |k| vec![if k.has("value") { val(k, "value", 0.0) } else { val(k, "position", 0.0) }]);
                    tl.spacing = raw_keys(t.get("spacing"), |k| vec![if k.has("value") { val(k, "value", 0.0) } else { val(k, "spacing", 0.0) }]);
                    tl.path_mix = raw_keys(t.get("mix"), |k| {
                        if k.has("rotateMix") || k.has("translateMix") {
                            vec![val(k, "rotateMix", 1.0), val(k, "translateMix", 1.0), val(k, "translateMix", 1.0)]
                        } else {
                            let x = val(k, "mixX", 1.0);
                            vec![val(k, "mixRotate", 1.0), x, if k.has("mixY") { val(k, "mixY", x) } else { x }]
                        }
                    });
                    any = true;
                }
            }
        }
        if any {
            anim.constraints.push(tl);
        }
    }

    anim.duration = last_time(a, &anim);
    Ok(anim)
}

fn last_time(raw: &Json, anim: &Animation) -> f64 {
    let mut max: f64 = 0.0;
    let mut scan = |t: f64| max = max.max(t);
    for t in &anim.bones {
        for ch in &t.channels {
            ch.iter().for_each(|k| scan(k.time));
        }
        t.inherit.iter().for_each(|k| scan(k.0));
    }
    for t in &anim.slots {
        t.attachment.iter().for_each(|k| scan(k.0));
        for ch in [&t.color, &t.rgb, &t.alpha, &t.rgba2, &t.rgb2] {
            ch.iter().for_each(|k| scan(k.time));
        }
    }
    anim.deform.iter().for_each(|t| t.keys.iter().for_each(|k| scan(k.time)));
    anim.ik.iter().for_each(|t| t.keys.iter().for_each(|k| scan(k.time)));
    anim.draw_order.iter().for_each(|k| scan(k.0));
    anim.events.iter().for_each(|k| scan(k.time));
    fn deep(v: &Json, max: &mut f64) {
        match v {
            Json::Arr(items) => {
                for k in items {
                    if let Some(t) = k.get("time").as_f64() {
                        *max = max.max(t);
                    }
                    deep(k, max);
                }
            }
            Json::Obj(entries) => entries.iter().for_each(|(_, x)| deep(x, max)),
            _ => {}
        }
    }
    for key in ["transform", "path", "physics", "attachments"] {
        deep(raw.get(key), &mut max);
    }
    max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_version_with_rotate_values_reads_absolute_curves() {
        let obj = Json::parse(r#"{
            "skeleton": {"spine": "0.0.00"},
            "bones": [{"name": "root"}],
            "animations": {"walk": {"bones": {"root": {"rotate": [
                {"value": -20, "curve": [0.25, -20, 0.75, 20]},
                {"time": 1, "value": 20}
            ]}}}}
        }"#).unwrap();
        let skeleton = read_skeleton_json(&obj).unwrap();
        let key = &skeleton.animations[0].bones[0].channels[CH_ROTATE][0];
        assert_eq!(key.curve, Curve::Bezier([0.25, 0.0, 0.75, 1.0]));
    }
}
