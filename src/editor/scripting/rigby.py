# SPDX-License-Identifier: MIT OR Apache-2.0
"""Rigby2D scripting API.

Scripts edit the open project and add custom tools to the Scripts menu::

    import rigby

    @rigby.tool("Mirror selected bones", description="Flip the selected bones across X = 0")
    def mirror():
        for bone in rigby.selected_bones():
            bone.x = -bone.x
            bone.rotation = 180 - bone.rotation

A whole script run, or one run of a tool, is a single undo step. When it raises an exception the
project is left exactly as it was, and the traceback appears in the log (View > Log).
"""

import inspect as _inspect
import json as _json
import typing as _typing

import _rigby_bridge as _bridge

__all__ = [
    "RigbyError", "Bone", "Slot", "Mesh", "Animation", "Skin", "Event", "Constraint",
    "info", "bones", "bone", "add_bone", "slots", "slot", "add_slot",
    "draw_order", "set_draw_order",
    "animations", "animation", "add_animation", "current_animation",
    "skins", "skin", "add_skin", "current_skin", "set_skin",
    "events", "event", "add_event",
    "constraints", "constraint", "add_ik", "add_transform", "add_physics",
    "selected_bones", "select", "time", "set_time", "mode", "set_mode", "fps",
    "log", "warn", "error", "status", "tool", "tools",
]

CHANNELS = ("rotate", "translate", "scale", "shear")
CURVES = ("linear", "stepped", "ease_in", "ease_out", "ease_in_out")


class RigbyError(Exception):
    """A request the editor cannot do: an unknown name, a bad value."""


def _call(function, /, **args):
    try:
        result = _bridge.call(function, _json.dumps(args))
    except Exception as e:  # JsException: the editor refused the call
        message = str(e)
        for prefix in ("RigbyError: ", "Error: "):
            if prefix in message:
                message = message.split(prefix, 1)[1]
        raise RigbyError(message.strip()) from None
    return _json.loads(result)


# ---- objects ------------------------------------------------------------------------------------


class Bone:
    """A bone. Setup-pose fields are relative to the parent bone; setting one changes the setup pose."""

    __slots__ = ("_name",)
    _FIELDS = ("x", "y", "rotation", "scale_x", "scale_y", "shear_x", "shear_y", "length")

    def __init__(self, name):
        object.__setattr__(self, "_name", name)

    @property
    def name(self):
        """The bone name. Setting it renames the bone."""
        return self._name

    @name.setter
    def name(self, value):
        _call("set_bone", name=self._name, fields={"name": value})
        object.__setattr__(self, "_name", value)

    def _data(self):
        return _call("bone", name=self._name)

    def __getattr__(self, field):
        if field in Bone._FIELDS:
            return self._data()[field]
        raise AttributeError(f"Bone has no attribute '{field}'")

    def __setattr__(self, field, value):
        if field in Bone._FIELDS:
            _call("set_bone", name=self._name, fields={field: value})
        elif field == "name":
            Bone.name.fset(self, value)
        else:
            raise AttributeError(f"Bone has no attribute '{field}'")

    def set(self, **fields):
        """Sets several setup fields at once: bone.set(x=10, rotation=45)."""
        _call("set_bone", name=self._name, fields=fields)
        return self

    @property
    def parent(self):
        """The parent Bone, or None for the root."""
        p = self._data()["parent"]
        return Bone(p) if p is not None else None

    @property
    def children(self):
        """The bones directly under this one."""
        return [Bone(b["name"]) for b in _call("bones") if b["parent"] == self._name]

    @property
    def world(self):
        """World transform in the pose shown: dict with x, y, rotation, scale_x, scale_y."""
        return _call("world", name=self._name)

    def key(self, channel, value, time=None, animation=None, curve="linear"):
        """Keys a channel ('rotate', 'translate', 'scale', 'shear') at `time` (default: current time).

        Values are relative to the setup pose: rotate adds degrees; translate and shear add (x, y);
        scale multiplies by (x, y).
        """
        if channel != "rotate":
            value = [float(value[0]), float(value[1])]
        return _call("set_key", animation=animation, bone=self._name, channel=channel, time=time, value=value, curve=curve)

    def delete_key(self, channel, time=None, animation=None):
        """Deletes the key of `channel` at `time` (default: the current time); True if there was one."""
        return _call("delete_key", animation=animation, bone=self._name, channel=channel, time=time)

    def keys(self, channel, animation=None):
        """Keys of a channel: list of dicts with time, value and curve."""
        return _call("keys", animation=animation, bone=self._name, channel=channel)

    def remove(self):
        """Deletes the bone with its children, their slots, constraints and keys."""
        _call("remove_bone", name=self._name)

    def __eq__(self, other):
        return isinstance(other, Bone) and other._name == self._name

    def __hash__(self):
        return hash(("bone", self._name))

    def __repr__(self):
        return f"Bone({self._name!r})"


