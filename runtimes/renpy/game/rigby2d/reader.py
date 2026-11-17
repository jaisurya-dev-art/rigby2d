# SPDX-License-Identifier: MIT OR Apache-2.0
"""Reads skeleton JSON (formats 3.8 and 4.x) into ``SkeletonData``.

A port of ``runtimes/rust/rigby-runtime/src/reader.rs`` (itself matching the JavaScript runtime in
``src/core``). Binary ``.skel`` files are not read: export skeleton JSON for Ren'Py.
"""

import json
import math

from . import model as M
from .curve import STEPPED, RawKey
from .mathx import js_round, setup_transform

VERSION_FIELD = "spine"


class LoadError(Exception):
    pass


# ---- JSON helpers (JavaScript semantics, as the Rust reader) ---------------------------------------

def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _get(o, key):
    if isinstance(o, dict):
        return o.get(key)
    return None


def _has(o, key):
    return _get(o, key) is not None


def num(o, key, default):
    v = _get(o, key)
    return float(v) if _is_num(v) else default


def truthy(o, key):
    v = _get(o, key)
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if _is_num(v):
        return v != 0 and v == v
    if isinstance(v, str):
        return v != ""
    return True


def flag(o, key, default):
    return default if _get(o, key) is None else truthy(o, key)


def str_or(o, key, default):
    v = _get(o, key)
    return v if isinstance(v, str) else default


def as_str(v):
    return v if isinstance(v, str) else None


def arr(v):
    return v if isinstance(v, list) else []


def entries(v):
    return list(v.items()) if isinstance(v, dict) else []


def nums(v):
    return [float(x) if _is_num(x) else 0.0 for x in arr(v)]


def val(k, field, default):
    """``k[field] ?? default`` for numbers (NaN when present but not a number)."""
    v = _get(k, field)
    if v is None:
        return default
    return float(v) if _is_num(v) else float("nan")


def round5(v):
    return js_round(v * 1e5) / 1e5


_HEX = set("0123456789abcdefABCDEF")


def hex_to_color(hex_value, default):
    """Parses "rrggbb" or "rrggbbaa" into 0..1 components; ``default`` when invalid."""
    s = hex_value if isinstance(hex_value, str) else None
    if s is None or len(s) not in (6, 8) or not all(ch in _HEX for ch in s):
        return list(default)
    c = [int(s[i:i + 2], 16) / 255.0 for i in range(0, len(s), 2)]
    if len(c) == 3 and len(default) == 4:
        c.append(1.0)
    return c


def color4(v):
    return [v[i] if i < len(v) else 1.0 for i in range(4)]


WHITE = [1.0, 1.0, 1.0, 1.0]

_DEFAULT_ATTACHMENT_COLORS = {"boundingbox": "60F000FF", "path": "FF7F00FF", "point": "F1F100FF", "clipping": "CE3A3AFF"}


def default_attachment_color(kind):
    hex_value = _DEFAULT_ATTACHMENT_COLORS.get(kind)
    if hex_value is None:
        return list(WHITE)
    return color4(hex_to_color(hex_value, WHITE))


def decode_vertices(vertices, count):
    """Splits a packed vertex array into plain floats or per-vertex weights."""
    if not isinstance(vertices, list):
        return []
    v = [float(x) if _is_num(x) else 0.0 for x in vertices]
    if len(v) <= count * 2:
        return v
    weights = []
    i = 0
    n = len(v)
    while i < n and len(weights) < count:
        bones = int(v[i])
        i += 1
        w = []
        for _ in range(bones):
            if i + 3 >= n:
                break
            w.append((int(v[i]), v[i + 1], v[i + 2], v[i + 3]))
            i += 4
        weights.append(w)
    return M.Weighted(weights)


class _Ctx(object):
    def __init__(self, v4, bones, slots):
        self.v4 = v4
        self.bones = bones
        self.slots = slots

    def bone(self, name):
        n = name if isinstance(name, str) else ""
        if n not in self.bones:
            raise LoadError("unknown bone '%s'" % n)
        return self.bones[n]

    def slot(self, name):
        n = name if isinstance(name, str) else ""
        if n not in self.slots:
            raise LoadError("unknown slot '%s'" % n)
        return self.slots[n]


def is_skeleton_json(obj):
    return isinstance(_get(obj, "skeleton"), dict) and isinstance(_get(obj, "bones"), list)


