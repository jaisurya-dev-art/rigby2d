// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): reads skeleton JSON (3.8, 4.x) into SkeletonData. Port of reader.rs; binary
// .skel files are first converted to the same structure (rigby_binary.cpp).

#include "rigby.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace rigby {

namespace {

/// Name of the skeleton header field holding the format version (fixed by the file format).
const char* const VERSION_FIELD = "spine";

/// Float to index the way Rust's `as usize` does: NaN and negatives are 0, too large saturates.
size_t to_index(double v) {
    if (!(v > 0.0)) return 0;
    if (v >= 1.8446744073709552e19) return (size_t)-1;
    return (size_t)v;
}

int64_t to_i64(double v) {
    if (std::isnan(v)) return 0;
    if (v >= 9.2233720368547758e18) return INT64_MAX;
    if (v <= -9.2233720368547758e18) return INT64_MIN;
    return (int64_t)v;
}

uint32_t to_u32(double v) {
    if (!(v > 0.0)) return 0;
    if (v >= 4294967295.0) return 0xffffffffu;
    return (uint32_t)v;
}

/// JavaScript Math.round.
double js_round(double v) {
    return std::floor(v + 0.5);
}

double round5(double v) {
    return js_round(v * 1e5) / 1e5;
}

bool is_hex(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

int hex_digit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return c - 'A' + 10;
}

/// Parses "rrggbb" or "rrggbbaa" into 0..1 components; `def` when invalid. A 6-digit color gets
/// alpha 1 when `def` has 4 components.
std::vector<double> hex_to_color(const Json& hex, const std::vector<double>& def) {
    if (!hex.is_str()) return def;
    const std::string& s = hex.s;
    if (!(s.size() == 6 || s.size() == 8)) return def;
    for (size_t i = 0; i < s.size(); i++)
        if (!is_hex(s[i])) return def;
    std::vector<double> c;
    for (size_t i = 0; i < s.size(); i += 2) c.push_back((double)(hex_digit(s[i]) * 16 + hex_digit(s[i + 1])) / 255.0);
    if (c.size() == 3 && def.size() == 4) c.push_back(1.0);
    return c;
}

const std::vector<double>& white() {
    static const std::vector<double> w(4, 1.0);
    return w;
}

const std::vector<double>& rgb_white() {
    static const std::vector<double> w(3, 1.0);
    return w;
}

const std::vector<double>& rgb_black() {
    static const std::vector<double> w(3, 0.0);
    return w;
}

void color4(const std::vector<double>& v, double* out) {
    for (size_t k = 0; k < 4; k++) out[k] = k < v.size() ? v[k] : 1.0;
}

std::vector<double> default_attachment_color(const std::string& kind) {
    const char* hex = 0;
    if (kind == "boundingbox") hex = "60F000FF";
    else if (kind == "path") hex = "FF7F00FF";
    else if (kind == "point") hex = "F1F100FF";
    else if (kind == "clipping") hex = "CE3A3AFF";
    if (!hex) return white();
    std::vector<double> c = hex_to_color(Json::string(hex), white());
    std::vector<double> out(4);
    color4(c, out.data());
    return out;
}

std::vector<double> nums(const Json& v) {
    std::vector<double> out;
    out.reserve(v.arr.size());
    for (size_t i = 0; i < v.arr.size(); i++) out.push_back(v.arr[i].is_num() ? v.arr[i].n : 0.0);
    return out;
}

/// Splits a packed vertex array into plain floats or per-vertex weights.
Vertices decode_vertices(const Json& vertices, size_t count) {
    Vertices out;
    if (!vertices.is_array()) return out;
    std::vector<double> v = nums(vertices);
    if (v.size() <= count * 2) {
        out.plain = v;
        return out;
    }
    out.weighted = true;
    size_t i = 0;
    while (i < v.size() && out.weights.size() < count) {
        size_t n = to_index(v[i]);
        i++;
        std::vector<Weight> w;
        for (size_t k = 0; k < n; k++) {
            if (i + 3 >= v.size()) break;
            Weight wt;
            wt.bone = to_index(v[i]);
            wt.x = v[i + 1];
            wt.y = v[i + 2];
            wt.weight = v[i + 3];
            w.push_back(wt);
            i += 4;
        }
        out.weights.push_back(w);
    }
    return out;
}

bool parse_inherit(const std::string& s, Inherit& out) {
    if (s == "normal") out = InheritNormal;
    else if (s == "onlyTranslation") out = InheritOnlyTranslation;
    else if (s == "noRotationOrReflection") out = InheritNoRotationOrReflection;
    else if (s == "noScale") out = InheritNoScale;
    else if (s == "noScaleOrReflection") out = InheritNoScaleOrReflection;
    else return false;
    return true;
}

Inherit inherit_or_normal(const std::string& s) {
    Inherit i = InheritNormal;
    parse_inherit(s, i);
    return i;
}

Blend parse_blend(const std::string& s) {
    if (s == "additive") return BlendAdditive;
    if (s == "multiply") return BlendMultiply;
    if (s == "screen") return BlendScreen;
    return BlendNormal;
}

struct Ctx {
    bool v4;
    std::unordered_map<std::string, size_t> bones;
    std::unordered_map<std::string, size_t> slots;
    std::string* err;

