# SPDX-License-Identifier: MIT OR Apache-2.0
"""Evaluated skeleton state: local and world transforms of every bone, slot state, mesh
deformation, draw order and constraints.

A port of ``runtimes/rust/rigby-runtime/src/pose.rs``; it behaves exactly like the JavaScript
runtime's ``Pose`` and is checked against it frame by frame (``tests/test_golden.py``).
"""

import bisect
import math

from . import model as M
from .curve import STEPPED, cubic4, ease, sample_raw
from .mathx import (
    DEG, IDENTITY, angle_of, clamp, decompose, determinant, inverse, mul, rotate_linear, to_affine, wrap_degrees,
)

EPSILON = 1e-5
_hypot = math.hypot
_cos = math.cos
_sin = math.sin
_fmod = math.fmod
NAN = float("nan")

# Constraint results.
_NONE, _WORLD, _LOCAL, _ALL = range(4)


class PhysicsSim(object):
    """Persistent physics simulation of one constraint."""

    __slots__ = ("rest", "o", "ov", "t", "tv", "last_origin", "last_tip")

    def __init__(self, origin, tip):
        self.rest = 0.0
        self.o = [0.0, 0.0]
        self.ov = [0.0, 0.0]
        self.t = [0.0, 0.0]
        self.tv = [0.0, 0.0]
        self.last_origin = list(origin)
        self.last_tip = list(tip)


class Quad(object):
    """A visible region or mesh in draw order (see ``Pose.quads``)."""

    __slots__ = ("slot", "image", "positions", "color")

    def __init__(self, slot, image, positions, color):
        self.slot = slot
        self.image = image
        self.positions = positions
        self.color = color


def _lerp(a, b, t):
    return a + (b - a) * t