def load_skeleton_text(text):
    """Loads skeleton data from JSON text."""
    if text.startswith("﻿"):
        text = text[1:]
    try:
        obj = json.loads(text)
    except ValueError as e:
        raise LoadError("invalid JSON: %s" % e)
    return read_skeleton_json(obj)


def load_skeleton(data):
    """Loads skeleton data from bytes or text of a skeleton JSON file."""
    if isinstance(data, bytes):
        if len(data) > 0 and data[:1] not in (b"{", b" ", b"\n", b"\r", b"\t", b"\xef"):
            raise LoadError("this looks like a binary .skel file: export skeleton JSON (.json) for Ren'Py")
        try:
            data = data.decode("utf-8")
        except UnicodeDecodeError:
            raise LoadError("the file is neither skeleton JSON nor UTF-8 text")
    return load_skeleton_text(data)


def read_skeleton_json(obj):
    """Converts a parsed skeleton JSON file into ``SkeletonData``."""
    if not is_skeleton_json(obj):
        raise LoadError("not a skeleton JSON file")
    header = obj["skeleton"]
    version = header.get(VERSION_FIELD)
    if isinstance(version, str):
        version_text = version
    elif _is_num(version):
        version_text = str(version)
    else:
        version_text = "3.8"
    try:
        major = float(version_text.split(".")[0])
    except ValueError:
        major = 3.0
    v4 = (3.0 if major == 0.0 else major) >= 4.0

    sk = M.SkeletonData()
    sk.version = version if isinstance(version, str) else None
    sk.x = num(header, "x", 0.0)
    sk.y = num(header, "y", 0.0)
    sk.width = num(header, "width", 0.0)
    sk.height = num(header, "height", 0.0)
    sk.fps = num(header, "fps", 30.0)

    # Bones.
    bone_index = {}
    for i, b in enumerate(arr(obj.get("bones"))):
        name = str_or(b, "name", "")
        p = _get(b, "parent")
        if p is None:
            parent = None
        else:
            pn = p if isinstance(p, str) else ""
            if pn not in bone_index:
                raise LoadError("bone '%s' references unknown parent '%s'" % (name, pn))
            parent = bone_index[pn]
        bone_index[name] = i
        inherit = as_str(_get(b, "inherit")) or as_str(_get(b, "transform")) or "normal"
        sk.bones.append(M.BoneData(
            i, name, parent, num(b, "length", 0.0),
            setup_transform(num(b, "x", 0.0), num(b, "y", 0.0), num(b, "rotation", 0.0), num(b, "scaleX", 1.0),
                            num(b, "scaleY", 1.0), num(b, "shearX", 0.0), num(b, "shearY", 0.0)),
            M.INHERIT.get(inherit, M.NORMAL), truthy(b, "skin"),
        ))

    ctx = _Ctx(v4, bone_index, {})

    # Slots.
    for i, s in enumerate(arr(obj.get("slots"))):
        name = str_or(s, "name", "")
        ctx.slots[name] = i
        bone = ctx.bone(_get(s, "bone"))
        attachment = as_str(_get(s, "attachment"))
        dark = None
        if truthy(s, "dark"):
            d = hex_to_color(_get(s, "dark"), [0.0, 0.0, 0.0])
            dark = [d[0], d[1], d[2]]
        blend = str_or(s, "blend", "normal")
        if blend not in ("additive", "multiply", "screen"):
            blend = "normal"
        sk.slots.append(M.SlotData(i, name, bone, attachment, color4(hex_to_color(_get(s, "color"), WHITE)), dark, blend))

    # IK constraints; the others are compiled once animations are known (sliders name one).
    unified = isinstance(obj.get("constraints"), list)
    ik_source = []
    if unified:
        for i, c in enumerate(obj["constraints"]):
            if _get(c, "type") == "ik":
                ik_source.append((c, num(c, "order", float(i))))
    else:
        for i, c in enumerate(arr(obj.get("ik"))):
            ik_source.append((c, num(c, "order", float(i))))
    for c, order in ik_source:
        sk.ik.append(M.IkData(
            name=str_or(c, "name", ""), order=order, skin_required=truthy(c, "skin"),
            bones=[ctx.bone(b) for b in arr(_get(c, "bones"))], target=ctx.bone(_get(c, "target")),
            mix=num(c, "mix", 1.0), softness=num(c, "softness", 0.0), bend_positive=flag(c, "bendPositive", True),
            compress=truthy(c, "compress"), stretch=truthy(c, "stretch"), uniform=truthy(c, "uniform"),
        ))
    ik_index = {}
    for i, c in enumerate(sk.ik):
        ik_index[c.name] = i
    if unified:
        skipped = sum(1 for c in obj["constraints"] if _get(c, "type") not in ("ik", "transform", "path", "physics", "slider"))
        if skipped:
            sk.warnings.append("%d constraint(s) of unknown types are kept but not evaluated" % skipped)

    # Skins (an array since 3.8; a map of skin name -> slots before).
    skins_value = obj.get("skins")
    skins_are_array = isinstance(skins_value, list)
    if skins_are_array:
        skins = [(str_or(s, "name", ""), s) for s in skins_value]
    elif isinstance(skins_value, dict):
        skins = list(skins_value.items())
    else:
        skins = []
    for skin_name, skin in skins:
        attachments = _get(skin, "attachments") if skins_are_array else skin
        data = M.SkinData(skin_name)
        for slot_name, atts in entries(attachments):
            s = ctx.slot(slot_name)
            found = {}
            for key, a in entries(atts):
                att = read_attachment(ctx, key, a)
                found.setdefault(att.name, att)
            if skin_name == "default":
                for name, att in found.items():
                    sk.slots[s].attachments.setdefault(name, att)
            else:
                data.slots.setdefault(s, found)
        if skin_name == "default":
            continue
        if skins_are_array:
            for key in ("constraints", "transform", "path", "physics"):
                for n in arr(_get(skin, key)):
                    if isinstance(n, str):
                        data.constraints.append(n)
            data.bones = [ctx.bone(b) for b in arr(_get(skin, "bones"))]
            data.ik = [ik_index[n] for n in arr(_get(skin, "ik")) if isinstance(n, str) and n in ik_index]
        sk.skins.append(data)

    # Events.
    for name, e in entries(obj.get("events")):
        ev = M.EventData(name, int(num(e, "int", 0.0)), num(e, "float", 0.0), as_str(_get(e, "string")),
                         as_str(_get(e, "audio")), num(e, "volume", 1.0), num(e, "balance", 0.0))
        sk.events.append(ev)
        sk.event_map.setdefault(name, ev)

    # Constraints other than IK (compiled; sliders need the animation names).
    animation_names = [k for k, _ in entries(obj.get("animations"))]
    compile_constraints(sk, obj, ctx, animation_names)

    # Animations.
    for name, a in entries(obj.get("animations")):
        anim = read_animation(sk, ctx, ik_index, len(sk.animations), name, a)
        sk.animations.append(anim)
        sk.animation_map.setdefault(name, anim.index)
    validate(sk)
    return sk


