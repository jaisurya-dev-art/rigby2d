// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D for Defold: the native `rigby` Lua module. The C++ runtime (rigby_*.cpp) does all the
// per-frame work: playback, pose, constraints and geometry, written straight into the vertex
// buffers of the mesh pieces that draw a skeleton or a scene. rigby2d/rigby2d.lua builds the player on top.

#define EXTENSION_NAME Rigby2D
#define LIB_NAME "Rigby2D"
#define MODULE_NAME "rigby"

#include <dmsdk/sdk.h>
#include <dmsdk/gamesys/script.h>

#include <algorithm>
#include <math.h>
#include <string.h>

#include "rigby.h"

namespace {

const char* DATA_TYPE = "rigby.data";
const char* SKELETON_TYPE = "rigby.skeleton";

// Skeleton data with its atlas, shared by every skeleton made from it.
struct Data {
    rigby::SkeletonData sk;
    rigby::Atlas atlas;
    rigby::RegionLookup lookup;
};

// A run of batches on one atlas page of one skeleton: one mesh piece.
struct Piece {
    size_t source;  // whose atlas: 0 for a skeleton; in a scene 0 is the stage, 1 + i character i
    size_t page;
    size_t first, count;  // batches
    size_t vertices;      // triangles * 3
};

// Geometry of a frame, grouped into pieces; kept between frames so steady playback allocates nothing.
struct Geometry {
    rigby::RenderOutput out;
    std::vector<Piece> pieces;
};

struct Skeleton {
    Data* data;
    int data_ref;  // keeps the data userdata alive
    rigby::Pose* pose;
    rigby::AnimationState* state;
    Geometry* geo;
    double tint[4];
};

// A composed scene: the stage, its characters and the atlas of each (source 0 = the stage).
struct SceneState {
    rigby::ScenePlayer player;
    std::vector<std::string> files;
    std::vector<rigby::Atlas> atlases;
    std::vector<rigby::RegionLookup> lookups;
    Geometry geo;
    std::vector<size_t> run;
    bool finished;
    SceneState() : finished(false) {}
};

const dmhash_t POSITION = dmHashString64("position");
const dmhash_t TEXCOORD0 = dmHashString64("texcoord0");
const dmhash_t COLOR = dmHashString64("color");
const dmhash_t DARK = dmHashString64("dark");

Data* check_data(lua_State* L, int index) {
    Data** p = (Data**)luaL_checkudata(L, index, DATA_TYPE);
    if (!*p) luaL_error(L, "rigby: data was released");
    return *p;
}

Skeleton* check_skeleton(lua_State* L, int index) {
    return (Skeleton*)luaL_checkudata(L, index, SKELETON_TYPE);
}

void push_names(lua_State* L, size_t count, const std::string* (*get)(const rigby::SkeletonData&, size_t), const rigby::SkeletonData& sk) {
    lua_createtable(L, (int)count, 0);
    for (size_t i = 0; i < count; i++) {
        lua_pushstring(L, get(sk, i)->c_str());
        lua_rawseti(L, -2, (int)i + 1);
    }
}

const std::string* bone_name(const rigby::SkeletonData& sk, size_t i) { return &sk.bones[i].name; }
const std::string* slot_name(const rigby::SkeletonData& sk, size_t i) { return &sk.slots[i].name; }
const std::string* skin_name(const rigby::SkeletonData& sk, size_t i) { return &sk.skins[i].name; }
const std::string* animation_name(const rigby::SkeletonData& sk, size_t i) { return &sk.animations[i].name; }
const std::string* event_name(const rigby::SkeletonData& sk, size_t i) { return &sk.events[i].name; }

// ---- data -----------------------------------------------------------------------------------------

// rigby.load(skeleton_bytes, atlas_text) -> data | nil, error
int load(lua_State* L) {
    size_t skel_len = 0, atlas_len = 0;
    const char* skel = luaL_checklstring(L, 1, &skel_len);
    const char* atlas = luaL_checklstring(L, 2, &atlas_len);
    Data* data = new Data();
    std::string err;
    if (!rigby::load_skeleton((const uint8_t*)skel, skel_len, data->sk, err)) {
        delete data;
        lua_pushnil(L);
        lua_pushstring(L, err.c_str());
        return 2;
    }
    data->atlas = rigby::Atlas::parse(atlas, atlas_len);
    data->lookup = rigby::RegionLookup(data->sk, data->atlas);
    for (size_t i = 0; i < data->sk.warnings.size(); i++) dmLogWarning("rigby: %s", data->sk.warnings[i].c_str());
    std::vector<std::string> missing = data->lookup.missing(data->sk);
    for (size_t i = 0; i < missing.size(); i++) dmLogWarning("rigby: no atlas region for image '%s'", missing[i].c_str());
    Data** p = (Data**)lua_newuserdata(L, sizeof(Data*));
    *p = data;
    luaL_getmetatable(L, DATA_TYPE);
    lua_setmetatable(L, -2);
    return 1;
}

int data_gc(lua_State* L) {
    Data** p = (Data**)luaL_checkudata(L, 1, DATA_TYPE);
    delete *p;
    *p = 0;
    return 0;
}

int data_bones(lua_State* L) {
    Data* d = check_data(L, 1);
    push_names(L, d->sk.bones.size(), bone_name, d->sk);
    return 1;
}

int data_slots(lua_State* L) {
    Data* d = check_data(L, 1);
    push_names(L, d->sk.slots.size(), slot_name, d->sk);
    return 1;
}

int data_skins(lua_State* L) {
    Data* d = check_data(L, 1);
    push_names(L, d->sk.skins.size(), skin_name, d->sk);
    return 1;
}

int data_animations(lua_State* L) {
    Data* d = check_data(L, 1);
    push_names(L, d->sk.animations.size(), animation_name, d->sk);
    return 1;
}

int data_events(lua_State* L) {
    Data* d = check_data(L, 1);
    push_names(L, d->sk.events.size(), event_name, d->sk);
    return 1;
}

// data:duration(name) -> seconds | nil
int data_duration(lua_State* L) {
    Data* d = check_data(L, 1);
    int a = d->sk.find_animation(luaL_checkstring(L, 2));
    if (a < 0) return 0;
    lua_pushnumber(L, d->sk.animations[(size_t)a].duration);
    return 1;
}

// data:pages() -> { { name, width, height, pma, filter_min, filter_mag }, ... }
int data_pages(lua_State* L) {
    Data* d = check_data(L, 1);
    const std::vector<rigby::AtlasPage>& pages = d->atlas.pages;
    lua_createtable(L, (int)pages.size(), 0);
    for (size_t i = 0; i < pages.size(); i++) {
        const rigby::AtlasPage& p = pages[i];
        lua_createtable(L, 0, 6);
        lua_pushstring(L, p.name.c_str());
        lua_setfield(L, -2, "name");
        lua_pushnumber(L, p.width);
        lua_setfield(L, -2, "width");
        lua_pushnumber(L, p.height);
        lua_setfield(L, -2, "height");
        lua_pushboolean(L, p.pma);
        lua_setfield(L, -2, "pma");
        lua_pushstring(L, p.filter[0].c_str());
        lua_setfield(L, -2, "filter_min");
        lua_pushstring(L, p.filter[1].c_str());
        lua_setfield(L, -2, "filter_mag");
        lua_rawseti(L, -2, (int)i + 1);
    }
    return 1;
}

// ---- skeleton -------------------------------------------------------------------------------------

// rigby.new(data) -> skeleton
int new_skeleton(lua_State* L) {
    Data* data = check_data(L, 1);
    Skeleton* s = (Skeleton*)lua_newuserdata(L, sizeof(Skeleton));
    memset(s, 0, sizeof(Skeleton));
    luaL_getmetatable(L, SKELETON_TYPE);
    lua_setmetatable(L, -2);
    lua_pushvalue(L, 1);
    s->data_ref = luaL_ref(L, LUA_REGISTRYINDEX);
    s->data = data;
    s->pose = new rigby::Pose(data->sk);
    s->state = new rigby::AnimationState();
    s->geo = new Geometry();
    for (int k = 0; k < 4; k++) s->tint[k] = 1.0;
    s->pose->set_to_setup(data->sk);
    return 1;
}

int skeleton_gc(lua_State* L) {
    Skeleton* s = check_skeleton(L, 1);
    if (!s->pose) return 0;
    delete s->pose;
    delete s->state;
    delete s->geo;
    s->pose = 0;
    luaL_unref(L, LUA_REGISTRYINDEX, s->data_ref);
    return 0;
}

Skeleton* live_skeleton(lua_State* L) {
    Skeleton* s = check_skeleton(L, 1);
    if (!s->pose) luaL_error(L, "rigby: skeleton was released");
    return s;
}

size_t check_track(lua_State* L, int index) {
    lua_Integer t = luaL_checkinteger(L, index);
    if (t < 0 || t > 1000) luaL_error(L, "rigby: bad track %d", (int)t);
    return (size_t)t;
}

int push_entry(lua_State* L, const rigby::Opt<uint64_t>& id) {
    if (!id.has) return 0;
    lua_pushnumber(L, (lua_Number)id.value);
    return 1;
}

// skeleton:set_animation(track, name, loop, mix) -> entry id | nil
int skeleton_set_animation(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    size_t track = check_track(L, 2);
    const char* name = luaL_checkstring(L, 3);
    bool looping = lua_toboolean(L, 4) != 0;
    double mix = luaL_optnumber(L, 5, 0.0);
    return push_entry(L, s->state->set_animation(s->data->sk, track, name, looping, mix));
}

// skeleton:add_animation(track, name, loop, mix, delay) -> entry id | nil. Without a delay the
// animation starts when the current one ends.
int skeleton_add_animation(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    size_t track = check_track(L, 2);
    const char* name = luaL_checkstring(L, 3);
    bool looping = lua_toboolean(L, 4) != 0;
    double mix = luaL_optnumber(L, 5, 0.0);
    rigby::Opt<double> delay;
    if (!lua_isnoneornil(L, 6) && luaL_checknumber(L, 6) >= 0.0) delay = rigby::Opt<double>(lua_tonumber(L, 6));
    return push_entry(L, s->state->add_animation(s->data->sk, track, name, looping, mix, delay));
}

int skeleton_clear_track(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    s->state->clear_track(check_track(L, 2));
    return 0;
}

int skeleton_stop(lua_State* L) {
    live_skeleton(L)->state->stop();
    return 0;
}

// skeleton:current(track) -> animation name, time | nil
int skeleton_current(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    const rigby::TrackEntry* e = s->state->current(check_track(L, 2));
    if (!e) return 0;
    lua_pushstring(L, s->data->sk.animations[e->animation].name.c_str());
    lua_pushnumber(L, e->time);
    return 2;
}

int skeleton_set_track_alpha(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    rigby::TrackEntry* e = s->state->current(check_track(L, 2));
    if (e) e->alpha = luaL_checknumber(L, 3);
    return 0;
}

int skeleton_set_track_time_scale(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    rigby::TrackEntry* e = s->state->current(check_track(L, 2));
    if (e) e->time_scale = luaL_checknumber(L, 3);
    return 0;
}

int skeleton_set_speed(lua_State* L) {
    live_skeleton(L)->state->speed = luaL_checknumber(L, 2);
    return 0;
}

// skeleton:set_skin(name) -> true if found. nil or "default" shows the default skin only.
int skeleton_set_skin(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    const char* name = luaL_optstring(L, 2, "");
    if (!*name || !strcmp(name, "default")) {
        s->pose->skin = rigby::NONE;
        lua_pushboolean(L, 1);
        return 1;
    }
    int skin = s->data->sk.find_skin(name);
    if (skin >= 0) s->pose->skin = skin;
    lua_pushboolean(L, skin >= 0);
    return 1;
}

int skeleton_set_tint(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    for (int k = 0; k < 4; k++) s->tint[k] = luaL_optnumber(L, 2 + k, 1.0);
    return 0;
}

int skeleton_reset_physics(lua_State* L) {
    live_skeleton(L)->pose->reset_physics();
    return 0;
}

const char* kind_name(rigby::StateEventKind kind) {
    switch (kind) {
    case rigby::EventStart: return "start";
    case rigby::EventEnd: return "end";
    case rigby::EventComplete: return "complete";
    default: return "event";
    }
}

// skeleton:update(dt) -> events | nil. Advances playback and poses the skeleton. Each event is
// { kind = "start" | "end" | "complete" | "event", track, animation, entry } plus, for "event",
// name, time, int, float, string, audio, volume, balance.
int skeleton_update(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    const rigby::SkeletonData& sk = s->data->sk;
    s->state->update(sk, luaL_checknumber(L, 2));
    s->state->apply(sk, *s->pose);
    std::vector<rigby::StateEvent> events = s->state->drain_events();
    if (events.empty()) return 0;
    lua_createtable(L, (int)events.size(), 0);
    for (size_t i = 0; i < events.size(); i++) {
        const rigby::StateEvent& e = events[i];
        lua_createtable(L, 0, 12);
        lua_pushstring(L, kind_name(e.kind));
        lua_setfield(L, -2, "kind");
        lua_pushinteger(L, (lua_Integer)e.track);
        lua_setfield(L, -2, "track");
        if (e.animation < sk.animations.size()) {
            lua_pushstring(L, sk.animations[e.animation].name.c_str());
            lua_setfield(L, -2, "animation");
        }
        lua_pushnumber(L, (lua_Number)e.entry);
        lua_setfield(L, -2, "entry");
        if (e.kind == rigby::EventKeyed) {
            const rigby::Event& ev = e.event;
            lua_pushstring(L, ev.name.c_str());
            lua_setfield(L, -2, "name");
            lua_pushnumber(L, ev.time);
            lua_setfield(L, -2, "time");
            lua_pushnumber(L, (lua_Number)ev.int_value);
            lua_setfield(L, -2, "int");
            lua_pushnumber(L, ev.float_value);
            lua_setfield(L, -2, "float");
            if (ev.string.has) {
                lua_pushstring(L, ev.string.value.c_str());
                lua_setfield(L, -2, "string");
            }
            if (ev.audio.has) {
                lua_pushstring(L, ev.audio.value.c_str());
                lua_setfield(L, -2, "audio");
            }
            lua_pushnumber(L, ev.volume);
            lua_setfield(L, -2, "volume");
            lua_pushnumber(L, ev.balance);
            lua_setfield(L, -2, "balance");
        }
        lua_rawseti(L, -2, (int)i + 1);
    }
    return 1;
}

// skeleton:bone(name) -> x, y, rotation (degrees), scale_x, scale_y in skeleton space | nil
int skeleton_bone(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    int b = s->data->sk.find_bone(luaL_checkstring(L, 2));
    if (b < 0) return 0;
    const rigby::Affine& w = s->pose->world[(size_t)b];
    lua_pushnumber(L, w.tx);
    lua_pushnumber(L, w.ty);
    lua_pushnumber(L, w.rotation());
    lua_pushnumber(L, sqrt(w.a * w.a + w.b * w.b));
    lua_pushnumber(L, sqrt(w.c * w.c + w.d * w.d));
    return 5;
}

// skeleton:set_bone(name, x, y) moves a bone to a position in skeleton space (aiming, dragging);
// applied until the next update.
int skeleton_set_bone(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    int b = s->data->sk.find_bone(luaL_checkstring(L, 2));
    if (b < 0) return 0;
    rigby::Affine w = s->pose->world[(size_t)b];
    w.tx = luaL_checknumber(L, 3);
    w.ty = luaL_checknumber(L, 4);
    std::vector<std::pair<size_t, rigby::Affine> > desired(1, std::make_pair((size_t)b, w));
    s->pose->set_worlds(s->data->sk, desired);
    return 0;
}

// Groups the batches of `geo.out` into pieces: runs drawn from one atlas page of one skeleton
// (blend modes are per vertex, so they share a piece).
void group_pieces(Geometry& geo) {
    std::vector<Piece>& pieces = geo.pieces;
    pieces.clear();
    for (size_t i = 0; i < geo.out.count(); i++) {
        const rigby::Batch& b = geo.out.batch(i);
        if (b.indices.empty()) continue;
        if (pieces.empty() || pieces.back().page != b.page || pieces.back().source != b.source) {
            Piece p;
            p.source = b.source;
            p.page = b.page;
            p.first = i;
            p.count = 0;
            p.vertices = 0;
            pieces.push_back(p);
        }
        pieces.back().count = i + 1 - pieces.back().first;
        pieces.back().vertices += b.indices.size();
    }
}

const Piece& check_piece(lua_State* L, const Geometry& geo, int index) {
    lua_Integer i = luaL_checkinteger(L, index);
    if (i < 1 || (size_t)i > geo.pieces.size()) luaL_error(L, "rigby: no piece %d", (int)i);
    return geo.pieces[(size_t)i - 1];
}

// :piece(i) -> atlas page (1-based), vertex count, source (1-based: 1 = the skeleton or the stage)
int push_piece(lua_State* L, const Geometry& geo) {
    const Piece& p = check_piece(L, geo, 2);
    lua_pushinteger(L, (lua_Integer)p.page + 1);
    lua_pushinteger(L, (lua_Integer)p.vertices);
    lua_pushinteger(L, (lua_Integer)p.source + 1);
    return 3;
}

struct Stream {
    float* data;
    uint32_t count, components, stride;
};

bool get_stream(dmBuffer::HBuffer buffer, dmhash_t name, uint32_t min_components, Stream& out) {
    void* data = 0;
    if (dmBuffer::GetStream(buffer, name, &data, &out.count, &out.components, &out.stride) != dmBuffer::RESULT_OK) return false;
    out.data = (float*)data;
    return out.components >= min_components;
}

// :write(i, buffer, previous) -> vertex count. Writes piece i as unindexed triangles into a buffer
// with float32 streams position (3), texcoord0 (2), color (4) and dark (4: rgb, then has-dark +
// 2 * blend mode). Vertices from the count up to `previous` (the count written last time) are
// collapsed so they draw nothing.
int write_piece(lua_State* L, const Geometry& geo) {
    const Piece& p = check_piece(L, geo, 2);
    dmBuffer::HBuffer buffer = dmScript::CheckBufferUnpack(L, 3);
    lua_Integer previous = luaL_optinteger(L, 4, 0);
    Stream pos, uv, color, dark;
    if (!get_stream(buffer, POSITION, 3, pos) || !get_stream(buffer, TEXCOORD0, 2, uv) || !get_stream(buffer, COLOR, 4, color) ||
        !get_stream(buffer, DARK, 4, dark))
        return luaL_error(L, "rigby: the buffer needs float32 streams position (3), texcoord0 (2), color (4) and dark (4)");
    if (p.vertices > pos.count) return luaL_error(L, "rigby: the piece needs %d vertices, the buffer has %d", (int)p.vertices, (int)pos.count);
    float* po = pos.data;
    float* uo = uv.data;
    float* co = color.data;
    float* dk = dark.data;
    for (size_t bi = p.first; bi < p.first + p.count; bi++) {
        const rigby::Batch& b = geo.out.batch(bi);
        float flags = (float)(2 * (int)b.blend);
        const uint32_t* idx = b.indices.data();
        for (size_t k = 0, n = b.indices.size(); k < n; k++) {
            uint32_t v = idx[k];
            po[0] = b.positions[v * 2];
            po[1] = b.positions[v * 2 + 1];
            po[2] = 0.0f;
            uo[0] = b.uvs[v * 2];
            uo[1] = b.uvs[v * 2 + 1];
            memcpy(co, &b.colors[v * 4], 4 * sizeof(float));
            dk[0] = b.darks[v * 4];
            dk[1] = b.darks[v * 4 + 1];
            dk[2] = b.darks[v * 4 + 2];
            dk[3] = b.darks[v * 4 + 3] + flags;
            po += pos.stride;
            uo += uv.stride;
            co += color.stride;
            dk += dark.stride;
        }
    }
    size_t end = previous > 0 ? (size_t)previous : 0;
    if (end > pos.count) end = pos.count;
    for (size_t k = p.vertices; k < end; k++) {
        po[0] = po[1] = po[2] = 0.0f;
        po += pos.stride;
    }
    lua_pushinteger(L, (lua_Integer)p.vertices);
    return 1;
}

// skeleton:build() -> piece count. Builds the geometry of the current pose.
int skeleton_build(lua_State* L) {
    Skeleton* s = live_skeleton(L);
    s->geo->out.build(s->data->sk, *s->pose, s->data->lookup, s->tint);
    group_pieces(*s->geo);
    lua_pushinteger(L, (lua_Integer)s->geo->pieces.size());
    return 1;
}

int skeleton_piece(lua_State* L) {
    return push_piece(L, *live_skeleton(L)->geo);
}

int skeleton_write(lua_State* L) {
    return write_piece(L, *live_skeleton(L)->geo);
}

// ---- scenes ---------------------------------------------------------------------------------------

const char* SCENE_TYPE = "rigby.scene";

SceneState* check_scene(lua_State* L, int index) {
    SceneState** p = (SceneState**)luaL_checkudata(L, index, SCENE_TYPE);
    if (!*p) luaL_error(L, "rigby: scene was released");
    return *p;
}

struct ReadContext {
    lua_State* L;
    int reader;  // stack index of the Lua reader function
    std::vector<std::string>* files;
};

// Reads a file the manifest names with the Lua reader: reader(name) -> bytes | nil, error.
bool read_scene_file(void* ctx, const std::string& file, std::vector<uint8_t>& out, std::string& err) {
    ReadContext* c = (ReadContext*)ctx;
    lua_State* L = c->L;
    lua_pushvalue(L, c->reader);
    lua_pushstring(L, file.c_str());
    if (lua_pcall(L, 1, 2, 0) != 0) {
        err = lua_tostring(L, -1) ? lua_tostring(L, -1) : "the reader failed";
        lua_pop(L, 1);
        return false;
    }
    bool ok = lua_type(L, -2) == LUA_TSTRING;
    if (ok) {
        size_t len = 0;
        const char* bytes = lua_tolstring(L, -2, &len);
        out.assign((const uint8_t*)bytes, (const uint8_t*)bytes + len);
        c->files->push_back(file);
    } else {
        err = lua_tostring(L, -1) ? lua_tostring(L, -1) : "cannot read it";
    }
    lua_pop(L, 2);
    return ok;
}

// rigby.load_scene(manifest_bytes, reader) -> scene | nil, error. `reader(name)` returns the bytes
// of a skeleton file the manifest names (they sit next to it), or nil and an error.
int load_scene(lua_State* L) {
    size_t len = 0;
    const char* manifest = luaL_checklstring(L, 1, &len);
    luaL_checktype(L, 2, LUA_TFUNCTION);
    SceneState* scene = new SceneState();
    ReadContext ctx = {L, 2, &scene->files};
    std::string err;
    if (!rigby::load_scene((const uint8_t*)manifest, len, read_scene_file, &ctx, scene->player, err)) {
        delete scene;
        lua_pushnil(L);
        lua_pushstring(L, err.c_str());
        return 2;
    }
    // Source 0 is the stage, then one per character; atlases come later with set_atlas.
    size_t sources = 1 + scene->player.characters.size();
    scene->files.resize(sources);
    scene->atlases.resize(sources);
    scene->lookups.resize(sources);
    scene->player.evaluate(0.0);
    SceneState** p = (SceneState**)lua_newuserdata(L, sizeof(SceneState*));
    *p = scene;
    luaL_getmetatable(L, SCENE_TYPE);
    lua_setmetatable(L, -2);
    return 1;
}

int scene_gc(lua_State* L) {
    SceneState** p = (SceneState**)luaL_checkudata(L, 1, SCENE_TYPE);
    delete *p;
    *p = 0;
    return 0;
}

const rigby::SkeletonData& source_data(const SceneState* s, size_t source) {
    return source == 0 ? s->player.stage : s->player.characters[source - 1].data;
}

size_t check_source(lua_State* L, const SceneState* s, int index) {
    lua_Integer i = luaL_checkinteger(L, index);
    if (i < 1 || (size_t)i > s->files.size()) luaL_error(L, "rigby: no source %d", (int)i);
    return (size_t)i - 1;
}

// scene:sources() -> { skeleton file of the stage, then of each character }
int scene_sources(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    lua_createtable(L, (int)s->files.size(), 0);
    for (size_t i = 0; i < s->files.size(); i++) {
        lua_pushstring(L, s->files[i].c_str());
        lua_rawseti(L, -2, (int)i + 1);
    }
    return 1;
}

// scene:set_atlas(source, atlas_text) gives a source (1 = the stage) its atlas.
int scene_set_atlas(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    size_t source = check_source(L, s, 2);
    size_t len = 0;
    const char* text = luaL_checklstring(L, 3, &len);
    s->atlases[source] = rigby::Atlas::parse(text, len);
    const rigby::SkeletonData& sk = source_data(s, source);
    s->lookups[source] = rigby::RegionLookup(sk, s->atlases[source]);
    std::vector<std::string> missing = s->lookups[source].missing(sk);
    for (size_t i = 0; i < missing.size(); i++) dmLogWarning("rigby: %s: no atlas region for image '%s'", s->files[source].c_str(), missing[i].c_str());
    return 0;
}

// scene:pages(source) -> the pages of that source's atlas: { { name, pma, width, height }, ... }
int scene_pages(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    const std::vector<rigby::AtlasPage>& pages = s->atlases[check_source(L, s, 2)].pages;
    lua_createtable(L, (int)pages.size(), 0);
    for (size_t i = 0; i < pages.size(); i++) {
        lua_createtable(L, 0, 4);
        lua_pushstring(L, pages[i].name.c_str());
        lua_setfield(L, -2, "name");
        lua_pushboolean(L, pages[i].pma);
        lua_setfield(L, -2, "pma");
        lua_pushnumber(L, pages[i].width);
        lua_setfield(L, -2, "width");
        lua_pushnumber(L, pages[i].height);
        lua_setfield(L, -2, "height");
        lua_rawseti(L, -2, (int)i + 1);
    }
    return 1;
}

// scene:shots() -> names of the stage animations
int scene_shots(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    push_names(L, s->player.stage.animations.size(), animation_name, s->player.stage);
    return 1;
}

// scene:actors() -> actor names
int scene_actors(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    const std::vector<rigby::Actor>& actors = s->player.scene.actors;
    lua_createtable(L, (int)actors.size(), 0);
    for (size_t i = 0; i < actors.size(); i++) {
        lua_pushstring(L, actors[i].name.c_str());
        lua_rawseti(L, -2, (int)i + 1);
    }
    return 1;
}

// scene:play(shot, loop) -> true if the stage has that shot
int scene_play(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    const char* shot = luaL_checkstring(L, 2);
    if (s->player.stage.find_animation(shot) < 0) {
        lua_pushboolean(L, 0);
        return 1;
    }
    s->player.play(shot, lua_toboolean(L, 3) != 0);
    s->finished = false;
    lua_pushboolean(L, 1);
    return 1;
}

// scene:update(dt) -> true when the shot reached its end this frame (each time round when
// looping, once when it holds at the end)
int scene_update(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    rigby::ScenePlayer& p = s->player;
    double before = p.time;
    p.update(luaL_checknumber(L, 2));
    double d = p.duration();
    bool ended = d > 0.0 && (p.looping ? p.time < before : p.time >= d);
    bool report = ended && (p.looping || !s->finished);
    if (ended) s->finished = true;
    lua_pushboolean(L, report);
    return 1;
}

// scene:seek(seconds) jumps into the current shot (physics starts again from there).
int scene_seek(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    rigby::ScenePlayer& p = s->player;
    for (size_t i = 0; i < p.characters.size(); i++) p.characters[i].pose->reset_physics();
    double t = luaL_checknumber(L, 2);
    double d = std::max(p.duration(), 0.0);
    p.time = t < 0.0 ? 0.0 : (t > d ? d : t);
    p.evaluate(0.0);
    s->finished = false;
    return 0;
}

// scene:current() -> shot name, time, duration
int scene_current(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    lua_pushstring(L, s->player.shot.has ? s->player.shot.value.c_str() : "");
    lua_pushnumber(L, s->player.time);
    lua_pushnumber(L, s->player.duration());
    return 3;
}

int push_world(lua_State* L, const rigby::Affine& w) {
    lua_pushnumber(L, w.tx);
    lua_pushnumber(L, w.ty);
    lua_pushnumber(L, w.rotation());
    lua_pushnumber(L, sqrt(w.a * w.a + w.b * w.b));
    lua_pushnumber(L, sqrt(w.c * w.c + w.d * w.d));
    return 5;
}

// scene:stage_bone(name) -> x, y, rotation, scale_x, scale_y | nil. The stage's "camera" bone is
// the camera: follow it with a camera, or move the scene the other way.
int scene_stage_bone(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    int b = s->player.stage.find_bone(luaL_checkstring(L, 2));
    if (b < 0) return 0;
    return push_world(L, s->player.pose->world[(size_t)b]);
}

// scene:actor_bone(actor, bone) -> x, y, rotation, scale_x, scale_y | nil, in the scene's space
int scene_actor_bone(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    const char* actor = luaL_checkstring(L, 2);
    const char* bone = luaL_checkstring(L, 3);
    const rigby::ScenePlayer& p = s->player;
    for (size_t a = 0; a < p.scene.actors.size(); a++) {
        if (p.scene.actors[a].name != actor) continue;
        const rigby::SceneCharacter* c = p.character(a);
        if (!c) return 0;
        int b = c->data.find_bone(bone);
        if (b < 0) return 0;
        return push_world(L, c->pose->world[(size_t)b]);
    }
    return 0;
}

// scene:build() -> piece count. The stage and its characters in the stage's draw order: runs of
// stage slots between the characters, each character tinted by its slot's color.
int scene_build(lua_State* L) {
    SceneState* s = check_scene(L, 1);
    const rigby::ScenePlayer& p = s->player;
    static const double WHITE[4] = {1, 1, 1, 1};
    rigby::RenderOutput& out = s->geo.out;
    std::vector<size_t>& run = s->run;
    out.clear();
    run.clear();
    std::vector<rigby::SceneLayer> layers = p.draw_list();
    for (size_t i = 0; i < layers.size(); i++) {
        const rigby::SceneLayer& layer = layers[i];
        int c = -1;
        if (layer.actor >= 0) {
            const std::string& id = p.scene.actors[(size_t)layer.actor].id;
            for (size_t k = 0; k < p.characters.size(); k++)
                if (p.characters[k].id == id) c = (int)k;
        }
        if (c < 0) {
            run.push_back(layer.slot);
            continue;
        }
        if (!run.empty()) {
            out.append(p.stage, *p.pose, s->lookups[0], WHITE, run, 0);
            run.clear();
        }
        const rigby::SceneCharacter& ch = p.characters[(size_t)c];
        if (layer.tint[3] > 0.0) out.append(ch.data, *ch.pose, s->lookups[1 + (size_t)c], layer.tint, ch.pose->draw_order, 1 + (size_t)c);
    }
    if (!run.empty()) out.append(p.stage, *p.pose, s->lookups[0], WHITE, run, 0);
    group_pieces(s->geo);
    lua_pushinteger(L, (lua_Integer)s->geo.pieces.size());
    return 1;
}

int scene_piece(lua_State* L) {
    return push_piece(L, check_scene(L, 1)->geo);
}

int scene_write(lua_State* L) {
    return write_piece(L, check_scene(L, 1)->geo);
}

const luaL_reg scene_methods[] = {
    {"sources", scene_sources},
    {"set_atlas", scene_set_atlas},
    {"pages", scene_pages},
    {"shots", scene_shots},
    {"actors", scene_actors},
    {"play", scene_play},
    {"update", scene_update},
    {"seek", scene_seek},
    {"current", scene_current},
    {"stage_bone", scene_stage_bone},
    {"actor_bone", scene_actor_bone},
    {"build", scene_build},
    {"piece", scene_piece},
    {"write", scene_write},
    {0, 0},
};

const luaL_reg module_functions[] = {
    {"load", load},
    {"new", new_skeleton},
    {"load_scene", load_scene},
    {0, 0},
};

const luaL_reg data_methods[] = {
    {"bones", data_bones},
    {"slots", data_slots},
    {"skins", data_skins},
    {"animations", data_animations},
    {"events", data_events},
    {"duration", data_duration},
    {"pages", data_pages},
    {0, 0},
};

const luaL_reg skeleton_methods[] = {
    {"set_animation", skeleton_set_animation},
    {"add_animation", skeleton_add_animation},
    {"clear_track", skeleton_clear_track},
    {"stop", skeleton_stop},
    {"current", skeleton_current},
    {"set_track_alpha", skeleton_set_track_alpha},
    {"set_track_time_scale", skeleton_set_track_time_scale},
    {"set_speed", skeleton_set_speed},
    {"set_skin", skeleton_set_skin},
    {"set_tint", skeleton_set_tint},
    {"reset_physics", skeleton_reset_physics},
    {"update", skeleton_update},
    {"bone", skeleton_bone},
    {"set_bone", skeleton_set_bone},
    {"build", skeleton_build},
    {"piece", skeleton_piece},
    {"write", skeleton_write},
    {0, 0},
};

void register_type(lua_State* L, const char* name, const luaL_reg* methods, lua_CFunction gc) {
    luaL_newmetatable(L, name);
    lua_newtable(L);
    luaL_register(L, 0, methods);
    lua_setfield(L, -2, "__index");
    lua_pushcfunction(L, gc);
    lua_setfield(L, -2, "__gc");
    lua_pop(L, 1);
}

dmExtension::Result initialize(dmExtension::Params* params) {
    lua_State* L = params->m_L;
    register_type(L, DATA_TYPE, data_methods, data_gc);
    register_type(L, SKELETON_TYPE, skeleton_methods, skeleton_gc);
    register_type(L, SCENE_TYPE, scene_methods, scene_gc);
    luaL_register(L, MODULE_NAME, module_functions);
    lua_pop(L, 1);
    return dmExtension::RESULT_OK;
}

dmExtension::Result finalize(dmExtension::Params*) {
    return dmExtension::RESULT_OK;
}

}  // namespace

DM_DECLARE_EXTENSION(EXTENSION_NAME, LIB_NAME, 0, 0, initialize, 0, 0, finalize)
