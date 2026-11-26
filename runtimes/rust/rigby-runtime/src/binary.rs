// SPDX-License-Identifier: MIT OR Apache-2.0
//! Binary skeleton files (".skel"; reads 4.2 and 4.3, see binary42.rs for 4.2), converted to the skeleton JSON structure so one
//! reader handles both. Mirrors the clean-room layout of the JavaScript runtime (src/core/binary.js):
//! only encodings observed in exports are read; anything else is reported as unsupported.

use crate::json::Json;
use crate::reader::{LoadError, VERSION_FIELD};
use std::collections::HashMap;

pub(crate) const INHERIT: [&str; 5] = ["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"];
const BLEND: [&str; 4] = ["normal", "additive", "multiply", "screen"];
pub(crate) const BONE_TIMELINES: [(&str, usize); 10] = [
    ("rotate", 1),
    ("translate", 2),
    ("translatex", 1),
    ("translatey", 1),
    ("scale", 2),
    ("scalex", 1),
    ("scaley", 1),
    ("shear", 2),
    ("shearx", 1),
    ("sheary", 1),
];
pub(crate) const POSITION_MODES: [&str; 2] = ["fixed", "percent"];
pub(crate) const SPACING_MODES: [&str; 4] = ["length", "fixed", "percent", "proportional"];
pub(crate) const ROTATE_MODES: [&str; 3] = ["tangent", "chain", "chainScale"];
const TRANSFORM_PROPERTIES: [&str; 6] = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"];
const TRANSFORM_OFFSETS: [&str; 6] = ["rotation", "x", "y", "scaleX", "scaleY", "shearY"];
/// Mix key, the property it applies to, and the mix it defaults to (index) when omitted.
const TRANSFORM_MIXES: [(&str, &str, Option<usize>); 6] = [
    ("mixRotate", "rotate", None),
    ("mixX", "x", None),
    ("mixY", "y", Some(1)),
    ("mixScaleX", "scaleX", None),
    ("mixScaleY", "scaleY", Some(3)),
    ("mixShearY", "shearY", None),
];
const PHYSICS_GLOBALS: [&str; 7] = ["inertia", "strength", "damping", "mass", "wind", "gravity", "mix"];
const SEQUENCE_MODES: [Option<&str>; 5] = [Some("hold"), Some("once"), Some("loop"), None, Some("onceReverse")];

pub(crate) fn unsupported<T>(what: impl std::fmt::Display) -> Result<T, LoadError> {
    Err(LoadError(format!("{what} is not supported in .skel files yet; use skeleton JSON for this skeleton")))
}

fn bad<T>(what: &str) -> Result<T, LoadError> {
    Err(LoadError(what.to_string()))
}

/// The shortest decimal that encodes back to the same 32-bit float.
fn shortest(v: f32) -> f64 {
    if v == 0.0 {
        return 0.0;
    }
    if !v.is_finite() {
        return v as f64;
    }
    format!("{v}").parse::<f64>().unwrap_or(v as f64)
}

pub(crate) fn num(v: f64) -> Json {
    Json::Num(v)
}

pub(crate) fn s(v: &str) -> Json {
    Json::Str(v.to_string())
}

pub(crate) struct Reader<'a> {
    b: &'a [u8],
    pub(crate) p: usize,
    strings: Vec<Option<String>>,
    pub(crate) slots: Vec<String>,
    transform_mapped: HashMap<String, Vec<&'static str>>,
}

impl Reader<'_> {
    fn check(&self, n: usize) -> Result<(), LoadError> {
        if self.p + n > self.b.len() {
            return bad("unexpected end of .skel data");
        }
        Ok(())
    }
    pub(crate) fn byte(&mut self) -> Result<u8, LoadError> {
        self.check(1)?;
        self.p += 1;
        Ok(self.b[self.p - 1])
    }
    pub(crate) fn bool(&mut self) -> Result<bool, LoadError> {
        Ok(self.byte()? != 0)
    }
    fn uint(&mut self) -> Result<u32, LoadError> {
        self.check(4)?;
        let v = u32::from_be_bytes([self.b[self.p], self.b[self.p + 1], self.b[self.p + 2], self.b[self.p + 3]]);
        self.p += 4;
        Ok(v)
    }
    pub(crate) fn float(&mut self) -> Result<f64, LoadError> {
        Ok(shortest(f32::from_bits(self.uint()?)))
    }
    pub(crate) fn varint(&mut self) -> Result<u32, LoadError> {
        let mut result: u32 = 0;
        let mut shift = 0;
        loop {
            let b = self.byte()?;
            result |= ((b & 0x7f) as u32).wrapping_shl(shift);
            shift += 7;
            if b & 0x80 == 0 || shift >= 35 {
                break;
            }
        }
        Ok(result)
    }
    fn svarint(&mut self) -> Result<i64, LoadError> {
        let r = self.varint()?;
        Ok(((r >> 1) as i32 ^ -((r & 1) as i32)) as i64)
    }
    pub(crate) fn string(&mut self) -> Result<Option<String>, LoadError> {
        let n = self.varint()? as usize;
        if n == 0 {
            return Ok(None);
        }
        self.check(n - 1)?;
        let text = String::from_utf8_lossy(&self.b[self.p..self.p + n - 1]).into_owned();
        self.p += n - 1;
        Ok(Some(text))
    }
    fn str_json(&mut self) -> Result<Json, LoadError> {
        Ok(self.string()?.map(Json::Str).unwrap_or(Json::Null))
    }
    pub(crate) fn reference(&mut self) -> Result<Option<String>, LoadError> {
        let i = self.varint()? as usize;
        if i == 0 {
            return Ok(None);
        }
        match self.strings.get(i - 1) {
            Some(v) => Ok(v.clone()),
            None => bad("invalid string reference in .skel data"),
        }
    }
    pub(crate) fn color(&mut self) -> Result<String, LoadError> {
        Ok(format!("{:08x}", self.uint()?))
    }
    fn color3(&mut self) -> Result<String, LoadError> {
        self.check(3)?;
        let hex = format!("{:02x}{:02x}{:02x}", self.b[self.p], self.b[self.p + 1], self.b[self.p + 2]);
        self.p += 3;
        Ok(hex)
    }
    pub(crate) fn slot_name(&self, i: usize) -> Result<String, LoadError> {
        self.slots.get(i).cloned().ok_or_else(|| LoadError("invalid slot index in .skel data".into()))
    }
}

