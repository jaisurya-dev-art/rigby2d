// SPDX-License-Identifier: MIT OR Apache-2.0
//! Binary skeleton files in format 4.2, read into the 4.2 skeleton JSON structure (separate ik,
//! transform and path lists), which the skeleton JSON reader converts as it does 4.2 JSON. Mirrors
//! `readSkeleton42` in the JavaScript runtime (src/core/binary.js): the layout was observed from a
//! paired 4.2 JSON and binary export, and only what that pair shows is read. Anything else stops with
//! an "unsupported" error.

use crate::binary::{name_at, num, s, unsupported, Reader, BONE_TIMELINES, INHERIT, POSITION_MODES, ROTATE_MODES, SPACING_MODES};
use crate::json::Json;
use crate::reader::LoadError;

/// IK constraint flags: bend positive, and mix 1 (other mixes haven't been seen in 4.2).
const IK42_BEND_POSITIVE: u8 = 0x02;
const IK42_MIX: u8 = 0x20;
/// Transform offsets present: first flags byte, bits 3 to 7.
const TRANSFORM42_OFFSETS: [&str; 5] = ["rotation", "x", "y", "scaleX", "scaleY"];
/// Second flags byte: bit 0 shearY, bits 1 to 6 these mixes (absent = 0), with their defaults
/// (a number, or the mix whose value is the default).
const TRANSFORM42_MIXES: [(&str, Result<f64, &str>); 6] = [
    ("mixRotate", Ok(1.0)),
    ("mixX", Ok(1.0)),
    ("mixY", Err("mixX")),
    ("mixScaleX", Ok(1.0)),
    ("mixScaleY", Err("mixScaleX")),
    ("mixShearY", Ok(1.0)),
];
/// The one IK key seen: mix 0, bend positive, no softness, compress or stretch.
const IK42_KEY: u8 = 0x0a;
const ATTACHMENT_REGION: u8 = 0;
const ATTACHMENT_MESH: u8 = 2;
const ATTACHMENT_PATH: u8 = 4;
const FLAG_ROTATION: u8 = 0x80;
const FLAG_WEIGHTED: u8 = 0x80;
const PATH_CONSTANT_SPEED: u8 = 0x20;
const PATH_WEIGHTED: u8 = 0x40;