class Slot:
    """A slot: what is drawn for a bone, and in which color."""

    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        """The slot name."""
        return self._name

    def _data(self):
        for s in _call("slots"):
            if s["name"] == self._name:
                return s
        raise RigbyError(f"No slot '{self._name}'")

    @property
    def bone(self):
        """The Bone the slot is attached to."""
        return Bone(self._data()["bone"])

    @property
    def attachments(self):
        """Names of the slot's attachments (default skin)."""
        return list(self._data()["attachments"])

    @property
    def attachment(self):
        """The attachment shown in the setup pose; set a name, or None to show nothing."""
        return self._data()["attachment"]

    @attachment.setter
    def attachment(self, name):
        _call("set_slot", name=self._name, fields={"attachment": name})

    @property
    def color(self):
        """The setup color (r, g, b, a), 0..1; settable."""
        return tuple(self._data()["color"])

    @color.setter
    def color(self, rgba):
        _call("set_slot", name=self._name, fields={"color": [float(c) for c in rgba]})

    def key_attachment(self, name, time=None, animation=None):
        """Keys which attachment the slot shows from `time` on (None shows nothing)."""
        return _call("key_attachment", animation=_name(animation), slot=self._name, time=time, name=name)

    def key_color(self, rgba, time=None, animation=None, curve="linear"):
        """Keys the slot's color (r, g, b, a), 0..1; alpha fades the slot."""
        return _call("key_color", animation=_name(animation), slot=self._name, time=time, color=[float(c) for c in rgba], curve=curve)

    def keys(self, channel, animation=None):
        """Keys of 'attachment' or 'color': list of dicts with time, value and curve."""
        return _call("slot_keys", animation=_name(animation), slot=self._name, channel=channel)

    def delete_key(self, channel, time=None, animation=None):
        """Deletes the 'attachment' or 'color' key at `time`; True if there was one."""
        return _call("delete_slot_key", animation=_name(animation), slot=self._name, channel=channel, time=time)

    def mesh(self, name=None, skin=None):
        """The mesh (or other attachment) `name`, or the one the slot shows."""
        return Mesh(_call("mesh", slot=self._name, name=name, skin=_name(skin)))

    def remove(self):
        """Deletes the slot with its attachments and keys."""
        _call("remove_slot", name=self._name)

    def __eq__(self, other):
        return isinstance(other, Slot) and other._name == self._name

    def __hash__(self):
        return hash(("slot", self._name))

    def __repr__(self):
        return f"Slot({self._name!r})"


