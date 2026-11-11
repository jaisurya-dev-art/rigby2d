// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): playback. Tracks of animations layered on top of each other, crossfades,
// queued animations and events. Port of state.rs.

#include "rigby.h"

#include <cmath>

namespace rigby {

TrackEntry::TrackEntry(TrackEntry&& o)
    : track(o.track), animation(o.animation), looping(o.looping), mix_duration(o.mix_duration), mix_time(o.mix_time), delay(o.delay), time(o.time),
      last_time(o.last_time), fresh(o.fresh), alpha(o.alpha), time_scale(o.time_scale), previous(std::move(o.previous)), queue(std::move(o.queue)), id(o.id) {}

TrackEntry& TrackEntry::operator=(TrackEntry&& o) {
    track = o.track;
    animation = o.animation;
    looping = o.looping;
    mix_duration = o.mix_duration;
    mix_time = o.mix_time;
    delay = o.delay;
    time = o.time;
    last_time = o.last_time;
    fresh = o.fresh;
    alpha = o.alpha;
    time_scale = o.time_scale;
    previous = std::move(o.previous);
    queue = std::move(o.queue);
    id = o.id;
    return *this;
}

double TrackEntry::mix() const {
    return mix_duration > 0.0 ? std::fmin(mix_time / mix_duration, 1.0) : 1.0;
}

std::vector<StateEvent> AnimationState::drain_events() {
    std::vector<StateEvent> out;
    out.swap(events_);
    return out;
}

void AnimationState::notify(StateEventKind kind, const TrackEntry& e, const Event* ev) {
    StateEvent s;
    s.kind = kind;
    if (ev) s.event = *ev;
    s.track = e.track;
    s.animation = e.animation;
    s.entry = e.id;
    events_.push_back(s);
}

TrackEntry AnimationState::make_entry(size_t track, size_t animation, bool looping, double mix, Opt<double> delay) {
    next_id_++;
    TrackEntry e;
    e.track = track;
    e.animation = animation;
    e.looping = looping;
    e.mix_duration = mix;
    e.delay = delay;
    e.id = next_id_;
    return e;
}

bool AnimationState::play(const SkeletonData& sk, const std::string& name, bool looping, double mix) {
    return set_animation(sk, 0, name, looping, mix).has;
}

Opt<uint64_t> AnimationState::set_animation(const SkeletonData& sk, size_t track, const std::string& name, bool looping, double mix) {
    int animation = sk.find_animation(name);
    if (animation < 0) return Opt<uint64_t>();
    TrackEntry entry = make_entry(track, (size_t)animation, looping, mix, Opt<double>());
    uint64_t id = entry.id;
    if (tracks.size() <= track) tracks.resize(track + 1);
    if (tracks[track]) {
        TrackEntry current = std::move(*tracks[track]);
        tracks[track].reset();
        std::vector<TrackEntry> queue;
        queue.swap(current.queue);
        for (size_t q = 0; q < queue.size(); q++) notify(EventEnd, queue[q]);
        replace(std::move(current), std::move(entry));
    } else {
        notify(EventStart, entry);
        tracks[track].reset(new TrackEntry(std::move(entry)));
    }
    return Opt<uint64_t>(id);
}

Opt<uint64_t> AnimationState::add_animation(const SkeletonData& sk, size_t track, const std::string& name, bool looping, double mix, Opt<double> delay) {
    if (track >= tracks.size() || !tracks[track]) return set_animation(sk, track, name, looping, mix);
    int animation = sk.find_animation(name);
    if (animation < 0) return Opt<uint64_t>();
    TrackEntry entry = make_entry(track, (size_t)animation, looping, mix, delay);
    uint64_t id = entry.id;
    tracks[track]->queue.push_back(std::move(entry));
    return Opt<uint64_t>(id);
}

void AnimationState::clear_track(size_t track) {
    if (track >= tracks.size() || !tracks[track]) return;
    std::unique_ptr<TrackEntry> current(tracks[track].release());
    if (current->previous) {
        std::unique_ptr<TrackEntry> prev(current->previous.release());
        notify(EventEnd, *prev);
    }
    notify(EventEnd, *current);
    std::vector<TrackEntry> queue;
    queue.swap(current->queue);
    for (size_t q = 0; q < queue.size(); q++) notify(EventEnd, queue[q]);
}

void AnimationState::stop() {
    for (size_t i = 0; i < tracks.size(); i++) clear_track(i);
    tracks.clear();
}

TrackEntry* AnimationState::current(size_t track) {
    return track < tracks.size() ? tracks[track].get() : 0;
}

const TrackEntry* AnimationState::current(size_t track) const {
    return track < tracks.size() ? tracks[track].get() : 0;
}

void AnimationState::replace(TrackEntry from, TrackEntry to) {
    // A fade that has not finished keeps fading out from the newest pose.
    if (from.previous) {
        std::unique_ptr<TrackEntry> prev(from.previous.release());
        notify(EventEnd, *prev);
    }
    if (to.mix_duration > 0.0) {
        to.previous.reset(new TrackEntry(std::move(from)));
    } else {
        notify(EventEnd, from);
    }
    notify(EventStart, to);
    size_t track = to.track;
    tracks[track].reset(new TrackEntry(std::move(to)));
}

void AnimationState::update(const SkeletonData& sk, double dt) {
    dt *= speed;
    physics_delta += dt;
    for (size_t track = 0; track < tracks.size(); track++) {
        if (!tracks[track]) continue;
        std::unique_ptr<TrackEntry> entry(tracks[track].release());
        advance(sk, *entry, dt);
        // Start the next queued entry once its time comes.
        if (!entry->queue.empty()) {
            const TrackEntry& next = entry->queue[0];
            double duration = entry->animation < sk.animations.size() ? sk.animations[entry->animation].duration : 0.0;
            double start = next.delay.has ? next.delay.value : std::fmax(duration - next.mix_duration, 0.0);
            if (entry->time >= start) {
                TrackEntry n = std::move(entry->queue[0]);
                entry->queue.erase(entry->queue.begin());
                n.queue.swap(entry->queue);
                // Carry over the time past the switch point.
                n.time = std::fmax(entry->time - start, 0.0);
                n.mix_time = n.time;
                n.last_time = -1.0;
                n.fresh = false;
                replace(std::move(*entry), std::move(n));
                std::unique_ptr<TrackEntry> started(tracks[track].release());
                fire_events(sk, *started);
                tracks[track].reset(started.release());
                continue;
            }
        }
        tracks[track].reset(entry.release());
    }
}

void AnimationState::advance(const SkeletonData& sk, TrackEntry& entry, double dt) {
    double step = dt * entry.time_scale;
    entry.last_time = entry.fresh ? -1.0 : entry.time;
    entry.fresh = false;
    entry.time += step;
    entry.mix_time += step;
    fire_events(sk, entry);
    if (entry.previous) {
        // The entry fading out keeps playing, firing its events, until the mix ends.
        TrackEntry& prev = *entry.previous;
        prev.last_time = prev.time;
        prev.time += dt * prev.time_scale;
        fire_events(sk, prev);
        if (entry.mix_time >= entry.mix_duration) {
            std::unique_ptr<TrackEntry> done(entry.previous.release());
            notify(EventEnd, *done);
        }
    }
}

void AnimationState::fire_events(const SkeletonData& sk, const TrackEntry& entry) {
    if (entry.animation >= sk.animations.size()) return;
    const Animation& anim = sk.animations[entry.animation];
    double d = anim.duration;
    double from = entry.last_time, to = entry.time;
    if (to < from) return;
    struct Fire {
        static void run(AnimationState& s, const SkeletonData& sk, const Animation& anim, const TrackEntry& entry, double t0, double t1, int64_t loop_index) {
            for (size_t k = 0; k < anim.events.size(); k++) {
                const EventKey& e = anim.events[k];
                if (!(e.time > t0 && e.time <= t1)) continue;
                const EventData* def = 0;
                for (size_t i = 0; i < sk.events.size(); i++) {
                    if (sk.events[i].name == e.name) {
                        def = &sk.events[i];
                        break;
                    }
                }
                Event ev;
                ev.name = e.name;
                ev.time = e.time;
                ev.loop_index = loop_index;
                ev.int_value = e.int_value.has ? e.int_value.value : (def ? def->int_value : 0);
                ev.float_value = e.float_value.has ? e.float_value.value : (def ? def->float_value : 0.0);
                ev.string = e.string.has ? e.string : (def ? def->string : Opt<std::string>());
                ev.audio = def ? def->audio : Opt<std::string>();
                ev.volume = e.volume.has ? e.volume.value : (def ? def->volume : 1.0);
                ev.balance = e.balance.has ? e.balance.value : (def ? def->balance : 0.0);
                s.notify(EventKeyed, entry, &ev);
            }
        }
    };
    if (!entry.looping || d <= 0.0) {
        Fire::run(*this, sk, anim, entry, from, std::fmin(to, d), 0);
        if (from < d && to >= d) notify(EventComplete, entry);
        return;
    }
    // Looping: fire per loop crossed.
    int64_t start_loop = (int64_t)std::floor(std::fmax(from, 0.0) / d);
    int64_t end_loop = (int64_t)std::floor(to / d);
    for (int64_t loop_index = start_loop; loop_index <= end_loop; loop_index++) {
        double t0 = loop_index == start_loop ? from - (double)loop_index * d : -1.0;
        double t1 = loop_index == end_loop ? to - (double)loop_index * d : d;
        Fire::run(*this, sk, anim, entry, t0, t1, loop_index);
        if (loop_index < end_loop) notify(EventComplete, entry);
    }
}

static void apply_entry(const SkeletonData& sk, Pose& pose, const TrackEntry& entry, double alpha) {
    if (entry.animation >= sk.animations.size()) return;
    const Animation& anim = sk.animations[entry.animation];
    if (alpha <= 0.0) return;
    // The same arithmetic as the JavaScript runtime, so loop boundaries land on the same frame.
    double time = entry.looping && anim.duration > 0.0 ? std::fmod(std::fmod(entry.time, anim.duration) + anim.duration, anim.duration) : std::fmin(entry.time, anim.duration);
    pose.apply(sk, entry.animation, time, std::fmin(alpha, 1.0));
}

void AnimationState::apply(const SkeletonData& sk, Pose& pose) {
    pose.reset(sk);
    pose.physics_delta = physics_delta;
    physics_delta = 0.0;
    for (size_t t = 0; t < tracks.size(); t++) {
        if (!tracks[t]) continue;
        const TrackEntry& entry = *tracks[t];
        double layer = entry.track == 0 ? 1.0 : entry.alpha;
        if (entry.previous) apply_entry(sk, pose, *entry.previous, layer * entry.previous->alpha);
        double alpha = (entry.previous ? entry.mix() : 1.0) * (entry.track == 0 ? entry.alpha : layer);
        apply_entry(sk, pose, entry, alpha);
    }
    pose.update_world(sk);
}

}  // namespace rigby
