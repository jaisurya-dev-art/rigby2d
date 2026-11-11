// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): clipping attachments and draw batches. Ports clipping.rs and render.rs: a
// posed skeleton becomes textured triangles in draw order, mapped into atlas pages, masked by
// clipping attachments and split into batches by page and blend mode.

#include "rigby.h"

#include <cstring>

#include <algorithm>
#include <cmath>

namespace rigby {

namespace {

/// Signed area of a flat [x, y, ...] polygon (positive when counter-clockwise, Y up).
double signed_area(const std::vector<double>& p) {
    size_t n = p.size();
    double a = 0.0;
    for (size_t i = 0; i + 1 < n; i += 2) {
        size_t j = (i + 2) % n;
        a += p[i] * p[j + 1] - p[j] * p[i + 1];
    }
    return a / 2.0;
}

struct V {
    double x, y, u, v;
};

/// Clips a convex polygon against a counter-clockwise triangle (Sutherland-Hodgman).
void clip_convex(const V* poly, size_t count, const std::vector<double>& tri, std::vector<V>& out, std::vector<V>& tmp) {
    out.assign(poly, poly + count);
    for (int e = 0; e < 3; e++) {
        if (out.empty()) break;
        double ax = tri[(size_t)(2 * e)], ay = tri[(size_t)(2 * e + 1)];
        double bx = tri[(size_t)((2 * e + 2) % 6)], by = tri[(size_t)((2 * e + 3) % 6)];
        std::swap(out, tmp);
        out.clear();
        for (size_t i = 0; i < tmp.size(); i++) {
            const V p = tmp[i];
            const V q = tmp[(i + 1) % tmp.size()];
            double sp = (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
            double sq = (bx - ax) * (q.y - ay) - (by - ay) * (q.x - ax);
            if (sp >= 0.0) out.push_back(p);
            if ((sp >= 0.0) != (sq >= 0.0)) {
                double t = sp / (sp - sq);
                V r = {p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.u + (q.u - p.u) * t, p.v + (q.v - p.v) * t};
                out.push_back(r);
            }
        }
    }
}

const uint32_t QUAD[6] = {0, 1, 2, 0, 2, 3};

}  // namespace

std::vector<std::vector<double> > triangulate(const std::vector<double>& polygon) {
    std::vector<double> p = polygon;
    if (signed_area(p) < 0.0) {
        std::vector<double> r;
        r.reserve(p.size());
        for (long long i = (long long)p.size() - 2; i >= 0; i -= 2) {
            r.push_back(p[(size_t)i]);
            r.push_back(p[(size_t)i + 1]);
        }
        p = r;
    }
    std::vector<size_t> idx;
    for (size_t i = 0; i < p.size() / 2; i++) idx.push_back(i);
    struct Geo {
        const std::vector<double>& p;
        double x(size_t i) const { return p[2 * i]; }
        double y(size_t i) const { return p[2 * i + 1]; }
        double cross(size_t a, size_t b, size_t c) const { return (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a)); }
        bool inside(size_t a, size_t b, size_t c, size_t q) const { return cross(a, b, q) >= 0.0 && cross(b, c, q) >= 0.0 && cross(c, a, q) >= 0.0; }
    } g = {p};
    std::vector<std::vector<double> > out;
    int guard = 0;
    while (idx.size() > 3 && guard < 10000) {
        guard++;
        bool clipped = false;
        for (size_t k = 0; k < idx.size(); k++) {
            size_t a = idx[(k + idx.size() - 1) % idx.size()];
            size_t b = idx[k];
            size_t c = idx[(k + 1) % idx.size()];
            if (g.cross(a, b, c) <= 0.0) continue;  // reflex or degenerate corner
            bool contains = false;
            for (size_t m = 0; m < idx.size(); m++) {
                size_t q = idx[m];
                if (q != a && q != b && q != c && g.inside(a, b, c, q)) {
                    contains = true;
                    break;
                }
            }
            if (contains) continue;
            double t[6] = {g.x(a), g.y(a), g.x(b), g.y(b), g.x(c), g.y(c)};
            out.push_back(std::vector<double>(t, t + 6));
            idx.erase(idx.begin() + (long)k);
            clipped = true;
            break;
        }
        if (!clipped) break;  // self-intersecting input: keep what we have
    }
    if (idx.size() == 3) {
        double t[6] = {g.x(idx[0]), g.y(idx[0]), g.x(idx[1]), g.y(idx[1]), g.x(idx[2]), g.y(idx[2])};
        out.push_back(std::vector<double>(t, t + 6));
    }
    return out;
}

Clipper::Clipper(const std::vector<double>& polygon) : triangles_(triangulate(polygon)) {}

void Clipper::clip(const std::vector<double>& positions, const std::vector<double>& uvs, const uint32_t* triangles, size_t count,
                   std::vector<double>& out_p, std::vector<double>& out_uv, std::vector<uint32_t>& out_t) const {
    std::vector<V> poly, tmp;
    poly.reserve(9);
    tmp.reserve(9);
    for (size_t t = 0; t + 3 <= count; t += 3) {
        V tri[3];
        for (int k = 0; k < 3; k++) {
            size_t i = triangles[t + (size_t)k];
            V v = {positions[2 * i], positions[2 * i + 1], uvs[2 * i], uvs[2 * i + 1]};
            tri[k] = v;
        }
        // Counter-clockwise, so "inside" is on the left of every edge.
        double area = (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
        if (area < 0.0) std::swap(tri[1], tri[2]);
        for (size_t c = 0; c < triangles_.size(); c++) {
            clip_convex(tri, 3, triangles_[c], poly, tmp);
            if (poly.size() < 3) continue;
            uint32_t base = (uint32_t)(out_p.size() / 2);
            for (size_t k = 0; k < poly.size(); k++) {
                out_p.push_back(poly[k].x);
                out_p.push_back(poly[k].y);
                out_uv.push_back(poly[k].u);
                out_uv.push_back(poly[k].v);
            }
            for (uint32_t k = 1; k < (uint32_t)poly.size() - 1; k++) {
                out_t.push_back(base);
                out_t.push_back(base + k);
                out_t.push_back(base + k + 1);
            }
        }
    }
}

// ---- region lookup --------------------------------------------------------------------------------

RegionLookup::RegionLookup(const SkeletonData& sk, const Atlas& atlas) : RegionLookup(sk, atlas.lookup()) {}

RegionLookup::RegionLookup(const SkeletonData& sk, const std::unordered_map<std::string, RegionUv>& map) {
    regions_.resize(sk.names.size());
    for (size_t i = 0; i < sk.names.size(); i++) {
        std::unordered_map<std::string, RegionUv>::const_iterator it = map.find(sk.names[i]);
        if (it != map.end()) regions_[i] = Opt<RegionUv>(it->second);
    }
}

const RegionUv* RegionLookup::get(NameId image) const {
    if (image < 0 || (size_t)image >= regions_.size() || !regions_[(size_t)image].has) return 0;
    return &regions_[(size_t)image].value;
}

std::vector<std::string> RegionLookup::missing(const SkeletonData& sk) const {
    std::vector<NameId> used;
    for (size_t slot = 0; slot < sk.slots.size(); slot++) {
        std::vector<const Attachment*> all;
        for (size_t a = 0; a < sk.slots[slot].attachments.size(); a++) all.push_back(&sk.slots[slot].attachments[a]);
        for (size_t s = 0; s < sk.skins.size(); s++)
            for (size_t e = 0; e < sk.skins[s].slots.size(); e++)
                if (sk.skins[s].slots[e].first == slot)
                    for (size_t a = 0; a < sk.skins[s].slots[e].second.size(); a++) all.push_back(&sk.skins[s].slots[e].second[a]);
        for (size_t k = 0; k < all.size(); k++) {
            const Attachment& a = *all[k];
            if (a.kind != AttRegion && a.kind != AttMesh && a.kind != AttLinkedMesh) continue;
            if (a.has_sequence) used.insert(used.end(), a.sequence.frames.begin(), a.sequence.frames.end());
            else used.push_back(a.image);
        }
    }
    std::sort(used.begin(), used.end());
    used.erase(std::unique(used.begin(), used.end()), used.end());
    std::vector<std::string> out;
    for (size_t i = 0; i < used.size(); i++)
        if (!get(used[i])) out.push_back(sk.name(used[i]));
    return out;
}

// ---- render output --------------------------------------------------------------------------------

void RenderOutput::build(const SkeletonData& sk, const Pose& pose, const RegionLookup& lookup, const double* tint) {
    clear();
    append(sk, pose, lookup, tint, pose.draw_order, 0);
}

void RenderOutput::append(const SkeletonData& sk, const Pose& pose, const RegionLookup& lookup, const double* tint, const std::vector<size_t>& slots, size_t source) {
    source_ = source;
    std::unique_ptr<Clipper> clipper;
    int clip_end = NONE;
    std::vector<double> clip_vertices;
    for (size_t k = 0; k < slots.size(); k++) {
        size_t i = slots[k];
        const Attachment* att = pose.slot_attachment(sk, i);
        if (att) {
            if (att->kind == AttClipping) {
                pose.world_vertices(sk, i, *att, clip_vertices);
                clipper.reset(new Clipper(clip_vertices));
                clip_end = att->end == (int)i ? NONE : att->end;  // ending at its own slot: to the end
            } else if (att->kind == AttRegion || att->kind == AttMesh || att->kind == AttLinkedMesh) {
                draw_attachment(sk, pose, i, *att, lookup, tint, clipper.get());
            }
        }
        if (clipper && clip_end == (int)i) clipper.reset();
    }
}

void RenderOutput::draw_attachment(const SkeletonData& sk, const Pose& pose, size_t i, const Attachment& att, const RegionLookup& lookup, const double* tint, const Clipper* clipper) {
    bool is_region = att.kind == AttRegion;
    const Attachment* source = is_region ? &att : sk.mesh_source(i, &att, pose.skin);
    if (!source) return;
    NameId image = pose.image_of(i, att.kind == AttMesh ? *source : att);
    const RegionUv* entry = lookup.get(image);
    if (!entry) return;
    const double* c = pose.color[i].v;
    const double* ac = att.color;
    float light[4] = {(float)(c[0] * ac[0] * tint[0]), (float)(c[1] * ac[1] * tint[1]), (float)(c[2] * ac[2] * tint[2]), (float)(c[3] * ac[3] * tint[3])};
    float dark[4] = {0, 0, 0, 0};
    if (pose.dark[i].has) {
        dark[0] = (float)pose.dark[i].v[0];
        dark[1] = (float)pose.dark[i].v[1];
        dark[2] = (float)pose.dark[i].v[2];
        dark[3] = 1.0f;
    }
    Blend blend = sk.slots[i].blend;
    std::vector<double>& positions = scratch_p_;
    std::vector<double>& uvs = scratch_uv_;
    positions.clear();
    uvs.clear();
    const uint32_t* triangles;
    size_t tri_count;
    if (is_region) {
        // The packed (trimmed) part of the image, as corners of the attachment quad.
        Affine m = pose.attachment_world(sk, i, att.offset);
        double u0 = entry->trim[0], v0 = entry->trim[1], u1 = entry->trim[2], v1 = entry->trim[3];
        double hw = att.width / 2.0, hh = att.height / 2.0;
        double corners[8] = {u0, v0, u1, v0, u1, v1, u0, v1};
        for (int k = 0; k < 4; k++) {
            double u = corners[2 * k], v = corners[2 * k + 1];
            double lx = -hw + u * att.width;
            double ly = hh - v * att.height;
            double px, py, tu, tv;
            m.apply(lx, ly, px, py);
            positions.push_back(px);
            positions.push_back(py);
            entry->map(u, v, tu, tv);
            uvs.push_back(tu);
            uvs.push_back(tv);
        }
        triangles = QUAD;
        tri_count = 6;
    } else {
        pose.world_vertices(sk, i, att, positions);
        if (source->kind != AttMesh) return;
        const std::vector<double>& mesh_uvs = source->uvs;
        size_t n = positions.size() / 2;
        uvs.resize(2 * n);
        for (size_t k = 0; k < n; k++) {
            entry->map(2 * k < mesh_uvs.size() ? mesh_uvs[2 * k] : 0.0, 2 * k + 1 < mesh_uvs.size() ? mesh_uvs[2 * k + 1] : 0.0, uvs[2 * k], uvs[2 * k + 1]);
        }
        triangles = source->triangles.data();
        tri_count = source->triangles.size();
    }
    if (clipper) {
        clip_p_.clear();
        clip_uv_.clear();
        clip_t_.clear();
        clipper->clip(positions, uvs, triangles, tri_count, clip_p_, clip_uv_, clip_t_);
        if (!clip_t_.empty()) emit(entry->page, blend, clip_p_, clip_uv_, clip_t_.data(), clip_t_.size(), light, dark);
    } else {
        emit(entry->page, blend, positions, uvs, triangles, tri_count, light, dark);
    }
}

void RenderOutput::emit(size_t page, Blend blend, const std::vector<double>& positions, const std::vector<double>& uvs, const uint32_t* triangles, size_t count, const float* light, const float* dark) {
    bool continues = used_ > 0 && batches_[used_ - 1].source == source_ && batches_[used_ - 1].page == page && batches_[used_ - 1].blend == blend;
    if (!continues) {
        if (batches_.size() == used_) batches_.push_back(Batch());
        Batch& b = batches_[used_];
        b.source = source_;
        b.page = page;
        b.blend = blend;
        b.positions.clear();
        b.uvs.clear();
        b.colors.clear();
        b.darks.clear();
        b.indices.clear();
        used_++;
    }
    Batch& b = batches_[used_ - 1];
    uint32_t base = (uint32_t)(b.positions.size() / 2);
    size_t n = positions.size() / 2;
    // Grown once, then written in place: no per-value push_back on the hot path.
    b.positions.resize(b.positions.size() + 2 * n);
    b.uvs.resize(b.uvs.size() + 2 * n);
    b.colors.resize(b.colors.size() + 4 * n);
    b.darks.resize(b.darks.size() + 4 * n);
    float* po = &b.positions[2 * (size_t)base];
    float* uo = &b.uvs[2 * (size_t)base];
    float* co = &b.colors[4 * (size_t)base];
    float* dk = &b.darks[4 * (size_t)base];
    const double* pi = positions.data();
    const double* ui = uvs.data();
    for (size_t k = 0; k < 2 * n; k++) {
        po[k] = (float)pi[k];
        uo[k] = (float)ui[k];
    }
    for (size_t k = 0; k < n; k++) {
        std::memcpy(co + 4 * k, light, 4 * sizeof(float));
        std::memcpy(dk + 4 * k, dark, 4 * sizeof(float));
    }
    size_t i0 = b.indices.size();
    b.indices.resize(i0 + count);
    uint32_t* io = &b.indices[i0];
    for (size_t k = 0; k < count; k++) io[k] = base + triangles[k];
}

}  // namespace rigby
