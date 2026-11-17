# SPDX-License-Identifier: MIT OR Apache-2.0
"""Golden tests: the Python runtime must reproduce the JavaScript runtime (src/core) frame by frame.

Golden files come from ``runtimes/rust/rigby-runtime/tests/golden/generate.mjs`` (run ``node
make_golden.mjs`` here to record them). The replay below follows the same fixed scenarios: every
animation looping, a crossfade with a layered track and a queued animation, and skins.

    python3 -m unittest discover -s runtimes/renpy/tests
"""

import glob
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "game"))

from rigby2d import AnimationState, Pose, load_skeleton  # noqa: E402
from rigby2d.state import COMPLETE, EVENT  # noqa: E402

DT = 1.0 / 30.0


def close(a, b):
    if a == b or (a != a and b != b):
        return 0.0
    return abs(a - b) / max(1.0, abs(a), abs(b))


def js_number(v):
    if v == int(v) and abs(v) < 1e15:
        return str(int(v))
    return repr(v)


def replay(sk, scenario, worst, label):
    problems = []
    kind = scenario.get("kind", "")
    animation = scenario.get("animation", "")
    pose = Pose(sk)
    skin = scenario.get("skin")
    pose.skin = sk.find_skin(skin) if isinstance(skin, str) else None
    state = AnimationState(sk)
    frames = scenario["frames"]
    if kind == "setup":
        steps, every = 1, 1
    elif kind == "mix":
        steps, every = 45, 2
    elif kind == "skin":
        steps, every = 20, 5
    else:
        steps, every = len(frames) * 3, 3
    names = animation.replace("+", ">").split(">")

    def setup(i):
        if kind in ("loop", "skin") and i == 0:
            state.set_animation(0, animation, True, 0.0)
        elif kind == "mix":
            if i == 0:
                state.set_animation(0, names[0], True, 0.0)
            if i == 12:
                state.set_animation(0, names[1], True, 0.25)
                e = state.set_animation(1, names[2], False, 0.0)
                if e is not None:
                    e.alpha = 0.5
                state.add_animation(0, names[0], True, 0.2, 0.5)

    setup(0)
    events = []
    f = 0
    for i in range(1, steps + 1):
        setup(i)
        state.update(DT)
        state.apply(pose)
        for e in state.drain_events():
            name = sk.animations[e.animation].name
            if e.kind == EVENT:
                events.append("%d:%s@%s" % (e.track, e.event.name, js_number(e.event.time)))
            elif e.kind == COMPLETE:
                events.append("%d:complete:%s" % (e.track, name))
        if i % every != 0:
            continue
        if f >= len(frames):
            break
        expected = frames[f]
        f += 1
        at = "%s %s '%s' frame %d" % (label, kind, animation, f)
        world = expected["world"]
        for b, m in enumerate(pose.world):
            for k, v in enumerate(m):
                e = close(v, world[b * 6 + k])
                if e > worst["world"]:
                    worst["world"] = e
                    worst["at"] = "%s, bone %s value %d: python %r js %r" % (at, sk.bones[b].name, k, v, world[b * 6 + k])
        if expected["drawOrder"] != pose.draw_order:
            problems.append("%s: draw order differs" % at)
        quads = pose.quads()
        expected_quads = expected["quads"]
        if len(quads) != len(expected_quads):
            problems.append("%s: %d drawables, expected %d" % (at, len(quads), len(expected_quads)))
            continue
        for q, e in zip(quads, expected_quads):
            if q.slot != e["slot"] or q.image != e["image"]:
                problems.append("%s: slot %s shows '%s', expected slot %s '%s'" % (at, sk.slots[q.slot].name, q.image, e["slot"], e["image"]))
                continue
            if len(q.positions) != len(e["positions"]):
                problems.append("%s: slot %s has %d positions, expected %d" % (at, sk.slots[q.slot].name, len(q.positions), len(e["positions"])))
                continue
            for k, v in enumerate(q.positions):
                err = close(v, e["positions"][k])
                if err > worst["positions"]:
                    worst["positions"] = err
                    worst["at_pos"] = "%s slot %s" % (at, sk.slots[q.slot].name)
            for k, v in enumerate(q.color):
                err = close(v, e["color"][k])
                if err > worst["color"]:
                    worst["color"] = err
        if expected["events"] != events:
            problems.append("%s: events %r, expected %r" % (at, events, expected["events"]))
        events = []
    return problems


def golden_files():
    dirs = [os.path.join(HERE, "golden")]
    extra = os.environ.get("RIGBY_GOLDEN_DIR")
    if extra:
        dirs.append(extra)
    files = []
    for d in dirs:
        files.extend(glob.glob(os.path.join(d, "*.golden.json")))
    return sorted(files)


class GoldenTest(unittest.TestCase):

    def test_matches_the_javascript_runtime(self):
        files = golden_files()
        self.assertTrue(files, "no golden files: run `node make_golden.mjs` in runtimes/renpy/tests")
        failures = []
        for path in files:
            with open(path) as fh:
                golden = json.load(fh)
            if "scene" in golden:
                continue
            label = golden.get("label", "?")
            source = os.path.join(REPO, golden["file"])
            with open(source, "rb") as fh:
                sk = load_skeleton(fh.read())
            worst = {"world": 0.0, "positions": 0.0, "color": 0.0, "at": "", "at_pos": ""}
            problems = []
            for scenario in golden["scenarios"]:
                problems.extend(replay(sk, scenario, worst, label))
            print("%s: max relative error world %.2e, positions %.2e, color %.2e" % (label, worst["world"], worst["positions"], worst["color"]))
            if worst["world"] > 1e-6:
                failures.append("%s: world error %.2e at %s" % (label, worst["world"], worst["at"]))
            if worst["positions"] > 1e-6 or worst["color"] > 1e-9:
                failures.append("%s: drawable error positions %.2e (%s), color %.2e" % (label, worst["positions"], worst["at_pos"], worst["color"]))
            failures.extend(problems[:8])
        self.assertFalse(failures, "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
