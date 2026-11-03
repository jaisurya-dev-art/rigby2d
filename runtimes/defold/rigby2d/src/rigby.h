// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D runtime in C++: loads skeleton JSON (3.8, 4.x) and binary .skel (4.3) exports with their
// .atlas, and evaluates poses, IK, transform, path, physics and slider constraints, image sequences,
// clipping and animation playback with tracks, crossfades, queues and events.
//
// A port of the Rust runtime (runtimes/rust/rigby-runtime), which is a port of the JavaScript one
// (src/core): it must match them frame by frame (see runtimes/defold/test/golden.cpp). C++11 with
// no exceptions, no RTTI and no dependencies, so it builds wherever Defold does.
//
//   rigby::SkeletonData data; std::string err;
//   rigby::load_skeleton(bytes, size, data, err);
//   rigby::Pose pose(data);
//   rigby::AnimationState state;
//   state.set_animation(data, 0, "walk", true, 0.2);
//   state.update(data, 1.0 / 60.0);
//   state.apply(data, pose);

#ifndef RIGBY_RUNTIME_H
#define RIGBY_RUNTIME_H

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace rigby {

// ---- small helpers ------------------------------------------------------------------------------

/// An optional value (C++11 has no std::optional).
template <class T>
struct Opt {
    bool has;
    T value;
    Opt() : has(false), value() {}
    Opt(const T& v) : has(true), value(v) {}
    T value_or(const T& def) const { return has ? value : def; }
};

/// Interned attachment / image name; -1 is none.
typedef int NameId;
static const NameId NO_NAME = -1;
/// Bone, slot or other index; -1 is none.
static const int NONE = -1;

// ---- JSON ---------------------------------------------------------------------------------------

/// A JSON value. Objects keep their key order, which the skeleton format relies on.
class Json {
public:
    enum Type { JNull, JBool, JNum, JStr, JArr, JObj };
    Type type;
    bool b;
    double n;
    std::string s;
    std::vector<Json> arr;
    std::vector<std::pair<std::string, Json> > obj;

    Json() : type(JNull), b(false), n(0) {}
    static Json boolean(bool v) { Json j; j.type = JBool; j.b = v; return j; }
    static Json number(double v) { Json j; j.type = JNum; j.n = v; return j; }
    static Json string(const std::string& v) { Json j; j.type = JStr; j.s = v; return j; }
    static Json array() { Json j; j.type = JArr; return j; }
    static Json object() { Json j; j.type = JObj; return j; }

    /// The value of `key` in an object (JNull when missing or not an object).
    const Json& get(const char* key) const;
    const Json& get(const std::string& key) const { return get(key.c_str()); }
    bool has(const char* key) const { return !get(key).is_null(); }
    bool is_null() const { return type == JNull; }
    bool is_array() const { return type == JArr; }
    bool is_object() const { return type == JObj; }
    bool is_num() const { return type == JNum; }
    bool is_str() const { return type == JStr; }
    /// Number at `key`, or `def`.
    double num(const char* key, double def) const;
    /// JavaScript-style truthiness of `key` (`!!value`).
    bool truthy(const char* key) const;
    /// Boolean at `key`, or `def` when missing (`value ?? def`).
    bool flag(const char* key, bool def) const;
    /// String at `key`, or `def`.
    const std::string& str_or(const char* key, const std::string& def) const;
    const char* cstr_or(const char* key, const char* def) const;
    /// Sets `key` in an object, keeping its position when it exists; no effect otherwise.
    void set(const std::string& key, const Json& value);
    /// Removes `key`; returns whether it was there (and its value in `out`).
    bool remove(const std::string& key, Json* out = 0);

    /// Parses JSON text; false with a message in `err` on failure.
    static bool parse(const char* text, size_t len, Json& out, std::string& err);
};

// ---- math -----------------------------------------------------------------------------------------

extern const double DEG;
double lerp(double a, double b, double t);
/// Wraps an angle in degrees to (-180, 180].
double wrap_degrees(double d);
/// atan2(y, x) in degrees.
double angle_of(double x, double y);

struct Affine;

/// A local transform. Shear is in degrees and tilts the X and Y axes independently.
struct Transform {
    double x, y, rotation, scale_x, scale_y, shear_x, shear_y;
    Transform() : x(0), y(0), rotation(0), scale_x(1), scale_y(1), shear_x(0), shear_y(0) {}
    Transform(double x_, double y_, double r, double sx, double sy, double hx, double hy)
        : x(x_), y(y_), rotation(r), scale_x(sx), scale_y(sy), shear_x(hx), shear_y(hy) {}
    Affine to_affine() const;
};

/// 2D affine matrix mapping (x, y) to (a*x + c*y + tx, b*x + d*y + ty).
struct Affine {
    double a, b, c, d, tx, ty;
    Affine() : a(1), b(0), c(0), d(1), tx(0), ty(0) {}
    Affine(double a_, double b_, double c_, double d_, double tx_, double ty_) : a(a_), b(b_), c(c_), d(d_), tx(tx_), ty(ty_) {}
    static Affine identity() { return Affine(); }
    /// this * r: applies r first, then this.
    Affine mul(const Affine& r) const;
    double determinant() const { return a * d - b * c; }
    Affine inverse() const;
    void apply(double x, double y, double& ox, double& oy) const {
        ox = a * x + c * y + tx;
        oy = b * x + d * y + ty;
    }
    /// World rotation of the X axis, in degrees.
    double rotation() const { return angle_of(a, b); }
    /// Translation, rotation, scale and Y shear (shear_x is 0); reflection is a negative Y scale.
    Transform decompose() const;
};

// ---- curves ---------------------------------------------------------------------------------------

/// Interpolation between keys. Bezier control points are normalized (endpoints (0,0) and (1,1)).
struct Curve {
    enum Type { Linear, Stepped, Bezier, Beziers };
    Type type;
    double bezier[4];
    std::vector<std::vector<double> > beziers;  // 4 each
    Curve() : type(Linear) { bezier[0] = bezier[1] = bezier[2] = bezier[3] = 0; }
    /// Maps linear progress t to eased progress for value `component` of a key.
    double ease(double t, size_t component) const;
};

/// A curve as stored in a file key (constraint keys).
struct RawCurve {
    enum Type { Linear, Stepped, Absolute, Normalized };
    Type type;
    std::vector<double> points;  // Absolute: 4 per value; Normalized: 4
    RawCurve() : type(Linear) {}
};

struct RawKey {
    double time;
    std::vector<double> values;
    RawCurve curve;
    RawKey() : time(0) {}
};

/// Samples raw keys at `time` (keys must not be empty).
void sample_raw(const std::vector<RawKey>& keys, double time, std::vector<double>& out);
double cubic4(double p0, double p1, double p2, double p3, double s);

// ---- skeleton data --------------------------------------------------------------------------------

enum Inherit { InheritNormal, InheritOnlyTranslation, InheritNoRotationOrReflection, InheritNoScale, InheritNoScaleOrReflection };
enum Blend { BlendNormal, BlendAdditive, BlendMultiply, BlendScreen };

struct BoneData {
    std::string name;
    int parent;
    double length;
    Transform setup;
    Inherit inherit;
    bool skin_required;
};

struct Weight {
    size_t bone;
    double x, y, weight;
};

/// Vertices of a mesh-like attachment: plain (x, y per vertex) or weighted to several bones.
struct Vertices {
    bool weighted;
    std::vector<double> plain;
    std::vector<std::vector<Weight> > weights;
    Vertices() : weighted(false) {}
    /// Floats a deform key covers.
    size_t deform_len() const;
};

struct Sequence {
    int64_t count, start;
    size_t digits;
    int64_t setup;
    std::vector<NameId> frames;
};

enum AttachmentKind { AttRegion, AttMesh, AttLinkedMesh, AttBoundingBox, AttPath, AttClipping, AttPoint };

struct Attachment {
    NameId name;
    /// Image (atlas region) shown: the attachment's path, else its name.
    NameId image;
    double color[4];
    AttachmentKind kind;
    // Region and point.
    Transform offset;
    // Region, mesh and linked mesh.
    double width, height;
    // Mesh.
    std::vector<double> uvs;
    std::vector<uint32_t> triangles;
    size_t hull;
    // Mesh, bounding box, path and clipping.
    Vertices vertices;
    // Linked mesh.
    NameId parent;
    Opt<std::string> skin;
    bool deform;
    // Path.
    bool closed, constant_speed;
    std::vector<double> lengths;
    // Clipping: end slot, or NONE.
    int end;
    bool has_sequence;
    Sequence sequence;
    Attachment() : name(NO_NAME), image(NO_NAME), kind(AttRegion), width(0), height(0), hull(0), parent(NO_NAME), deform(true), closed(false), constant_speed(true), end(NONE), has_sequence(false) {
        color[0] = color[1] = color[2] = color[3] = 1;
    }
    bool is_mesh_like() const { return kind == AttMesh || kind == AttBoundingBox || kind == AttPath || kind == AttClipping; }
};

struct SlotData {
    std::string name;
    size_t bone;
    NameId attachment;
    double color[4];
    bool has_dark;
    double dark[3];
    Blend blend;
    /// The default skin's attachments for this slot.
    std::vector<Attachment> attachments;
};

struct SkinData {
    std::string name;
    std::vector<std::pair<size_t, std::vector<Attachment> > > slots;
    std::vector<size_t> bones;
    std::vector<size_t> ik;
    /// Names of the transform, path, physics and other constraints listed by the skin.
    std::vector<std::string> constraints;
};

struct IkData {
    std::string name;
    double order;
    bool skin_required;
    std::vector<size_t> bones;
    size_t target;
    double mix, softness;
    bool bend_positive, compress, stretch, uniform;
};

/// Transform constraint properties, in this order everywhere.
enum { PROPS = 6, P_ROTATE = 0, P_X = 1, P_Y = 2, P_SCALE_X = 3, P_SCALE_Y = 4, P_SHEAR_Y = 5 };

struct PropTarget {
    size_t prop;
    double offset, max, scale;
};

struct PropMap {
    size_t from;
    double offset;
    std::vector<PropTarget> to;
};

struct TransformData {
    size_t source;
    double offsets[PROPS];
    double mix[PROPS];
    std::vector<PropMap> props;
    bool local_source, local_target, additive, clamp;
};

enum PositionMode { PositionFixed, PositionPercent };
enum SpacingMode { SpacingLength, SpacingFixed, SpacingPercent, SpacingProportional };
enum RotateMode { RotateTangent, RotateChain, RotateChainScale };

struct PathState {
    double position, spacing, mix_rotate, mix_x, mix_y;
    PathState() : position(0), spacing(0), mix_rotate(0), mix_x(0), mix_y(0) {}
};

struct PathData {
    size_t slot;
    PositionMode position_mode;
    SpacingMode spacing_mode;
    RotateMode rotate_mode;
    double offset_rotation;
    PathState setup;
};

struct PhysicsData {
    size_t bone;
    /// Weights of x, y, rotate, scaleX, shearX.
    double x, y, rotate, scale_x, shear_x;
    double limit, fps;
    bool globals[7];
    /// inertia, strength, damping, mass, wind, gravity, mix.
    double setup[7];
};

enum Property { PropRotate, PropX, PropY, PropScaleX, PropScaleY, PropShearY };

struct SliderData {
    size_t animation;
    int bone;  // NONE: none
    Property property;
    double scale, offset;
    bool local, looping, additive;
    /// time, mix.
    double setup[2];
};

enum ConstraintKind { ConstraintTransform, ConstraintPath, ConstraintPhysics, ConstraintSlider };

/// A transform, path, physics or slider constraint (IK constraints are in SkeletonData::ik).
struct ConstraintData {
    std::string name;
    double order;
    bool skin_required;
    std::vector<size_t> bones;
    ConstraintKind kind;
    TransformData transform;
    PathData path;
    PhysicsData physics;
    SliderData slider;
};

struct EventData {
    std::string name;
    int64_t int_value;
    double float_value;
    Opt<std::string> string;
    Opt<std::string> audio;
    double volume, balance;
};

// ---- animations -----------------------------------------------------------------------------------

struct Key {
    double time;
    std::vector<double> values;
    Curve curve;
};

/// Bone channels in application order.
enum { CH_ROTATE, CH_TRANSLATE, CH_TRANSLATE_X, CH_TRANSLATE_Y, CH_SCALE, CH_SCALE_X, CH_SCALE_Y, CH_SHEAR, CH_SHEAR_X, CH_SHEAR_Y, CHANNELS };

struct BoneTimeline {
    size_t bone;
    std::vector<Key> channels[CHANNELS];
    std::vector<std::pair<double, Inherit> > inherit;
};

struct SlotTimeline {
    size_t slot;
    std::vector<std::pair<double, NameId> > attachment;
    std::vector<Key> color, rgb, alpha, rgba2, rgb2;
};

struct DeformKey {
    double time;
    size_t offset;
    std::vector<double> vertices;
    Curve curve;
};

struct DeformTimeline {
    /// Skin name, or none for the default skin (then the active skin is searched first).
    Opt<std::string> skin;
    size_t slot;
    NameId attachment;
    std::vector<DeformKey> keys;
};

enum SequenceMode { SeqHold, SeqOnce, SeqLoop, SeqPingPong, SeqOnceReverse, SeqLoopReverse, SeqPingPongReverse };

struct SequenceKey {
    double time;
    SequenceMode mode;
    int64_t index;
    Opt<double> delay;
};

struct SequenceTimeline {
    Opt<std::string> skin;
    size_t slot;
    NameId attachment;
    std::vector<SequenceKey> keys;
};

struct EventKey {
    double time;
    std::string name;
    Opt<int64_t> int_value;
    Opt<double> float_value;
    Opt<std::string> string;
    Opt<double> volume, balance;
};

struct IkKey {
    double time, mix, softness;
    bool bend_positive, compress, stretch;
};

struct IkTimeline {
    size_t constraint;
    std::vector<IkKey> keys;
};

/// Keys of one transform, path, physics or slider constraint, by constraint index.
struct ConstraintTimeline {
    size_t constraint;
    std::vector<RawKey> transform, position, spacing, path_mix, slider_time, slider_mix;
    std::vector<RawKey> physics[7], physics_global[7];
    ConstraintTimeline() : constraint(0) {}
};

struct DrawOrderKey {
    double time;
    bool has_offsets;
    std::vector<std::pair<size_t, int64_t> > offsets;
};

struct Animation {
    std::string name;
    double duration;
    std::vector<BoneTimeline> bones;
    std::vector<SlotTimeline> slots;
    std::vector<DeformTimeline> deform;
    std::vector<SequenceTimeline> sequences;
    std::vector<DrawOrderKey> draw_order;
    std::vector<EventKey> events;
    std::vector<IkTimeline> ik;
    std::vector<ConstraintTimeline> constraints;
    /// True when the file has transform, path, physics or slider keys (gates their sampling).
    bool has_constraint_keys;
    Animation() : duration(0), has_constraint_keys(false) {}
};

struct SkeletonData {
    Opt<std::string> version;
    std::vector<BoneData> bones;
    std::vector<SlotData> slots;
    std::vector<SkinData> skins;
    std::vector<IkData> ik;
    std::vector<ConstraintData> constraints;
    std::vector<EventData> events;
    std::vector<Animation> animations;
    /// Interned names (attachments and images).
    std::vector<std::string> names;
    std::unordered_map<std::string, NameId> name_ids;
    /// Format warnings found while reading.
    std::vector<std::string> warnings;

    NameId intern(const std::string& name);
    const std::string& name(NameId id) const { return names[(size_t)id]; }
    NameId name_id(const std::string& name) const;
    int find_bone(const std::string& name) const;
    int find_slot(const std::string& name) const;
    int find_skin(const std::string& name) const;
    int find_animation(const std::string& name) const;
    /// Attachments a skin defines for a slot (skin NONE = the default skin); null when none.
    const std::vector<Attachment>* skin_attachments(size_t slot, int skin) const;
    /// Resolves an attachment by slot and name: `skin` first, then the default skin.
    const Attachment* attachment(size_t slot, NameId name, int skin) const;
    /// The mesh holding the geometry of `att`: itself, or the parent of a linked mesh.
    const Attachment* mesh_source(size_t slot, const Attachment* att, int active_skin) const;
};

/// Loads skeleton data from file bytes: binary .skel or skeleton JSON. False with `err` on failure.
bool load_skeleton(const uint8_t* bytes, size_t size, SkeletonData& out, std::string& err);
/// True when `obj` looks like a skeleton JSON file.
bool is_skeleton_json(const Json& obj);
/// Converts a parsed skeleton JSON file into SkeletonData.
bool read_skeleton_json(const Json& obj, SkeletonData& out, std::string& err);
/// True when `bytes` look like a binary skeleton (8-byte hash, then a version string).
bool is_skeleton_binary(const uint8_t* bytes, size_t size);
/// Converts a binary skeleton into the skeleton JSON structure (4.3 field names).
bool read_skeleton_binary(const uint8_t* bytes, size_t size, Json& out, std::string& err);

// ---- atlas ----------------------------------------------------------------------------------------

struct AtlasRegion {
    std::string name;
    int64_t index;
    double x, y, width, height, rotate, offset_x, offset_y, original_width, original_height;
};

struct AtlasPage {
    std::string name;
    double width, height;
    std::string filter[2];
    std::string repeat;
    bool pma;
    std::vector<AtlasRegion> regions;
};

/// Maps an attachment's 0..1 image coordinates (y down) to page UVs.
struct RegionUv {
    size_t page;
    /// Part of the original image the packed pixels cover: u0, v0, u1, v1.
    double trim[4];
    double ow, oh, dx, dy, w, h, src_x, src_y, cx, cy, cos, sin, page_w, page_h;
    RegionUv() : page(0) {}
    RegionUv(size_t page, const AtlasRegion& r, double page_w, double page_h);
    /// Page UV for image coordinates (u, v), clamped inside the region.
    void map(double u, double v, double& ou, double& ov) const;
};

struct Atlas {
    std::vector<AtlasPage> pages;
    /// Parses atlas text.
    static Atlas parse(const char* text, size_t len);
    /// Region lookup by image name (name + index for indexed regions).
    std::unordered_map<std::string, RegionUv> lookup() const;
};

// ---- pose -----------------------------------------------------------------------------------------

struct Rgba {
    double v[4];
};

struct DarkRgb {
    bool has;
    double v[3];
};

struct IkState {
    double mix, softness;
    bool bend_positive, compress, stretch;
};

/// Animatable state of a transform (6 mixes), path, physics (7 values) or slider (time, mix) constraint.
struct ConstraintState {
    ConstraintKind kind;
    double v[7];
    PathState path;
    static ConstraintState setup(const ConstraintData& c);
};

/// Persistent physics simulation of one constraint.
struct PhysicsSim {
    double rest;
    double o[2], ov[2], t[2], tv[2], last_origin[2], last_tip[2];
    PhysicsSim() : rest(0) {
        for (int k = 0; k < 2; k++) o[k] = ov[k] = t[k] = tv[k] = last_origin[k] = last_tip[k] = 0;
    }
};

/// A visible region or mesh in draw order (see Pose::quads).
struct Quad {
    size_t slot;
    NameId image;
    /// World positions, flat: regions TL, TR, BR, BL; meshes one pair per vertex.
    std::vector<double> positions;
    double color[4];
};

class Pose {
public:
    /// Animated local transforms.
    std::vector<Transform> local;
    /// Local transforms after constraints; world transforms are computed from these.
    std::vector<Transform> applied;
    std::vector<Affine> world;
    std::vector<Inherit> inherit;
    std::vector<NameId> attachment;
    std::vector<Rgba> color;
    std::vector<DarkRgb> dark;
    std::vector<size_t> draw_order;
    std::vector<int64_t> sequence;
    /// Deform deltas by (slot, attachment name).
    std::map<std::pair<size_t, NameId>, std::vector<double> > deform;
    std::vector<IkState> ik;
    std::vector<ConstraintState> constraint_state;
    /// Physics simulation state by constraint; it survives reset (see reset_physics).
    std::vector<Opt<PhysicsSim> > physics;
    /// Seconds of physics to simulate in the next update_world (0 = only apply offsets).
    double physics_delta;
    /// Active skin (NONE = default skin only).
    int skin;
    /// Transform above the root bones (where a scene places this skeleton).
    Opt<Affine> placement;

    explicit Pose(const SkeletonData& sk);
    /// Resets everything to the setup pose and recomputes world transforms.
    void set_to_setup(const SkeletonData& sk);
    /// Resets local state to the setup pose without computing world transforms.
    void reset(const SkeletonData& sk);
    /// Clears physics so every simulated bone starts again from its animated pose.
    void reset_physics();
    /// Applies animation `anim` at `time` on top of the current pose, blended by `alpha`.
    void apply(const SkeletonData& sk, size_t anim, double time, double alpha);
    /// Recomputes world transforms from local transforms, then applies constraints in order.
    void update_world(const SkeletonData& sk);
    /// Sets the world transforms of some bones, moving their descendants along.
    void set_worlds(const SkeletonData& sk, const std::vector<std::pair<size_t, Affine> >& desired);
    /// The attachment a slot shows, resolved through the active skin (null when none).
    const Attachment* slot_attachment(const SkeletonData& sk, size_t slot) const;
    /// Image an attachment shows in a slot: its image, or the current frame of its sequence.
    NameId image_of(size_t slot, const Attachment& att) const;
    /// World transform of a region or point attachment.
    Affine attachment_world(const SkeletonData& sk, size_t slot, const Transform& offset) const;
    /// World positions of a mesh-like attachment's vertices, flat [x, y, ...].
    void world_vertices(const SkeletonData& sk, size_t slot, const Attachment& att, std::vector<double>& out) const;
    /// Visible regions and meshes in draw order, with world positions and tint.
    std::vector<Quad> quads(const SkeletonData& sk) const;

private:
    struct Step {
        bool ik;
        size_t index;
    };
    struct Solved {
        enum Type { SolvedNone, SolvedWorld, SolvedLocal, SolvedAll } type;
        std::vector<std::pair<size_t, Affine> > world;
        std::vector<size_t> local;
        Solved() : type(SolvedNone) {}
    };
    std::vector<Step> steps_;
    std::vector<uint8_t> dirty_;
    bool into_applied_;
    std::vector<double> scratch_;

    void apply_animation(const SkeletonData& sk, const Animation& anim, double time, double alpha);
    void apply_constraint_timelines(const SkeletonData& sk, const Animation& anim, double time, double alpha);
    bool constraint_active(const SkeletonData& sk, const ConstraintData& c) const;
    void compute_world(const SkeletonData& sk);
    void update_bone(const SkeletonData& sk, size_t i);
    void update_branch(const SkeletonData& sk, size_t root);
    double parent_sign(const SkeletonData& sk, size_t b) const;
    void aim(const SkeletonData& sk, size_t b, const double* from, const double* tip, const double* target, double mix);
    void solve_ik(const SkeletonData& sk, const IkData& c, const IkState& state);
    void finish_two_bone(const SkeletonData& sk, size_t ch, const double* target, double mix);
    void source_values(const TransformData& t, double* out) const;
    void target_values(const TransformData& t, Opt<double>* out) const;
    Solved solve_transform(const ConstraintData& c, const TransformData& t, size_t index);
    Solved solve_path(const SkeletonData& sk, const ConstraintData& c, const PathData& p, size_t index);
    Solved solve_physics(const SkeletonData& sk, const PhysicsData& p, size_t index, double delta);
    Solved solve_slider(const SkeletonData& sk, const SliderData& s, size_t index);
};

/// Slot order for a draw order key: `offsets` move slots relative to their setup index.
std::vector<size_t> apply_draw_order(size_t count, const std::vector<std::pair<size_t, int64_t> >* offsets);

// ---- clipping and rendering ------------------------------------------------------------------------

/// Ear-clipping triangulation of a simple polygon; counter-clockwise triangles (6 floats each).
std::vector<std::vector<double> > triangulate(const std::vector<double>& polygon);

/// An active clipping region: triangles of the clip polygon in world space.
class Clipper {
public:
    explicit Clipper(const std::vector<double>& polygon);
    /// Clips a triangle mesh (flat positions and UVs, vertex indices), appending the result.
    void clip(const std::vector<double>& positions, const std::vector<double>& uvs, const uint32_t* triangles, size_t count,
              std::vector<double>& out_p, std::vector<double>& out_uv, std::vector<uint32_t>& out_t) const;

private:
    std::vector<std::vector<double> > triangles_;
};

/// Atlas regions by skeleton image name id.
class RegionLookup {
public:
    RegionLookup() {}
    RegionLookup(const SkeletonData& sk, const Atlas& atlas);
    const RegionUv* get(NameId image) const;
    /// Images the skeleton's region and mesh attachments use that have no atlas region.
    std::vector<std::string> missing(const SkeletonData& sk) const;

private:
    std::vector<Opt<RegionUv> > regions_;
};

/// Triangles that share an atlas page and a blend mode, in draw order.
struct Batch {
    /// Which skeleton's atlas `page` belongs to: the `source` given to append (0 for build).
    size_t source;
    size_t page;
    Blend blend;
    /// World positions (x, y), Y up.
    std::vector<float> positions;
    /// Page UVs, 0..1 with v down.
    std::vector<float> uvs;
    /// Light color (straight alpha): slot tint × attachment color. 4 per vertex.
    std::vector<float> colors;
    /// Dark color for two-color tint (rgb) and whether the slot has one (a = 1). 4 per vertex.
    std::vector<float> darks;
    std::vector<uint32_t> indices;
    Batch() : source(0), page(0), blend(BlendNormal) {}
};

/// Reusable geometry output (its buffers are kept between frames).
class RenderOutput {
public:
    RenderOutput() : used_(0), source_(0) {}
    /// Number of batches filled by the last build; batches()[0 .. count).
    size_t count() const { return used_; }
    const Batch& batch(size_t i) const { return batches_[i]; }
    /// Builds the geometry of `pose`. `tint` multiplies every color.
    void build(const SkeletonData& sk, const Pose& pose, const RegionLookup& lookup, const double* tint);
    /// Empties the output before a series of appends.
    void clear() { used_ = 0; }
    /// Adds the geometry of some slots of `pose` (in draw order) after what is already built.
    void append(const SkeletonData& sk, const Pose& pose, const RegionLookup& lookup, const double* tint, const std::vector<size_t>& slots, size_t source);

private:
    std::vector<Batch> batches_;
    size_t used_;
    size_t source_;
    std::vector<double> scratch_p_, scratch_uv_, clip_p_, clip_uv_;
    std::vector<uint32_t> clip_t_;
    void draw_attachment(const SkeletonData& sk, const Pose& pose, size_t i, const Attachment& att, const RegionLookup& lookup, const double* tint, const Clipper* clipper);
    void emit(size_t page, Blend blend, const std::vector<double>& positions, const std::vector<double>& uvs, const uint32_t* triangles, size_t count, const float* light, const float* dark);
};

// ---- playback -------------------------------------------------------------------------------------

/// A playing animation on a track.
struct TrackEntry {
    size_t track;
    size_t animation;
    bool looping;
    double mix_duration, mix_time;
    /// Queued entries: seconds after the previous entry started, or none to start when it ends.
    Opt<double> delay;
    double time;
    double last_time;
    bool fresh;
    /// Influence of the track (layers).
    double alpha;
    double time_scale;
    /// The entry being faded out.
    std::unique_ptr<TrackEntry> previous;
    std::vector<TrackEntry> queue;
    /// Unique id, to match events to entries.
    uint64_t id;

    TrackEntry() : track(0), animation(0), looping(false), mix_duration(0), mix_time(0), time(0), last_time(-1), fresh(true), alpha(1), time_scale(1), id(0) {}
    TrackEntry(TrackEntry&& o);
    TrackEntry& operator=(TrackEntry&& o);
    /// Mix progress in [0, 1]: how much this entry has replaced the previous one.
    double mix() const;
};

/// An event key merged with its definition.
struct Event {
    std::string name;
    double time;
    int64_t loop_index;
    int64_t int_value;
    double float_value;
    Opt<std::string> string;
    Opt<std::string> audio;
    double volume, balance;
};

enum StateEventKind { EventStart, EventEnd, EventComplete, EventKeyed };

struct StateEvent {
    StateEventKind kind;
    Event event;  // EventKeyed only
    size_t track;
    size_t animation;
    uint64_t entry;
};

class AnimationState {
public:
    /// Entries by track index (null = empty track).
    std::vector<std::unique_ptr<TrackEntry> > tracks;
    /// Playback speed multiplier for every track.
    double speed;
    /// Seconds since the last apply, simulated by physics constraints then.
    double physics_delta;

    AnimationState() : speed(1), physics_delta(0), next_id_(0) {}
    /// Takes the callbacks queued since the last call, in order.
    std::vector<StateEvent> drain_events();
    /// Base track: starts `name`, crossfading over `mix` seconds. False if not found.
    bool play(const SkeletonData& sk, const std::string& name, bool looping, double mix);
    /// Starts `name` on `track` now, crossfading over `mix` seconds and dropping anything queued.
    /// Returns the entry id, or none when no animation has that name.
    Opt<uint64_t> set_animation(const SkeletonData& sk, size_t track, const std::string& name, bool looping, double mix);
    /// Queues `name` after the current entry: when it ends, or `delay` seconds after it starts.
    Opt<uint64_t> add_animation(const SkeletonData& sk, size_t track, const std::string& name, bool looping, double mix, Opt<double> delay);
    /// Stops a track (its animation stops affecting the pose).
    void clear_track(size_t track);
    void stop();
    TrackEntry* current(size_t track);
    const TrackEntry* current(size_t track) const;
    /// Advances time by `dt` seconds, starting queued entries and firing events.
    void update(const SkeletonData& sk, double dt);
    /// Resets `pose` to setup, applies every track in order and updates world transforms.
    void apply(const SkeletonData& sk, Pose& pose);

private:
    std::vector<StateEvent> events_;
    uint64_t next_id_;
    void notify(StateEventKind kind, const TrackEntry& e, const Event* ev = 0);
    TrackEntry make_entry(size_t track, size_t animation, bool looping, double mix, Opt<double> delay);
    void replace(TrackEntry from, TrackEntry to);
    void advance(const SkeletonData& sk, TrackEntry& entry, double dt);
    void fire_events(const SkeletonData& sk, const TrackEntry& entry);
};

// ---- scenes ---------------------------------------------------------------------------------------

extern const double DEFAULT_FOCAL;
extern const double SCENE_FORMAT;

/// A clip of an actor's animation on the scene timeline.
struct Clip {
    std::string animation;
    double start, in_point;
    Opt<double> out_point;
    double speed;
    int64_t loops;
    double blend;
};

/// A character placed on the stage.
struct Actor {
    std::string id, name, bone, slot;
    Opt<std::string> skeleton, skin;
    bool flip;
    double ground;
    /// Clips by shot (stage animation name), sorted by start.
    std::vector<std::pair<std::string, std::vector<Clip> > > clips;
    const std::vector<Clip>& clips_of(const std::string& shot) const;
};

struct Scene {
    std::vector<Actor> actors;
    /// Depth by top-level stage bone name.
    std::vector<std::pair<std::string, double> > depth;
    double focal;
};

struct SceneCharacter {
    std::string id;
    SkeletonData data;
    std::unique_ptr<Pose> pose;
};

/// One entry of the stage's draw order: a stage slot, or the actor drawn at it.
struct SceneLayer {
    size_t slot;
    /// Index into scene.actors when an actor is drawn here, else NONE.
    int actor;
    /// The slot's color, which tints and fades the actor.
    double tint[4];
};

/// Reads the bytes of a file named in a scene manifest; false when it cannot.
typedef bool (*SceneFileReader)(void* ctx, const std::string& file, std::vector<uint8_t>& out, std::string& err);

/// Plays a composed scene: the stage animation (shot), parallax and every actor's clips.
class ScenePlayer {
public:
    SkeletonData stage;
    Scene scene;
    std::unique_ptr<Pose> pose;
    std::vector<SceneCharacter> characters;
    Opt<std::pair<double, double> > setup_camera;
    Opt<std::string> shot;
    double time;
    bool looping;

    ScenePlayer() : time(0), looping(false) {}
    void init();
    const SceneCharacter* character(size_t actor) const;
    /// Starts a shot from its beginning.
    void play(const std::string& shot, bool looping);
    /// The shot's length: its stage animation, or the end of its last finite clip if later.
    double duration() const;
    /// Advances the scene by `dt` seconds (looping or holding at the end) and poses everything.
    void update(double dt);
    /// Poses the stage and every actor at the current time, simulating `dt` seconds of physics.
    void evaluate(double dt);
    /// The stage's draw order with actors in place, back to front.
    std::vector<SceneLayer> draw_list() const;
};

Opt<Clip> read_clip(const Json& c);
Scene read_scene(const Json& o);
/// Loads an exported scene manifest; `read` loads the skeleton files it names.
bool load_scene(const uint8_t* manifest, size_t size, SceneFileReader read, void* ctx, ScenePlayer& out, std::string& err);
std::vector<SceneLayer> scene_draw_list(const SkeletonData& stage, const Scene& scene, const Pose& pose);

}  // namespace rigby

#endif