class Pose(object):
    """A mutable pose for one skeleton instance."""

    def __init__(self, sk):
        steps = [(c.order, 0, i) for i, c in enumerate(sk.ik)]
        steps.extend((c.order, 1, i) for i, c in enumerate(sk.constraints))
        # A stable sort by order only (IK first among equals, as in the reference).
        steps.sort(key=lambda s: s[0])
        self.sk = sk
        self.steps = [(s[1], s[2]) for s in steps]
        self.local = []
        self.applied = []
        self.world = [IDENTITY] * len(sk.bones)
        self.inherit = []
        self.attachment = []
        self.color = []
        self.dark = []
        self.draw_order = []
        self.sequence = []
        self.deform = {}
        self.ik = []
        self.constraint_state = [c.setup_state() for c in sk.constraints]
        # Physics simulation state by constraint; it survives ``reset`` (see ``reset_physics``).
        self.physics = [None] * len(sk.constraints)
        # Seconds of physics to simulate in the next ``update_world`` (0 = only apply offsets).
        self.physics_delta = 0.0
        # Active skin (None = default skin only).
        self.skin = None
        # Transform above the root bone, or None for identity.
        self.placement = None
        # Bone overrides applied after animations: {bone: {field index: value}} (see ``set_bone``).
        self.overrides = {}
        self._into_applied = False
        self._parents = [b.parent for b in sk.bones]
        self.set_to_setup()

    # ---- setup -------------------------------------------------------------------------------------

    def set_to_setup(self):
        """Resets everything to the setup pose and recomputes world transforms."""
        self.reset()
        self.update_world()

    def reset(self):
        """Resets local state to the setup pose without computing world transforms."""
        sk = self.sk
        self.local = [list(b.setup) for b in sk.bones]
        self.inherit = [b.inherit for b in sk.bones]
        self.attachment = [s.attachment for s in sk.slots]
        self.color = [list(s.color) for s in sk.slots]
        self.dark = [list(s.dark) if s.dark is not None else None for s in sk.slots]
        self.draw_order = list(range(len(sk.slots)))
        self.sequence = [-1] * len(sk.slots)
        self.deform = {}
        self.ik = [[c.mix, c.softness, c.bend_positive, c.compress, c.stretch] for c in sk.ik]
        self.constraint_state = [c.setup_state() for c in sk.constraints]

    def reset_physics(self):
        """Clears physics so every simulated bone starts again from its animated pose."""
        self.physics = [None] * len(self.sk.constraints)

    # ---- animations ---------------------------------------------------------------------------------

    def apply(self, anim, time, alpha):
        """Applies animation ``anim`` (index) at ``time`` on top of the current pose, blended by ``alpha``."""
        if 0 <= anim < len(self.sk.animations):
            self._apply_animation(self.sk.animations[anim], time, alpha, False)

    def _apply_animation(self, anim, time, alpha, add):
        sk = self.sk
        hold = alpha >= 0.5
        target = self.applied if self._into_applied else self.local
        for t in anim.bones:
            if t.bone >= len(sk.bones):
                continue
            setup = sk.bones[t.bone].setup
            l = target[t.bone]
            c = t.channels
            if add:
                _add_bone_keys(c, setup, l, time, alpha)
                if hold and t.inherit:
                    self.inherit[t.bone] = _sample_discrete(t.inherit, time)
                continue
            x, y, rotation, sx, sy, hx, hy = l
            k = c[M.CH_ROTATE]
            if k:
                rotation = setup[2] + _sample_component(k, time, 0)
            k = c[M.CH_TRANSLATE]
            if k:
                x = setup[0] + _sample_component(k, time, 0)
                y = setup[1] + _sample_component(k, time, 1)
            k = c[M.CH_TRANSLATE_X]
            if k:
                x = setup[0] + _sample_component(k, time, 0)
            k = c[M.CH_TRANSLATE_Y]
            if k:
                y = setup[1] + _sample_component(k, time, 0)
            k = c[M.CH_SCALE]
            if k:
                sx = setup[3] * _sample_component(k, time, 0)
                sy = setup[4] * _sample_component(k, time, 1)
            k = c[M.CH_SCALE_X]
            if k:
                sx = setup[3] * _sample_component(k, time, 0)
            k = c[M.CH_SCALE_Y]
            if k:
                sy = setup[4] * _sample_component(k, time, 0)
            k = c[M.CH_SHEAR]
            if k:
                hx = setup[5] + _sample_component(k, time, 0)
                hy = setup[6] + _sample_component(k, time, 1)
            k = c[M.CH_SHEAR_X]
            if k:
                hx = setup[5] + _sample_component(k, time, 0)
            k = c[M.CH_SHEAR_Y]
            if k:
                hy = setup[6] + _sample_component(k, time, 0)
            if hold and t.inherit:
                self.inherit[t.bone] = _sample_discrete(t.inherit, time)
            if alpha >= 1.0:
                l[0] = x
                l[1] = y
                l[2] = rotation
                l[3] = sx
                l[4] = sy
                l[5] = hx
                l[6] = hy
            else:
                l[0] += (x - l[0]) * alpha
                l[1] += (y - l[1]) * alpha
                l[2] += (rotation - l[2]) * alpha
                l[3] += (sx - l[3]) * alpha
                l[4] += (sy - l[4]) * alpha
                l[5] += (hx - l[5]) * alpha
                l[6] += (hy - l[6]) * alpha
        for t in anim.slots:
            i = t.slot
            if i >= len(self.attachment):
                continue
            if hold and t.attachment:
                self.attachment[i] = _sample_discrete(t.attachment, time)
            color = list(self.color[i])
            dark = self.dark[i]
            if t.color:
                v = _sample_all(t.color, time)
                for k in range(min(4, len(v))):
                    color[k] = v[k]
            if t.rgb:
                # An 8-digit color in an rgb key also sets alpha (as the JavaScript runtime does).
                v = _sample_all(t.rgb, time)
                for k in range(min(4, len(v))):
                    color[k] = v[k]
            if t.alpha:
                v = _sample_all(t.alpha, time)
                color[3] = v[0]
            if t.rgba2:
                v = _sample_all(t.rgba2, time)
                for k in range(4):
                    color[k] = v[k]
                dark = [v[4], v[5], v[6]]
            if t.rgb2:
                v = _sample_all(t.rgb2, time)
                for k in range(3):
                    color[k] = v[k]
                dark = [v[3], v[4], v[5]]
            current = self.color[i]
            for k in range(4):
                current[k] = _lerp(current[k], color[k], alpha)
            if dark is not None:
                frm = self.dark[i] if self.dark[i] is not None else dark
                self.dark[i] = [_lerp(frm[0], dark[0], alpha), _lerp(frm[1], dark[1], alpha), _lerp(frm[2], dark[2], alpha)]
        for t in anim.deform:
            if not t.keys or t.slot >= len(sk.slots):
                continue
            if t.skin is not None:
                skin = sk.find_skin(t.skin)
            else:
                skin = self.skin
            # A named skin that does not exist resolves through the default skin only.
            att = sk.attachment(t.slot, t.attachment, skin)
            if att is None:
                continue
            source = sk.mesh_source(t.slot, att, self.skin)
            if source is None:
                source = att
            n = source.deform_len()
            deltas = _sample_deform(t.keys, time, n)
            key = (t.slot, t.attachment)
            prev = self.deform.get(key)
            if add:
                if prev is not None:
                    nd = len(deltas)
                    for j in range(len(prev)):
                        prev[j] += (deltas[j] if j < nd else 0.0) * alpha
                else:
                    self.deform[key] = [d * alpha for d in deltas]
                continue
            if prev is not None and alpha < 1.0:
                nd = len(deltas)
                for j in range(len(prev)):
                    prev[j] = _lerp(prev[j], deltas[j] if j < nd else 0.0, alpha)
            else:
                self.deform[key] = deltas
        # Sequence keys: the frame of the image sequence a slot's attachment shows.
        if hold:
            for t in anim.sequences:
                if self.attachment[t.slot] != t.attachment:
                    continue
                skin = sk.find_skin(t.skin) if t.skin is not None else None
                att = sk.attachment(t.slot, t.attachment, skin)
                if att is None:
                    att = sk.attachment(t.slot, t.attachment, self.skin)
                if att is None or att.sequence is None:
                    continue
                index = _sequence_index_at(t.keys, time, att.sequence.count)
                if index is not None:
                    self.sequence[t.slot] = index
        if hold and anim.draw_order:
            i = bisect.bisect_right(anim.draw_order_times, time) - 1
            if i >= 0:
                self.draw_order = apply_draw_order(len(sk.slots), anim.draw_order[i][1])
        self._apply_constraint_timelines(anim, time, alpha)
        for constraint, keys in anim.ik:
            if constraint >= len(self.ik):
                continue
            state = self.ik[constraint]
            i = _partition_time(keys, time) - 1
            if i < 0:
                continue
            a = keys[i]
            b = keys[i + 1] if i + 1 < len(keys) else None
            frac = (time - a.time) / (b.time - a.time) if (b is not None and b.time > a.time) else 0.0
            mix = _lerp(a.mix, b.mix if b is not None else a.mix, frac)
            softness = _lerp(a.softness, b.softness if b is not None else a.softness, frac)
            state[0] = _lerp(state[0], mix, alpha)
            state[1] = _lerp(state[1], softness, alpha)
            if hold:
                state[2] = a.bend_positive
                state[3] = a.compress
                state[4] = a.stretch

    def _apply_constraint_timelines(self, anim, time, alpha):
        if not anim.has_constraint_keys:
            return
        sk = self.sk
        for t in anim.constraints:
            c = sk.constraints[t.constraint]
            s = self.constraint_state[t.constraint]
            kind = c.kind
            if kind == M.TRANSFORM:
                if not t.transform:
                    continue
                v = sample_raw(t.transform, time)
                for j in range(M.PROPS):
                    s[j] += (v[j] - s[j]) * alpha
            elif kind == M.SLIDER:
                for k, keys in enumerate((t.slider_time, t.slider_mix)):
                    if not keys:
                        continue
                    v = sample_raw(keys, time)
                    s[k] += (v[0] - s[k]) * alpha
            elif kind == M.PHYSICS:
                globals_ = c.data["globals"]
                for is_global, lists in ((False, t.physics), (True, t.physics_global)):
                    for k, keys in enumerate(lists):
                        if not keys or (is_global and not globals_[k]):
                            continue
                        v = sample_raw(keys, time)
                        s[k] += (v[0] - s[k]) * alpha
            elif kind == M.PATH_CONSTRAINT:
                if t.position:
                    v = sample_raw(t.position, time)
                    s[0] += (v[0] - s[0]) * alpha
                if t.spacing:
                    v = sample_raw(t.spacing, time)
                    s[1] += (v[0] - s[1]) * alpha
                if t.path_mix:
                    v = sample_raw(t.path_mix, time)
                    s[2] += (v[0] - s[2]) * alpha
                    s[3] += (v[1] - s[3]) * alpha
                    s[4] += (v[2] - s[4]) * alpha

    # ---- overrides -------------------------------------------------------------------------------------

    def set_bone(self, bone, x=None, y=None, rotation=None, scale_x=None, scale_y=None):
        """Overrides a bone's local transform after animations (until ``clear_bone``): use it to aim
        a control bone (a 2.5D turn's ``head-turn-control``) at what the character looks at."""
        o = self.overrides.setdefault(bone, {})
        for i, v in ((0, x), (1, y), (2, rotation), (3, scale_x), (4, scale_y)):
            if v is not None:
                o[i] = float(v)

    def clear_bone(self, bone=None):
        if bone is None:
            self.overrides.clear()
        else:
            self.overrides.pop(bone, None)

    # ---- world transforms -------------------------------------------------------------------------

    def update_world(self):
        """Recomputes world transforms from local transforms, then applies constraints in order."""
        sk = self.sk
        for bone, o in self.overrides.items():
            if 0 <= bone < len(self.local):
                l = self.local[bone]
                for i, v in o.items():
                    l[i] = v
        self.applied = [list(l) for l in self.local]
        if len(self.world) != len(sk.bones):
            self.world = [IDENTITY] * len(sk.bones)
        self._compute_world()
        delta = self.physics_delta
        self.physics_delta = 0.0
        for kind, i in self.steps:
            if kind == 0:
                c = sk.ik[i]
                if c.skin_required and not (self.skin is not None and i in sk.skins[self.skin].ik):
                    continue
                self._solve_ik(c, self.ik[i])
                continue
            c = sk.constraints[i]
            if c.skin_required and not (self.skin is not None and c.name in sk.skins[self.skin].constraints):
                continue
            k = c.kind
            if k == M.TRANSFORM:
                result, value = self._solve_transform(c, c.data, i)
            elif k == M.PATH_CONSTRAINT:
                result, value = self._solve_path(c, c.data, i)
            elif k == M.SLIDER:
                result, value = self._solve_slider(c.data, i)
            else:
                result, value = self._solve_physics(c.data, i, delta)
            if result == _ALL:
                self._compute_world()
            elif result == _WORLD:
                self._set_worlds(value)
            elif result == _LOCAL:
                for b in value:
                    self._update_branch(b)

    def _compute_world(self):
        world = self.world
        applied = self.applied
        parents = self._parents
        inherit = self.inherit
        placement = self.placement
        for i in range(len(parents)):
            local = to_affine(applied[i])
            p = parents[i]
            if p is None:
                world[i] = mul(placement, local) if placement is not None else local
            elif inherit[i] == M.NORMAL:
                world[i] = mul(world[p], local)
            else:
                world[i] = _inherit_world(world[p], local, inherit[i])

    def _update_bone(self, i):
        local = to_affine(self.applied[i])
        p = self._parents[i]
        if p is None:
            self.world[i] = mul(self.placement, local) if self.placement is not None else local
        else:
            self.world[i] = _inherit_world(self.world[p], local, self.inherit[i])

    def _update_branch(self, root):
        """Recomputes the world transform of ``root`` and its descendants."""
        parents = self._parents
        dirty = [False] * len(parents)
        dirty[root] = True
        self._update_bone(root)
        for i in range(root + 1, len(parents)):
            p = parents[i]
            if p is not None and dirty[p]:
                dirty[i] = True
                self._update_bone(i)

    def _set_worlds(self, desired):
        """Sets the world transforms of some bones, updating their applied local transforms to match
        and moving their descendants along."""
        parents = self._parents
        n = len(parents)
        dirty = [False] * n
        if not desired:
            return
        wanted = {}
        for b, m in desired:
            wanted[b] = m  # the last entry for a bone wins
        first = min(wanted)
        for i in range(first, n):
            p = parents[i]
            want = wanted.get(i)
            if want is not None:
                if p is None and self.placement is not None:
                    self.applied[i] = _local_from_world(self.placement, want, M.NORMAL)
                else:
                    self.applied[i] = _local_from_world(self.world[p] if p is not None else None, want, self.inherit[i])
                self.world[i] = want
                dirty[i] = True
            elif p is not None and dirty[p]:
                self._update_bone(i)
                dirty[i] = True

    # ---- IK -----------------------------------------------------------------------------------------

    def _parent_sign(self, b):
        p = self._parents[b]
        if p is not None and determinant(self.world[p]) < 0.0:
            return -1.0
        return 1.0

    def _aim(self, b, frm, tip, target, mix):
        delta = wrap_degrees(angle_of(target[0] - frm[0], target[1] - frm[1]) - angle_of(tip[0] - frm[0], tip[1] - frm[1]))
        self.applied[b][2] += delta * mix * self._parent_sign(b)

    def _solve_ik(self, c, state):
        """Rotates (and optionally stretches) the constrained bones so the chain reaches the target."""
        mix = state[0]
        if mix <= 0.0 or not c.bones:
            return
        sk = self.sk
        tm = self.world[c.target]
        target = (tm[4], tm[5])
        compress, stretch = state[3], state[4]
        if len(c.bones) == 1:
            b = c.bones[0]
            w = self.world[b]
            origin = (w[4], w[5])
            self._aim(b, origin, (w[0] + w[4], w[1] + w[5]), target, mix)
            bone_len = sk.bones[b].length * _hypot(w[0], w[1])
            dist = _hypot(target[0] - origin[0], target[1] - origin[1])
            if bone_len > 1e-4 and ((compress and dist < bone_len) or (stretch and dist > bone_len)):
                s = (dist / bone_len - 1.0) * mix + 1.0
                self.applied[b][3] *= s
                if c.uniform:
                    self.applied[b][4] *= s
            self._update_branch(b)
            return
        p, ch = c.bones[0], c.bones[1]
        pw = self.world[p]
        cw = self.world[ch]
        pp = (pw[4], pw[5])
        cc = (cw[4], cw[5])
        clen = sk.bones[ch].length
        tip = (cw[0] * clen + cw[4], cw[1] * clen + cw[5])
        a = _hypot(cc[0] - pp[0], cc[1] - pp[1])
        b_len = _hypot(tip[0] - cc[0], tip[1] - cc[1])
        if a < 1e-4 or b_len < 1e-4:
            to = cc if (cc[0] != pp[0] or cc[1] != pp[1]) else (pw[0] + pw[4], pw[1] + pw[5])
            self._aim(p, pp, to, target, mix)
            self._update_branch(p)
            return
        d = _hypot(target[0] - pp[0], target[1] - pp[1])
        if stretch and d > a + b_len:
            # Out of reach: straighten the chain toward the target, then stretch the parent.
            self._aim(p, pp, cc, target, mix)
            self._update_branch(p)
            self._finish_two_bone(ch, target, mix)
            s = (d / (a + b_len) - 1.0) * mix + 1.0
            self.applied[p][3] *= s
            if c.uniform:
                self.applied[p][4] *= s
            self._update_branch(p)
            return
        soft = state[1]
        if soft > 0.0 and d > a + b_len - soft:
            d = a + b_len - soft * math.exp(-(d - (a + b_len - soft)) / soft)
        d = min(max(d, abs(a - b_len) + 1e-6), a + b_len - 1e-6)
        cos_a = clamp((a * a + d * d - b_len * b_len) / (2.0 * a * d), -1.0, 1.0)
        angle = math.acos(cos_a) / DEG
        # A mirrored chain bends the other way on screen.
        bend = (1.0 if state[2] else -1.0) * (-1.0 if determinant(pw) < 0.0 else 1.0)
        desired = angle_of(target[0] - pp[0], target[1] - pp[1]) - bend * angle
        delta = wrap_degrees(desired - angle_of(cc[0] - pp[0], cc[1] - pp[1]))
        self.applied[p][2] += delta * mix * self._parent_sign(p)
        self._update_branch(p)
        self._finish_two_bone(ch, target, mix)

    def _finish_two_bone(self, ch, target, mix):
        w = self.world[ch]
        cc = (w[4], w[5])
        length = max(self.sk.bones[ch].length, 1e-3)
        tip = (w[0] * length + w[4], w[1] * length + w[5])
        delta = wrap_degrees(angle_of(target[0] - cc[0], target[1] - cc[1]) - angle_of(tip[0] - cc[0], tip[1] - cc[1]))
        self.applied[ch][2] += delta * mix * self._parent_sign(ch)
        self._update_branch(ch)

    # ---- transform constraints ----------------------------------------------------------------------------

    def _source_values(self, t):
        if t["local_source"]:
            a = self.applied[t["source"]]
            return [a[2], a[0], a[1], a[3], a[4], a[6]]
        s = self.world[t["source"]]
        off = t["offsets"]
        x = s[0] * off[M.P_X] + s[2] * off[M.P_Y] + s[4]
        y = s[1] * off[M.P_X] + s[3] * off[M.P_Y] + s[5]
        x_angle = angle_of(s[0], s[1])
        return [x_angle, x, y, _hypot(s[0], s[1]), _hypot(s[2], s[3]), wrap_degrees(angle_of(s[2], s[3]) - x_angle - 90.0)]

    def _target_values(self, t):
        """Target property values after the mapping and offsets (None = property not targeted)."""
        src = self._source_values(t)
        local_source = t["local_source"]
        reflected = (not local_source) and determinant(self.world[t["source"]]) < 0.0
        offsets = t["offsets"]
        clamp_ = t["clamp"]
        out = [None] * M.PROPS
        for frm_index, frm_offset, to_list in t["props"]:
            frm = src[frm_index] - frm_offset
            for prop, offset, mx, scale in to_list:
                v = frm * scale + offset
                if clamp_:
                    v = min(max(v, min(offset, mx)), max(offset, mx))
                # World x/y offsets are already applied through the source bone.
                point_offset = (not local_source) and prop in (M.P_X, M.P_Y) and frm_index in (M.P_X, M.P_Y)
                off = 0.0 if point_offset else offsets[prop]
                if reflected and prop in (M.P_ROTATE, M.P_SHEAR_Y):
                    off = -off
                out[prop] = (out[prop] if out[prop] is not None else 0.0) + v + off
        return out

    def _solve_transform(self, c, t, index):
        mix = self.constraint_state[index]
        if all(m == 0.0 for m in mix):
            return _NONE, None
        v = self._target_values(t)
        additive = t["additive"]
        if t["local_target"]:
            for b in c.bones:
                a = self.applied[b]

                def m(p):
                    return 0.0 if v[p] is None else mix[p]

                def value(p):
                    return v[p] if v[p] is not None else NAN

                if additive:
                    if m(M.P_ROTATE) != 0.0:
                        a[2] += value(M.P_ROTATE) * mix[M.P_ROTATE]
                    if m(M.P_X) != 0.0:
                        a[0] += value(M.P_X) * mix[M.P_X]
                    if m(M.P_Y) != 0.0:
                        a[1] += value(M.P_Y) * mix[M.P_Y]
                    if m(M.P_SCALE_X) != 0.0:
                        a[3] *= (value(M.P_SCALE_X) - 1.0) * mix[M.P_SCALE_X] + 1.0
                    if m(M.P_SCALE_Y) != 0.0:
                        a[4] *= (value(M.P_SCALE_Y) - 1.0) * mix[M.P_SCALE_Y] + 1.0
                    if m(M.P_SHEAR_Y) != 0.0:
                        a[6] += value(M.P_SHEAR_Y) * mix[M.P_SHEAR_Y]
                else:
                    if m(M.P_ROTATE) != 0.0:
                        a[2] += wrap_degrees(value(M.P_ROTATE) - a[2]) * mix[M.P_ROTATE]
                    if m(M.P_X) != 0.0:
                        a[0] += (value(M.P_X) - a[0]) * mix[M.P_X]
                    if m(M.P_Y) != 0.0:
                        a[1] += (value(M.P_Y) - a[1]) * mix[M.P_Y]
                    if m(M.P_SCALE_X) != 0.0:
                        a[3] += (value(M.P_SCALE_X) - a[3]) * mix[M.P_SCALE_X]
                    if m(M.P_SCALE_Y) != 0.0:
                        a[4] += (value(M.P_SCALE_Y) - a[4]) * mix[M.P_SCALE_Y]
                    if m(M.P_SHEAR_Y) != 0.0:
                        a[6] += wrap_degrees(value(M.P_SHEAR_Y) - a[6]) * mix[M.P_SHEAR_Y]
            return _LOCAL, list(c.bones)
        desired = []
        for b in c.bones:
            ma, mb, mc, md, mtx, mty = self.world[b]
            r = v[M.P_ROTATE]
            if r is not None and mix[M.P_ROTATE] != 0.0:
                r = r if additive else wrap_degrees(r - angle_of(ma, mb))
                ma, mb, mc, md, mtx, mty = rotate_linear((ma, mb, mc, md, mtx, mty), r * mix[M.P_ROTATE])
            x = v[M.P_X]
            if x is not None and mix[M.P_X] != 0.0:
                mtx += x * mix[M.P_X] if additive else (x - mtx) * mix[M.P_X]
            y = v[M.P_Y]
            if y is not None and mix[M.P_Y] != 0.0:
                mty += y * mix[M.P_Y] if additive else (y - mty) * mix[M.P_Y]
            sxv = v[M.P_SCALE_X]
            if sxv is not None and mix[M.P_SCALE_X] != 0.0:
                s = _hypot(ma, mb)
                if s >= EPSILON:
                    f = (sxv - 1.0) * mix[M.P_SCALE_X] + 1.0 if additive else (s + (sxv - s) * mix[M.P_SCALE_X]) / s
                    ma *= f
                    mb *= f
            syv = v[M.P_SCALE_Y]
            if syv is not None and mix[M.P_SCALE_Y] != 0.0:
                s = _hypot(mc, md)
                if s >= EPSILON:
                    f = (syv - 1.0) * mix[M.P_SCALE_Y] + 1.0 if additive else (s + (syv - s) * mix[M.P_SCALE_Y]) / s
                    mc *= f
                    md *= f
            shear = v[M.P_SHEAR_Y]
            if shear is not None and mix[M.P_SHEAR_Y] != 0.0:
                x_angle = angle_of(ma, mb)
                gap = wrap_degrees(angle_of(mc, md) - x_angle)
                if additive:
                    want = gap + shear * mix[M.P_SHEAR_Y]
                else:
                    want = gap + wrap_degrees(90.0 + shear - gap) * mix[M.P_SHEAR_Y]
                length = _hypot(mc, md)
                mc = _cos((x_angle + want) * DEG) * length
                md = _sin((x_angle + want) * DEG) * length
            desired.append((b, (ma, mb, mc, md, mtx, mty)))
        return _WORLD, desired

    # ---- path constraints --------------------------------------------------------------------------------

    def _solve_path(self, c, p, index):
        state = self.constraint_state[index]
        position, spacing, mix_rotate, mix_x, mix_y = state
        if mix_rotate == 0.0 and mix_x == 0.0 and mix_y == 0.0:
            return _NONE, None
        att = self.slot_attachment(p["slot"])
        if att is None or att.kind != M.PATH:
            return _NONE, None
        verts = self.world_vertices(p["slot"], att)
        path = _PathCurve.build(verts, att.closed, att.constant_speed, att.lengths or [])
        if path is None:
            return _NONE, None
        sk = self.sk
        n = len(c.bones)
        tangents = p["rotate_mode"] == "tangent"
        chain_scale = p["rotate_mode"] == "chainScale"
        count = n if tangents else n + 1
        lens = []
        for b in c.bones:
            w = self.world[b]
            lens.append(sk.bones[b].length * _hypot(w[0], w[1]))
        spaces = [0.0] * count
        mode = p["spacing_mode"]
        percent_spacing = mode == "percent"
        for i in range(max(count - 1, 0)):
            length = lens[i] if i < len(lens) else NAN
            if mode in ("percent", "fixed"):
                spaces[i + 1] = spacing
            elif mode == "proportional":
                spaces[i + 1] = length
            else:
                spaces[i + 1] = 0.0 if length < EPSILON else length + spacing
        if mode == "proportional":
            total = sum(spaces)
            if total > EPSILON:
                for i in range(1, count):
                    spaces[i] *= (path.length * (1.0 - min(spacing, 1.0))) / total
        if p["position_mode"] == "percent":
            position *= path.length
        points = []
        at = position
        for s in spaces:
            at += s * path.length if percent_spacing else s
            points.append(path.at(at))
        desired = []
        for i, b in enumerate(c.bones):
            ma, mb, mc, md, mtx, mty = self.world[b]
            x, y, angle = points[i]
            mtx += (x - mtx) * mix_x
            mty += (y - mty) * mix_y
            if mix_rotate > 0.0:
                if tangents:
                    r = angle
                else:
                    nx, ny, _ = points[i + 1]
                    dx = nx - mtx
                    dy = ny - mty
                    if chain_scale and lens[i] >= EPSILON:
                        s = (_hypot(dx, dy) / lens[i] - 1.0) * mix_rotate + 1.0
                        ma *= s
                        mb *= s
                    r = angle_of(dx, dy) if _hypot(dx, dy) > EPSILON else angle
                reflect = -1.0 if (ma * md - mb * mc) < 0.0 else 1.0
                r = wrap_degrees(r - angle_of(ma, mb) + p["offset_rotation"] * reflect)
                ma, mb, mc, md, mtx, mty = rotate_linear((ma, mb, mc, md, mtx, mty), r * mix_rotate)
            desired.append((b, (ma, mb, mc, md, mtx, mty)))
        return _WORLD, desired

    # ---- physics ------------------------------------------------------------------------------------------

    def _solve_physics(self, p, index, delta):
        FORCE_SCALE = 100.0
        MIN_TIP = 10.0
        inertia, strength, damping, mass, wind, gravity, mix = self.constraint_state[index]
        m = self.world[p["bone"]]
        h = _hypot(m[0], m[1])
        axis = 1.0 if (h == 0.0 or h != h) else h
        pl = self.placement
        if pl is not None:
            s = math.sqrt(abs(determinant(pl)))
            ps = 1.0 if (s == 0.0 or s != s) else s
        else:
            ps = 1.0
        length = max(MIN_TIP, self.sk.bones[p["bone"]].length * axis / ps)
        origin = [m[4] / ps, m[5] / ps]
        tip = [origin[0] + (m[0] / axis) * length, origin[1] + (m[1] / axis) * length]
        sim = self.physics[index]
        if sim is None:
            sim = self.physics[index] = PhysicsSim(origin, tip)
        if delta > 0.0:
            fps = max(p["fps"], 1.0)
            step = 1.0 / fps
            sim.rest += delta
            steps = math.floor(sim.rest / step)
            sim.rest -= steps * step
            steps = min(steps, fps)  # at most one second of catching up
            if steps > 0.0:
                # Inertia: part of the animated movement since the last update is left behind.
                for k in range(2):
                    sim.o[k] -= (origin[k] - sim.last_origin[k]) * inertia
                    sim.t[k] -= (tip[k] - sim.last_tip[k]) * inertia
                mass_inv = 1.0 / mass if mass > 0.0 else 1.0
                keep = clamp(damping, 0.0, 1.0) ** (60.0 * step)
                force = (wind * FORCE_SCALE, -gravity * FORCE_SCALE)
                limit = p["limit"]
                for _ in range(int(steps)):
                    for pos, vel in ((sim.o, sim.ov), (sim.t, sim.tv)):
                        for k in range(2):
                            vel[k] = (vel[k] + (force[k] - strength * pos[k]) * mass_inv * step) * keep
                        speed = _hypot(vel[0], vel[1])
                        if speed > limit:
                            vel[0] *= limit / speed
                            vel[1] *= limit / speed
                        pos[0] += vel[0] * step
                        pos[1] += vel[1] * step
                sim.last_origin = origin
                sim.last_tip = tip
        if mix == 0.0:
            return _NONE, None
        oa, ob, oc, od, otx, oty = m
        otx += sim.o[0] * p["x"] * mix * ps
        oty += sim.o[1] * p["y"] * mix * ps
        if p["rotate"] != 0.0 or p["scale_x"] != 0.0 or p["shear_x"] != 0.0:
            frm = (tip[0] - origin[0], tip[1] - origin[1])
            to = (frm[0] + sim.t[0], frm[1] + sim.t[1])
            angle = wrap_degrees(angle_of(to[0], to[1]) - angle_of(frm[0], frm[1]))
            oa, ob, oc, od, otx, oty = rotate_linear((oa, ob, oc, od, otx, oty), angle * p["rotate"] * mix)
            if p["shear_x"] != 0.0:
                # Tilt only the X axis.
                r = angle * p["shear_x"] * mix * DEG
                a, b = oa, ob
                oa = a * _cos(r) - b * _sin(r)
                ob = a * _sin(r) + b * _cos(r)
            if p["scale_x"] != 0.0:
                f = (_hypot(to[0], to[1]) / length - 1.0) * p["scale_x"] * mix + 1.0
                oa *= f
                ob *= f
        return _WORLD, [(p["bone"], (oa, ob, oc, od, otx, oty))]

    # ---- slider ----------------------------------------------------------------------------------------------

    def _solve_slider(self, s, index):
        state_time, state_mix = self.constraint_state[index]
        if not (0 <= s["animation"] < len(self.sk.animations)):
            return _NONE, None
        anim = self.sk.animations[s["animation"]]
        if state_mix <= 0.0:
            return _NONE, None
        time = state_time
        b = s["bone"]
        if b is not None:
            if s["local"]:
                value = _local_property(self.applied[b], s["property"])
            else:
                value = _world_property(self.world[b], s["property"])
            time = value * s["scale"] + s["offset"]
        d = anim.duration
        if d > 0.0:
            time = _fmod(_fmod(time, d) + d, d) if s["loop"] else clamp(time, 0.0, d)
        # Apply onto the constrained (applied) transforms, then recompute world transforms.
        self._into_applied = True
        try:
            self._apply_animation(anim, time, min(state_mix, 1.0), s["additive"])
        finally:
            self._into_applied = False
        return _ALL, None

    # ---- attachments -------------------------------------------------------------------------------------------

    def slot_attachment(self, slot):
        """The attachment a slot shows, resolved through the active skin."""
        return self.sk.attachment(slot, self.attachment[slot], self.skin)

    def image_of(self, slot, att):
        """Image an attachment shows in a slot: its image, or the current frame of its sequence."""
        seq = att.sequence
        if seq is None:
            return att.image
        index = self.sequence[slot] if slot < len(self.sequence) else -1
        i = index if index >= 0 else seq.setup
        i = int(clamp(i, 0, len(seq.frames) - 1))
        return seq.frames[i]

    def attachment_world(self, slot, offset):
        """World transform of a region or point attachment."""
        return mul(self.world[self.sk.slots[slot].bone], to_affine(offset))

    def world_vertices(self, slot, att):
        """World positions of a mesh-like attachment's vertices, flat ``[x, y, ...]``."""
        sk = self.sk
        source = sk.mesh_source(slot, att, self.skin)
        if source is None:
            return []
        if att.kind == M.LINKED_MESH and att.deform:
            deform_name = att.parent
        else:
            deform_name = att.name
        deform = self.deform.get((slot, deform_name))
        vertices = source.vertices
        if vertices is None:
            return []
        out = []
        push = out.append
        world = self.world
        if isinstance(vertices, M.Weighted):
            if deform is None:
                for v in vertices.weights:
                    x = 0.0
                    y = 0.0
                    for bone, bx, by, weight in v:
                        m = world[bone]
                        x += (m[0] * bx + m[2] * by + m[4]) * weight
                        y += (m[1] * bx + m[3] * by + m[5]) * weight
                    push(x)
                    push(y)
            else:
                k = 0
                nd = len(deform)
                for v in vertices.weights:
                    x = 0.0
                    y = 0.0
                    for bone, wx, wy, weight in v:
                        bx = wx + (deform[k] if k < nd else 0.0)
                        by = wy + (deform[k + 1] if k + 1 < nd else 0.0)
                        k += 2
                        m = world[bone]
                        x += (m[0] * bx + m[2] * by + m[4]) * weight
                        y += (m[1] * bx + m[3] * by + m[5]) * weight
                    push(x)
                    push(y)
        else:
            a, b, c, d, tx, ty = world[sk.slots[slot].bone]
            n = len(vertices)
            i = 0
            if deform is None:
                while i + 1 < n:
                    vx = vertices[i]
                    vy = vertices[i + 1]
                    push(a * vx + c * vy + tx)
                    push(b * vx + d * vy + ty)
                    i += 2
            else:
                nd = len(deform)
                while i + 1 < n:
                    vx = vertices[i] + (deform[i] if i < nd else 0.0)
                    vy = vertices[i + 1] + (deform[i + 1] if i + 1 < nd else 0.0)
                    push(a * vx + c * vy + tx)
                    push(b * vx + d * vy + ty)
                    i += 2
        return out

    def quads(self):
        """Visible regions and meshes in draw order, with world positions and tint (for tests and
        simple renderers; ``render.RenderOutput`` makes textured, clipped geometry)."""
        sk = self.sk
        out = []
        for i in self.draw_order:
            att = self.slot_attachment(i)
            if att is None:
                continue
            tint = self.color[i]
            ac = att.color
            color = [tint[0] * ac[0], tint[1] * ac[1], tint[2] * ac[2], tint[3] * ac[3]]
            if att.kind == M.REGION:
                m = self.attachment_world(i, att.offset)
                hw = att.width * 0.5
                hh = att.height * 0.5
                positions = []
                for x, y in ((-hw, hh), (hw, hh), (hw, -hh), (-hw, -hh)):
                    positions.append(m[0] * x + m[2] * y + m[4])
                    positions.append(m[1] * x + m[3] * y + m[5])
                out.append(Quad(i, self.image_of(i, att), positions, color))
            elif att.kind in (M.MESH, M.LINKED_MESH):
                source = sk.mesh_source(i, att, self.skin)
                if source is None:
                    continue
                image = self.image_of(i, att if att.kind == M.LINKED_MESH else source)
                out.append(Quad(i, image, self.world_vertices(i, att), color))
        return out

    def bone_world(self, name):
        """World matrix ``(a, b, c, d, tx, ty)`` of the bone named ``name``, or None."""
        i = self.sk.find_bone(name)
        return None if i is None else self.world[i]