pub(crate) fn name_at(list: &[Json], i: u32, what: &str) -> Result<Json, LoadError> {
    list.get(i as usize).map(|v| v.get("name").clone()).ok_or_else(|| LoadError(format!("invalid {what} index in .skel data")))
}

/// True when `bytes` look like a binary skeleton (8-byte hash, then a version string).
pub fn is_skeleton_binary(bytes: &[u8]) -> bool {
    if bytes.len() <= 9 || bytes[8] <= 1 || bytes[8] >= 64 {
        return false;
    }
    let len = bytes[8] as usize - 1;
    let text = &bytes[9..(9 + len).min(bytes.len())];
    let mut it = text.iter();
    let digits = it.by_ref().take_while(|c| c.is_ascii_digit()).count();
    digits > 0 && text.get(digits) == Some(&b'.') && text.get(digits + 1).is_some_and(|c| c.is_ascii_digit())
}

/// Converts a binary skeleton into the skeleton JSON structure (4.3 field names).
pub fn read_skeleton_binary(bytes: &[u8]) -> Result<Json, LoadError> {
    let mut r = Reader { b: bytes, p: 8, strings: Vec::new(), slots: Vec::new(), transform_mapped: HashMap::new() };
    let version = r.string()?.unwrap_or_default();
    if !version.starts_with("4.3") && !version.starts_with("4.2") {
        return unsupported(format!("Binary format {version}"));
    }
    let mut skeleton = Json::obj();
    skeleton.set(VERSION_FIELD, s(&version));
    for k in ["x", "y", "width", "height"] {
        let v = r.float()?;
        skeleton.set(k, num(v));
    }
    let _reference_scale = r.float()?;
    let nonessential = r.bool()?;
    if nonessential {
        let fps = r.float()?;
        if fps != 30.0 {
            skeleton.set("fps", num(fps));
        }
        let images = r.str_json()?;
        skeleton.set("images", images);
        let audio = r.str_json()?;
        skeleton.set("audio", audio);
    }
    let mut out = Json::obj();
    out.set("skeleton", skeleton);
    let n = r.varint()?;
    for _ in 0..n {
        let st = r.string()?;
        r.strings.push(st);
    }
    if version.starts_with("4.2") {
        return crate::binary42::read_skeleton_42(&mut r, out, nonessential, bytes.len());
    }

    // Bones.
    let mut bones: Vec<Json> = Vec::new();
    for i in 0..r.varint()? {
        let mut b = Json::obj();
        b.set("name", r.str_json()?);
        if i > 0 {
            let p = r.varint()?;
            b.set("parent", name_at(&bones, p, "bone")?);
        }
        let rotation = r.float()?;
        let x = r.float()?;
        let y = r.float()?;
        let scale_x = r.float()?;
        let scale_y = r.float()?;
        let shear_x = r.float()?;
        let shear_y = r.float()?;
        let inherit = INHERIT.get(r.byte()? as usize).copied().unwrap_or("normal");
        let length = r.float()?;
        if length != 0.0 {
            b.set("length", num(length));
        }
        for (k, v, def) in [("rotation", rotation, 0.0), ("x", x, 0.0), ("y", y, 0.0), ("scaleX", scale_x, 1.0), ("scaleY", scale_y, 1.0), ("shearX", shear_x, 0.0), ("shearY", shear_y, 0.0)] {
            if v != def {
                b.set(k, num(v));
            }
        }
        if inherit != "normal" {
            b.set("inherit", s(inherit));
        }
        if r.bool()? {
            b.set("skin", Json::Bool(true));
        }
        if nonessential {
            let _color = r.color()?;
            let _icon = r.string()?;
            let _icon_a = r.float()?;
            let _icon_b = r.float()?;
            let _visible = r.bool()?;
        }
        bones.push(b);
    }

    // Slots.
    let mut slots: Vec<Json> = Vec::new();
    for _ in 0..r.varint()? {
        let mut sl = Json::obj();
        let name = r.string()?.unwrap_or_default();
        sl.set("name", s(&name));
        let bi = r.varint()?;
        sl.set("bone", name_at(&bones, bi, "bone")?);
        let color = r.color()?;
        let dark = r.color()?;
        if color != "ffffffff" {
            sl.set("color", s(&color));
        }
        if dark != "ffffffff" {
            sl.set("dark", s(&dark[2..]));
        }
        if let Some(a) = r.reference()? {
            sl.set("attachment", s(&a));
        }
        let blend = BLEND.get(r.byte()? as usize).copied().unwrap_or("normal");
        if blend != "normal" {
            sl.set("blend", s(blend));
        }
        if nonessential {
            r.bool()?;
        }
        r.slots.push(name);
        slots.push(sl);
    }

    // Constraints, in application order.
    let mut constraints: Vec<Json> = Vec::new();
    for _ in 0..r.varint()? {
        let name = r.string()?.unwrap_or_default();
        let kind = r.byte()?;
        let c = match kind {
            3 => read_physics(&mut r, &name, &bones)?,
            4 => read_slider(&mut r, &name, &bones)?,
            0..=2 => {
                let mut list = Vec::new();
                for _ in 0..r.varint()? {
                    let bi = r.varint()?;
                    list.push(name_at(&bones, bi, "bone")?);
                }
                match kind {
                    0 => read_ik(&mut r, &name, list, &bones)?,
                    1 => read_path(&mut r, &name, list, &slots)?,
                    _ => read_transform(&mut r, &name, list, &bones)?,
                }
            }
            other => return unsupported(format!("Constraint type {other} ('{name}')")),
        };
        constraints.push(c);
    }

    // Skins: the default skin, then named skins.
    let mut skins: Vec<Json> = Vec::new();
    let mut default_skin = Json::obj();
    default_skin.set("name", s("default"));
    default_skin.set("attachments", read_skin(&mut r, &slots, nonessential)?);
    skins.push(default_skin);
    for _ in 0..r.varint()? {
        let mut skin = Json::obj();
        skin.set("name", r.str_json()?);
        if nonessential {
            r.color()?;
        }
        let nb = r.varint()?;
        if nb > 0 {
            let mut list = Vec::new();
            for _ in 0..nb {
                let bi = r.varint()?;
                list.push(name_at(&bones, bi, "bone")?);
            }
            skin.set("bones", Json::Arr(list));
        }
        for _ in 0..r.varint()? {
            let ci = r.varint()? as usize;
            let Some(c) = constraints.get(ci) else { return bad("invalid constraint index in .skel data") };
            let kind = c.str_or("type", "").to_string();
            let cname = c.get("name").clone();
            let mut list = skin.get(&kind).as_array().to_vec();
            list.push(cname);
            skin.set(&kind, Json::Arr(list));
        }
        skin.set("attachments", read_skin(&mut r, &slots, nonessential)?);
        skins.push(skin);
    }
    // Linked meshes: resolve the skin index they name.
    let skin_names: Vec<Json> = skins.iter().map(|k| k.get("name").clone()).collect();
    for skin in skins.iter_mut() {
        if let Json::Obj(entries) = skin {
            for (k, atts) in entries.iter_mut() {
                if k != "attachments" {
                    continue;
                }
                if let Json::Obj(slots_map) = atts {
                    for (_, slot_atts) in slots_map.iter_mut() {
                        if let Json::Obj(list) = slot_atts {
                            for (_, a) in list.iter_mut() {
                                if let Some(i) = a.remove("_skinIndex").and_then(|v| v.as_f64()) {
                                    let name = skin_names.get(i as usize).cloned().unwrap_or(Json::Null);
                                    a.set("skin", name);
                                }
                                a.remove("_sourceSlot");
                            }
                        }
                    }
                }
            }
        }
    }

    // Events.
    let mut events = Json::obj();
    let mut event_names: Vec<String> = Vec::new();
    for _ in 0..r.varint()? {
        let name = r.string()?.unwrap_or_default();
        let mut e = Json::obj();
        let int = r.svarint()?;
        let float = r.float()?;
        let string = r.string()?;
        let audio = r.string()?;
        if int != 0 {
            e.set("int", num(int as f64));
        }
        if float != 0.0 {
            e.set("float", num(float));
        }
        if let Some(st) = string.filter(|x| !x.is_empty()) {
            e.set("string", s(&st));
        }
        if let Some(a) = audio {
            e.set("audio", s(&a));
            let v = r.float()?;
            e.set("volume", num(v));
            let b = r.float()?;
            e.set("balance", num(b));
        }
        events.set(&name, e);
        event_names.push(name);
    }

    // Animations.
    let mut animations = Json::obj();
    let mut animation_names = Vec::new();
    for _ in 0..r.varint()? {
        let name = r.string()?.unwrap_or_default();
        let anim = read_animation(&mut r, &bones, &slots, &constraints, &skins, &events, &event_names)?;
        animations.set(&name, anim);
        animation_names.push(name);
    }
    // Slider constraints name their animation after the animations.
    for c in constraints.iter_mut() {
        if c.get("type").as_str() != Some("slider") {
            continue;
        }
        let i = r.varint()? as usize;
        let Some(n) = animation_names.get(i) else { return bad("invalid animation index in .skel data") };
        c.set("animation", s(n));
    }
    if r.p != bytes.len() {
        return Err(LoadError(format!("unexpected data after the animations ({} bytes)", bytes.len() - r.p)));
    }
    out.set("bones", Json::Arr(bones));
    out.set("slots", Json::Arr(slots));
    if !constraints.is_empty() {
        out.set("constraints", Json::Arr(constraints));
    }
    out.set("skins", Json::Arr(skins));
    if !event_names.is_empty() {
        out.set("events", events);
    }
    out.set("animations", animations);
    Ok(out)
}

