# SPDX-License-Identifier: MIT OR Apache-2.0
"""Skeleton data: bones, slots, attachments, skins, constraints, events and animations, loaded once
and shared by every instance (see ``Pose`` and ``AnimationState`` for per-instance state)."""

# Inherit modes.
NORMAL = 0
ONLY_TRANSLATION = 1
NO_ROTATION_OR_REFLECTION = 2
NO_SCALE = 3
NO_SCALE_OR_REFLECTION = 4

INHERIT = {
    "normal": NORMAL,
    "onlyTranslation": ONLY_TRANSLATION,
    "noRotationOrReflection": NO_ROTATION_OR_REFLECTION,
    "noScale": NO_SCALE,
    "noScaleOrReflection": NO_SCALE_OR_REFLECTION,
}

# Attachment kinds.
REGION = "region"
MESH = "mesh"
LINKED_MESH = "linkedmesh"
BOUNDING_BOX = "boundingbox"
PATH = "path"
CLIPPING = "clipping"
POINT = "point"

# Transform constraint properties, in this order everywhere.
PROPS = 6
P_ROTATE, P_X, P_Y, P_SCALE_X, P_SCALE_Y, P_SHEAR_Y = range(6)

# Physics values keys can animate, in this order.
PHYSICS_VALUES = ("inertia", "strength", "damping", "mass", "wind", "gravity", "mix")

# Bone channels in application order.
CH_ROTATE, CH_TRANSLATE, CH_TRANSLATE_X, CH_TRANSLATE_Y, CH_SCALE, CH_SCALE_X, CH_SCALE_Y, CH_SHEAR, CH_SHEAR_X, CH_SHEAR_Y = range(10)

# Sequence modes.
HOLD, ONCE, LOOP, PINGPONG, ONCE_REVERSE, LOOP_REVERSE, PINGPONG_REVERSE = range(7)

# Constraint kinds.
TRANSFORM = "transform"
PATH_CONSTRAINT = "path"
PHYSICS = "physics"
SLIDER = "slider"


class BoneData(object):
    __slots__ = ("index", "name", "parent", "length", "setup", "inherit", "skin_required")

    def __init__(self, index, name, parent, length, setup, inherit, skin_required):
        self.index = index
        self.name = name
        self.parent = parent
        self.length = length
        self.setup = setup
        self.inherit = inherit
        self.skin_required = skin_required


class SlotData(object):
    __slots__ = ("index", "name", "bone", "attachment", "color", "dark", "blend", "attachments")

    def __init__(self, index, name, bone, attachment, color, dark, blend):
        self.index = index
        self.name = name
        self.bone = bone
        self.attachment = attachment
        self.color = color
        self.dark = dark
        self.blend = blend
        # The default skin's attachments for this slot, by name.
        self.attachments = {}


class Weighted(object):
    """Weighted vertices: per vertex a list of (bone, x, y, weight)."""

    __slots__ = ("weights", "deform_len")

    def __init__(self, weights):
        self.weights = weights
        self.deform_len = sum(len(v) * 2 for v in weights)


class Sequence(object):
    __slots__ = ("count", "start", "digits", "setup", "frames")

    def __init__(self, count, start, digits, setup, frames):
        self.count = count
        self.start = start
        self.digits = digits
        self.setup = setup
        self.frames = frames


class Attachment(object):
    """A region, mesh, linked mesh, bounding box, path, clipping or point attachment.

    ``vertices`` is a flat list ``[x, y, ...]`` (plain) or a ``Weighted``.
    """

    __slots__ = (
        "name", "image", "color", "kind", "sequence",
        "offset", "width", "height",
        "uvs", "triangles", "hull", "vertices",
        "parent", "skin", "deform",
        "closed", "constant_speed", "lengths", "end",
    )

    def __init__(self, name, image, color, kind):
        self.name = name
        self.image = image
        self.color = color
        self.kind = kind
        self.sequence = None
        self.offset = None
        self.width = 0.0
        self.height = 0.0
        self.uvs = None
        self.triangles = None
        self.hull = 0
        self.vertices = None
        self.parent = None
        self.skin = None
        self.deform = True
        self.closed = False
        self.constant_speed = True
        self.lengths = None
        self.end = None

    def deform_len(self):
        v = self.vertices
        if v is None:
            return 0
        if isinstance(v, Weighted):
            return v.deform_len
        return len(v)


class SkinData(object):
    __slots__ = ("name", "slots", "bones", "ik", "constraints")

    def __init__(self, name):
        self.name = name
        # slot index -> {attachment name: Attachment}
        self.slots = {}
        self.bones = []
        self.ik = []
        self.constraints = []


class IkData(object):
    __slots__ = ("name", "order", "skin_required", "bones", "target", "mix", "softness", "bend_positive", "compress", "stretch", "uniform")

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class ConstraintData(object):
    """A transform, path, physics or slider constraint (IK constraints are in ``SkeletonData.ik``)."""

    __slots__ = ("name", "order", "skin_required", "bones", "kind", "data")

    def __init__(self, name, order, skin_required, bones, kind, data):
        self.name = name
        self.order = order
        self.skin_required = skin_required
        self.bones = bones
        self.kind = kind
        self.data = data

    def setup_state(self):
        d = self.data
        if self.kind == TRANSFORM:
            return list(d["mix"])
        if self.kind == PATH_CONSTRAINT:
            return list(d["setup"])
        return list(d["setup"])


class EventData(object):
    __slots__ = ("name", "int", "float", "string", "audio", "volume", "balance")

    def __init__(self, name, int_, float_, string, audio, volume, balance):
        self.name = name
        self.int = int_
        self.float = float_
        self.string = string
        self.audio = audio
        self.volume = volume
        self.balance = balance