class Mesh:
    """A mesh attachment as it is now: name, slot, type, image, vertex_count, weighted, vertices
    (bone space, unweighted meshes), weights (weighted meshes), uvs, triangles, hull."""

    def __init__(self, data):
        self._data = data

    def __getattr__(self, field):
        if field != "_data" and field in self._data:
            value = self._data[field]
            return [tuple(p) if isinstance(p, list) else p for p in value] if field in ("vertices", "uvs", "triangles") else value
        raise AttributeError(f"Mesh has no attribute '{field}'")

    def world(self):
        """The vertices in world space, in the pose shown: [(x, y), ...]."""
        return [tuple(p) for p in _call("mesh_world", slot=self._data["slot"], name=self._data["name"])]

    def set_vertices(self, vertices):
        """Moves the setup vertices of an unweighted mesh: [(x, y), ...] in bone space."""
        self._data = _call("set_mesh_vertices", slot=self._data["slot"], name=self._data["name"], vertices=[[float(x), float(y)] for x, y in vertices])
        return self

    def key(self, offsets, time=None, animation=None, curve="linear"):
        """A deform key: (dx, dy) added to each vertex (unweighted meshes)."""
        return _call("key_deform", animation=_name(animation), slot=self._data["slot"], name=self._data["name"], time=time, offsets=[[float(x), float(y)] for x, y in offsets], curve=curve)

    def keys(self, animation=None):
        """Deform keys: list of dicts with time, offsets and curve."""
        return _call("deform_keys", animation=_name(animation), slot=self._data["slot"], name=self._data["name"])

    def __repr__(self):
        return f"Mesh({self._data['slot']!r}, {self._data['name']!r})"


class Animation:
    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        """The animation name."""
        return self._name

    @property
    def duration(self):
        """Length in seconds; settable."""
        for a in _call("animations"):
            if a["name"] == self._name:
                return a["duration"]
        raise RigbyError(f"No animation '{self._name}'")

    @duration.setter
    def duration(self, seconds):
        _call("set_duration", animation=self._name, duration=seconds)

    def key(self, bone, channel, time, value, curve="linear"):
        """Keys `bone`'s `channel` at `time` in this animation (see Bone.key)."""
        b = bone.name if isinstance(bone, Bone) else bone
        return Bone(b).key(channel, value, time=time, animation=self._name, curve=curve)

    def open(self):
        """Shows this animation in the editor."""
        _call("set_animation", name=self._name)
        return self

    def key_draw_order(self, order, time=None):
        """A draw order key: every slot once, back to front (or None for the setup order)."""
        names = None if order is None else [_name(s) for s in order]
        return _call("key_draw_order", animation=self._name, time=time, names=names)

    def draw_order_keys(self):
        """Draw order keys: list of dicts with time and order (slot names, back to front)."""
        return _call("draw_order_keys", animation=self._name)

    def delete_draw_order_key(self, time=None):
        """Deletes the draw order key at `time`; True if there was one."""
        return _call("delete_draw_order_key", animation=self._name, time=time)

    def key_event(self, event, time=None, int=None, float=None, string=None):
        """Fires `event` at `time`; int, float and string override its defaults for this key."""
        return _call("key_event", animation=self._name, name=_name(event), time=time, int=int, float=float, string=string)

    def event_keys(self):
        """Event keys: list of dicts with time, name and any overridden values."""
        return _call("event_keys", animation=self._name)

    def delete_event_key(self, event, time=None):
        """Deletes the key of `event` at `time`; True if there was one."""
        return _call("delete_event_key", animation=self._name, name=_name(event), time=time)

    def __eq__(self, other):
        return isinstance(other, Animation) and other._name == self._name

    def __hash__(self):
        return hash(("animation", self._name))

    def __repr__(self):
        return f"Animation({self._name!r})"


class Skin:
    """A skin: a set of attachments shown instead of (or on top of) the default skin."""

    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        """The skin name ('default' for the default skin)."""
        return self._name

    def attachments(self):
        """What the skin defines: list of dicts with slot, name and type."""
        return _call("skin_attachments", name=self._name)

    def add(self, slot, attachment, source="default"):
        """Puts a copy of `attachment` (from skin `source`) into this skin for `slot`."""
        return _call("skin_add", name=self._name, slot=_name(slot), attachment=attachment, source=_name(source))

    def remove_attachment(self, slot, attachment):
        """Takes `slot`'s `attachment` out of this skin; True if it was there."""
        return _call("skin_remove", name=self._name, slot=_name(slot), attachment=attachment)

    def show(self):
        """Makes this the active skin in the editor."""
        _call("set_skin", name=self._name)
        return self

    def remove(self):
        """Deletes the skin (not the default skin)."""
        _call("remove_skin", name=self._name)

    def __eq__(self, other):
        return isinstance(other, Skin) and other._name == self._name

    def __hash__(self):
        return hash(("skin", self._name))

    def __repr__(self):
        return f"Skin({self._name!r})"


