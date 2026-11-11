// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): scene composition. Several characters (actors) acting together on a stage,
// with a camera and parallax. Port of scene.rs (itself a port of src/core/scene.js).

#include "rigby.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace rigby {

const double DEFAULT_FOCAL = 1000.0;
const double SCENE_FORMAT = 1.0;

namespace {

/// A finite number of at least `min`, else `def`.
double num_min(const Json& v, double def, double min) {
    if (v.is_num() && std::isfinite(v.n) && v.n >= min) return v.n;
    return def;
}

double js_round(double v) {
    return std::floor(v + 0.5);
}

const std::vector<Clip>& no_clips() {
    static const std::vector<Clip> none;
    return none;
}

const Animation* anim_ptr(const SkeletonData& data, int i) {
    return i >= 0 ? &data.animations[(size_t)i] : 0;
}

/// The part of the animation a clip plays: (in, out) in animation seconds.
void clip_span(const Clip& clip, const Animation* anim, double& a, double& b) {
    double end = anim ? anim->duration : 0.0;
    double out;
    if (!clip.out_point.has) out = end;
    else {
        double o = clip.out_point.value;
        out = std::fmin(o, end != 0.0 && !std::isnan(end) ? end : o);
    }
    a = std::fmin(clip.in_point, out);
    b = out;
}

/// How long a clip lasts on the scene timeline (infinite for loops = 0).
double clip_length(const Clip& clip, const Animation* anim) {
    double a, b;
    clip_span(clip, anim, a, b);
    if (clip.loops == 0) return INFINITY;
    return ((b - a) * (double)clip.loops) / clip.speed;
}

/// The animation time a clip shows at scene time t (holding its last frame once it is over).
double clip_time(const Clip& clip, const Animation* anim, double t) {
    double a, b;
    clip_span(clip, anim, a, b);
    double span = b - a;
    double local = std::fmax(t - clip.start, 0.0) * clip.speed;
    if (span <= 0.0) return a;
    double total = clip.loops == 0 ? INFINITY : span * (double)clip.loops;
    if (local >= total) return b;
    return a + std::fmod(local, span);
}

struct ActorState {
    int anim;
    double time;
    bool has_from;
    int from_anim;
    double from_time;
    double alpha;
};

/// The actor's state at scene time t in `shot`; false before its first clip (setup pose).
bool actor_state_at(const Actor& actor, const SkeletonData& data, const std::string& shot, double t, ActorState& st) {
    const std::vector<Clip>& clips = actor.clips_of(shot);
    int k = -1;
    for (size_t i = clips.size(); i-- > 0;) {
        if (clips[i].start <= t + 1e-9) {
            k = (int)i;
            break;
        }
    }
    if (k < 0) return false;
    const Clip& cur = clips[(size_t)k];
    int anim = data.find_animation(cur.animation);
    st.anim = anim;
    st.time = clip_time(cur, anim_ptr(data, anim), t);
    st.has_from = false;
    st.from_anim = NONE;
    st.from_time = 0.0;
    st.alpha = 1.0;
    if (k > 0 && cur.blend > 0.0 && t - cur.start < cur.blend) {
        const Clip& prev = clips[(size_t)k - 1];
        int p = data.find_animation(prev.animation);
        if (p >= 0) {
            st.has_from = true;
            st.from_anim = p;
            st.from_time = clip_time(prev, anim_ptr(data, p), t);
        }
        double alpha = (t - cur.start) / cur.blend;
        st.alpha = alpha < 0.0 ? 0.0 : (alpha > 1.0 ? 1.0 : alpha);
    }
    return true;
}

/// The scene time an actor's finite clips end in `shot`.
double actor_end(const Actor& actor, const SkeletonData& data, const std::string& shot) {
    double end = 0.0;
    const std::vector<Clip>& clips = actor.clips_of(shot);
    for (size_t i = 0; i < clips.size(); i++) {
        double len = clip_length(clips[i], anim_ptr(data, data.find_animation(clips[i].animation)));
        end = std::fmax(end, clips[i].start + (std::isfinite(len) ? len : 0.0));
    }
    return end;
}

/// The placement of an actor: its anchor bone's world transform, mirrored when flipped, raised by its ground offset.
Affine actor_placement(const SkeletonData& stage, const Pose& stage_pose, const Actor& actor) {
    int b = stage.find_bone(actor.bone);
    Affine w = b >= 0 ? stage_pose.world[(size_t)b] : Affine();
    if (actor.flip) {
        w.a = -w.a;
        w.b = -w.b;
    }
    double g = actor.ground;
    if (g != 0.0) {
        w.tx += w.c * g;
        w.ty += w.d * g;
    }
    return w;
}

/// Poses an actor at scene time t: resets its pose, applies its clip (crossfading from the previous
/// one), places it on its anchor bone and updates world transforms.
void pose_actor(const SkeletonData& stage, const Pose& stage_pose, const Actor& actor, const SkeletonData& data, const std::string& shot, double t, Pose& pose, double physics_delta) {
    if (actor.skin.has) {
        int skin = data.find_skin(actor.skin.value);
        if (skin >= 0) pose.skin = skin;
    }
    pose.reset(data);
    ActorState st;
    if (actor_state_at(actor, data, shot, t, st)) {
        if (st.has_from) pose.apply(data, (size_t)st.from_anim, st.from_time, 1.0);
        if (st.anim >= 0) pose.apply(data, (size_t)st.anim, st.time, st.has_from ? st.alpha : 1.0);
    }
    // A new pose simulated its setup pose at the origin: start physics afresh where the actor stands.
    if (!pose.placement.has) pose.reset_physics();
    pose.placement = Opt<Affine>(actor_placement(stage, stage_pose, actor));
    pose.physics_delta = physics_delta;
    pose.update_world(data);
}

double depth_factor(double z, double focal) {
    return focal / (focal + z);
}

Opt<std::pair<double, double> > camera_position(const SkeletonData& stage, const Pose& pose) {
    int c = stage.find_bone("camera");
    if (c < 0) return Opt<std::pair<double, double> >();
    double x, y;
    pose.world[(size_t)c].apply(0.0, 0.0, x, y);
    return Opt<std::pair<double, double> >(std::make_pair(x, y));
}

/// Moves every bone with a depth, with its children, by (1 - depth factor) of how far the camera
/// has moved from its setup position.
void apply_parallax(const SkeletonData& stage, const Scene& scene, Pose& pose, const Opt<std::pair<double, double> >& setup_camera) {
    if (scene.depth.empty()) return;
    Opt<std::pair<double, double> > cam = camera_position(stage, pose);
    if (!cam.has || !setup_camera.has) return;
    double dx = cam.value.first - setup_camera.value.first, dy = cam.value.second - setup_camera.value.second;
    if (std::fabs(dx) < 1e-9 && std::fabs(dy) < 1e-9) return;
    std::vector<std::pair<size_t, Affine> > desired;
    for (size_t i = 0; i < scene.depth.size(); i++) {
        int b = stage.find_bone(scene.depth[i].first);
        if (b < 0) continue;
        double z = scene.depth[i].second;
        if (z == 0.0) continue;
        double k = 1.0 - depth_factor(z, scene.focal);
        Affine w = pose.world[(size_t)b];
        w.tx += dx * k;
        w.ty += dy * k;
        for (size_t d = desired.size(); d-- > 0;)
            if (desired[d].first == (size_t)b) desired.erase(desired.begin() + (long)d);
        desired.push_back(std::make_pair((size_t)b, w));
    }
    if (!desired.empty()) pose.set_worlds(stage, desired);
}

}  // namespace