    bool bone(const Json& name, size_t& out) const {
        const std::string& n = name.is_str() ? name.s : std::string();
        std::unordered_map<std::string, size_t>::const_iterator it = bones.find(n);
        if (it == bones.end()) {
            *err = "unknown bone '" + n + "'";
            return false;
        }
        out = it->second;
        return true;
    }
    bool slot(const std::string& n, size_t& out) const {
        std::unordered_map<std::string, size_t>::const_iterator it = slots.find(n);
        if (it == slots.end()) {
            *err = "unknown slot '" + n + "'";
            return false;
        }
        out = it->second;
        return true;
    }
    bool slot(const Json& name, size_t& out) const { return slot(name.is_str() ? name.s : std::string(), out); }
};

Transform read_transform_offset(const Json& a) {
    return Transform(a.num("x", 0.0), a.num("y", 0.0), a.num("rotation", 0.0), a.num("scaleX", 1.0), a.num("scaleY", 1.0), 0.0, 0.0);
}

std::string zero_padded(int64_t n, size_t width) {
    char buf[32];
    snprintf(buf, sizeof buf, "%lld", (long long)n);
    std::string s = buf;
    while (s.size() < width) s = "0" + s;
    return s;
}

bool read_attachment(SkeletonData& sk, const Ctx& ctx, const std::string& key, const Json& a, Attachment& att) {
    std::string kind_name = a.str_or("type", "region");
    std::string image_name = a.get("path").is_str() ? a.get("path").s : (a.get("name").is_str() ? a.get("name").s : key);
    color4(hex_to_color(a.get("color"), default_attachment_color(kind_name)), att.color);
    if (kind_name == "region") {
        att.kind = AttRegion;
        att.offset = read_transform_offset(a);
        att.width = a.num("width", 0.0);
        att.height = a.num("height", 0.0);
    } else if (kind_name == "point") {
        att.kind = AttPoint;
        att.offset = read_transform_offset(a);
    } else if (kind_name == "mesh") {
        att.kind = AttMesh;
        att.uvs = nums(a.get("uvs"));
        size_t count = att.uvs.size() / 2;
        const Json& tris = a.get("triangles");
        for (size_t i = 0; i < tris.arr.size(); i++) att.triangles.push_back(to_u32(tris.arr[i].is_num() ? tris.arr[i].n : 0.0));
        att.hull = to_index(a.num("hull", 0.0));
        att.vertices = decode_vertices(a.get("vertices"), count);
        att.width = a.num("width", 0.0);
        att.height = a.num("height", 0.0);
    } else if (kind_name == "linkedmesh") {
        att.kind = AttLinkedMesh;
        std::string parent = a.get("parent").is_str() ? a.get("parent").s : (a.get("source").is_str() ? a.get("source").s : std::string());
        const Json& d = a.get("deform");
        const Json& t = a.get("timelines");
        const Json& which = d.is_null() ? t : d;
        att.deform = which.is_null() ? true : !((which.type == Json::Bool && !which.b) || (which.type == Json::Num && which.n == 0.0));
        att.parent = sk.intern(parent);
        if (a.get("skin").is_str()) att.skin = Opt<std::string>(a.get("skin").s);
        att.width = a.num("width", 0.0);
        att.height = a.num("height", 0.0);
    } else if (kind_name == "boundingbox" || kind_name == "path" || kind_name == "clipping") {
        size_t count = to_index(a.num("vertexCount", 0.0));
        att.vertices = decode_vertices(a.get("vertices"), count);
        if (kind_name == "boundingbox") {
            att.kind = AttBoundingBox;
        } else if (kind_name == "path") {
            att.kind = AttPath;
            att.closed = a.truthy("closed");
            att.constant_speed = a.flag("constantSpeed", true);
            att.lengths = nums(a.get("lengths"));
        } else {
            att.kind = AttClipping;
            if (!a.get("end").is_null()) {
                size_t end;
                if (!ctx.slot(a.get("end"), end)) return false;
                att.end = (int)end;
            }
        }
    } else {
        *ctx.err = "unknown attachment type '" + kind_name + "' ('" + key + "')";
        return false;
    }
    att.image = sk.intern(image_name);
    if (a.get("sequence").is_object()) {
        const Json& s = a.get("sequence");
        Sequence seq;
        seq.count = to_i64(s.num("count", 1.0));
        seq.start = to_i64(s.num("start", 1.0));
        seq.digits = to_index(s.num("digits", 0.0));
        int64_t n = seq.count > 1 ? seq.count : 1;
        for (int64_t i = 0; i < n; i++) seq.frames.push_back(sk.intern(image_name + zero_padded(seq.start + i, seq.digits)));
        seq.setup = to_i64(s.num("setup", 0.0));
        att.has_sequence = true;
        att.sequence = seq;
    }
    att.name = sk.intern(key);
    return true;
}

// ---- constraints --------------------------------------------------------------------------------

const char* const PROP_NAMES[PROPS] = {"rotate", "x", "y", "scaleX", "scaleY", "shearY"};
const char* const OFFSET_FIELDS[PROPS] = {"rotation", "x", "y", "scaleX", "scaleY", "shearY"};
const char* const PHYSICS_VALUES[7] = {"inertia", "strength", "damping", "mass", "wind", "gravity", "mix"};

int prop_index(const std::string& name) {
    for (int i = 0; i < PROPS; i++)
        if (name == PROP_NAMES[i]) return i;
    return NONE;
}

TransformData transform_data(const Json& d, size_t source) {
    TransformData t;
    t.source = source;
    bool legacy = d.has("rotateMix") || d.has("translateMix") || d.has("scaleMix") || d.has("shearMix");
    for (int i = 0; i < PROPS; i++) t.offsets[i] = d.num(OFFSET_FIELDS[i], 0.0);
    if (legacy) {
        double tr = d.num("translateMix", 1.0), s = d.num("scaleMix", 1.0);
        double m[PROPS] = {d.num("rotateMix", 1.0), tr, tr, s, s, d.num("shearMix", 1.0)};
        memcpy(t.mix, m, sizeof m);
    } else {
        double x = d.num("mixX", 1.0), sx = d.num("mixScaleX", 1.0);
        double m[PROPS] = {d.num("mixRotate", 1.0), x, d.num("mixY", x), sx, d.num("mixScaleY", sx), d.num("mixShearY", 1.0)};
        memcpy(t.mix, m, sizeof m);
    }
    if (d.get("properties").is_object()) {
        const Json& props = d.get("properties");
        for (size_t i = 0; i < props.obj.size(); i++) {
            int from = prop_index(props.obj[i].first);
            if (from < 0) continue;
            const Json& p = props.obj[i].second;
            PropMap map;
            map.from = (size_t)from;
            map.offset = p.num("offset", 0.0);
            const Json& to = p.get("to");
            for (size_t k = 0; k < to.obj.size(); k++) {
                int prop = prop_index(to.obj[k].first);
                if (prop < 0) continue;
                const Json& tj = to.obj[k].second;
                PropTarget target;
                target.prop = (size_t)prop;
                target.offset = tj.num("offset", 0.0);
                target.max = tj.num("max", 1.0);
                target.scale = tj.num("scale", 1.0);
                map.to.push_back(target);
            }
            t.props.push_back(map);
        }
    } else {
        for (size_t p = 0; p < PROPS; p++) {
            PropMap map;
            map.from = p;
            map.offset = 0.0;
            PropTarget target;
            target.prop = p;
            target.offset = 0.0;
            target.max = 1.0;
            target.scale = 1.0;
            map.to.push_back(target);
            t.props.push_back(map);
        }
    }
    bool local = d.truthy("local");
    t.local_source = d.flag("localSource", local);
    t.local_target = d.flag("localTarget", local);
    t.additive = d.has("additive") ? d.truthy("additive") : d.truthy("relative");
    t.clamp = d.truthy("clamp");
    return t;
}

PathData path_data(const Json& d, size_t slot) {
    PathData p;
    bool legacy = d.has("rotateMix") || d.has("translateMix");
    double x = legacy ? d.num("translateMix", 1.0) : d.num("mixX", 1.0);
    p.slot = slot;
    p.position_mode = d.str_or("positionMode", "percent") == "fixed" ? PositionFixed : PositionPercent;
    std::string spacing = d.str_or("spacingMode", "length");
    p.spacing_mode = spacing == "fixed" ? SpacingFixed : spacing == "percent" ? SpacingPercent : spacing == "proportional" ? SpacingProportional : SpacingLength;
    std::string rotate = d.str_or("rotateMode", "tangent");
    p.rotate_mode = rotate == "chain" ? RotateChain : rotate == "chainScale" ? RotateChainScale : RotateTangent;
    p.offset_rotation = d.num("rotation", 0.0);
    p.setup.position = d.num("position", 0.0);
    p.setup.spacing = d.num("spacing", 0.0);
    p.setup.mix_rotate = legacy ? d.num("rotateMix", 1.0) : d.num("mixRotate", 1.0);
    p.setup.mix_x = x;
    p.setup.mix_y = legacy ? x : d.num("mixY", x);
    return p;
}

struct ConstraintEntry {
    const Json* json;
    std::string type;
    double order;
};

void compile_constraints(SkeletonData& sk, const Json& obj, const Ctx& ctx, const std::vector<std::string>& animation_names) {
    std::vector<ConstraintEntry> entries;
    if (obj.get("constraints").is_array()) {
        const Json& list = obj.get("constraints");
        for (size_t i = 0; i < list.arr.size(); i++) {
            std::string t = list.arr[i].str_or("type", "");
            if (t != "ik") {
                ConstraintEntry e = {&list.arr[i], t, (double)i};
                entries.push_back(e);
            }
        }
    }
    const char* kinds[] = {"transform", "path", "physics"};
    for (int k = 0; k < 3; k++) {
        const Json& list = obj.get(kinds[k]);
        for (size_t i = 0; i < list.arr.size(); i++) {
            ConstraintEntry e = {&list.arr[i], kinds[k], list.arr[i].num("order", (double)i)};
            entries.push_back(e);
        }
    }
    for (size_t e = 0; e < entries.size(); e++) {
        const Json& d = *entries[e].json;
        const std::string& t = entries[e].type;
        ConstraintData c;
        c.name = d.str_or("name", "");
        c.order = entries[e].order;
        c.skin_required = d.truthy("skin");
        if (t == "slider") {
            const Json& an = d.get("animation");
            if (!an.is_str()) continue;
            std::vector<std::string>::const_iterator found = std::find(animation_names.begin(), animation_names.end(), an.s);
            if (found == animation_names.end()) continue;
            SliderData s;
            s.animation = (size_t)(found - animation_names.begin());
            s.bone = NONE;
            const Json& b = d.get("bone");
            if (!b.is_null()) {
                if (!b.is_str()) continue;
                std::unordered_map<std::string, size_t>::const_iterator it = ctx.bones.find(b.s);
                if (it == ctx.bones.end()) continue;
                s.bone = (int)it->second;
            }
            std::string property = d.str_or("property", "rotate");
            s.property = property == "x" ? PropX : property == "y" ? PropY : property == "scaleX" ? PropScaleX : property == "scaleY" ? PropScaleY : property == "shearY" ? PropShearY : PropRotate;
            s.scale = d.num("scale", 1.0);
            s.offset = d.num("offset", 0.0);
            s.local = d.truthy("local");
            s.looping = d.truthy("loop");
            s.additive = d.truthy("additive");
            s.setup[0] = d.num("time", 0.0);
            s.setup[1] = d.num("mix", 1.0);
            if (s.bone >= 0) c.bones.push_back((size_t)s.bone);
            c.kind = ConstraintSlider;
            c.slider = s;
            sk.constraints.push_back(c);
        } else if (t == "physics") {
            const Json& b = d.get("bone");
            if (!b.is_str()) continue;
            std::unordered_map<std::string, size_t>::const_iterator it = ctx.bones.find(b.s);
            if (it == ctx.bones.end()) continue;
            PhysicsData p;
            p.bone = it->second;
            for (int i = 0; i < 7; i++) p.globals[i] = d.truthy((std::string(PHYSICS_VALUES[i]) + "Global").c_str());
            p.x = d.num("x", 0.0);
            p.y = d.num("y", 0.0);
            p.rotate = d.num("rotate", 0.0);
            p.scale_x = d.num("scaleX", 0.0);
            p.shear_x = d.num("shearX", 0.0);
            p.limit = d.num("limit", 5000.0);
            p.fps = d.num("fps", 60.0);
            double setup[7] = {d.num("inertia", 0.5), d.num("strength", 100.0), d.num("damping", 0.85), d.num("mass", 1.0), d.num("wind", 0.0), d.num("gravity", 0.0), d.num("mix", 1.0)};
            memcpy(p.setup, setup, sizeof setup);
            c.bones.push_back(p.bone);
            c.kind = ConstraintPhysics;
            c.physics = p;
            sk.constraints.push_back(c);
        } else if (t == "transform" || t == "path") {
            const Json& list = d.get("bones");
            if (list.arr.empty()) continue;
            bool ok = true;
            for (size_t i = 0; i < list.arr.size(); i++) {
                const Json& b = list.arr[i];
                std::unordered_map<std::string, size_t>::const_iterator it = b.is_str() ? ctx.bones.find(b.s) : ctx.bones.end();
                if (it == ctx.bones.end()) {
                    ok = false;
                    break;
                }
                c.bones.push_back(it->second);
            }
            if (!ok) continue;
            if (t == "transform") {
                const Json& src = d.has("source") ? d.get("source") : d.get("target");
                if (!src.is_str()) continue;
                std::unordered_map<std::string, size_t>::const_iterator it = ctx.bones.find(src.s);
                if (it == ctx.bones.end()) continue;
                c.kind = ConstraintTransform;
                c.transform = transform_data(d, it->second);
            } else {
                const Json& slot_name = d.has("slot") ? d.get("slot") : d.get("target");
                if (!slot_name.is_str()) continue;
                std::unordered_map<std::string, size_t>::const_iterator it = ctx.slots.find(slot_name.s);
                if (it == ctx.slots.end()) continue;
                c.kind = ConstraintPath;
                c.path = path_data(d, it->second);
            }
            sk.constraints.push_back(c);
        }
    }
}

// ---- curves and keys -----------------------------------------------------------------------------

Curve make_bezier(const double* b) {
    Curve c;
    c.type = Curve::Bezier;
    for (int k = 0; k < 4; k++) c.bezier[k] = b[k];
    return c;
}

Curve normalize_curve(const std::vector<double>& c, double t1, double t2, const std::vector<double>& values, const std::vector<double>& next_values) {
    double dt = t2 - t1 != 0.0 ? t2 - t1 : 1.0;
    // A component whose value does not change has no meaningful curve; it takes the shape of the others.
    std::vector<Opt<std::vector<double> > > beziers;
    size_t i = 0;
    while (i + 3 < c.size() && beziers.size() < values.size()) {
        double v1 = values[beziers.size()];
        double dv = (beziers.size() < next_values.size() ? next_values[beziers.size()] : NAN) - v1;
        if (std::fabs(dv) <= 1e-9) {
            beziers.push_back(Opt<std::vector<double> >());
        } else {
            std::vector<double> b(4);
            b[0] = (c[i] - t1) / dt;
            b[1] = (c[i + 1] - v1) / dv;
            b[2] = (c[i + 2] - t1) / dt;
            b[3] = (c[i + 3] - v1) / dv;
            beziers.push_back(Opt<std::vector<double> >(b));
        }
        i += 4;
    }
    if (beziers.empty()) return Curve();
    std::vector<std::vector<double> > known;
    for (size_t k = 0; k < beziers.size(); k++)
        if (beziers[k].has) known.push_back(beziers[k].value);
    if (known.empty()) {
        double b[4] = {round5((c[0] - t1) / dt), round5(0.0), round5((c[2] - t1) / dt), round5(1.0)};
        return make_bezier(b);
    }
    bool shared = true;
    for (size_t k = 0; k < known.size() && shared; k++)
        for (int j = 0; j < 4; j++)
            if (!(std::fabs(known[k][(size_t)j] - known[0][(size_t)j]) < 1e-4)) shared = false;
    if (beziers.size() == 1 || shared) {
        double b[4] = {round5(known[0][0]), round5(known[0][1]), round5(known[0][2]), round5(known[0][3])};
        return make_bezier(b);
    }
    Curve out;
    out.type = Curve::Beziers;
    for (size_t k = 0; k < beziers.size(); k++) {
        const std::vector<double>& b = beziers[k].has ? beziers[k].value : known[0];
        std::vector<double> r(4);
        for (int j = 0; j < 4; j++) r[(size_t)j] = round5(b[(size_t)j]);
        out.beziers.push_back(r);
    }
    return out;
}

/// Reads a key's curve. 3.8 uses normalized values; 4.x per-value absolute control points.
Curve read_curve(const Json& key, const Json* next, const std::vector<double>& values, const std::vector<double>& next_values, bool v4) {
    const Json& c = key.get("curve");
    if (c.is_null()) return Curve();
    if (c.is_str()) {
        if (c.s != "stepped") return Curve();
        Curve s;
        s.type = Curve::Stepped;
        return s;
    }
    if (c.is_num()) {
        double b[4] = {c.n, key.num("c2", 0.0), key.num("c3", 1.0), key.num("c4", 1.0)};
        return make_bezier(b);
    }
    if (c.is_array()) {
        std::vector<double> cv = nums(c);
        if (!v4 && cv.size() == 4) return make_bezier(cv.data());
        if (!next) return Curve();
        return normalize_curve(cv, key.num("time", 0.0), next->num("time", 0.0), values, next_values);
    }
    return Curve();
}

/// `k[field] ?? def` for numbers.
double val(const Json& k, const char* field, double def) {
    const Json& v = k.get(field);
    if (v.is_null()) return def;
    return v.is_num() ? v.n : NAN;
}

typedef std::vector<double> (*ValuesOf)(const Json&, const void*);

std::vector<Key> read_numeric_keys(const Json& list, bool v4, ValuesOf values_of, const void* arg) {
    std::vector<Key> keys;
    const std::vector<Json>& items = list.arr;
    for (size_t i = 0; i < items.size(); i++) {
        Key key;
        key.values = values_of(items[i], arg);
        const Json* next = i + 1 < items.size() ? &items[i + 1] : 0;
        std::vector<double> next_values = next ? values_of(*next, arg) : key.values;
        key.curve = read_curve(items[i], next, key.values, next_values, v4);
        key.time = items[i].num("time", 0.0);
        keys.push_back(key);
    }
    return keys;
}

std::vector<RawKey> raw_keys(const Json& list, ValuesOf read, const void* arg) {
    std::vector<RawKey> keys;
    for (size_t i = 0; i < list.arr.size(); i++) {
        const Json& k = list.arr[i];
        RawKey key;
        key.time = k.num("time", 0.0);
        key.values = read(k, arg);
        const Json& c = k.get("curve");
        if (c.is_str() && c.s == "stepped") {
            key.curve.type = RawCurve::Stepped;
        } else if (c.is_num()) {
            key.curve.type = RawCurve::Normalized;
            double b[4] = {c.n, k.num("c2", 0.0), k.num("c3", 1.0), k.num("c4", 1.0)};
            key.curve.points.assign(b, b + 4);
        } else if (c.is_array()) {
            key.curve.type = RawCurve::Absolute;
            key.curve.points = nums(c);
        }
        keys.push_back(key);
    }
    return keys;
}

// Value readers for keys (arg: a field name and default, or nothing).
struct FieldDef {
    const char* field;
    double def;
};

std::vector<double> one_field(const Json& k, const void* arg) {
    const FieldDef* f = (const FieldDef*)arg;
    return std::vector<double>(1, val(k, f->field, f->def));
}

std::vector<double> rotate_value(const Json& k, const void*) {
    return std::vector<double>(1, k.has("value") ? val(k, "value", 0.0) : val(k, "angle", 0.0));
}

std::vector<double> xy_value(const Json& k, const void* arg) {
    double def = *(const double*)arg;
    std::vector<double> v(2);
    v[0] = val(k, "x", def);
    v[1] = val(k, "y", def);
    return v;
}

std::vector<double> color_value(const Json& k, const void* arg) {
    return hex_to_color(k.get("color"), *(const std::vector<double>*)arg);
}

std::vector<double> light_dark_value(const Json& k, const void* arg) {
    std::vector<double> v = hex_to_color(k.get("light"), *(const std::vector<double>*)arg);
    std::vector<double> d = hex_to_color(k.get("dark"), rgb_black());
    v.insert(v.end(), d.begin(), d.end());
    return v;
}

std::vector<double> transform_mix_value(const Json& k, const void* arg) {
    bool legacy = *(const bool*)arg;
    std::vector<double> v(PROPS);
    if (legacy) {
        double t = val(k, "translateMix", 1.0), s = val(k, "scaleMix", 1.0);
        v[0] = val(k, "rotateMix", 1.0);
        v[1] = t;
        v[2] = t;
        v[3] = s;
        v[4] = s;
        v[5] = val(k, "shearMix", 1.0);
    } else {
        double x = val(k, "mixX", 1.0), sx = val(k, "mixScaleX", 1.0);
        v[0] = val(k, "mixRotate", 1.0);
        v[1] = x;
        v[2] = val(k, "mixY", x);
        v[3] = sx;
        v[4] = val(k, "mixScaleY", sx);
        v[5] = val(k, "mixShearY", 1.0);
    }
    return v;
}

std::vector<double> path_position_value(const Json& k, const void*) {
    return std::vector<double>(1, k.has("value") ? val(k, "value", 0.0) : val(k, "position", 0.0));
}

std::vector<double> path_spacing_value(const Json& k, const void*) {
    return std::vector<double>(1, k.has("value") ? val(k, "value", 0.0) : val(k, "spacing", 0.0));
}

std::vector<double> path_mix_value(const Json& k, const void*) {
    std::vector<double> v(3);
    if (k.has("rotateMix") || k.has("translateMix")) {
        v[0] = val(k, "rotateMix", 1.0);
        v[1] = val(k, "translateMix", 1.0);
        v[2] = val(k, "translateMix", 1.0);
    } else {
        double x = val(k, "mixX", 1.0);
        v[0] = val(k, "mixRotate", 1.0);
        v[1] = x;
        v[2] = k.has("mixY") ? val(k, "mixY", x) : x;
    }
    return v;
}

bool read_deform(SkeletonData& sk, Animation& anim, const Ctx& ctx, const std::string& skin, const std::string& slot_name, const std::string& att, const Json& keys) {
    DeformTimeline tl;
    const std::vector<Json>& list = keys.arr;
    std::vector<double> zero(1, 0.0), one(1, 1.0);
    for (size_t i = 0; i < list.size(); i++) {
        const Json& k = list[i];
        DeformKey key;
        key.time = k.num("time", 0.0);
        key.offset = to_index(k.num("offset", 0.0));
        key.vertices = nums(k.get("vertices"));
        key.curve = read_curve(k, i + 1 < list.size() ? &list[i + 1] : 0, zero, one, ctx.v4);
        tl.keys.push_back(key);
    }
    if (skin != "default") tl.skin = Opt<std::string>(skin);
    if (!ctx.slot(slot_name, tl.slot)) return false;
    tl.attachment = sk.intern(att);
    anim.deform.push_back(tl);
    return true;
}

void deep_time(const Json& v, double& max) {
    if (v.is_array()) {
        for (size_t i = 0; i < v.arr.size(); i++) {
            const Json& k = v.arr[i];
            const Json& t = k.get("time");
            if (t.is_num()) max = std::fmax(max, t.n);
            deep_time(k, max);
        }
    } else if (v.is_object()) {
        for (size_t i = 0; i < v.obj.size(); i++) deep_time(v.obj[i].second, max);
    }
}

double last_time(const Json& raw, const Animation& anim) {
    double max = 0.0;
    for (size_t i = 0; i < anim.bones.size(); i++) {
        const BoneTimeline& t = anim.bones[i];
        for (int c = 0; c < CHANNELS; c++)
            for (size_t k = 0; k < t.channels[c].size(); k++) max = std::fmax(max, t.channels[c][k].time);
        for (size_t k = 0; k < t.inherit.size(); k++) max = std::fmax(max, t.inherit[k].first);
    }
    for (size_t i = 0; i < anim.slots.size(); i++) {
        const SlotTimeline& t = anim.slots[i];
        for (size_t k = 0; k < t.attachment.size(); k++) max = std::fmax(max, t.attachment[k].first);
        const std::vector<Key>* lists[] = {&t.color, &t.rgb, &t.alpha, &t.rgba2, &t.rgb2};
        for (int l = 0; l < 5; l++)
            for (size_t k = 0; k < lists[l]->size(); k++) max = std::fmax(max, (*lists[l])[k].time);
    }
    for (size_t i = 0; i < anim.deform.size(); i++)
        for (size_t k = 0; k < anim.deform[i].keys.size(); k++) max = std::fmax(max, anim.deform[i].keys[k].time);
    for (size_t i = 0; i < anim.ik.size(); i++)
        for (size_t k = 0; k < anim.ik[i].keys.size(); k++) max = std::fmax(max, anim.ik[i].keys[k].time);
    for (size_t i = 0; i < anim.draw_order.size(); i++) max = std::fmax(max, anim.draw_order[i].time);
    for (size_t i = 0; i < anim.events.size(); i++) max = std::fmax(max, anim.events[i].time);
    const char* deep[] = {"transform", "path", "physics", "attachments"};
    for (int i = 0; i < 4; i++) deep_time(raw.get(deep[i]), max);
    return max;
}

bool read_animation(SkeletonData& sk, const Ctx& ctx, const std::unordered_map<std::string, size_t>& ik_index, const std::string& name, const Json& a, Animation& anim) {
    bool v4 = ctx.v4;
    anim.name = name;

    const Json& bones = a.get("bones");
    for (size_t bi = 0; bi < bones.obj.size(); bi++) {
        BoneTimeline tl;
        if (!ctx.bone(Json::string(bones.obj[bi].first), tl.bone)) return false;
        const Json& timelines = bones.obj[bi].second;
        for (size_t ti = 0; ti < timelines.obj.size(); ti++) {
            const std::string& kind = timelines.obj[ti].first;
            const Json& keys = timelines.obj[ti].second;
            double zero = 0.0, one = 1.0;
            if (kind == "rotate") tl.channels[CH_ROTATE] = read_numeric_keys(keys, v4, rotate_value, 0);
            else if (kind == "translate") tl.channels[CH_TRANSLATE] = read_numeric_keys(keys, v4, xy_value, &zero);
            else if (kind == "scale") tl.channels[CH_SCALE] = read_numeric_keys(keys, v4, xy_value, &one);
            else if (kind == "shear") tl.channels[CH_SHEAR] = read_numeric_keys(keys, v4, xy_value, &zero);
            else if (kind == "translatex" || kind == "translatey" || kind == "scalex" || kind == "scaley" || kind == "shearx" || kind == "sheary") {
                int ch = kind == "translatex" ? CH_TRANSLATE_X : kind == "translatey" ? CH_TRANSLATE_Y : kind == "scalex" ? CH_SCALE_X : kind == "scaley" ? CH_SCALE_Y : kind == "shearx" ? CH_SHEAR_X : CH_SHEAR_Y;
                FieldDef f = {"value", kind.compare(0, 5, "scale") == 0 ? 1.0 : 0.0};
                tl.channels[ch] = read_numeric_keys(keys, v4, one_field, &f);
            } else if (kind == "inherit" || kind == "transform") {
                tl.inherit.clear();
                for (size_t k = 0; k < keys.arr.size(); k++) {
                    const Json& key = keys.arr[k];
                    std::string mode = key.get("inherit").is_str() ? key.get("inherit").s : (key.get("value").is_str() ? key.get("value").s : "normal");
                    tl.inherit.push_back(std::make_pair(key.num("time", 0.0), inherit_or_normal(mode)));
                }
            } else {
                sk.warnings.push_back("animation '" + name + "': unsupported bone timeline '" + kind + "'");
            }
        }
        anim.bones.push_back(tl);
    }

    const Json& slots = a.get("slots");
    for (size_t si = 0; si < slots.obj.size(); si++) {
        SlotTimeline tl;
        if (!ctx.slot(slots.obj[si].first, tl.slot)) return false;
        const Json& timelines = slots.obj[si].second;
        for (size_t ti = 0; ti < timelines.obj.size(); ti++) {
            const std::string& kind = timelines.obj[ti].first;
            const Json& keys = timelines.obj[ti].second;
            if (kind == "attachment") {
                tl.attachment.clear();
                for (size_t k = 0; k < keys.arr.size(); k++) {
                    const Json& key = keys.arr[k];
                    NameId n = key.get("name").is_str() ? sk.intern(key.get("name").s) : NO_NAME;
                    tl.attachment.push_back(std::make_pair(key.num("time", 0.0), n));
                }
            } else if (kind == "color" || kind == "rgba") {
                tl.color = read_numeric_keys(keys, v4, color_value, &white());
            } else if (kind == "rgb") {
                tl.rgb = read_numeric_keys(keys, v4, color_value, &rgb_white());
            } else if (kind == "alpha") {
                FieldDef f = {"value", 1.0};
                tl.alpha = read_numeric_keys(keys, v4, one_field, &f);
            } else if (kind == "twoColor" || kind == "rgba2") {
                tl.rgba2 = read_numeric_keys(keys, v4, light_dark_value, &white());
            } else if (kind == "rgb2") {
                tl.rgb2 = read_numeric_keys(keys, v4, light_dark_value, &rgb_white());
            } else {
                sk.warnings.push_back("animation '" + name + "': unsupported slot timeline '" + kind + "'");
            }
        }
        anim.slots.push_back(tl);
    }

    const Json& deform = a.get("deform");
    for (size_t k = 0; k < deform.obj.size(); k++) {
        const Json& slot_map = deform.obj[k].second;
        for (size_t s = 0; s < slot_map.obj.size(); s++) {
            const Json& atts = slot_map.obj[s].second;
            for (size_t t = 0; t < atts.obj.size(); t++)
                if (!read_deform(sk, anim, ctx, deform.obj[k].first, slot_map.obj[s].first, atts.obj[t].first, atts.obj[t].second)) return false;
        }
    }
    const Json& attachments = a.get("attachments");
    for (size_t k = 0; k < attachments.obj.size(); k++) {
        const std::string& skin = attachments.obj[k].first;
        const Json& slot_map = attachments.obj[k].second;
        for (size_t s = 0; s < slot_map.obj.size(); s++) {
            const std::string& slot_name = slot_map.obj[s].first;
            const Json& atts = slot_map.obj[s].second;
            for (size_t t = 0; t < atts.obj.size(); t++) {
                const std::string& att = atts.obj[t].first;
                const Json& timelines = atts.obj[t].second;
                if (timelines.has("deform") && !read_deform(sk, anim, ctx, skin, slot_name, att, timelines.get("deform"))) return false;
                if (timelines.get("sequence").is_array()) {
                    std::unordered_map<std::string, size_t>::const_iterator it = ctx.slots.find(slot_name);
                    if (it == ctx.slots.end()) continue;
                    SequenceTimeline tl;
                    const Json& list = timelines.get("sequence");
                    for (size_t i = 0; i < list.arr.size(); i++) {
                        const Json& key = list.arr[i];
                        SequenceKey sk_key;
                        sk_key.time = key.num("time", 0.0);
                        std::string mode = key.str_or("mode", "hold");
                        sk_key.mode = mode == "once" ? SeqOnce : mode == "loop" ? SeqLoop : mode == "pingpong" ? SeqPingPong : mode == "onceReverse" ? SeqOnceReverse : mode == "loopReverse" ? SeqLoopReverse : mode == "pingpongReverse" ? SeqPingPongReverse : SeqHold;
                        sk_key.index = to_i64(key.num("index", 0.0));
                        if (key.get("delay").is_num()) sk_key.delay = Opt<double>(key.get("delay").n);
                        tl.keys.push_back(sk_key);
                    }
                    if (skin != "default") tl.skin = Opt<std::string>(skin);
                    tl.slot = it->second;
                    tl.attachment = sk.intern(att);
                    anim.sequences.push_back(tl);
                }
            }
        }
    }

    const Json& draw_order = a.has("drawOrder") ? a.get("drawOrder") : a.get("draworder");
    for (size_t i = 0; i < draw_order.arr.size(); i++) {
        const Json& k = draw_order.arr[i];
        DrawOrderKey key;
        key.has_offsets = k.get("offsets").is_array();
        if (key.has_offsets) {
            const Json& offsets = k.get("offsets");
            for (size_t o = 0; o < offsets.arr.size(); o++) {
                size_t slot;
                if (!ctx.slot(offsets.arr[o].get("slot"), slot)) return false;
                key.offsets.push_back(std::make_pair(slot, to_i64(offsets.arr[o].num("offset", 0.0))));
            }
        }
        key.time = k.num("time", 0.0);
        anim.draw_order.push_back(key);
    }

    const Json& events = a.get("events");
    for (size_t i = 0; i < events.arr.size(); i++) {
        const Json& e = events.arr[i];
        EventKey key;
        key.time = e.num("time", 0.0);
        key.name = e.str_or("name", "");
        if (e.get("int").is_num()) key.int_value = Opt<int64_t>(to_i64(e.get("int").n));
        if (e.get("float").is_num()) key.float_value = Opt<double>(e.get("float").n);
        if (e.get("string").is_str()) key.string = Opt<std::string>(e.get("string").s);
        if (e.get("volume").is_num()) key.volume = Opt<double>(e.get("volume").n);
        if (e.get("balance").is_num()) key.balance = Opt<double>(e.get("balance").n);
        anim.events.push_back(key);
    }

    const Json& ik = a.get("ik");
    for (size_t i = 0; i < ik.obj.size(); i++) {
        std::unordered_map<std::string, size_t>::const_iterator it = ik_index.find(ik.obj[i].first);
        if (it == ik_index.end()) continue;
        IkTimeline tl;
        tl.constraint = it->second;
        const Json& keys = ik.obj[i].second;
        for (size_t k = 0; k < keys.arr.size(); k++) {
            const Json& key = keys.arr[k];
            IkKey ik_key;
            ik_key.time = key.num("time", 0.0);
            ik_key.mix = key.num("mix", 1.0);
            ik_key.softness = key.num("softness", 0.0);
            ik_key.bend_positive = key.flag("bendPositive", true);
            ik_key.compress = key.truthy("compress");
            ik_key.stretch = key.truthy("stretch");
            tl.keys.push_back(ik_key);
        }
        anim.ik.push_back(tl);
    }

    // Transform, path, physics and slider keys, by compiled constraint.
    const char* keyed[] = {"transform", "path", "physics", "slider"};
    anim.has_constraint_keys = false;
    for (int k = 0; k < 4; k++) {
        const Json& v = a.get(keyed[k]);
        if (!v.is_null() && !(v.type == Json::Bool && !v.b)) anim.has_constraint_keys = true;
    }
    for (size_t index = 0; index < sk.constraints.size(); index++) {
        const ConstraintData& c = sk.constraints[index];
        ConstraintTimeline tl;
        tl.constraint = index;
        bool any = false;
        if (c.kind == ConstraintTransform) {
            const Json& keys = a.get("transform").get(c.name);
            if (!keys.arr.empty()) {
                bool legacy = false;
                for (size_t k = 0; k < keys.arr.size(); k++) {
                    const Json& key = keys.arr[k];
                    if (key.has("rotateMix") || key.has("translateMix") || key.has("scaleMix") || key.has("shearMix")) legacy = true;
                }
                tl.transform = raw_keys(keys, transform_mix_value, &legacy);
                any = true;
            }
        } else if (c.kind == ConstraintSlider) {
            const Json& t = a.get("slider").get(c.name);
            if (t.is_object()) {
                FieldDef ft = {"value", 0.0}, fm = {"value", 1.0};
                tl.slider_time = raw_keys(t.get("time"), one_field, &ft);
                tl.slider_mix = raw_keys(t.get("mix"), one_field, &fm);
                any = true;
            }
        } else if (c.kind == ConstraintPhysics) {
            for (int g = 0; g < 2; g++) {
                const Json& source = g == 0 ? a.get("physics").get(c.name) : a.get("physics").get("");
                if (!source.is_object()) continue;
                FieldDef f = {"value", 0.0};
                for (int i = 0; i < 7; i++) {
                    std::vector<RawKey> keys = raw_keys(source.get(PHYSICS_VALUES[i]), one_field, &f);
                    if (g == 1) tl.physics_global[i] = keys;
                    else tl.physics[i] = keys;
                }
                any = true;
            }
        } else if (c.kind == ConstraintPath) {
            const Json& t = a.get("path").get(c.name);
            if (t.is_object()) {
                tl.position = raw_keys(t.get("position"), path_position_value, 0);
                tl.spacing = raw_keys(t.get("spacing"), path_spacing_value, 0);
                tl.path_mix = raw_keys(t.get("mix"), path_mix_value, 0);
                any = true;
            }
        }
        if (any) anim.constraints.push_back(tl);
    }

    anim.duration = last_time(a, anim);
    return true;
}

}  // namespace

