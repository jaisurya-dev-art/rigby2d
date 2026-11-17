# SPDX-License-Identifier: MIT OR Apache-2.0
"""Writes synthetic skeletons that exercise every feature the runtime evaluates (inherit modes, IK,
transform, path, physics and slider constraints, weighted and linked meshes, deform, clipping,
sequences, colors, draw order, events, curves of formats 3.8, 4.2 and 4.3). The golden data for
them comes from the JavaScript reference runtime (see ``make_golden.mjs``).

Usage: python3 make_fixtures.py <output dir>
"""

import json
import os
import sys


def bezier(t0, v0, t1, v1):
    """4.x absolute control points easing in and out between two keys."""
    dt = t1 - t0
    return [t0 + dt * 0.25, v0, t0 + dt * 0.75, v1]


def kitchen_sink(version):
    v4 = version.startswith("4")
    bones = [
        {"name": "root"},
        {"name": "hip", "parent": "root", "y": 120, "rotation": 5},
        {"name": "spine", "parent": "hip", "length": 80, "rotation": 88, "scaleX": 1.1},
        {"name": "head", "parent": "spine", "x": 82, "length": 40, "rotation": -3, "shearY": 4},
        {"name": "arm-l", "parent": "spine", "x": 70, "y": 20, "length": 50, "rotation": 150},
        {"name": "fore-l", "parent": "arm-l", "x": 50, "length": 45, "rotation": -20},
        {"name": "hand-target", "parent": "root", "x": -60, "y": 210},
        {"name": "arm-r", "parent": "spine", "x": 70, "y": -20, "length": 50, "rotation": -150, "scaleY": -1},
        {"name": "fore-r", "parent": "arm-r", "x": 50, "length": 45, "rotation": 15},
        {"name": "aim", "parent": "root", "x": 90, "y": 170},
        {"name": "eye", "parent": "head", "x": 20, "y": 8, "length": 10},
        {"name": "hat", "parent": "head", "x": 40, "inherit": "noScale"},
        {"name": "badge", "parent": "spine", "x": 30, "inherit": "onlyTranslation"},
        {"name": "flag", "parent": "spine", "x": 40, "y": 5, "inherit": "noRotationOrReflection"},
        {"name": "cape", "parent": "spine", "x": 60, "length": 60, "rotation": 170, "inherit": "noScaleOrReflection"},
        {"name": "tail-1", "parent": "hip", "x": -10, "length": 30, "rotation": 200},
        {"name": "tail-2", "parent": "tail-1", "x": 30, "length": 30},
        {"name": "tail-3", "parent": "tail-2", "x": 30, "length": 30},
        {"name": "hair", "parent": "head", "x": 30, "y": 10, "length": 35, "rotation": 120},
        {"name": "follower", "parent": "root", "x": 10},
        {"name": "local-follower", "parent": "hip", "x": 20, "y": 30},
        {"name": "dial", "parent": "root", "x": -120, "y": 40, "length": 20},
    ]
    slots = [
        {"name": "cape", "bone": "cape", "attachment": "cape"},
        {"name": "body", "bone": "spine", "attachment": "body", "color": "f0e0d0ff"},
        {"name": "arm-l", "bone": "arm-l", "attachment": "arm"},
        {"name": "fore-l", "bone": "fore-l", "attachment": "fore", "dark": "201000"},
        {"name": "head", "bone": "head", "attachment": "head"},
        {"name": "eye", "bone": "eye", "attachment": "eye-open"},
        {"name": "hat", "bone": "hat", "attachment": "hat", "blend": "additive"},
        {"name": "clip", "bone": "head", "attachment": "clip"},
        {"name": "hair", "bone": "hair", "attachment": "hair"},
        {"name": "badge", "bone": "badge", "attachment": "badge"},
        {"name": "flag", "bone": "flag", "attachment": "flag-linked"},
        {"name": "tail-path", "bone": "root", "attachment": "tail-path"},
        {"name": "tail", "bone": "tail-1", "attachment": "tail"},
        {"name": "arm-r", "bone": "arm-r", "attachment": "arm"},
        {"name": "fore-r", "bone": "fore-r", "attachment": "fore"},
        {"name": "spark", "bone": "aim", "attachment": "spark"},
        {"name": "follower", "bone": "follower", "attachment": "dot"},
        {"name": "local-follower", "bone": "local-follower", "attachment": "dot"},
    ]
    default = {
        "cape": {"cape": {"type": "mesh", "uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 0, 2, 3], "hull": 4,
                          "vertices": [0, -15, 60, -15, 60, 15, 0, 15], "width": 60, "height": 30}},
        "body": {"body": {"width": 90, "height": 60, "x": 40, "rotation": -90}},
        "arm-l": {"arm": {"width": 50, "height": 14, "x": 25}},
        "fore-l": {"fore": {"width": 45, "height": 12, "x": 22}},
        "arm-r": {"arm": {"width": 50, "height": 14, "x": 25}},
        "fore-r": {"fore": {"width": 45, "height": 12, "x": 22}},
        "head": {"head": {"type": "mesh", "uvs": [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
                          "triangles": [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4], "hull": 4,
                          # weighted to head and eye
                          "vertices": [1, 3, 0, -25, 1, 1, 3, 50, -25, 1, 2, 3, 50, 25, 0.6, 10, 30, 17, 0.4,
                                       1, 3, 0, 25, 1, 2, 3, 25, 0, 0.5, 10, 5, -8, 0.5],
                          "width": 50, "height": 50}},
        "eye": {
            "eye-open": {"width": 10, "height": 8},
            "eye-shut": {"width": 10, "height": 3, "color": "ffd0d0ff"},
        },
        "hat": {"hat": {"width": 40, "height": 20, "y": 5, "sequence": {"count": 3, "start": 1, "digits": 2}}},
        "clip": {"clip": {"type": "clipping", "end": "hair", "vertexCount": 4,
                          "vertices": [-10, -30, 70, -30, 70, 40, -10, 40]}},
        "hair": {"hair": {"type": "mesh", "uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 0, 2, 3], "hull": 4,
                          "vertices": [0, -8, 35, -8, 35, 8, 0, 8], "width": 35, "height": 16}},
        "badge": {"badge": {"width": 12, "height": 12, "scaleX": 1.5, "rotation": 15}},
        "flag": {
            "flag": {"type": "mesh", "uvs": [0, 0, 1, 0, 1, 1, 0, 1], "triangles": [0, 1, 2, 0, 2, 3], "hull": 4,
                     "vertices": [0, 0, 30, 0, 30, -20, 0, -20], "width": 30, "height": 20},
            "flag-linked": {"type": "linkedmesh", "parent": "flag", "path": "flag-b", "width": 30, "height": 20},
        },
        "tail-path": {"tail-path": {"type": "path", "vertexCount": 9, "closed": False, "constantSpeed": True,
                                    "lengths": [60, 130, 210],
                                    "vertices": [-20, 110, -10, 110, 0, 110, 10, 100, 20, 80, 40, 60, 50, 40, 60, 20, 70, 0]}},
        "tail": {"tail": {"width": 90, "height": 12, "x": 45}},
        "spark": {"spark": {"width": 16, "height": 16, "color": "ffff80c0"}},
        "follower": {"dot": {"width": 6, "height": 6}},
        "local-follower": {"dot": {"width": 6, "height": 6}},
    }
    ik = [
        {"name": "arm-ik", "order": 0, "bones": ["arm-l", "fore-l"], "target": "hand-target", "bendPositive": False, "softness": 8},
        {"name": "aim-ik", "order": 1, "bones": ["arm-r"], "target": "aim", "stretch": True, "uniform": True, "mix": 0.8},
    ]
    transform = [
        {"name": "follow", "order": 2, "bones": ["follower"], "target": "head", "x": 5, "y": 3, "rotation": 10,
         "mixRotate": 0.7, "mixX": 1, "mixY": 0.9, "mixScaleX": 0.5, "mixShearY": 0.3, "shearY": 5},
        {"name": "follow-local", "order": 3, "bones": ["local-follower"], "target": "eye", "local": True, "relative": True,
         "mixRotate": 0.5, "mixX": 0.4, "mixY": 0.4, "mixScaleX": 0.2},
    ]
    path = [
        {"name": "tail-path", "order": 4, "bones": ["tail-1", "tail-2", "tail-3"], "target": "tail-path",
         "rotateMode": "chain", "spacingMode": "length", "position": 0.05, "mixRotate": 0.8, "mixX": 1},
    ]
    physics = [
        {"name": "hair-physics", "order": 5, "bone": "hair", "rotate": 1, "x": 0.3, "y": 0.3, "scaleX": 0.2,
         "inertia": 0.6, "strength": 120, "damping": 0.8, "gravity": 3, "fps": 60},
    ]

    def curve(t0, v0, t1, v1, n=1):
        return bezier(t0, v0, t1, v1) * n if v4 else [0.25, 0, 0.75, 1]

    animations = {
        "walk": {
            "bones": {
                "hip": {
                    "rotate": [{"time": 0, "value": 0, "curve": curve(0, 0, 0.5, 8)}, {"time": 0.5, "value": 8, "curve": curve(0.5, 8, 1, 0)}, {"time": 1, "value": 0}],
                    "translate": [{"time": 0, "x": 0, "y": 0, "curve": "stepped"}, {"time": 0.25, "x": 6, "y": 4}, {"time": 0.75, "x": -6, "y": -2}, {"time": 1}],
                },
                "spine": {"scale": [{"time": 0}, {"time": 0.5, "x": 1.1, "y": 0.9}, {"time": 1}],
                          "shear": [{"time": 0}, {"time": 0.6, "x": 4, "y": -6}, {"time": 1}]},
                "head": {"rotate": [{"time": 0, "value": -5}, {"time": 0.5, "value": 12}, {"time": 1, "value": -5}],
                         "translatex": [{"time": 0}, {"time": 0.5, "value": 3}, {"time": 1}],
                         "scaley": [{"time": 0}, {"time": 0.5, "value": 1.2}, {"time": 1}]},
                "hand-target": {"translate": [{"time": 0}, {"time": 0.5, "x": 30, "y": -20}, {"time": 1}]},
                "aim": {"translate": [{"time": 0}, {"time": 0.5, "x": 80, "y": 30}, {"time": 1}]},
                "hat": {"inherit": [{"time": 0}, {"time": 0.5, "inherit": "normal"}]},
                "dial": {"rotate": [{"time": 0}, {"time": 1, "value": 180}]},
            },
            "slots": {
                "eye": {"attachment": [{"time": 0.4, "name": "eye-shut"}, {"time": 0.55, "name": "eye-open"}]},
                "body": {"rgba": [{"time": 0, "color": "ffffffff"}, {"time": 0.5, "color": "ff8080c0"}, {"time": 1, "color": "ffffffff"}]},
                "spark": {"alpha": [{"time": 0, "value": 1}, {"time": 0.5, "value": 0.2}, {"time": 1, "value": 1}]},
                "fore-l": {"rgba2": [{"time": 0, "light": "ffffffff", "dark": "000000"}, {"time": 1, "light": "80ff80ff", "dark": "402000"}]},
                "badge": {"rgb": [{"time": 0, "color": "ffffff"}, {"time": 1, "color": "2080ff"}]},
            },
            "drawOrder": [{"time": 0.3, "offsets": [{"slot": "arm-r", "offset": -10}]}, {"time": 0.8}],
            "events": [{"time": 0.25, "name": "step"}, {"time": 0.75, "name": "step", "int": 2, "string": "right"}],
            "ik": {"arm-ik": [{"time": 0, "mix": 1, "softness": 8}, {"time": 0.5, "mix": 0.4, "softness": 0, "bendPositive": True}, {"time": 1, "mix": 1, "softness": 8}]},
            "transform": {"follow": [{"time": 0, "mixRotate": 0.7}, {"time": 0.5, "mixRotate": 0.1, "mixX": 0.5, "mixY": 0.2}, {"time": 1, "mixRotate": 0.7}]},
            "path": {"tail-path": {"position": [{"time": 0, "value": 0.05}, {"time": 0.5, "value": 0.3}, {"time": 1, "value": 0.05}],
                                   "mix": [{"time": 0}, {"time": 0.5, "mixRotate": 0.3, "mixX": 0.6}]}},
            "physics": {"hair-physics": {"gravity": [{"time": 0, "value": 3}, {"time": 0.5, "value": -2}, {"time": 1, "value": 3}]}},
        },
        "wave": {
            "bones": {
                "arm-r": {"rotate": [{"time": 0}, {"time": 0.2, "value": 40}, {"time": 0.4, "value": -10}, {"time": 0.6, "value": 40}, {"time": 0.8}]},
                "spine": {"translatey": [{"time": 0}, {"time": 0.4, "value": 10}, {"time": 0.8}]},
            },
            "attachments": {"default": {
                "cape": {"cape": {"deform": [{"time": 0}, {"time": 0.4, "offset": 2, "vertices": [5, 8, 6, -4]}, {"time": 0.8}]}},
                "head": {"head": {"deform": [{"time": 0}, {"time": 0.4, "offset": 0, "vertices": [2, 2, 0, 0, 0, 0, 3, -2]}, {"time": 0.8}]}},
                "flag": {"flag": {"deform": [{"time": 0}, {"time": 0.4, "offset": 4, "vertices": [4, 6, -3, 2]}, {"time": 0.8}]}},
                "hat": {"hat": {"sequence": [{"time": 0, "mode": "loop", "index": 0, "delay": 0.1}, {"time": 0.6, "mode": "pingpongReverse", "index": 1}]}},
            }},
            "events": [{"time": 0.4, "name": "hi", "float": 0.5}],
        },
        "nod": {
            "bones": {"head": {"rotate": [{"time": 0}, {"time": 0.3, "value": -15, "curve": "stepped"}, {"time": 0.6}]}},
            "slots": {"hat": {"attachment": [{"time": 0.2, "name": None}, {"time": 0.5, "name": "hat"}]}},
        },
    }
    if v4:
        animations["walk"]["bones"]["hip"]["rotate"][0]["curve"] = bezier(0, 0, 0.5, 8)
        animations["walk"]["bones"]["hip"]["translate"][1]["curve"] = bezier(0.25, 6, 0.75, -6) + bezier(0.25, 4, 0.75, -2)
    skeleton = {
        "skeleton": {"hash": "", "spine": version, "x": -150, "y": 0, "width": 300, "height": 300, "fps": 30},
        "bones": bones,
        "slots": slots,
        "skins": [
            {"name": "default", "attachments": default},
            {"name": "red", "attachments": {"badge": {"badge": {"width": 14, "height": 14, "color": "ff2020ff"}}}},
        ] if not version.startswith("3.7") else None,
        "events": {"step": {"int": 1, "string": "left", "audio": "step.ogg"}, "hi": {}},
        "animations": animations,
    }
    if version.startswith("4.3"):
        constraints = []
        for c in ik:
            constraints.append(dict(c, type="ik"))
        for c in transform:
            d = dict(c, type="transform")
            d["source"] = d.pop("target")
            constraints.append(d)
        constraints.append({"type": "transform", "name": "dial-map", "source": "dial", "bones": ["badge"], "localSource": True, "localTarget": True, "clamp": True,
                            "properties": {"rotate": {"to": {"x": {"scale": 0.2, "max": 20}, "rotate": {"scale": 0.5, "max": 90}}}}})
        for c in path:
            d = dict(c, type="path")
            d["slot"] = d.pop("target")
            constraints.append(d)
        for c in physics:
            constraints.append(dict(c, type="physics"))
        constraints.append({"type": "slider", "name": "nod-slider", "animation": "nod", "bone": "dial", "property": "rotate", "scale": 0.004, "additive": True})
        skeleton["constraints"] = constraints
        for b in bones:
            pass
        for a in animations.values():
            for k in ("transform", "path", "physics"):
                pass
        animations["walk"]["slider"] = {"nod-slider": {"mix": [{"time": 0, "value": 1}, {"time": 0.5, "value": 0.3}, {"time": 1, "value": 1}]}}
        default["flag"]["flag-linked"]["source"] = default["flag"]["flag-linked"].pop("parent")
    else:
        skeleton["ik"] = ik
        skeleton["transform"] = transform
        skeleton["path"] = path
        if v4:
            skeleton["physics"] = physics
        else:
            for a in animations.values():
                a.pop("physics", None)
            # 3.8 names
            for c in transform:
                c["rotateMix"] = c.pop("mixRotate")
                c["translateMix"] = c.pop("mixX")
                c.pop("mixY", None)
                c["scaleMix"] = c.pop("mixScaleX")
                c["shearMix"] = c.pop("mixShearY", 1)
            for c in path:
                c["rotateMix"] = c.pop("mixRotate")
                c["translateMix"] = c.pop("mixX")
            animations["walk"]["transform"] = {"follow": [{"time": 0, "rotateMix": 0.7}, {"time": 0.5, "rotateMix": 0.1, "translateMix": 0.5}, {"time": 1, "rotateMix": 0.7}]}
            animations["walk"]["path"] = {"tail-path": {"position": [{"time": 0, "position": 0.05}, {"time": 0.5, "position": 0.3}, {"time": 1, "position": 0.05}],
                                                       "mix": [{"time": 0}, {"time": 0.5, "rotateMix": 0.3, "translateMix": 0.6}]}}
            animations["walk"]["bones"]["hip"]["rotate"] = [{"time": 0, "angle": 0, "curve": 0.25, "c3": 0.75}, {"time": 0.5, "angle": 8}, {"time": 1, "angle": 0}]
            # 3.8 keeps deform under "deform"
            animations["wave"]["deform"] = {"default": {s: {a: t["deform"] for a, t in atts.items() if "deform" in t}
                                                          for s, atts in animations["wave"]["attachments"]["default"].items() if any("deform" in t for t in atts.values())}}
            del animations["wave"]["attachments"]
            del animations["walk"]["bones"]["hat"]
    return skeleton


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "fixtures")
    os.makedirs(out, exist_ok=True)
    for version, name in (("4.2.0", "kitchen-sink-42"), ("4.3.0", "kitchen-sink-43"), ("3.8.99", "kitchen-sink-38")):
        with open(os.path.join(out, name + ".json"), "w") as f:
            json.dump(kitchen_sink(version), f, indent=1)
        print("wrote", name)


if __name__ == "__main__":
    main()
