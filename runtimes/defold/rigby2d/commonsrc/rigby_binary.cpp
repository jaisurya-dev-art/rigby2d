// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): binary skeleton files (.skel, format 4.3), converted to the skeleton JSON
// structure so one reader handles both. Port of binary.rs: only encodings observed in exports are
// read; anything else is reported as unsupported.

#include "rigby.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace rigby {

namespace {

const char* const VERSION_FIELD = "spine";
const char* const INHERIT[5] = {"normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"};
const char* const BLEND[4] = {"normal", "additive", "multiply", "screen"};
const char* const BONE_TIMELINE_NAMES[10] = {"rotate", "translate", "translatex", "translatey", "scale", "scalex", "scaley", "shear", "shearx", "sheary"};
const int BONE_TIMELINE_COUNTS[10] = {1, 2, 1, 1, 2, 1, 1, 2, 1, 1};
const char* const POSITION_MODES[2] = {"fixed", "percent"};
const char* const SPACING_MODES[4] = {"length", "fixed", "percent", "proportional"};
const char* const ROTATE_MODES[3] = {"tangent", "chain", "chainScale"};
const char* const TRANSFORM_PROPERTIES[6] = {"rotate", "x", "y", "scaleX", "scaleY", "shearY"};
const char* const TRANSFORM_OFFSETS[6] = {"rotation", "x", "y", "scaleX", "scaleY", "shearY"};
/// Mix key, the property it applies to, and the mix it defaults to (index, -1 = 1.0) when omitted.
const char* const MIX_KEYS[6] = {"mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"};
const char* const MIX_PROPERTIES[6] = {"rotate", "x", "y", "scaleX", "scaleY", "shearY"};
const int MIX_SAME_AS[6] = {-1, -1, 1, -1, 3, -1};
const char* const PHYSICS_GLOBALS[7] = {"inertia", "strength", "damping", "mass", "wind", "gravity", "mix"};
const char* const SEQUENCE_MODES[5] = {"hold", "once", "loop", 0, "onceReverse"};

/// The shortest decimal that encodes back to the same 32-bit float, read as a double.
double shortest(float v) {
    if (v == 0.0f) return 0.0;
    if (!std::isfinite(v)) return (double)v;
    char buf[48];
    for (int p = 1; p <= 9; p++) {
        snprintf(buf, sizeof buf, "%.*g", p, (double)v);
        if (strtof(buf, 0) == v) return strtod(buf, 0);
    }
    return (double)v;
}

Json num(double v) {
    return Json::number(v);
}

Json str(const std::string& v) {
    return Json::string(v);
}

std::string hex_byte(uint32_t v) {
    char buf[8];
    snprintf(buf, sizeof buf, "%02x", v & 0xff);
    return buf;
}

std::string fmt_flags(const char* what, unsigned flags, const std::string& name) {
    char buf[32];
    snprintf(buf, sizeof buf, " (flags 0x%x) on '", flags);
    return std::string(what) + buf + name + "'";
}

struct Reader {
    const uint8_t* b;
    size_t len;
    size_t p;
    std::vector<Opt<std::string> > strings;
    std::vector<std::string> slots;
    std::vector<std::pair<std::string, std::vector<std::string> > > transform_mapped;
    std::string err;