/// A mix stored as two flags, "not 0" and "not 1"; a float follows only when both are set.
fn read_mix(r: &mut Reader, not0: bool, not1: bool) -> Result<f64, LoadError> {
    if !not0 {
        return Ok(0.0);
    }
    if !not1 {
        return Ok(1.0);
    }
    r.float()
}

fn read_ik(r: &mut Reader, name: &str, bones: Vec<Json>, all: &[Json]) -> Result<Json, LoadError> {
    let ti = r.varint()?;
    let target = name_at(all, ti, "bone")?;
    let flags = r.byte()?;
    if flags & !(0x01 | 0x04 | 0x20 | 0x40) != 0 {
        return unsupported(format!("IK constraint options (flags 0x{flags:x}) on '{name}'"));
    }
    let single = bones.len() <= 1;
    let mut c = Json::obj();
    c.set("type", s("ik"));
    c.set("name", s(name));
    c.set("target", target);
    c.set("bones", Json::Arr(bones));
    if flags & 0x01 != 0 {
        c.set("skin", Json::Bool(true));
    }
    if flags & 0x04 != 0 && !single {
        c.set("bendPositive", Json::Bool(false));
    }
    let mix = read_mix(r, flags & 0x20 != 0, flags & 0x40 != 0)?;
    if mix != 1.0 {
        c.set("mix", num(mix));
    }
    Ok(c)
}

