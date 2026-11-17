# SPDX-License-Identifier: MIT OR Apache-2.0
"""Rigby2D runtime in pure Python.

Loads skeleton JSON (3.8, 4.2, 4.3) with its ``.atlas`` and evaluates poses, IK, transform, path,
physics and slider constraints, image sequences, clipping and playback with tracks, crossfades,
queues and events. It is a port of the Rust runtime and matches the JavaScript reference runtime
(``src/core``) frame by frame. It has no dependencies, so it runs inside Ren'Py on every platform
Ren'Py supports.

    from rigby2d import load_skeleton, Atlas, Pose, AnimationState, RegionLookup, RenderOutput

    sk = load_skeleton(open("nila.json", "rb").read())
    pose = Pose(sk)
    state = AnimationState(sk)
    state.set_animation(0, "idle", True)

    # Every frame:
    state.update(dt)
    state.apply(pose)
    for e in state.drain_events(): ...
    batches = RenderOutput().build(pose, RegionLookup(sk, Atlas.parse(atlas_text)))
"""

from .atlas import Atlas
from .model import SkeletonData
from .pose import Pose
from .reader import LoadError, load_skeleton, load_skeleton_text
from .render import Batch, RegionLookup, RenderOutput, STRIDE
from .state import AnimationState, StateEvent, Event, START, END, COMPLETE, EVENT
from . import lipsync

VERSION = "0.6.0"

__all__ = [
    "Atlas", "SkeletonData", "Pose", "LoadError", "load_skeleton", "load_skeleton_text", "Batch", "RegionLookup",
    "RenderOutput", "STRIDE", "AnimationState", "StateEvent", "Event", "START", "END", "COMPLETE", "EVENT",
    "lipsync", "VERSION",
]
