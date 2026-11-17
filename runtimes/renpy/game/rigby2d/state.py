# SPDX-License-Identifier: MIT OR Apache-2.0
"""Playback: tracks of animations layered on top of each other, crossfades, queued animations and
events. Track 0 is the base layer; higher tracks apply over it and only change what their
animations key. Callbacks are queued as ``StateEvent`` objects; take them with ``drain_events``.

A port of ``runtimes/rust/rigby-runtime/src/state.rs``.
"""

import math

START = "start"
END = "end"
COMPLETE = "complete"
EVENT = "event"

_fmod = math.fmod


class TrackEntry(object):
    """A playing animation on a track."""

    __slots__ = ("track", "animation", "looping", "mix_duration", "mix_time", "delay", "time", "last_time",
                 "fresh", "alpha", "time_scale", "previous", "queue", "id")

    def __init__(self, entry_id, track, animation, looping, mix, delay):
        self.track = track
        self.animation = animation
        self.looping = looping
        self.mix_duration = mix
        self.mix_time = 0.0
        # Queued entries: seconds after the previous entry started, or None to start when it ends.
        self.delay = delay
        self.time = 0.0
        self.last_time = -1.0
        self.fresh = True
        # Influence of the track (layers).
        self.alpha = 1.0
        self.time_scale = 1.0
        # The entry being faded out.
        self.previous = None
        self.queue = []
        self.id = entry_id

    def mix(self):
        """Mix progress in [0, 1]: how much this entry has replaced the previous one."""
        if self.mix_duration > 0.0:
            return min(self.mix_time / self.mix_duration, 1.0)
        return 1.0

    def snapshot(self):
        e = TrackEntry(self.id, self.track, self.animation, self.looping, self.mix_duration, self.delay)
        e.mix_time = self.mix_time
        e.time = self.time
        e.last_time = self.last_time
        e.fresh = self.fresh
        e.alpha = self.alpha
        e.time_scale = self.time_scale
        return e


class Event(object):
    """An event key merged with its definition."""

    __slots__ = ("name", "time", "loop_index", "int", "float", "string", "audio", "volume", "balance")

    def __init__(self, name, time, loop_index, int_, float_, string, audio, volume, balance):
        self.name = name
        self.time = time
        self.loop_index = loop_index
        self.int = int_
        self.float = float_
        self.string = string
        self.audio = audio
        self.volume = volume
        self.balance = balance

    def __repr__(self):
        return "<Event %s @ %s>" % (self.name, self.time)


class StateEvent(object):
    __slots__ = ("kind", "track", "animation", "entry", "event")

    def __init__(self, kind, track, animation, entry, event=None):
        self.kind = kind
        self.track = track
        self.animation = animation
        self.entry = entry
        self.event = event

    def __repr__(self):
        return "<StateEvent %s track %d animation %d%s>" % (self.kind, self.track, self.animation, " " + repr(self.event) if self.event else "")