def validate(sk):
    if not sk.bones:
        raise LoadError("skeleton has no bones")
    for i, b in enumerate(sk.bones):
        if b.parent is not None and b.parent >= i:
            raise LoadError("bone '%s' comes before its parent" % b.name)


def read_transform_offset(a):
    return setup_transform(num(a, "x", 0.0), num(a, "y", 0.0), num(a, "rotation", 0.0), num(a, "scaleX", 1.0), num(a, "scaleY", 1.0), 0.0, 0.0)


def _not_false(v):
    return not (v is False or (_is_num(v) and v == 0))


def read_attachment(ctx, key, a):
    kind = str_or(a, "type", "region")
    image_name = as_str(_get(a, "path")) or as_str(_get(a, "name")) or key
    color = color4(hex_to_color(_get(a, "color"), default_attachment_color(kind)))
    att = M.Attachment(key, image_name, color, kind)
    if kind == "region":
        att.offset = read_transform_offset(a)
        att.width = num(a, "width", 0.0)
        att.height = num(a, "height", 0.0)
    elif kind == "point":
        att.offset = read_transform_offset(a)
    elif kind == "mesh":
        uvs = nums(_get(a, "uvs"))
        count = len(uvs) // 2
        att.triangles = [int(t) if _is_num(t) else 0 for t in arr(_get(a, "triangles"))]
        att.hull = int(num(a, "hull", 0.0))
        att.vertices = decode_vertices(_get(a, "vertices"), count)
        att.width = num(a, "width", 0.0)
        att.height = num(a, "height", 0.0)
        att.uvs = uvs
    elif kind == "linkedmesh":
        att.parent = as_str(_get(a, "parent")) or as_str(_get(a, "source")) or ""
        d = _get(a, "deform")
        t = _get(a, "timelines")
        if d is None and t is None:
            att.deform = True
        elif d is None:
            att.deform = _not_false(t)
        else:
            att.deform = _not_false(d)
        att.skin = as_str(_get(a, "skin"))
        att.width = num(a, "width", 0.0)
        att.height = num(a, "height", 0.0)
    elif kind in ("boundingbox", "path", "clipping"):
        count = int(num(a, "vertexCount", 0.0))
        att.vertices = decode_vertices(_get(a, "vertices"), count)
        if kind == "path":
            att.closed = truthy(a, "closed")
            att.constant_speed = flag(a, "constantSpeed", True)
            att.lengths = nums(_get(a, "lengths"))
        elif kind == "clipping":
            att.end = None if _get(a, "end") is None else ctx.slot(_get(a, "end"))
    else:
        raise LoadError("unknown attachment type '%s' ('%s')" % (kind, key))
    seq = _get(a, "sequence")
    if isinstance(seq, dict):
        count = int(num(seq, "count", 1.0))
        start = int(num(seq, "start", 1.0))
        digits = int(num(seq, "digits", 0.0))
        frames = [image_name + str(start + i).rjust(digits, "0") for i in range(max(count, 1))]
        att.sequence = M.Sequence(count, start, digits, int(num(seq, "setup", 0.0)), frames)
    return att