# ---- sampling ---------------------------------------------------------------------------------------------

def _partition_time(keys, time):
    """Index of the first key with time > ``time``."""
    lo, hi = 0, len(keys)
    while lo < hi:
        mid = (lo + hi) // 2
        if keys[mid].time <= time:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _sample_component(keys, time, c):
    """Samples component ``c`` of numeric keys at ``time`` (keys must not be empty)."""
    k0 = keys[0]
    if time <= k0.time:
        v = k0.values
        return v[c] if c < len(v) else NAN
    nxt = _partition_time(keys, time)
    if nxt >= len(keys):
        v = keys[-1].values
        return v[c] if c < len(v) else NAN
    a = keys[nxt - 1]
    b = keys[nxt]
    span = b.time - a.time
    va = a.values[c] if c < len(a.values) else NAN
    vb = b.values[c] if c < len(b.values) else NAN
    curve = a.curve
    t = (time - a.time) / span if span > 0.0 else 1.0
    if curve is None:
        e = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
    else:
        e = ease(curve, t, c)
    return va + (vb - va) * e


def _sample_all(keys, time):
    """Samples every component of numeric keys (keys must not be empty)."""
    if time <= keys[0].time:
        return list(keys[0].values)
    nxt = _partition_time(keys, time)
    if nxt >= len(keys):
        return list(keys[-1].values)
    a = keys[nxt - 1]
    b = keys[nxt]
    span = b.time - a.time
    t = (time - a.time) / span if span > 0.0 else 1.0
    out = []
    for i, va in enumerate(a.values):
        vb = b.values[i] if i < len(b.values) else NAN
        out.append(_lerp(va, vb, ease(a.curve, t, i)))
    return out


