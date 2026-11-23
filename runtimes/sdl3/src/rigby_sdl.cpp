// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for SDL3: atlas pages as SDL textures, and the runtime's batches drawn with
// SDL_RenderGeometry (see rigby_sdl.h).

#include "rigby_sdl.h"

#ifdef RIGBY_SDL_IMAGE
#include <SDL3_image/SDL_image.h>
#endif

namespace rigby {
namespace sdl {

namespace {

/// The folder part of a path, with its trailing separator ("" for a bare file name).
std::string folder_of(const std::string& path) {
    size_t slash = path.find_last_of("/\\");
    return slash == std::string::npos ? std::string() : path.substr(0, slash + 1);
}

SDL_Texture* default_loader(SDL_Renderer* renderer, const std::string& path) {
#ifdef RIGBY_SDL_IMAGE
    return IMG_LoadTexture(renderer, path.c_str());
#else
#if SDL_VERSION_ATLEAST(3, 4, 0)
    // SDL 3.4 loads PNG (and BMP) itself.
    SDL_Surface* surface = SDL_LoadSurface(path.c_str());
#else
    SDL_Surface* surface = SDL_LoadBMP(path.c_str());
#endif
    if (!surface) return nullptr;
    SDL_Texture* texture = SDL_CreateTextureFromSurface(renderer, surface);
    SDL_DestroySurface(surface);
    return texture;
#endif
}

}  // namespace

SDL_BlendMode blend_mode(Blend blend, bool pma) {
    switch (blend) {
        case BlendAdditive:
            return pma ? SDL_BLENDMODE_ADD_PREMULTIPLIED : SDL_BLENDMODE_ADD;
        case BlendMultiply:
            // dst = src × dst + dst × (1 − src alpha), for straight and premultiplied colours alike.
            return SDL_BLENDMODE_MUL;
        case BlendScreen:
            // dst = src + dst × (1 − src): with straight colours, src is weighted by its alpha first.
            return SDL_ComposeCustomBlendMode(pma ? SDL_BLENDFACTOR_ONE : SDL_BLENDFACTOR_SRC_ALPHA, SDL_BLENDFACTOR_ONE_MINUS_SRC_COLOR, SDL_BLENDOPERATION_ADD, SDL_BLENDFACTOR_ONE, SDL_BLENDFACTOR_ONE_MINUS_SRC_ALPHA, SDL_BLENDOPERATION_ADD);
        default:
            return pma ? SDL_BLENDMODE_BLEND_PREMULTIPLIED : SDL_BLENDMODE_BLEND;
    }
}

// ---- Skeleton -----------------------------------------------------------------------------------

Skeleton::~Skeleton() { free_pages(); }

void Skeleton::free_pages() {
    for (SDL_Texture* t : pages) {
        if (t) SDL_DestroyTexture(t);
    }
    pages.clear();
    pma.clear();
}

bool Skeleton::load(SDL_Renderer* renderer, const std::string& skeleton_path, const std::string& atlas_path, std::string& err, TextureLoader loader) {
    size_t skel_size = 0;
    void* skel = SDL_LoadFile(skeleton_path.c_str(), &skel_size);
    if (!skel) {
        err = "cannot read " + skeleton_path + ": " + SDL_GetError();
        return false;
    }
    size_t atlas_size = 0;
    void* atlas_text = SDL_LoadFile(atlas_path.c_str(), &atlas_size);
    if (!atlas_text) {
        err = "cannot read " + atlas_path + ": " + SDL_GetError();
        SDL_free(skel);
        return false;
    }
    bool ok = load_memory(renderer, (const uint8_t*)skel, skel_size, (const char*)atlas_text, atlas_size, folder_of(atlas_path), err, loader);
    SDL_free(skel);
    SDL_free(atlas_text);
    return ok;
}

bool Skeleton::load_memory(SDL_Renderer* renderer, const uint8_t* skeleton, size_t skeleton_size, const char* atlas_text, size_t atlas_size, const std::string& page_dir, std::string& err, TextureLoader loader) {
    free_pages();
    data = SkeletonData();
    if (!load_skeleton(skeleton, skeleton_size, data, err)) return false;
    atlas = Atlas::parse(atlas_text, atlas_size);
    if (!loader) loader = default_loader;
    for (const AtlasPage& page : atlas.pages) {
        SDL_Texture* texture = loader(renderer, page_dir + page.name);
        if (!texture) {
            err = "cannot load atlas page " + page_dir + page.name + ": " + SDL_GetError();
            free_pages();
            return false;
        }
        // Nearest filtering for pixel art pages (the atlas says so), linear otherwise.
        SDL_SetTextureScaleMode(texture, page.filter[0] == "Nearest" ? SDL_SCALEMODE_NEAREST : SDL_SCALEMODE_LINEAR);
        pages.push_back(texture);
        pma.push_back(page.pma);
    }
    lookup_.reset(new RegionLookup(data, atlas));
    return true;
}

// ---- Character ----------------------------------------------------------------------------------

Character::Character(const Skeleton& s) : skeleton(s), pose(s.data) {
    tint[0] = tint[1] = tint[2] = tint[3] = 1.0f;
}

void Character::update(double dt) {
    state.update(skeleton.data, dt);
    state.apply(skeleton.data, pose);
}

bool Character::set_skin(const std::string& name) {
    if (name.empty()) {
        pose.skin = NONE;
        return true;
    }
    int skin = skeleton.data.find_skin(name);
    if (skin < 0) return false;
    pose.skin = skin;
    return true;
}

void Character::draw(SDL_Renderer* renderer, const View& view) {
    static const double WHITE[4] = {1, 1, 1, 1};
    output_.build(skeleton.data, pose, skeleton.lookup(), WHITE);
    for (size_t i = 0; i < output_.count(); i++) {
        const Batch& b = output_.batch(i);
        if (b.indices.empty() || b.page >= skeleton.pages.size()) continue;
        SDL_Texture* texture = skeleton.pages[b.page];
        bool pma = skeleton.pma[b.page];
        batch_vertices(b, view, pma, tint, vertices_, indices_);
        if (!SDL_SetTextureBlendMode(texture, blend_mode(b.blend, pma)) && b.blend == BlendScreen) {
            // The software renderer has no custom blend modes: additive is the nearest.
            SDL_SetTextureBlendMode(texture, blend_mode(BlendAdditive, pma));
        }
        SDL_RenderGeometry(renderer, texture, reinterpret_cast<const SDL_Vertex*>(vertices_.data()), (int)vertices_.size(), indices_.data(), (int)indices_.size());
    }
}

static_assert(sizeof(Vertex) == sizeof(SDL_Vertex), "rigby::sdl::Vertex must match SDL_Vertex");
static_assert(offsetof(Vertex, r) == offsetof(SDL_Vertex, color), "colour offset");
static_assert(offsetof(Vertex, u) == offsetof(SDL_Vertex, tex_coord), "texture coordinate offset");

}  // namespace sdl
}  // namespace rigby
