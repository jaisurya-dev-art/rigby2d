// SPDX-License-Identifier: MIT OR Apache-2.0
// Playback: tracks of animations layered on top of each other, crossfades, queued animations and
// events. Track 0 is the base layer; higher tracks apply over it and only change what their
// animations key. Callbacks are queued as StateEvents (DrainEvents) and raised as .NET events.
// A port of runtimes/rust/rigby-runtime/src/state.rs.

using System;
using System.Collections.Generic;

namespace Rigby2D
{
    /// <summary>A playing animation on a track.</summary>
    public sealed class TrackEntry
    {
        public int Track;
        public int Animation;
        public bool Looping;
        public double MixDuration, MixTime;
        /// <summary>Queued entries: seconds after the previous entry started, or null to start when it ends.</summary>
        public double? Delay;
        public double Time;
        internal double LastTime = -1.0;
        internal bool Fresh = true;
        /// <summary>Influence of the track (layers).</summary>
        public double Alpha = 1.0;
        public double TimeScale = 1.0;
        /// <summary>The entry being faded out.</summary>
        public TrackEntry Previous;
        public List<TrackEntry> Queue = new List<TrackEntry>();
        /// <summary>Unique id, to match events to entries.</summary>
        public ulong Id;

        /// <summary>Mix progress in [0, 1]: how much this entry has replaced the previous one.</summary>
        public double Mix => MixDuration > 0.0 ? Num.Min(MixTime / MixDuration, 1.0) : 1.0;
    }

    /// <summary>An event key merged with its definition.</summary>
    public sealed class SkeletonEvent
    {
        public string Name;
        public double Time;
        public long LoopIndex;
        public long Int;
        public double Float;
        public string String, Audio;
        public double Volume, Balance;
    }

    public enum StateEventKind : byte
    {
        Start,
        /// <summary>Replaced or cleared.</summary>
        End,
        /// <summary>Reached its end (every loop for looping entries).</summary>
        Complete,
        Event,
    }

    public struct StateEvent
    {
        public StateEventKind Kind;
        public int Track;
        public int Animation;
        public ulong Entry;
        /// <summary>For Kind == Event.</summary>
        public SkeletonEvent Event;
    }

    public sealed class PlaybackState
    {
        /// <summary>Entries by track index (null = empty track).</summary>
        public readonly List<TrackEntry> Tracks = new List<TrackEntry>();
        /// <summary>Playback speed multiplier for every track.</summary>
        public double Speed = 1.0;
        /// <summary>Seconds since the last Apply, simulated by physics constraints then.</summary>
        public double PhysicsDelta;
        readonly List<StateEvent> events = new List<StateEvent>();
        ulong nextId;

        /// <summary>Takes the callbacks queued since the last call, in order.</summary>
        public List<StateEvent> DrainEvents()
        {
            var o = new List<StateEvent>(events);
            events.Clear();
            return o;
        }

        /// <summary>Copies the queued callbacks into output (cleared first) and empties the queue, without allocating.</summary>
        public void DrainEvents(List<StateEvent> output)
        {
            output.Clear();
            output.AddRange(events);
            events.Clear();
        }

        void Notify(StateEventKind kind, TrackEntry e, SkeletonEvent ev = null) =>
            events.Add(new StateEvent { Kind = kind, Track = e.Track, Animation = e.Animation, Entry = e.Id, Event = ev });

        TrackEntry NewEntry(int track, int animation, bool looping, double mix, double? delay) =>
            new TrackEntry { Id = ++nextId, Track = track, Animation = animation, Looping = looping, MixDuration = mix, Delay = delay };

        /// <summary>Base track: starts name, crossfading over mix seconds. False if not found.</summary>
        public bool Play(SkeletonData sk, string name, bool looping, double mix) => SetAnimation(sk, 0, name, looping, mix) != null;

