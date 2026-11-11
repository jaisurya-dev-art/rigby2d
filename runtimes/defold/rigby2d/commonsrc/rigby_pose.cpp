// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime (C++): evaluated skeleton state (local and world transforms, slot state, mesh
// deformation, draw order and constraints). Port of pose.rs; behaves exactly like it.

#include "rigby.h"

#include <algorithm>
#include <cmath>

namespace rigby {

namespace {

const double EPSILON = 1e-5;

double clampd(double v, double lo, double hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/// Index of the first key whose time is greater than `time` (keys sorted by time).
template <class K, class T>
size_t partition_point(const std::vector<K>& keys, double time, T time_of) {
    size_t lo = 0, hi = keys.size();
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        if (time_of(keys[mid]) <= time) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

double key_time(const Key& k) {
    return k.time;
}

double component(const Key& k, size_t c) {
    return c < k.values.size() ? k.values[c] : NAN;
}

/// Samples component `c` of numeric keys at `time` (keys must not be empty).
double sample_component(const std::vector<Key>& keys, double time, size_t c) {
    if (time <= keys[0].time) return component(keys[0], c);
    size_t next = partition_point(keys, time, key_time);
    if (next >= keys.size()) return component(keys[keys.size() - 1], c);
    const Key& a = keys[next - 1];
    const Key& b = keys[next];
    double span = b.time - a.time;
    double va = component(a, c);
    return va + (component(b, c) - va) * a.curve.ease(span > 0.0 ? (time - a.time) / span : 1.0, c);
}

/// Samples every component of numeric keys into `out`; false when there are no keys.
bool sample_into(const std::vector<Key>& keys, double time, std::vector<double>& out) {
    if (keys.empty()) return false;
    out.clear();
    if (time <= keys[0].time) {
        out = keys[0].values;
        return true;
    }
    size_t next = partition_point(keys, time, key_time);
    if (next >= keys.size()) {
        out = keys[keys.size() - 1].values;
        return true;
    }
    const Key& a = keys[next - 1];
    const Key& b = keys[next];
    double span = b.time - a.time;
    double t = span > 0.0 ? (time - a.time) / span : 1.0;
    for (size_t i = 0; i < a.values.size(); i++) {
        double vb = i < b.values.size() ? b.values[i] : NAN;
        out.push_back(lerp(a.values[i], vb, a.curve.ease(t, i)));
    }
    return true;
}

template <class T>
double pair_time(const std::pair<double, T>& k) {
    return k.first;
}

/// Discrete keys (names, modes): the value of the last key at or before `time` (the first key before it).
template <class T>
T sample_discrete(const std::vector<std::pair<double, T> >& keys, double time) {
    if (time <= keys[0].first) return keys[0].second;
    size_t next = partition_point(keys, time, pair_time<T>);
    return keys[(next > 1 ? next : 1) - 1].second;
}

double deform_key_time(const DeformKey& k) {
    return k.time;
}

/// Deform deltas at `time`: each key's sparse values expanded, interpolated along its curve.
std::vector<double> sample_deform(const std::vector<DeformKey>& keys, double time, size_t n) {
    size_t pp = partition_point(keys, time, deform_key_time);
    size_t i = pp > 0 ? pp - 1 : 0;
    const DeformKey& a = keys[i];
    std::vector<double> from(n, 0.0);
    for (size_t j = 0; j < a.vertices.size(); j++)
        if (a.offset + j < n) from[a.offset + j] = a.vertices[j];
    if (i + 1 >= keys.size()) return from;
    const DeformKey& b = keys[i + 1];
    if (time <= a.time || a.curve.type == Curve::Stepped) return from;
    std::vector<double> to(n, 0.0);
    for (size_t j = 0; j < b.vertices.size(); j++)
        if (b.offset + j < n) to[b.offset + j] = b.vertices[j];
    double e = a.curve.ease((time - a.time) / (b.time - a.time), 0);
    for (size_t j = 0; j < n; j++) from[j] += (to[j] - from[j]) * e;
    return from;
}

/// Frame for sequence keys at `time`, or none before the first key.
Opt<int64_t> sequence_index_at(const std::vector<SequenceKey>& keys, double time, int64_t count) {
    int k = -1;
    double delay = 0.0;
    for (size_t i = 0; i < keys.size(); i++) {
        if (keys[i].time > time) break;
        k = (int)i;
        if (keys[i].delay.has) delay = keys[i].delay.value;
    }
    if (k < 0) return Opt<int64_t>();
    const SequenceKey& key = keys[(size_t)k];
    int64_t index = key.index;
    if (key.mode == SeqHold || count <= 1) return Opt<int64_t>(std::min(std::max(index, (int64_t)0), count - 1));
    int64_t steps = delay > 0.0 ? (int64_t)std::floor((time - key.time) / delay + 1e-6) : 0;
    SequenceMode base = SeqHold;
    bool reverse = false;
    switch (key.mode) {
        case SeqOnce: base = SeqOnce; break;
        case SeqLoop: base = SeqLoop; break;
        case SeqPingPong: base = SeqPingPong; break;
        case SeqOnceReverse: base = SeqOnce; reverse = true; break;
        case SeqLoopReverse: base = SeqLoop; reverse = true; break;
        case SeqPingPongReverse: base = SeqPingPong; reverse = true; break;
        default: break;
    }
    int64_t f = index + steps;
    if (base == SeqOnce) {
        f = std::min(f, count - 1);
    } else if (base == SeqLoop) {
        f %= count;
    } else if (base == SeqPingPong) {
        int64_t period = 2 * (count - 1);
        f %= period;
        if (f >= count) f = period - f;
    }
    return Opt<int64_t>(reverse ? count - 1 - f : f);
}

/// Child world transform for an inherit mode. Translation always goes through the full parent;
/// the linear part through the part of the parent the mode keeps.
Affine inherit_world(const Affine& parent, const Affine& local, Inherit mode) {
    if (mode == InheritNormal) return parent.mul(local);
    double tx = parent.a * local.tx + parent.c * local.ty + parent.tx;
    double ty = parent.b * local.tx + parent.d * local.ty + parent.ty;
    double sx = std::hypot(parent.a, parent.b);
    double det = parent.determinant();
    double pa, pb, pc, pd;
    if (mode == InheritOnlyTranslation) {
        pa = 1.0;
        pb = 0.0;
        pc = 0.0;
        pd = 1.0;
    } else if (mode == InheritNoRotationOrReflection) {
        pa = sx;
        pb = 0.0;
        pc = 0.0;
        pd = sx > 1e-12 ? std::fabs(det) / sx : 0.0;
    } else {
        double ux = sx > 1e-12 ? parent.a / sx : 1.0;
        double uy = sx > 1e-12 ? parent.b / sx : 0.0;
        double flip = mode == InheritNoScale && det < 0.0 ? -1.0 : 1.0;
        pa = ux;
        pb = uy;
        pc = -uy * flip;
        pd = ux * flip;
    }
    return Affine(pa * local.a + pc * local.b, pb * local.a + pd * local.b, pa * local.c + pc * local.d, pb * local.c + pd * local.d, tx, ty);
}

/// The local transform that gives world transform `world` under `parent` and inherit `mode`.
Transform local_from_world(const Affine* parent, const Affine& world, Inherit mode) {
    if (!parent) return world.decompose();
    double x, y;
    parent->inverse().apply(world.tx, world.ty, x, y);
    Affine keep = inherit_world(*parent, Affine(), mode);
    keep.tx = 0.0;
    keep.ty = 0.0;
    Affine linear = keep.inverse().mul(Affine(world.a, world.b, world.c, world.d, 0.0, 0.0));
    linear.tx = x;
    linear.ty = y;
    return linear.decompose();
}

/// Rotates the linear part of `m` by `deg` degrees.
void rotate_linear(Affine& m, double deg) {
    if (deg == 0.0 || std::isnan(deg)) return;
    double c = std::cos(deg * DEG), s = std::sin(deg * DEG);
    double a = m.a, b = m.b, cc = m.c, d = m.d;
    m.a = c * a - s * b;
    m.b = s * a + c * b;
    m.c = c * cc - s * d;
    m.d = s * cc + c * d;
}

double local_property(const Transform& t, Property p) {
    switch (p) {
        case PropX: return t.x;
        case PropY: return t.y;
        case PropScaleX: return t.scale_x;
        case PropScaleY: return t.scale_y;
        case PropShearY: return t.shear_y;
        default: return t.rotation;
    }
}

double world_property(const Affine& m, Property p) {
    switch (p) {
        case PropX: return m.tx;
        case PropY: return m.ty;
        case PropScaleX: return std::hypot(m.a, m.b);
        case PropScaleY: return std::hypot(m.c, m.d);
        case PropShearY: return wrap_degrees(angle_of(m.c, m.d) - angle_of(m.a, m.b) - 90.0);
        default: return angle_of(m.a, m.b);
    }
}

const Vertices* vertices_of(const Attachment& att) {
    return att.is_mesh_like() ? &att.vertices : 0;
}

size_t deform_len(const Attachment& att) {
    const Vertices* v = vertices_of(att);
    return v ? v->deform_len() : 0;
}

// ---- paths ----------------------------------------------------------------------------------------

const int SEGMENTS = 16;

/// A path from world vertices laid out as [in-handle, point, out-handle] per path point.
struct PathCurve {
    std::vector<double> curves;  // 8 per curve
    std::vector<double> tables;  // SEGMENTS + 1 per curve
    std::vector<double> ends;
    double length;
    bool closed, constant;

    const double* curve(size_t i) const { return &curves[8 * i]; }
    const double* table(size_t i) const { return &tables[(SEGMENTS + 1) * i]; }

    bool build(const std::vector<double>& v, bool closed_, bool constant_speed, const std::vector<double>& lengths) {
        size_t point_count = v.size() / 6;
        if (point_count < 2 && !(closed_ && point_count >= 1)) return false;
        size_t curve_count = closed_ ? point_count : point_count - 1;
        curves.clear();
        for (size_t i = 0; i < curve_count; i++) {
            size_t o = 6 * i;
            size_t next = closed_ && i == point_count - 1 ? 0 : o + 6;
            double cv[8] = {v[o + 2], v[o + 3], v[o + 4], v[o + 5], v[next], v[next + 1], v[next + 2], v[next + 3]};
            curves.insert(curves.end(), cv, cv + 8);
        }
        tables.assign(curve_count * (SEGMENTS + 1), 0.0);
        for (size_t i = 0; i < curve_count; i++) {
            const double* cv = curve(i);
            double* t = &tables[(SEGMENTS + 1) * i];
            double px = cv[0], py = cv[1];
            for (int s = 1; s <= SEGMENTS; s++) {
                double u = (double)s / (double)SEGMENTS;
                double x = cubic4(cv[0], cv[2], cv[4], cv[6], u);
                double y = cubic4(cv[1], cv[3], cv[5], cv[7], u);
                t[s] = t[s - 1] + std::hypot(x - px, y - py);
                px = x;
                py = y;
            }
        }
        constant = constant_speed || lengths.empty();
        ends.clear();
        if (constant) {
            double sum = 0.0;
            for (size_t i = 0; i < curve_count; i++) {
                sum += table(i)[SEGMENTS];
                ends.push_back(sum);
            }
        } else {
            for (size_t i = 0; i < curve_count; i++) {
                double e = i < lengths.size() ? lengths[i] : (i > 0 ? ends[i - 1] : 0.0);
                ends.push_back(e);
            }
        }
        length = ends.empty() ? 0.0 : ends.back();
        closed = closed_;
        return !(length < EPSILON);
    }

    void evaluate(size_t i, double u, double* out) const {
        const double* cv = curve(i);
        double x = cubic4(cv[0], cv[2], cv[4], cv[6], u);
        double y = cubic4(cv[1], cv[3], cv[5], cv[7], u);
        double dx = 3.0 * (1.0 - u) * (1.0 - u) * (cv[2] - cv[0]) + 6.0 * (1.0 - u) * u * (cv[4] - cv[2]) + 3.0 * u * u * (cv[6] - cv[4]);
        double dy = 3.0 * (1.0 - u) * (1.0 - u) * (cv[3] - cv[1]) + 6.0 * (1.0 - u) * u * (cv[5] - cv[3]) + 3.0 * u * u * (cv[7] - cv[5]);
        if (std::hypot(dx, dy) < EPSILON) {
            dx = cv[6] - cv[0];
            dy = cv[7] - cv[1];
        }
        out[0] = x;
        out[1] = y;
        out[2] = angle_of(dx, dy);
    }

    /// Point and tangent (degrees) at a distance along the path.
    void at(double dist, double* out) const {
        if (closed) {
            dist = std::fmod(dist, length);
            if (dist < 0.0) dist += length;
        } else if (dist < 0.0) {
            const double* cv = curve(0);
            double ang = angle_of(cv[2] - cv[0], cv[3] - cv[1]);
            out[0] = cv[0] + std::cos(ang * DEG) * dist;
            out[1] = cv[1] + std::sin(ang * DEG) * dist;
            out[2] = ang;
            return;
        } else if (dist > length) {
            const double* cv = curve(curves.size() / 8 - 1);
            double ang = angle_of(cv[6] - cv[4], cv[7] - cv[5]);
            double over = dist - length;
            out[0] = cv[6] + std::cos(ang * DEG) * over;
            out[1] = cv[7] + std::sin(ang * DEG) * over;
            out[2] = ang;
            return;
        }
        size_t i = 0;
        while (i < ends.size() - 1 && dist > ends[i]) i++;
        double start = i > 0 ? ends[i - 1] : 0.0;
        double span = ends[i] - start;
        double f = span > EPSILON ? (dist - start) / span : 0.0;
        if (!constant) {
            evaluate(i, f, out);
            return;
        }
        // Constant speed: invert the arc length table.
        const double* t = table(i);
        double target = f * t[SEGMENTS];
        int s = 1;
        while (s < SEGMENTS && t[s] < target) s++;
        double seg = t[s] - t[s - 1];
        double u = ((double)s - 1.0 + (seg > EPSILON ? (target - t[s - 1]) / seg : 0.0)) / (double)SEGMENTS;
        evaluate(i, u, out);
    }
};

}  // namespace

// ---- draw order -----------------------------------------------------------------------------------

std::vector<size_t> apply_draw_order(size_t count, const std::vector<std::pair<size_t, int64_t> >* offsets) {
    std::vector<size_t> identity(count);
    for (size_t i = 0; i < count; i++) identity[i] = i;
    if (!offsets || offsets->empty()) return identity;
    std::vector<long long> order(count, -1);
    std::vector<size_t> unchanged;
    size_t original = 0;
    std::vector<std::pair<size_t, int64_t> > sorted = *offsets;
    std::stable_sort(sorted.begin(), sorted.end(), [](const std::pair<size_t, int64_t>& a, const std::pair<size_t, int64_t>& b) { return a.first < b.first; });
    for (size_t k = 0; k < sorted.size(); k++) {
        size_t slot = sorted[k].first;
        if (slot >= count) continue;
        while (original < slot) unchanged.push_back(original++);
        int64_t at = (int64_t)original + sorted[k].second;
        if (at >= 0 && (size_t)at < count && order[(size_t)at] == -1) order[(size_t)at] = (long long)original;
        else unchanged.push_back(original);
        original++;
    }
    while (original < count) unchanged.push_back(original++);
    for (size_t i = count; i-- > 0;) {
        if (order[i] == -1) {
            if (unchanged.empty()) order[i] = -1;
            else {
                order[i] = (long long)unchanged.back();
                unchanged.pop_back();
            }
        }
    }
    std::vector<size_t> out(count);
    for (size_t i = 0; i < count; i++) out[i] = order[i] > 0 ? (size_t)order[i] : 0;
    return out;
}

// ---- pose -----------------------------------------------------------------------------------------

ConstraintState ConstraintState::setup(const ConstraintData& c) {
    ConstraintState s;
    s.kind = c.kind;
    for (int i = 0; i < 7; i++) s.v[i] = 0.0;
    switch (c.kind) {
        case ConstraintTransform:
            for (int i = 0; i < PROPS; i++) s.v[i] = c.transform.mix[i];
            break;
        case ConstraintPath: s.path = c.path.setup; break;
        case ConstraintPhysics:
            for (int i = 0; i < 7; i++) s.v[i] = c.physics.setup[i];
            break;
        case ConstraintSlider:
            s.v[0] = c.slider.setup[0];
            s.v[1] = c.slider.setup[1];
            break;
    }
    return s;
}

Pose::Pose(const SkeletonData& sk) : physics_delta(0), skin(NONE), into_applied_(false) {
    std::vector<std::pair<double, Step> > steps;
    for (size_t i = 0; i < sk.ik.size(); i++) {
        Step s = {true, i};
        steps.push_back(std::make_pair(sk.ik[i].order, s));
    }
    for (size_t i = 0; i < sk.constraints.size(); i++) {
        Step s = {false, i};
        steps.push_back(std::make_pair(sk.constraints[i].order, s));
    }
    std::stable_sort(steps.begin(), steps.end(), [](const std::pair<double, Step>& a, const std::pair<double, Step>& b) { return a.first < b.first; });
    for (size_t i = 0; i < steps.size(); i++) steps_.push_back(steps[i].second);
    world.assign(sk.bones.size(), Affine());
    for (size_t i = 0; i < sk.constraints.size(); i++) constraint_state.push_back(ConstraintState::setup(sk.constraints[i]));
    physics.assign(sk.constraints.size(), Opt<PhysicsSim>());
    dirty_.assign(sk.bones.size(), 0);
    set_to_setup(sk);
}

void Pose::set_to_setup(const SkeletonData& sk) {
    reset(sk);
    update_world(sk);
}

void Pose::reset(const SkeletonData& sk) {
    size_t nb = sk.bones.size(), ns = sk.slots.size();
    local.resize(nb);
    inherit.resize(nb);
    for (size_t i = 0; i < nb; i++) {
        local[i] = sk.bones[i].setup;
        inherit[i] = sk.bones[i].inherit;
    }
    attachment.resize(ns);
    color.resize(ns);
    dark.resize(ns);
    draw_order.resize(ns);
    sequence.assign(ns, -1);
    for (size_t i = 0; i < ns; i++) {
        const SlotData& s = sk.slots[i];
        attachment[i] = s.attachment;
        for (int k = 0; k < 4; k++) color[i].v[k] = s.color[k];
        dark[i].has = s.has_dark;
        for (int k = 0; k < 3; k++) dark[i].v[k] = s.dark[k];
        draw_order[i] = i;
    }
    deform.clear();
    ik.resize(sk.ik.size());
    for (size_t i = 0; i < sk.ik.size(); i++) {
        const IkData& c = sk.ik[i];
        IkState st = {c.mix, c.softness, c.bend_positive, c.compress, c.stretch};
        ik[i] = st;
    }
    for (size_t i = 0; i < constraint_state.size() && i < sk.constraints.size(); i++) constraint_state[i] = ConstraintState::setup(sk.constraints[i]);
}

void Pose::reset_physics() {
    for (size_t i = 0; i < physics.size(); i++) physics[i] = Opt<PhysicsSim>();
}

void Pose::apply(const SkeletonData& sk, size_t anim, double time, double alpha) {
    if (anim >= sk.animations.size()) return;
    apply_animation(sk, sk.animations[anim], time, alpha);
}

void Pose::apply_animation(const SkeletonData& sk, const Animation& anim, double time, double alpha) {
    bool hold = alpha >= 0.5;
    for (size_t ti = 0; ti < anim.bones.size(); ti++) {
        const BoneTimeline& t = anim.bones[ti];
        if (t.bone >= sk.bones.size()) continue;
        const Transform& setup = sk.bones[t.bone].setup;
        Transform& l = into_applied_ ? applied[t.bone] : local[t.bone];
        double x = l.x, y = l.y, rotation = l.rotation, sx = l.scale_x, sy = l.scale_y, hx = l.shear_x, hy = l.shear_y;
        const std::vector<Key>* c = t.channels;
        if (!c[CH_ROTATE].empty()) rotation = setup.rotation + sample_component(c[CH_ROTATE], time, 0);
        if (!c[CH_TRANSLATE].empty()) {
            x = setup.x + sample_component(c[CH_TRANSLATE], time, 0);
            y = setup.y + sample_component(c[CH_TRANSLATE], time, 1);
        }
        if (!c[CH_TRANSLATE_X].empty()) x = setup.x + sample_component(c[CH_TRANSLATE_X], time, 0);
        if (!c[CH_TRANSLATE_Y].empty()) y = setup.y + sample_component(c[CH_TRANSLATE_Y], time, 0);
        if (!c[CH_SCALE].empty()) {
            sx = setup.scale_x * sample_component(c[CH_SCALE], time, 0);
            sy = setup.scale_y * sample_component(c[CH_SCALE], time, 1);
        }
        if (!c[CH_SCALE_X].empty()) sx = setup.scale_x * sample_component(c[CH_SCALE_X], time, 0);
        if (!c[CH_SCALE_Y].empty()) sy = setup.scale_y * sample_component(c[CH_SCALE_Y], time, 0);
        if (!c[CH_SHEAR].empty()) {
            hx = setup.shear_x + sample_component(c[CH_SHEAR], time, 0);
            hy = setup.shear_y + sample_component(c[CH_SHEAR], time, 1);
        }
        if (!c[CH_SHEAR_X].empty()) hx = setup.shear_x + sample_component(c[CH_SHEAR_X], time, 0);
        if (!c[CH_SHEAR_Y].empty()) hy = setup.shear_y + sample_component(c[CH_SHEAR_Y], time, 0);
        if (hold && !t.inherit.empty()) inherit[t.bone] = sample_discrete(t.inherit, time);
        if (alpha >= 1.0) {
            l = Transform(x, y, rotation, sx, sy, hx, hy);
        } else {
            l.x = lerp(l.x, x, alpha);
            l.y = lerp(l.y, y, alpha);
            l.rotation = lerp(l.rotation, rotation, alpha);
            l.scale_x = lerp(l.scale_x, sx, alpha);
            l.scale_y = lerp(l.scale_y, sy, alpha);
            l.shear_x = lerp(l.shear_x, hx, alpha);
            l.shear_y = lerp(l.shear_y, hy, alpha);
        }
    }
    std::vector<double>& v = scratch_;
    for (size_t ti = 0; ti < anim.slots.size(); ti++) {
        const SlotTimeline& t = anim.slots[ti];
        size_t i = t.slot;
        if (i >= attachment.size()) continue;
        if (hold && !t.attachment.empty()) attachment[i] = sample_discrete(t.attachment, time);
        Rgba col = color[i];
        DarkRgb dk = dark[i];
        if (sample_into(t.color, time, v))
            for (size_t k = 0; k < 4 && k < v.size(); k++) col.v[k] = v[k];
        // An 8-digit color in an rgb key also sets alpha (as the JavaScript runtime does).
        if (sample_into(t.rgb, time, v))
            for (size_t k = 0; k < 4 && k < v.size(); k++) col.v[k] = v[k];
        if (sample_into(t.alpha, time, v)) col.v[3] = v[0];
        if (sample_into(t.rgba2, time, v)) {
            for (int k = 0; k < 4; k++) col.v[k] = v[(size_t)k];
            dk.has = true;
            dk.v[0] = v[4];
            dk.v[1] = v[5];
            dk.v[2] = v[6];
        }
        if (sample_into(t.rgb2, time, v)) {
            for (int k = 0; k < 3; k++) col.v[k] = v[(size_t)k];
            dk.has = true;
            dk.v[0] = v[3];
            dk.v[1] = v[4];
            dk.v[2] = v[5];
        }
        for (int k = 0; k < 4; k++) color[i].v[k] = lerp(color[i].v[k], col.v[k], alpha);
        if (dk.has) {
            const double* from = dark[i].has ? dark[i].v : dk.v;
            double next[3] = {lerp(from[0], dk.v[0], alpha), lerp(from[1], dk.v[1], alpha), lerp(from[2], dk.v[2], alpha)};
            dark[i].has = true;
            for (int k = 0; k < 3; k++) dark[i].v[k] = next[k];
        }
    }
    for (size_t ti = 0; ti < anim.deform.size(); ti++) {
        const DeformTimeline& t = anim.deform[ti];
        if (t.keys.empty() || t.slot >= sk.slots.size()) continue;
        int dskin = t.skin.has ? sk.find_skin(t.skin.value) : skin;
        // A named skin that does not exist resolves through the default skin only.
        const Attachment* att = sk.attachment(t.slot, t.attachment, dskin);
        if (!att) continue;
        const Attachment* source = sk.mesh_source(t.slot, att, skin);
        if (!source) source = att;
        size_t n = deform_len(*source);
        std::vector<double> deltas = sample_deform(t.keys, time, n);
        std::pair<size_t, NameId> key(t.slot, t.attachment);
        std::map<std::pair<size_t, NameId>, std::vector<double> >::iterator prev = deform.find(key);
        if (prev != deform.end() && alpha < 1.0) {
            for (size_t j = 0; j < prev->second.size(); j++) prev->second[j] = lerp(prev->second[j], j < deltas.size() ? deltas[j] : 0.0, alpha);
        } else {
            deform[key] = deltas;
        }
    }
    // Sequence keys: the frame of the image sequence a slot's attachment shows.
    if (hold) {
        for (size_t ti = 0; ti < anim.sequences.size(); ti++) {
            const SequenceTimeline& t = anim.sequences[ti];
            if (attachment[t.slot] != t.attachment) continue;
            int sskin = t.skin.has ? sk.find_skin(t.skin.value) : NONE;
            const Attachment* att = sk.attachment(t.slot, t.attachment, sskin);
            if (!att) att = sk.attachment(t.slot, t.attachment, skin);
            if (!att || !att->has_sequence) continue;
            Opt<int64_t> index = sequence_index_at(t.keys, time, att->sequence.count);
            if (index.has) sequence[t.slot] = index.value;
        }
    }
    if (hold && !anim.draw_order.empty()) {
        size_t pp = 0;
        while (pp < anim.draw_order.size() && anim.draw_order[pp].time <= time) pp++;
        if (pp > 0) {
            const DrawOrderKey& k = anim.draw_order[pp - 1];
            draw_order = apply_draw_order(sk.slots.size(), k.has_offsets ? &k.offsets : 0);
        }
    }
    apply_constraint_timelines(sk, anim, time, alpha);
    for (size_t ti = 0; ti < anim.ik.size(); ti++) {
        const IkTimeline& t = anim.ik[ti];
        if (t.constraint >= ik.size()) continue;
        IkState& state = ik[t.constraint];
        size_t pp = 0;
        while (pp < t.keys.size() && t.keys[pp].time <= time) pp++;
        if (pp == 0) continue;
        const IkKey& a = t.keys[pp - 1];
        const IkKey* b = pp < t.keys.size() ? &t.keys[pp] : 0;
        double frac = b && b->time > a.time ? (time - a.time) / (b->time - a.time) : 0.0;
        double mix = lerp(a.mix, b ? b->mix : a.mix, frac);
        double softness = lerp(a.softness, b ? b->softness : a.softness, frac);
        state.mix = lerp(state.mix, mix, alpha);
        state.softness = lerp(state.softness, softness, alpha);
        if (hold) {
            state.bend_positive = a.bend_positive;
            state.compress = a.compress;
            state.stretch = a.stretch;
        }
    }
}

void Pose::apply_constraint_timelines(const SkeletonData& sk, const Animation& anim, double time, double alpha) {
    if (!anim.has_constraint_keys) return;
    std::vector<double>& v = scratch_;
    for (size_t ti = 0; ti < anim.constraints.size(); ti++) {
        const ConstraintTimeline& t = anim.constraints[ti];
        const ConstraintData& c = sk.constraints[t.constraint];
        ConstraintState& state = constraint_state[t.constraint];
        switch (state.kind) {
            case ConstraintTransform:
                if (t.transform.empty()) continue;
                sample_raw(t.transform, time, v);
                for (int j = 0; j < PROPS; j++) state.v[j] += (v[(size_t)j] - state.v[j]) * alpha;
                break;
            case ConstraintSlider: {
                const std::vector<RawKey>* lists[2] = {&t.slider_time, &t.slider_mix};
                for (int k = 0; k < 2; k++) {
                    if (lists[k]->empty()) continue;
                    sample_raw(*lists[k], time, v);
                    state.v[k] += (v[0] - state.v[k]) * alpha;
                }
                break;
            }
            case ConstraintPhysics: {
                if (c.kind != ConstraintPhysics) break;
                for (int g = 0; g < 2; g++) {
                    const std::vector<RawKey>* lists = g == 0 ? t.physics : t.physics_global;
                    for (int k = 0; k < 7; k++) {
                        if (lists[k].empty() || (g == 1 && !c.physics.globals[k])) continue;
                        sample_raw(lists[k], time, v);
                        state.v[k] += (v[0] - state.v[k]) * alpha;
                    }
                }
                break;
            }
            case ConstraintPath: {
                PathState& s = state.path;
                if (!t.position.empty()) {
                    sample_raw(t.position, time, v);
                    s.position += (v[0] - s.position) * alpha;
                }
                if (!t.spacing.empty()) {
                    sample_raw(t.spacing, time, v);
                    s.spacing += (v[0] - s.spacing) * alpha;
                }
                if (!t.path_mix.empty()) {
                    sample_raw(t.path_mix, time, v);
                    s.mix_rotate += (v[0] - s.mix_rotate) * alpha;
                    s.mix_x += (v[1] - s.mix_x) * alpha;
                    s.mix_y += (v[2] - s.mix_y) * alpha;
                }
                break;
            }
        }
    }
}

void Pose::update_world(const SkeletonData& sk) {
    applied = local;
    world.resize(sk.bones.size());
    compute_world(sk);
    double delta = physics_delta;
    physics_delta = 0.0;
    for (size_t s = 0; s < steps_.size(); s++) {
        Step step = steps_[s];
        if (step.ik) {
            const IkData& c = sk.ik[step.index];
            if (c.skin_required) {
                bool active = skin >= 0 && std::find(sk.skins[(size_t)skin].ik.begin(), sk.skins[(size_t)skin].ik.end(), step.index) != sk.skins[(size_t)skin].ik.end();
                if (!active) continue;
            }
            IkState state = ik[step.index];
            solve_ik(sk, c, state);
            continue;
        }
        const ConstraintData& c = sk.constraints[step.index];
        if (!constraint_active(sk, c)) continue;
        Solved result;
        switch (c.kind) {
            case ConstraintTransform: result = solve_transform(c, c.transform, step.index); break;
            case ConstraintPath: result = solve_path(sk, c, c.path, step.index); break;
            case ConstraintSlider: result = solve_slider(sk, c.slider, step.index); break;
            case ConstraintPhysics: result = solve_physics(sk, c.physics, step.index, delta); break;
        }
        switch (result.type) {
            case Solved::SolvedNone: break;
            case Solved::SolvedAll: compute_world(sk); break;
            case Solved::SolvedWorld: set_worlds(sk, result.world); break;
            case Solved::SolvedLocal:
                for (size_t b = 0; b < result.local.size(); b++) update_branch(sk, result.local[b]);
                break;
        }
    }
}

bool Pose::constraint_active(const SkeletonData& sk, const ConstraintData& c) const {
    if (!c.skin_required) return true;
    if (skin < 0) return false;
    const std::vector<std::string>& list = sk.skins[(size_t)skin].constraints;
    return std::find(list.begin(), list.end(), c.name) != list.end();
}

void Pose::compute_world(const SkeletonData& sk) {
    for (size_t i = 0; i < sk.bones.size(); i++) update_bone(sk, i);
}

void Pose::update_bone(const SkeletonData& sk, size_t i) {
    Affine l = applied[i].to_affine();
    int p = sk.bones[i].parent;
    if (p < 0) world[i] = placement.has ? placement.value.mul(l) : l;
    else world[i] = inherit_world(world[(size_t)p], l, inherit[i]);
}

void Pose::update_branch(const SkeletonData& sk, size_t root) {
    dirty_.assign(sk.bones.size(), 0);
    dirty_[root] = 1;
    update_bone(sk, root);
    for (size_t i = root + 1; i < sk.bones.size(); i++) {
        int p = sk.bones[i].parent;
        if (p >= 0 && dirty_[(size_t)p]) {
            dirty_[i] = 1;
            update_bone(sk, i);
        }
    }
}

void Pose::set_worlds(const SkeletonData& sk, const std::vector<std::pair<size_t, Affine> >& desired) {
    dirty_.assign(sk.bones.size(), 0);
    size_t first = sk.bones.size();
    for (size_t k = 0; k < desired.size(); k++) first = std::min(first, desired[k].first);
    for (size_t i = first; i < sk.bones.size(); i++) {
        int p = sk.bones[i].parent;
        const Affine* want = 0;
        for (size_t k = desired.size(); k-- > 0;) {
            if (desired[k].first == i) {
                want = &desired[k].second;
                break;
            }
        }
        if (want) {
            if (p < 0 && placement.has) applied[i] = local_from_world(&placement.value, *want, InheritNormal);
            else applied[i] = local_from_world(p >= 0 ? &world[(size_t)p] : 0, *want, inherit[i]);
            world[i] = *want;
            dirty_[i] = 1;
        } else if (p >= 0 && dirty_[(size_t)p]) {
            update_bone(sk, i);
            dirty_[i] = 1;
        }
    }
}

// ---- IK -------------------------------------------------------------------------------------------

double Pose::parent_sign(const SkeletonData& sk, size_t b) const {
    int p = sk.bones[b].parent;
    return p >= 0 && world[(size_t)p].determinant() < 0.0 ? -1.0 : 1.0;
}

void Pose::aim(const SkeletonData& sk, size_t b, const double* from, const double* tip, const double* target, double mix) {
    double delta = wrap_degrees(angle_of(target[0] - from[0], target[1] - from[1]) - angle_of(tip[0] - from[0], tip[1] - from[1]));
    applied[b].rotation += delta * mix * parent_sign(sk, b);
}

void Pose::solve_ik(const SkeletonData& sk, const IkData& c, const IkState& state) {
    double mix = state.mix;
    if (mix <= 0.0 || c.bones.empty()) return;
    double target[2];
    world[c.target].apply(0.0, 0.0, target[0], target[1]);
    if (c.bones.size() == 1) {
        size_t b = c.bones[0];
        Affine w = world[b];
        double origin[2], tip[2];
        w.apply(0.0, 0.0, origin[0], origin[1]);
        w.apply(1.0, 0.0, tip[0], tip[1]);
        aim(sk, b, origin, tip, target, mix);
        double bone_len = sk.bones[b].length * std::hypot(w.a, w.b);
        double dist = std::hypot(target[0] - origin[0], target[1] - origin[1]);
        if (bone_len > 1e-4 && ((state.compress && dist < bone_len) || (state.stretch && dist > bone_len))) {
            double s = (dist / bone_len - 1.0) * mix + 1.0;
            applied[b].scale_x *= s;
            if (c.uniform) applied[b].scale_y *= s;
        }
        update_branch(sk, b);
        return;
    }
    size_t p = c.bones[0], ch = c.bones[1];
    double pp[2], cc[2], tip[2];
    world[p].apply(0.0, 0.0, pp[0], pp[1]);
    world[ch].apply(0.0, 0.0, cc[0], cc[1]);
    world[ch].apply(sk.bones[ch].length, 0.0, tip[0], tip[1]);
    double a = std::hypot(cc[0] - pp[0], cc[1] - pp[1]);
    double b_len = std::hypot(tip[0] - cc[0], tip[1] - cc[1]);
    if (a < 1e-4 || b_len < 1e-4) {
        double to[2];
        if (cc[0] != pp[0] || cc[1] != pp[1]) {
            to[0] = cc[0];
            to[1] = cc[1];
        } else {
            world[p].apply(1.0, 0.0, to[0], to[1]);
        }
        aim(sk, p, pp, to, target, mix);
        update_branch(sk, p);
        return;
    }
    double d = std::hypot(target[0] - pp[0], target[1] - pp[1]);
    if (state.stretch && d > a + b_len) {
        // Out of reach: straighten the chain toward the target (the parent aims, then the child),
        // then stretch the parent to the distance, so the child stretches in line.
        aim(sk, p, pp, cc, target, mix);
        update_branch(sk, p);
        finish_two_bone(sk, ch, target, mix);
        double s = (d / (a + b_len) - 1.0) * mix + 1.0;
        applied[p].scale_x *= s;
        if (c.uniform) applied[p].scale_y *= s;
        update_branch(sk, p);
        return;
    }
    double soft = state.softness;
    if (soft > 0.0 && d > a + b_len - soft) d = a + b_len - soft * std::exp(-(d - (a + b_len - soft)) / soft);
    d = std::fmin(std::fmax(d, std::fabs(a - b_len) + 1e-6), a + b_len - 1e-6);
    double cos_a = clampd((a * a + d * d - b_len * b_len) / (2.0 * a * d), -1.0, 1.0);
    double angle = std::acos(cos_a) / DEG;
    // A mirrored chain bends the other way on screen.
    double bend = (state.bend_positive ? 1.0 : -1.0) * (world[p].determinant() < 0.0 ? -1.0 : 1.0);
    double desired = angle_of(target[0] - pp[0], target[1] - pp[1]) - bend * angle;
    double delta = wrap_degrees(desired - angle_of(cc[0] - pp[0], cc[1] - pp[1]));
    applied[p].rotation += delta * mix * parent_sign(sk, p);
    update_branch(sk, p);
    finish_two_bone(sk, ch, target, mix);
}

void Pose::finish_two_bone(const SkeletonData& sk, size_t ch, const double* target, double mix) {
    double cc[2], tip[2];
    world[ch].apply(0.0, 0.0, cc[0], cc[1]);
    world[ch].apply(std::fmax(sk.bones[ch].length, 1e-3), 0.0, tip[0], tip[1]);
    double delta = wrap_degrees(angle_of(target[0] - cc[0], target[1] - cc[1]) - angle_of(tip[0] - cc[0], tip[1] - cc[1]));
    applied[ch].rotation += delta * mix * parent_sign(sk, ch);
    update_branch(sk, ch);
}

// ---- transform constraints -------------------------------------------------------------------------

void Pose::source_values(const TransformData& t, double* out) const {
    if (t.local_source) {
        const Transform& a = applied[t.source];
        out[0] = a.rotation;
        out[1] = a.x;
        out[2] = a.y;
        out[3] = a.scale_x;
        out[4] = a.scale_y;
        out[5] = a.shear_y;
        return;
    }
    const Affine& s = world[t.source];
    double x, y;
    s.apply(t.offsets[P_X], t.offsets[P_Y], x, y);
    double x_angle = angle_of(s.a, s.b);
    out[0] = x_angle;
    out[1] = x;
    out[2] = y;
    out[3] = std::hypot(s.a, s.b);
    out[4] = std::hypot(s.c, s.d);
    out[5] = wrap_degrees(angle_of(s.c, s.d) - x_angle - 90.0);
}

void Pose::target_values(const TransformData& t, Opt<double>* out) const {
    double src[PROPS];
    source_values(t, src);
    bool reflected = !t.local_source && world[t.source].determinant() < 0.0;
    for (int i = 0; i < PROPS; i++) out[i] = Opt<double>();
    for (size_t pi = 0; pi < t.props.size(); pi++) {
        const PropMap& p = t.props[pi];
        double from = src[p.from] - p.offset;
        for (size_t k = 0; k < p.to.size(); k++) {
            const PropTarget& to = p.to[k];
            double v = from * to.scale + to.offset;
            if (t.clamp) v = std::fmin(std::fmax(v, std::fmin(to.offset, to.max)), std::fmax(to.offset, to.max));
            // World x/y offsets are already applied through the source bone.
            bool point_offset = !t.local_source && (to.prop == P_X || to.prop == P_Y) && (p.from == P_X || p.from == P_Y);
            double off = point_offset ? 0.0 : t.offsets[to.prop];
            if (reflected && (to.prop == P_ROTATE || to.prop == P_SHEAR_Y)) off = -off;
            out[to.prop] = Opt<double>(out[to.prop].value_or(0.0) + v + off);
        }
    }
}

Pose::Solved Pose::solve_transform(const ConstraintData& c, const TransformData& t, size_t index) {
    Solved out;
    const ConstraintState& state = constraint_state[index];
    if (state.kind != ConstraintTransform) return out;
    const double* mix = state.v;
    bool all_zero = true;
    for (int i = 0; i < PROPS; i++)
        if (mix[i] != 0.0) all_zero = false;
    if (all_zero) return out;
    Opt<double> v[PROPS];
    target_values(t, v);
    if (t.local_target) {
        for (size_t bi = 0; bi < c.bones.size(); bi++) {
            Transform& a = applied[c.bones[bi]];
            double m[PROPS], val[PROPS];
            for (int p = 0; p < PROPS; p++) {
                m[p] = v[p].has ? mix[p] : 0.0;
                val[p] = v[p].has ? v[p].value : NAN;
            }
            if (t.additive) {
                if (m[P_ROTATE] != 0.0) a.rotation += val[P_ROTATE] * mix[P_ROTATE];
                if (m[P_X] != 0.0) a.x += val[P_X] * mix[P_X];
                if (m[P_Y] != 0.0) a.y += val[P_Y] * mix[P_Y];
                if (m[P_SCALE_X] != 0.0) a.scale_x *= (val[P_SCALE_X] - 1.0) * mix[P_SCALE_X] + 1.0;
                if (m[P_SCALE_Y] != 0.0) a.scale_y *= (val[P_SCALE_Y] - 1.0) * mix[P_SCALE_Y] + 1.0;
                if (m[P_SHEAR_Y] != 0.0) a.shear_y += val[P_SHEAR_Y] * mix[P_SHEAR_Y];
            } else {
                if (m[P_ROTATE] != 0.0) a.rotation += wrap_degrees(val[P_ROTATE] - a.rotation) * mix[P_ROTATE];
                if (m[P_X] != 0.0) a.x += (val[P_X] - a.x) * mix[P_X];
                if (m[P_Y] != 0.0) a.y += (val[P_Y] - a.y) * mix[P_Y];
                if (m[P_SCALE_X] != 0.0) a.scale_x += (val[P_SCALE_X] - a.scale_x) * mix[P_SCALE_X];
                if (m[P_SCALE_Y] != 0.0) a.scale_y += (val[P_SCALE_Y] - a.scale_y) * mix[P_SCALE_Y];
                if (m[P_SHEAR_Y] != 0.0) a.shear_y += wrap_degrees(val[P_SHEAR_Y] - a.shear_y) * mix[P_SHEAR_Y];
            }
        }
        out.type = Solved::SolvedLocal;
        out.local = c.bones;
        return out;
    }
    for (size_t bi = 0; bi < c.bones.size(); bi++) {
        size_t b = c.bones[bi];
        Affine m = world[b];
        if (v[P_ROTATE].has && mix[P_ROTATE] != 0.0) {
            double r = t.additive ? v[P_ROTATE].value : wrap_degrees(v[P_ROTATE].value - angle_of(m.a, m.b));
            rotate_linear(m, r * mix[P_ROTATE]);
        }
        if (v[P_X].has && mix[P_X] != 0.0) m.tx += t.additive ? v[P_X].value * mix[P_X] : (v[P_X].value - m.tx) * mix[P_X];
        if (v[P_Y].has && mix[P_Y] != 0.0) m.ty += t.additive ? v[P_Y].value * mix[P_Y] : (v[P_Y].value - m.ty) * mix[P_Y];
        for (int axis = 0; axis < 2; axis++) {
            int p = axis == 0 ? P_SCALE_X : P_SCALE_Y;
            if (!v[p].has || mix[p] == 0.0) continue;
            double value = v[p].value, mix_value = mix[p];
            double ax = axis ? m.c : m.a, ay = axis ? m.d : m.b;
            double s = std::hypot(ax, ay);
            if (s < EPSILON) continue;
            double f = t.additive ? (value - 1.0) * mix_value + 1.0 : (s + (value - s) * mix_value) / s;
            if (axis) {
                m.c *= f;
                m.d *= f;
            } else {
                m.a *= f;
                m.b *= f;
            }
        }
        if (v[P_SHEAR_Y].has && mix[P_SHEAR_Y] != 0.0) {
            double shear = v[P_SHEAR_Y].value;
            double x_angle = angle_of(m.a, m.b);
            double gap = wrap_degrees(angle_of(m.c, m.d) - x_angle);
            double want = t.additive ? gap + shear * mix[P_SHEAR_Y] : gap + wrap_degrees(90.0 + shear - gap) * mix[P_SHEAR_Y];
            double len = std::hypot(m.c, m.d);
            m.c = std::cos((x_angle + want) * DEG) * len;
            m.d = std::sin((x_angle + want) * DEG) * len;
        }
        out.world.push_back(std::make_pair(b, m));
    }
    out.type = Solved::SolvedWorld;
    return out;
}

// ---- path constraints -------------------------------------------------------------------------------

Pose::Solved Pose::solve_path(const SkeletonData& sk, const ConstraintData& c, const PathData& p, size_t index) {
    Solved out;
    const ConstraintState& cs = constraint_state[index];
    if (cs.kind != ConstraintPath) return out;
    PathState state = cs.path;
    if (state.mix_rotate == 0.0 && state.mix_x == 0.0 && state.mix_y == 0.0) return out;
    const Attachment* att = slot_attachment(sk, p.slot);
    if (!att || att->kind != AttPath) return out;
    std::vector<double> verts;
    world_vertices(sk, p.slot, *att, verts);
    PathCurve path;
    if (!path.build(verts, att->closed, att->constant_speed, att->lengths)) return out;

    size_t n = c.bones.size();
    bool tangents = p.rotate_mode == RotateTangent;
    bool chain_scale = p.rotate_mode == RotateChainScale;
    size_t count = tangents ? n : n + 1;
    std::vector<double> lens(n);
    for (size_t i = 0; i < n; i++) {
        size_t b = c.bones[i];
        lens[i] = sk.bones[b].length * std::hypot(world[b].a, world[b].b);
    }
    std::vector<double> spaces(count, 0.0);
    bool percent_spacing = p.spacing_mode == SpacingPercent;
    for (size_t i = 0; i + 1 < count; i++) {
        double len = i < lens.size() ? lens[i] : NAN;
        double s = 0.0;
        switch (p.spacing_mode) {
            case SpacingPercent:
            case SpacingFixed: s = state.spacing; break;
            case SpacingProportional: s = len; break;
            case SpacingLength: s = len < EPSILON ? 0.0 : len + state.spacing; break;
        }
        spaces[i + 1] = s;
    }
    if (p.spacing_mode == SpacingProportional) {
        double sum = 0.0;
        for (size_t i = 0; i < spaces.size(); i++) sum += spaces[i];
        if (sum > EPSILON)
            for (size_t i = 1; i < spaces.size(); i++) spaces[i] *= (path.length * (1.0 - std::fmin(state.spacing, 1.0))) / sum;
    }
    double position = state.position;
    if (p.position_mode == PositionPercent) position *= path.length;
    std::vector<double> points(count * 3);
    double at = position;
    for (size_t i = 0; i < spaces.size(); i++) {
        at += percent_spacing ? spaces[i] * path.length : spaces[i];
        path.at(at, &points[3 * i]);
    }
    for (size_t i = 0; i < n; i++) {
        size_t b = c.bones[i];
        Affine m = world[b];
        double x = points[3 * i], y = points[3 * i + 1], angle = points[3 * i + 2];
        m.tx += (x - m.tx) * state.mix_x;
        m.ty += (y - m.ty) * state.mix_y;
        if (state.mix_rotate > 0.0) {
            double r;
            if (tangents) {
                r = angle;
            } else {
                double nx = points[3 * (i + 1)], ny = points[3 * (i + 1) + 1];
                double dx = nx - m.tx, dy = ny - m.ty;
                if (chain_scale && lens[i] >= EPSILON) {
                    double s = (std::hypot(dx, dy) / lens[i] - 1.0) * state.mix_rotate + 1.0;
                    m.a *= s;
                    m.b *= s;
                }
                r = std::hypot(dx, dy) > EPSILON ? angle_of(dx, dy) : angle;
            }
            double reflect = m.determinant() < 0.0 ? -1.0 : 1.0;
            r = wrap_degrees(r - angle_of(m.a, m.b) + p.offset_rotation * reflect);
            rotate_linear(m, r * state.mix_rotate);
        }
        out.world.push_back(std::make_pair(b, m));
    }
    out.type = Solved::SolvedWorld;
    return out;
}

// ---- physics --------------------------------------------------------------------------------------

Pose::Solved Pose::solve_physics(const SkeletonData& sk, const PhysicsData& p, size_t index, double delta) {
    /// Wind and gravity are scaled by this to accelerations in skeleton units per second².
    const double FORCE_SCALE = 100.0;
    /// Tip distance used for rotation, scale and shear of bones without a length.
    const double MIN_TIP = 10.0;
    Solved out;
    const ConstraintState& cs = constraint_state[index];
    if (cs.kind != ConstraintPhysics) return out;
    double inertia = cs.v[0], strength = cs.v[1], damping = cs.v[2], mass = cs.v[3], wind = cs.v[4], gravity = cs.v[5], mix = cs.v[6];
    Affine m = world[p.bone];
    double h = std::hypot(m.a, m.b);
    double axis = h == 0.0 || std::isnan(h) ? 1.0 : h;
    // A placed skeleton simulates in its own units: positions are divided by the placement's scale
    // going in and the result multiplied by it coming out.
    double ps = 1.0;
    if (placement.has) {
        double s = std::sqrt(std::fabs(placement.value.determinant()));
        ps = s == 0.0 || std::isnan(s) ? 1.0 : s;
    }
    double len = std::fmax(MIN_TIP, sk.bones[p.bone].length * axis / ps);
    double origin[2] = {m.tx / ps, m.ty / ps};
    double tip[2] = {origin[0] + (m.a / axis) * len, origin[1] + (m.b / axis) * len};
    if (!physics[index].has) {
        PhysicsSim sim;
        sim.last_origin[0] = origin[0];
        sim.last_origin[1] = origin[1];
        sim.last_tip[0] = tip[0];
        sim.last_tip[1] = tip[1];
        physics[index] = Opt<PhysicsSim>(sim);
    }
    PhysicsSim& sim = physics[index].value;
    if (delta > 0.0) {
        double step = 1.0 / std::fmax(p.fps, 1.0);
        sim.rest += delta;
        double steps = std::floor(sim.rest / step);
        sim.rest -= steps * step;
        steps = std::fmin(steps, std::fmax(p.fps, 1.0));  // at most one second of catching up
        if (steps > 0.0) {
            // Inertia: part of the animated movement since the last update is left behind.
            for (int k = 0; k < 2; k++) {
                sim.o[k] -= (origin[k] - sim.last_origin[k]) * inertia;
                sim.t[k] -= (tip[k] - sim.last_tip[k]) * inertia;
            }
            double mass_inv = mass > 0.0 ? 1.0 / mass : 1.0;
            double keep = std::pow(clampd(damping, 0.0, 1.0), 60.0 * step);
            double force[2] = {wind * FORCE_SCALE, -gravity * FORCE_SCALE};
            int64_t n = (int64_t)steps;
            for (int64_t i = 0; i < n; i++) {
                double* pos_list[2] = {sim.o, sim.t};
                double* vel_list[2] = {sim.ov, sim.tv};
                for (int q = 0; q < 2; q++) {
                    double* pos = pos_list[q];
                    double* vel = vel_list[q];
                    for (int k = 0; k < 2; k++) vel[k] = (vel[k] + (force[k] - strength * pos[k]) * mass_inv * step) * keep;
                    double speed = std::hypot(vel[0], vel[1]);
                    if (speed > p.limit) {
                        vel[0] *= p.limit / speed;
                        vel[1] *= p.limit / speed;
                    }
                    pos[0] += vel[0] * step;
                    pos[1] += vel[1] * step;
                }
            }
            sim.last_origin[0] = origin[0];
            sim.last_origin[1] = origin[1];
            sim.last_tip[0] = tip[0];
            sim.last_tip[1] = tip[1];
        }
    }
    if (mix == 0.0) return out;
    Affine r = m;
    r.tx += sim.o[0] * p.x * mix * ps;
    r.ty += sim.o[1] * p.y * mix * ps;
    if (p.rotate != 0.0 || p.scale_x != 0.0 || p.shear_x != 0.0) {
        double from[2] = {tip[0] - origin[0], tip[1] - origin[1]};
        double to[2] = {from[0] + sim.t[0], from[1] + sim.t[1]};
        double angle = wrap_degrees(angle_of(to[0], to[1]) - angle_of(from[0], from[1]));
        rotate_linear(r, angle * p.rotate * mix);
        if (p.shear_x != 0.0) {
            // Tilt only the X axis.
            double rr = angle * p.shear_x * mix * DEG;
            double a = r.a, b = r.b;
            r.a = a * std::cos(rr) - b * std::sin(rr);
            r.b = a * std::sin(rr) + b * std::cos(rr);
        }
        if (p.scale_x != 0.0) {
            double f = (std::hypot(to[0], to[1]) / len - 1.0) * p.scale_x * mix + 1.0;
            r.a *= f;
            r.b *= f;
        }
    }
    out.type = Solved::SolvedWorld;
    out.world.push_back(std::make_pair(p.bone, r));
    return out;
}

// ---- slider ---------------------------------------------------------------------------------------

Pose::Solved Pose::solve_slider(const SkeletonData& sk, const SliderData& s, size_t index) {
    Solved out;
    const ConstraintState& cs = constraint_state[index];
    if (cs.kind != ConstraintSlider) return out;
    double state_time = cs.v[0], state_mix = cs.v[1];
    if (s.animation >= sk.animations.size()) return out;
    const Animation& anim = sk.animations[s.animation];
    if (state_mix <= 0.0) return out;
    double time = state_time;
    if (s.bone >= 0) {
        size_t b = (size_t)s.bone;
        double value = s.local ? local_property(applied[b], s.property) : world_property(world[b], s.property);
        time = value * s.scale + s.offset;
    }
    double d = anim.duration;
    if (d > 0.0) time = s.looping ? std::fmod(std::fmod(time, d) + d, d) : clampd(time, 0.0, d);
    // Apply onto the constrained (applied) transforms, then recompute world transforms.
    into_applied_ = true;
    apply_animation(sk, anim, time, std::fmin(state_mix, 1.0));
    into_applied_ = false;
    out.type = Solved::SolvedAll;
    return out;
}

// ---- attachments ------------------------------------------------------------------------------------

const Attachment* Pose::slot_attachment(const SkeletonData& sk, size_t slot) const {
    return sk.attachment(slot, attachment[slot], skin);
}

NameId Pose::image_of(size_t slot, const Attachment& att) const {
    if (!att.has_sequence) return att.image;
    const Sequence& seq = att.sequence;
    int64_t index = slot < sequence.size() ? sequence[slot] : -1;
    int64_t i = index >= 0 ? index : seq.setup;
    int64_t hi = (int64_t)seq.frames.size() - 1;
    i = i < 0 ? 0 : (i > hi ? hi : i);
    return seq.frames[(size_t)i];
}

Affine Pose::attachment_world(const SkeletonData& sk, size_t slot, const Transform& offset) const {
    return world[sk.slots[slot].bone].mul(offset.to_affine());
}

void Pose::world_vertices(const SkeletonData& sk, size_t slot, const Attachment& att, std::vector<double>& out) const {
    out.clear();
    const Attachment* source = sk.mesh_source(slot, &att, skin);
    if (!source) return;
    NameId deform_name = att.kind == AttLinkedMesh && att.deform ? att.parent : att.name;
    std::map<std::pair<size_t, NameId>, std::vector<double> >::const_iterator it = deform.find(std::make_pair(slot, deform_name));
    const std::vector<double>* d = it == deform.end() ? 0 : &it->second;
    const Vertices* vertices = vertices_of(*source);
    if (!vertices) return;
    if (vertices->weighted) {
        size_t k = 0;
        out.reserve(vertices->weights.size() * 2);
        for (size_t vi = 0; vi < vertices->weights.size(); vi++) {
            const std::vector<Weight>& v = vertices->weights[vi];
            double x = 0.0, y = 0.0;
            for (size_t wi = 0; wi < v.size(); wi++) {
                const Weight& w = v[wi];
                double bx = w.x + (d && k < d->size() ? (*d)[k] : 0.0);
                double by = w.y + (d && k + 1 < d->size() ? (*d)[k + 1] : 0.0);
                k += 2;
                const Affine& m = world[w.bone];
                x += (m.a * bx + m.c * by + m.tx) * w.weight;
                y += (m.b * bx + m.d * by + m.ty) * w.weight;
            }
            out.push_back(x);
            out.push_back(y);
        }
    } else {
        const std::vector<double>& verts = vertices->plain;
        const Affine& m = world[sk.slots[slot].bone];
        out.reserve(verts.size());
        for (size_t i = 0; i + 1 < verts.size(); i += 2) {
            double vx = verts[i] + (d && i < d->size() ? (*d)[i] : 0.0);
            double vy = verts[i + 1] + (d && i + 1 < d->size() ? (*d)[i + 1] : 0.0);
            out.push_back(m.a * vx + m.c * vy + m.tx);
            out.push_back(m.b * vx + m.d * vy + m.ty);
        }
    }
}

std::vector<Quad> Pose::quads(const SkeletonData& sk) const {
    std::vector<Quad> out;
    for (size_t oi = 0; oi < draw_order.size(); oi++) {
        size_t i = draw_order[oi];
        const Attachment* att = slot_attachment(sk, i);
        if (!att) continue;
        Quad q;
        q.slot = i;
        for (int k = 0; k < 4; k++) q.color[k] = color[i].v[k] * att->color[k];
        if (att->kind == AttRegion) {
            Affine m = attachment_world(sk, i, att->offset);
            double hw = att->width * 0.5, hh = att->height * 0.5;
            double corners[8] = {-hw, hh, hw, hh, hw, -hh, -hw, -hh};
            q.positions.resize(8);
            for (int k = 0; k < 4; k++) m.apply(corners[2 * k], corners[2 * k + 1], q.positions[(size_t)(2 * k)], q.positions[(size_t)(2 * k + 1)]);
            q.image = image_of(i, *att);
            out.push_back(q);
        } else if (att->kind == AttMesh || att->kind == AttLinkedMesh) {
            const Attachment* source = sk.mesh_source(i, att, skin);
            if (!source) continue;
            q.image = image_of(i, att->kind == AttLinkedMesh ? *att : *source);
            world_vertices(sk, i, *att, q.positions);
            out.push_back(q);
        }
    }
    return out;
}

}  // namespace rigby