const std::vector<Clip>& Actor::clips_of(const std::string& shot) const {
    for (size_t i = 0; i < clips.size(); i++)
        if (clips[i].first == shot) return clips[i].second;
    return no_clips();
}

Opt<Clip> read_clip(const Json& c) {
    const Json& an = c.get("animation");
    if (!an.is_str() || an.s.empty()) return Opt<Clip>();
    Clip clip;
    clip.animation = an.s;
    clip.start = num_min(c.get("start"), 0.0, 0.0);
    clip.in_point = num_min(c.get("in"), 0.0, 0.0);
    const Json& out = c.get("out");
    if (!out.is_null()) {
        double o = num_min(out, NAN, 0.0);
        if (!std::isnan(o)) clip.out_point = Opt<double>(o);
    }
    clip.speed = num_min(c.get("speed"), 1.0, 0.01);
    double loops = js_round(num_min(c.get("loops"), 1.0, 0.0));
    clip.loops = loops >= 9.2e18 ? INT64_MAX : (int64_t)loops;
    clip.blend = num_min(c.get("blend"), 0.2, 0.0);
    return Opt<Clip>(clip);
}

Scene read_scene(const Json& o) {
    Scene scene;
    const Json& actors = o.get("actors");
    for (size_t i = 0; i < actors.arr.size(); i++) {
        const Json& a = actors.arr[i];
        if (!a.get("id").is_str() || !a.get("name").is_str() || !a.get("bone").is_str() || !a.get("slot").is_str()) continue;
        Actor actor;
        actor.id = a.get("id").s;
        actor.name = a.get("name").s;
        actor.bone = a.get("bone").s;
        actor.slot = a.get("slot").s;
        const Json& clips = a.get("clips");
        for (size_t k = 0; k < clips.obj.size(); k++) {
            std::vector<Clip> list;
            const Json& items = clips.obj[k].second;
            for (size_t c = 0; c < items.arr.size(); c++) {
                Opt<Clip> clip = read_clip(items.arr[c]);
                if (clip.has) list.push_back(clip.value);
            }
            std::stable_sort(list.begin(), list.end(), [](const Clip& x, const Clip& y) { return x.start < y.start; });
            actor.clips.push_back(std::make_pair(clips.obj[k].first, list));
        }
        const Json& g = a.get("ground");
        actor.ground = g.is_num() && std::isfinite(g.n) ? g.n : 0.0;
        if (a.get("skeleton").is_str()) actor.skeleton = Opt<std::string>(a.get("skeleton").s);
        if (a.get("skin").is_str() && !a.get("skin").s.empty()) actor.skin = Opt<std::string>(a.get("skin").s);
        actor.flip = a.truthy("flip");
        scene.actors.push_back(actor);
    }
    const Json& depth = o.get("depth");
    for (size_t i = 0; i < depth.obj.size(); i++) {
        const Json& z = depth.obj[i].second;
        if (z.is_num() && std::isfinite(z.n) && z.n > -DEFAULT_FOCAL * 0.95) scene.depth.push_back(std::make_pair(depth.obj[i].first, z.n));
    }
    const Json& focal = o.get("focal");
    scene.focal = focal.is_num() && focal.n > 0.0 ? focal.n : DEFAULT_FOCAL;
    return scene;
}