        /// <summary>Starts name on track now, crossfading over mix seconds and dropping anything queued. Returns the entry, or null when no animation has that name.</summary>
        public TrackEntry SetAnimation(SkeletonData sk, int track, string name, bool looping, double mix)
        {
            int animation = sk.FindAnimation(name);
            if (animation < 0 || track < 0) return null;
            var entry = NewEntry(track, animation, looping, mix, null);
            while (Tracks.Count <= track) Tracks.Add(null);
            var current = Tracks[track];
            Tracks[track] = null;
            if (current != null)
            {
                foreach (var q in current.Queue) Notify(StateEventKind.End, q);
                current.Queue.Clear();
                Replace(current, entry);
            }
            else
            {
                Notify(StateEventKind.Start, entry);
                Tracks[track] = entry;
            }
            return entry;
        }

        /// <summary>Queues name on track after the current entry (or the last queued one): when it ends, or delay seconds after it starts. Starts right away on an empty track.</summary>
        public TrackEntry AddAnimation(SkeletonData sk, int track, string name, bool looping, double mix, double? delay)
        {
            if (track < 0) return null;
            if (track >= Tracks.Count || Tracks[track] == null) return SetAnimation(sk, track, name, looping, mix);
            int animation = sk.FindAnimation(name);
            if (animation < 0) return null;
            var entry = NewEntry(track, animation, looping, mix, delay);
            Tracks[track].Queue.Add(entry);
            return entry;
        }

        /// <summary>Stops a track (its animation stops affecting the pose).</summary>
        public void ClearTrack(int track)
        {
            if (track < 0 || track >= Tracks.Count || Tracks[track] == null) return;
            var current = Tracks[track];
            Tracks[track] = null;
            if (current.Previous != null)
            {
                Notify(StateEventKind.End, current.Previous);
                current.Previous = null;
            }
            Notify(StateEventKind.End, current);
            foreach (var q in current.Queue) Notify(StateEventKind.End, q);
            current.Queue.Clear();
        }

        public void Stop()
        {
            for (int i = 0; i < Tracks.Count; i++) ClearTrack(i);
            Tracks.Clear();
        }

        public TrackEntry Current(int track) => track >= 0 && track < Tracks.Count ? Tracks[track] : null;

        void Replace(TrackEntry from, TrackEntry to)
        {
            // A fade that has not finished keeps fading out from the newest pose.
            if (from.Previous != null)
            {
                Notify(StateEventKind.End, from.Previous);
                from.Previous = null;
            }
            if (to.MixDuration > 0.0) to.Previous = from;
            else Notify(StateEventKind.End, from);
            Notify(StateEventKind.Start, to);
            Tracks[to.Track] = to;
        }

        /// <summary>Advances time by dt seconds, starting queued entries and firing events.</summary>
        public void Update(SkeletonData sk, double dt)
        {
            dt *= Speed;
            PhysicsDelta += dt;
            for (int track = 0; track < Tracks.Count; track++)
            {
                var entry = Tracks[track];
                if (entry == null) continue;
                Tracks[track] = null;
                Advance(sk, entry, dt);
                // Start the next queued entry once its time comes.
                if (entry.Queue.Count > 0)
                {
                    var next = entry.Queue[0];
                    double duration = entry.Animation >= 0 && entry.Animation < sk.Animations.Count ? sk.Animations[entry.Animation].Duration : 0.0;
                    double start = next.Delay ?? Num.Max(duration - next.MixDuration, 0.0);
                    if (entry.Time >= start)
                    {
                        entry.Queue.RemoveAt(0);
                        next.Queue = entry.Queue;
                        entry.Queue = new List<TrackEntry>();
                        // Carry over the time past the switch point.
                        next.Time = Num.Max(entry.Time - start, 0.0);
                        next.MixTime = next.Time;
                        next.LastTime = -1.0;
                        next.Fresh = false;
                        Replace(entry, next);
                        FireEvents(sk, Tracks[track]);
                        continue;
                    }
                }
                Tracks[track] = entry;
            }
        }

        void Advance(SkeletonData sk, TrackEntry entry, double dt)
        {
            double step = dt * entry.TimeScale;
            entry.LastTime = entry.Fresh ? -1.0 : entry.Time;
            entry.Fresh = false;
            entry.Time += step;
            entry.MixTime += step;
            FireEvents(sk, entry);
            var prev = entry.Previous;
            if (prev != null)
            {
                // The entry fading out keeps playing, firing its events, until the mix ends.
                prev.LastTime = prev.Time;
                prev.Time += dt * prev.TimeScale;
                FireEvents(sk, prev);
                if (entry.MixTime >= entry.MixDuration)
                {
                    entry.Previous = null;
                    Notify(StateEventKind.End, prev);
                }
            }
        }

