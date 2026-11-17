# SPDX-License-Identifier: MIT OR Apache-2.0
#
# Rigby2D for Ren'Py: skeletal characters with crossfading animations, image attributes, automatic
# lip-sync from dialogue and voice, natural blinking, gaze and physics, in pure Python. Copy this
# file and the `rigby2d` folder into your game's `game` folder. Needs Ren'Py 8.3 or newer.
#
#     image nila = Rigby("images/nila")          # images/nila/nila.json + nila.atlas + nila.png
#     define n = Character("Nila", image="nila")  # lip-sync happens on its own
#
#     show nila idle
#     n "Hi! I'm Nila."                           # her mouth follows the words (and her voice)
#     show nila wave happy                        # crossfades to waving, with a happy face
#
# See README.md for the guide.

init -1500 python in rigby:

    import array
    import math
    import random

    import rigby2d as _core
    from rigby2d import lipsync as _lipsync
    from rigby2d import features as _features
    from rigby2d.mathx import inverse as _inverse

    from renpy.store import config

    VERSION = _core.VERSION

    # ---- shader ----------------------------------------------------------------------------------
    # Two-color tint, as the reference renderer: texture color c becomes light * c + dark * (1 - c).
    # Ren'Py textures are premultiplied, and so is the output.

    _TINT_SHADER = dict(variables="""
        attribute vec4 a_rigby_light;
        attribute vec4 a_rigby_dark;
        varying vec4 v_rigby_light;
        varying vec4 v_rigby_dark;
    """, vertex_300="""
        v_rigby_light = a_rigby_light;
        v_rigby_dark = a_rigby_dark;
    """, fragment_300="""
        vec4 rigby_t = gl_FragColor;
        vec3 rigby_c = rigby_t.a > 0.0 ? rigby_t.rgb / rigby_t.a : vec3(0.0);
        float rigby_a = rigby_t.a * v_rigby_light.a;
        vec3 rigby_rgb = rigby_c * v_rigby_light.rgb + (1.0 - rigby_c) * v_rigby_dark.rgb * v_rigby_dark.a;
        gl_FragColor = vec4(rigby_rgb * rigby_a, rigby_a);
    """)

    try:
        # Ren'Py 8.6 and newer: say which GLSL dialect this is written in.
        renpy.register_shader("rigby2d.tint", glsl=100, **_TINT_SHADER)
    except Exception:
        renpy.register_shader("rigby2d.tint", **_TINT_SHADER)

    _layout = None

    def _mesh_layout():
        global _layout
        if _layout is None:
            from renpy.gl2.gl2mesh import AttributeLayout
            _layout = AttributeLayout()
            _layout.add_attribute("a_tex_coord", 2)
            _layout.add_attribute("a_rigby_light", 4)
            _layout.add_attribute("a_rigby_dark", 4)
        return _layout

    # GL blend functions (premultiplied) by slot blend mode.
    _GL_FUNC_ADD = 0x8006
    _GL_ONE = 1
    _GL_ONE_MINUS_SRC_COLOR = 0x0301
    _GL_ONE_MINUS_SRC_ALPHA = 0x0303

    def _blend_func(mode):
        if mode == "additive":
            return config.gl_blend_func["add"]
        if mode == "multiply":
            return config.gl_blend_func["multiply"]
        if mode == "screen":
            return (_GL_FUNC_ADD, _GL_ONE, _GL_ONE_MINUS_SRC_COLOR, _GL_FUNC_ADD, _GL_ONE, _GL_ONE_MINUS_SRC_ALPHA)
        return config.gl_blend_func["normal"]

    # Tracks used by the integration: 0 motions, 1 expressions, then overlays; these are reserved.
    TRACK_EXPRESSION = 1
    TRACK_OVERLAY = 2
    TRACK_TALK = 30
    TRACK_BLINK = 31

    # ---- files -----------------------------------------------------------------------------------

    def expand_filename(filename):
        """The skeleton JSON for `filename`: a .json file, or a folder holding <folder name>.json."""
        if filename.endswith(".json"):
            return filename
        filename = filename.rstrip("/")
        return filename + "/" + filename.rpartition("/")[2] + ".json"

    def _read_text(path):
        f = renpy.open_file(path)
        try:
            data = f.read()
        finally:
            f.close()
        if isinstance(data, bytes):
            data = data.decode("utf-8")
        return data

    class Common(object):
        """What every displayable showing the same skeleton shares (loaded once, never saved)."""

        def __init__(self, filename, atlas):
            self.filename = filename
            self.base = filename.rpartition("/")[0]
            if self.base:
                self.base += "/"
            if not renpy.loadable(filename):
                raise Exception("Rigby2D skeleton {} was not found.".format(filename))
            self.sk = _core.load_skeleton_text(_read_text(filename))
            atlas = atlas or filename[:-len(".json")] + ".atlas"
            if not renpy.loadable(atlas):
                raise Exception("Rigby2D atlas {} was not found (export the skeleton with its atlas).".format(atlas))
            self.atlas = _core.Atlas.parse(_read_text(atlas))
            atlas_base = atlas.rpartition("/")[0]
            atlas_base = atlas_base + "/" if atlas_base else ""
            self.lookup = _core.RegionLookup(self.sk, self.atlas)
            missing = self.lookup.missing(self.sk)
            if missing:
                renpy.display.log.write("Rigby2D: {} uses images that are not in its atlas: {}".format(filename, ", ".join(missing[:10])))
            self.textures = []
            for page in self.atlas.pages:
                path = atlas_base + page.name
                d = renpy.displayable(path)
                try:
                    d = renpy.display.im.unoptimized_texture(d, premultiply=not page.pma)
                except TypeError:
                    d = renpy.display.im.unoptimized_texture(d)
                self.textures.append(d)
            sk = self.sk
            self.animations = [a.name for a in sk.animations]
            self.skins = [s.name for s in sk.skins if s.name != "default"]
            self.mouth_slot, self.mouths = self._find_mouth()
            self.blink = self._find_blink()
            self.turn = self._find_turn()
            self.pupils = self._find_pupils()
            self.voice_cache = {}

        # -- automatic rig features (see rigby2d/features.py) ----------------------------------------

        def attachment_names(self, slot):
            return _features.attachment_names(self.sk, slot)

        def _find_mouth(self, slot_name=None):
            return _features.find_mouth(self.sk, slot_name)

        def _find_blink(self):
            return _features.find_blink(self.sk)

        def _find_turn(self):
            return _features.find_turn(self.sk)

        def _find_pupils(self):
            return _features.find_pupils(self.sk)

        def lipsync_for_voice(self, voice):
            """Mouth cues from the timing file next to a voice file, or None."""
            if voice in self.voice_cache:
                return self.voice_cache[voice]
            track = None
            stem = voice.rpartition(".")[0] if "." in voice.rpartition("/")[2] else voice
            for ext in (".lipsync.json", ".lipsync.txt", ".json", ".txt", ".dat", ".tsv"):
                path = stem + ext
                if renpy.loadable(path):
                    try:
                        track = _lipsync.Track.from_timing(_read_text(path))
                        break
                    except Exception as e:
                        renpy.display.log.write("Rigby2D: could not read lip-sync timing {}: {}".format(path, e))
            self.voice_cache[voice] = track
            return track

    _commons = {}

    def get_common(filename, atlas=None):
        key = (filename, atlas)
        rv = _commons.get(key)
        if rv is None:
            rv = _commons[key] = Common(filename, atlas)
        return rv

    # ---- runtimes (live state, never saved) ----------------------------------------------------

    # Runtime by key: (layer, tag, filename, index) for shown images, ("_unique", id) otherwise.
    _runtimes = {}
    # The displayable each key showed at the latest interaction.
    _owners = {}

    class Runtime(object):
        """A playing character: pose, animation state, lip-sync, blinks and gaze."""

        def __init__(self, common, owner):
            self.common = common
            self.sk = common.sk
            self.pose = _core.Pose(self.sk)
            self.state = _core.AnimationState(self.sk)
            self.output = _core.RenderOutput()
            self.owner = None
            self.frame_time = None
            self.motions = None
            self.expression = None
            self.overlays = {}
            self.fades = {}
            self.speech = None
            self.blink_at = random.uniform(1.0, 4.0)
            self.blink_until = None
            self.look_target = None
            self.look = [0.0, 0.0]
            self.mouse = None
            self.adopt(owner, first=True)

        # -- attributes ---------------------------------------------------------------------------

        def adopt(self, d, first=False):
            """Plays what displayable `d` asks for: its motions, expression, overlays and skin."""
            self.owner = d
            mix = 0.0 if first else d.mix
            state = self.state
            sk = self.sk
            motions = list(d.motions) if d.motions else []
            if not motions and self.motions is None:
                motions = [d.default_motion] if d.default_motion else []
            # The same looping motion keeps playing; anything else (re)starts. A motion listed in
            # `once` plays once, then the default motion comes back.
            last = motions[-1] if motions else None
            last_loops = d.loop and last not in d.once
            current = state.current(0)
            playing = None
            if current is not None and current.looping and not current.queue:
                playing = [sk.animations[current.animation].name]
            same = last_loops and (motions == self.motions or motions == playing)
            if motions and (not d.sustain or self.motions is None) and not same:
                for i, name in enumerate(motions):
                    final = i == len(motions) - 1
                    loop = final and last_loops
                    if i == 0:
                        state.set_animation(0, name, loop, mix)
                    else:
                        state.add_animation(0, name, loop, d.mix, None)
                if not last_loops and d.loop and d.default_motion and last != d.default_motion:
                    state.add_animation(0, d.default_motion, True, d.mix, None)
                self.motions = motions
            # Expression: an exclusive layer on track 1.
            if d.expression != self.expression:
                if d.expression is not None:
                    if self.expression is None:
                        e = state.set_animation(TRACK_EXPRESSION, d.expression, True, 0.0)
                        self._fade(TRACK_EXPRESSION, 0.0, 1.0, mix)
                    else:
                        state.set_animation(TRACK_EXPRESSION, d.expression, True, mix)
                        self.fades.pop(TRACK_EXPRESSION, None)
                        e = state.current(TRACK_EXPRESSION)
                        if e is not None:
                            e.alpha = 1.0
                else:
                    self._fade(TRACK_EXPRESSION, None, 0.0, mix)
                self.expression = d.expression
            # Overlays: one track each, faded in and out.
            wanted = set(d.overlays or ())
            for name in list(self.overlays):
                if name not in wanted:
                    self._fade(self.overlays.pop(name), None, 0.0, mix)
            for name in wanted:
                if name in self.overlays:
                    continue
                track = d.common_track(name)
                state.set_animation(track, name, True, 0.0)
                self._fade(track, 0.0, 1.0, mix)
                self.overlays[name] = track
            if d.skin is not None:
                self.pose.skin = sk.find_skin(d.skin)
            elif first:
                self.pose.skin = None

        def _fade(self, track, start, end, duration):
            e = self.state.current(track)
            if e is None:
                return
            if start is None:
                start = e.alpha
            if duration <= 0.0:
                e.alpha = end
                if end <= 0.0:
                    self.state.clear_track(track)
                self.fades.pop(track, None)
                return
            e.alpha = start
            self.fades[track] = (start, end, duration, 0.0)

        def _update_fades(self, dt):
            for track, (start, end, duration, t) in list(self.fades.items()):
                t += dt
                e = self.state.current(track)
                if e is None:
                    del self.fades[track]
                    continue
                f = min(t / duration, 1.0)
                e.alpha = start + (end - start) * f
                if f >= 1.0:
                    del self.fades[track]
                    if end <= 0.0:
                        self.state.clear_track(track)
                else:
                    self.fades[track] = (start, end, duration, t)

        # -- speech --------------------------------------------------------------------------------

        def speak(self, text, start_time):
            self.speech = {"text": text, "start": start_time, "track": None, "voice": None, "done": False, "stop_at": None}

        def stop_speaking(self, when=None):
            if self.speech is not None:
                if when is None:
                    self.speech = None
                else:
                    self.speech["stop_at"] = when

        def _speech_viseme(self, now):
            """The mouth shape being spoken now, or None when not speaking."""
            s = self.speech
            if s is None:
                return None
            voice = None
            pos = None
            try:
                if renpy.music.is_playing("voice"):
                    voice = renpy.music.get_playing("voice")
                    pos = renpy.music.get_pos("voice")
            except Exception:
                voice = None
            if voice is not None:
                if s["voice"] != voice:
                    s["voice"] = voice
                    track = self.common.lipsync_for_voice(voice)
                    if track is None:
                        duration = None
                        try:
                            duration = renpy.music.get_duration("voice")
                        except Exception:
                            pass
                        track = _lipsync.Track.from_text(s["text"], duration=duration or None)
                    s["track"] = track
                if pos is None:
                    return "rest"
                return s["track"].viseme_at(pos)
            if s["voice"] is not None:
                # The voice line ended.
                self.speech = None
                return None
            if s["track"] is None:
                cps = renpy.game.preferences.text_cps or 0
                s["track"] = _lipsync.Track.from_text(s["text"], cps=cps if cps > 0 else 14.0)
            t = now - s["start"]
            if s["stop_at"] is not None and now >= s["stop_at"]:
                self.speech = None
                return None
            if t > s["track"].end + 0.1:
                self.speech = None
                return None
            return s["track"].viseme_at(t)

        # -- gaze ---------------------------------------------------------------------------------

        def _gaze_goal(self, d):
            target = self.look_target if self.look_target is not None else d.look
            if target is None:
                return (0.0, 0.0)
            if target == "mouse":
                if self.mouse is None or d.size is None or d.transform is None:
                    return (0.0, 0.0)
                mx, my = self.mouse
                ex, ey = self._eye_point(d)
                w, h = d.size
                sw = float(config.screen_width)
                return (max(-1.0, min(1.0, (mx - ex) / (sw * 0.4))), max(-1.0, min(1.0, -(my - ey) / (sw * 0.3))))
            return (max(-1.0, min(1.0, float(target[0]))), max(-1.0, min(1.0, float(target[1]))))

        def _eye_point(self, d):
            """Where the eyes are, in the displayable's pixels."""
            pose = self.pose
            sk = self.sk
            bone = None
            if self.common.pupils:
                bone = self.common.pupils[0][0]
            else:
                bone = sk.find_bone("head")
            if bone is None:
                return (d.size[0] / 2.0, d.size[1] * 0.2)
            m = pose.world[bone]
            sx, ox, sy, oy = d.transform
            return (m[4] * sx + ox, m[5] * sy + oy)

        def _apply_gaze(self, d, dt):
            gx, gy = self._gaze_goal(d)
            k = 1.0 - math.exp(-dt * 8.0)
            self.look[0] += (gx - self.look[0]) * k
            self.look[1] += (gy - self.look[1]) * k
            lx, ly = self.look
            if abs(lx) < 1e-4 and abs(ly) < 1e-4:
                self.pose.clear_bone(self.common.turn["bone"] if self.common.turn else -1)
                return False
            turn = self.common.turn
            if turn is not None:
                x, y = _features.turn_control(self.sk, self.pose, turn, lx, ly)
                self.pose.set_bone(turn["bone"], x=x, y=y)
            return True

        def _apply_pupils(self):
            lx, ly = self.look
            if abs(lx) < 1e-4 and abs(ly) < 1e-4:
                return
            pose = self.pose
            desired = []
            for bone, reach in self.common.pupils:
                a, b, c, d_, tx, ty = pose.world[bone]
                desired.append((bone, (a, b, c, d_, tx + lx * reach, ty + ly * reach)))
            if desired:
                pose._set_worlds(desired)

        # -- blinking -----------------------------------------------------------------------------

        def _apply_blink(self, d, now):
            blink = self.common.blink
            if blink is None or not d.blink:
                return False
            if self.blink_until is not None:
                if now >= self.blink_until:
                    self.blink_until = None
                    self.blink_at = now + random.uniform(2.5, 6.0) * (0.4 if random.random() < 0.15 else 1.0)
                elif blink[0] == "slots":
                    for slot, image in blink[1].items():
                        self.pose.attachment[slot] = image
                return True
            if self.blink_at is None or now < self.blink_at:
                return True
            kind, value = blink
            if kind == "animation":
                if self.state.current(TRACK_BLINK) is None:
                    self.state.set_animation(TRACK_BLINK, value, False, 0.0)
                anim = self.sk.animations[self.sk.find_animation(value)]
                self.blink_until = now + max(anim.duration, 0.05)
            else:
                # Blink only when the eyes are open (an expression may have closed them).
                for slot, image in value.items():
                    if image is not None and self.pose.attachment[slot] is not None and self.pose.attachment[slot] != image:
                        self.blink_at = now + 0.5
                        return True
                self.blink_until = now + random.uniform(0.09, 0.14)
            return True

        # -- frame --------------------------------------------------------------------------------

        def advance(self, d, now):
            """Advances to frame time `now` (once per frame, whichever displayable renders first)."""
            if self.frame_time == now:
                return
            dt = 0.0 if self.frame_time is None else min(max(now - self.frame_time, 0.0), 0.1)
            self.frame_time = now
            # The settings of the displayable shown last (during a transition, the old one may draw first).
            if self.owner is not None:
                d = self.owner
            self.state.speed = d.speed
            self._update_fades(dt)
            if self.common.blink is not None and self.common.blink[0] == "animation":
                if self.state.current(TRACK_BLINK) is not None and self.state.is_complete(TRACK_BLINK):
                    self.state.clear_track(TRACK_BLINK)
            # Talking without mouth shapes: a "talk" animation plays while the character speaks.
            viseme = self._speech_viseme(now) if d.lipsync else None
            if self.common.mouths is None and d.talk is not None:
                talking = self.state.current(TRACK_TALK)
                if viseme is not None and talking is None:
                    self.state.set_animation(TRACK_TALK, d.talk, True, 0.0)
                    self._fade(TRACK_TALK, 0.0, 1.0, 0.1)
                elif viseme is None and talking is not None and TRACK_TALK not in self.fades:
                    self._fade(TRACK_TALK, None, 0.0, 0.15)
            self.state.update(dt)
            looking = self._apply_gaze(d, dt)
            if d.update_function is not None:
                d.update_function(self, now)
            if d.physics is False:
                self.pose.reset_physics()
                self.state.physics_delta = 0.0
            self.state.apply(self.pose)
            if looking and self.common.pupils:
                self._apply_pupils()
            self._apply_blink(d, now)
            if viseme is not None and self.common.mouths is not None:
                image = self.common.mouths.get(viseme) or self.common.mouths.get("rest")
                if image is not None:
                    self.pose.attachment[self.common.mouth_slot] = image
            for e in self.state.drain_events():
                if e.kind == _core.EVENT:
                    d.on_animation_event(self, e.event)

        def geometry(self, d):
            return self.output.build(self.pose, self.common.lookup, d.tint, d.transform)

    def _all_layer_tags(sls):
        if hasattr(sls, "get_all_layer_tag_displayable"):
            for rv in sls.get_all_layer_tag_displayable():
                yield rv
            return
        for layer, entries in sls.layers.items():
            for sle in entries:
                if sle.tag is not None and sle.displayable is not None:
                    yield layer, sle.tag, sle.displayable

    def _assign_keys():
        """Names every Rigby displayable shown under a tag, so a character keeps playing (and
        crossfades) when `show` changes its attributes."""
        global _showing
        if not _showing:
            return
        _showing = False
        try:
            sls = renpy.display.scenelists.scene_lists()
        except Exception:
            return
        seen = set()
        for layer, tag, d in _all_layer_tags(sls):
            if tag is None or "$" in tag:
                continue
            counts = {}

            def visit(x):
                if isinstance(x, Rigby):
                    i = counts.get(x.filename, 0)
                    counts[x.filename] = i + 1
                    key = (layer, tag, x.filename, i)
                    x._key = key
                    _owners[key] = x
                    seen.add(key)

            d.visit_all(visit)
        for key in list(_owners):
            if key not in seen:
                del _owners[key]
        # Forget characters that are no longer shown (after a few seconds, so a quick hide and
        # show, or a transition, keeps them playing).
        now = renpy.display.interface.frame_time
        for key, rt in list(_runtimes.items()):
            if key not in seen and (rt.frame_time is None or now - rt.frame_time > 5.0):
                del _runtimes[key]

    _showing = False

    config.start_interact_callbacks.append(_assign_keys)

    def _runtimes_for_tag(tag, layer=None):
        return [rt for key, rt in _runtimes.items() if key[0] != "_unique" and key[1] == tag and (layer is None or key[0] == layer)]

    # ---- the displayable ---------------------------------------------------------------------

    class Rigby(renpy.Displayable):
        """A Rigby2D skeleton.

        `filename`
            The skeleton JSON, or a folder holding <folder name>.json, .atlas and the atlas pages.
        `zoom`
            Scale of the skeleton's pixels. When None, it is sized so its setup pose is `height`
            (a fraction of the screen height) tall.
        `animation`
            What plays when no motion attribute is given (default: "idle", else the first animation).
        `expressions`
            Animations that are faces: one at a time, layered over the motions (track 1).
        `overlays`
            Animations layered over everything that can be combined freely (one track each).
        `mix`
            Crossfade time in seconds between motions, expressions and overlays.
        `once`
            Motions that play once and then return to the default motion (a wave, a bow).
        `update_function`
            A function called with (runtime, time) every frame before the pose is computed, to
            override bones (runtime.pose.set_bone) or change the animation state (runtime.state).
        `lipsync`, `blink`, `look`, `physics`
            Lip-sync while the character speaks, natural blinks, gaze ("mouse", an (x, y) from -1
            to 1, or None) and physics constraints.
        `mouth`, `visemes`, `talk`
            The mouth slot and {mouth shape: image} for lip-sync (found by name when not given), and
            an animation to play while talking for rigs without mouth shapes.
        `flatten`
            Draw the character into one texture first, so `alpha` fades it as a whole.
        `on_event`
            A function called with (tag, event) for every event key that plays.
        `event_sounds`
            Play the audio file of events that have one, on `sound_channel`.
        """

        _duplicatable = True
        _key = None
        nosave = ["_key"]
        # Set by render: skeleton units to pixels (sx, ox, sy, oy), and the size in pixels.
        transform = None
        size = None

        def __init__(self, filename, zoom=None, height=1.0, animation=None, expressions=(), overlays=(), mix=0.25,
                     loop=True, speed=1.0, skin=None, lipsync=True, blink=True, look=None, physics=True, mouth=None,
                     visemes=None, talk=None, tint=(1.0, 1.0, 1.0, 1.0), atlas=None, on_event=None, event_sounds=False,
                     sound_channel="sound", sound_prefix="", once=(), update_function=None, flatten=False, motions=None, expression=None,
                     used_overlays=None, sustain=False, **properties):
            super(Rigby, self).__init__(**properties)
            self.filename = expand_filename(filename)
            self.atlas = atlas
            self.zoom = zoom
            self.height = height
            self.animation = animation
            self.expressions = tuple(expressions or ())
            self.overlay_names = tuple(overlays or ())
            self.mix = mix
            self.loop = loop
            self.speed = speed
            self.skin = skin
            self.lipsync = lipsync
            self.blink = blink
            self.look = look
            self.physics = physics
            self.mouth = mouth
            self.visemes = visemes
            self.talk_name = talk
            self.tint = tuple(tint)
            self.on_event = on_event
            self.event_sounds = event_sounds
            self.sound_channel = sound_channel
            self.sound_prefix = sound_prefix
            self.once = tuple(once or ())
            self.update_function = update_function
            self.flatten = flatten
            self.motions = motions
            self.expression = expression
            self.overlays = used_overlays
            self.sustain = sustain
            self.properties = properties
            common = self.common
            for name in self.expressions + self.overlay_names + self.once + ((animation,) if animation else ()) + ((talk,) if talk else ()):
                if name not in common.animations:
                    raise Exception("Rigby2D skeleton {} has no animation {!r}.".format(self.filename, name))
            if mouth is not None or visemes is not None:
                slot, mouths = common._find_mouth(mouth)
                if visemes is not None:
                    mouths = dict(mouths or {})
                    mouths.update(visemes)
                    if slot is None and mouth is not None:
                        slot = common.sk.find_slot(mouth)
                common.mouth_slot, common.mouths = slot, mouths

        @property
        def common(self):
            return get_common(self.filename, self.atlas)

        @property
        def default_motion(self):
            if self.animation:
                return self.animation
            names = self.common.animations
            special = set(self.expressions) | set(self.overlay_names) | {"blink", self.talk_name}
            if "idle" in names:
                return "idle"
            for n in names:
                if n not in special:
                    return n
            return None

        @property
        def talk(self):
            if self.talk_name is not None:
                return self.talk_name
            return "talk" if "talk" in self.common.animations else None

        def common_track(self, name):
            return TRACK_OVERLAY + self.overlay_names.index(name) if name in self.overlay_names else TRACK_OVERLAY

        # -- attributes ---------------------------------------------------------------------------

        def _kinds(self):
            common = self.common
            reserved = {"blink", self.talk}
            expressions = set(self.expressions)
            overlays = set(self.overlay_names)
            motions = set(n for n in common.animations if n not in expressions and n not in overlays and n not in reserved)
            return motions, expressions, overlays, set(common.skins)

        def _duplicate(self, args):
            if not self._duplicatable or not args or not args.args:
                return self
            motions, expressions, overlays, skins = self._kinds()
            attributes = list(args.args)
            sustain = "_sustain" in attributes
            attributes = [a for a in attributes if a != "_sustain"]
            used_motions = []
            expression = None
            used_overlays = []
            skin = self.skin
            for a in attributes:
                if a in motions:
                    used_motions.append(a)
                elif a in expressions:
                    if expression is not None:
                        raise Exception("When showing {}, {} and {} are both expressions.".format(" ".join(args.name), a, expression))
                    expression = a
                elif a in overlays:
                    used_overlays.append(a)
                elif a in skins:
                    skin = a
                else:
                    raise Exception("When showing {}, {} is not an animation or skin of {}.".format(" ".join(args.name), a, self.filename))
            rv = Rigby(self.filename, zoom=self.zoom, height=self.height, animation=self.animation, expressions=self.expressions,
                       overlays=self.overlay_names, mix=self.mix, loop=self.loop, speed=self.speed, skin=skin, lipsync=self.lipsync,
                       blink=self.blink, look=self.look, physics=self.physics, mouth=self.mouth, visemes=self.visemes,
                       talk=self.talk_name, tint=self.tint, atlas=self.atlas, on_event=self.on_event, event_sounds=self.event_sounds,
                       sound_channel=self.sound_channel, sound_prefix=self.sound_prefix, once=self.once,
                       update_function=self.update_function, flatten=self.flatten, motions=used_motions,
                       expression=expression, used_overlays=used_overlays, sustain=sustain, **self.properties)
            rv._duplicatable = False
            return rv

        def _list_attributes(self, tag, attributes):
            motions, expressions, overlays, skins = self._kinds()
            available = motions | expressions | overlays | skins
            if any(a in expressions for a in attributes):
                available -= expressions
            if any(a in skins for a in attributes):
                available -= skins
            available |= set(attributes)
            order = self.common.animations + self.common.skins
            return [a for a in order if a in available]

        def _choose_attributes(self, tag, attributes, optional):
            attributes = [a for a in attributes if a != "_sustain"]
            motions, expressions, overlays, skins = self._kinds()
            rv = [a for a in attributes if a in motions]
            for a in list(attributes) + list(optional):
                if a in expressions:
                    rv.insert(0, a)
                    break
            for a in list(attributes) + list(optional):
                if a in skins:
                    rv.append(a)
                    break
            for a in sorted(attributes):
                if a in overlays and a not in rv:
                    rv.append(a)
            for a in sorted(optional):
                if a in overlays and a not in rv:
                    rv.append(a)
            if set(attributes) - set(rv):
                return None
            if not any(a in motions for a in rv):
                rv = ["_sustain"] + [a for a in optional if a in motions] + rv
            return tuple(rv)

        # -- rendering ----------------------------------------------------------------------------

        def per_interact(self):
            global _showing
            _showing = True

        def visit(self):
            return list(self.common.textures)

        def _zoom(self):
            if self.zoom is not None:
                return float(self.zoom)
            sk = self.common.sk
            return float(self.height) * config.screen_height / max(sk.height, 1.0)

        def _runtime(self):
            global _showing
            _showing = True
            unique = ("_unique", id(self))
            key = self._key or unique
            rt = _runtimes.get(key)
            if rt is None and key is not unique and unique in _runtimes:
                # Shown before its tag was known (the first interaction): keep playing, under the tag.
                rt = _runtimes[key] = _runtimes.pop(unique)
            now = renpy.display.interface.frame_time
            owner = _owners.get(key, self)
            if rt is None or rt.common is not self.common:
                rt = _runtimes[key] = Runtime(self.common, self)
            elif owner is self and rt.owner is not self:
                rt.adopt(self)
            return rt, now

        def render(self, width, height, st, at):
            from renpy.gl2.gl2mesh2 import Mesh2
            common = self.common
            sk = common.sk
            zoom = self._zoom()
            w = max(sk.width * zoom, 1.0)
            h = max(sk.height * zoom, 1.0)
            # Skeleton units (Y up) to this displayable's pixels (Y down): the setup bounds fill it.
            self.transform = (zoom, -sk.x * zoom, -zoom, (sk.y + sk.height) * zoom)
            self.size = (w, h)
            rt, now = self._runtime()
            rt.advance(self, now)
            textures = [renpy.display.im.render_for_texture(t, width, height, st, at) for t in common.textures]
            rv = renpy.Render(w, h)
            batches = [b for b in rt.geometry(self) if b.indices]
            target, ox, oy, tw, th = rv, 0.0, 0.0, w, h
            if self.flatten and batches:
                # Draw into one texture, sized to where the character is this frame, so `alpha`
                # fades it as a whole (overlapping parts don't show through each other).
                xs = [p for b in batches for p in b.points[0::2]]
                ys = [p for b in batches for p in b.points[1::2]]
                ox = math.floor(min(xs)) - 2.0
                oy = math.floor(min(ys)) - 2.0
                tw = math.ceil(max(xs)) + 2.0 - ox
                th = math.ceil(max(ys)) + 2.0 - oy
                target = renpy.Render(tw, th)
                target.mesh = True
                target.add_shader("renpy.texture")
            layout = _mesh_layout()
            for b in batches:
                points = b.points
                if ox or oy:
                    points = [v - (ox if i % 2 == 0 else oy) for i, v in enumerate(points)]
                mesh = Mesh2(layout, len(points) // 2, len(b.indices) // 3)
                mesh.set_geometry_data(array.array("f", points))
                mesh.set_attribute_data(array.array("f", b.attributes))
                mesh.set_triangle_data(array.array("I", b.indices))
                r = renpy.Render(tw, th)
                r.mesh = mesh
                r.add_shader("renpy.texture")
                r.add_shader("rigby2d.tint")
                r.add_property("blend_func", _blend_func(b.blend))
                r.blit(textures[b.page], (0, 0))
                target.blit(r, (0, 0))
            if target is not rv:
                rv.blit(target, (ox, oy))
            renpy.redraw(self, 0)
            return rv

        def event(self, ev, x, y, st):
            rt = _runtimes.get(self._key or ("_unique", id(self)))
            if rt is not None:
                rt.mouse = (x, y)
            return None

        def on_animation_event(self, rt, event):
            if self.event_sounds and event.audio:
                renpy.sound.play(self.sound_prefix + event.audio, channel=self.sound_channel, relative_volume=event.volume)
            if self.on_event is not None:
                key = self._key
                self.on_event(key[1] if key and key[0] != "_unique" else None, event)

    # ---- lip-sync from dialogue -----------------------------------------------------------------

    def _speaker_tag():
        try:
            return renpy.get_say_image_tag()
        except Exception:
            return None

    def _say_callback(event, interact=True, **kwargs):
        """Added to config.all_character_callbacks: makes the speaking character's Rigby image
        move its mouth with the line (any Character with image="tag")."""
        tag = _speaker_tag()
        if tag is None:
            return
        _drive_speech(tag, event, **kwargs)

    def _drive_speech(tag, event, **kwargs):
        runtimes = _runtimes_for_tag(tag)
        if not runtimes:
            return
        now = renpy.display.interface.frame_time
        if event in ("show", "begin"):
            what = kwargs.get("what") or ""
            start = kwargs.get("start")
            end = kwargs.get("end")
            if start is not None and end is not None:
                what = what[start:end]
            if event == "begin" and kwargs.get("what") is None:
                return
            if not _lipsync.strip_text_tags(what).strip():
                # Nothing left to say (the empty part after a {w} or {nw}).
                return
            for rt in runtimes:
                if rt.speech is None or event == "show":
                    rt.speak(what, now)
        elif event == "slow_done":
            if not renpy.game.preferences.text_cps:
                # Text shown at once: the mouth keeps speaking the line at a natural pace.
                return
            for rt in runtimes:
                # Without a voice, the mouth stops with the text; with one, it follows the voice.
                if rt.speech is not None and rt.speech.get("voice") is None:
                    rt.stop_speaking(now + 0.15)
        elif event == "end":
            for rt in runtimes:
                if rt.speech is not None and rt.speech.get("voice") is None:
                    rt.stop_speaking()

    config.all_character_callbacks.append(_say_callback)

    def speaking(tag):
        """A character callback that lip-syncs the Rigby image `tag` (for characters without image=)."""
        def callback(event, interact=True, **kwargs):
            _drive_speech(tag, event, **kwargs)
        return callback

    # ---- script API ---------------------------------------------------------------------------------

    def _runtimes_or_error(tag, layer=None):
        rts = _runtimes_for_tag(tag, layer)
        if not rts:
            raise Exception("No Rigby2D image is showing with the tag {!r}.".format(tag))
        return rts

    def play(tag, animation, track=0, loop=True, mix=0.25, layer=None):
        """Plays `animation` on `track` of the Rigby image `tag` now, crossfading over `mix` seconds."""
        for rt in _runtimes_or_error(tag, layer):
            if rt.state.set_animation(track, animation, loop, mix) is None:
                raise Exception("{} has no animation {!r}.".format(rt.common.filename, animation))
            if track == 0:
                rt.motions = [animation]

    def queue(tag, animation, track=0, loop=True, mix=0.25, delay=None, layer=None):
        """Queues `animation` after what plays on `track` (when it ends, or `delay` seconds after it starts)."""
        for rt in _runtimes_or_error(tag, layer):
            if rt.state.add_animation(track, animation, loop, mix, delay) is None:
                raise Exception("{} has no animation {!r}.".format(rt.common.filename, animation))

    def stop(tag, track, mix=0.25, layer=None):
        """Fades out what plays on `track`."""
        for rt in _runtimes_or_error(tag, layer):
            rt._fade(track, None, 0.0, mix)

    def look(tag, target, layer=None):
        """Makes `tag` look at `target`: "mouse", an (x, y) with -1..1 from left/down to right/up,
        or None to look ahead (the image's own `look` setting)."""
        for rt in _runtimes_or_error(tag, layer):
            rt.look_target = target if target is not None else None

    def set_skin(tag, skin, layer=None):
        for rt in _runtimes_or_error(tag, layer):
            rt.pose.skin = None if skin is None else rt.sk.find_skin(skin)

    def set_speed(tag, speed, layer=None):
        for rt in _runtimes_or_error(tag, layer):
            rt.owner.speed = speed

    def say(tag, text, layer=None):
        """Lip-syncs `text` on `tag` now (as if spoken), without showing it."""
        for rt in _runtimes_or_error(tag, layer):
            rt.speak(text, renpy.display.interface.frame_time)

    def bone_position(tag, bone, layer=None):
        """Where bone `bone` of `tag` is, in pixels inside the image (to place speech bubbles,
        held props or effects), or None."""
        for rt in _runtimes_for_tag(tag, layer):
            i = rt.sk.find_bone(bone)
            d = rt.owner
            if i is None or getattr(d, "transform", None) is None:
                return None
            m = rt.pose.world[i]
            sx, ox, sy, oy = d.transform
            return (m[4] * sx + ox, m[5] * sy + oy)
        return None

    def animations(tag, layer=None):
        for rt in _runtimes_or_error(tag, layer):
            return list(rt.common.animations)

init -1499 python:
    Rigby = rigby.Rigby