bool load_scene(const uint8_t* manifest, size_t size, SceneFileReader read, void* ctx, ScenePlayer& out, std::string& err) {
    Json o;
    std::string parse_err;
    if (!Json::parse((const char*)manifest, size, o, parse_err)) {
        err = "invalid JSON: " + parse_err;
        return false;
    }
    if (!o.get("rigbyScene").is_num()) {
        err = "not a Rigby2D scene manifest";
        return false;
    }
    double format = o.get("rigbyScene").n;
    if (format > SCENE_FORMAT) {
        char buf[96];
        snprintf(buf, sizeof buf, "scene format %g is newer than this runtime (%g)", format, SCENE_FORMAT);
        err = buf;
        return false;
    }
    if (!o.get("stage").is_str()) {
        err = "the scene manifest names no stage skeleton";
        return false;
    }
    std::string stage_file = o.get("stage").s;
    Scene scene = read_scene(o);
    std::vector<uint8_t> bytes;
    std::string e;
    if (!read(ctx, stage_file, bytes, e)) {
        err = stage_file + ": " + e;
        return false;
    }
    out.stage = SkeletonData();
    if (!load_skeleton(bytes.data(), bytes.size(), out.stage, e)) {
        err = stage_file + ": " + e;
        return false;
    }
    out.characters.clear();
    for (size_t i = 0; i < scene.actors.size(); i++) {
        const Actor& a = scene.actors[i];
        bool seen = false;
        for (size_t c = 0; c < out.characters.size(); c++)
            if (out.characters[c].id == a.id) seen = true;
        if (seen || !a.skeleton.has) continue;
        if (!read(ctx, a.skeleton.value, bytes, e)) {
            err = a.skeleton.value + ": " + e;
            return false;
        }
        SceneCharacter ch;
        ch.id = a.id;
        if (!load_skeleton(bytes.data(), bytes.size(), ch.data, e)) {
            err = a.skeleton.value + ": " + e;
            return false;
        }
        out.characters.push_back(std::move(ch));
    }
    out.scene = scene;
    out.init();
    return true;
}