fn read_path(r: &mut Reader, name: &str, bones: Vec<Json>, slots: &[Json]) -> Result<Json, LoadError> {
    let si = r.varint()?;
    let slot = name_at(slots, si, "slot")?;
    let flags = r.byte()?;
    if flags & !0x3f != 0 {
        return unsupported(format!("Path constraint options (flags 0x{flags:x}) on '{name}'"));
    }
    let mut c = Json::obj();
    c.set("type", s("path"));
    c.set("name", s(name));
    c.set("slot", slot);
    c.set("bones", Json::Arr(bones));
    if flags & 0x01 != 0 {
        c.set("skin", Json::Bool(true));
    }
    let position_mode = POSITION_MODES[((flags >> 1) & 1) as usize];
    let spacing_mode = SPACING_MODES[((flags >> 2) & 3) as usize];
    let rotate_mode = ROTATE_MODES.get(((flags >> 4) & 3) as usize).copied().unwrap_or("tangent");
    if position_mode != "percent" {
        c.set("positionMode", s(position_mode));
    }
    if spacing_mode != "length" {
        c.set("spacingMode", s(spacing_mode));
    }
    if rotate_mode != "tangent" {
        c.set("rotateMode", s(rotate_mode));
    }
    let position = r.float()?;
    let spacing = r.float()?;
    if position != 0.0 {
        c.set("position", num(position));
    }
    if spacing != 0.0 {
        c.set("spacing", num(spacing));
    }
    let mix_rotate = r.float()?;
    let mix_x = r.float()?;
    let mix_y = r.float()?;
    if mix_rotate != 1.0 {
        c.set("mixRotate", num(mix_rotate));
    }
    if mix_x != 1.0 {
        c.set("mixX", num(mix_x));
    }
    if mix_y != mix_x {
        c.set("mixY", num(mix_y));
    }
    Ok(c)
}

fn read_slider(r: &mut Reader, name: &str, bones: &[Json]) -> Result<Json, LoadError> {
    let mut c = Json::obj();
    c.set("type", s("slider"));
    c.set("name", s(name));
    let flags = r.byte()?;
    if flags & (0x01 | 0x04 | 0x20) != 0 || flags & 0x10 == 0 {
        return unsupported(format!("Slider constraint options (flags 0x{flags:x}) on '{name}'"));
    }
    if flags & 0x02 != 0 {
        c.set("loop", Json::Bool(true));
    }
    c.set("animation", Json::Null);
    if flags & 0x08 != 0 {
        let t = r.float()?;
        c.set("time", num(t));
    }
    if flags & 0x40 != 0 {
        let bi = r.varint()?;
        c.set("bone", name_at(bones, bi, "bone")?);
        let Some(property) = TRANSFORM_PROPERTIES.get(r.byte()? as usize) else { return unsupported(format!("Slider property on '{name}'")) };
        c.set("property", s(property));
        if r.float()? != 0.0 || r.float()? != 0.0 {
            return unsupported(format!("Slider property offsets on '{name}'"));
        }
        let scale = r.float()?;
        c.set("scale", num(scale));
        if flags & 0x80 != 0 {
            c.set("local", Json::Bool(true));
        }
    }
    Ok(c)
}

fn read_physics(r: &mut Reader, name: &str, bones: &[Json]) -> Result<Json, LoadError> {
    let mut c = Json::obj();
    c.set("type", s("physics"));
    c.set("name", s(name));
    let bi = r.varint()?;
    c.set("bone", name_at(bones, bi, "bone")?);
    let flags = r.byte()?;
    if flags & 0x01 != 0 {
        c.set("skin", Json::Bool(true));
    }
    for (bit, key) in [(0x02, "x"), (0x04, "y"), (0x08, "rotate"), (0x10, "scaleX"), (0x20, "shearX")] {
        if flags & bit != 0 {
            let v = r.float()?;
            c.set(key, num(v));
        }
    }
    if flags & 0x40 != 0 {
        let v = r.float()?;
        c.set("limit", num(v));
    }
    let fps = r.byte()? as f64;
    if fps != 60.0 {
        c.set("fps", num(fps));
    }
    for (key, def) in [("inertia", 0.5), ("strength", 100.0), ("damping", 0.85)] {
        let v = r.float()?;
        if v != def {
            c.set(key, num(v));
        }
    }
    if flags & 0x80 != 0 {
        // Mass is stored as its inverse.
        let inv = r.float()?;
        c.set("mass", num(shortest((1.0 / inv) as f32)));
    }
    let wind = r.float()?;
    let gravity = r.float()?;
    if wind != 0.0 {
        c.set("wind", num(wind));
    }
    if gravity != 0.0 {
        c.set("gravity", num(gravity));
    }
    let globals = r.byte()?;
    if globals & 0x80 != 0 {
        return unsupported(format!("Physics constraint options (0x{globals:x}) on '{name}'"));
    }
    for (i, key) in PHYSICS_GLOBALS.iter().enumerate() {
        if globals & (1 << i) != 0 {
            c.set(&format!("{key}Global"), Json::Bool(true));
        }
    }
    Ok(c)
}

fn read_transform(r: &mut Reader, name: &str, bones: Vec<Json>, all: &[Json]) -> Result<Json, LoadError> {
    let si = r.varint()?;
    let source = name_at(all, si, "bone")?;
    let flags = r.byte()?;
    if flags & 0x1e != 0 {
        return unsupported(format!("Transform constraint options (flags 0x{flags:x}) on '{name}'"));
    }
    let mut c = Json::obj();
    c.set("type", s("transform"));
    c.set("name", s(name));
    c.set("source", source);
    c.set("bones", Json::Arr(bones));
    if flags & 0x01 != 0 {
        c.set("skin", Json::Bool(true));
    }
    let mut properties = Json::obj();
    let mut mapped: Vec<&'static str> = Vec::new();
    for _ in 0..(flags >> 5) {
        let Some(from) = TRANSFORM_PROPERTIES.get(r.byte()? as usize).copied() else { return unsupported(format!("Transform property on '{name}'")) };
        let mut entry = Json::obj();
        let offset = r.float()?;
        if offset != 0.0 {
            entry.set("offset", num(offset));
        }
        let mut to_map = Json::obj();
        for _ in 0..r.varint()? {
            let Some(to) = TRANSFORM_PROPERTIES.get(r.byte()? as usize).copied() else { return unsupported(format!("Transform property on '{name}'")) };
            let mut target = Json::obj();
            let to_offset = r.float()?;
            let max = r.float()?;
            let scale = r.float()?;
            if to_offset != 0.0 {
                target.set("offset", num(to_offset));
            }
            if max != 1.0 {
                target.set("max", num(max));
            }
            if scale != 1.0 {
                target.set("scale", num(scale));
            }
            to_map.set(to, target);
            if !mapped.contains(&to) {
                mapped.push(to);
            }
        }
        entry.set("to", to_map);
        properties.set(from, entry);
    }
    let offsets = r.byte()?;
    if offsets & !0x3f != 0 {
        return unsupported(format!("Transform offsets on '{name}'"));
    }
    for (bit, key) in TRANSFORM_OFFSETS.iter().enumerate() {
        if offsets & (1 << bit) != 0 {
            let v = r.float()?;
            c.set(key, num(v));
        }
    }
    c.set("properties", properties);
    let mixes = r.byte()?;
    if mixes & !0x3f != 0 {
        return unsupported(format!("Transform mixes on '{name}'"));
    }
    let mut value = [0.0; 6];
    for (bit, v) in value.iter_mut().enumerate() {
        if mixes & (1 << bit) != 0 {
            *v = r.float()?;
        }
    }
    for (bit, (key, property, same_as)) in TRANSFORM_MIXES.iter().enumerate() {
        if !mapped.contains(property) {
            continue;
        }
        let def = same_as.map(|i| value[i]).unwrap_or(1.0);
        if value[bit] != def {
            c.set(key, num(value[bit]));
        }
    }
    r.transform_mapped.insert(name.to_string(), mapped);
    Ok(c)
}