class Event:
    """An event definition: name with default int, float and string values."""

    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        """The event name."""
        return self._name

    def _data(self):
        for e in _call("events"):
            if e["name"] == self._name:
                return e
        raise RigbyError(f"No event '{self._name}'")

    @property
    def int(self):
        """The default whole-number value."""
        return self._data()["int"]

    @property
    def float(self):
        """The default number value."""
        return self._data()["float"]

    @property
    def string(self):
        """The default text value."""
        return self._data()["string"]

    def key(self, time=None, animation=None, int=None, float=None, string=None):
        """Fires this event at `time` in an animation (default: the current one and time)."""
        return _call("key_event", animation=_name(animation), name=self._name, time=time, int=int, float=float, string=string)

    def remove(self):
        """Deletes the event and its keys."""
        _call("remove_event", name=self._name)

    def __repr__(self):
        return f"Event({self._name!r})"


class Constraint:
    """An IK, transform, path, physics or slider constraint. Its settings read as attributes
    (constraint.mix, constraint.bones, ...); change them with set(), key them with key()."""

    def __init__(self, name):
        object.__setattr__(self, "_name", name)

    @property
    def name(self):
        """The constraint name."""
        return self._name

    def info(self):
        """Every setting, as a dict (type, bones, target or source, mixes, ...)."""
        return _call("constraint", name=self._name)

    def __getattr__(self, field):
        data = self.info()
        if field in data:
            return data[field]
        raise AttributeError(f"{data['type']} constraint has no attribute '{field}'")

    def __setattr__(self, field, value):
        self.set(**{field: value})

    def set(self, **fields):
        """Changes settings: ik.set(mix=0.5, bend_positive=False)."""
        _call("set_constraint", name=self._name, fields=fields)
        return self

    def key(self, time=None, animation=None, **values):
        """Keys settings at `time`: ik mix, softness, bend_positive; transform mixes; physics values."""
        return _call("key_constraint", animation=_name(animation), name=self._name, time=time, values=values)

    def remove(self):
        """Deletes the constraint with its keys."""
        _call("remove_constraint", name=self._name)

    def __repr__(self):
        return f"Constraint({self._name!r})"


def _name(x):
    """The name of a Bone, Slot, Animation, Skin or Event, or `x` itself (a name or None)."""
    return getattr(x, "name", x) if not isinstance(x, (str, type(None))) else x


# ---- project ------------------------------------------------------------------------------------


def info():
    """The open project: path, workspace, fps, mode, time, animation, skin."""
    return _call("info")


def bones():
    """Every bone, parents before children."""
    return [Bone(b["name"]) for b in _call("bones")]


def bone(name):
    """The bone named `name` (RigbyError if there is none)."""
    _call("bone", name=name)
    return Bone(name)


def add_bone(name, parent="root", x=0.0, y=0.0, rotation=0.0, length=0.0):
    """A new bone under `parent`, placed relative to it (x, y, rotation in degrees)."""
    p = parent.name if isinstance(parent, Bone) else parent
    _call("add_bone", name=name, parent=p, x=x, y=y, rotation=rotation, length=length)
    return Bone(name)


def slots():
    """Every slot, in draw order (back to front)."""
    return [Slot(s["name"]) for s in _call("slots")]


def slot(name):
    """The slot named `name` (RigbyError if there is none)."""
    s = Slot(name)
    s._data()
    return s


def add_slot(name, bone="root"):
    """A new, empty slot on `bone`, drawn in front of the others."""
    _call("add_slot", name=name, bone=_name(bone))
    return Slot(name)


def draw_order():
    """The slots in setup draw order, back to front."""
    return [Slot(n) for n in _call("draw_order")]


def set_draw_order(order):
    """Reorders the setup draw order: every slot once, back to front."""
    return [Slot(n) for n in _call("set_draw_order", names=[_name(s) for s in order])]


def skins():
    """Every skin, the default skin first."""
    return [Skin(n) for n in _call("skins")["names"]]


def skin(name):
    """The skin named `name` ('default' for the default skin)."""
    if name not in _call("skins")["names"]:
        raise RigbyError(f"No skin '{name}'")
    return Skin(name)