        /// <summary>Fires the events and completions between an entry's last and current time.</summary>
        void FireEvents(SkeletonData sk, TrackEntry entry)
        {
            if (entry.Animation < 0 || entry.Animation >= sk.Animations.Count) return;
            var anim = sk.Animations[entry.Animation];
            double d = anim.Duration;
            double from = entry.LastTime, to = entry.Time;
            if (to < from) return;
            if (!entry.Looping || d <= 0.0)
            {
                Fire(sk, anim, entry, from, Num.Min(to, d), 0);
                if (from < d && to >= d) Notify(StateEventKind.Complete, entry);
                return;
            }
            // Looping: fire per loop crossed.
            long startLoop = Num.ToLong(Math.Floor(Num.Max(from, 0.0) / d));
            long endLoop = Num.ToLong(Math.Floor(to / d));
            if (endLoop - startLoop > 100000) startLoop = endLoop - 100000; // a huge time step: the last loops are enough
            for (long loopIndex = startLoop; loopIndex <= endLoop; loopIndex++)
            {
                double t0 = loopIndex == startLoop ? from - loopIndex * d : -1.0;
                double t1 = loopIndex == endLoop ? to - loopIndex * d : d;
                Fire(sk, anim, entry, t0, t1, loopIndex);
                if (loopIndex < endLoop) Notify(StateEventKind.Complete, entry);
            }
        }

        void Fire(SkeletonData sk, SkeletonAnimation anim, TrackEntry entry, double t0, double t1, long loopIndex)
        {
            foreach (var e in anim.Events)
            {
                if (!(e.Time > t0 && e.Time <= t1)) continue;
                EventData def = null;
                foreach (var d in sk.Events)
                    if (d.Name == e.Name)
                    {
                        def = d;
                        break;
                    }
                var ev = new SkeletonEvent
                {
                    Name = e.Name,
                    Time = e.Time,
                    LoopIndex = loopIndex,
                    Int = e.Int ?? def?.Int ?? 0,
                    Float = e.Float ?? def?.Float ?? 0.0,
                    String = e.String ?? def?.String,
                    Audio = def?.Audio,
                    Volume = e.Volume ?? def?.Volume ?? 1.0,
                    Balance = e.Balance ?? def?.Balance ?? 0.0,
                };
                Notify(StateEventKind.Event, entry, ev);
            }
        }

        /// <summary>Resets pose to setup, applies every track in order and updates world transforms.</summary>
        public void Apply(SkeletonData sk, SkeletonPose pose)
        {
            pose.Reset();
            pose.PhysicsDelta = PhysicsDelta;
            PhysicsDelta = 0.0;
            foreach (var entry in Tracks)
            {
                if (entry == null) continue;
                double layer = entry.Track == 0 ? 1.0 : entry.Alpha;
                if (entry.Previous != null) ApplyEntry(sk, pose, entry.Previous, layer * entry.Previous.Alpha);
                double alpha = (entry.Previous != null ? entry.Mix : 1.0) * (entry.Track == 0 ? entry.Alpha : layer);
                ApplyEntry(sk, pose, entry, alpha);
            }
            pose.UpdateWorld();
        }

        static void ApplyEntry(SkeletonData sk, SkeletonPose pose, TrackEntry entry, double alpha)
        {
            if (entry.Animation < 0 || entry.Animation >= sk.Animations.Count) return;
            var anim = sk.Animations[entry.Animation];
            if (alpha <= 0.0) return;
            // The same arithmetic as the JavaScript runtime, so loop boundaries land on the same frame.
            double time = entry.Looping && anim.Duration > 0.0 ? ((entry.Time % anim.Duration) + anim.Duration) % anim.Duration : Num.Min(entry.Time, anim.Duration);
            pose.Apply(anim, time, Num.Min(alpha, 1.0));
        }
    }
}
