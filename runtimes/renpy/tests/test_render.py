# SPDX-License-Identifier: MIT OR Apache-2.0
"""Geometry tests: the Python renderer must emit what the JavaScript reference (src/core/draw.js)
draws, piece by piece: atlas pages, blend modes, positions, page UVs (trimmed and rotated regions,
image sequences), clipped triangles and two-color tints. Golden files come from
``make_render_golden.mjs``."""

import glob
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "game"))

from rigby2d import AnimationState, Atlas, Pose, RegionLookup, RenderOutput, STRIDE, load_skeleton  # noqa: E402


def close(a, b):
    if a == b:
        return 0.0
    return abs(a - b) / max(1.0, abs(a), abs(b))


class Recorder(RenderOutput):
    """Keeps every emitted piece separately instead of merging them into batches."""

    def __init__(self):
        RenderOutput.__init__(self)
        self.pieces = []

    def _emit(self, page, blend, positions, uvs, triangles, light, dark):
        self.pieces.append({"page": page, "blend": blend, "positions": list(positions), "uvs": list(uvs),
                            "triangles": list(triangles), "light": list(light), "dark": list(dark)})
        RenderOutput._emit(self, page, blend, positions, uvs, triangles, light, dark)


class RenderTest(unittest.TestCase):

    def test_geometry_matches_the_javascript_renderer(self):
        files = glob.glob(os.path.join(HERE, "golden", "*.render.json"))
        if os.environ.get("RIGBY_GOLDEN_DIR"):
            files += glob.glob(os.path.join(os.environ["RIGBY_GOLDEN_DIR"], "*.render.json"))
        files = sorted(files)
        self.assertTrue(files)
        for path in files:
            with open(path) as f:
                golden = json.load(f)
            with open(os.path.join(REPO, golden["file"]), "rb") as f:
                sk = load_skeleton(f.read())
            with open(os.path.join(REPO, golden["atlas"])) as f:
                lookup = RegionLookup(sk, Atlas.parse(f.read()))
            pose = Pose(sk)
            state = AnimationState(sk)
            state.set_animation(0, golden["animation"], True, 0.0)
            out = Recorder()
            worst = 0.0
            frame = 0
            clipped = 0
            for i in range(1, 41):
                state.update(1.0 / 30.0)
                state.apply(pose)
                if i % 4:
                    continue
                out.pieces = []
                batches = out.build(pose, lookup)
                expected = golden["frames"][frame]
                frame += 1
                at = "%s frame %d" % (os.path.basename(path), frame)
                self.assertEqual(len(out.pieces), len(expected), at)
                for got, want in zip(out.pieces, expected):
                    self.assertEqual(got["page"], want["page"], at)
                    self.assertEqual(got["blend"], want["blend"], at)
                    self.assertEqual(got["triangles"], want["triangles"], at)
                    self.assertEqual(len(got["positions"]), len(want["positions"]), at)
                    for key in ("positions", "uvs", "light"):
                        for a, b in zip(got[key], want[key]):
                            worst = max(worst, close(a, b))
                    if want["dark"] is None:
                        self.assertEqual(got["dark"][3], 0.0, at)
                    else:
                        for a, b in zip(got["dark"][:3], want["dark"]):
                            worst = max(worst, close(a, b))
                    if len(want["triangles"]) not in (6,) and want["triangles"][:3] == [0, 1, 2]:
                        clipped += 1
                # Batches hold the same triangles, with STRIDE attributes per point.
                for b in batches:
                    self.assertEqual(len(b.attributes), len(b.points) // 2 * STRIDE)
                    self.assertTrue(all(0 <= t < len(b.points) // 2 for t in b.indices))
            print("%s: max relative error %.2e" % (os.path.basename(path), worst))
            self.assertLess(worst, 1e-6, path)


if __name__ == "__main__":
    unittest.main()