class Key(object):
    __slots__ = ("time", "values", "curve")

    def __init__(self, time, values, curve):
        self.time = time
        self.values = values
        self.curve = curve


class BoneTimeline(object):
    __slots__ = ("bone", "channels", "inherit", "any")

    def __init__(self, bone):
        self.bone = bone
        self.channels = [None] * 10
        self.inherit = None
        self.any = False


class SlotTimeline(object):
    __slots__ = ("slot", "attachment", "color", "rgb", "alpha", "rgba2", "rgb2")

    def __init__(self, slot):
        self.slot = slot
        self.attachment = None
        self.color = None
        self.rgb = None
        self.alpha = None
        self.rgba2 = None
        self.rgb2 = None


class DeformKey(object):
    __slots__ = ("time", "offset", "vertices", "curve")

    def __init__(self, time, offset, vertices, curve):
        self.time = time
        self.offset = offset
        self.vertices = vertices
        self.curve = curve


class DeformTimeline(object):
    __slots__ = ("skin", "slot", "attachment", "keys")

    def __init__(self, skin, slot, attachment, keys):
        self.skin = skin
        self.slot = slot
        self.attachment = attachment
        self.keys = keys


class SequenceKey(object):
    __slots__ = ("time", "mode", "index", "delay")

    def __init__(self, time, mode, index, delay):
        self.time = time
        self.mode = mode
        self.index = index
        self.delay = delay


class SequenceTimeline(object):
    __slots__ = ("skin", "slot", "attachment", "keys")

    def __init__(self, skin, slot, attachment, keys):
        self.skin = skin
        self.slot = slot
        self.attachment = attachment
        self.keys = keys


class EventKey(object):
    __slots__ = ("time", "name", "int", "float", "string", "volume", "balance")

    def __init__(self, time, name, int_, float_, string, volume, balance):
        self.time = time
        self.name = name
        self.int = int_
        self.float = float_
        self.string = string
        self.volume = volume
        self.balance = balance


class IkKey(object):
    __slots__ = ("time", "mix", "softness", "bend_positive", "compress", "stretch")

    def __init__(self, time, mix, softness, bend_positive, compress, stretch):
        self.time = time
        self.mix = mix
        self.softness = softness
        self.bend_positive = bend_positive
        self.compress = compress
        self.stretch = stretch


class ConstraintTimeline(object):
    """Keys of one transform, path, physics or slider constraint, by constraint index."""

    __slots__ = ("constraint", "transform", "position", "spacing", "path_mix", "slider_time", "slider_mix", "physics", "physics_global")

    def __init__(self, constraint):
        self.constraint = constraint
        self.transform = []
        self.position = []
        self.spacing = []
        self.path_mix = []
        self.slider_time = []
        self.slider_mix = []
        self.physics = [[] for _ in range(7)]
        self.physics_global = [[] for _ in range(7)]


class Animation(object):
    __slots__ = ("index", "name", "duration", "bones", "slots", "deform", "sequences", "draw_order", "draw_order_times", "events", "ik", "constraints", "has_constraint_keys")

    def __init__(self, index, name):
        self.index = index
        self.name = name
        self.duration = 0.0
        self.bones = []
        self.slots = []
        self.deform = []
        self.sequences = []
        # (time, offsets or None)
        self.draw_order = []
        self.draw_order_times = []
        self.events = []
        self.ik = []
        self.constraints = []
        self.has_constraint_keys = False


class SkeletonData(object):
    """Everything loaded from a skeleton file."""

    def __init__(self):
        self.version = None
        self.bones = []
        self.slots = []
        self.skins = []
        self.ik = []
        self.constraints = []
        self.events = []
        self.event_map = {}
        self.animations = []
        self.animation_map = {}
        self.warnings = []
        # Optional header fields.
        self.x = 0.0
        self.y = 0.0
        self.width = 0.0
        self.height = 0.0
        self.fps = 30.0

    def find_bone(self, name):
        for b in self.bones:
            if b.name == name:
                return b.index
        return None

    def find_slot(self, name):
        for s in self.slots:
            if s.name == name:
                return s.index
        return None

    def find_skin(self, name):
        for i, s in enumerate(self.skins):
            if s.name == name:
                return i
        return None

    def find_animation(self, name):
        return self.animation_map.get(name)

    def skin_attachments(self, slot, skin):
        """Attachments a skin defines for a slot (``None`` = the default skin), by name."""
        if skin is None:
            return self.slots[slot].attachments if slot < len(self.slots) else {}
        if 0 <= skin < len(self.skins):
            return self.skins[skin].slots.get(slot, {})
        return {}

    def attachment(self, slot, name, skin):
        """Resolves an attachment by slot and name: ``skin`` first, then the default skin."""
        if name is None:
            return None
        if skin is not None:
            a = self.skin_attachments(slot, skin).get(name)
            if a is not None:
                return a
        if slot >= len(self.slots):
            return None
        return self.slots[slot].attachments.get(name)

    def mesh_source(self, slot, att, active_skin):
        """The mesh holding the geometry of ``att``: itself, or the parent of a linked mesh."""
        if att.kind != LINKED_MESH:
            return att
        skin = att.skin
        if skin is not None and skin != "default":
            skin_index = self.find_skin(skin)
        else:
            skin_index = None
        if skin is not None and skin != "default" and skin_index is None:
            in_skin = None
        else:
            in_skin = self.skin_attachments(slot, skin_index).get(att.parent)
        found = in_skin if in_skin is not None else self.attachment(slot, att.parent, active_skin)
        if found is None or found.kind != MESH:
            return None
        return found