def _sample_discrete(keys, time):
    """Discrete keys ``[(time, value)]``: the value of the last key at or before ``time``."""
    if time <= keys[0][0]:
        return keys[0][1]
    lo, hi = 0, len(keys)
    while lo < hi:
        mid = (lo + hi) // 2
        if keys[mid][0] <= time:
            lo = mid + 1
        else:
            hi = mid
    return keys[max(lo, 1) - 1][1]


def _add_bone_keys(c, setup, l, time, alpha):
    """Adds a bone timeline's change from the setup pose (times ``alpha``) to local transform ``l``."""
    k = c[M.CH_ROTATE]
    if k:
        l[2] += _sample_component(k, time, 0) * alpha
    k = c[M.CH_TRANSLATE]
    if k:
        l[0] += _sample_component(k, time, 0) * alpha
        l[1] += _sample_component(k, time, 1) * alpha
    k = c[M.CH_TRANSLATE_X]
    if k:
        l[0] += _sample_component(k, time, 0) * alpha
    k = c[M.CH_TRANSLATE_Y]
    if k:
        l[1] += _sample_component(k, time, 0) * alpha
    k = c[M.CH_SCALE]
    if k:
        l[3] += setup[3] * (_sample_component(k, time, 0) - 1.0) * alpha
        l[4] += setup[4] * (_sample_component(k, time, 1) - 1.0) * alpha
    k = c[M.CH_SCALE_X]
    if k:
        l[3] += setup[3] * (_sample_component(k, time, 0) - 1.0) * alpha
    k = c[M.CH_SCALE_Y]
    if k:
        l[4] += setup[4] * (_sample_component(k, time, 0) - 1.0) * alpha
    k = c[M.CH_SHEAR]
    if k:
        l[5] += _sample_component(k, time, 0) * alpha
        l[6] += _sample_component(k, time, 1) * alpha
    k = c[M.CH_SHEAR_X]
    if k:
        l[5] += _sample_component(k, time, 0) * alpha
    k = c[M.CH_SHEAR_Y]
    if k:
        l[6] += _sample_component(k, time, 0) * alpha