# ---- constraints ----------------------------------------------------------------------------------

PROP_NAMES = ("rotate", "x", "y", "scaleX", "scaleY", "shearY")
OFFSET_FIELDS = ("rotation", "x", "y", "scaleX", "scaleY", "shearY")
PROPERTIES = {"x": M.P_X, "y": M.P_Y, "scaleX": M.P_SCALE_X, "scaleY": M.P_SCALE_Y, "shearY": M.P_SHEAR_Y}


def _prop_index(name):
    try:
        return PROP_NAMES.index(name)
    except ValueError:
        return None


def compile_constraints(sk, obj, ctx, animation_names):
    entries_list = []
    if isinstance(obj.get("constraints"), list):
        for i, c in enumerate(obj["constraints"]):
            t = str_or(c, "type", "")
            if t != "ik":
                entries_list.append((c, t, float(i)))
    for t in ("transform", "path", "physics"):
        for i, c in enumerate(arr(obj.get(t))):
            entries_list.append((c, t, num(c, "order", float(i))))

    def bone_of(n):
        return ctx.bones.get(n) if isinstance(n, str) else None

    for d, t, order in entries_list:
        name = str_or(d, "name", "")
        skin_required = truthy(d, "skin")
        if t == "slider":
            an = as_str(_get(d, "animation"))
            if an is None or an not in animation_names:
                continue
            animation = animation_names.index(an)
            b = _get(d, "bone")
            if b is None:
                bone = None
            else:
                bone = bone_of(b)
                if bone is None:
                    continue
            prop = PROPERTIES.get(str_or(d, "property", "rotate"), M.P_ROTATE)
            data = {
                "animation": animation, "bone": bone, "property": prop,
                "scale": num(d, "scale", 1.0), "offset": num(d, "offset", 0.0), "local": truthy(d, "local"),
                "loop": truthy(d, "loop"), "additive": truthy(d, "additive"),
                "setup": [num(d, "time", 0.0), num(d, "mix", 1.0)],
            }
            sk.constraints.append(M.ConstraintData(name, order, skin_required, [] if bone is None else [bone], M.SLIDER, data))
        elif t == "physics":
            bone = bone_of(_get(d, "bone"))
            if bone is None:
                continue
            data = {
                "bone": bone, "x": num(d, "x", 0.0), "y": num(d, "y", 0.0), "rotate": num(d, "rotate", 0.0),
                "scale_x": num(d, "scaleX", 0.0), "shear_x": num(d, "shearX", 0.0), "limit": num(d, "limit", 5000.0),
                "fps": num(d, "fps", 60.0), "globals": [truthy(d, k + "Global") for k in M.PHYSICS_VALUES],
                "setup": [num(d, "inertia", 0.5), num(d, "strength", 100.0), num(d, "damping", 0.85), num(d, "mass", 1.0),
                          num(d, "wind", 0.0), num(d, "gravity", 0.0), num(d, "mix", 1.0)],
            }
            sk.constraints.append(M.ConstraintData(name, order, skin_required, [bone], M.PHYSICS, data))
        elif t in ("transform", "path"):
            bones = [bone_of(b) for b in arr(_get(d, "bones"))]
            if not bones or any(b is None for b in bones):
                continue
            if t == "transform":
                src = _get(d, "source") if _has(d, "source") else _get(d, "target")
                source = bone_of(src)
                if source is None:
                    continue
                sk.constraints.append(M.ConstraintData(name, order, skin_required, bones, M.TRANSFORM, transform_data(d, source)))
            else:
                slot_name = _get(d, "slot") if _has(d, "slot") else _get(d, "target")
                slot = ctx.slots.get(slot_name) if isinstance(slot_name, str) else None
                if slot is None:
                    continue
                sk.constraints.append(M.ConstraintData(name, order, skin_required, bones, M.PATH_CONSTRAINT, path_data(d, slot)))