    bool bad(const std::string& what) {
        err = what;
        return false;
    }
    bool unsupported(const std::string& what) {
        err = what + " is not supported in .skel files yet; use skeleton JSON for this skeleton";
        return false;
    }
    bool check(size_t n) {
        if (p + n > len) return bad("unexpected end of .skel data");
        return true;
    }
    bool byte(uint8_t& out) {
        if (!check(1)) return false;
        out = b[p++];
        return true;
    }
    bool boolean(bool& out) {
        uint8_t v;
        if (!byte(v)) return false;
        out = v != 0;
        return true;
    }
    bool uint(uint32_t& out) {
        if (!check(4)) return false;
        out = ((uint32_t)b[p] << 24) | ((uint32_t)b[p + 1] << 16) | ((uint32_t)b[p + 2] << 8) | (uint32_t)b[p + 3];
        p += 4;
        return true;
    }
    bool real(double& out) {
        uint32_t bits;
        if (!uint(bits)) return false;
        float f;
        memcpy(&f, &bits, 4);
        out = shortest(f);
        return true;
    }
    bool varint(uint32_t& out) {
        uint32_t result = 0;
        unsigned shift = 0;
        for (;;) {
            uint8_t v;
            if (!byte(v)) return false;
            result |= shift < 32 ? ((uint32_t)(v & 0x7f) << shift) : 0;
            shift += 7;
            if ((v & 0x80) == 0 || shift >= 35) break;
        }
        out = result;
        return true;
    }
    bool svarint(int64_t& out) {
        uint32_t r;
        if (!varint(r)) return false;
        out = (int64_t)((int32_t)(r >> 1) ^ -(int32_t)(r & 1));
        return true;
    }
    bool string(Opt<std::string>& out) {
        uint32_t n;
        if (!varint(n)) return false;
        if (n == 0) {
            out = Opt<std::string>();
            return true;
        }
        if (!check(n - 1)) return false;
        out = Opt<std::string>(std::string((const char*)b + p, n - 1));
        p += n - 1;
        return true;
    }
    bool str_json(Json& out) {
        Opt<std::string> s;
        if (!string(s)) return false;
        out = s.has ? Json::string(s.value) : Json();
        return true;
    }
    bool reference(Opt<std::string>& out) {
        uint32_t i;
        if (!varint(i)) return false;
        if (i == 0) {
            out = Opt<std::string>();
            return true;
        }
        if (i - 1 >= strings.size()) return bad("invalid string reference in .skel data");
        out = strings[i - 1];
        return true;
    }
    bool color(std::string& out) {
        uint32_t v;
        if (!uint(v)) return false;
        char buf[16];
        snprintf(buf, sizeof buf, "%08x", v);
        out = buf;
        return true;
    }
    bool color3(std::string& out) {
        if (!check(3)) return false;
        out = hex_byte(b[p]) + hex_byte(b[p + 1]) + hex_byte(b[p + 2]);
        p += 3;
        return true;
    }
    bool slot_name(size_t i, std::string& out) {
        if (i >= slots.size()) return bad("invalid slot index in .skel data");
        out = slots[i];
        return true;
    }
};

#define TRY(x) \
    do { \
        if (!(x)) return false; \
    } while (0)

bool name_at(Reader& r, const std::vector<Json>& list, uint32_t i, const char* what, Json& out) {
    if (i >= list.size()) return r.bad(std::string("invalid ") + what + " index in .skel data");
    out = list[i].get("name");
    return true;
}

/// A mix stored as two flags, "not 0" and "not 1"; a float follows only when both are set.
bool read_mix(Reader& r, bool not0, bool not1, double& out) {
    if (!not0) {
        out = 0.0;
        return true;
    }
    if (!not1) {
        out = 1.0;
        return true;
    }
    return r.real(out);
}

bool read_ik(Reader& r, const std::string& name, const std::vector<Json>& bones, const std::vector<Json>& all, Json& c) {
    uint32_t ti;
    TRY(r.varint(ti));
    Json target;
    TRY(name_at(r, all, ti, "bone", target));
    uint8_t flags;
    TRY(r.byte(flags));
    if (flags & ~(0x01 | 0x04 | 0x20 | 0x40)) return r.unsupported(fmt_flags("IK constraint options", flags, name).replace(0, 0, ""));
    bool single = bones.size() <= 1;
    c = Json::object();
    c.set("type", str("ik"));
    c.set("name", str(name));
    c.set("target", target);
    Json list = Json::array();
    list.arr = bones;
    c.set("bones", list);
    if (flags & 0x01) c.set("skin", Json::boolean(true));
    if ((flags & 0x04) && !single) c.set("bendPositive", Json::boolean(false));
    double mix;
    TRY(read_mix(r, (flags & 0x20) != 0, (flags & 0x40) != 0, mix));
    if (mix != 1.0) c.set("mix", num(mix));
    return true;
}

bool read_path(Reader& r, const std::string& name, const std::vector<Json>& bones, const std::vector<Json>& slots, Json& c) {
    uint32_t si;
    TRY(r.varint(si));
    Json slot;
    TRY(name_at(r, slots, si, "slot", slot));
    uint8_t flags;
    TRY(r.byte(flags));
    if (flags & ~0x3f) return r.unsupported(fmt_flags("Path constraint options", flags, name));
    c = Json::object();
    c.set("type", str("path"));
    c.set("name", str(name));
    c.set("slot", slot);
    Json list = Json::array();
    list.arr = bones;
    c.set("bones", list);
    if (flags & 0x01) c.set("skin", Json::boolean(true));
    const char* position_mode = POSITION_MODES[(flags >> 1) & 1];
    const char* spacing_mode = SPACING_MODES[(flags >> 2) & 3];
    unsigned rm = (flags >> 4) & 3;
    const char* rotate_mode = rm < 3 ? ROTATE_MODES[rm] : "tangent";
    if (strcmp(position_mode, "percent") != 0) c.set("positionMode", str(position_mode));
    if (strcmp(spacing_mode, "length") != 0) c.set("spacingMode", str(spacing_mode));
    if (strcmp(rotate_mode, "tangent") != 0) c.set("rotateMode", str(rotate_mode));
    double position, spacing, mix_rotate, mix_x, mix_y;
    TRY(r.real(position));
    TRY(r.real(spacing));
    if (position != 0.0) c.set("position", num(position));
    if (spacing != 0.0) c.set("spacing", num(spacing));
    TRY(r.real(mix_rotate));
    TRY(r.real(mix_x));
    TRY(r.real(mix_y));
    if (mix_rotate != 1.0) c.set("mixRotate", num(mix_rotate));
    if (mix_x != 1.0) c.set("mixX", num(mix_x));
    if (mix_y != mix_x) c.set("mixY", num(mix_y));
    return true;
}

bool read_slider(Reader& r, const std::string& name, const std::vector<Json>& bones, Json& c) {
    c = Json::object();
    c.set("type", str("slider"));
    c.set("name", str(name));
    uint8_t flags;
    TRY(r.byte(flags));
    if ((flags & (0x01 | 0x04 | 0x20)) || !(flags & 0x10)) return r.unsupported(fmt_flags("Slider constraint options", flags, name));
    if (flags & 0x02) c.set("loop", Json::boolean(true));
    c.set("animation", Json());
    if (flags & 0x08) {
        double t;
        TRY(r.real(t));
        c.set("time", num(t));
    }
    if (flags & 0x40) {
        uint32_t bi;
        TRY(r.varint(bi));
        Json bone;
        TRY(name_at(r, bones, bi, "bone", bone));
        c.set("bone", bone);
        uint8_t prop;
        TRY(r.byte(prop));
        if (prop >= 6) return r.unsupported("Slider property on '" + name + "'");
        c.set("property", str(TRANSFORM_PROPERTIES[prop]));
        double o1;
        TRY(r.real(o1));
        if (o1 != 0.0) return r.unsupported("Slider property offsets on '" + name + "'");
        double o2;
        TRY(r.real(o2));
        if (o2 != 0.0) return r.unsupported("Slider property offsets on '" + name + "'");
        double scale;
        TRY(r.real(scale));
        c.set("scale", num(scale));
        if (flags & 0x80) c.set("local", Json::boolean(true));
    }
    return true;
}

bool read_physics(Reader& r, const std::string& name, const std::vector<Json>& bones, Json& c) {
    c = Json::object();
    c.set("type", str("physics"));
    c.set("name", str(name));
    uint32_t bi;
    TRY(r.varint(bi));
    Json bone;
    TRY(name_at(r, bones, bi, "bone", bone));
    c.set("bone", bone);
    uint8_t flags;
    TRY(r.byte(flags));
    if (flags & 0x01) c.set("skin", Json::boolean(true));
    const uint8_t bits[5] = {0x02, 0x04, 0x08, 0x10, 0x20};
    const char* keys[5] = {"x", "y", "rotate", "scaleX", "shearX"};
    for (int i = 0; i < 5; i++) {
        if (flags & bits[i]) {
            double v;
            TRY(r.real(v));
            c.set(keys[i], num(v));
        }
    }
    if (flags & 0x40) {
        double v;
        TRY(r.real(v));
        c.set("limit", num(v));
    }
    uint8_t fps_byte;
    TRY(r.byte(fps_byte));
    double fps = fps_byte;
    if (fps != 60.0) c.set("fps", num(fps));
    const char* dkeys[3] = {"inertia", "strength", "damping"};
    const double defs[3] = {0.5, 100.0, 0.85};
    for (int i = 0; i < 3; i++) {
        double v;
        TRY(r.real(v));
        if (v != defs[i]) c.set(dkeys[i], num(v));
    }
    if (flags & 0x80) {
        // Mass is stored as its inverse.
        double inv;
        TRY(r.real(inv));
        c.set("mass", num(shortest((float)(1.0 / inv))));
    }
    double wind, gravity;
    TRY(r.real(wind));
    TRY(r.real(gravity));
    if (wind != 0.0) c.set("wind", num(wind));
    if (gravity != 0.0) c.set("gravity", num(gravity));
    uint8_t globals;
    TRY(r.byte(globals));
    if (globals & 0x80) {
        char buf[64];
        snprintf(buf, sizeof buf, "Physics constraint options (0x%x) on '", globals);
        return r.unsupported(buf + name + "'");
    }
    for (int i = 0; i < 7; i++)
        if (globals & (1 << i)) c.set(std::string(PHYSICS_GLOBALS[i]) + "Global", Json::boolean(true));
    return true;
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
    return std::find(v.begin(), v.end(), s) != v.end();
}

bool read_transform(Reader& r, const std::string& name, const std::vector<Json>& bones, const std::vector<Json>& all, Json& c) {
    uint32_t si;
    TRY(r.varint(si));
    Json source;
    TRY(name_at(r, all, si, "bone", source));
    uint8_t flags;
    TRY(r.byte(flags));
    if (flags & 0x1e) return r.unsupported(fmt_flags("Transform constraint options", flags, name));
    c = Json::object();
    c.set("type", str("transform"));
    c.set("name", str(name));
    c.set("source", source);
    Json list = Json::array();
    list.arr = bones;
    c.set("bones", list);
    if (flags & 0x01) c.set("skin", Json::boolean(true));
    Json properties = Json::object();
    std::vector<std::string> mapped;
    for (unsigned k = 0; k < (unsigned)(flags >> 5); k++) {
        uint8_t from_i;
        TRY(r.byte(from_i));
        if (from_i >= 6) return r.unsupported("Transform property on '" + name + "'");
        const char* from = TRANSFORM_PROPERTIES[from_i];
        Json entry = Json::object();
        double offset;
        TRY(r.real(offset));
        if (offset != 0.0) entry.set("offset", num(offset));
        Json to_map = Json::object();
        uint32_t n;
        TRY(r.varint(n));
        for (uint32_t t = 0; t < n; t++) {
            uint8_t to_i;
            TRY(r.byte(to_i));
            if (to_i >= 6) return r.unsupported("Transform property on '" + name + "'");
            const char* to = TRANSFORM_PROPERTIES[to_i];
            Json target = Json::object();
            double to_offset, max, scale;
            TRY(r.real(to_offset));
            TRY(r.real(max));
            TRY(r.real(scale));
            if (to_offset != 0.0) target.set("offset", num(to_offset));
            if (max != 1.0) target.set("max", num(max));
            if (scale != 1.0) target.set("scale", num(scale));
            to_map.set(to, target);
            if (!contains(mapped, to)) mapped.push_back(to);
        }
        entry.set("to", to_map);
        properties.set(from, entry);
    }
    uint8_t offsets;
    TRY(r.byte(offsets));
    if (offsets & ~0x3f) return r.unsupported("Transform offsets on '" + name + "'");
    for (int bit = 0; bit < 6; bit++) {
        if (offsets & (1 << bit)) {
            double v;
            TRY(r.real(v));
            c.set(TRANSFORM_OFFSETS[bit], num(v));
        }
    }
    c.set("properties", properties);
    uint8_t mixes;
    TRY(r.byte(mixes));
    if (mixes & ~0x3f) return r.unsupported("Transform mixes on '" + name + "'");
    double value[6] = {0, 0, 0, 0, 0, 0};
    for (int bit = 0; bit < 6; bit++)
        if (mixes & (1 << bit)) TRY(r.real(value[bit]));
    for (int bit = 0; bit < 6; bit++) {
        if (!contains(mapped, MIX_PROPERTIES[bit])) continue;
        double def = MIX_SAME_AS[bit] >= 0 ? value[MIX_SAME_AS[bit]] : 1.0;
        if (value[bit] != def) c.set(MIX_KEYS[bit], num(value[bit]));
    }
    r.transform_mapped.push_back(std::make_pair(name, mapped));
    return true;
}

/// Vertex count and vertices (weighted: size hint, then bone count + bone/x/y/weight).
bool read_vertices(Reader& r, Json& a, bool weighted, size_t& count_out) {
    uint32_t count;
    TRY(r.varint(count));
    a.set("vertexCount", num((double)count));
    Json v = Json::array();
    if (weighted) {
        uint32_t hint;
        TRY(r.varint(hint));
        for (uint32_t i = 0; i < count; i++) {
            uint32_t n;
            TRY(r.varint(n));
            v.arr.push_back(num((double)n));
            for (uint32_t k = 0; k < n; k++) {
                uint32_t bone;
                TRY(r.varint(bone));
                v.arr.push_back(num((double)bone));
                for (int j = 0; j < 3; j++) {
                    double f;
                    TRY(r.real(f));
                    v.arr.push_back(num(f));
                }
            }
        }
    } else {
        for (uint64_t i = 0; i < (uint64_t)count * 2; i++) {
            double f;
            TRY(r.real(f));
            v.arr.push_back(num(f));
        }
    }
    a.set("vertices", v);
    count_out = count;
    return true;
}

void set_color(Json& a, const std::string& kind, const std::string& color) {
    std::string def = kind == "boundingbox" ? "60f000ff" : kind == "path" ? "ff7f00ff" : "";
    if (color != def) a.set("color", str(color));
}

bool read_sequence(Reader& r, Json& seq) {
    seq = Json::object();
    uint32_t count, start, digits, setup;
    TRY(r.varint(count));
    seq.set("count", num((double)count));
    TRY(r.varint(start));
    TRY(r.varint(digits));
    TRY(r.varint(setup));
    if (start != 1) seq.set("start", num((double)start));
    if (digits != 0) seq.set("digits", num((double)digits));
    if (setup != 0) seq.set("setup", num((double)setup));
    return true;
}

bool read_attachment(Reader& r, uint8_t flags, const std::string& key, bool nonessential, Json& a) {
    unsigned kind = flags & 0x07;
    a = Json::object();
    if (kind == 1 || kind == 6) {
        if ((flags & ~0x10) != kind) return r.unsupported(fmt_flags("Attachment options", flags, key));
        const char* t = kind == 6 ? "clipping" : "boundingbox";
        a.set("type", str(t));
        if (kind == 6) {
            uint32_t i;
            TRY(r.varint(i));
            std::string end;
            TRY(r.slot_name(i, end));
            a.set("end", str(end));
        }
        size_t count;
        TRY(read_vertices(r, a, (flags & 0x10) != 0, count));
        if (nonessential) {
            std::string c;
            TRY(r.color(c));
            set_color(a, t, c);
        }
        return true;
    }
    if (kind == 4) {
        if (flags & ~(4 | 0x10 | 0x20 | 0x40)) return r.unsupported(fmt_flags("Path attachment options", flags, key));
        a.set("type", str("path"));
        if (flags & 0x10) a.set("closed", Json::boolean(true));
        if (!(flags & 0x20)) a.set("constantSpeed", Json::boolean(false));
        size_t count;
        TRY(read_vertices(r, a, (flags & 0x40) != 0, count));
        Json lengths = Json::array();
        for (size_t i = 0; i < count / 3; i++) {
            double f;
            TRY(r.real(f));
            lengths.arr.push_back(num(f));
        }
        a.set("lengths", lengths);
        if (nonessential) {
            std::string c;
            TRY(r.color(c));
            set_color(a, "path", c);
        }
        return true;
    }
    if (kind == 3) {
        if (flags & ~(0x08 | 0x80 | 0x07)) return r.unsupported(fmt_flags("Linked mesh options", flags, key));
        a.set("type", str("linkedmesh"));
        if (flags & 0x08) {
            Opt<std::string> n;
            TRY(r.reference(n));
            a.set("name", n.has ? str(n.value) : Json());
        }
        uint32_t source_slot, skin;
        TRY(r.varint(source_slot));
        a.set("_sourceSlot", num((double)source_slot));
        TRY(r.varint(skin));
        Opt<std::string> source;
        TRY(r.reference(source));
        a.set("source", source.has ? str(source.value) : Json());
        if (skin != 0) a.set("_skinIndex", num((double)skin));
        if (!(flags & 0x80)) a.set("timelines", Json::boolean(false));
        if (nonessential) {
            double w, h;
            TRY(r.real(w));
            a.set("width", num(w));
            TRY(r.real(h));
            a.set("height", num(h));
        }
        return true;
    }
    if (kind == 0 || kind == 2) {
        unsigned known = 0x08 | 0x10 | 0x20 | 0x40 | 0x80 | 0x07;
        if (flags & ~known) return r.unsupported(fmt_flags("Attachment options", flags, key));
        if (flags & 0x08) {
            Opt<std::string> n;
            TRY(r.reference(n));
            a.set("name", n.has ? str(n.value) : Json());
        }
        if (kind == 2) a.set("type", str("mesh"));
        if (flags & 0x10) {
            Opt<std::string> p;
            TRY(r.reference(p));
            a.set("path", p.has ? str(p.value) : Json());
        }
        if (flags & 0x20) {
            std::string c;
            TRY(r.color(c));
            a.set("color", str(c));
        }
        if (flags & 0x40) {
            Json seq;
            TRY(read_sequence(r, seq));
            a.set("sequence", seq);
        }
        if (kind == 0) {
            double rotation = 0.0;
            if (flags & 0x80) TRY(r.real(rotation));
            const char* keys[6] = {"x", "y", "scaleX", "scaleY", "width", "height"};
            double values[6];
            for (int i = 0; i < 6; i++) TRY(r.real(values[i]));
            if (rotation != 0.0) a.set("rotation", num(rotation));
            for (int i = 0; i < 6; i++) {
                bool has_def = i < 4;
                double def = i >= 2 ? 1.0 : 0.0;
                if (!has_def || def != values[i]) a.set(keys[i], num(values[i]));
            }
            return true;
        }
        uint32_t hull, count;
        TRY(r.varint(hull));
        a.set("hull", num((double)hull));
        TRY(r.varint(count));
        Json v = Json::array();
        if (flags & 0x80) {
            uint32_t hint;
            TRY(r.varint(hint));
            for (uint32_t i = 0; i < count; i++) {
                uint32_t n;
                TRY(r.varint(n));
                v.arr.push_back(num((double)n));
                for (uint32_t k = 0; k < n; k++) {
                    uint32_t bone;
                    TRY(r.varint(bone));
                    v.arr.push_back(num((double)bone));
                    for (int j = 0; j < 3; j++) {
                        double f;
                        TRY(r.real(f));
                        v.arr.push_back(num(f));
                    }
                }
            }
        } else {
            for (uint64_t i = 0; i < (uint64_t)count * 2; i++) {
                double f;
                TRY(r.real(f));
                v.arr.push_back(num(f));
            }
        }
        a.set("vertices", v);
        Json uvs = Json::array();
        for (uint64_t i = 0; i < (uint64_t)count * 2; i++) {
            double f;
            TRY(r.real(f));
            uvs.arr.push_back(num(f));
        }
        a.set("uvs", uvs);
        int64_t tri = 2 * (int64_t)count - (int64_t)hull - 2;
        uint64_t tri_count = 3 * (uint64_t)(tri > 0 ? tri : 0);
        Json tris = Json::array();
        for (uint64_t i = 0; i < tri_count; i++) {
            uint32_t t;
            TRY(r.varint(t));
            tris.arr.push_back(num((double)t));
        }
        a.set("triangles", tris);
        uint8_t options;
        TRY(r.byte(options));
        if (options != 0) return r.unsupported("Mesh options ('" + key + "')");
        if (nonessential) {
            uint32_t edges;
            TRY(r.varint(edges));
            for (uint32_t i = 0; i < edges; i++) {
                uint32_t e;
                TRY(r.varint(e));
            }
            double w, h;
            TRY(r.real(w));
            a.set("width", num(w));
            TRY(r.real(h));
            a.set("height", num(h));
        }
        return true;
    }
    char buf[64];
    snprintf(buf, sizeof buf, "Attachment type %u ('", kind);
    return r.unsupported(buf + key + "')");
}

bool read_skin(Reader& r, const std::vector<Json>& slots, bool nonessential, Json& skin) {
    skin = Json::object();
    uint32_t n;
    TRY(r.varint(n));
    for (uint32_t s = 0; s < n; s++) {
        uint32_t si;
        TRY(r.varint(si));
        Json slot_json;
        TRY(name_at(r, slots, si, "slot", slot_json));
        std::string slot = slot_json.is_str() ? slot_json.s : "";
        Json atts = Json::object();
        uint32_t count;
        TRY(r.varint(count));
        for (uint32_t k = 0; k < count; k++) {
            Opt<std::string> key;
            TRY(r.reference(key));
            uint8_t flags;
            TRY(r.byte(flags));
            Json a;
            TRY(read_attachment(r, flags, key.value_or(""), nonessential, a));
            atts.set(key.value_or(""), a);
        }
        skin.set(slot, atts);
    }
    return true;
}

typedef bool (*KeyValues)(Reader& r, Json& key, const void* arg, size_t& n);

/// Keys of n values; the curve of a segment follows the segment's second key.
bool read_curve_keys(Reader& r, uint32_t frames, KeyValues read, const void* arg, Json& out) {
    out = Json::array();
    for (uint32_t f = 0; f < frames; f++) {
        Json key = Json::object();
        double t;
        TRY(r.real(t));
        key.set("time", num(t));
        size_t n;
        TRY(read(r, key, arg, n));
        if (f > 0) {
            uint8_t kind;
            TRY(r.byte(kind));
            Json& prev = out.arr.back();
            if (kind == 1) {
                prev.set("curve", str("stepped"));
            } else if (kind == 2) {
                Json c = Json::array();
                for (size_t i = 0; i < 4 * n; i++) {
                    double v;
                    TRY(r.real(v));
                    c.arr.push_back(num(v));
                }
                prev.set("curve", c);
            } else if (kind != 0) {
                char buf[48];
                snprintf(buf, sizeof buf, "invalid curve type %u", kind);
                return r.bad(buf);
            }
        }
        out.arr.push_back(key);
    }
    for (size_t i = 0; i < out.arr.size(); i++) {
        const Json& t = out.arr[i].get("time");
        if (t.is_num() && t.n == 0.0) out.arr[i].remove("time");
    }
    return true;
}

bool one_value(Reader& r, Json& key, const void* arg, size_t& n) {
    double def = *(const double*)arg;
    double v;
    TRY(r.real(v));
    if (v != def) key.set("value", num(v));
    n = 1;
    return true;
}

bool color_value(Reader& r, Json& key, const void*, size_t& n) {
    std::string c;
    TRY(r.color(c));
    key.set("color", str(c));
    n = 4;
    return true;
}

bool light_dark_value(Reader& r, Json& key, const void*, size_t& n) {
    std::string light, dark;
    TRY(r.color(light));
    key.set("light", str(light));
    TRY(r.color3(dark));
    key.set("dark", str(dark));
    n = 7;
    return true;
}

struct BoneValueArg {
    int count;
    double def;
};

bool bone_value(Reader& r, Json& key, const void* arg, size_t& n) {
    const BoneValueArg* b = (const BoneValueArg*)arg;
    if (b->count == 1) {
        double v;
        TRY(r.real(v));
        if (v != b->def) key.set("value", num(v));
    } else {
        double x, y;
        TRY(r.real(x));
        TRY(r.real(y));
        if (x != b->def) key.set("x", num(x));
        if (y != b->def) key.set("y", num(y));
    }
    n = (size_t)b->count;
    return true;
}

bool transform_value(Reader& r, Json& key, const void* arg, size_t& n) {
    const std::vector<std::string>& mapped = *(const std::vector<std::string>*)arg;
    for (int i = 0; i < 6; i++) {
        double v;
        TRY(r.real(v));
        if (v != 1.0 && contains(mapped, MIX_PROPERTIES[i])) key.set(MIX_KEYS[i], num(v));
    }
    n = 6;
    return true;
}

bool constraint_name(Reader& r, const std::vector<Json>& constraints, uint32_t i, std::string& out) {
    if (i >= constraints.size() || !constraints[i].get("name").is_str()) return r.bad("invalid constraint index in .skel data");
    out = constraints[i].get("name").s;
    return true;
}

bool read_animation(Reader& r, const std::vector<Json>& bones, const std::vector<Json>& slots, const std::vector<Json>& constraints, const std::vector<Json>& skins,
                    const Json& events, const std::vector<std::string>& event_names, Json& anim) {
    anim = Json::object();
    uint32_t total;
    TRY(r.varint(total));  // total timeline count

    Json slot_tl = Json::object();
    uint32_t n;
    TRY(r.varint(n));
    for (uint32_t s = 0; s < n; s++) {
        uint32_t si;
        TRY(r.varint(si));
        Json slot_json;
        TRY(name_at(r, slots, si, "slot", slot_json));
        std::string slot = slot_json.is_str() ? slot_json.s : "";
        Json timelines = Json::object();
        uint32_t tn;
        TRY(r.varint(tn));
        for (uint32_t t = 0; t < tn; t++) {
            uint8_t kind;
            TRY(r.byte(kind));
            uint32_t frames;
            TRY(r.varint(frames));
            if (kind == 0) {
                Json keys = Json::array();
                for (uint32_t f = 0; f < frames; f++) {
                    double time;
                    TRY(r.real(time));
                    Opt<std::string> name;
                    TRY(r.reference(name));
                    Json key = Json::object();
                    if (time != 0.0) key.set("time", num(time));
                    if (name.has) key.set("name", str(name.value));
                    keys.arr.push_back(key);
                }
                timelines.set("attachment", keys);
            } else if (kind == 1) {
                uint32_t hint;
                TRY(r.varint(hint));
                Json keys;
                TRY(read_curve_keys(r, frames, color_value, 0, keys));
                timelines.set("rgba", keys);
            } else if (kind == 3) {
                uint32_t hint;
                TRY(r.varint(hint));
                Json keys;
                TRY(read_curve_keys(r, frames, light_dark_value, 0, keys));
                timelines.set("rgba2", keys);
            } else {
                char buf[48];
                snprintf(buf, sizeof buf, "Slot timeline type %u", kind);
                return r.unsupported(buf);
            }
        }
        slot_tl.set(slot, timelines);
    }
    if (!slot_tl.obj.empty()) anim.set("slots", slot_tl);

    Json bone_tl = Json::object();
    TRY(r.varint(n));
    for (uint32_t b = 0; b < n; b++) {
        uint32_t bi;
        TRY(r.varint(bi));
        Json bone_json;
        TRY(name_at(r, bones, bi, "bone", bone_json));
        std::string bone = bone_json.is_str() ? bone_json.s : "";
        Json timelines = Json::object();
        uint32_t tn;
        TRY(r.varint(tn));
        for (uint32_t t = 0; t < tn; t++) {
            uint8_t kind;
            TRY(r.byte(kind));
            uint32_t frames, hint;
            TRY(r.varint(frames));
            TRY(r.varint(hint));
            if (kind >= 10) {
                char buf[48];
                snprintf(buf, sizeof buf, "Bone timeline type %u", kind);
                return r.unsupported(buf);
            }
            const char* name = BONE_TIMELINE_NAMES[kind];
            BoneValueArg arg = {BONE_TIMELINE_COUNTS[kind], strncmp(name, "scale", 5) == 0 ? 1.0 : 0.0};
            Json keys;
            TRY(read_curve_keys(r, frames, bone_value, &arg, keys));
            timelines.set(name, keys);
        }
        bone_tl.set(bone, timelines);
    }
    if (!bone_tl.obj.empty()) anim.set("bones", bone_tl);

    Json ik = Json::object();
    TRY(r.varint(n));
    for (uint32_t c = 0; c < n; c++) {
        uint32_t ci;
        TRY(r.varint(ci));
        std::string name;
        TRY(constraint_name(r, constraints, ci, name));
        uint32_t frames, hint;
        TRY(r.varint(frames));
        TRY(r.varint(hint));
        Json keys = Json::array();
        for (uint32_t f = 0; f < frames; f++) {
            uint8_t flags;
            TRY(r.byte(flags));
            Json key = Json::object();
            double time;
            TRY(r.real(time));
            if (time != 0.0) key.set("time", num(time));
            if (!(flags & 0x01)) {
                key.set("mix", num(0.0));
            } else if (flags & 0x02) {
                double m;
                TRY(r.real(m));
                key.set("mix", num(m));
            }
            if (flags & 0x04) {
                double s;
                TRY(r.real(s));
                key.set("softness", num(s));
            }
            if (!(flags & 0x08)) key.set("bendPositive", Json::boolean(false));
            if (flags & 0x10) key.set("compress", Json::boolean(true));
            if (flags & 0x20) key.set("stretch", Json::boolean(true));
            if (flags & 0x40) {
                if (f > 0) keys.arr.back().set("curve", str("stepped"));
            } else if (flags & 0x80) {
                Json curve = Json::array();
                for (int k = 0; k < 8; k++) {
                    double v;
                    TRY(r.real(v));
                    curve.arr.push_back(num(v));
                }
                if (f > 0) keys.arr.back().set("curve", curve);
            }
            keys.arr.push_back(key);
        }
        ik.set(name, keys);
    }
    if (!ik.obj.empty()) anim.set("ik", ik);

    Json transform = Json::object();
    TRY(r.varint(n));
    for (uint32_t c = 0; c < n; c++) {
        uint32_t ci;
        TRY(r.varint(ci));
        std::string name;
        TRY(constraint_name(r, constraints, ci, name));
        uint32_t frames, hint;
        TRY(r.varint(frames));
        TRY(r.varint(hint));
        std::vector<std::string> mapped(TRANSFORM_PROPERTIES, TRANSFORM_PROPERTIES + 6);
        for (size_t m = 0; m < r.transform_mapped.size(); m++) {
            if (r.transform_mapped[m].first == name) {
                mapped = r.transform_mapped[m].second;
                break;
            }
        }
        Json keys;
        TRY(read_curve_keys(r, frames, transform_value, &mapped, keys));
        transform.set(name, keys);
    }
    if (!transform.obj.empty()) anim.set("transform", transform);

    // Path, physics and slider keys.
    Json path = Json::object();
    TRY(r.varint(n));
    for (uint32_t c = 0; c < n; c++) {
        uint32_t ci;
        TRY(r.varint(ci));
        std::string name;
        TRY(constraint_name(r, constraints, ci, name));
        Json entry = Json::object();
        uint32_t tn;
        TRY(r.varint(tn));
        for (uint32_t t = 0; t < tn; t++) {
            uint8_t code;
            TRY(r.byte(code));
            if (code != 0) {
                char buf[48];
                snprintf(buf, sizeof buf, "Path constraint key type %u", code);
                return r.unsupported(buf);
            }
            uint32_t frames, hint;
            TRY(r.varint(frames));
            TRY(r.varint(hint));
            double def = 0.0;
            Json keys;
            TRY(read_curve_keys(r, frames, one_value, &def, keys));
            entry.set("position", keys);
        }
        path.set(name, entry);
    }
    if (!path.obj.empty()) anim.set("path", path);
    Json physics = Json::object();
    TRY(r.varint(n));
    for (uint32_t c = 0; c < n; c++) {
        uint32_t index;
        TRY(r.varint(index));
        std::string name;
        if (index != 0) TRY(constraint_name(r, constraints, index - 1, name));
        Json entry = physics.get(name);
        if (entry.is_null()) entry = Json::object();
        uint32_t tn;
        TRY(r.varint(tn));
        for (uint32_t t = 0; t < tn; t++) {
            uint8_t code;
            TRY(r.byte(code));
            if (code != 5) {
                char buf[48];
                snprintf(buf, sizeof buf, "Physics key type %u", code);
                return r.unsupported(buf);
            }
            uint32_t frames, hint;
            TRY(r.varint(frames));
            TRY(r.varint(hint));
            double def = 0.0;
            Json keys;
            TRY(read_curve_keys(r, frames, one_value, &def, keys));
            entry.set("wind", keys);
        }
        physics.set(name, entry);
    }
    if (!physics.obj.empty()) anim.set("physics", physics);
    Json slider = Json::object();
    TRY(r.varint(n));
    for (uint32_t c = 0; c < n; c++) {
        uint32_t ci;
        TRY(r.varint(ci));
        std::string name;
        TRY(constraint_name(r, constraints, ci, name));
        Json entry = Json::object();
        uint32_t tn;
        TRY(r.varint(tn));
        for (uint32_t t = 0; t < tn; t++) {
            uint8_t code;
            TRY(r.byte(code));
            if (code != 1) {
                char buf[48];
                snprintf(buf, sizeof buf, "Slider key type %u", code);
                return r.unsupported(buf);
            }
            uint32_t frames, hint;
            TRY(r.varint(frames));
            TRY(r.varint(hint));
            double def = 1.0;
            Json keys;
            TRY(read_curve_keys(r, frames, one_value, &def, keys));
            entry.set("mix", keys);
        }
        slider.set(name, entry);
    }
    if (!slider.obj.empty()) anim.set("slider", slider);

    Json attachments = Json::object();
    TRY(r.varint(n));
    for (uint32_t k = 0; k < n; k++) {
        uint32_t ki;
        TRY(r.varint(ki));
        if (ki >= skins.size() || !skins[ki].get("name").is_str()) return r.bad("invalid skin index in .skel data");
        std::string skin = skins[ki].get("name").s;
        Json skin_entry = attachments.get(skin);
        if (skin_entry.is_null()) skin_entry = Json::object();
        uint32_t sn;
        TRY(r.varint(sn));
        for (uint32_t s = 0; s < sn; s++) {
            uint32_t si;
            TRY(r.varint(si));
            std::string slot;
            TRY(r.slot_name(si, slot));
            Json slot_entry = skin_entry.get(slot);
            if (slot_entry.is_null()) slot_entry = Json::object();
            uint32_t an;
            TRY(r.varint(an));
            for (uint32_t a = 0; a < an; a++) {
                Opt<std::string> att_ref;
                TRY(r.reference(att_ref));
                std::string att = att_ref.value_or("");
                uint8_t kind;
                TRY(r.byte(kind));
                uint32_t frames;
                TRY(r.varint(frames));
                Json timelines = slot_entry.get(att);
                if (timelines.is_null()) timelines = Json::object();
                if (kind == 0) {
                    uint32_t hint;
                    TRY(r.varint(hint));
                    Json keys = Json::array();
                    for (uint32_t f = 0; f < frames; f++) {
                        Json key = Json::object();
                        double time;
                        TRY(r.real(time));
                        if (time != 0.0) key.set("time", num(time));
                        if (f > 0) {
                            uint8_t c;
                            TRY(r.byte(c));
                            Json& prev = keys.arr.back();
                            if (c == 1) {
                                prev.set("curve", str("stepped"));
                            } else if (c == 2) {
                                Json cv = Json::array();
                                for (int i = 0; i < 4; i++) {
                                    double v;
                                    TRY(r.real(v));
                                    cv.arr.push_back(num(v));
                                }
                                prev.set("curve", cv);
                            } else if (c != 0) {
                                char buf[48];
                                snprintf(buf, sizeof buf, "invalid curve type %u", c);
                                return r.bad(buf);
                            }
                        }
                        uint32_t count;
                        TRY(r.varint(count));
                        if (count > 0) {
                            uint32_t offset;
                            TRY(r.varint(offset));
                            if (offset != 0) key.set("offset", num((double)offset));
                            Json v = Json::array();
                            for (uint32_t i = 0; i < count; i++) {
                                double x;
                                TRY(r.real(x));
                                v.arr.push_back(num(x));
                            }
                            key.set("vertices", v);
                        }
                        keys.arr.push_back(key);
                    }
                    timelines.set("deform", keys);
                } else if (kind == 1) {
                    Json keys = Json::array();
                    double last_delay = 0.0;
                    for (uint32_t f = 0; f < frames; f++) {
                        Json key = Json::object();
                        double time, delay;
                        uint32_t mode_index;
                        TRY(r.real(time));
                        TRY(r.uint(mode_index));
                        TRY(r.real(delay));
                        unsigned mi = mode_index & 0x0f;
                        if (mi >= 5 || !SEQUENCE_MODES[mi]) {
                            char buf[48];
                            snprintf(buf, sizeof buf, "Sequence mode %u", mi);
                            return r.unsupported(buf);
                        }
                        const char* mode = SEQUENCE_MODES[mi];
                        if (time != 0.0) key.set("time", num(time));
                        if (strcmp(mode, "hold") != 0) key.set("mode", str(mode));
                        if (mode_index >> 4) key.set("index", num((double)(mode_index >> 4)));
                        if (delay != last_delay) key.set("delay", num(delay));
                        last_delay = delay;
                        keys.arr.push_back(key);
                    }
                    timelines.set("sequence", keys);
                } else {
                    char buf[48];
                    snprintf(buf, sizeof buf, "Attachment timeline type %u", kind);
                    return r.unsupported(buf);
                }
                slot_entry.set(att, timelines);
            }
            skin_entry.set(slot, slot_entry);
        }
        attachments.set(skin, skin_entry);
    }
    if (!attachments.obj.empty()) anim.set("attachments", attachments);

    Json draw = Json::array();
    TRY(r.varint(n));
    for (uint32_t d = 0; d < n; d++) {
        Json key = Json::object();
        double time;
        TRY(r.real(time));
        if (time != 0.0) key.set("time", num(time));
        uint32_t on;
        TRY(r.varint(on));
        if (on > 0) {
            Json offsets = Json::array();
            for (uint32_t i = 0; i < on; i++) {
                Json o = Json::object();
                uint32_t si;
                TRY(r.varint(si));
                Json slot;
                TRY(name_at(r, slots, si, "slot", slot));
                o.set("slot", slot);
                uint32_t off;
                TRY(r.varint(off));
                o.set("offset", num((double)(int32_t)off));
                offsets.arr.push_back(o);
            }
            key.set("offsets", offsets);
        }
        draw.arr.push_back(key);
    }
    if (!draw.arr.empty()) anim.set("drawOrder", draw);
    uint32_t unknown;
    TRY(r.varint(unknown));
    if (unknown != 0) return r.unsupported("An unknown animation section");
    Json ev = Json::array();
    TRY(r.varint(n));
    for (uint32_t e = 0; e < n; e++) {
        double time;
        TRY(r.real(time));
        Json key = Json::object();
        if (time != 0.0) key.set("time", num(time));
        uint32_t ni;
        TRY(r.varint(ni));
        std::string name = ni < event_names.size() ? event_names[ni] : "";
        key.set("name", str(name));
        int64_t int_value;
        TRY(r.svarint(int_value));
        double float_value;
        TRY(r.real(float_value));
        const Json& def = events.get(name);
        if ((double)int_value != def.num("int", 0.0)) key.set("int", num((double)int_value));
        if (float_value != def.num("float", 0.0)) key.set("float", num(float_value));
        bool has_string;
        TRY(r.boolean(has_string));
        if (has_string) {
            Json s;
            TRY(r.str_json(s));
            key.set("string", s);
        }
        if (def.truthy("audio")) {
            double v, b;
            TRY(r.real(v));
            key.set("volume", num(v));
            TRY(r.real(b));
            key.set("balance", num(b));
        }
        ev.arr.push_back(key);
    }
    if (!ev.arr.empty()) anim.set("events", ev);
    std::string color;
    TRY(r.color(color));
    return true;
}

}  // namespace