bool is_skeleton_json(const Json& obj) {
    return obj.get("skeleton").is_object() && obj.get("bones").is_array();
}

bool read_skeleton_json(const Json& obj, SkeletonData& sk, std::string& err) {
    if (!is_skeleton_json(obj)) {
        err = "not a skeleton JSON file";
        return false;
    }
    sk = SkeletonData();
    const Json& header = obj.get("skeleton");
    const Json& version = header.get(VERSION_FIELD);
    double major = 3.0;
    if (version.is_str()) {
        std::string first = version.s.substr(0, version.s.find('.'));
        char* end = 0;
        // Like Rust's parse: no leading whitespace (strtod would skip it).
        bool parsable = !first.empty() && first[0] != ' ' && first[0] != '\t' && first[0] != '\n' && first[0] != '\r';
        double v = parsable ? strtod(first.c_str(), &end) : 0.0;
        major = (parsable && end == first.c_str() + first.size()) ? v : 3.0;
    } else if (version.is_num()) {
        major = std::trunc(version.n);
    }
    bool v4 = (major == 0.0 ? 3.0 : major) >= 4.0;
    if (version.is_str()) sk.version = Opt<std::string>(version.s);

    Ctx ctx;
    ctx.v4 = v4;
    ctx.err = &err;

    // Bones.
    const Json& bones = obj.get("bones");
    for (size_t i = 0; i < bones.arr.size(); i++) {
        const Json& b = bones.arr[i];
        std::string name = b.str_or("name", "");
        BoneData bone;
        bone.parent = NONE;
        const Json& p = b.get("parent");
        if (!p.is_null()) {
            std::string pn = p.is_str() ? p.s : std::string();
            std::unordered_map<std::string, size_t>::const_iterator it = ctx.bones.find(pn);
            if (it == ctx.bones.end()) {
                err = "bone '" + name + "' references unknown parent '" + pn + "'";
                return false;
            }
            bone.parent = (int)it->second;
        }
        ctx.bones[name] = i;
        std::string inherit = b.get("inherit").is_str() ? b.get("inherit").s : (b.get("transform").is_str() ? b.get("transform").s : "normal");
        bone.name = name;
        bone.length = b.num("length", 0.0);
        bone.setup = Transform(b.num("x", 0.0), b.num("y", 0.0), b.num("rotation", 0.0), b.num("scaleX", 1.0), b.num("scaleY", 1.0), b.num("shearX", 0.0), b.num("shearY", 0.0));
        bone.inherit = inherit_or_normal(inherit);
        bone.skin_required = b.truthy("skin");
        sk.bones.push_back(bone);
    }

    // Slots.
    const Json& slots = obj.get("slots");
    for (size_t i = 0; i < slots.arr.size(); i++) {
        const Json& s = slots.arr[i];
        std::string name = s.str_or("name", "");
        ctx.slots[name] = i;
        SlotData slot;
        slot.name = name;
        if (!ctx.bone(s.get("bone"), slot.bone)) return false;
        slot.attachment = s.get("attachment").is_str() ? sk.intern(s.get("attachment").s) : NO_NAME;
        slot.has_dark = s.truthy("dark");
        slot.dark[0] = slot.dark[1] = slot.dark[2] = 0.0;
        if (slot.has_dark) {
            std::vector<double> d = hex_to_color(s.get("dark"), rgb_black());
            for (int k = 0; k < 3; k++) slot.dark[k] = (size_t)k < d.size() ? d[(size_t)k] : 0.0;
        }
        color4(hex_to_color(s.get("color"), white()), slot.color);
        slot.blend = parse_blend(s.str_or("blend", "normal"));
        sk.slots.push_back(slot);
    }

    // IK constraints; the others are compiled once animations are known (sliders name one).
    bool unified = obj.get("constraints").is_array();
    std::vector<std::pair<const Json*, double> > ik_source;
    const Json& ik_list = unified ? obj.get("constraints") : obj.get("ik");
    for (size_t i = 0; i < ik_list.arr.size(); i++) {
        const Json& c = ik_list.arr[i];
        if (unified && !(c.get("type").is_str() && c.get("type").s == "ik")) continue;
        ik_source.push_back(std::make_pair(&c, c.num("order", (double)i)));
    }
    for (size_t i = 0; i < ik_source.size(); i++) {
        const Json& c = *ik_source[i].first;
        IkData ik;
        ik.name = c.str_or("name", "");
        ik.order = ik_source[i].second;
        ik.skin_required = c.truthy("skin");
        const Json& list = c.get("bones");
        for (size_t k = 0; k < list.arr.size(); k++) {
            size_t b;
            if (!ctx.bone(list.arr[k], b)) return false;
            ik.bones.push_back(b);
        }
        if (!ctx.bone(c.get("target"), ik.target)) return false;
        ik.mix = c.num("mix", 1.0);
        ik.softness = c.num("softness", 0.0);
        ik.bend_positive = c.flag("bendPositive", true);
        ik.compress = c.truthy("compress");
        ik.stretch = c.truthy("stretch");
        ik.uniform = c.truthy("uniform");
        sk.ik.push_back(ik);
    }
    std::unordered_map<std::string, size_t> ik_index;
    for (size_t i = 0; i < sk.ik.size(); i++) ik_index[sk.ik[i].name] = i;
    if (unified) {
        size_t skipped = 0;
        const Json& list = obj.get("constraints");
        for (size_t i = 0; i < list.arr.size(); i++) {
            const Json& t = list.arr[i].get("type");
            bool known = t.is_str() && (t.s == "ik" || t.s == "transform" || t.s == "path" || t.s == "physics" || t.s == "slider");
            if (!known) skipped++;
        }
        if (skipped > 0) {
            char buf[96];
            snprintf(buf, sizeof buf, "%lu constraint(s) of unknown types are kept but not evaluated", (unsigned long)skipped);
            sk.warnings.push_back(buf);
        }
    }

    // Skins (an array since 3.8; a map of skin name -> slots before).
    const Json& skins_json = obj.get("skins");
    bool skins_are_array = skins_json.is_array();
    std::vector<std::pair<std::string, const Json*> > skins;
    if (skins_are_array) {
        for (size_t i = 0; i < skins_json.arr.size(); i++) skins.push_back(std::make_pair(skins_json.arr[i].str_or("name", ""), &skins_json.arr[i]));
    } else if (skins_json.is_object()) {
        for (size_t i = 0; i < skins_json.obj.size(); i++) skins.push_back(std::make_pair(skins_json.obj[i].first, &skins_json.obj[i].second));
    }
    for (size_t k = 0; k < skins.size(); k++) {
        const std::string& skin_name = skins[k].first;
        const Json& skin = *skins[k].second;
        const Json& attachments = skins_are_array ? skin.get("attachments") : skin;
        SkinData data;
        for (size_t s = 0; s < attachments.obj.size(); s++) {
            size_t slot;
            if (!ctx.slot(attachments.obj[s].first, slot)) return false;
            const Json& atts = attachments.obj[s].second;
            std::vector<Attachment> list;
            for (size_t a = 0; a < atts.obj.size(); a++) {
                Attachment att;
                if (!read_attachment(sk, ctx, atts.obj[a].first, atts.obj[a].second, att)) return false;
                list.push_back(att);
            }
            if (skin_name == "default") sk.slots[slot].attachments.insert(sk.slots[slot].attachments.end(), list.begin(), list.end());
            else data.slots.push_back(std::make_pair(slot, list));
        }
        if (skin_name == "default") continue;
        if (skins_are_array) {
            const char* keys[] = {"constraints", "transform", "path", "physics"};
            for (int i = 0; i < 4; i++) {
                const Json& list = skin.get(keys[i]);
                for (size_t n = 0; n < list.arr.size(); n++)
                    if (list.arr[n].is_str()) data.constraints.push_back(list.arr[n].s);
            }
            const Json& bl = skin.get("bones");
            for (size_t n = 0; n < bl.arr.size(); n++) {
                size_t b;
                if (!ctx.bone(bl.arr[n], b)) return false;
                data.bones.push_back(b);
            }
            const Json& il = skin.get("ik");
            for (size_t n = 0; n < il.arr.size(); n++) {
                if (!il.arr[n].is_str()) continue;
                std::unordered_map<std::string, size_t>::const_iterator it = ik_index.find(il.arr[n].s);
                if (it != ik_index.end()) data.ik.push_back(it->second);
            }
        }
        data.name = skin_name;
        sk.skins.push_back(data);
    }

    // Events.
    const Json& events = obj.get("events");
    for (size_t i = 0; i < events.obj.size(); i++) {
        const Json& e = events.obj[i].second;
        EventData ev;
        ev.name = events.obj[i].first;
        ev.int_value = to_i64(e.num("int", 0.0));
        ev.float_value = e.num("float", 0.0);
        if (e.get("string").is_str()) ev.string = Opt<std::string>(e.get("string").s);
        if (e.get("audio").is_str()) ev.audio = Opt<std::string>(e.get("audio").s);
        ev.volume = e.num("volume", 1.0);
        ev.balance = e.num("balance", 0.0);
        sk.events.push_back(ev);
    }

    // Constraints other than IK (compiled; sliders need the animation names).
    const Json& animations = obj.get("animations");
    std::vector<std::string> animation_names;
    for (size_t i = 0; i < animations.obj.size(); i++) animation_names.push_back(animations.obj[i].first);
    compile_constraints(sk, obj, ctx, animation_names);

    // Animations.
    for (size_t i = 0; i < animations.obj.size(); i++) {
        Animation anim;
        if (!read_animation(sk, ctx, ik_index, animations.obj[i].first, animations.obj[i].second, anim)) return false;
        sk.animations.push_back(anim);
    }
    if (sk.bones.empty()) {
        err = "skeleton has no bones";
        return false;
    }
    for (size_t i = 0; i < sk.bones.size(); i++) {
        if (sk.bones[i].parent >= 0 && (size_t)sk.bones[i].parent >= i) {
            err = "bone '" + sk.bones[i].name + "' comes before its parent";
            return false;
        }
    }
    return true;
}

bool load_skeleton(const uint8_t* bytes, size_t size, SkeletonData& out, std::string& err) {
    Json json;
    if (is_skeleton_binary(bytes, size)) {
        if (!read_skeleton_binary(bytes, size, json, err)) return false;
    } else {
        std::string parse_err;
        if (!Json::parse((const char*)bytes, size, json, parse_err)) {
            err = "invalid JSON: " + parse_err;
            return false;
        }
    }
    return read_skeleton_json(json, out, err);
}

}  // namespace rigby
