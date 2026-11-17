# Rigby2D for Ren'Py

Animated characters for visual novels: Rigby2D skeletons in Ren'Py, with crossfading motions and
expressions driven by image attributes, lip-sync from your dialogue and voice lines, natural blinks,
gaze and physics. It is pure Python, so it needs no SDK, nothing to install and no native
libraries, and it runs everywhere Ren'Py runs: Windows, macOS, Linux, Android, iOS and the web.

```renpy
image nila = Rigby("images/nila", expressions=["happy", "surprised", "thinking"], once=["wave"])
define n = Character("Nila", image="nila")

label start:
    show nila idle
    n "Hi! I'm Nila."                  # her mouth follows the words, and her voice line if there is one
    show nila wave happy               # waves (then back to idle) with a happy face, crossfaded
    n surprised "Oh!"                  # say attributes work too
```

Needs **Ren'Py 8.3 or newer** (tested on 8.3.7 and 8.6.0).

## Compared with Live2D in Ren'Py

| | Rigby2D | Live2D Cubism |
| --- | --- | --- |
| Setup | Copy two files into `game/` | Download the Cubism SDK, install it through the launcher; copy libraries by hand for iOS; Cubism for Web for web builds |
| Licence | Free (MIT or Apache-2.0 runtime, free editor) | Cubism SDK licence; paid above a revenue threshold |
| Platforms | Every platform Ren'Py supports, the same code | Per-platform native libraries |
| Motions and expressions as image attributes, crossfades, motion sequences | Yes | Yes |
| Motions that play once and return to idle (`once=`) | Yes | No |
| Layers that combine freely (`overlays=`) and skins (outfits) as attributes | Yes | Non-exclusive expressions |
| **Lip-sync** | Automatic for every `Character(image=...)`: from the voice line (with Rhubarb, Whisper, ElevenLabs or Papagayo timing files when you have them), or from the text as it types | Write your own `update_function` |
| **Blinks** | Automatic, at natural random intervals, learned from the rig's own animations | Only what motions contain |
| **Gaze** | `look="mouse"` or `rigby.look(tag, (x, y))`: pupils, and the head through a 2.5D turn | Write your own `update_function` |
| Physics | Yes (physics constraints) | Yes |
| Events in animations | Call your Python function, play their sounds | No |
| Bone positions for speech bubbles and props | `rigby.bone_position(tag, bone)` | No |

## Install

1. Copy the `rigby2d` folder and `rigby2d.rpy` from this folder's `game/` into your game's `game/`
   folder.
2. In Rigby2D, export your character with **Export ▸ JSON + atlas** (skeleton JSON, not binary
   `.skel`). Put the files in a folder named after the character, for example:

   ```
   game/images/nila/nila.json
   game/images/nila/nila.atlas
   game/images/nila/nila.png
   ```

3. Define the image and show it:

   ```renpy
   image nila = Rigby("images/nila")
   ```

`Rigby("images/nila")` and `Rigby("images/nila/nila.json")` are the same. The atlas is found next
to the JSON, with the same name; give `atlas=` if it is elsewhere.

The `demo/` folder is a small game with NILA (voice lines included) and Rigbytron. Open it from the
Ren'Py launcher (add this folder as a projects directory) to try everything below.

## Showing characters

Every animation of the skeleton is an **image attribute**:

```renpy
show nila idle            # play "idle" (loops)
show nila wave            # crossfade to "wave"
show nila wave idle       # "wave" once, then "idle" loops
show nila                 # keep whatever plays
```

When no motion is given, the character plays `animation=` (default: `idle`, else the first
animation).

**Expressions** are animations that only key the face. List them and they become an exclusive
layer over the motion, so the body keeps moving while the face changes:

```renpy
image nila = Rigby("images/nila", expressions=["happy", "sad", "surprised"])

show nila happy           # the motion keeps playing; the face fades to happy
show nila wave surprised  # motion and expression together
show nila -surprised      # the face fades back
n happy "Yay!"            # say attributes
```

**Overlays** are layers that combine with everything (one track each), such as a blush or tears:

```renpy
image nila = Rigby("images/nila", overlays=["blush", "tears"])
show nila blush tears
show nila -tears
```

