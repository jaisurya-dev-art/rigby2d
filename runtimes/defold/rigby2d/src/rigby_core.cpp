// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): JSON, math, curves, the atlas and skeleton data lookups. Ports json.rs,
// math.rs, curve.rs, atlas.rs and model.rs of the Rust runtime.

#include "rigby.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace rigby {

// ---- JSON ---------------------------------------------------------------------------------------

static const Json NULL_JSON;
static const std::string EMPTY_STRING;

const Json& Json::get(const char* key) const {
    if (type != Obj) return NULL_JSON;
    for (size_t i = 0; i < obj.size(); i++)
        if (obj[i].first == key) return obj[i].second;
    return NULL_JSON;
}

double Json::num(const char* key, double def) const {
    const Json& v = get(key);
    return v.type == Num ? v.n : def;
}

bool Json::truthy(const char* key) const {
    const Json& v = get(key);
    switch (v.type) {
        case Null: return false;
        case Bool: return v.b;
        case Num: return v.n != 0.0 && !std::isnan(v.n);
        case Str: return !v.s.empty();
        default: return true;
    }
}

bool Json::flag(const char* key, bool def) const {
    return get(key).type == Null ? def : truthy(key);
}

const std::string& Json::str_or(const char* key, const std::string& def) const {
    const Json& v = get(key);
    return v.type == Str ? v.s : def;
}

const char* Json::cstr_or(const char* key, const char* def) const {
    const Json& v = get(key);
    return v.type == Str ? v.s.c_str() : def;
}

void Json::set(const std::string& key, const Json& value) {
    if (type != Obj) return;
    for (size_t i = 0; i < obj.size(); i++) {
        if (obj[i].first == key) {
            obj[i].second = value;
            return;
        }
    }
    obj.push_back(std::make_pair(key, value));
}

bool Json::remove(const std::string& key, Json* out) {
    if (type != Obj) return false;
    for (size_t i = 0; i < obj.size(); i++) {
        if (obj[i].first == key) {
            if (out) *out = obj[i].second;
            obj.erase(obj.begin() + (long)i);
            return true;
        }
    }
    return false;
}

namespace {

const size_t MAX_DEPTH = 512;

struct Parser {
    const unsigned char* s;
    size_t len;
    size_t i;
    std::string err;