void ScenePlayer::init() {
    for (size_t i = 0; i < characters.size(); i++) characters[i].pose.reset(new Pose(characters[i].data));
    pose.reset(new Pose(stage));
    Pose setup(stage);
    setup_camera = camera_position(stage, setup);
    shot = stage.animations.empty() ? Opt<std::string>() : Opt<std::string>(stage.animations[0].name);
    time = 0.0;
    looping = false;
}

const SceneCharacter* ScenePlayer::character(size_t actor) const {
    if (actor >= scene.actors.size()) return 0;
    const std::string& id = scene.actors[actor].id;
    for (size_t i = 0; i < characters.size(); i++)
        if (characters[i].id == id) return &characters[i];
    return 0;
}

void ScenePlayer::play(const std::string& s, bool loop) {
    shot = Opt<std::string>(s);
    time = 0.0;
    looping = loop;
    for (size_t i = 0; i < characters.size(); i++) characters[i].pose->reset_physics();
    evaluate(0.0);
}

double ScenePlayer::duration() const {
    std::string s = shot.value_or("");
    int a = stage.find_animation(s);
    double end = a >= 0 ? stage.animations[(size_t)a].duration : 0.0;
    for (size_t i = 0; i < scene.actors.size(); i++) {
        const Actor& actor = scene.actors[i];
        for (size_t c = 0; c < characters.size(); c++) {
            if (characters[c].id == actor.id) {
                end = std::fmax(end, actor_end(actor, characters[c].data, s));
                break;
            }
        }
    }
    return end;
}

void ScenePlayer::update(double dt) {
    double t = time + dt;
    double d = duration();
    if (d > 0.0 && t > d) t = looping ? std::fmod(t, d) : d;
    time = t;
    evaluate(dt);
}

void ScenePlayer::evaluate(double dt) {
    std::string s = shot.value_or("");
    pose->reset(stage);
    int a = stage.find_animation(s);
    if (a >= 0) pose->apply(stage, (size_t)a, std::fmin(time, stage.animations[(size_t)a].duration), 1.0);
    pose->physics_delta = dt;
    pose->update_world(stage);
    apply_parallax(stage, scene, *pose, setup_camera);
    for (size_t i = 0; i < scene.actors.size(); i++) {
        const Actor& actor = scene.actors[i];
        for (size_t c = 0; c < characters.size(); c++) {
            if (characters[c].id == actor.id) {
                pose_actor(stage, *pose, actor, characters[c].data, s, time, *characters[c].pose, dt);
                break;
            }
        }
    }
}

std::vector<SceneLayer> ScenePlayer::draw_list() const {
    return scene_draw_list(stage, scene, *pose);
}

std::vector<SceneLayer> scene_draw_list(const SkeletonData& stage, const Scene& scene, const Pose& pose) {
    std::vector<SceneLayer> out;
    for (size_t k = 0; k < pose.draw_order.size(); k++) {
        size_t i = pose.draw_order[k];
        if (i >= stage.slots.size()) continue;
        SceneLayer l;
        l.slot = i;
        l.actor = NONE;
        for (size_t a = scene.actors.size(); a-- > 0;) {
            if (scene.actors[a].slot == stage.slots[i].name) {
                l.actor = (int)a;
                break;
            }
        }
        for (int c = 0; c < 4; c++) l.tint[c] = pose.color[i].v[c];
        out.push_back(l);
    }
    return out;
}

}  // namespace rigby
