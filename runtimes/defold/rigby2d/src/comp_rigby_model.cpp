// SPDX-License-Identifier: MIT OR Apache-2.0
// The Rigby2D model component (.rigbymodel): a skeleton exported from Rigby2D, with its images in a
// Defold atlas, added to a game object like a sprite. Two resource types (.rigbyskelc: the skeleton
// bytes; .rigbymodelc: the component settings, which load the skeleton, atlas and material), the
// component itself (playback, world-space geometry, rendering) and its script API in the `rigby`
// module:
//
//   rigby.play(url, animation, [{ loop, mix, track }], [callback])   -> true | false
//   rigby.queue(url, animation, [{ loop, mix, track, delay }], [callback])
//   rigby.stop(url, [track])
//   rigby.set_skin(url, skin)            rigby.set_tint(url, vmath.vector4)
//   rigby.bone(url, name) -> position (vector3, game object space), rotation (degrees) | nil
//   rigby.on_event(url, callback | nil)  callback(self, event): every playback event
//   go.get / go.set(url, "animation" | "skin" | "playback_rate")
//
// The editor previews the same component through pluginsrc/plugin.cpp, which shares the geometry
// code (commonsrc/defold_model.cpp), so it draws exactly what the game draws.

#include <dmsdk/sdk.h>
#include <dmsdk/dlib/log.h>
#include <dmsdk/dlib/math.h>
#include <dmsdk/dlib/object_pool.h>
#include <dmsdk/gameobject/component.h>
#include <dmsdk/gamesys/property.h>
#include <dmsdk/gamesys/resources/res_material.h>
#include <dmsdk/gamesys/resources/res_textureset.h>
#include <dmsdk/gamesys/script.h>
#include <dmsdk/resource/resource.h>
#include <gameobject/gameobject_ddf.h>

#include <string.h>
#include <vector>

#include <rigby_defold.h>
#include "rigby2d_ddf.h"  // generated from commonsrc/rigby2d_ddf.proto