bool is_skeleton_binary(const uint8_t* bytes, size_t size) {
    if (size <= 9 || bytes[8] <= 1 || bytes[8] >= 64) return false;
    size_t len = (size_t)bytes[8] - 1;
    size_t end = 9 + len < size ? 9 + len : size;
    const uint8_t* text = bytes + 9;
    size_t text_len = end - 9;
    size_t digits = 0;
    while (digits < text_len && text[digits] >= '0' && text[digits] <= '9') digits++;
    return digits > 0 && digits < text_len && text[digits] == '.' && digits + 1 < text_len && text[digits + 1] >= '0' && text[digits + 1] <= '9';
}

bool read_skeleton_binary(const uint8_t* bytes, size_t size, Json& out, std::string& err) {
    Reader r;
    r.b = bytes;
    r.len = size;
    r.p = 8;
#define CHECK(x) \
    do { \
        if (!(x)) { \
            err = r.err; \
            return false; \
        } \
    } while (0)
    Opt<std::string> version_opt;
    CHECK(r.string(version_opt));
    std::string version = version_opt.value_or("");
    if (version.compare(0, 3, "4.3") != 0) {
        r.unsupported("Binary format " + version);
        err = r.err;
        return false;
    }
    Json skeleton = Json::object();
    skeleton.set(VERSION_FIELD, str(version));
    const char* box[4] = {"x", "y", "width", "height"};
    for (int i = 0; i < 4; i++) {
        double v;
        CHECK(r.real(v));
        skeleton.set(box[i], num(v));
    }
    double reference_scale;
    CHECK(r.real(reference_scale));
    bool nonessential;
    CHECK(r.boolean(nonessential));
    if (nonessential) {
        double fps;
        CHECK(r.real(fps));
        if (fps != 30.0) skeleton.set("fps", num(fps));
        Json images, audio;
        CHECK(r.str_json(images));
        skeleton.set("images", images);
        CHECK(r.str_json(audio));
        skeleton.set("audio", audio);
    }
    out = Json::object();
    out.set("skeleton", skeleton);
    uint32_t n;
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Opt<std::string> s;
        CHECK(r.string(s));
        r.strings.push_back(s);
    }

    // Bones.
    std::vector<Json> bones;
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Json b = Json::object();
        Json name;
        CHECK(r.str_json(name));
        b.set("name", name);
        if (i > 0) {
            uint32_t p;
            CHECK(r.varint(p));
            Json parent;
            CHECK(name_at(r, bones, p, "bone", parent));
            b.set("parent", parent);
        }
        double rotation, x, y, scale_x, scale_y, shear_x, shear_y, length;
        CHECK(r.real(rotation));
        CHECK(r.real(x));
        CHECK(r.real(y));
        CHECK(r.real(scale_x));
        CHECK(r.real(scale_y));
        CHECK(r.real(shear_x));
        CHECK(r.real(shear_y));
        uint8_t inherit_i;
        CHECK(r.byte(inherit_i));
        const char* inherit = inherit_i < 5 ? INHERIT[inherit_i] : "normal";
        CHECK(r.real(length));
        if (length != 0.0) b.set("length", num(length));
        const char* keys[7] = {"rotation", "x", "y", "scaleX", "scaleY", "shearX", "shearY"};
        double values[7] = {rotation, x, y, scale_x, scale_y, shear_x, shear_y};
        double defs[7] = {0, 0, 0, 1, 1, 0, 0};
        for (int k = 0; k < 7; k++)
            if (values[k] != defs[k]) b.set(keys[k], num(values[k]));
        if (strcmp(inherit, "normal") != 0) b.set("inherit", str(inherit));
        bool skin;
        CHECK(r.boolean(skin));
        if (skin) b.set("skin", Json::boolean(true));
        if (nonessential) {
            std::string color;
            Opt<std::string> icon;
            double ia, ib;
            bool visible;
            CHECK(r.color(color));
            CHECK(r.string(icon));
            CHECK(r.real(ia));
            CHECK(r.real(ib));
            CHECK(r.boolean(visible));
        }
        bones.push_back(b);
    }

    // Slots.
    std::vector<Json> slots;
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Json sl = Json::object();
        Opt<std::string> name_opt;
        CHECK(r.string(name_opt));
        std::string name = name_opt.value_or("");
        sl.set("name", str(name));
        uint32_t bi;
        CHECK(r.varint(bi));
        Json bone;
        CHECK(name_at(r, bones, bi, "bone", bone));
        sl.set("bone", bone);
        std::string color, dark;
        CHECK(r.color(color));
        CHECK(r.color(dark));
        if (color != "ffffffff") sl.set("color", str(color));
        if (dark != "ffffffff") sl.set("dark", str(dark.substr(2)));
        Opt<std::string> attachment;
        CHECK(r.reference(attachment));
        if (attachment.has) sl.set("attachment", str(attachment.value));
        uint8_t blend_i;
        CHECK(r.byte(blend_i));
        const char* blend = blend_i < 4 ? BLEND[blend_i] : "normal";
        if (strcmp(blend, "normal") != 0) sl.set("blend", str(blend));
        if (nonessential) {
            bool visible;
            CHECK(r.boolean(visible));
        }
        r.slots.push_back(name);
        slots.push_back(sl);
    }

    // Constraints, in application order.
    std::vector<Json> constraints;
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Opt<std::string> name_opt;
        CHECK(r.string(name_opt));
        std::string name = name_opt.value_or("");
        uint8_t kind;
        CHECK(r.byte(kind));
        Json c;
        if (kind == 3) {
            CHECK(read_physics(r, name, bones, c));
        } else if (kind == 4) {
            CHECK(read_slider(r, name, bones, c));
        } else if (kind <= 2) {
            std::vector<Json> list;
            uint32_t bn;
            CHECK(r.varint(bn));
            for (uint32_t k = 0; k < bn; k++) {
                uint32_t bi;
                CHECK(r.varint(bi));
                Json bone;
                CHECK(name_at(r, bones, bi, "bone", bone));
                list.push_back(bone);
            }
            if (kind == 0) CHECK(read_ik(r, name, list, bones, c));
            else if (kind == 1) CHECK(read_path(r, name, list, slots, c));
            else CHECK(read_transform(r, name, list, bones, c));
        } else {
            char buf[48];
            snprintf(buf, sizeof buf, "Constraint type %u ('", kind);
            r.unsupported(buf + name + "')");
            err = r.err;
            return false;
        }
        constraints.push_back(c);
    }

    // Skins: the default skin, then named skins.
    std::vector<Json> skins;
    Json default_skin = Json::object();
    default_skin.set("name", str("default"));
    Json atts;
    CHECK(read_skin(r, slots, nonessential, atts));
    default_skin.set("attachments", atts);
    skins.push_back(default_skin);
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Json skin = Json::object();
        Json name;
        CHECK(r.str_json(name));
        skin.set("name", name);
        if (nonessential) {
            std::string color;
            CHECK(r.color(color));
        }
        uint32_t nb;
        CHECK(r.varint(nb));
        if (nb > 0) {
            Json list = Json::array();
            for (uint32_t k = 0; k < nb; k++) {
                uint32_t bi;
                CHECK(r.varint(bi));
                Json bone;
                CHECK(name_at(r, bones, bi, "bone", bone));
                list.arr.push_back(bone);
            }
            skin.set("bones", list);
        }
        uint32_t nc;
        CHECK(r.varint(nc));
        for (uint32_t k = 0; k < nc; k++) {
            uint32_t ci;
            CHECK(r.varint(ci));
            if (ci >= constraints.size()) {
                err = "invalid constraint index in .skel data";
                return false;
            }
            std::string kind = constraints[ci].str_or("type", "");
            Json list = skin.get(kind);
            if (!list.is_array()) list = Json::array();
            list.arr.push_back(constraints[ci].get("name"));
            skin.set(kind, list);
        }
        Json skin_atts;
        CHECK(read_skin(r, slots, nonessential, skin_atts));
        skin.set("attachments", skin_atts);
        skins.push_back(skin);
    }
    // Linked meshes: resolve the skin index they name.
    std::vector<Json> skin_names;
    for (size_t i = 0; i < skins.size(); i++) skin_names.push_back(skins[i].get("name"));
    for (size_t k = 0; k < skins.size(); k++) {
        for (size_t e = 0; e < skins[k].obj.size(); e++) {
            if (skins[k].obj[e].first != "attachments") continue;
            Json& slots_map = skins[k].obj[e].second;
            if (!slots_map.is_object()) continue;
            for (size_t s = 0; s < slots_map.obj.size(); s++) {
                Json& slot_atts = slots_map.obj[s].second;
                if (!slot_atts.is_object()) continue;
                for (size_t a = 0; a < slot_atts.obj.size(); a++) {
                    Json& att = slot_atts.obj[a].second;
                    Json index;
                    if (att.remove("_skinIndex", &index) && index.is_num()) {
                        size_t i = (size_t)index.n;
                        att.set("skin", i < skin_names.size() ? skin_names[i] : Json());
                    }
                    att.remove("_sourceSlot");
                }
            }
        }
    }

    // Events.
    Json events = Json::object();
    std::vector<std::string> event_names;
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Opt<std::string> name_opt;
        CHECK(r.string(name_opt));
        std::string name = name_opt.value_or("");
        Json e = Json::object();
        int64_t int_value;
        double float_value;
        Opt<std::string> string, audio;
        CHECK(r.svarint(int_value));
        CHECK(r.real(float_value));
        CHECK(r.string(string));
        CHECK(r.string(audio));
        if (int_value != 0) e.set("int", num((double)int_value));
        if (float_value != 0.0) e.set("float", num(float_value));
        if (string.has && !string.value.empty()) e.set("string", str(string.value));
        if (audio.has) {
            e.set("audio", str(audio.value));
            double v, b;
            CHECK(r.real(v));
            e.set("volume", num(v));
            CHECK(r.real(b));
            e.set("balance", num(b));
        }
        events.set(name, e);
        event_names.push_back(name);
    }

    // Animations.
    Json animations = Json::object();
    std::vector<std::string> animation_names;
    CHECK(r.varint(n));
    for (uint32_t i = 0; i < n; i++) {
        Opt<std::string> name_opt;
        CHECK(r.string(name_opt));
        std::string name = name_opt.value_or("");
        Json anim;
        CHECK(read_animation(r, bones, slots, constraints, skins, events, event_names, anim));
        animations.set(name, anim);
        animation_names.push_back(name);
    }
    // Slider constraints name their animation after the animations.
    for (size_t i = 0; i < constraints.size(); i++) {
        const Json& t = constraints[i].get("type");
        if (!(t.is_str() && t.s == "slider")) continue;
        uint32_t ai;
        CHECK(r.varint(ai));
        if (ai >= animation_names.size()) {
            err = "invalid animation index in .skel data";
            return false;
        }
        constraints[i].set("animation", str(animation_names[ai]));
    }
    if (r.p != size) {
        char buf[96];
        snprintf(buf, sizeof buf, "unexpected data after the animations (%lu bytes)", (unsigned long)(size - r.p));
        err = buf;
        return false;
    }
    Json list = Json::array();
    list.arr = bones;
    out.set("bones", list);
    list.arr = slots;
    out.set("slots", list);
    if (!constraints.empty()) {
        list.arr = constraints;
        out.set("constraints", list);
    }
    list.arr = skins;
    out.set("skins", list);
    if (!event_names.empty()) out.set("events", events);
    out.set("animations", animations);
#undef CHECK
    return true;
}

}  // namespace rigby