def add_skin(name, copy=None):
    """A new skin, empty or a copy of skin `copy`."""
    _call("add_skin", name=name, copy=_name(copy))
    return Skin(name)


def current_skin():
    """The skin shown in the editor."""
    return Skin(_call("skins")["active"])


def set_skin(name):
    """Shows a skin (None or 'default' for the default skin only)."""
    return Skin(_call("set_skin", name=_name(name)))


def events():
    """Every event definition."""
    return [Event(e["name"]) for e in _call("events")]


def event(name):
    """The event named `name` (RigbyError if there is none)."""
    e = Event(name)
    e._data()
    return e


def add_event(name, int=0, float=0.0, string=""):
    """A new event with default values; key it with animation.key_event or event.key."""
    _call("add_event", name=name, int=int, float=float, string=string)
    return Event(name)


def constraints():
    """Every constraint, in the order they are applied."""
    return [Constraint(c["name"]) for c in _call("constraints")]


def constraint(name):
    """The constraint named `name` (RigbyError if there is none)."""
    _call("constraint", name=name)
    return Constraint(name)


def add_ik(name, bones, target, bend_positive=True, mix=1.0):
    """IK: `bones` (one bone, or a parent and its child) reach for `target`."""
    _call("add_ik", name=name, bones=[_name(b) for b in bones], target=_name(target), bend_positive=bend_positive, mix=mix)
    return Constraint(name)


def add_transform(name, bone, source):
    """Transform: `bone` follows `source`, keeping where it is now."""
    _call("add_transform", name=name, bone=_name(bone), source=_name(source))
    return Constraint(name)


def add_physics(name, bone, rotate=1.0, x=0.0, y=0.0):
    """Physics: `bone` lags, sways and settles; rotate, x and y set how much of each is simulated."""
    _call("add_physics", name=name, bone=_name(bone), rotate=rotate, x=x, y=y)
    return Constraint(name)


def animations():
    """Every animation."""
    return [Animation(a["name"]) for a in _call("animations")]


def animation(name):
    """The animation named `name` (RigbyError if there is none)."""
    a = Animation(name)
    a.duration  # raises if missing
    return a


def add_animation(name, duration=0.0):
    """A new, empty animation of `duration` seconds."""
    _call("add_animation", name=name, duration=duration)
    return Animation(name)


def current_animation():
    """The animation open in the editor, or None."""
    name = info()["animation"]
    return Animation(name) if name is not None else None


def selected_bones():
    """The bones selected in the editor, the primary one first."""
    return [Bone(n) for n in _call("selection")]


def select(*bones_or_names):
    """Selects bones (Bones or names); returns how many."""
    names = [b.name if isinstance(b, Bone) else b for b in bones_or_names]
    return _call("select", names=names)


def time():
    """The current time on the timeline, in seconds."""
    return info()["time"]


def set_time(seconds):
    """Moves the timeline to `seconds`."""
    return _call("set_time", time=seconds)


def mode():
    """The editor mode: 'setup' or 'animate'."""
    return info()["mode"]


def set_mode(value):
    """Switches the editor to 'setup' or 'animate' mode."""
    return _call("set_mode", mode=value)


def fps():
    """The frame rate of the project."""
    return info()["fps"]


# ---- output -------------------------------------------------------------------------------------


def _text(args):
    return " ".join(str(a) for a in args)


def log(*args):
    """Writes the arguments to the log, like print."""
    _call("log", level="info", text=_text(args))


def warn(*args):
    """Writes a warning to the log."""
    _call("log", level="warn", text=_text(args))


def error(*args):
    """Writes an error to the log (the script goes on; raise to stop it)."""
    _call("log", level="error", text=_text(args))


def status(text):
    """Shows a message in the status bar."""
    _call("status", text=str(text))


# ---- tools --------------------------------------------------------------------------------------

_tools = {}


_KINDS = {Bone: "bone", Slot: "slot", Animation: "animation", Skin: "skin", Event: "event", Constraint: "constraint"}
_OBJECTS = {kind: cls for cls, kind in _KINDS.items()}