namespace rigby_model {

using namespace dmVMath;

static const char* MODEL_EXT = "rigbymodelc";
static const dmhash_t PROP_ANIMATION = dmHashString64("animation");
static const dmhash_t PROP_SKIN = dmHashString64("skin");
static const dmhash_t PROP_PLAYBACK_RATE = dmHashString64("playback_rate");

// ---- resources ------------------------------------------------------------------------------------

// .rigbyskelc: the skeleton file's bytes (a binary .skel or JSON, as exported from Rigby2D).
struct SkeletonResource {
    std::vector<uint8_t> bytes;
};

static dmResource::Result SkeletonCreate(const dmResource::ResourceCreateParams* params) {
    SkeletonResource* r = new SkeletonResource();
    r->bytes.assign((const uint8_t*)params->m_Buffer, (const uint8_t*)params->m_Buffer + params->m_BufferSize);
    dmResource::SetResource(params->m_Resource, r);
    dmResource::SetResourceSize(params->m_Resource, params->m_BufferSize);
    return dmResource::RESULT_OK;
}

static dmResource::Result SkeletonDestroy(const dmResource::ResourceDestroyParams* params) {
    delete (SkeletonResource*)dmResource::GetResource(params->m_Resource);
    return dmResource::RESULT_OK;
}

static dmResource::Result SkeletonRecreate(const dmResource::ResourceRecreateParams* params) {
    SkeletonResource* r = (SkeletonResource*)dmResource::GetResource(params->m_Resource);
    r->bytes.assign((const uint8_t*)params->m_Buffer, (const uint8_t*)params->m_Buffer + params->m_BufferSize);
    dmResource::SetResourceSize(params->m_Resource, params->m_BufferSize);
    return dmResource::RESULT_OK;
}

static ResourceResult SkeletonRegister(HResourceTypeContext ctx, HResourceType type) {
    return (ResourceResult)dmResource::SetupType(ctx, type, 0, 0, SkeletonCreate, 0, SkeletonDestroy, SkeletonRecreate);
}

// .rigbymodelc: the component's settings, with the skeleton read and mapped onto the atlas.
struct ModelResource {
    dmRigby2DDDF::RigbyModelDesc* ddf;
    SkeletonResource* skeleton;
    dmGameSystem::TextureSetResource* atlas;
    dmGameSystem::MaterialResource* material;
    rigby::ModelData* data;
    ModelResource() : ddf(0), skeleton(0), atlas(0), material(0), data(0) {}
};

static void ReleaseModel(dmResource::HFactory factory, ModelResource* r) {
    if (r->skeleton) dmResource::Release(factory, r->skeleton);
    if (r->atlas) dmResource::Release(factory, r->atlas);
    if (r->material) dmResource::Release(factory, r->material);
    if (r->ddf) dmDDF::FreeMessage(r->ddf);
    delete r->data;
    r->skeleton = 0;
    r->atlas = 0;
    r->material = 0;
    r->ddf = 0;
    r->data = 0;
}

static dmResource::Result AcquireModel(dmResource::HFactory factory, ModelResource* r, const char* filename) {
    dmResource::Result res = dmResource::Get(factory, r->ddf->m_Skeleton, (void**)&r->skeleton);
    if (res != dmResource::RESULT_OK) return res;
    res = dmResource::Get(factory, r->ddf->m_Atlas, (void**)&r->atlas);
    if (res != dmResource::RESULT_OK) return res;
    res = dmResource::Get(factory, r->ddf->m_Material, (void**)&r->material);
    if (res != dmResource::RESULT_OK) return res;
    if (dmRender::GetMaterialVertexSpace(r->material->m_Material) != dmRenderDDF::MaterialDesc::VERTEX_SPACE_WORLD) {
        dmLogError("%s: a Rigby2D model needs a material with Vertex Space set to World", filename);
        return dmResource::RESULT_NOT_SUPPORTED;
    }
    r->data = new rigby::ModelData();
    std::string err;
    if (!rigby::load_model_data(r->skeleton->bytes.data(), r->skeleton->bytes.size(), r->atlas->m_TextureSet, *r->data, err)) {
        dmLogError("%s: %s", filename, err.c_str());
        return dmResource::RESULT_INVALID_DATA;
    }
    for (size_t i = 0; i < r->data->sk.warnings.size(); i++) dmLogWarning("%s: %s", filename, r->data->sk.warnings[i].c_str());
    for (size_t i = 0; i < r->data->missing.size(); i++) dmLogWarning("%s: the atlas has no image '%s'", filename, r->data->missing[i].c_str());
    return dmResource::RESULT_OK;
}

static dmResource::Result ModelPreload(const dmResource::ResourcePreloadParams* params) {
    dmRigby2DDDF::RigbyModelDesc* ddf;
    if (dmDDF::LoadMessage(params->m_Buffer, params->m_BufferSize, &dmRigby2DDDF_RigbyModelDesc_DESCRIPTOR, (void**)&ddf) != dmDDF::RESULT_OK) return dmResource::RESULT_DDF_ERROR;
    dmResource::PreloadHint(params->m_HintInfo, ddf->m_Skeleton);
    dmResource::PreloadHint(params->m_HintInfo, ddf->m_Atlas);
    dmResource::PreloadHint(params->m_HintInfo, ddf->m_Material);
    *params->m_PreloadData = ddf;
    return dmResource::RESULT_OK;
}

static dmResource::Result ModelCreate(const dmResource::ResourceCreateParams* params) {
    ModelResource* r = new ModelResource();
    r->ddf = (dmRigby2DDDF::RigbyModelDesc*)params->m_PreloadData;
    dmResource::Result res = AcquireModel(params->m_Factory, r, params->m_Filename);
    if (res != dmResource::RESULT_OK) {
        ReleaseModel(params->m_Factory, r);
        delete r;
        return res;
    }
    dmResource::SetResource(params->m_Resource, r);
    return dmResource::RESULT_OK;
}

static dmResource::Result ModelDestroy(const dmResource::ResourceDestroyParams* params) {
    ModelResource* r = (ModelResource*)dmResource::GetResource(params->m_Resource);
    ReleaseModel(params->m_Factory, r);
    delete r;
    return dmResource::RESULT_OK;
}

static dmResource::Result ModelRecreate(const dmResource::ResourceRecreateParams* params) {
    dmRigby2DDDF::RigbyModelDesc* ddf;
    if (dmDDF::LoadMessage(params->m_Buffer, params->m_BufferSize, &dmRigby2DDDF_RigbyModelDesc_DESCRIPTOR, (void**)&ddf) != dmDDF::RESULT_OK) return dmResource::RESULT_DDF_ERROR;
    ModelResource* r = (ModelResource*)dmResource::GetResource(params->m_Resource);
    ReleaseModel(params->m_Factory, r);
    r->ddf = ddf;
    return AcquireModel(params->m_Factory, r, params->m_Filename);
}

static ResourceResult ModelRegister(HResourceTypeContext ctx, HResourceType type) {
    return (ResourceResult)dmResource::SetupType(ctx, type, 0, ModelPreload, ModelCreate, 0, ModelDestroy, ModelRecreate);
}

// ---- component ------------------------------------------------------------------------------------

struct TrackCallback {
    uint64_t entry;
    dmScript::LuaCallbackInfo* callback;
};

struct Component {
    dmGameObject::HInstance instance;
    dmTransform::Transform transform;
    Matrix4 world;
    ModelResource* resource;
    rigby::ModelInstance* model;
    std::vector<TrackCallback> track_callbacks;  // by track
    dmScript::LuaCallbackInfo* listener;
    std::vector<dmScript::LuaCallbackInfo*> retired;  // released after the current dispatch
    float bounds[4];
    uint32_t vertex_start, vertex_count;
    uint32_t dispatching;
    uint8_t enabled : 1;
    uint8_t added_to_update : 1;
};

struct World {
    dmObjectPool<Component*> components;
    std::vector<rigby::ModelVertex> vertices;
    std::vector<dmRender::RenderObject> render_objects;
    dmGraphics::HVertexDeclaration vertex_declaration;
    dmGraphics::HVertexBuffer vertex_buffer;
};

struct Context {
    dmResource::HFactory factory;
    dmRender::HRenderContext render_context;
    dmGraphics::HContext graphics_context;
    uint32_t max_count;
};

static Component* GetComponent(World* world, uint32_t index) {
    return world->components.Get(index);
}

static const rigby::ModelData& Data(const Component* c) {
    return *c->resource->data;
}

static void ReleaseCallback(Component* c, dmScript::LuaCallbackInfo* cb) {
    if (!cb) return;
    if (c->dispatching) c->retired.push_back(cb);
    else dmScript::DestroyCallback(cb);
}

static void SetTrackCallback(Component* c, size_t track, uint64_t entry, dmScript::LuaCallbackInfo* cb) {
    if (c->track_callbacks.size() <= track) {
        TrackCallback none = {0, 0};
        c->track_callbacks.resize(track + 1, none);
    }
    ReleaseCallback(c, c->track_callbacks[track].callback);
    c->track_callbacks[track].entry = entry;
    c->track_callbacks[track].callback = cb;
}

static bool Play(Component* c, size_t track, const char* name, bool loop, double mix, bool queue, rigby::Opt<double> delay, dmScript::LuaCallbackInfo* cb) {
    const rigby::ModelData& d = Data(c);
    rigby::Opt<uint64_t> id = queue ? c->model->state.add_animation(d.sk, track, name, loop, mix, delay) : c->model->state.set_animation(d.sk, track, name, loop, mix);
    if (!id.has) {
        if (cb) dmScript::DestroyCallback(cb);
        return false;
    }
    if (cb || !queue) SetTrackCallback(c, track, id.value, cb);
    return true;
}

static void PushEvent(lua_State* L, const rigby::SkeletonData& sk, const rigby::StateEvent& e) {
    static const char* kinds[] = {"start", "end", "complete", "event"};
    lua_createtable(L, 0, 12);
    lua_pushstring(L, kinds[e.kind]);
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
}

static void Invoke(dmScript::LuaCallbackInfo* cb, const rigby::SkeletonData& sk, const rigby::StateEvent& e) {
    if (!dmScript::IsCallbackValid(cb)) return;
    lua_State* L = dmScript::GetCallbackLuaContext(cb);
    DM_LUA_STACK_CHECK(L, 0);
    if (!dmScript::SetupCallback(cb)) return;
    PushEvent(L, sk, e);
    dmScript::PCall(L, 2, 0);
    dmScript::TeardownCallback(cb);
}

// Runs the callbacks for this frame's playback events: the track's (for its own entry) and the listener.
static void DispatchEvents(Component* c) {
    std::vector<rigby::StateEvent> events = c->model->state.drain_events();
    if (events.empty()) return;
    const rigby::SkeletonData& sk = Data(c).sk;
    c->dispatching++;
    for (size_t i = 0; i < events.size(); i++) {
        const rigby::StateEvent& e = events[i];
        if (e.track < c->track_callbacks.size()) {
            TrackCallback& tc = c->track_callbacks[e.track];
            if (tc.callback && tc.entry == e.entry) Invoke(tc.callback, sk, e);
        }
        if (c->listener) Invoke(c->listener, sk, e);
    }
    c->dispatching--;
    if (!c->dispatching) {
        for (size_t i = 0; i < c->retired.size(); i++) dmScript::DestroyCallback(c->retired[i]);
        c->retired.clear();
    }
}

static dmGameObject::CreateResult NewWorld(const dmGameObject::ComponentNewWorldParams& params) {
    Context* ctx = (Context*)params.m_Context;
    World* world = new World();
    uint32_t count = dmMath::Min(params.m_MaxComponentInstances, ctx->max_count);
    world->components.SetCapacity(count);
    world->render_objects.reserve(count);
    dmGraphics::HVertexStreamDeclaration decl = dmGraphics::NewVertexStreamDeclaration(ctx->graphics_context);
    dmGraphics::AddVertexStream(decl, "position", 3, dmGraphics::TYPE_FLOAT, false);
    dmGraphics::AddVertexStream(decl, "texcoord0", 2, dmGraphics::TYPE_FLOAT, false);
    dmGraphics::AddVertexStream(decl, "color", 4, dmGraphics::TYPE_FLOAT, false);
    dmGraphics::AddVertexStream(decl, "dark", 4, dmGraphics::TYPE_FLOAT, false);
    world->vertex_declaration = dmGraphics::NewVertexDeclaration(ctx->graphics_context, decl);
    dmGraphics::DeleteVertexStreamDeclaration(decl);
    world->vertex_buffer = dmGraphics::NewVertexBuffer(ctx->graphics_context, 0, 0, dmGraphics::BUFFER_USAGE_DYNAMIC_DRAW);
    *params.m_World = world;
    return dmGameObject::CREATE_RESULT_OK;
}

static dmGameObject::CreateResult DeleteWorld(const dmGameObject::ComponentDeleteWorldParams& params) {
    World* world = (World*)params.m_World;
    dmGraphics::DeleteVertexDeclaration(world->vertex_declaration);
    dmGraphics::DeleteVertexBuffer(world->vertex_buffer);
    delete world;
    return dmGameObject::CREATE_RESULT_OK;
}

static dmGameObject::CreateResult Create(const dmGameObject::ComponentCreateParams& params) {
    World* world = (World*)params.m_World;
    if (world->components.Full()) {
        dmLogError("Rigby2D model could not be created: the limit of %d is reached (rigby2d.max_count in game.project).", world->components.Capacity());
        return dmGameObject::CREATE_RESULT_UNKNOWN_ERROR;
    }
    ModelResource* resource = (ModelResource*)params.m_Resource;
    Component* c = new Component();
    c->instance = params.m_Instance;
    c->transform = dmTransform::Transform(Vector3(params.m_Position), params.m_Rotation, params.m_Scale);
    c->world = Matrix4::identity();
    c->resource = resource;
    c->model = new rigby::ModelInstance(resource->data->sk);
    c->listener = 0;
    c->vertex_start = c->vertex_count = 0;
    c->dispatching = 0;
    c->enabled = 1;
    c->added_to_update = 0;
    const dmRigby2DDDF::RigbyModelDesc* ddf = resource->ddf;
    if (ddf->m_Skin && *ddf->m_Skin && !c->model->set_skin(*resource->data, ddf->m_Skin)) dmLogWarning("Rigby2D model: no skin '%s'", ddf->m_Skin);
    c->model->state.speed = ddf->m_PlaybackRate;
    if (ddf->m_DefaultAnimation && *ddf->m_DefaultAnimation && !c->model->state.set_animation(resource->data->sk, 0, ddf->m_DefaultAnimation, ddf->m_Loop, 0).has)
        dmLogWarning("Rigby2D model: no animation '%s'", ddf->m_DefaultAnimation);
    c->model->update(*resource->data, 0);
    c->model->state.drain_events();
    uint32_t index = world->components.Alloc();
    world->components.Set(index, c);
    *params.m_UserData = (uintptr_t)index;
    return dmGameObject::CREATE_RESULT_OK;
}

static dmGameObject::CreateResult Destroy(const dmGameObject::ComponentDestroyParams& params) {
    World* world = (World*)params.m_World;
    uint32_t index = (uint32_t)*params.m_UserData;
    Component* c = GetComponent(world, index);
    for (size_t i = 0; i < c->track_callbacks.size(); i++)
        if (c->track_callbacks[i].callback) dmScript::DestroyCallback(c->track_callbacks[i].callback);
    if (c->listener) dmScript::DestroyCallback(c->listener);
    for (size_t i = 0; i < c->retired.size(); i++) dmScript::DestroyCallback(c->retired[i]);
    delete c->model;
    delete c;
    world->components.Free(index, true);
    return dmGameObject::CREATE_RESULT_OK;
}

static dmGameObject::CreateResult AddToUpdate(const dmGameObject::ComponentAddToUpdateParams& params) {
    GetComponent((World*)params.m_World, (uint32_t)*params.m_UserData)->added_to_update = 1;
    return dmGameObject::CREATE_RESULT_OK;
}

static dmGameObject::UpdateResult LateUpdate(const dmGameObject::ComponentsUpdateParams& params, dmGameObject::ComponentsUpdateResult&) {
    World* world = (World*)params.m_World;
    const float dt = params.m_UpdateContext->m_DT;
    dmArray<Component*>& components = world->components.GetRawObjects();
    for (uint32_t i = 0; i < components.Size(); i++) {
        Component* c = components[i];
        if (!c->enabled || !c->added_to_update) continue;
        c->world = dmGameObject::GetWorldMatrix(c->instance) * dmTransform::ToMatrix4(c->transform);
        c->model->update(Data(c), dt);
        DispatchEvents(c);
    }
    return dmGameObject::UPDATE_RESULT_OK;
}

static void RenderListDispatch(dmRender::RenderListDispatchParams const& params) {
    World* world = (World*)params.m_UserData;
    if (params.m_Operation != dmRender::RENDER_LIST_OPERATION_BATCH) return;
    dmArray<Component*>& components = world->components.GetRawObjects();
    for (uint32_t* i = params.m_Begin; i != params.m_End; ++i) {
        Component* c = components[(uint32_t)params.m_Buf[*i].m_UserData];
        if (!c->vertex_count) continue;
        world->render_objects.push_back(dmRender::RenderObject());
        dmRender::RenderObject& ro = world->render_objects.back();
        ro.Init();
        ro.m_VertexDeclaration = world->vertex_declaration;
        ro.m_VertexBuffer = world->vertex_buffer;
        ro.m_PrimitiveType = dmGraphics::PRIMITIVE_TRIANGLES;
        ro.m_VertexStart = c->vertex_start;
        ro.m_VertexCount = c->vertex_count;
        ro.m_Textures[0] = c->resource->atlas->m_Texture->m_Texture;
        ro.m_Material = c->resource->material->m_Material;
        // The shader writes straight alpha, with blend modes encoded per vertex (rigby2d.fp).
        ro.m_SetBlendFactors = 1;
        ro.m_SourceBlendFactor = dmGraphics::BLEND_FACTOR_SRC_ALPHA;
        ro.m_DestinationBlendFactor = dmGraphics::BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
        dmRender::AddToRender(params.m_Context, &ro);
    }
}

static void RenderListVisibility(dmRender::RenderListVisibilityParams const& params) {
    for (uint32_t i = 0; i < params.m_NumEntries; ++i) params.m_Entries[i].m_Visibility = dmRender::VISIBILITY_FULL;
}

static dmGameObject::UpdateResult Render(const dmGameObject::ComponentsRenderParams& params) {
    Context* ctx = (Context*)params.m_Context;
    World* world = (World*)params.m_World;
    dmArray<Component*>& components = world->components.GetRawObjects();
    const uint32_t count = components.Size();
    // All this frame's triangles go into one vertex buffer; each model draws its own range.
    world->vertices.clear();
    world->render_objects.clear();
    world->render_objects.reserve(count);
    for (uint32_t i = 0; i < count; i++) {
        Component* c = components[i];
        c->vertex_count = 0;
        if (!c->enabled || !c->added_to_update) continue;
        float m[16];
        for (int col = 0; col < 4; col++) {
            const Vector4 v = c->world.getCol(col);
            m[col * 4] = v.getX();
            m[col * 4 + 1] = v.getY();
            m[col * 4 + 2] = v.getZ();
            m[col * 4 + 3] = v.getW();
        }
        c->bounds[0] = c->bounds[1] = 1e30f;
        c->bounds[2] = c->bounds[3] = -1e30f;
        c->vertex_start = (uint32_t)world->vertices.size();
        c->vertex_count = (uint32_t)c->model->write(Data(c), m, world->vertices, c->bounds);
    }
    if (world->vertices.empty()) return dmGameObject::UPDATE_RESULT_OK;
    dmGraphics::SetVertexBufferData(world->vertex_buffer, (uint32_t)(world->vertices.size() * sizeof(rigby::ModelVertex)), world->vertices.data(), dmGraphics::BUFFER_USAGE_DYNAMIC_DRAW);

    dmRender::RenderListEntry* list = dmRender::RenderListAlloc(ctx->render_context, count);
    dmRender::HRenderListDispatch dispatch = dmRender::RenderListMakeDispatch(ctx->render_context, &RenderListDispatch, &RenderListVisibility, world);
    dmRender::RenderListEntry* write = list;
    for (uint32_t i = 0; i < count; i++) {
        Component* c = components[i];
        if (!c->vertex_count) continue;
        const Vector4 t = c->world.getCol(3);
        write->m_WorldPosition = Point3(t.getX(), t.getY(), t.getZ());
        write->m_UserData = (uintptr_t)i;
        write->m_BatchKey = (uint32_t)i;
        write->m_TagListKey = dmRender::GetMaterialTagListKey(c->resource->material->m_Material);
        write->m_Dispatch = dispatch;
        write->m_MinorOrder = 0;
        write->m_MajorOrder = dmRender::RENDER_ORDER_WORLD;
        ++write;
    }
    dmRender::RenderListSubmit(ctx->render_context, list, write);
    return dmGameObject::UPDATE_RESULT_OK;
}

static dmGameObject::UpdateResult OnMessage(const dmGameObject::ComponentOnMessageParams& params) {
    Component* c = GetComponent((World*)params.m_World, (uint32_t)*params.m_UserData);
    if (params.m_Message->m_Id == dmGameObjectDDF::Enable::m_DDFDescriptor->m_NameHash) c->enabled = 1;
    else if (params.m_Message->m_Id == dmGameObjectDDF::Disable::m_DDFDescriptor->m_NameHash) c->enabled = 0;
    return dmGameObject::UPDATE_RESULT_OK;
}

static void* GetComponentFn(const dmGameObject::ComponentGetParams& params) {
    return GetComponent((World*)params.m_World, (uint32_t)params.m_UserData);
}

// The animation playing on track 0, or 0.
static dmhash_t CurrentAnimation(const Component* c) {
    const rigby::TrackEntry* e = c->model->state.current(0);
    return e ? dmHashString64(Data(c).sk.animations[e->animation].name.c_str()) : 0;
}

static dmGameObject::PropertyResult GetProperty(const dmGameObject::ComponentGetPropertyParams& params, dmGameObject::PropertyDesc& out) {
    Component* c = GetComponent((World*)params.m_World, (uint32_t)*params.m_UserData);
    if (params.m_PropertyId == PROP_ANIMATION) {
        out.m_Variant = dmGameObject::PropertyVar(CurrentAnimation(c));
        return dmGameObject::PROPERTY_RESULT_OK;
    }
    if (params.m_PropertyId == PROP_SKIN) {
        const int skin = c->model->pose.skin;
        out.m_Variant = dmGameObject::PropertyVar(skin >= 0 ? dmHashString64(Data(c).sk.skins[(size_t)skin].name.c_str()) : dmHashString64(""));
        return dmGameObject::PROPERTY_RESULT_OK;
    }
    if (params.m_PropertyId == PROP_PLAYBACK_RATE) {
        out.m_Variant = dmGameObject::PropertyVar((float)c->model->state.speed);
        return dmGameObject::PROPERTY_RESULT_OK;
    }
    return dmGameObject::PROPERTY_RESULT_NOT_FOUND;
}

// A name in `names` (animations or skins) from its hash; empty when there is none.
template <typename T>
static const std::string* NameOf(const std::vector<T>& list, dmhash_t hash) {
    for (size_t i = 0; i < list.size(); i++)
        if (dmHashString64(list[i].name.c_str()) == hash) return &list[i].name;
    return 0;
}

static dmGameObject::PropertyResult SetProperty(const dmGameObject::ComponentSetPropertyParams& params) {
    Component* c = GetComponent((World*)params.m_World, (uint32_t)*params.m_UserData);
    const rigby::ModelData& d = Data(c);
    if (params.m_PropertyId == PROP_PLAYBACK_RATE) {
        if (params.m_Value.m_Type != dmGameObject::PROPERTY_TYPE_NUMBER) return dmGameObject::PROPERTY_RESULT_TYPE_MISMATCH;
        c->model->state.speed = params.m_Value.m_Number;
        return dmGameObject::PROPERTY_RESULT_OK;
    }
    if (params.m_PropertyId == PROP_SKIN) {
        if (params.m_Value.m_Type != dmGameObject::PROPERTY_TYPE_HASH) return dmGameObject::PROPERTY_RESULT_TYPE_MISMATCH;
        if (params.m_Value.m_Hash == dmHashString64("") || params.m_Value.m_Hash == dmHashString64("default")) {
            c->model->set_skin(d, "");
            return dmGameObject::PROPERTY_RESULT_OK;
        }
        const std::string* name = NameOf(d.sk.skins, params.m_Value.m_Hash);
        if (!name) return dmGameObject::PROPERTY_RESULT_UNSUPPORTED_VALUE;
        c->model->set_skin(d, *name);
        return dmGameObject::PROPERTY_RESULT_OK;
    }
    if (params.m_PropertyId == PROP_ANIMATION) {
        if (params.m_Value.m_Type != dmGameObject::PROPERTY_TYPE_HASH) return dmGameObject::PROPERTY_RESULT_TYPE_MISMATCH;
        const std::string* name = NameOf(d.sk.animations, params.m_Value.m_Hash);
        if (!name) return dmGameObject::PROPERTY_RESULT_UNSUPPORTED_VALUE;
        Play(c, 0, name->c_str(), true, 0, false, rigby::Opt<double>(), 0);
        return dmGameObject::PROPERTY_RESULT_OK;
    }
    return dmGameObject::PROPERTY_RESULT_NOT_FOUND;
}

static dmGameObject::Result TypeCreate(const dmGameObject::ComponentTypeCreateCtx* ctx, dmGameObject::ComponentType* type) {
    Context* c = new Context();
    c->factory = ctx->m_Factory;
    c->graphics_context = *(dmGraphics::HContext*)ctx->m_Contexts.Get(dmHashString64("graphics"));
    c->render_context = *(dmRender::HRenderContext*)ctx->m_Contexts.Get(dmHashString64("render"));
    c->max_count = (uint32_t)dmConfigFile::GetInt(ctx->m_Config, "rigby2d.max_count", 128);
    ComponentTypeSetPrio(type, 350);
    ComponentTypeSetContext(type, c);
    ComponentTypeSetHasUserData(type, true);
    ComponentTypeSetReadsTransforms(type, false);
    ComponentTypeSetNewWorldFn(type, NewWorld);
    ComponentTypeSetDeleteWorldFn(type, DeleteWorld);
    ComponentTypeSetCreateFn(type, Create);
    ComponentTypeSetDestroyFn(type, Destroy);
    ComponentTypeSetAddToUpdateFn(type, AddToUpdate);
    ComponentTypeSetLateUpdateFn(type, LateUpdate);
    ComponentTypeSetRenderFn(type, Render);
    ComponentTypeSetOnMessageFn(type, OnMessage);
    ComponentTypeSetGetPropertyFn(type, GetProperty);
    ComponentTypeSetSetPropertyFn(type, SetProperty);
    ComponentTypeSetGetFn(type, GetComponentFn);
    return dmGameObject::RESULT_OK;
}

static dmGameObject::Result TypeDestroy(const dmGameObject::ComponentTypeCreateCtx*, dmGameObject::ComponentType* type) {
    delete (Context*)ComponentTypeGetContext(type);
    return dmGameObject::RESULT_OK;
}

// ---- script API -----------------------------------------------------------------------------------

static Component* CheckComponent(lua_State* L) {
    Component* c = 0;
    dmMessage::URL receiver;
    dmScript::GetComponentFromLua(L, 1, MODEL_EXT, 0, (void**)&c, &receiver);
    return c;
}

static const char* CheckName(lua_State* L, int index, const std::string* (*lookup)(const rigby::SkeletonData&, dmhash_t), const rigby::SkeletonData& sk) {
    if (lua_type(L, index) == LUA_TSTRING) return lua_tostring(L, index);
    dmhash_t hash = dmScript::CheckHash(L, index);
    const std::string* name = lookup(sk, hash);
    return name ? name->c_str() : 0;
}

static const std::string* AnimationByHash(const rigby::SkeletonData& sk, dmhash_t h) { return NameOf(sk.animations, h); }
static const std::string* SkinByHash(const rigby::SkeletonData& sk, dmhash_t h) { return NameOf(sk.skins, h); }

static double OptField(lua_State* L, int table, const char* name, double fallback) {
    if (lua_isnoneornil(L, table)) return fallback;
    lua_getfield(L, table, name);
    double v = lua_isnil(L, -1) ? fallback : luaL_checknumber(L, -1);
    lua_pop(L, 1);
    return v;
}

static bool OptBool(lua_State* L, int table, const char* name, bool fallback) {
    if (lua_isnoneornil(L, table)) return fallback;
    lua_getfield(L, table, name);
    bool v = lua_isnil(L, -1) ? fallback : lua_toboolean(L, -1) != 0;
    lua_pop(L, 1);
    return v;
}

static int PlayOrQueue(lua_State* L, bool queue) {
    DM_LUA_STACK_CHECK(L, 1);
    Component* c = CheckComponent(L);
    const char* name = CheckName(L, 2, AnimationByHash, Data(c).sk);
    if (!lua_isnoneornil(L, 3)) luaL_checktype(L, 3, LUA_TTABLE);
    const bool loop = OptBool(L, 3, "loop", !queue);
    const double mix = OptField(L, 3, "mix", queue ? 0.2 : 0.0);
    const size_t track = (size_t)OptField(L, 3, "track", 0);
    rigby::Opt<double> delay;
    if (queue && !lua_isnoneornil(L, 3)) {
        lua_getfield(L, 3, "delay");
        if (!lua_isnil(L, -1)) delay = rigby::Opt<double>(luaL_checknumber(L, -1));
        lua_pop(L, 1);
    }
    dmScript::LuaCallbackInfo* cb = lua_isfunction(L, 4) ? dmScript::CreateCallback(L, 4) : 0;
    bool ok = name && Play(c, track, name, loop, mix, queue, delay, cb);
    if (!ok) dmLogWarning("rigby.%s: no animation %s", queue ? "queue" : "play", name ? name : "with that hash");
    lua_pushboolean(L, ok);
    return 1;
}

static int ScriptPlay(lua_State* L) { return PlayOrQueue(L, false); }
static int ScriptQueue(lua_State* L) { return PlayOrQueue(L, true); }

static int ScriptStop(lua_State* L) {
    DM_LUA_STACK_CHECK(L, 0);
    Component* c = CheckComponent(L);
    if (lua_isnoneornil(L, 2)) {
        c->model->state.stop();
        for (size_t i = 0; i < c->track_callbacks.size(); i++) SetTrackCallback(c, i, 0, 0);
    } else {
        size_t track = (size_t)luaL_checkinteger(L, 2);
        c->model->state.clear_track(track);
        if (track < c->track_callbacks.size()) SetTrackCallback(c, track, 0, 0);
    }
    return 0;
}

static int ScriptSetSkin(lua_State* L) {
    DM_LUA_STACK_CHECK(L, 1);
    Component* c = CheckComponent(L);
    const char* name = lua_isnoneornil(L, 2) ? "" : CheckName(L, 2, SkinByHash, Data(c).sk);
    bool ok = name && c->model->set_skin(Data(c), name);
    lua_pushboolean(L, ok);
    return 1;
}

static int ScriptSetTint(lua_State* L) {
    DM_LUA_STACK_CHECK(L, 0);
    Component* c = CheckComponent(L);
    Vector4* v = dmScript::CheckVector4(L, 2);
    c->model->tint[0] = v->getX();
    c->model->tint[1] = v->getY();
    c->model->tint[2] = v->getZ();
    c->model->tint[3] = v->getW();
    return 0;
}

static int ScriptBone(lua_State* L) {
    Component* c = CheckComponent(L);
    int b = Data(c).sk.find_bone(luaL_checkstring(L, 2));
    if (b < 0) return 0;
    const rigby::Affine& w = c->model->pose.world[(size_t)b];
    // Skeleton space, then the component's offset within the game object.
    const Matrix4 local = dmTransform::ToMatrix4(c->transform);
    const Vector4 p = local * Point3((float)w.tx, (float)w.ty, 0.0f);
    dmScript::PushVector3(L, Vector3(p.getX(), p.getY(), p.getZ()));
    lua_pushnumber(L, w.rotation());
    return 2;
}

static int ScriptOnEvent(lua_State* L) {
    DM_LUA_STACK_CHECK(L, 0);
    Component* c = CheckComponent(L);
    ReleaseCallback(c, c->listener);
    c->listener = lua_isfunction(L, 2) ? dmScript::CreateCallback(L, 2) : 0;
    return 0;
}

static const luaL_reg SCRIPT_FUNCTIONS[] = {
    {"play", ScriptPlay},
    {"queue", ScriptQueue},
    {"stop", ScriptStop},
    {"set_skin", ScriptSetSkin},
    {"set_tint", ScriptSetTint},
    {"bone", ScriptBone},
    {"on_event", ScriptOnEvent},
    {0, 0},
};

}  // namespace rigby_model

/// Adds the model functions to the `rigby` table on top of the stack.
void rigby_model_register(lua_State* L) {
    luaL_register(L, 0, rigby_model::SCRIPT_FUNCTIONS);
}

DM_DECLARE_RESOURCE_TYPE(ResourceTypeRigbySkel, "rigbyskelc", rigby_model::SkeletonRegister, 0);
DM_DECLARE_RESOURCE_TYPE(ResourceTypeRigbyModel, "rigbymodelc", rigby_model::ModelRegister, 0);
DM_DECLARE_COMPONENT_TYPE(ComponentTypeRigbyModel, "rigbymodelc", rigby_model::TypeCreate, rigby_model::TypeDestroy);