def _sample_deform(keys, time, n):
    """Deform deltas at ``time``: each key's sparse values expanded, interpolated along its curve."""
    def expand(k):
        d = [0.0] * n
        off = k.offset
        for j, v in enumerate(k.vertices):
            if off + j < n:
                d[off + j] = v
        return d

    i = max(_partition_time(keys, time) - 1, 0)
    a = keys[i]
    frm = expand(a)
    if i + 1 >= len(keys):
        return frm
    b = keys[i + 1]
    if time <= a.time or a.curve == STEPPED:
        return frm
    to = expand(b)
    e = ease(a.curve, (time - a.time) / (b.time - a.time), 0)
    for j in range(n):
        frm[j] += (to[j] - frm[j]) * e
    return frm


def _sequence_index_at(keys, time, count):
    """Frame for sequence keys at ``time``, or None before the first key."""
    k = None
    delay = 0.0
    for i, key in enumerate(keys):
        if key.time > time:
            break
        k = i
        if key.delay is not None:
            delay = key.delay
    if k is None:
        return None
    key = keys[k]
    index = key.index
    if key.mode == M.HOLD or count <= 1:
        return max(index, 0) if max(index, 0) < count - 1 else count - 1
    steps = int(math.floor((time - key.time) / delay + 1e-6)) if delay > 0.0 else 0
    mode = key.mode
    reverse = mode in (M.ONCE_REVERSE, M.LOOP_REVERSE, M.PINGPONG_REVERSE)
    base = {M.ONCE_REVERSE: M.ONCE, M.LOOP_REVERSE: M.LOOP, M.PINGPONG_REVERSE: M.PINGPONG}.get(mode, mode)
    f = index + steps
    if base == M.ONCE:
        f = min(f, count - 1)
    elif base == M.LOOP:
        f = int(math.fmod(f, count))
    elif base == M.PINGPONG:
        period = 2 * (count - 1)
        f = int(math.fmod(f, period))
        if f >= count:
            f = period - f
    return count - 1 - f if reverse else f


