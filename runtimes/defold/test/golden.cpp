// SPDX-License-Identifier: MIT OR Apache-2.0
// Golden tests: the C++ runtime must reproduce the JavaScript runtime (src/core) frame by frame, like
// the Rust runtime does (runtimes/rust/rigby-runtime/tests/golden.rs, which this mirrors). Golden
// files come from runtimes/rust/rigby-runtime/tests/golden/generate.mjs; more can be given with the
// RIGBY_GOLDEN_DIR environment variable.
//
//   g++ -std=c++17 -O2 -I runtimes/defold/rigby2d/include runtimes/defold/test/golden.cpp runtimes/defold/rigby2d/commonsrc/rigby_*.cpp -o golden
//   ./golden [repo root]

#include "rigby.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace rigby;

static const double DT = 1.0 / 30.0;

static bool read_file(const fs::path& p, std::vector<uint8_t>& out) {
    std::ifstream f(p, std::ios::binary);
    if (!f) return false;
    out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
    return true;
}

static Json read_json(const fs::path& p) {
    std::vector<uint8_t> bytes;
    if (!read_file(p, bytes)) {
        fprintf(stderr, "cannot read %s\n", p.string().c_str());
        exit(2);
    }
    Json j;
    std::string err;
    if (!Json::parse((const char*)bytes.data(), bytes.size(), j, err)) {
        fprintf(stderr, "%s: %s\n", p.string().c_str(), err.c_str());
        exit(2);
    }
    return j;
}

static double as_f64(const Json& j) {
    return j.is_num() ? j.n : NAN;
}

static double close_err(double a, double b, double rel) {
    if (a == b || (std::isnan(a) && std::isnan(b))) return 0.0;
    return std::fabs(a - b) / std::max(1.0, std::max(std::fabs(a), std::fabs(b))) / rel;
}

/// Formats a number like JavaScript's String(n) for the values events use.
static std::string js_number(double v) {
    char buf[64];
    if (v == std::trunc(v) && std::fabs(v) < 1e15) {
        snprintf(buf, sizeof buf, "%lld", (long long)v);
        return buf;
    }
    for (int p = 1; p <= 17; p++) {
        snprintf(buf, sizeof buf, "%.*g", p, v);
        if (strtod(buf, 0) == v) break;
    }
    return buf;
}

struct Worst {
    double world = 0, positions = 0, color = 0;
    std::string at;
};

static std::vector<std::string> split_names(const std::string& s) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == '>' || c == '+') {
            out.push_back(cur);
            cur.clear();
        } else {
            cur += c;
        }
    }
    out.push_back(cur);
    return out;
}

