# SPDX-License-Identifier: MIT OR Apache-2.0
addon_info = {
    "name": "Mirror tools",
    "version": (1, 0, 0),
    "author": "Rigby2D",
    "description": "Mirror the selected bones across X = 0, and swap left and right in their names.",
    "rigby": (0, 4, 1),
    "url": "https://github.com/jaisurya-dev-art/rigby2d/tree/develop/addons/mirror_tools",
}

import re

import rigby

# Name pairs, tried in order: _l/_r, .L/.R, Left/Right and left/right.
_SIDES = [(r"_l\b", "_r"), (r"_r\b", "_l"), (r"\.L\b", ".R"), (r"\.R\b", ".L"), ("Left", "Right"), ("Right", "Left"), ("left", "right"), ("right", "left")]


def swap_side(name):
    """The name for the other side: arm_l -> arm_r, hand.L -> hand.R, leftEye -> rightEye."""
    for pattern, other in _SIDES:
        if re.search(pattern, name):
            return re.sub(pattern, other, name, count=1)
    return name


def register():
    @rigby.tool("Mirror selected bones", description="Flip the selected bones' setup across X = 0")
    def mirror_bones():
        bones = rigby.selected_bones()
        if not bones:
            raise rigby.RigbyError("Select the bones to mirror first")
        for b in bones:
            b.set(x=-b.x, rotation=180 - b.rotation)
        rigby.status(f"Mirrored {len(bones)} bone(s)")

    @rigby.tool("Swap left/right in names", description="arm_l <-> arm_r, hand.L <-> hand.R, left <-> right")
    def swap_names():
        bones = rigby.selected_bones() or rigby.bones()
        taken = {b.name for b in rigby.bones()}
        renamed = 0
        for b in bones:
            new = swap_side(b.name)
            if new != b.name and new not in taken:
                taken.discard(b.name)
                b.name = new
                taken.add(new)
                renamed += 1
        rigby.status(f"Renamed {renamed} bone(s)")


def unregister():
    pass