def transform_data(d, source):
    legacy = _has(d, "rotateMix") or _has(d, "translateMix") or _has(d, "scaleMix") or _has(d, "shearMix")
    offsets = [num(d, f, 0.0) for f in OFFSET_FIELDS]
    if legacy:
        t = num(d, "translateMix", 1.0)
        s = num(d, "scaleMix", 1.0)
        mix = [num(d, "rotateMix", 1.0), t, t, s, s, num(d, "shearMix", 1.0)]
    else:
        x = num(d, "mixX", 1.0)
        sx = num(d, "mixScaleX", 1.0)
        mix = [num(d, "mixRotate", 1.0), x, num(d, "mixY", x), sx, num(d, "mixScaleY", sx), num(d, "mixShearY", 1.0)]
    if isinstance(_get(d, "properties"), dict):
        props = []
        for from_name, p in entries(d["properties"]):
            frm = _prop_index(from_name)
            if frm is None:
                continue
            to = []
            for to_name, tt in entries(_get(p, "to")):
                ti = _prop_index(to_name)
                if ti is None:
                    continue
                to.append((ti, num(tt, "offset", 0.0), num(tt, "max", 1.0), num(tt, "scale", 1.0)))
            props.append((frm, num(p, "offset", 0.0), to))
    else:
        props = [(p, 0.0, [(p, 0.0, 1.0, 1.0)]) for p in range(M.PROPS)]
    local = truthy(d, "local")
    return {
        "source": source, "offsets": offsets, "mix": mix, "props": props,
        "local_source": flag(d, "localSource", local), "local_target": flag(d, "localTarget", local),
        "additive": truthy(d, "additive") if _has(d, "additive") else truthy(d, "relative"),
        "clamp": truthy(d, "clamp"),
    }


def path_data(d, slot):
    legacy = _has(d, "rotateMix") or _has(d, "translateMix")
    x = num(d, "translateMix", 1.0) if legacy else num(d, "mixX", 1.0)
    spacing = str_or(d, "spacingMode", "length")
    if spacing not in ("fixed", "percent", "proportional"):
        spacing = "length"
    rotate = str_or(d, "rotateMode", "tangent")
    if rotate not in ("chain", "chainScale"):
        rotate = "tangent"
    return {
        "slot": slot,
        "position_mode": "fixed" if str_or(d, "positionMode", "percent") == "fixed" else "percent",
        "spacing_mode": spacing,
        "rotate_mode": rotate,
        "offset_rotation": num(d, "rotation", 0.0),
        # position, spacing, mix_rotate, mix_x, mix_y
        "setup": [num(d, "position", 0.0), num(d, "spacing", 0.0),
                  num(d, "rotateMix", 1.0) if legacy else num(d, "mixRotate", 1.0), x, x if legacy else num(d, "mixY", x)],
    }


# ---- curves and keys --------------------------------------------------------------------------------

def read_curve(key, nxt, values, next_values, v4):
    """Reads a key's curve. 3.8 uses normalized values; 4.x per-value absolute control points."""
    c = _get(key, "curve")
    if c is None:
        return None
    if isinstance(c, str):
        return STEPPED if c == "stepped" else None
    if _is_num(c):
        return (float(c), num(key, "c2", 0.0), num(key, "c3", 1.0), num(key, "c4", 1.0))
    if isinstance(c, list):
        cv = nums(c)
        if not v4 and len(cv) == 4:
            return (cv[0], cv[1], cv[2], cv[3])
        if nxt is None:
            return None
        return normalize_curve(cv, num(key, "time", 0.0), num(nxt, "time", 0.0), values, next_values)
    return None


