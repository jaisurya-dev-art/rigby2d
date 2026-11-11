// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D models in Defold (rigby_defold.h): Defold atlases as runtime regions, and a model instance
// written as world-space triangles. Shared by the engine component and the editor preview.

#include <rigby_defold.h>

#include <cmath>
#include <cstring>

#include <gamesys/texture_set_ddf.h>

namespace rigby {

// A Defold atlas stores each image's quad as four texture coordinates: bottom-left, top-left,
// top-right, bottom-right of the image (rotation already applied). The runtime maps an image
// pixel (x right, y down, about the image's center) to the page with a rotation about a center,
// dividing by the page size; here the page size is the texture's, and its height is negated when
// the texture's V runs opposite to the image's y.
static RegionUv region_from_quad(const float* tc, double tex_w, double tex_h) {
    // Texture pixels of the corners.
    const double bl[2] = {tc[0] * tex_w, tc[1] * tex_h};
    const double tl[2] = {tc[2] * tex_w, tc[3] * tex_h};
    const double tr[2] = {tc[4] * tex_w, tc[5] * tex_h};
    double ex[2] = {tr[0] - tl[0], tr[1] - tl[1]};  // image x axis
    double ey[2] = {bl[0] - tl[0], bl[1] - tl[1]};  // image y axis (down)
    const double w = std::sqrt(ex[0] * ex[0] + ex[1] * ex[1]);
    const double h = std::sqrt(ey[0] * ey[0] + ey[1] * ey[1]);
    double page_h = tex_h;
    double origin[2] = {tl[0], tl[1]};
    // A rotation keeps the axes' handedness: y = x turned a quarter clockwise. Otherwise flip V.
    const double cross = ex[0] * ey[1] - ex[1] * ey[0];
    if (cross < 0) {
        page_h = -tex_h;
        ex[1] = -ex[1];
        ey[1] = -ey[1];
        origin[1] = -origin[1];
    }
    RegionUv r;
    r.page = 0;
    r.ow = r.w = w > 0 ? w : 1;
    r.oh = r.h = h > 0 ? h : 1;
    r.dx = r.dy = 0;
    r.trim[0] = r.trim[1] = 0;
    r.trim[2] = r.trim[3] = 1;
    r.cos = w > 0 ? ex[0] / w : 1;
    r.sin = w > 0 ? ex[1] / w : 0;
    // map(): page = (src + c + R q) / page size, with q measured from the image's center.
    r.src_x = origin[0] + (ex[0] + ey[0]) / 2;
    r.src_y = origin[1] + (ex[1] + ey[1]) / 2;
    r.cx = r.cy = 0;
    r.page_w = tex_w;
    r.page_h = page_h;
    return r;
}

std::unordered_map<std::string, RegionUv> texture_set_regions(const dmGameSystemDDF::TextureSet* ts) {
    std::unordered_map<std::string, RegionUv> out;
    if (!ts) return out;
    const float* tc = (const float*)ts->m_TexCoords.m_Data;
    const uint32_t tiles = ts->m_TexCoords.m_Count / (8 * sizeof(float));
    const double tex_w = ts->m_Width > 0 ? ts->m_Width : 1;
    const double tex_h = ts->m_Height > 0 ? ts->m_Height : 1;
    for (uint32_t i = 0; i < ts->m_Animations.m_Count; i++) {
        const dmGameSystemDDF::TextureSetAnimation& anim = ts->m_Animations.m_Data[i];
        uint32_t frame = anim.m_Start;
        if (frame < ts->m_FrameIndices.m_Count) frame = ts->m_FrameIndices.m_Data[frame];
        if (frame >= tiles) continue;
        out[anim.m_Id] = region_from_quad(tc + frame * 8, tex_w, tex_h);
    }
    return out;
}

bool load_model_data(const uint8_t* skeleton, size_t size, const dmGameSystemDDF::TextureSet* ts, ModelData& out, std::string& err) {
    if (!load_skeleton(skeleton, size, out.sk, err)) return false;
    out.lookup = RegionLookup(out.sk, texture_set_regions(ts));
    out.missing = out.lookup.missing(out.sk);
    return true;
}

ModelInstance::ModelInstance(const SkeletonData& sk) : pose(sk) {
    for (int k = 0; k < 4; k++) tint[k] = 1.0;
    pose.set_to_setup(sk);
}

bool ModelInstance::set_skin(const ModelData& d, const std::string& name) {
    if (name.empty() || name == "default") {
        pose.skin = NONE;
        return true;
    }
    int skin = d.sk.find_skin(name);
    if (skin < 0) return false;
    pose.skin = skin;
    return true;
}

void ModelInstance::update(const ModelData& d, double dt) {
    state.update(d.sk, dt);
    state.apply(d.sk, pose);
}

size_t ModelInstance::write(const ModelData& d, const float* m, std::vector<ModelVertex>& vertices, float* bounds) {
    static const float identity[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    if (!m) m = identity;
    out.build(d.sk, pose, d.lookup, tint);
    const size_t start = vertices.size();
    for (size_t bi = 0; bi < out.count(); bi++) {
        const Batch& b = out.batch(bi);
        const float flags = (float)(2 * (int)b.blend);
        const size_t n = b.indices.size();
        const size_t at = vertices.size();
        vertices.resize(at + n);
        ModelVertex* v = &vertices[at];
        for (size_t k = 0; k < n; k++, v++) {
            const uint32_t i = b.indices[k];
            const float x = b.positions[i * 2], y = b.positions[i * 2 + 1];
            // Bounds cover what can be seen: fully transparent parts (a hidden effect) don't count.
            if (bounds && b.colors[i * 4 + 3] > 0) {
                if (x < bounds[0]) bounds[0] = x;
                if (y < bounds[1]) bounds[1] = y;
                if (x > bounds[2]) bounds[2] = x;
                if (y > bounds[3]) bounds[3] = y;
            }
            v->x = m[0] * x + m[4] * y + m[12];
            v->y = m[1] * x + m[5] * y + m[13];
            v->z = m[2] * x + m[6] * y + m[14];
            v->u = b.uvs[i * 2];
            v->v = b.uvs[i * 2 + 1];
            std::memcpy(&v->r, &b.colors[i * 4], 4 * sizeof(float));
            v->dr = b.darks[i * 4];
            v->dg = b.darks[i * 4 + 1];
            v->db = b.darks[i * 4 + 2];
            v->da = b.darks[i * 4 + 3] + flags;
        }
    }
    return vertices.size() - start;
}

}  // namespace rigby