    bool fail(const char* message) {
        char buf[64];
        snprintf(buf, sizeof buf, " at byte %lu", (unsigned long)i);
        err = std::string(message) + buf;
        return false;
    }
    void ws() {
        while (i < len && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
    }
    int peek() const { return i < len ? s[i] : -1; }
    bool expect(const char* lit, Json& out, Json value) {
        size_t n = strlen(lit);
        if (i + n <= len && memcmp(s + i, lit, n) == 0) {
            i += n;
            out = value;
            return true;
        }
        return fail("invalid literal");
    }
    bool hex4(uint32_t& v) {
        if (i + 4 > len) return fail("invalid \\u escape");
        v = 0;
        for (size_t k = 0; k < 4; k++) {
            int c = s[i + k];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= (uint32_t)(c - '0');
            else if (c >= 'a' && c <= 'f') v |= (uint32_t)(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= (uint32_t)(c - 'A' + 10);
            else return fail("invalid \\u escape");
        }
        i += 4;
        return true;
    }
    static void utf8(uint32_t cp, std::string& out) {
        if ((cp >= 0xd800 && cp < 0xe000) || cp > 0x10ffff) cp = 0xfffd;
        if (cp < 0x80) {
            out += (char)cp;
        } else if (cp < 0x800) {
            out += (char)(0xc0 | (cp >> 6));
            out += (char)(0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
            out += (char)(0xe0 | (cp >> 12));
            out += (char)(0x80 | ((cp >> 6) & 0x3f));
            out += (char)(0x80 | (cp & 0x3f));
        } else {
            out += (char)(0xf0 | (cp >> 18));
            out += (char)(0x80 | ((cp >> 12) & 0x3f));
            out += (char)(0x80 | ((cp >> 6) & 0x3f));
            out += (char)(0x80 | (cp & 0x3f));
        }
    }
    bool string(std::string& out) {
        i++;  // opening quote
        out.clear();
        for (;;) {
            if (i >= len) return fail("unterminated string");
            unsigned char c = s[i++];
            if (c == '"') break;
            if (c != '\\') {
                out += (char)c;
                continue;
            }
            if (i >= len) return fail("unterminated string");
            unsigned char e = s[i++];
            switch (e) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += (char)8; break;
                case 'f': out += (char)12; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    uint32_t cp = 0;
                    if (!hex4(cp)) return false;
                    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < len && s[i] == '\\' && s[i + 1] == 'u') {
                        size_t save = i;
                        i += 2;
                        uint32_t lo = 0;
                        if (!hex4(lo)) return false;
                        if (lo >= 0xdc00 && lo < 0xe000) cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                        else i = save;
                    }
                    utf8(cp, out);
                    break;
                }
                default: return fail("invalid escape");
            }
        }
        return true;
    }
    bool number(Json& out) {
        size_t start = i;
        while (i < len && (s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || (s[i] >= '0' && s[i] <= '9'))) i++;
        std::string text((const char*)s + start, i - start);
        if (text.empty()) return fail("invalid number");
        char* end = 0;
        double v = strtod(text.c_str(), &end);
        if (end != text.c_str() + text.size()) {
            i = start;
            return fail(("invalid number '" + text + "'").c_str());
        }
        out = Json::number(v);
        return true;
    }
    bool value(Json& out, size_t depth) {
        if (depth > MAX_DEPTH) return fail("JSON nested too deeply");
        int c = peek();
        if (c < 0) return fail("unexpected end of JSON");
        if (c == '{') {
            i++;
            out = Json::object();
            ws();
            if (peek() == '}') {
                i++;
                return true;
            }
            for (;;) {
                ws();
                if (peek() != '"') return fail("expected a string key");
                std::string k;
                if (!string(k)) return false;
                ws();
                if (peek() != ':') return fail("expected ':'");
                i++;
                ws();
                Json v;
                if (!value(v, depth + 1)) return false;
                // Like JSON.parse: a repeated key keeps the last value, in the first position.
                bool found = false;
                for (size_t e = 0; e < out.obj.size(); e++) {
                    if (out.obj[e].first == k) {
                        out.obj[e].second = v;
                        found = true;
                        break;
                    }
                }
                if (!found) out.obj.push_back(std::make_pair(k, v));
                ws();
                int d = peek();
                if (d == ',') i++;
                else if (d == '}') {
                    i++;
                    return true;
                } else return fail("expected ',' or '}'");
            }
        }
        if (c == '[') {
            i++;
            out = Json::array();
            ws();
            if (peek() == ']') {
                i++;
                return true;
            }
            for (;;) {
                ws();
                out.arr.push_back(Json());
                if (!value(out.arr.back(), depth + 1)) return false;
                ws();
                int d = peek();
                if (d == ',') i++;
                else if (d == ']') {
                    i++;
                    return true;
                } else return fail("expected ',' or ']'");
            }
        }
        if (c == '"') {
            out = Json::string("");
            return string(out.s);
        }
        if (c == 't') return expect("true", out, Json::boolean(true));
        if (c == 'f') return expect("false", out, Json::boolean(false));
        if (c == 'n') return expect("null", out, Json());
        return number(out);
    }
};

}  // namespace

bool Json::parse(const char* text, size_t len, Json& out, std::string& err) {
    Parser p;
    p.s = (const unsigned char*)text;
    p.len = len;
    p.i = 0;
    if (len >= 3 && p.s[0] == 0xef && p.s[1] == 0xbb && p.s[2] == 0xbf) p.i = 3;
    p.ws();
    if (!p.value(out, 0)) {
        err = p.err;
        return false;
    }
    p.ws();
    if (p.i != len) {
        p.fail("unexpected data after the JSON value");
        err = p.err;
        return false;
    }
    return true;
}

// ---- math -----------------------------------------------------------------------------------------

const double DEG = 3.14159265358979323846 / 180.0;

double lerp(double a, double b, double t) {
    return a + (b - a) * t;
}

double wrap_degrees(double d) {
    double w = std::fmod(std::fmod(d + 180.0, 360.0) + 360.0, 360.0) - 180.0;
    return w == -180.0 ? 180.0 : w;
}