/// Vertex count and vertices (weighted: size hint, then bone count + bone/x/y/weight).
fn read_vertices(r: &mut Reader, a: &mut Json, weighted: bool) -> Result<usize, LoadError> {
    let count = r.varint()? as usize;
    a.set("vertexCount", num(count as f64));
    let mut v = Vec::new();
    if weighted {
        r.varint()?;
        for _ in 0..count {
            let n = r.varint()?;
            v.push(num(n as f64));
            for _ in 0..n {
                let b = r.varint()?;
                v.push(num(b as f64));
                for _ in 0..3 {
                    let f = r.float()?;
                    v.push(num(f));
                }
            }
        }
    } else {
        for _ in 0..count * 2 {
            let f = r.float()?;
            v.push(num(f));
        }
    }
    a.set("vertices", Json::Arr(v));
    Ok(count)
}

fn set_color(a: &mut Json, kind: &str, color: String) {
    let def = match kind {
        "boundingbox" => "60f000ff",
        "path" => "ff7f00ff",
        _ => "",
    };
    if color != def {
        a.set("color", Json::Str(color));
    }
}

fn read_sequence(r: &mut Reader) -> Result<Json, LoadError> {
    let mut seq = Json::obj();
    let count = r.varint()?;
    seq.set("count", num(count as f64));
    let start = r.varint()?;
    let digits = r.varint()?;
    let setup = r.varint()?;
    if start != 1 {
        seq.set("start", num(start as f64));
    }
    if digits != 0 {
        seq.set("digits", num(digits as f64));
    }
    if setup != 0 {
        seq.set("setup", num(setup as f64));
    }
    Ok(seq)
}

fn read_skin(r: &mut Reader, slots: &[Json], nonessential: bool) -> Result<Json, LoadError> {
    let mut skin = Json::obj();
    for _ in 0..r.varint()? {
        let si = r.varint()?;
        let slot = name_at(slots, si, "slot")?.as_str().unwrap_or("").to_string();
        let mut atts = Json::obj();
        for _ in 0..r.varint()? {
            let key = r.reference()?.unwrap_or_default();
            let flags = r.byte()?;
            let a = read_attachment(r, flags, &key, nonessential)?;
            atts.set(&key, a);
        }
        skin.set(&slot, atts);
    }
    Ok(skin)
}

