# SPDX-License-Identifier: MIT OR Apache-2.0
"""What a rig offers for life-like playback, found from its data: the mouth slot and its mouth
shapes (lip-sync), how it blinks, its 2.5D turn control (gaze) and its pupils."""

from . import lipsync as _lipsync

EYE_WORDS = ("eye", "pupil", "iris", "lash", "lid")


def attachment_names(sk, slot):
    """Every attachment name a slot has, in the default skin and then the other skins."""
    names = list(sk.slots[slot].attachments.keys())
    for skin in sk.skins:
        for n in skin.slots.get(slot, {}):
            if n not in names:
                names.append(n)
    return names


def find_mouth(sk, slot_name=None):
    """``(slot index, {viseme: image})`` for the slot with the most recognisable mouth shapes
    (slots named "mouth", or ``slot_name``), or ``(None, None)`` when fewer than two are found."""
    best = (None, None, 0)
    for s in sk.slots:
        if slot_name is not None and s.name != slot_name:
            continue
        if slot_name is None and "mouth" not in s.name.lower():
            continue
        mouths = _lipsync.match_mouths(attachment_names(sk, s.index))
        score = sum(1 for v in _lipsync.VISEMES if mouths.get(v))
        if score > best[2]:
            best = (s.index, mouths, score)
    if best[0] is None or best[2] < 2:
        return None, None
    return best[0], best[1]


def _is_eye(sk, slot):
    name = sk.slots[slot].name.lower()
    return any(w in name for w in EYE_WORDS)


def _closed(name):
    return bool(name) and ("closed" in name or "shut" in name)


def find_blink(sk):
    """How the rig closes its eyes: ``("animation", "blink")`` when it has a blink animation, or
    ``("slots", {slot: image})`` learned from its animations (the eye slots' images at the moment
    one of them switches to an image named closed or shut), or None."""
    if sk.find_animation("blink") is not None:
        return ("animation", "blink")
    for anim in sk.animations:
        closing = [t for t in anim.slots if t.attachment and _is_eye(sk, t.slot) and any(_closed(n) for _, n in t.attachment)]
        if not closing:
            continue
        when = next(time for time, n in closing[0].attachment if _closed(n))
        state = {}
        for t in anim.slots:
            if not t.attachment or not _is_eye(sk, t.slot):
                continue
            value = None
            found = False
            for time, n in t.attachment:
                if time <= when + 1e-6:
                    value = n
                    found = True
            if found and value != sk.slots[t.slot].attachment:
                state[t.slot] = value
        if state:
            return ("slots", state)
    return None


def find_turn(sk):
    """The 2.5D turn control: ``{"bone": index, "x": (center, reach, local), "y": ...}`` from the
    slider constraints that play turn animations from a bone's x (turn) and y (tilt), or None."""
    out = {}
    for c in sk.constraints:
        if c.kind != "slider":
            continue
        d = c.data
        if d["bone"] is None or d["property"] not in (1, 2):
            continue
        anim = sk.animations[d["animation"]]
        if d["scale"] == 0.0 or anim.duration <= 0.0:
            continue
        lo = (0.0 - d["offset"]) / d["scale"]
        hi = (anim.duration - d["offset"]) / d["scale"]
        axis = "x" if d["property"] == 1 else "y"
        out.setdefault("bone", d["bone"])
        if out["bone"] == d["bone"] and axis not in out:
            out[axis] = ((lo + hi) / 2.0, abs(hi - lo) / 2.0, d["local"])
    return out if ("x" in out or "y" in out) else None


def find_pupils(sk):
    """``[(bone index, reach)]`` for bones named pupil or iris; a pupil may move a fifth of the
    size of its eye (the image on its parent bone)."""
    out = []
    for b in sk.bones:
        n = b.name.lower()
        if "pupil" not in n and "iris" not in n:
            continue
        reach = None
        for s in sk.slots:
            if s.bone == b.parent and s.attachment is not None:
                att = s.attachments.get(s.attachment)
                if att is not None and att.width and att.height:
                    reach = 0.2 * min(att.width, att.height)
                    break
        if reach is None:
            reach = max(sk.height, 1.0) * 0.004
        out.append((b.index, reach))
    return out


def turn_control(sk, pose, turn, gx, gy):
    """Local ``(x, y)`` for the turn control bone that turns the head by ``gx`` (-1 left .. 1 right)
    and tilts it by ``gy`` (-1 down .. 1 up); None for an axis the rig doesn't turn. Sliders that
    read the control's world position are converted through its parent (as posed last frame)."""
    bone = turn["bone"]
    out = {"x": None, "y": None}
    world = {}
    for axis, g in (("x", gx), ("y", gy)):
        if axis not in turn:
            continue
        center, reach, local = turn[axis]
        value = center + max(-1.0, min(1.0, g)) * reach
        if local:
            out[axis] = value
        else:
            world[axis] = value
    if world:
        m = pose.world[bone]
        wx = world.get("x", m[4])
        wy = world.get("y", m[5])
        parent = sk.bones[bone].parent
        if parent is None:
            px, py = wx, wy
        else:
            from .mathx import inverse
            p = inverse(pose.world[parent])
            px = p[0] * wx + p[2] * wy + p[4]
            py = p[1] * wx + p[3] * wy + p[5]
        if "x" in world:
            out["x"] = px
        if "y" in world:
            out["y"] = py
    return out["x"], out["y"]


def gaze_bone(sk, pupils=None):
    """The bone the eyes are measured from (a pupil, else the head), or None."""
    if pupils:
        return pupils[0][0]
    return sk.find_bone("head")