double angle_of(double x, double y) {
    return std::atan2(y, x) / DEG;
}

Affine Transform::to_affine() const {
    double rx = (rotation + shear_x) * DEG;
    double ry = (rotation + 90.0 + shear_y) * DEG;
    return Affine(std::cos(rx) * scale_x, std::sin(rx) * scale_x, std::cos(ry) * scale_y, std::sin(ry) * scale_y, x, y);
}

Affine Affine::mul(const Affine& r) const {
    return Affine(a * r.a + c * r.b, b * r.a + d * r.b, a * r.c + c * r.d, b * r.c + d * r.d, a * r.tx + c * r.ty + tx, b * r.tx + d * r.ty + ty);
}

Affine Affine::inverse() const {
    double det = determinant();
    if (std::fabs(det) < 1e-12) return Affine();
    double inv = 1.0 / det;
    double na = d * inv, nb = -b * inv, nc = -c * inv, nd = a * inv;
    return Affine(na, nb, nc, nd, -(na * tx + nc * ty), -(nb * tx + nd * ty));
}

Transform Affine::decompose() const {
    double scale_x = std::hypot(a, b);
    if (scale_x < 1e-12) return Transform(tx, ty, 0, 0, 0, 0, 0);
    double rot = rotation();
    double det = determinant();
    double scale_y = std::hypot(c, d) * (det < 0.0 ? -1.0 : 1.0);
    double y_angle = scale_y == 0.0 ? rot + 90.0 : angle_of(c / scale_y, d / scale_y);
    double shear_y = wrap_degrees(y_angle - rot - 90.0);
    return Transform(tx, ty, rot, scale_x, scale_y, 0, std::fabs(shear_y) < 1e-9 ? 0.0 : shear_y);
}

// ---- curves ---------------------------------------------------------------------------------------

static double clamp01(double t) {
    return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
}

static double cubic(double p1, double p2, double t) {
    double u = 1.0 - t;
    return 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t;
}

static double cubic_derivative(double p1, double p2, double t) {
    double u = 1.0 - t;
    return 3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2);
}

static double bezier_y_for_x(double x1, double y1, double x2, double y2, double x) {
    x1 = clamp01(x1);
    x2 = clamp01(x2);
    // Newton iterations, falling back to bisection when the slope is too flat.
    double t = x;
    for (int k = 0; k < 8; k++) {
        double err = cubic(x1, x2, t) - x;
        if (std::fabs(err) < 1e-5) return cubic(y1, y2, t);
        double d = cubic_derivative(x1, x2, t);
        if (std::fabs(d) < 1e-6) break;
        t = clamp01(t - err / d);
    }
    double lo = 0.0, hi = 1.0;
    t = x;
    for (int k = 0; k < 30; k++) {
        double v = cubic(x1, x2, t);
        if (std::fabs(v - x) < 1e-5) break;
        if (v < x) lo = t;
        else hi = t;
        t = (lo + hi) * 0.5;
    }
    return cubic(y1, y2, t);
}

double Curve::ease(double t, size_t component) const {
    t = clamp01(t);
    if (type == Stepped) return 0.0;
    const double* b = 0;
    if (type == Bezier) b = bezier;
    else if (type == Beziers && !beziers.empty()) b = component < beziers.size() ? beziers[component].data() : beziers[0].data();
    return b ? bezier_y_for_x(b[0], b[1], b[2], b[3], t) : t;
}

double cubic4(double p0, double p1, double p2, double p3, double s) {
    double u = 1.0 - s;
    return u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3;
}

/// Value of an absolute bezier segment from (x0, y0) to (x3, y3) at x.
static double bezier_at(double x0, double y0, double x1, double y1, double x2, double y2, double x3, double y3, double x) {
    double lo = 0.0, hi = 1.0;
    double s = (x - x0) / (x3 - x0);
    for (int k = 0; k < 40; k++) {
        double v = cubic4(x0, x1, x2, x3, s);
        if (std::fabs(v - x) < 1e-7) break;
        if (v < x) lo = s;
        else hi = s;
        s = (lo + hi) / 2.0;
    }
    return cubic4(y0, y1, y2, y3, s);
}