def normalize_curve(c, t1, t2, values, next_values):
    dt = (t2 - t1) if t2 - t1 != 0.0 else 1.0
    # A component whose value does not change has no meaningful curve; it takes the shape of the others.
    beziers = []
    i = 0
    while i + 3 < len(c) and len(beziers) < len(values):
        k = len(beziers)
        v1 = values[k]
        dv = (next_values[k] if k < len(next_values) else float("nan")) - v1
        if abs(dv) <= 1e-9:
            beziers.append(None)
        else:
            beziers.append(((c[i] - t1) / dt, (c[i + 1] - v1) / dv, (c[i + 2] - t1) / dt, (c[i + 3] - v1) / dv))
        i += 4
    if not beziers:
        return None
    known = [b for b in beziers if b is not None]

    def r(b):
        return tuple(round5(v) for v in b)

    if not known:
        return r(((c[0] - t1) / dt, 0.0, (c[2] - t1) / dt, 1.0))
    shared = all(all(abs(v - k) < 1e-4 for v, k in zip(b, known[0])) for b in known)
    if len(beziers) == 1 or shared:
        return r(known[0])
    return [r(b if b is not None else known[0]) for b in beziers]


def read_numeric_keys(lst, v4, values_of):
    keys = arr(lst)
    out = []
    for i, k in enumerate(keys):
        values = values_of(k)
        nxt = keys[i + 1] if i + 1 < len(keys) else None
        next_values = values_of(nxt) if nxt is not None else list(values)
        out.append(M.Key(num(k, "time", 0.0), values, read_curve(k, nxt, values, next_values, v4)))
    return out


def raw_keys(lst, read):
    out = []
    for k in arr(lst):
        c = _get(k, "curve")
        if isinstance(c, str) and c == "stepped":
            curve = STEPPED
        elif _is_num(c):
            curve = ("norm", (float(c), num(k, "c2", 0.0), num(k, "c3", 1.0), num(k, "c4", 1.0)))
        elif isinstance(c, list):
            curve = ("abs", nums(c))
        else:
            curve = None
        out.append(RawKey(num(k, "time", 0.0), read(k), curve))
    return out


_SINGLE = {"translatex": M.CH_TRANSLATE_X, "translatey": M.CH_TRANSLATE_Y, "scalex": M.CH_SCALE_X,
           "scaley": M.CH_SCALE_Y, "shearx": M.CH_SHEAR_X, "sheary": M.CH_SHEAR_Y}

_SEQUENCE_MODES = {"once": M.ONCE, "loop": M.LOOP, "pingpong": M.PINGPONG, "onceReverse": M.ONCE_REVERSE,
                   "loopReverse": M.LOOP_REVERSE, "pingpongReverse": M.PINGPONG_REVERSE}