/// Plays one scenario the way generate.mjs does, returning problems found.
static std::vector<std::string> replay(const SkeletonData& sk, const Json& scenario, Worst& worst, const std::string& label) {
    std::vector<std::string> problems;
    std::string kind = scenario.str_or("kind", "");
    std::string animation = scenario.str_or("animation", "");
    Pose pose(sk);
    pose.skin = scenario.get("skin").is_str() ? sk.find_skin(scenario.get("skin").s) : NONE;
    AnimationState state;
    const std::vector<Json>& frames = scenario.get("frames").arr;
    size_t steps, every;
    if (kind == "setup") steps = 1, every = 1;
    else if (kind == "mix") steps = 45, every = 2;
    else if (kind == "skin") steps = 20, every = 5;
    else steps = frames.size() * 3, every = 3;
    std::vector<std::string> names = split_names(animation);
    auto setup = [&](size_t i) {
        if ((kind == "loop" || kind == "skin") && i == 0) {
            state.set_animation(sk, 0, animation, true, 0.0);
        } else if (kind == "mix") {
            if (i == 0) state.set_animation(sk, 0, names[0], true, 0.0);
            if (i == 12) {
                state.set_animation(sk, 0, names[1], true, 0.25);
                if (state.set_animation(sk, 1, names[2], false, 0.0).has) state.current(1)->alpha = 0.5;
                state.add_animation(sk, 0, names[0], true, 0.2, Opt<double>(0.5));
            }
        }
    };
    setup(0);
    std::vector<std::string> events;
    size_t f = 0;
    for (size_t i = 1; i <= steps; i++) {
        setup(i);
        state.update(sk, DT);
        state.apply(sk, pose);
        for (const StateEvent& e : state.drain_events()) {
            const std::string& name = sk.animations[e.animation].name;
            char track[32];
            snprintf(track, sizeof track, "%lu", (unsigned long)e.track);
            if (e.kind == EventKeyed) events.push_back(std::string(track) + ":" + e.event.name + "@" + js_number(e.event.time));
            else if (e.kind == EventComplete) events.push_back(std::string(track) + ":complete:" + name);
        }
        if (i % every != 0) continue;
        if (f >= frames.size()) break;
        const Json& expected = frames[f];
        f++;
        char at[256];
        snprintf(at, sizeof at, "%s %s '%s' frame %lu", label.c_str(), kind.c_str(), animation.c_str(), (unsigned long)f);
        const std::vector<Json>& world = expected.get("world").arr;
        for (size_t b = 0; b < pose.world.size(); b++) {
            const Affine& m = pose.world[b];
            double vals[6] = {m.a, m.b, m.c, m.d, m.tx, m.ty};
            for (size_t k = 0; k < 6; k++) {
                double js = b * 6 + k < world.size() ? as_f64(world[b * 6 + k]) : NAN;
                double e = close_err(vals[k], js, 1.0);
                if (e > worst.world) {
                    worst.world = e;
                    char buf[256];
                    snprintf(buf, sizeof buf, "%s, bone %s value %lu: c++ %.17g js %.17g", at, sk.bones[b].name.c_str(), (unsigned long)k, vals[k], js);
                    worst.at = buf;
                }
            }
        }
        const std::vector<Json>& order = expected.get("drawOrder").arr;
        bool same_order = order.size() == pose.draw_order.size();
        for (size_t k = 0; same_order && k < order.size(); k++)
            if ((size_t)as_f64(order[k]) != pose.draw_order[k]) same_order = false;
        if (!same_order) problems.push_back(std::string(at) + ": draw order differs");
        std::vector<Quad> quads = pose.quads(sk);
        const std::vector<Json>& expected_quads = expected.get("quads").arr;
        if (quads.size() != expected_quads.size()) {
            char buf[320];
            snprintf(buf, sizeof buf, "%s: %lu drawables, expected %lu", at, (unsigned long)quads.size(), (unsigned long)expected_quads.size());
            problems.push_back(buf);
            continue;
        }
        for (size_t q = 0; q < quads.size(); q++) {
            const Quad& quad = quads[q];
            const Json& e = expected_quads[q];
            if (quad.slot != (size_t)e.num("slot", -1.0) || sk.name(quad.image) != e.str_or("image", "")) {
                problems.push_back(std::string(at) + ": slot " + sk.slots[quad.slot].name + " shows '" + sk.name(quad.image) + "', expected '" + e.str_or("image", "") + "'");
                continue;
            }
            const std::vector<Json>& pos = e.get("positions").arr;
            if (pos.size() != quad.positions.size()) {
                problems.push_back(std::string(at) + ": slot " + sk.slots[quad.slot].name + " has a different vertex count");
                continue;
            }
            for (size_t k = 0; k < pos.size(); k++) worst.positions = std::max(worst.positions, close_err(quad.positions[k], as_f64(pos[k]), 1.0));
            const std::vector<Json>& col = e.get("color").arr;
            for (size_t k = 0; k < 4; k++) worst.color = std::max(worst.color, close_err(quad.color[k], k < col.size() ? as_f64(col[k]) : NAN, 1.0));
        }
        std::vector<std::string> expected_events;
        for (const Json& v : expected.get("events").arr) expected_events.push_back(v.is_str() ? v.s : "");
        if (expected_events != events) {
            std::string got, want;
            for (auto& s : events) got += s + " ";
            for (auto& s : expected_events) want += s + " ";
            problems.push_back(std::string(at) + ": events [" + got + "], expected [" + want + "]");
        }
        events.clear();
    }
    return problems;
}