static double normalized_bezier(double x1, double y1, double x2, double y2, double x) {
    return bezier_at(0.0, 0.0, x1, y1, x2, y2, 1.0, 1.0, x);
}

void sample_raw(const std::vector<RawKey>& keys, double time, std::vector<double>& out) {
    out.clear();
    if (time < keys[0].time) {
        out = keys[0].values;
        return;
    }
    size_t i = 0;
    while (i + 1 < keys.size() && keys[i + 1].time <= time) i++;
    const RawKey& a = keys[i];
    if (i + 1 >= keys.size()) {
        out = a.values;
        return;
    }
    const RawKey& b = keys[i + 1];
    if (a.curve.type == RawCurve::Stepped) {
        out = a.values;
        return;
    }
    double t0 = a.time, t1 = b.time;
    if (t1 <= t0) {
        out = b.values;
        return;
    }
    const std::vector<double>& c = a.curve.points;
    for (size_t j = 0; j < a.values.size(); j++) {
        double v0 = a.values[j];
        double v1 = j < b.values.size() ? b.values[j] : NAN;
        double v;
        if (a.curve.type == RawCurve::Absolute && c.size() >= 4 * (j + 1) && c.size() >= 4 * a.values.size()) {
            v = bezier_at(t0, v0, c[4 * j], c[4 * j + 1], c[4 * j + 2], c[4 * j + 3], t1, v1, time);
        } else if (a.curve.type == RawCurve::Absolute && c.size() == 4) {
            double u = normalized_bezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0));
            v = v0 + (v1 - v0) * u;
        } else if (a.curve.type == RawCurve::Normalized) {
            double u = normalized_bezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0));
            v = v0 + (v1 - v0) * u;
        } else {
            v = v0 + (v1 - v0) * ((time - t0) / (t1 - t0));
        }
        out.push_back(v);
    }
}

// ---- atlas ----------------------------------------------------------------------------------------

static std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r' || s[a] == '\n' || s[a] == '\f' || s[a] == '\v')) a++;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r' || s[b - 1] == '\n' || s[b - 1] == '\f' || s[b - 1] == '\v')) b--;
    return s.substr(a, b - a);
}

/// Parses a whole string as a number (false when it is not one).
static bool parse_f64(const std::string& s, double& out) {
    if (s.empty()) return false;
    char* end = 0;
    out = strtod(s.c_str(), &end);
    return end == s.c_str() + s.size();
}

static bool parse_i64(const std::string& s, int64_t& out) {
    if (s.empty()) return false;
    char* end = 0;
    out = strtoll(s.c_str(), &end, 10);
    return end == s.c_str() + s.size();
}