def read_animation(sk, ctx, ik_index, index, name, a):
    v4 = ctx.v4
    anim = M.Animation(index, name)

    for bone_name, timelines in entries(_get(a, "bones")):
        tl = M.BoneTimeline(ctx.bone(bone_name))
        for kind, keys in entries(timelines):
            if kind == "rotate":
                tl.channels[M.CH_ROTATE] = read_numeric_keys(keys, v4, lambda k: [val(k, "value", 0.0) if _has(k, "value") else val(k, "angle", 0.0)])
            elif kind == "translate":
                tl.channels[M.CH_TRANSLATE] = read_numeric_keys(keys, v4, lambda k: [val(k, "x", 0.0), val(k, "y", 0.0)])
            elif kind == "scale":
                tl.channels[M.CH_SCALE] = read_numeric_keys(keys, v4, lambda k: [val(k, "x", 1.0), val(k, "y", 1.0)])
            elif kind == "shear":
                tl.channels[M.CH_SHEAR] = read_numeric_keys(keys, v4, lambda k: [val(k, "x", 0.0), val(k, "y", 0.0)])
            elif kind in _SINGLE:
                default = 1.0 if kind.startswith("scale") else 0.0
                tl.channels[_SINGLE[kind]] = read_numeric_keys(keys, v4, lambda k, d=default: [val(k, "value", d)])
            elif kind in ("inherit", "transform"):
                lst = []
                for k in arr(keys):
                    mode = as_str(_get(k, "inherit")) or as_str(_get(k, "value")) or "normal"
                    lst.append((num(k, "time", 0.0), M.INHERIT.get(mode, M.NORMAL)))
                tl.inherit = lst
            else:
                sk.warnings.append("animation '%s': unsupported bone timeline '%s'" % (name, kind))
        # Empty key lists count as no channel (Rust checks `is_empty`).
        tl.channels = [c if c else None for c in tl.channels]
        if tl.inherit is not None and not tl.inherit:
            tl.inherit = None
        anim.bones.append(tl)

    for slot_name, timelines in entries(_get(a, "slots")):
        tl = M.SlotTimeline(ctx.slot(slot_name))
        for kind, keys in entries(timelines):
            if kind == "attachment":
                tl.attachment = [(num(k, "time", 0.0), as_str(_get(k, "name"))) for k in arr(keys)] or None
            elif kind in ("color", "rgba"):
                tl.color = read_numeric_keys(keys, v4, lambda k: hex_to_color(_get(k, "color"), WHITE)) or None
            elif kind == "rgb":
                tl.rgb = read_numeric_keys(keys, v4, lambda k: hex_to_color(_get(k, "color"), [1.0, 1.0, 1.0])) or None
            elif kind == "alpha":
                tl.alpha = read_numeric_keys(keys, v4, lambda k: [val(k, "value", 1.0)]) or None
            elif kind in ("twoColor", "rgba2"):
                tl.rgba2 = read_numeric_keys(keys, v4, lambda k: hex_to_color(_get(k, "light"), WHITE) + hex_to_color(_get(k, "dark"), [0.0, 0.0, 0.0])) or None
            elif kind == "rgb2":
                tl.rgb2 = read_numeric_keys(keys, v4, lambda k: hex_to_color(_get(k, "light"), [1.0, 1.0, 1.0]) + hex_to_color(_get(k, "dark"), [0.0, 0.0, 0.0])) or None
            else:
                sk.warnings.append("animation '%s': unsupported slot timeline '%s'" % (name, kind))
        anim.slots.append(tl)

    def read_deform(skin, slot_name, att, keys):
        lst = arr(keys)
        dkeys = []
        for i, k in enumerate(lst):
            dkeys.append(M.DeformKey(num(k, "time", 0.0), int(num(k, "offset", 0.0)), nums(_get(k, "vertices")),
                                     read_curve(k, lst[i + 1] if i + 1 < len(lst) else None, [0.0], [1.0], v4)))
        anim.deform.append(M.DeformTimeline(None if skin == "default" else skin, ctx.slot(slot_name), att, dkeys))

    for skin, slots in entries(_get(a, "deform")):
        for slot_name, atts in entries(slots):
            for att, keys in entries(atts):
                read_deform(skin, slot_name, att, keys)
    for skin, slots in entries(_get(a, "attachments")):
        for slot_name, atts in entries(slots):
            for att, timelines in entries(atts):
                if _has(timelines, "deform"):
                    read_deform(skin, slot_name, att, timelines["deform"])
                if isinstance(_get(timelines, "sequence"), list):
                    slot = ctx.slots.get(slot_name)
                    if slot is None:
                        continue
                    skeys = []
                    for k in timelines["sequence"]:
                        delay = _get(k, "delay")
                        skeys.append(M.SequenceKey(num(k, "time", 0.0), _SEQUENCE_MODES.get(str_or(k, "mode", "hold"), M.HOLD),
                                                   int(num(k, "index", 0.0)), float(delay) if _is_num(delay) else None))
                    anim.sequences.append(M.SequenceTimeline(None if skin == "default" else skin, slot, att, skeys))

    draw_order = _get(a, "drawOrder") if _has(a, "drawOrder") else _get(a, "draworder")
    for k in arr(draw_order):
        if isinstance(_get(k, "offsets"), list):
            offsets = [(ctx.slot(_get(o, "slot")), int(num(o, "offset", 0.0))) for o in k["offsets"]]
        else:
            offsets = None
        anim.draw_order.append((num(k, "time", 0.0), offsets))
    anim.draw_order_times = [k[0] for k in anim.draw_order]

    for e in arr(_get(a, "events")):
        iv = _get(e, "int")
        fv = _get(e, "float")
        vv = _get(e, "volume")
        bv = _get(e, "balance")
        anim.events.append(M.EventKey(num(e, "time", 0.0), str_or(e, "name", ""),
                                      int(iv) if _is_num(iv) else None, float(fv) if _is_num(fv) else None,
                                      as_str(_get(e, "string")), float(vv) if _is_num(vv) else None,
                                      float(bv) if _is_num(bv) else None))

    for ik_name, keys in entries(_get(a, "ik")):
        if ik_name not in ik_index:
            continue
        ikeys = [M.IkKey(num(k, "time", 0.0), num(k, "mix", 1.0), num(k, "softness", 0.0), flag(k, "bendPositive", True),
                         truthy(k, "compress"), truthy(k, "stretch")) for k in arr(keys)]
        anim.ik.append((ik_index[ik_name], ikeys))

    # Transform, path, physics and slider keys, by compiled constraint.
    anim.has_constraint_keys = any(_get(a, k) is not None and _get(a, k) is not False for k in ("transform", "path", "physics", "slider"))
    for index, c in enumerate(sk.constraints):
        tl = M.ConstraintTimeline(index)
        found = False
        if c.kind == M.TRANSFORM:
            keys = _get(_get(a, "transform"), c.name)
            if arr(keys):
                legacy = any(_has(k, "rotateMix") or _has(k, "translateMix") or _has(k, "scaleMix") or _has(k, "shearMix") for k in keys)

                def read_mix(k, legacy=legacy):
                    if legacy:
                        t = val(k, "translateMix", 1.0)
                        s = val(k, "scaleMix", 1.0)
                        return [val(k, "rotateMix", 1.0), t, t, s, s, val(k, "shearMix", 1.0)]
                    x = val(k, "mixX", 1.0)
                    sx = val(k, "mixScaleX", 1.0)
                    return [val(k, "mixRotate", 1.0), x, val(k, "mixY", x), sx, val(k, "mixScaleY", sx), val(k, "mixShearY", 1.0)]

                tl.transform = raw_keys(keys, read_mix)
                found = True
        elif c.kind == M.SLIDER:
            t = _get(_get(a, "slider"), c.name)
            if isinstance(t, dict):
                tl.slider_time = raw_keys(_get(t, "time"), lambda k: [val(k, "value", 0.0)])
                tl.slider_mix = raw_keys(_get(t, "mix"), lambda k: [val(k, "value", 1.0)])
                found = True
        elif c.kind == M.PHYSICS:
            physics = _get(a, "physics")
            for is_global, source in ((False, _get(physics, c.name)), (True, _get(physics, ""))):
                if not isinstance(source, dict):
                    continue
                for i, key in enumerate(M.PHYSICS_VALUES):
                    keys = raw_keys(_get(source, key), lambda k: [val(k, "value", 0.0)])
                    if is_global:
                        tl.physics_global[i] = keys
                    else:
                        tl.physics[i] = keys
                found = True
        elif c.kind == M.PATH_CONSTRAINT:
            t = _get(_get(a, "path"), c.name)
            if isinstance(t, dict):
                tl.position = raw_keys(_get(t, "position"), lambda k: [val(k, "value", 0.0) if _has(k, "value") else val(k, "position", 0.0)])
                tl.spacing = raw_keys(_get(t, "spacing"), lambda k: [val(k, "value", 0.0) if _has(k, "value") else val(k, "spacing", 0.0)])

                def read_path_mix(k):
                    if _has(k, "rotateMix") or _has(k, "translateMix"):
                        return [val(k, "rotateMix", 1.0), val(k, "translateMix", 1.0), val(k, "translateMix", 1.0)]
                    x = val(k, "mixX", 1.0)
                    return [val(k, "mixRotate", 1.0), x, val(k, "mixY", x) if _has(k, "mixY") else x]

                tl.path_mix = raw_keys(_get(t, "mix"), read_path_mix)
                found = True
        if found:
            anim.constraints.append(tl)

    anim.duration = last_time(a, anim)
    return anim