static std::pair<double, size_t> world_error(const Pose& pose, const Json& expected) {
    const std::vector<Json>& world = expected.arr;
    std::pair<double, size_t> worst(0.0, 0);
    for (size_t b = 0; b < pose.world.size(); b++) {
        const Affine& m = pose.world[b];
        double vals[6] = {m.a, m.b, m.c, m.d, m.tx, m.ty};
        for (size_t k = 0; k < 6; k++) {
            double e = close_err(vals[k], b * 6 + k < world.size() ? as_f64(world[b * 6 + k]) : NAN, 1.0);
            if (e > worst.first) worst = std::make_pair(e, b);
        }
    }
    return worst;
}

struct SceneDir {
    fs::path dir;
};

static bool read_scene_file(void* ctx, const std::string& file, std::vector<uint8_t>& out, std::string& err) {
    fs::path p = ((SceneDir*)ctx)->dir / file;
    if (!read_file(p, out)) {
        err = "cannot read " + p.string();
        return false;
    }
    return true;
}

int main(int argc, char** argv) {
    fs::path root = argc > 1 ? fs::path(argv[1]) : fs::current_path();
    std::vector<fs::path> dirs = {root / "runtimes/rust/rigby-runtime/tests/golden"};
    if (const char* extra = getenv("RIGBY_GOLDEN_DIR")) dirs.push_back(extra);
    std::vector<fs::path> files;
    for (const fs::path& d : dirs) {
        for (const auto& e : fs::directory_iterator(d)) {
            std::string name = e.path().filename().string();
            if (name.size() > 12 && name.substr(name.size() - 12) == ".golden.json") files.push_back(e.path());
        }
    }
    std::sort(files.begin(), files.end());
    if (files.empty()) {
        fprintf(stderr, "no golden files\n");
        return 1;
    }
    std::vector<std::string> failures;
    int skeletons = 0, scenes = 0;
    for (const fs::path& file : files) {
        Json golden = read_json(file);
        std::string label = golden.str_or("label", "?");
        if (golden.has("scene")) {
            scenes++;
            fs::path manifest = root / golden.str_or("scene", "");
            std::vector<uint8_t> bytes;
            if (!read_file(manifest, bytes)) {
                failures.push_back(label + ": missing " + manifest.string());
                continue;
            }
            SceneDir ctx = {manifest.parent_path()};
            ScenePlayer player;
            std::string err;
            if (!load_scene(bytes.data(), bytes.size(), read_scene_file, &ctx, player, err)) {
                failures.push_back(label + ": load failed: " + err);
                continue;
            }
            double worst_world = 0, worst_pos = 0;
            std::string at;
            for (const Json& shot : golden.get("shots").arr) {
                std::string name = shot.str_or("shot", "");
                player.play(name, true);
                const std::vector<Json>& frames = shot.get("frames").arr;
                size_t f = 0;
                for (size_t i = 1;; i++) {
                    player.update(DT);
                    if (i % 3 != 0) continue;
                    if (f >= frames.size()) break;
                    const Json& expected = frames[f];
                    f++;
                    char here[200];
                    snprintf(here, sizeof here, "%s '%s' frame %lu", label.c_str(), name.c_str(), (unsigned long)f);
                    if (close_err(player.time, expected.num("time", NAN), 1.0) > 1e-9) failures.push_back(std::string(here) + ": time differs");
                    std::pair<double, size_t> e = world_error(*player.pose, expected.get("stage"));
                    if (e.first > worst_world) {
                        worst_world = e.first;
                        at = std::string(here) + ", stage bone " + player.stage.bones[e.second].name;
                    }
                    std::vector<SceneLayer> layers = scene_draw_list(player.stage, player.scene, *player.pose);
                    const std::vector<Json>& want_layers = expected.get("layers").arr;
                    bool same = layers.size() == want_layers.size();
                    for (size_t k = 0; same && k < layers.size(); k++) {
                        const std::vector<Json>& w = want_layers[k].arr;
                        if ((double)layers[k].slot != as_f64(w[0]) || (double)layers[k].actor != as_f64(w[1])) same = false;
                    }
                    if (!same) failures.push_back(std::string(here) + ": draw list differs");
                    for (const Json& a : expected.get("actors").arr) {
                        std::string id = a.str_or("id", "");
                        const SceneCharacter* c = 0;
                        for (const SceneCharacter& ch : player.characters)
                            if (ch.id == id) c = &ch;
                        if (!c) {
                            failures.push_back(std::string(here) + ": no character '" + id + "'");
                            continue;
                        }
                        std::pair<double, size_t> ce = world_error(*c->pose, a.get("world"));
                        if (ce.first > worst_world) {
                            worst_world = ce.first;
                            at = std::string(here) + ", " + id + " bone " + c->data.bones[ce.second].name;
                        }
                        if (a.get("quads").is_null()) continue;
                        std::vector<Quad> quads = c->pose->quads(c->data);
                        const std::vector<Json>& want = a.get("quads").arr;
                        if (quads.size() != want.size()) {
                            failures.push_back(std::string(here) + ": " + id + " drawable count differs");
                            continue;
                        }
                        for (size_t q = 0; q < quads.size(); q++) {
                            if (c->data.name(quads[q].image) != want[q].str_or("image", "")) {
                                failures.push_back(std::string(here) + ": " + id + " shows a different image");
                                continue;
                            }
                            const std::vector<Json>& wp = want[q].get("positions").arr;
                            for (size_t k = 0; k < quads[q].positions.size(); k++) worst_pos = std::max(worst_pos, close_err(quads[q].positions[k], k < wp.size() ? as_f64(wp[k]) : NAN, 1.0));
                        }
                    }
                }
                if (f != frames.size()) failures.push_back(label + " '" + name + "': not every frame played");
            }
            printf("%s: max relative error world %.2e (%s), positions %.2e\n", label.c_str(), worst_world, at.c_str(), worst_pos);
            if (worst_world > 1e-6 || worst_pos > 1e-6) {
                char buf[512];
                snprintf(buf, sizeof buf, "%s: world error %.2e at %s, positions %.2e", label.c_str(), worst_world, at.c_str(), worst_pos);
                failures.push_back(buf);
            }
            continue;
        }
        skeletons++;
        fs::path source = root / golden.str_or("file", "");
        std::vector<uint8_t> bytes;
        if (!read_file(source, bytes)) {
            failures.push_back(label + ": missing " + source.string());
            continue;
        }
        SkeletonData sk;
        std::string err;
        if (!load_skeleton(bytes.data(), bytes.size(), sk, err)) {
            failures.push_back(label + ": load failed: " + err);
            continue;
        }
        Worst worst;
        std::vector<std::string> problems;
        for (const Json& scenario : golden.get("scenarios").arr) {
            std::vector<std::string> p = replay(sk, scenario, worst, label);
            problems.insert(problems.end(), p.begin(), p.end());
        }
        printf("%s: max relative error world %.2e, positions %.2e, color %.2e\n", label.c_str(), worst.world, worst.positions, worst.color);
        // Tolerances: float operations happen in a slightly different order than in JavaScript.
        if (worst.world > 1e-6) {
            char buf[512];
            snprintf(buf, sizeof buf, "%s: world error %.2e at %s", label.c_str(), worst.world, worst.at.c_str());
            failures.push_back(buf);
        }
        if (worst.positions > 1e-6 || worst.color > 1e-9) {
            char buf[256];
            snprintf(buf, sizeof buf, "%s: drawable error positions %.2e, color %.2e", label.c_str(), worst.positions, worst.color);
            failures.push_back(buf);
        }
        for (size_t i = 0; i < problems.size() && i < 8; i++) failures.push_back(problems[i]);
        if (problems.size() > 8) failures.push_back(label + ": ... more problems");
    }
    printf("%d skeleton and %d scene golden file(s)\n", skeletons, scenes);
    if (!failures.empty()) {
        for (size_t i = 0; i < failures.size() && i < 20; i++) printf("FAIL %s\n", failures[i].c_str());
        return 1;
    }
    printf("ok: the C++ runtime matches the JavaScript runtime frame by frame\n");
    return 0;
}