fn read_attachment(r: &mut Reader, flags: u8, key: &str, nonessential: bool) -> Result<Json, LoadError> {
    let kind = flags & 0x07;
    let mut a = Json::obj();
    match kind {
        1 | 6 => {
            if flags & !0x10 != kind {
                return unsupported(format!("Attachment options (flags 0x{flags:x}) on '{key}'"));
            }
            let t = if kind == 6 { "clipping" } else { "boundingbox" };
            a.set("type", s(t));
            if kind == 6 {
                let i = r.varint()? as usize;
                let end = r.slot_name(i)?;
                a.set("end", s(&end));
            }
            read_vertices(r, &mut a, flags & 0x10 != 0)?;
            if nonessential {
                let c = r.color()?;
                set_color(&mut a, t, c);
            }
            Ok(a)
        }
        4 => {
            if flags & !(4 | 0x10 | 0x20 | 0x40) != 0 {
                return unsupported(format!("Path attachment options (flags 0x{flags:x}) on '{key}'"));
            }
            a.set("type", s("path"));
            if flags & 0x10 != 0 {
                a.set("closed", Json::Bool(true));
            }
            if flags & 0x20 == 0 {
                a.set("constantSpeed", Json::Bool(false));
            }
            let count = read_vertices(r, &mut a, flags & 0x40 != 0)?;
            let mut lengths = Vec::new();
            for _ in 0..count / 3 {
                let f = r.float()?;
                lengths.push(num(f));
            }
            a.set("lengths", Json::Arr(lengths));
            if nonessential {
                let c = r.color()?;
                set_color(&mut a, "path", c);
            }
            Ok(a)
        }
        3 => {
            if flags & !(0x08 | 0x80 | 0x07) != 0 {
                return unsupported(format!("Linked mesh options (flags 0x{flags:x}) on '{key}'"));
            }
            a.set("type", s("linkedmesh"));
            if flags & 0x08 != 0 {
                let n = r.reference()?;
                a.set("name", n.map(Json::Str).unwrap_or(Json::Null));
            }
            let source_slot = r.varint()?;
            a.set("_sourceSlot", num(source_slot as f64));
            let skin = r.varint()?;
            let source = r.reference()?;
            a.set("source", source.map(Json::Str).unwrap_or(Json::Null));
            if skin != 0 {
                a.set("_skinIndex", num(skin as f64));
            }
            if flags & 0x80 == 0 {
                a.set("timelines", Json::Bool(false));
            }
            if nonessential {
                let w = r.float()?;
                a.set("width", num(w));
                let h = r.float()?;
                a.set("height", num(h));
            }
            Ok(a)
        }
        0 | 2 => {
            let known = 0x08 | 0x10 | 0x20 | 0x40 | 0x80 | 0x07;
            if flags & !known != 0 {
                return unsupported(format!("Attachment options (flags 0x{flags:x}) on '{key}'"));
            }
            if flags & 0x08 != 0 {
                let n = r.reference()?;
                a.set("name", n.map(Json::Str).unwrap_or(Json::Null));
            }
            if kind == 2 {
                a.set("type", s("mesh"));
            }
            if flags & 0x10 != 0 {
                let p = r.reference()?;
                a.set("path", p.map(Json::Str).unwrap_or(Json::Null));
            }
            if flags & 0x20 != 0 {
                let c = r.color()?;
                a.set("color", s(&c));
            }
            if flags & 0x40 != 0 {
                let seq = read_sequence(r)?;
                a.set("sequence", seq);
            }
            if kind == 0 {
                let rotation = if flags & 0x80 != 0 { r.float()? } else { 0.0 };
                let mut fields = Vec::new();
                for k in ["x", "y", "scaleX", "scaleY", "width", "height"] {
                    fields.push((k, r.float()?));
                }
                if rotation != 0.0 {
                    a.set("rotation", num(rotation));
                }
                for (k, v) in fields {
                    let def = match k {
                        "scaleX" | "scaleY" => Some(1.0),
                        "x" | "y" => Some(0.0),
                        _ => None,
                    };
                    if def != Some(v) {
                        a.set(k, num(v));
                    }
                }
                return Ok(a);
            }
            let hull = r.varint()?;
            a.set("hull", num(hull as f64));
            let count = r.varint()? as usize;
            let mut v = Vec::new();
            if flags & 0x80 != 0 {
                r.varint()?;
                for _ in 0..count {
                    let n = r.varint()?;
                    v.push(num(n as f64));
                    for _ in 0..n {
                        let b = r.varint()?;
                        v.push(num(b as f64));
                        for _ in 0..3 {
                            let f = r.float()?;
                            v.push(num(f));
                        }
                    }
                }
            } else {
                for _ in 0..count * 2 {
                    let f = r.float()?;
                    v.push(num(f));
                }
            }
            a.set("vertices", Json::Arr(v));
            let mut uvs = Vec::new();
            for _ in 0..count * 2 {
                let f = r.float()?;
                uvs.push(num(f));
            }
            a.set("uvs", Json::Arr(uvs));
            let tri_count = 3 * (2 * count as i64 - hull as i64 - 2).max(0) as usize;
            let mut tris = Vec::new();
            for _ in 0..tri_count {
                let t = r.varint()?;
                tris.push(num(t as f64));
            }
            a.set("triangles", Json::Arr(tris));
            if r.byte()? != 0 {
                return unsupported(format!("Mesh options ('{key}')"));
            }
            if nonessential {
                for _ in 0..r.varint()? {
                    r.varint()?;
                }
                let w = r.float()?;
                a.set("width", num(w));
                let h = r.float()?;
                a.set("height", num(h));
            }
            Ok(a)
        }
        other => unsupported(format!("Attachment type {other} ('{key}')")),
    }
}

/// Keys of `n` values; the curve of a segment follows the segment's second key.
pub(crate) fn read_curve_keys(r: &mut Reader, frames: u32, mut read: impl FnMut(&mut Reader, &mut Json) -> Result<usize, LoadError>) -> Result<Vec<Json>, LoadError> {
    let mut keys: Vec<Json> = Vec::new();
    for f in 0..frames {
        let mut key = Json::obj();
        let t = r.float()?;
        key.set("time", num(t));
        let n = read(r, &mut key)?;
        if f > 0 {
            let kind = r.byte()?;
            let prev = keys.last_mut().unwrap();
            match kind {
                0 => {}
                1 => prev.set("curve", s("stepped")),
                2 => {
                    let mut c = Vec::new();
                    for _ in 0..4 * n {
                        let v = r.float()?;
                        c.push(num(v));
                    }
                    prev.set("curve", Json::Arr(c));
                }
                other => return Err(LoadError(format!("invalid curve type {other}"))),
            }
        }
        keys.push(key);
    }
    for k in keys.iter_mut() {
        if k.get("time").as_f64() == Some(0.0) {
            k.remove("time");
        }
    }
    Ok(keys)
}

fn one_value(def: f64) -> impl FnMut(&mut Reader, &mut Json) -> Result<usize, LoadError> {
    move |r, key| {
        let v = r.float()?;
        if v != def {
            key.set("value", num(v));
        }
        Ok(1)
    }
}

