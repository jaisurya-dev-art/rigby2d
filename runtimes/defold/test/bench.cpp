// SPDX-License-Identifier: MIT OR Apache-2.0
// Times animating one character for one frame (apply the animation, solve constraints, compute
// world transforms and vertices), median of 2000 frames, like the Rust runtime's bench example,
// plus building the draw batches:
//   g++ -std=c++17 -O2 -I runtimes/defold/rigby2d/src runtimes/defold/test/bench.cpp runtimes/defold/rigby2d/src/rigby_*.cpp -o bench
//   ./bench <skeleton> [animation] [atlas]
#include "rigby.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <iterator>

static std::string read_file(const char* path) {
    std::ifstream f(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
}

static double median(std::vector<double>& t) {
    std::sort(t.begin(), t.end());
    return t[t.size() / 2];
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: bench <skeleton file> [animation] [atlas]\n");
        return 1;
    }
    std::string bytes = read_file(argv[1]);
    rigby::SkeletonData data;
    std::string err;
    if (!rigby::load_skeleton((const uint8_t*)bytes.data(), bytes.size(), data, err)) {
        std::fprintf(stderr, "%s\n", err.c_str());
        return 1;
    }
    std::string anim = argc > 2 ? argv[2] : (data.find_animation("walk") >= 0 ? "walk" : data.animations[0].name);
    rigby::Atlas atlas;
    if (argc > 3) {
        std::string text = read_file(argv[3]);
        atlas = rigby::Atlas::parse(text.data(), text.size());
    }
    rigby::RegionLookup lookup(data, atlas);
    rigby::Pose pose(data);
    rigby::AnimationState state;
    rigby::RenderOutput out;
    const double tint[4] = {1, 1, 1, 1};
    state.play(data, anim, true, 0.0);
    std::vector<double> pose_us, build_us;
    size_t sink = 0;
    for (int i = 0; i < 2200; i++) {
        auto t0 = std::chrono::steady_clock::now();
        state.update(data, 1.0 / 60.0);
        state.apply(data, pose);
        sink += pose.quads(data).size();
        auto t1 = std::chrono::steady_clock::now();
        out.build(data, pose, lookup, tint);
        sink += out.count();
        auto t2 = std::chrono::steady_clock::now();
        if (i >= 200) {
            pose_us.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
            build_us.push_back(std::chrono::duration<double, std::micro>(t2 - t1).count());
        }
    }
    std::printf("%s '%s': %zu bones, median %.1f us per frame, batches %.1f us (%zu)\n", argv[1], anim.c_str(), data.bones.size(), median(pose_us),
                median(build_us), sink % 7);
    return 0;
}