/// Reads a 4.2 file after its header and string table into `out`.
pub(crate) fn read_skeleton_42(r: &mut Reader, mut out: Json, nonessential: bool, len: usize) -> Result<Json, LoadError> {
    let mut bones: Vec<Json> = Vec::new();
    for i in 0..r.varint()? {
        let mut b = Json::obj();
        let name = r.string()?.unwrap_or_default();
        b.set("name", s(&name));
        if i > 0 {
            let p = r.varint()?;
            b.set("parent", name_at(&bones, p, "bone")?);
        }
        let mut t = [0.0; 7];
        for v in t.iter_mut() {
            *v = r.float()?;
        }
        let length = r.float()?;
        let Some(inherit) = INHERIT.get(r.byte()? as usize).copied() else { return unsupported(format!("Bone inherit mode on '{name}'")) };
        if r.bool()? {
            return unsupported(format!("Skin bones in format 4.2 ('{name}')"));
        }
        if length != 0.0 {
            b.set("length", num(length));
        }
        for (k, v, def) in [("rotation", t[0], 0.0), ("x", t[1], 0.0), ("y", t[2], 0.0), ("scaleX", t[3], 1.0), ("scaleY", t[4], 1.0), ("shearX", t[5], 0.0), ("shearY", t[6], 0.0)] {
            if v != def {
                b.set(k, num(v));
            }
        }
        if inherit != "normal" {
            b.set("inherit", s(inherit));
        }
        if nonessential {
            let _color = r.color()?;
            let _icon = r.string()?;
            // One more byte: the 4.3 visibility flag, not confirmed as such in 4.2, so not mapped.
            r.byte()?;
        }
        bones.push(b);
    }

    let mut slots: Vec<Json> = Vec::new();
    for _ in 0..r.varint()? {
        let mut sl = Json::obj();
        let name = r.string()?.unwrap_or_default();
        sl.set("name", s(&name));
        let bi = r.varint()?;
        sl.set("bone", name_at(&bones, bi, "bone")?);
        let color = r.color()?;
        let dark = r.color()?;
        if color != "ffffffff" || dark != "ffffffff" {
            return unsupported(format!("Slot colors in format 4.2 ('{name}')"));
        }
        if let Some(a) = r.reference()? {
            sl.set("attachment", s(&a));
        }
        if r.byte()? != 0 {
            return unsupported(format!("Slot blend modes in format 4.2 ('{name}')"));
        }
        if nonessential {
            r.bool()?;
        }
        r.slots.push(name);
        slots.push(sl);
    }

    // Constraints: the IK, transform, path and physics lists, each entry with its application order.
    fn head(r: &mut Reader) -> Result<(String, u32), LoadError> {
        Ok((r.string()?.unwrap_or_default(), r.varint()?))
    }
    fn start(name: &str, order: u32) -> Json {
        let mut c = Json::obj();
        c.set("name", s(name));
        if order != 0 {
            c.set("order", num(order as f64));
        }
        c
    }
    fn bone_list(r: &mut Reader, bones: &[Json]) -> Result<Json, LoadError> {
        let mut list = Vec::new();
        for _ in 0..r.varint()? {
            let bi = r.varint()?;
            list.push(name_at(bones, bi, "bone")?);
        }
        Ok(Json::Arr(list))
    }

    let mut ik = Vec::new();
    for _ in 0..r.varint()? {
        let (name, order) = head(r)?;
        let list = bone_list(r, &bones)?;
        let ti = r.varint()?;
        let target = name_at(&bones, ti, "bone")?;
        let flags = r.byte()?;
        if flags & !IK42_BEND_POSITIVE != IK42_MIX {
            return unsupported(format!("IK constraint options (flags 0x{flags:x}) on '{name}'"));
        }
        let mut c = start(&name, order);
        c.set("bones", list);
        c.set("target", target);
        if flags & IK42_BEND_POSITIVE == 0 {
            c.set("bendPositive", Json::Bool(false));
        }
        ik.push(c);
    }

    let mut transform = Vec::new();
    for _ in 0..r.varint()? {
        let (name, order) = head(r)?;
        let list = bone_list(r, &bones)?;
        let ti = r.varint()?;
        let mut c = start(&name, order);
        c.set("bones", list);
        c.set("target", name_at(&bones, ti, "bone")?);
        let offsets = r.byte()?;
        if offsets & 0x07 != 0 {
            return unsupported(format!("Transform constraint options (flags 0x{offsets:x}) on '{name}'"));
        }
        for (k, key) in TRANSFORM42_OFFSETS.iter().enumerate() {
            if offsets & (8 << k) != 0 {
                let v = r.float()?;
                c.set(key, num(v));
            }
        }
        let more = r.byte()?;
        if more & 0x80 != 0 {
            return unsupported(format!("Transform constraint options (0x{more:x}) on '{name}'"));
        }
        if more & 0x01 != 0 {
            let v = r.float()?;
            c.set("shearY", num(v));
        }
        let mut mix = [0.0; 6];
        for (k, v) in mix.iter_mut().enumerate() {
            if more & (2 << k) != 0 {
                *v = r.float()?;
            }
        }
        for (k, (key, def)) in TRANSFORM42_MIXES.iter().enumerate() {
            let d = match def {
                Ok(n) => *n,
                Err(other) => mix[TRANSFORM42_MIXES.iter().position(|(n, _)| n == other).unwrap()],
            };
            if mix[k] != d {
                c.set(key, num(mix[k]));
            }
        }
        transform.push(c);
    }

    let mut path = Vec::new();
    for _ in 0..r.varint()? {
        let (name, order) = head(r)?;
        if r.bool()? {
            return unsupported(format!("Path constraint options on '{name}'"));
        }
        let list = bone_list(r, &bones)?;
        let si = r.varint()?;
        let mut c = start(&name, order);
        c.set("bones", list);
        c.set("target", name_at(&slots, si, "slot")?);
        let modes = r.byte()?;
        let rotate = ROTATE_MODES.get(((modes >> 3) & 3) as usize).copied();
        let Some(rotate) = rotate.filter(|_| modes & !0x1f == 0) else { return unsupported(format!("Path constraint options (flags 0x{modes:x}) on '{name}'")) };
        let position = POSITION_MODES[(modes & 1) as usize];
        let spacing = SPACING_MODES[((modes >> 1) & 3) as usize];
        if position != "percent" {
            c.set("positionMode", s(position));
        }
        if spacing != "length" {
            c.set("spacingMode", s(spacing));
        }
        if rotate != "tangent" {
            c.set("rotateMode", s(rotate));
        }
        let mut v = [0.0; 5];
        for x in v.iter_mut() {
            *x = r.float()?;
        }
        let [position_v, spacing_v, mix_rotate, mix_x, mix_y] = v;
        if position_v != 0.0 {
            c.set("position", num(position_v));
        }
        if spacing_v != 0.0 {
            c.set("spacing", num(spacing_v));
        }
        if mix_rotate != 1.0 {
            c.set("mixRotate", num(mix_rotate));
        }
        if mix_x != 1.0 {
            c.set("mixX", num(mix_x));
        }
        if mix_y != mix_x {
            c.set("mixY", num(mix_y));
        }
        path.push(c);
    }
    if r.varint()? != 0 {
        return unsupported("Physics constraints in format 4.2");
    }

    let mut skin = Json::obj();
    skin.set("name", s("default"));
    skin.set("attachments", read_skin_42(r, &slots, nonessential)?);
    if r.varint()? != 0 {
        return unsupported("Named skins in format 4.2");
    }
    if r.varint()? != 0 {
        return unsupported("Events in format 4.2");
    }

    let mut animations = Json::obj();
    for _ in 0..r.varint()? {
        let name = r.string()?.unwrap_or_default();
        let anim = read_animation_42(r, &bones, &ik)?;
        animations.set(&name, anim);
    }
    if r.p != len {
        return Err(LoadError(format!("unexpected data after the animations ({} bytes)", len - r.p)));
    }
    out.set("bones", Json::Arr(bones));
    out.set("slots", Json::Arr(slots));
    for (key, list) in [("ik", ik), ("transform", transform), ("path", path)] {
        if !list.is_empty() {
            out.set(key, Json::Arr(list));
        }
    }
    out.set("skins", Json::Arr(vec![skin]));
    out.set("animations", animations);
    Ok(out)
}