#[allow(clippy::too_many_arguments)]
fn read_animation(r: &mut Reader, bones: &[Json], slots: &[Json], constraints: &[Json], skins: &[Json], events: &Json, event_names: &[String]) -> Result<Json, LoadError> {
    let mut anim = Json::obj();
    r.varint()?; // total timeline count

    let mut slot_tl = Json::obj();
    for _ in 0..r.varint()? {
        let si = r.varint()?;
        let slot = name_at(slots, si, "slot")?.as_str().unwrap_or("").to_string();
        let mut timelines = Json::obj();
        for _ in 0..r.varint()? {
            let kind = r.byte()?;
            let frames = r.varint()?;
            match kind {
                0 => {
                    let mut keys = Vec::new();
                    for _ in 0..frames {
                        let time = r.float()?;
                        let name = r.reference()?;
                        let mut key = Json::obj();
                        if time != 0.0 {
                            key.set("time", num(time));
                        }
                        if let Some(n) = name {
                            key.set("name", s(&n));
                        }
                        keys.push(key);
                    }
                    timelines.set("attachment", Json::Arr(keys));
                }
                1 => {
                    r.varint()?;
                    let keys = read_curve_keys(r, frames, |rr, key| {
                        let c = rr.color()?;
                        key.set("color", s(&c));
                        Ok(4)
                    })?;
                    timelines.set("rgba", Json::Arr(keys));
                }
                3 => {
                    r.varint()?;
                    let keys = read_curve_keys(r, frames, |rr, key| {
                        let light = rr.color()?;
                        key.set("light", s(&light));
                        let dark = rr.color3()?;
                        key.set("dark", s(&dark));
                        Ok(7)
                    })?;
                    timelines.set("rgba2", Json::Arr(keys));
                }
                other => return unsupported(format!("Slot timeline type {other}")),
            }
        }
        slot_tl.set(&slot, timelines);
    }
    if !slot_tl.entries().is_empty() {
        anim.set("slots", slot_tl);
    }

    let mut bone_tl = Json::obj();
    for _ in 0..r.varint()? {
        let bi = r.varint()?;
        let bone = name_at(bones, bi, "bone")?.as_str().unwrap_or("").to_string();
        let mut timelines = Json::obj();
        for _ in 0..r.varint()? {
            let kind = r.byte()?;
            let frames = r.varint()?;
            r.varint()?;
            let Some(&(name, count)) = BONE_TIMELINES.get(kind as usize) else { return unsupported(format!("Bone timeline type {kind}")) };
            let def = if name.starts_with("scale") { 1.0 } else { 0.0 };
            let keys = read_curve_keys(r, frames, |rr, key| {
                if count == 1 {
                    let v = rr.float()?;
                    if v != def {
                        key.set("value", num(v));
                    }
                } else {
                    let x = rr.float()?;
                    let y = rr.float()?;
                    if x != def {
                        key.set("x", num(x));
                    }
                    if y != def {
                        key.set("y", num(y));
                    }
                }
                Ok(count)
            })?;
            timelines.set(name, Json::Arr(keys));
        }
        bone_tl.set(&bone, timelines);
    }
    if !bone_tl.entries().is_empty() {
        anim.set("bones", bone_tl);
    }

    let constraint_name = |i: u32| -> Result<String, LoadError> {
        constraints.get(i as usize).and_then(|c| c.get("name").as_str()).map(str::to_string).ok_or_else(|| LoadError("invalid constraint index in .skel data".into()))
    };

    let mut ik = Json::obj();
    for _ in 0..r.varint()? {
        let ci = r.varint()?;
        let name = constraint_name(ci)?;
        let frames = r.varint()?;
        r.varint()?;
        let mut keys: Vec<Json> = Vec::new();
        for f in 0..frames {
            let flags = r.byte()?;
            let mut key = Json::obj();
            let time = r.float()?;
            if time != 0.0 {
                key.set("time", num(time));
            }
            if flags & 0x01 == 0 {
                key.set("mix", num(0.0));
            } else if flags & 0x02 != 0 {
                let m = r.float()?;
                key.set("mix", num(m));
            }
            if flags & 0x04 != 0 {
                let sft = r.float()?;
                key.set("softness", num(sft));
            }
            if flags & 0x08 == 0 {
                key.set("bendPositive", Json::Bool(false));
            }
            if flags & 0x10 != 0 {
                key.set("compress", Json::Bool(true));
            }
            if flags & 0x20 != 0 {
                key.set("stretch", Json::Bool(true));
            }
            if flags & 0x40 != 0 {
                if f > 0 {
                    keys.last_mut().unwrap().set("curve", s("stepped"));
                }
            } else if flags & 0x80 != 0 {
                let mut curve = Vec::new();
                for _ in 0..8 {
                    let v = r.float()?;
                    curve.push(num(v));
                }
                if f > 0 {
                    keys.last_mut().unwrap().set("curve", Json::Arr(curve));
                }
            }
            keys.push(key);
        }
        ik.set(&name, Json::Arr(keys));
    }
    if !ik.entries().is_empty() {
        anim.set("ik", ik);
    }

    let mut transform = Json::obj();
    for _ in 0..r.varint()? {
        let ci = r.varint()?;
        let name = constraint_name(ci)?;
        let frames = r.varint()?;
        r.varint()?;
        let mapped = r.transform_mapped.get(&name).cloned().unwrap_or_else(|| TRANSFORM_PROPERTIES.to_vec());
        let keys = read_curve_keys(r, frames, |rr, key| {
            for (mix, property, _) in TRANSFORM_MIXES {
                let v = rr.float()?;
                if v != 1.0 && mapped.contains(&property) {
                    key.set(mix, num(v));
                }
            }
            Ok(6)
        })?;
        transform.set(&name, Json::Arr(keys));
    }
    if !transform.entries().is_empty() {
        anim.set("transform", transform);
    }

    // Path, physics and slider keys.
    let mut path = Json::obj();
    for _ in 0..r.varint()? {
        let ci = r.varint()?;
        let name = constraint_name(ci)?;
        let mut entry = Json::obj();
        for _ in 0..r.varint()? {
            let code = r.byte()?;
            if code != 0 {
                return unsupported(format!("Path constraint key type {code}"));
            }
            let frames = r.varint()?;
            r.varint()?;
            let keys = read_curve_keys(r, frames, one_value(0.0))?;
            entry.set("position", Json::Arr(keys));
        }
        path.set(&name, entry);
    }
    if !path.entries().is_empty() {
        anim.set("path", path);
    }
    let mut physics = Json::obj();
    for _ in 0..r.varint()? {
        let index = r.varint()?;
        let name = if index == 0 { String::new() } else { constraint_name(index - 1)? };
        let mut entry = physics.get(&name).clone();
        if entry.is_null() {
            entry = Json::obj();
        }
        for _ in 0..r.varint()? {
            let code = r.byte()?;
            if code != 5 {
                return unsupported(format!("Physics key type {code}"));
            }
            let frames = r.varint()?;
            r.varint()?;
            let keys = read_curve_keys(r, frames, one_value(0.0))?;
            entry.set("wind", Json::Arr(keys));
        }
        physics.set(&name, entry);
    }
    if !physics.entries().is_empty() {
        anim.set("physics", physics);
    }
    let mut slider = Json::obj();
    for _ in 0..r.varint()? {
        let ci = r.varint()?;
        let name = constraint_name(ci)?;
        let mut entry = Json::obj();
        for _ in 0..r.varint()? {
            let code = r.byte()?;
            if code != 1 {
                return unsupported(format!("Slider key type {code}"));
            }
            let frames = r.varint()?;
            r.varint()?;
            let keys = read_curve_keys(r, frames, one_value(1.0))?;
            entry.set("mix", Json::Arr(keys));
        }
        slider.set(&name, entry);
    }
    if !slider.entries().is_empty() {
        anim.set("slider", slider);
    }

    let mut attachments = Json::obj();
    for _ in 0..r.varint()? {
        let ki = r.varint()?;
        let Some(skin) = skins.get(ki as usize).and_then(|k| k.get("name").as_str()).map(str::to_string) else { return bad("invalid skin index in .skel data") };
        let mut skin_entry = attachments.get(&skin).clone();
        if skin_entry.is_null() {
            skin_entry = Json::obj();
        }
        for _ in 0..r.varint()? {
            let si = r.varint()? as usize;
            let slot = r.slot_name(si)?;
            let mut slot_entry = skin_entry.get(&slot).clone();
            if slot_entry.is_null() {
                slot_entry = Json::obj();
            }
            for _ in 0..r.varint()? {
                let att = r.reference()?.unwrap_or_default();
                let kind = r.byte()?;
                let frames = r.varint()?;
                let mut timelines = slot_entry.get(&att).clone();
                if timelines.is_null() {
                    timelines = Json::obj();
                }
                match kind {
                    0 => {
                        r.varint()?;
                        let keys = read_deform_keys(r, frames)?;
                        timelines.set("deform", keys);
                    }
                    1 => {
                        let mut keys = Vec::new();
                        let mut last_delay = 0.0;
                        for _ in 0..frames {
                            let mut key = Json::obj();
                            let time = r.float()?;
                            let mode_index = r.uint()?;
                            let delay = r.float()?;
                            let Some(Some(mode)) = SEQUENCE_MODES.get((mode_index & 0x0f) as usize) else { return unsupported(format!("Sequence mode {}", mode_index & 0x0f)) };
                            if time != 0.0 {
                                key.set("time", num(time));
                            }
                            if *mode != "hold" {
                                key.set("mode", s(mode));
                            }
                            if mode_index >> 4 != 0 {
                                key.set("index", num((mode_index >> 4) as f64));
                            }
                            if delay != last_delay {
                                key.set("delay", num(delay));
                            }
                            last_delay = delay;
                            keys.push(key);
                        }
                        timelines.set("sequence", Json::Arr(keys));
                    }
                    other => return unsupported(format!("Attachment timeline type {other}")),
                }
                slot_entry.set(&att, timelines);
            }
            skin_entry.set(&slot, slot_entry);
        }
        attachments.set(&skin, skin_entry);
    }
    if !attachments.entries().is_empty() {
        anim.set("attachments", attachments);
    }

    let mut draw = Vec::new();
    for _ in 0..r.varint()? {
        let mut key = Json::obj();
        let time = r.float()?;
        if time != 0.0 {
            key.set("time", num(time));
        }
        let n = r.varint()?;
        if n > 0 {
            let mut offsets = Vec::new();
            for _ in 0..n {
                let mut o = Json::obj();
                let si = r.varint()?;
                o.set("slot", name_at(slots, si, "slot")?);
                let off = r.varint()? as i32;
                o.set("offset", num(off as f64));
                offsets.push(o);
            }
            key.set("offsets", Json::Arr(offsets));
        }
        draw.push(key);
    }
    if !draw.is_empty() {
        anim.set("drawOrder", Json::Arr(draw));
    }
    if r.varint()? != 0 {
        return unsupported("An unknown animation section");
    }
    let mut ev = Vec::new();
    for _ in 0..r.varint()? {
        let time = r.float()?;
        let mut key = Json::obj();
        if time != 0.0 {
            key.set("time", num(time));
        }
        let ni = r.varint()? as usize;
        let name = event_names.get(ni).cloned().unwrap_or_default();
        key.set("name", s(&name));
        let int = r.svarint()?;
        let float = r.float()?;
        let def = events.get(&name);
        if int as f64 != def.num("int", 0.0) {
            key.set("int", num(int as f64));
        }
        if float != def.num("float", 0.0) {
            key.set("float", num(float));
        }
        if r.bool()? {
            let st = r.str_json()?;
            key.set("string", st);
        }
        if def.truthy("audio") {
            let v = r.float()?;
            key.set("volume", num(v));
            let b = r.float()?;
            key.set("balance", num(b));
        }
        ev.push(key);
    }
    if !ev.is_empty() {
        anim.set("events", Json::Arr(ev));
    }
    r.color()?;
    Ok(anim)
}

