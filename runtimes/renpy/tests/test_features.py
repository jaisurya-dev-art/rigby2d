# SPDX-License-Identifier: MIT OR Apache-2.0
"""Tests for what the Ren'Py integration finds in a rig (mouth shapes, blinks, 2.5D turn, pupils),
for gaze through a turn control, and for lip-sync timing of dialogue."""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "game"))

from rigby2d import AnimationState, Pose, features, lipsync, load_skeleton  # noqa: E402


def load(path):
    with open(os.path.join(REPO, path), "rb") as f:
        return load_skeleton(f.read())


NILA = load("branding/nila/export/nila.json")
TURN = load("test/fixtures/turn-rig.json")
RIGBYTRON = load("branding/rigbytron/export/rigbytron.json")


class MouthTest(unittest.TestCase):

    def test_nila_mouth_shapes(self):
        slot, mouths = features.find_mouth(NILA)
        self.assertEqual(NILA.slots[slot].name, "mouth")
        for v in ("A", "E", "I", "O", "U", "MBP", "FV", "L"):
            self.assertEqual(mouths[v], "mouth_viseme_" + v)
        self.assertEqual(mouths["rest"], "mouth_smile")

    def test_rig_without_mouth(self):
        self.assertEqual(features.find_mouth(RIGBYTRON), (None, None))

    def test_named_slot(self):
        slot, mouths = features.find_mouth(NILA, "mouth")
        self.assertIsNotNone(slot)
        self.assertEqual(features.find_mouth(NILA, "hand_r"), (None, None))


class BlinkTest(unittest.TestCase):

    def test_learned_from_idle(self):
        kind, state = features.find_blink(NILA)
        self.assertEqual(kind, "slots")
        names = {NILA.slots[s].name: v for s, v in state.items()}
        self.assertEqual(names["eye_r_alt"], "eye_r_closed")
        self.assertEqual(names["eye_l_alt"], "eye_l_closed")
        for part in ("eye_r", "pupil_r", "eye_r_lashes", "eye_l", "pupil_l", "eye_l_lashes"):
            self.assertIsNone(names[part])

    def test_no_eyes(self):
        self.assertIsNone(features.find_blink(RIGBYTRON))


class GazeTest(unittest.TestCase):

    def test_turn_control_found(self):
        turn = features.find_turn(TURN)
        self.assertEqual(TURN.bones[turn["bone"]].name, "head-turn-control")
        self.assertAlmostEqual(turn["x"][0], TURN.bones[turn["bone"]].setup[0], places=4)
        self.assertAlmostEqual(turn["y"][0], TURN.bones[turn["bone"]].setup[1], places=4)
        self.assertIsNone(features.find_turn(NILA))

    def test_looking_turns_the_head(self):
        turn = features.find_turn(TURN)
        pose = Pose(TURN)
        state = AnimationState(TURN)

        def head_mesh(gx, gy):
            x, y = features.turn_control(TURN, pose, turn, gx, gy)
            pose.clear_bone()
            if gx or gy:
                pose.set_bone(turn["bone"], x=x, y=y)
            state.apply(pose)
            return [q.positions for q in pose.quads()]

        ahead = head_mesh(0.0, 0.0)
        self.assertEqual(ahead, head_mesh(0.0, 0.0))
        right = head_mesh(1.0, 0.0)
        left = head_mesh(-1.0, 0.0)
        up = head_mesh(0.0, 1.0)
        self.assertNotEqual(ahead, right)
        self.assertNotEqual(right, left)
        self.assertNotEqual(ahead, up)
        # Beyond full reach the turn holds.
        self.assertEqual(head_mesh(5.0, 0.0), right)

    def test_pupils(self):
        pupils = features.find_pupils(NILA)
        self.assertEqual(sorted(NILA.bones[b].name for b, _ in pupils), ["pupil_l", "pupil_r"])
        self.assertTrue(all(r > 0 for _, r in pupils))
        self.assertEqual(features.gaze_bone(NILA, pupils), pupils[0][0])


class LipSyncTimingTest(unittest.TestCase):

    def test_text_timing_is_ordered_and_paused(self):
        words = lipsync.time_text("Hi! I'm Nila, and I'm made of layers.")
        self.assertEqual([w for w, _, _ in words], ["Hi!", "I'm", "Nila,", "and", "I'm", "made", "of", "layers."])
        for (_, s0, e0), (_, s1, _) in zip(words, words[1:]):
            self.assertLessEqual(e0, s1)
        gap_after_stop = words[1][1] - words[0][2]
        gap_after_comma = words[3][1] - words[2][2]
        gap_plain = words[4][1] - words[3][2]
        self.assertGreater(gap_after_stop, gap_after_comma)
        self.assertGreater(gap_after_comma, gap_plain)

    def test_voice_duration_stretches_timing(self):
        words = lipsync.time_text("My name means moon.", duration=2.0)
        self.assertAlmostEqual(words[-1][2], 2.0)

    def test_text_tags_are_not_spoken(self):
        self.assertEqual(lipsync.strip_text_tags("{b}Hello{/b}{w=0.5} {{there}"), "Hello {there}")
        self.assertEqual([w for w, _, _ in lipsync.time_text("{i}Oh{/i}{w} no")], ["Oh", "no"])

    def test_track(self):
        track = lipsync.Track.from_text("Happy!", duration=0.6)
        self.assertEqual(track.viseme_at(-1.0), "rest")
        shapes = {track.viseme_at(t / 100.0) for t in range(0, 70)}
        self.assertIn("A", shapes)
        self.assertEqual(track.viseme_at(5.0), "rest")

    def test_timing_files(self):
        rhubarb = lipsync.Track.from_timing('{"mouthCues": [{"start": 0.0, "value": "X"}, {"start": 0.2, "value": "D"}, {"start": 0.5, "value": "A"}]}')
        self.assertEqual(rhubarb.viseme_at(0.3), "A")
        self.assertEqual(rhubarb.viseme_at(0.6), "MBP")
        whisper = lipsync.Track.from_timing('{"segments": [{"words": [{"word": " moon", "start": 0.1, "end": 0.5}]}]}')
        self.assertIn("U", {whisper.viseme_at(t / 100.0) for t in range(0, 60)})
        with self.assertRaises(ValueError):
            lipsync.read_timing("not a timing file")


class OverrideTest(unittest.TestCase):

    def test_bone_override_and_clear(self):
        pose = Pose(NILA)
        state = AnimationState(NILA)
        state.set_animation(0, "idle", True)
        state.apply(pose)
        head = NILA.find_bone("head")
        before = pose.world[head]
        pose.set_bone(head, rotation=30.0)
        state.apply(pose)
        self.assertNotEqual(before, pose.world[head])
        pose.clear_bone(head)
        state.apply(pose)
        self.assertEqual(before, pose.world[head])


if __name__ == "__main__":
    unittest.main()