def apply_draw_order(count, offsets):
    """Slot order for a draw order key: ``offsets`` move slots relative to their setup index."""
    if not offsets:
        return list(range(count))
    order = [-1] * count
    unchanged = []
    original = 0
    for slot, offset in sorted(offsets, key=lambda o: o[0]):
        if slot >= count:
            continue
        while original < slot:
            unchanged.append(original)
            original += 1
        at = original + offset
        if 0 <= at < count and order[at] == -1:
            order[at] = original
        else:
            unchanged.append(original)
        original += 1
    while original < count:
        unchanged.append(original)
        original += 1
    for i in range(count - 1, -1, -1):
        if order[i] == -1:
            order[i] = unchanged.pop() if unchanged else -1
    return [max(v, 0) for v in order]


def _inherit_world(parent, local, mode):
    """Child world transform for an inherit mode."""
    if mode == M.NORMAL:
        return mul(parent, local)
    pa0, pb0, pc0, pd0, ptx, pty = parent
    la, lb, lc, ld, ltx, lty = local
    tx = pa0 * ltx + pc0 * lty + ptx
    ty = pb0 * ltx + pd0 * lty + pty
    sx = _hypot(pa0, pb0)
    det = pa0 * pd0 - pb0 * pc0
    if mode == M.ONLY_TRANSLATION:
        pa, pb, pc, pd = 1.0, 0.0, 0.0, 1.0
    elif mode == M.NO_ROTATION_OR_REFLECTION:
        pa, pb, pc, pd = sx, 0.0, 0.0, (abs(det) / sx if sx > 1e-12 else 0.0)
    else:
        ux = pa0 / sx if sx > 1e-12 else 1.0
        uy = pb0 / sx if sx > 1e-12 else 0.0
        flip = -1.0 if (mode == M.NO_SCALE and det < 0.0) else 1.0
        pa, pb, pc, pd = ux, uy, -uy * flip, ux * flip
    return (pa * la + pc * lb, pb * la + pd * lb, pa * lc + pc * ld, pb * lc + pd * ld, tx, ty)