fn read_skin_42(r: &mut Reader, slots: &[Json], nonessential: bool) -> Result<Json, LoadError> {
    let mut skin = Json::obj();
    for _ in 0..r.varint()? {
        let si = r.varint()?;
        let slot = name_at(slots, si, "slot")?.as_str().unwrap_or("").to_string();
        let mut atts = Json::obj();
        for _ in 0..r.varint()? {
            let key = r.reference()?.unwrap_or_default();
            let flags = r.byte()?;
            let a = read_attachment_42(r, flags, &key, nonessential)?;
            atts.set(&key, a);
        }
        skin.set(&slot, atts);
    }
    Ok(skin)
}

/// A region, a weighted mesh, or a weighted, open, constant-speed path.
fn read_attachment_42(r: &mut Reader, flags: u8, key: &str, nonessential: bool) -> Result<Json, LoadError> {
    let mut a = Json::obj();
    if flags & 0x07 == ATTACHMENT_REGION && flags & !FLAG_ROTATION == 0 {
        let rotation = if flags & FLAG_ROTATION != 0 { r.float()? } else { 0.0 };
        let mut v = [0.0; 6];
        for x in v.iter_mut() {
            *x = r.float()?;
        }
        for (k, value, def) in [("rotation", rotation, Some(0.0)), ("x", v[0], Some(0.0)), ("y", v[1], Some(0.0)), ("scaleX", v[2], Some(1.0)), ("scaleY", v[3], Some(1.0)), ("width", v[4], None), ("height", v[5], None)] {
            if Some(value) != def {
                a.set(k, num(value));
            }
        }
        return Ok(a);
    }
    if flags == ATTACHMENT_MESH | FLAG_WEIGHTED {
        a.set("type", s("mesh"));
        let hull = r.varint()?;
        a.set("hull", num(hull as f64));
        let count = r.varint()? as usize;
        a.set("vertices", read_weights_42(r, count)?);
        let mut uvs = Vec::new();
        for _ in 0..count * 2 {
            let v = r.float()?;
            uvs.push(num(v));
        }
        a.set("uvs", Json::Arr(uvs));
        let mut tris = Vec::new();
        for _ in 0..3 * (2 * count).saturating_sub(hull as usize + 2) {
            let v = r.varint()?;
            tris.push(num(v as f64));
        }
        a.set("triangles", Json::Arr(tris));
        if nonessential {
            let mut edges = Vec::new();
            for _ in 0..r.varint()? {
                let v = r.varint()?;
                edges.push(num(v as f64));
            }
            a.set("edges", Json::Arr(edges));
            let w = r.float()?;
            a.set("width", num(w));
            let h = r.float()?;
            a.set("height", num(h));
        }
        return Ok(a);
    }
    if flags == ATTACHMENT_PATH | PATH_CONSTANT_SPEED | PATH_WEIGHTED {
        a.set("type", s("path"));
        let count = r.varint()? as usize;
        a.set("vertexCount", num(count as f64));
        a.set("vertices", read_weights_42(r, count)?);
        let mut lengths = Vec::new();
        for _ in 0..count / 3 {
            let v = r.float()?;
            lengths.push(num(v));
        }
        a.set("lengths", Json::Arr(lengths));
        if nonessential {
            let color = r.color()?;
            if color != "ff7f00ff" {
                a.set("color", s(&color));
            }
        }
        return Ok(a);
    }
    unsupported(format!("Attachment options in format 4.2 (flags 0x{flags:x}) on '{key}'"))
}