class AnimationState(object):

    def __init__(self, sk):
        self.sk = sk
        # Entries by track index (None = empty track).
        self.tracks = []
        # Playback speed multiplier for every track.
        self.speed = 1.0
        # Seconds since the last ``apply``, simulated by physics constraints then.
        self.physics_delta = 0.0
        self._events = []
        self._next_id = 0

    def drain_events(self):
        """Takes the callbacks queued since the last call, in order."""
        events = self._events
        self._events = []
        return events

    def _notify(self, kind, e, event=None):
        self._events.append(StateEvent(kind, e.track, e.animation, e.id, event))

    def _entry(self, track, animation, looping, mix, delay):
        self._next_id += 1
        return TrackEntry(self._next_id, track, animation, looping, mix, delay)

    def play(self, name, looping=True, mix=0.0):
        """Base track: starts ``name``, crossfading over ``mix`` seconds. False if not found."""
        return self.set_animation(0, name, looping, mix) is not None

    def set_animation(self, track, name, looping=True, mix=0.0):
        """Starts ``name`` on ``track`` now, crossfading over ``mix`` seconds and dropping anything
        queued. Returns the entry, or None when no animation has that name."""
        animation = self.sk.find_animation(name)
        if animation is None:
            return None
        entry = self._entry(track, animation, looping, mix, None)
        while len(self.tracks) <= track:
            self.tracks.append(None)
        current = self.tracks[track]
        self.tracks[track] = None
        if current is not None:
            queue = current.queue
            current.queue = []
            for q in queue:
                self._notify(END, q)
            self._replace(current, entry)
        else:
            self._notify(START, entry)
            self.tracks[track] = entry
        return entry

    def add_animation(self, track, name, looping=True, mix=0.0, delay=None):
        """Queues ``name`` on ``track`` after the current entry (or the last queued one): when it
        ends, or ``delay`` seconds after it starts. Starts right away on an empty track."""
        if track >= len(self.tracks) or self.tracks[track] is None:
            return self.set_animation(track, name, looping, mix)
        animation = self.sk.find_animation(name)
        if animation is None:
            return None
        entry = self._entry(track, animation, looping, mix, delay)
        self.tracks[track].queue.append(entry)
        return entry

    def clear_track(self, track):
        """Stops a track (its animation stops affecting the pose)."""
        if track >= len(self.tracks) or self.tracks[track] is None:
            return
        current = self.tracks[track]
        self.tracks[track] = None
        if current.previous is not None:
            prev = current.previous
            current.previous = None
            self._notify(END, prev)
        self._notify(END, current)
        queue = current.queue
        current.queue = []
        for q in queue:
            self._notify(END, q)

    def stop(self):
        for i in range(len(self.tracks)):
            self.clear_track(i)
        self.tracks = []

    def current(self, track):
        return self.tracks[track] if track < len(self.tracks) else None

    def _replace(self, frm, to):
        # A fade that has not finished keeps fading out from the newest pose.
        if frm.previous is not None:
            prev = frm.previous
            frm.previous = None
            self._notify(END, prev)
        if to.mix_duration > 0.0:
            to.previous = frm
        else:
            self._notify(END, frm)
        self._notify(START, to)
        self.tracks[to.track] = to

    def update(self, dt):
        """Advances time by ``dt`` seconds, starting queued entries and firing events."""
        sk = self.sk
        dt = dt * self.speed
        self.physics_delta += dt
        for track in range(len(self.tracks)):
            entry = self.tracks[track]
            if entry is None:
                continue
            self.tracks[track] = None
            self._advance(entry, dt)
            # Start the next queued entry once its time comes.
            if entry.queue:
                nxt = entry.queue[0]
                anim = sk.animations[entry.animation] if entry.animation < len(sk.animations) else None
                duration = anim.duration if anim is not None else 0.0
                start = nxt.delay if nxt.delay is not None else max(duration - nxt.mix_duration, 0.0)
                if entry.time >= start:
                    nxt = entry.queue.pop(0)
                    nxt.queue = entry.queue
                    entry.queue = []
                    # Carry over the time past the switch point.
                    nxt.time = max(entry.time - start, 0.0)
                    nxt.mix_time = nxt.time
                    nxt.last_time = -1.0
                    nxt.fresh = False
                    self._replace(entry, nxt)
                    started = self.tracks[track]
                    self._fire_events(started)
                    continue
            self.tracks[track] = entry

    def _advance(self, entry, dt):
        step = dt * entry.time_scale
        entry.last_time = -1.0 if entry.fresh else entry.time
        entry.fresh = False
        entry.time += step
        entry.mix_time += step
        self._fire_events(entry)
        prev = entry.previous
        if prev is not None:
            # The entry fading out keeps playing, firing its events, until the mix ends.
            prev.last_time = prev.time
            prev.time += dt * prev.time_scale
            self._fire_events(prev.snapshot())
            if entry.mix_time >= entry.mix_duration:
                entry.previous = None
                self._notify(END, prev)

    def _fire_events(self, entry):
        """Fires the events and completions between an entry's last and current time."""
        sk = self.sk
        if entry.animation >= len(sk.animations):
            return
        anim = sk.animations[entry.animation]
        d = anim.duration
        frm, to = entry.last_time, entry.time
        if to < frm:
            return

        def fire(t0, t1, loop_index):
            for e in anim.events:
                if t0 < e.time <= t1:
                    definition = sk.event_map.get(e.name)
                    event = Event(
                        e.name, e.time, loop_index,
                        e.int if e.int is not None else (definition.int if definition else 0),
                        e.float if e.float is not None else (definition.float if definition else 0.0),
                        e.string if e.string is not None else (definition.string if definition else None),
                        definition.audio if definition else None,
                        e.volume if e.volume is not None else (definition.volume if definition else 1.0),
                        e.balance if e.balance is not None else (definition.balance if definition else 0.0),
                    )
                    self._notify(EVENT, entry, event)

        if not entry.looping or d <= 0.0:
            fire(frm, min(to, d), 0)
            if frm < d <= to:
                self._notify(COMPLETE, entry)
            return
        # Looping: fire per loop crossed.
        start_loop = int(math.floor(max(frm, 0.0) / d))
        end_loop = int(math.floor(to / d))
        for loop_index in range(start_loop, end_loop + 1):
            t0 = frm - loop_index * d if loop_index == start_loop else -1.0
            t1 = to - loop_index * d if loop_index == end_loop else d
            fire(t0, t1, loop_index)
            if loop_index < end_loop:
                self._notify(COMPLETE, entry)

    def apply(self, pose):
        """Resets ``pose`` to setup, applies every track in order and updates world transforms."""
        pose.reset()
        pose.physics_delta = self.physics_delta
        self.physics_delta = 0.0
        for entry in self.tracks:
            if entry is None:
                continue
            layer = 1.0 if entry.track == 0 else entry.alpha
            if entry.previous is not None:
                _apply_entry(self.sk, pose, entry.previous, layer * entry.previous.alpha)
            alpha = (entry.mix() if entry.previous is not None else 1.0) * (entry.alpha if entry.track == 0 else layer)
            _apply_entry(self.sk, pose, entry, alpha)
        pose.update_world()

    def is_complete(self, track=0):
        """True when a non-looping animation on ``track`` has played to its end (or the track is empty)."""
        entry = self.current(track)
        if entry is None:
            return True
        if entry.looping or entry.queue:
            return False
        anim = self.sk.animations[entry.animation]
        return entry.time >= anim.duration


def _apply_entry(sk, pose, entry, alpha):
    if entry.animation >= len(sk.animations) or alpha <= 0.0:
        return
    anim = sk.animations[entry.animation]
    # The same arithmetic as the JavaScript runtime, so loop boundaries land on the same frame.
    if entry.looping and anim.duration > 0.0:
        time = _fmod(_fmod(entry.time, anim.duration) + anim.duration, anim.duration)
    else:
        time = min(entry.time, anim.duration)
    pose.apply(entry.animation, time, min(alpha, 1.0))