def last_time(raw, anim):
    best = [0.0]

    def scan(t):
        if t > best[0]:
            best[0] = t

    for t in anim.bones:
        for ch in t.channels:
            if ch:
                for k in ch:
                    scan(k.time)
        if t.inherit:
            for k in t.inherit:
                scan(k[0])
    for t in anim.slots:
        if t.attachment:
            for k in t.attachment:
                scan(k[0])
        for ch in (t.color, t.rgb, t.alpha, t.rgba2, t.rgb2):
            if ch:
                for k in ch:
                    scan(k.time)
    for t in anim.deform:
        for k in t.keys:
            scan(k.time)
    for _, keys in anim.ik:
        for k in keys:
            scan(k.time)
    for k in anim.draw_order:
        scan(k[0])
    for k in anim.events:
        scan(k.time)

    def deep(v):
        if isinstance(v, list):
            for k in v:
                t = _get(k, "time")
                if _is_num(t):
                    scan(float(t))
                deep(k)
        elif isinstance(v, dict):
            for x in v.values():
                deep(x)

    for key in ("transform", "path", "physics", "attachments"):
        deep(_get(raw, key))
    return best[0]


__all__ = ["LoadError", "load_skeleton", "load_skeleton_text", "read_skeleton_json", "hex_to_color"]

_ = math  # kept for parity helpers
