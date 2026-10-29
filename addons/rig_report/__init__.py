# SPDX-License-Identifier: MIT OR Apache-2.0
addon_info = {
    "name": "Rig report",
    "version": (1, 0, 0),
    "author": "Rigby2D",
    "description": "Checks the rig before export: empty slots, unused bones, duplicate-looking names and empty animations, listed in the log.",
    "rigby": (0, 4, 1),
    "url": "https://github.com/jaisurya-dev-art/rigby2d/tree/develop/addons/rig_report",
}

import rigby


def register():
    @rigby.tool("Rig report", description="Lists possible problems in View > Log")
    def report():
        bones = rigby.bones()
        slots = rigby.slots()
        anims = rigby.animations()
        issues = []
        used = {s.bone.name for s in slots}
        for b in bones:
            if b.name != "root" and not b.children and b.name not in used:
                issues.append(f"Bone '{b.name}' has no children and no slots")
        for s in slots:
            if not s.attachments:
                issues.append(f"Slot '{s.name}' has no attachments")
        seen = {}
        for b in bones:
            key = b.name.lower().replace(" ", "").replace("_", "")
            if key in seen:
                issues.append(f"Bones '{seen[key]}' and '{b.name}' have almost the same name")
            seen[key] = b.name
        for a in anims:
            if a.duration <= 0:
                issues.append(f"Animation '{a.name}' is empty")
        rigby.log(f"Rig report: {len(bones)} bones, {len(slots)} slots, {len(anims)} animations")
        for line in issues:
            rigby.warn(line)
        rigby.status(f"Rig report: {len(issues)} possible problem(s)" + (" (see View > Log)" if issues else ""))


def unregister():
    pass