/// Weighted vertices without a size hint: per vertex, a bone count, then bone, x, y and weight.
fn read_weights_42(r: &mut Reader, count: usize) -> Result<Json, LoadError> {
    let mut out = Vec::new();
    for _ in 0..count {
        let n = r.varint()?;
        out.push(num(n as f64));
        for _ in 0..n {
            let b = r.varint()?;
            out.push(num(b as f64));
            for _ in 0..3 {
                let v = r.float()?;
                out.push(num(v));
            }
        }
    }
    Ok(Json::Arr(out))
}

fn read_animation_42(r: &mut Reader, bones: &[Json], ik: &[Json]) -> Result<Json, LoadError> {
    let mut anim = Json::obj();
    r.varint()?; // total timeline count
    if r.varint()? != 0 {
        return unsupported("Slot keys in format 4.2");
    }
    let mut bone_tl = Json::obj();
    for _ in 0..r.varint()? {
        let bi = r.varint()?;
        let bone = name_at(bones, bi, "bone")?.as_str().unwrap_or("").to_string();
        let mut timelines = Json::obj();
        for _ in 0..r.varint()? {
            let kind = r.byte()?;
            let frames = r.varint()?;
            r.varint()?; // bezier count
            let Some(&(name, count)) = BONE_TIMELINES.get(kind as usize) else { return unsupported(format!("Bone timeline type {kind}")) };
            let def = if name.starts_with("scale") { 1.0 } else { 0.0 };
            let keys = crate::binary::read_curve_keys(r, frames, |rr, key| {
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

    let mut ik_tl = Json::obj();
    for _ in 0..r.varint()? {
        let ci = r.varint()?;
        let Some(c) = ik.get(ci as usize) else { return Err(LoadError("invalid constraint index in .skel data".into())) };
        let cname = c.get("name").as_str().unwrap_or("").to_string();
        let frames = r.varint()?;
        r.varint()?; // bezier count
        if frames != 1 {
            return unsupported("IK keys with curves in format 4.2");
        }
        let flags = r.byte()?;
        if flags != IK42_KEY {
            return unsupported(format!("IK key options in format 4.2 (flags 0x{flags:x})"));
        }
        let mut key = Json::obj();
        let time = r.float()?;
        if time != 0.0 {
            key.set("time", num(time));
        }
        key.set("mix", num(0.0));
        ik_tl.set(&cname, Json::Arr(vec![key]));
    }
    if !ik_tl.entries().is_empty() {
        anim.set("ik", ik_tl);
    }
    for what in ["Transform", "Path", "Physics"] {
        if r.varint()? != 0 {
            return unsupported(format!("{what} constraint keys in format 4.2"));
        }
    }

    let mut skins_tl = Json::obj();
    for _ in 0..r.varint()? {
        if r.varint()? != 0 {
            return Err(LoadError("invalid skin index in .skel data".into()));
        }
        let mut slots_tl = Json::obj();
        for _ in 0..r.varint()? {
            let si = r.varint()? as usize;
            let slot = r.slot_name(si)?;
            let mut atts = Json::obj();
            for _ in 0..r.varint()? {
                let attachment = r.reference()?.unwrap_or_default();
                let kind = r.byte()?;
                let frames = r.varint()?;
                if kind != 0 {
                    return unsupported(format!("Attachment timeline type {kind} in format 4.2"));
                }
                r.varint()?; // bezier count
                let mut tl = Json::obj();
                tl.set("deform", crate::binary::read_deform_keys(r, frames)?);
                atts.set(&attachment, tl);
            }
            slots_tl.set(&slot, atts);
        }
        skins_tl.set("default", slots_tl);
    }
    if !skins_tl.entries().is_empty() {
        anim.set("attachments", skins_tl);
    }
    if r.varint()? != 0 {
        return unsupported("Draw order keys in format 4.2");
    }
    if r.varint()? != 0 {
        return unsupported("Event keys in format 4.2");
    }
    Ok(anim)
}
