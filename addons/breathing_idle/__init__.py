# SPDX-License-Identifier: MIT OR Apache-2.0
addon_info = {
    "name": "Breathing idle",
    "version": (1, 0, 0),
    "author": "Rigby2D",
    "description": "Makes a looping 'breathe' animation: the chest rises and falls, the head follows a little.",
    "rigby": (0, 4, 1),
    "url": "https://github.com/jaisurya-dev-art/rigby2d/tree/develop/addons/breathing_idle",
}

import re

import rigby

LENGTH = 2.4  # seconds for one breath


def _pick(pattern):
    return [b for b in rigby.bones() if re.search(pattern, b.name, re.IGNORECASE)]


def register():
    @rigby.tool("Make a breathing idle", description="Selected bones breathe (or the chest, spine or torso bones)")
    def breathe():
        chest = rigby.selected_bones() or _pick(r"chest|torso|spine|body")
        if not chest:
            raise rigby.RigbyError("Select the bones that should breathe (no chest, spine or torso bone found)")
        heads = [b for b in _pick(r"head|neck") if b not in chest]
        names = {a.name for a in rigby.animations()}
        name = "breathe"
        n = 2
        while name in names:
            name = f"breathe {n}"
            n += 1
        anim = rigby.add_animation(name, LENGTH)
        for b in chest:
            for t, s in ((0, 1.0), (LENGTH / 2, 1.035), (LENGTH, 1.0)):
                anim.key(b, "scale", t, (1.0, s), "ease_in_out")
        for b in heads:
            for t, r in ((0, 0.0), (LENGTH / 2, -1.5), (LENGTH, 0.0)):
                anim.key(b, "rotate", t, r, "ease_in_out")
        anim.open()
        rigby.status(f"Made '{name}': {len(chest)} breathing bone(s), {len(heads)} following")


def unregister():
    pass
