// SPDX-License-Identifier: MIT OR Apache-2.0
// Turns the C++ runtime's render batches (world space, Y up, straight-alpha colours) into screen
// vertices for a 2D renderer: a view places and scales the skeleton, Y flips to point down, and
// colours are premultiplied when the atlas page is. No SDL here, so it is testable on its own;
// rigby_sdl.h feeds the result to SDL_RenderGeometry (Vertex has SDL_Vertex's exact layout).

#ifndef RIGBY_GEOMETRY_H
#define RIGBY_GEOMETRY_H

#include "rigby.h"

#include <vector>

namespace rigby {
namespace sdl {

/// A screen vertex: position (pixels, Y down), colour (0..1), texture coordinates (0..1).
struct Vertex {
    float x, y;
    float r, g, b, a;
    float u, v;
};

/// Where a skeleton is drawn: its origin at (x, y) on screen, `scale` pixels per world unit.
struct View {
    float x, y, scale;
    /// Mirrors the skeleton horizontally (a character facing left).
    bool flip_x;
    View() : x(0), y(0), scale(1), flip_x(false) {}
    View(float x_, float y_, float scale_ = 1, bool flip = false) : x(x_), y(y_), scale(scale_), flip_x(flip) {}
};

/**
 * Screen vertices and indices of one batch. `pma`: the batch's atlas page has premultiplied alpha
 * (colours are premultiplied to match). `tint` multiplies every colour (straight alpha).
 */
inline void batch_vertices(const Batch& b, const View& view, bool pma, const float* tint, std::vector<Vertex>& out, std::vector<int>& indices) {
    const size_t n = b.positions.size() / 2;
    out.resize(n);
    const float sx = view.flip_x ? -view.scale : view.scale;
    for (size_t i = 0; i < n; i++) {
        Vertex& v = out[i];
        v.x = view.x + b.positions[2 * i] * sx;
        v.y = view.y - b.positions[2 * i + 1] * view.scale;
        float r = b.colors[4 * i], g = b.colors[4 * i + 1], bl = b.colors[4 * i + 2], a = b.colors[4 * i + 3];
        if (tint) {
            r *= tint[0];
            g *= tint[1];
            bl *= tint[2];
            a *= tint[3];
        }
        if (pma) {
            r *= a;
            g *= a;
            bl *= a;
        }
        v.r = r;
        v.g = g;
        v.b = bl;
        v.a = a;
        v.u = b.uvs[2 * i];
        v.v = b.uvs[2 * i + 1];
    }
    indices.resize(b.indices.size());
    for (size_t i = 0; i < b.indices.size(); i++) indices[i] = (int)b.indices[i];
    // Mirroring reverses the winding; 2D renderers draw both windings, so nothing else changes.
}

}  // namespace sdl
}  // namespace rigby

#endif