/// Deform keys: time, the previous segment's curve, then a value count, start offset and values.
pub(crate) fn read_deform_keys(r: &mut Reader, frames: u32) -> Result<Json, LoadError> {
    let mut keys: Vec<Json> = Vec::new();
    for f in 0..frames {
        let mut key = Json::obj();
        let time = r.float()?;
        if time != 0.0 {
            key.set("time", num(time));
        }
        if f > 0 {
            let c = r.byte()?;
            let prev = keys.last_mut().unwrap();
            match c {
                0 => {}
                1 => prev.set("curve", s("stepped")),
                2 => {
                    let mut cv = Vec::new();
                    for _ in 0..4 {
                        let v = r.float()?;
                        cv.push(num(v));
                    }
                    prev.set("curve", Json::Arr(cv));
                }
                other => return Err(LoadError(format!("invalid curve type {other}"))),
            }
        }
        let count = r.varint()?;
        if count > 0 {
            let offset = r.varint()?;
            if offset != 0 {
                key.set("offset", num(offset as f64));
            }
            let mut v = Vec::new();
            for _ in 0..count {
                let x = r.float()?;
                v.push(num(x));
            }
            key.set("vertices", Json::Arr(v));
        }
        keys.push(key);
    }
    Ok(Json::Arr(keys))
}
