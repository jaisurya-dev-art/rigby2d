// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for SDL3: plays Rigby2D skeleton exports (binary .skel or skeleton JSON, with their
// .atlas) with SDL3's 2D renderer. The animation runtime underneath is the C++ one the Defold
// runtime uses (runtimes/defold/rigby2d), golden-tested against the editor frame by frame; this
// layer loads the atlas pages as SDL textures and draws its batches with SDL_RenderGeometry.
//
//   rigby::sdl::Skeleton nila;
//   std::string err;
//   if (!nila.load(renderer, "nila.skel", "nila.atlas", err)) SDL_Log("%s", err.c_str());
//   rigby::sdl::Character c(nila);
//   c.state.set_animation(nila.data, 0, "idle", true, 0.0);
//   // each frame:
//   c.update(dt);
//   c.draw(renderer, rigby::sdl::View(640, 600, 0.5f));
//
// Not drawn: two-colour tint (the dark colour; SDL_RenderGeometry has one colour per vertex). Screen
// blending uses a custom SDL blend mode, which every GPU renderer supports; the software renderer
// falls back to additive.

#ifndef RIGBY_SDL_H
#define RIGBY_SDL_H

#include <SDL3/SDL.h>

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "rigby.h"
#include "rigby_geometry.h"

namespace rigby {
namespace sdl {

/// Loads an atlas page image as a texture (null on failure). The default uses SDL3_image when the
/// runtime is built with it (RIGBY_SDL_IMAGE), otherwise SDL's own loader: PNG and BMP on SDL 3.4,
/// BMP only on SDL 3.2.
typedef std::function<SDL_Texture*(SDL_Renderer*, const std::string& path)> TextureLoader;

/// A loaded skeleton export and its atlas pages, shared by every character that uses it.
class Skeleton {
public:
    SkeletonData data;
    Atlas atlas;
    /// One texture per atlas page, and whether the page has premultiplied alpha.
    std::vector<SDL_Texture*> pages;
    std::vector<bool> pma;

    Skeleton() {}
    ~Skeleton();
    Skeleton(const Skeleton&) = delete;
    Skeleton& operator=(const Skeleton&) = delete;

    /// Loads `skeleton_path` (.skel or .json) and `atlas_path` with its page images (next to the
    /// atlas). False with `err` on failure. The textures belong to `renderer`.
    bool load(SDL_Renderer* renderer, const std::string& skeleton_path, const std::string& atlas_path, std::string& err, TextureLoader loader = TextureLoader());
    /// Same, from bytes in memory; `page_dir` is where the page images are.
    bool load_memory(SDL_Renderer* renderer, const uint8_t* skeleton, size_t skeleton_size, const char* atlas_text, size_t atlas_size, const std::string& page_dir, std::string& err, TextureLoader loader = TextureLoader());

    const RegionLookup& lookup() const { return *lookup_; }

private:
    std::unique_ptr<RegionLookup> lookup_;
    void free_pages();
};

/// One character on screen: its own pose and animation state over a shared Skeleton.
class Character {
public:
    const Skeleton& skeleton;
    Pose pose;
    AnimationState state;
    /// Multiplies every colour (straight alpha): fades and flashes.
    float tint[4];

    explicit Character(const Skeleton& s);

    /// Advances the animations by `dt` seconds (physics included) and poses the skeleton.
    void update(double dt);
    /// Sets the active skin by name (empty = the default skin). False when there is no such skin.
    bool set_skin(const std::string& name);
    /// Draws the posed skeleton with `renderer` at `view`.
    void draw(SDL_Renderer* renderer, const View& view);

    /// Events fired since the last call (starts, completes, user events): see AnimationState.
    std::vector<StateEvent> events() { return state.drain_events(); }

private:
    RenderOutput output_;
    std::vector<Vertex> vertices_;
    std::vector<int> indices_;
};

/// The SDL blend mode for a Rigby2D blend mode (`pma`: premultiplied textures).
SDL_BlendMode blend_mode(Blend blend, bool pma);

}  // namespace sdl
}  // namespace rigby

#endif