def _local_from_world(parent, world, mode):
    """The local transform that gives world transform ``world`` under ``parent`` and inherit ``mode``."""
    if parent is None:
        return decompose(world)
    inv = inverse(parent)
    x = inv[0] * world[4] + inv[2] * world[5] + inv[4]
    y = inv[1] * world[4] + inv[3] * world[5] + inv[5]
    keep = _inherit_world(parent, IDENTITY, mode)
    keep = (keep[0], keep[1], keep[2], keep[3], 0.0, 0.0)
    linear = mul(inverse(keep), (world[0], world[1], world[2], world[3], 0.0, 0.0))
    return decompose((linear[0], linear[1], linear[2], linear[3], x, y))


def _local_property(t, p):
    if p == M.P_X:
        return t[0]
    if p == M.P_Y:
        return t[1]
    if p == M.P_SCALE_X:
        return t[3]
    if p == M.P_SCALE_Y:
        return t[4]
    if p == M.P_SHEAR_Y:
        return t[6]
    return t[2]


def _world_property(m, p):
    if p == M.P_X:
        return m[4]
    if p == M.P_Y:
        return m[5]
    if p == M.P_SCALE_X:
        return _hypot(m[0], m[1])
    if p == M.P_SCALE_Y:
        return _hypot(m[2], m[3])
    if p == M.P_SHEAR_Y:
        return wrap_degrees(angle_of(m[2], m[3]) - angle_of(m[0], m[1]) - 90.0)
    return angle_of(m[0], m[1])


