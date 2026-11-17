# SPDX-License-Identifier: MIT OR Apache-2.0
# Smoke test run inside Ren'Py by run_smoke.sh: plays the demo characters through attributes,
# crossfades, lip-sync (from the say statement, with and without a voice), blinks and gaze,
# takes screenshots and writes a log of what each character showed, then quits.

image nila_flat = Rigby("images/nila", height=1.25, flatten=True)

init python:
    import json, os
    _rigby_log = []
    _rigby_out = os.environ.get("RIGBY_SMOKE_OUT", "/tmp/rigby_smoke")

    def rigby_probe(label):
        rows = {}
        for key, rt in rigby._runtimes.items():
            if key[0] == "_unique":
                continue
            c = rt.common
            entry = {
                "tracks": [None if e is None else [rt.sk.animations[e.animation].name, round(e.alpha, 3), round(e.time, 3)] for e in rt.state.tracks],
                "speaking": rt.speech is not None,
                "voice": (rt.speech or {}).get("voice"),
                "skin": rt.pose.skin,
                "look": [round(v, 3) for v in rt.look],
            }
            if c.mouth_slot is not None:
                entry["mouth"] = rt.pose.attachment[c.mouth_slot]
            if c.blink is not None and c.blink[0] == "slots":
                entry["eyes"] = {rt.sk.slots[s].name: rt.pose.attachment[s] for s in c.blink[1]}
            rows[key[1]] = entry
        _rigby_log.append({"label": label, "time": round(renpy.display.interface.frame_time, 3), "rigs": rows})

    def rigby_shot(name):
        renpy.screenshot(os.path.join(_rigby_out, name + ".png"))

    def rigby_sampler(st, at):
        return None

    config.periodic_callbacks.append(lambda: rigby_probe("tick"))

label main_menu:
    return

label start:
    $ _preferences.text_cps = 40
    scene expression Solid("#20242c")
    show nila idle at stand(0.5)
    $ renpy.pause(1.2, hard=True)
    $ rigby_probe("idle")
    $ rigby_shot("01-idle")

    # Dialogue with a voice line: auto-advances after 2.5 seconds.
    voice "voice/hello.mp3"
    n "Hi! I'm Nila, and I'm made of layers.{w=2.5}{nw}"
    $ rigby_probe("after-hello")

    # Dialogue without a voice: the mouth follows the typing.
    n "Need an expression? This line has no voice, so the text drives the mouth.{w=0.6}{nw}"

    show nila wave happy
    $ renpy.pause(0.9, hard=True)
    $ rigby_probe("wave-happy")
    $ rigby_shot("02-wave-happy")

    show nila surprised
    $ renpy.pause(0.6, hard=True)
    $ rigby_probe("surprised")
    $ renpy.pause(1.4, hard=True)
    $ rigby_probe("after-wave")

    show nila idle -surprised
    show rigbytron hold at robot(0.85)
    $ renpy.pause(1.0, hard=True)
    $ rigby_probe("both")
    $ rigby_shot("03-both")

    $ rigby.look("nila", (1.0, 0.6))
    $ renpy.pause(0.8, hard=True)
    $ rigby_probe("look")
    $ rigby_shot("04-look")
    $ rigby.say("nila", "Lovely, isn't it?")
    $ renpy.pause(0.35, hard=True)
    $ rigby_probe("say-api")
    $ rigby_shot("05-say")
    $ renpy.pause(3.0, hard=True)
    $ rigby_probe("end")

    # Ren'Py transforms and transitions on a Rigby image.
    show nila idle at stand(0.35), Transform(xzoom=-1.0, alpha=0.6, zoom=0.8, matrixcolor=TintMatrix("#ffb0b0"))
    show nila_flat wave at stand(0.75), Transform(alpha=0.6, zoom=0.8)
    with dissolve
    $ renpy.pause(0.3, hard=True)
    $ rigby_shot("07-transforms")
    hide nila_flat
    show nila idle at stand(0.5)

    # Say attributes, then saving and loading with characters on screen.
    n surprised "Oh!{w=0.4}{nw}"
    $ rigby_probe("say-attribute")
    $ renpy.save("1-1", "rigby smoke test")
    if not persistent.rigby_smoke_loaded:
        $ persistent.rigby_smoke_loaded = True
        $ renpy.load("1-1")
    $ renpy.pause(0.8, hard=True)
    $ rigby_probe("after-load")
    $ rigby_shot("06-after-load")

    python:
        with open(os.path.join(_rigby_out, "log.json"), "w") as f:
            json.dump(_rigby_log, f)
    $ renpy.quit()
