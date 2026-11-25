// SPDX-License-Identifier: MIT OR Apache-2.0
// Checks the SDL3 layer's geometry (rigby_geometry.h) on a real export, without SDL: every batch
// becomes screen vertices with the view's placement, Y pointing down, and premultiplied colours
// for premultiplied pages.
//
//   g++ -std=c++17 -O2 -I runtimes/sdl3/include -I runtimes/defold/rigby2d/include runtimes/sdl3/test/geometry.cpp runtimes/defold/rigby2d/commonsrc/rigby_*.cpp -o geometry
//   ./geometry [repo root]

#include "rigby_geometry.h"

#include <cmath>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

using namespace rigby;

static int failures = 0;
#define CHECK(cond, ...)                      \
    do {                                      \
        if (!(cond)) {                        \
            std::printf("FAIL: " __VA_ARGS__); \
            std::printf("\n");                \
            failures++;                       \
        }                                     \
    } while (0)

static std::vector<uint8_t> read_file(const std::string& p) {
    std::ifstream f(p, std::ios::binary);
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
}

int main(int argc, char** argv) {
    std::string root = argc > 1 ? std::string(argv[1]) + "/" : std::string();
    std::vector<uint8_t> skel = read_file(root + "branding/nila/export/nila.skel");
    std::vector<uint8_t> atlas_text = read_file(root + "branding/nila/export/nila.atlas");
    if (skel.empty() || atlas_text.empty()) {
        std::printf("FAIL: run from the repository root (or pass it)\n");
        return 1;
    }
    SkeletonData sk;
    std::string err;
    CHECK(load_skeleton(skel.data(), skel.size(), sk, err), "load: %s", err.c_str());
    Atlas atlas = Atlas::parse((const char*)atlas_text.data(), atlas_text.size());
    RegionLookup lookup(sk, atlas);
    Pose pose(sk);
    AnimationState state;
    state.set_animation(sk, 0, sk.animations[0].name, true, 0.0);
    state.update(sk, 0.25);
    state.apply(sk, pose);
    RenderOutput out;
    static const double WHITE[4] = {1, 1, 1, 1};
    out.build(sk, pose, lookup, WHITE);
    CHECK(out.count() > 0, "no batches");

    const sdl::View view(640, 600, 0.5f);
    const float tint[4] = {1, 1, 1, 0.5f};
    std::vector<sdl::Vertex> v;
    std::vector<int> idx;
    size_t vertices = 0;
    for (size_t i = 0; i < out.count(); i++) {
        const Batch& b = out.batch(i);
        sdl::batch_vertices(b, view, false, nullptr, v, idx);
        CHECK(v.size() * 2 == b.positions.size(), "vertex count");
        CHECK(idx.size() == b.indices.size(), "index count");
        for (size_t k = 0; k < v.size(); k++) {
            CHECK(std::fabs(v[k].x - (640 + b.positions[2 * k] * 0.5f)) < 1e-3f, "x placement");
            CHECK(std::fabs(v[k].y - (600 - b.positions[2 * k + 1] * 0.5f)) < 1e-3f, "y points down");
            CHECK(v[k].u == b.uvs[2 * k] && v[k].v == b.uvs[2 * k + 1], "uvs copied");
        }
        for (int t : idx) CHECK(t >= 0 && (size_t)t < v.size(), "index in range");
        // Premultiplied with a tint: colour × tint, then × alpha.
        sdl::batch_vertices(b, view, true, tint, v, idx);
        for (size_t k = 0; k < v.size(); k++) {
            float a = b.colors[4 * k + 3] * 0.5f;
            CHECK(std::fabs(v[k].a - a) < 1e-6f, "tinted alpha");
            CHECK(std::fabs(v[k].r - b.colors[4 * k] * a) < 1e-6f, "premultiplied red");
        }
        // Mirrored: x mirrors about the view's origin.
        sdl::batch_vertices(b, sdl::View(640, 600, 0.5f, true), false, nullptr, v, idx);
        for (size_t k = 0; k < v.size(); k++) CHECK(std::fabs(v[k].x - (640 - b.positions[2 * k] * 0.5f)) < 1e-3f, "flip_x");
        vertices += v.size();
    }
    std::printf("%zu batches, %zu vertices\n", out.count(), vertices);
    if (failures) {
        std::printf("%d failure(s)\n", failures);
        return 1;
    }
    std::printf("ok\n");
    return 0;
}