def _param(p, extra):
    """The form field for parameter `p`: kind, default and limits, from its annotation and default."""
    ann = p.annotation
    default = None if p.default is _inspect.Parameter.empty else p.default
    spec = {"name": p.name, "label": p.name.replace("_", " ").capitalize(), "default": default}
    if _typing.get_origin(ann) is _typing.Literal:
        spec.update(kind="choice", choices=list(_typing.get_args(ann)))
    elif ann in _KINDS:
        spec["kind"] = _KINDS[ann]
    elif ann is bool or isinstance(default, bool):
        spec["kind"] = "boolean"
    elif ann is int or (isinstance(default, int) and not isinstance(default, bool)):
        spec["kind"] = "integer"
    elif ann is float or isinstance(default, float):
        spec["kind"] = "number"
    else:
        spec["kind"] = "text"
    if isinstance(default, (Bone, Slot, Animation, Skin, Event, Constraint)):
        spec["default"] = default.name
    spec.update({k: v for k, v in extra.items() if k in ("label", "min", "max", "step", "choices", "kind", "help")})
    if spec["kind"] == "choice" and spec["default"] is None and spec.get("choices"):
        spec["default"] = spec["choices"][0]
    return spec


def tool(label, description="", params=None):
    """Decorator: adds a function to the Scripts menu as a tool.

    The function's parameters become a form the editor shows before it runs: a number for a float
    default, a whole number for an int, a checkbox for a bool, text for a str, a list for
    typing.Literal["a", "b"], and a picker for rigby.Bone, Slot, Animation or Skin annotations.
    `params` adds options per parameter: {"amount": {"min": 0, "max": 100, "label": "Amount"}}.
    """

    def register(fn):
        if not callable(fn):
            raise TypeError("@rigby.tool decorates a function")
        hints = _typing.get_type_hints(fn) if getattr(fn, "__annotations__", None) else {}
        fields = []
        for p in _inspect.signature(fn).parameters.values():
            if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
                continue
            fields.append(_param(p.replace(annotation=hints.get(p.name, p.annotation)), (params or {}).get(p.name, {})))
        unknown = set(params or {}) - {f["name"] for f in fields}
        if unknown:
            raise TypeError(f"params names no parameter of {fn.__name__}: {', '.join(sorted(unknown))}")
        _tools[label] = {"label": label, "description": description, "fn": fn, "params": fields}
        return fn

    return register


def tools():
    """Labels of the tools this script has registered so far."""
    return list(_tools)


# Called by the editor. Tools are kept per script, so reloading a script replaces only its tools.
_registry = {}


def _begin(script):
    _tools.clear()


def _collect(script):
    _registry[script] = dict(_tools)
    _tools.clear()
    return _json.dumps([{"label": t["label"], "description": t["description"], "params": t["params"]} for t in _registry[script].values()])


def _forget(script):
    _registry.pop(script, None)
    _tools.clear()


def _run(script, label, args_json="{}"):
    entry = _registry[script][label]
    args = _json.loads(args_json or "{}")
    kinds = {f["name"]: f["kind"] for f in entry["params"]}
    for k, v in list(args.items()):
        if k not in kinds:
            del args[k]
        elif kinds[k] in _OBJECTS and v is not None:
            args[k] = _OBJECTS[kinds[k]](v)
    entry["fn"](**args)


# The console (Script editor > Console): one namespace for the session, like Python's own prompt.
_console_ns = {"__name__": "__console__"}


def _console(source):
    """Runs console input: an expression's value comes back as its repr, statements just run."""
    import rigby

    _console_ns.setdefault("rigby", rigby)
    try:
        code = compile(source, "<console>", "eval")
    except SyntaxError:
        exec(compile(source, "<console>", "exec"), _console_ns)
        return _json.dumps(None)
    value = eval(code, _console_ns)
    if value is None:
        return _json.dumps(None)
    _console_ns["_"] = value
    return _json.dumps(repr(value))


def _console_names(prefix):
    """Names the console knows that start with `prefix` (for completion)."""
    return _json.dumps(sorted(n for n in _console_ns if n.startswith(prefix) and not n.startswith("__")))