# ---- paths -----------------------------------------------------------------------------------------------------

SEGMENTS = 16


class _PathCurve(object):
    """A path from world vertices laid out as [in-handle, point, out-handle] per path point."""

    __slots__ = ("curves", "tables", "ends", "length", "closed", "constant")

    @staticmethod
    def build(v, closed, constant_speed, lengths):
        point_count = len(v) // 6
        if point_count < 2 and not (closed and point_count >= 1):
            return None
        curve_count = point_count if closed else point_count - 1
        curves = []
        for i in range(curve_count):
            o = 6 * i
            nxt = 0 if (closed and i == point_count - 1) else o + 6
            curves.append((v[o + 2], v[o + 3], v[o + 4], v[o + 5], v[nxt], v[nxt + 1], v[nxt + 2], v[nxt + 3]))
        tables = []
        for cv in curves:
            t = [0.0] * (SEGMENTS + 1)
            px, py = cv[0], cv[1]
            for s in range(1, SEGMENTS + 1):
                u = s / float(SEGMENTS)
                x = cubic4(cv[0], cv[2], cv[4], cv[6], u)
                y = cubic4(cv[1], cv[3], cv[5], cv[7], u)
                t[s] = t[s - 1] + _hypot(x - px, y - py)
                px, py = x, y
            tables.append(t)
        constant = constant_speed or not lengths
        ends = []
        if constant:
            total = 0.0
            for t in tables:
                total += t[SEGMENTS]
                ends.append(total)
        else:
            for i in range(curve_count):
                if i < len(lengths):
                    ends.append(lengths[i])
                else:
                    ends.append(ends[i - 1] if i > 0 else 0.0)
        length = ends[-1] if ends else 0.0
        if length < EPSILON:
            return None
        pc = _PathCurve()
        pc.curves = curves
        pc.tables = tables
        pc.ends = ends
        pc.length = length
        pc.closed = closed
        pc.constant = constant
        return pc

    def evaluate(self, i, u):
        cv = self.curves[i]
        x = cubic4(cv[0], cv[2], cv[4], cv[6], u)
        y = cubic4(cv[1], cv[3], cv[5], cv[7], u)

        def d(p0, p1, p2, p3):
            return 3.0 * (1.0 - u) * (1.0 - u) * (p1 - p0) + 6.0 * (1.0 - u) * u * (p2 - p1) + 3.0 * u * u * (p3 - p2)

        dx = d(cv[0], cv[2], cv[4], cv[6])
        dy = d(cv[1], cv[3], cv[5], cv[7])
        if _hypot(dx, dy) < EPSILON:
            dx = cv[6] - cv[0]
            dy = cv[7] - cv[1]
        return (x, y, angle_of(dx, dy))

    def at(self, dist):
        """Point and tangent (degrees) at a distance along the path."""
        if self.closed:
            dist = _fmod(dist, self.length)
            if dist < 0.0:
                dist += self.length
        elif dist < 0.0:
            cv = self.curves[0]
            ang = angle_of(cv[2] - cv[0], cv[3] - cv[1])
            return (cv[0] + _cos(ang * DEG) * dist, cv[1] + _sin(ang * DEG) * dist, ang)
        elif dist > self.length:
            cv = self.curves[-1]
            ang = angle_of(cv[6] - cv[4], cv[7] - cv[5])
            over = dist - self.length
            return (cv[6] + _cos(ang * DEG) * over, cv[7] + _sin(ang * DEG) * over, ang)
        i = 0
        ends = self.ends
        while i < len(ends) - 1 and dist > ends[i]:
            i += 1
        start = ends[i - 1] if i > 0 else 0.0
        span = ends[i] - start
        f = (dist - start) / span if span > EPSILON else 0.0
        if not self.constant:
            return self.evaluate(i, f)
        # Constant speed: invert the arc length table.
        t = self.tables[i]
        target = f * t[SEGMENTS]
        s = 1
        while s < SEGMENTS and t[s] < target:
            s += 1
        seg = t[s] - t[s - 1]
        u = (s - 1.0 + ((target - t[s - 1]) / seg if seg > EPSILON else 0.0)) / SEGMENTS
        return self.evaluate(i, u)