static std::vector<double> ints(const std::string& v) {
    std::vector<double> out;
    size_t start = 0;
    for (;;) {
        size_t comma = v.find(',', start);
        std::string part = trim(v.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
        double n;
        out.push_back(parse_f64(part, n) ? n : NAN);
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return out;
}

static void set_values(double* const* target, size_t n, const std::vector<double>& values) {
    for (size_t i = 0; i < n && i < values.size(); i++) *target[i] = values[i];
}

Atlas Atlas::parse(const char* text, size_t len) {
    Atlas atlas;
    std::vector<AtlasPage>& pages = atlas.pages;
    if (len >= 3 && (unsigned char)text[0] == 0xef && (unsigned char)text[1] == 0xbb && (unsigned char)text[2] == 0xbf) {
        text += 3;
        len -= 3;
    }
    bool in_page = false, in_region = false;
    size_t pos = 0;
    while (pos <= len) {
        size_t nl = pos;
        while (nl < len && text[nl] != '\n') nl++;
        if (pos == len && nl == len) break;  // no line after a final newline
        std::string line = trim(std::string(text + pos, nl - pos));
        pos = nl + 1;
        if (line.empty()) {
            in_page = false;
            in_region = false;
            continue;
        }
        size_t colon = line.find(':');
        if (colon == std::string::npos) {
            if (!in_page) {
                AtlasPage page;
                page.name = line;
                page.width = page.height = 0;
                page.filter[0] = page.filter[1] = "Nearest";
                page.repeat = "none";
                page.pma = false;
                pages.push_back(page);
                in_page = true;
            } else {
                AtlasRegion r;
                r.name = line;
                r.index = -1;
                r.x = r.y = r.width = r.height = r.rotate = r.offset_x = r.offset_y = 0;
                r.original_width = r.original_height = -1;
                pages.back().regions.push_back(r);
                in_region = true;
            }
            continue;
        }
        if (!in_page) continue;
        std::string key = trim(line.substr(0, colon));
        std::string value = trim(line.substr(colon + 1));
        AtlasPage& page = pages.back();
        if (in_region) {
            AtlasRegion& r = page.regions.back();
            if (key == "bounds") {
                double* t[] = {&r.x, &r.y, &r.width, &r.height};
                set_values(t, 4, ints(value));
            } else if (key == "offsets") {
                double* t[] = {&r.offset_x, &r.offset_y, &r.original_width, &r.original_height};
                set_values(t, 4, ints(value));
            } else if (key == "xy") {
                double* t[] = {&r.x, &r.y};
                set_values(t, 2, ints(value));
            } else if (key == "size") {
                double* t[] = {&r.width, &r.height};
                set_values(t, 2, ints(value));
            } else if (key == "orig") {
                double* t[] = {&r.original_width, &r.original_height};
                set_values(t, 2, ints(value));
            } else if (key == "offset") {
                double* t[] = {&r.offset_x, &r.offset_y};
                set_values(t, 2, ints(value));
            } else if (key == "rotate") {
                double v;
                r.rotate = value == "true" ? 90.0 : value == "false" ? 0.0 : (parse_f64(value, v) ? v : 0.0);
            } else if (key == "index") {
                int64_t v;
                r.index = parse_i64(value, v) ? v : -1;
            }
        } else {
            if (key == "size") {
                double* t[] = {&page.width, &page.height};
                set_values(t, 2, ints(value));
            } else if (key == "filter") {
                std::vector<std::string> f;
                size_t start = 0;
                for (;;) {
                    size_t comma = value.find(',', start);
                    f.push_back(trim(value.substr(start, comma == std::string::npos ? std::string::npos : comma - start)));
                    if (comma == std::string::npos) break;
                    start = comma + 1;
                }
                page.filter[0] = f.empty() ? "" : f[0];
                page.filter[1] = f.size() > 1 ? f[1] : (f.empty() ? "" : f[0]);
            } else if (key == "repeat") {
                page.repeat = value;
            } else if (key == "pma") {
                page.pma = value == "true";
            }
        }
    }
    for (size_t p = 0; p < pages.size(); p++) {
        for (size_t k = 0; k < pages[p].regions.size(); k++) {
            AtlasRegion& r = pages[p].regions[k];
            if (r.original_width < 0.0) r.original_width = r.width;
            if (r.original_height < 0.0) r.original_height = r.height;
        }
    }
    return atlas;
}

std::unordered_map<std::string, RegionUv> Atlas::lookup() const {
    std::unordered_map<std::string, RegionUv> out;
    for (size_t p = 0; p < pages.size(); p++) {
        const AtlasPage& page = pages[p];
        for (size_t k = 0; k < page.regions.size(); k++) {
            const AtlasRegion& r = page.regions[k];
            std::string key = r.name;
            if (r.index >= 0) {
                char buf[32];
                snprintf(buf, sizeof buf, "%lld", (long long)r.index);
                key += buf;
            }
            out[key] = RegionUv(p, r, page.width, page.height);
        }
    }
    return out;
}

static double maxf(double a, double b) {
    return std::fmax(a, b);
}

RegionUv::RegionUv(size_t page_, const AtlasRegion& r, double page_w_, double page_h_) {
    page = page_;
    bool swap = std::fabs(std::fmod(r.rotate, 180.0)) == 90.0;
    double src_w = swap ? r.height : r.width;
    double src_h = swap ? r.width : r.height;
    ow = maxf(r.original_width, 1.0);
    oh = maxf(r.original_height, 1.0);
    dx = r.offset_x;
    dy = r.original_height - r.height - r.offset_y;
    w = r.width;
    h = r.height;
    // The page holds the packed image rotated by -rotate degrees about its center.
    double rad = -r.rotate * 3.14159265358979323846 / 180.0;
    trim[0] = dx / ow;
    trim[1] = dy / oh;
    trim[2] = (dx + w) / ow;
    trim[3] = (dy + h) / oh;
    src_x = r.x;
    src_y = r.y;
    cx = src_w / 2.0;
    cy = src_h / 2.0;
    cos = std::floor(std::cos(rad) * 1e6 + 0.5) / 1e6;
    sin = std::floor(std::sin(rad) * 1e6 + 0.5) / 1e6;
    page_w = maxf(page_w_, 1.0);
    page_h = maxf(page_h_, 1.0);
}

static double clampf(double v, double lo, double hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

void RegionUv::map(double u, double v, double& ou, double& ov) const {
    double qx = clampf(u * ow - dx, 0.0, w) - w / 2.0;
    double qy = clampf(v * oh - dy, 0.0, h) - h / 2.0;
    ou = (src_x + cx + qx * cos - qy * sin) / page_w;
    ov = (src_y + cy + qx * sin + qy * cos) / page_h;
}

// ---- skeleton data --------------------------------------------------------------------------------

size_t Vertices::deform_len() const {
    if (!weighted) return plain.size();
    size_t n = 0;
    for (size_t i = 0; i < weights.size(); i++) n += weights[i].size() * 2;
    return n;
}

NameId SkeletonData::intern(const std::string& name) {
    std::unordered_map<std::string, NameId>::const_iterator it = name_ids.find(name);
    if (it != name_ids.end()) return it->second;
    NameId id = (NameId)names.size();
    names.push_back(name);
    name_ids[name] = id;
    return id;
}

NameId SkeletonData::name_id(const std::string& name) const {
    std::unordered_map<std::string, NameId>::const_iterator it = name_ids.find(name);
    return it == name_ids.end() ? NO_NAME : it->second;
}

int SkeletonData::find_bone(const std::string& name) const {
    for (size_t i = 0; i < bones.size(); i++)
        if (bones[i].name == name) return (int)i;
    return NONE;
}

int SkeletonData::find_slot(const std::string& name) const {
    for (size_t i = 0; i < slots.size(); i++)
        if (slots[i].name == name) return (int)i;
    return NONE;
}

int SkeletonData::find_skin(const std::string& name) const {
    for (size_t i = 0; i < skins.size(); i++)
        if (skins[i].name == name) return (int)i;
    return NONE;
}

int SkeletonData::find_animation(const std::string& name) const {
    for (size_t i = 0; i < animations.size(); i++)
        if (animations[i].name == name) return (int)i;
    return NONE;
}

const std::vector<Attachment>* SkeletonData::skin_attachments(size_t slot, int skin) const {
    if (skin < 0) return slot < slots.size() ? &slots[slot].attachments : 0;
    if ((size_t)skin >= skins.size()) return 0;
    const SkinData& s = skins[(size_t)skin];
    for (size_t i = 0; i < s.slots.size(); i++)
        if (s.slots[i].first == slot) return &s.slots[i].second;
    return 0;
}

static const Attachment* find_named(const std::vector<Attachment>* list, NameId name) {
    if (!list) return 0;
    for (size_t i = 0; i < list->size(); i++)
        if ((*list)[i].name == name) return &(*list)[i];
    return 0;
}

const Attachment* SkeletonData::attachment(size_t slot, NameId name, int skin) const {
    if (name == NO_NAME) return 0;
    if (skin >= 0) {
        const Attachment* a = find_named(skin_attachments(slot, skin), name);
        if (a) return a;
    }
    if (slot >= slots.size()) return 0;
    return find_named(&slots[slot].attachments, name);
}

const Attachment* SkeletonData::mesh_source(size_t slot, const Attachment* att, int active_skin) const {
    if (att->kind != AttLinkedMesh) return att;
    int skin_index = NONE;
    bool named_skin = att->skin.has && att->skin.value != "default";
    if (named_skin) skin_index = find_skin(att->skin.value);
    const Attachment* in_skin = 0;
    if (!(named_skin && skin_index == NONE)) in_skin = find_named(skin_attachments(slot, skin_index), att->parent);
    const Attachment* found = in_skin ? in_skin : attachment(slot, att->parent, active_skin);
    if (!found) return 0;
    return found->kind == AttMesh ? found : 0;
}

}  // namespace rigby