**Once**: motions listed in `once=` play once and then return to the default motion, so
`show nila wave` waves and goes back to idle by itself.

**Skins** (outfits) are attributes too: `show nila winter`.

Crossfades take `mix=` seconds (default 0.25). A character keeps playing, without restarting, when
`show` changes its attributes: it is the same character, matched by its tag.

## Lip-sync

Lip-sync is automatic. For every character defined with `image=`, the character's mouth moves
while it speaks:

- **With a voice line**, the mouth follows the voice. If a timing file sits next to the voice file,
  the mouth shapes come from it: `voice/hello.ogg` uses `voice/hello.lipsync.json`,
  `voice/hello.json` or `voice/hello.txt`. These can be from
  [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (TSV or JSON),
  [Whisper](https://github.com/openai/whisper) word timestamps, ElevenLabs text-to-speech timestamps
  or Papagayo/Moho. Without one, the line's words are spread over the length of the voice clip.
- **Without a voice**, the mouth follows the text as it types, at the player's text speed, and stops
  when the text is shown. With instant text it speaks the line at a natural pace.

The mouth shapes are the nine Rigby2D uses (A, E, I, O, U, MBP, FV, L and rest), from the same
word-to-mouth rules as the editor's lip-sync. The mouth slot and its images are found by name, just
like in the editor: a slot named `mouth` with images such as `mouth_viseme_A` ... `mouth_viseme_L`,
`A`, `ah`, `open`, `closed`, `MBP`. Give `mouth="slot"` and `visemes={"A": "mouth_open", ...}` when
your names differ. A rig without mouth shapes can have a `talk` animation, which plays while the
character speaks (or name it with `talk=`).

For a character without `image=`, add the callback yourself:

```renpy
define narrator_nila = Character("???", callback=rigby.speaking("nila"))
```

`$ rigby.say("nila", "Some words")` lip-syncs words without showing them, for cutscenes.

## Blinks, gaze and physics

**Blinks** happen on their own every few seconds, with an occasional double blink. They are learned
from the rig: a `blink` animation, or the eye images its animations swap in when they blink (NILA's
idle closes `eye_r_alt` to `eye_r_closed` and hides the open eye parts, so that is what a blink
does). A character doesn't blink while an expression has its eyes closed. `blink=False` turns it
off.

**Gaze**: `look="mouse"` makes the character follow the mouse, `look=(x, y)` looks somewhere fixed
(-1 to 1, left to right and down to up), and `rigby.look("nila", target)` changes it at any time.
Pupils (bones named `pupil` or `iris`) move within their eye. A rig with a
[2.5D turn](https://rigby2d.com/docs/poses-and-faces.html#25d-turn) turns and tilts its head too.

**Physics** constraints (hair, earrings, tails) run at the rig's own rate. `physics=False` turns
them off.

## Size and placement

A `Rigby` image is the size of the skeleton's setup pose (its bounds in the export). With no
`zoom=`, it is scaled so the setup pose is `height=` screens tall (default 1.0). Place it with
transforms as usual:

```renpy
image nila = Rigby("images/nila", height=1.25)   # taller than the screen: shown from the knees up

transform stand(x=0.5):
    xalign x
    yanchor 0.0
    ypos 0.09
```

`tint=(r, g, b, a)` multiplies every color. Ren'Py transforms (zoom, xzoom -1 to mirror, alpha,
matrixcolor, ATL, transitions) all work on it. A character is drawn part by part, so with `alpha`
below 1 its overlapping parts show through each other; `flatten=True` draws it into one texture
first (sized to where it is each frame, so nothing is cut off), and it then fades as a whole.
Transitions such as `dissolve` don't need it.

## Script API

Functions in the `rigby` namespace work on a shown character by its tag:

| Function | Does |
| --- | --- |
| `rigby.play(tag, animation, track=0, loop=True, mix=0.25)` | Plays an animation now. Track 0 is the motion, 1 the expression, 2 and up overlays. |
| `rigby.queue(tag, animation, track=0, loop=True, mix=0.25, delay=None)` | Plays it after the current one (or `delay` seconds after it started). |
| `rigby.stop(tag, track, mix=0.25)` | Fades a track out. |
| `rigby.look(tag, target)` | `"mouse"`, `(x, y)` or None. |
| `rigby.say(tag, text)` | Lip-syncs text without showing it. |
| `rigby.set_skin(tag, skin)` / `rigby.set_speed(tag, speed)` | Outfit and playback speed. |
| `rigby.bone_position(tag, bone)` | Where a bone is, in pixels inside the image: anchor speech bubbles, props or effects to a hand or the head. |
| `rigby.animations(tag)` | The skeleton's animation names. |

**Events** keyed in your animations (a footstep, a sparkle) can call a function and play their
sound:

```renpy
init python:
    def nila_event(tag, event):
        if event.name == "sparkle":
            renpy.show("sparkle", at_list=[...])

image nila = Rigby("images/nila", on_event=nila_event, event_sounds=True, sound_prefix="audio/")
```

`event` has `name`, `int`, `float`, `string`, `audio`, `volume` and `time`. Use functions defined
at the top level of an `init python` block (not lambdas), so saves can store them.

**`update_function`** is called every frame before the pose is computed, with the character's
runtime and the time, to override bones or change what plays (like Live2D's `update_function`):

```renpy
init python:
    def sway(rt, t):
        import math
        head = rt.sk.find_bone("head")
        rt.pose.set_bone(head, rotation=rt.sk.bones[head].setup[2] + 3 * math.sin(t))

image nila = Rigby("images/nila", update_function=sway)
```

`rt.pose` and `rt.state` are the `rigby2d` runtime's `Pose` and `AnimationState`; see below.

## The Python runtime

`game/rigby2d/` is a complete Rigby2D runtime in pure Python, usable outside Ren'Py too:

```python
from rigby2d import load_skeleton, Atlas, Pose, AnimationState, RegionLookup, RenderOutput

sk = load_skeleton(open("nila.json", "rb").read())
pose, state = Pose(sk), AnimationState(sk)
state.set_animation(0, "idle", True)
state.set_animation(1, "happy", True, 0.2)    # a layer over it

state.update(1 / 60)                          # every frame
state.apply(pose)
for e in state.drain_events(): ...
batches = RenderOutput().build(pose, RegionLookup(sk, Atlas.parse(atlas_text)))
```

It reads skeleton JSON 3.8, 4.2 and 4.3 and evaluates everything the other runtimes do: every
inherit mode, region and mesh attachments with weights and deform keys, linked meshes, IK (one and
two bones, softness, stretch), transform, path, physics and slider constraints (so 2.5D turns
play), skins, image sequences, clipping, draw order, two-color tint, events, and tracks with
crossfades and queues. It is a port of the Rust runtime and is tested against the JavaScript
reference frame by frame, like the Rust, C++ and C# runtimes: on NILA, Rigbytron, the turn rig and
synthetic rigs that use every feature (in formats 3.8, 4.2 and 4.3), bone transforms match within
1e-10 and the drawn geometry, clipping included, within 1e-12.

**Speed:** NILA (39 bones, 42 slots, six physics constraints, 986 mesh vertices) takes about 0.2 ms
to animate and 0.6 ms to build its geometry per frame on a desktop CPU, so several characters on
screen at 60 fps cost a few milliseconds.

## Tests

```bash
python3 -m unittest discover -s runtimes/renpy/tests          # golden, geometry and feature tests
runtimes/renpy/tests/renpy_smoke/run_smoke.sh ~/renpy-8.6.0-sdk   # the demo in a real Ren'Py (xvfb)
```

`node runtimes/renpy/tests/make_golden.mjs` records the reference data from the JavaScript runtime
(add `--large <dir>` for NILA and the demo scene's characters too, then run the tests with
`RIGBY_GOLDEN_DIR=<dir>`). The smoke test plays the demo characters in Ren'Py under a virtual display
(attributes, crossfades, lip-sync with and without voice, blinks, gaze, save and load) and writes
screenshots and a log.

## Limits

- Binary `.skel` files are not read: export skeleton JSON.
- Scenes (`.scene.json`) are not played yet: show each character as its own image.
- Needs model-based rendering, which is on by default in Ren'Py 8.
