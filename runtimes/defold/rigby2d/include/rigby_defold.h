// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D models in Defold: what the engine's rigbymodel component (src/comp_rigby_model.cpp) and the
// editor's live preview (pluginsrc/plugin.cpp) share, so the editor draws exactly what the game
// draws. A model is a skeleton whose images come from a Defold atlas (a texture set), played by the
// C++ runtime and written as world-space triangles for the rigby2d material.

#ifndef RIGBY_DEFOLD_H
#define RIGBY_DEFOLD_H

#include <rigby.h>

namespace dmGameSystemDDF {
struct TextureSet;
}

namespace rigby {

/// Regions of a Defold atlas by image name, as UVs of its texture (one page). Images packed with
/// rotation are supported; trimmed images (sprite trim modes) are drawn from their whole rectangle.
std::unordered_map<std::string, RegionUv> texture_set_regions(const dmGameSystemDDF::TextureSet* ts);

/// A vertex for the rigby2d materials: world position, texture UV, light color, and dark color
/// (rgb, then has-dark + 2 * blend mode).
struct ModelVertex {
    float x, y, z;
    float u, v;
    float r, g, b, a;
    float dr, dg, db, da;
};

/// Skeleton data with its regions in a Defold atlas, shared by every instance of a model.
struct ModelData {
    SkeletonData sk;
    RegionLookup lookup;
    /// Images the skeleton uses that the atlas lacks.
    std::vector<std::string> missing;
};

/// Reads a skeleton (.json or .skel bytes) and maps its images onto the texture set.
bool load_model_data(const uint8_t* skeleton, size_t size, const dmGameSystemDDF::TextureSet* ts, ModelData& out, std::string& err);

/// One playing model: its pose, playback state and last frame's geometry.
struct ModelInstance {
    Pose pose;
    AnimationState state;
    RenderOutput out;
    double tint[4];

    explicit ModelInstance(const SkeletonData& sk);
    /// Shows a skin ("" or "default": the default skin only). False when there is no such skin.
    bool set_skin(const ModelData& d, const std::string& name);
    /// Advances playback by `dt` seconds and poses the skeleton.
    void update(const ModelData& d, double dt);
    /// Appends the current pose's triangles to `out` (unindexed), transformed by the column-major
    /// 4×4 matrix `m` (null: identity). Grows `bounds` (min x, min y, max x, max y in skeleton
    /// space). Returns the number of vertices written.
    size_t write(const ModelData& d, const float* m, std::vector<ModelVertex>& out, float* bounds);
};

}  // namespace rigby

#endif
