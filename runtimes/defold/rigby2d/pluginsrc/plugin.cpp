// SPDX-License-Identifier: MIT OR Apache-2.0
// The Rigby2D editor plugin library: plain C functions the Defold editor calls through JNA
// (com.rigby2d.defold.Rigby2DPlugin) to play a model in the scene view. It runs the same runtime and
// geometry code as the engine component (commonsrc), so the preview matches the game.

#include <dmsdk/sdk.h>
#include <dmsdk/ddf/ddf.h>
#include <gamesys/texture_set_ddf.h>

#include <stdarg.h>
#include <stdio.h>
#include <string>
#include <vector>

#include <rigby_defold.h>

namespace {

char g_error[1024] = {0};

void set_error(const char* format, ...) {
    va_list args;
    va_start(args, format);
    vsnprintf(g_error, sizeof(g_error), format, args);
    va_end(args);
}

struct Model {
    rigby::ModelData data;
    rigby::ModelInstance* instance;
    std::vector<rigby::ModelVertex> vertices;
    float bounds[4];
    Model() : instance(0) {
        bounds[0] = bounds[1] = bounds[2] = bounds[3] = 0;
    }
    ~Model() { delete instance; }
};

}  // namespace

extern "C" DM_DLLEXPORT const char* RIGBY_GetLastError() {
    return g_error;
}

extern "C" DM_DLLEXPORT void* RIGBY_Load(const void* skeleton, int skeleton_size, const void* texture_set, int texture_set_size) {
    g_error[0] = 0;
    dmGameSystemDDF::TextureSet* ts = 0;
    if (texture_set && texture_set_size > 0) {
        if (dmDDF::LoadMessage(texture_set, (uint32_t)texture_set_size, &ts) != dmDDF::RESULT_OK) {
            set_error("could not read the atlas");
            return 0;
        }
    }
    Model* m = new Model();
    std::string err;
    bool ok = rigby::load_model_data((const uint8_t*)skeleton, (size_t)skeleton_size, ts, m->data, err);
    if (ts) dmDDF::FreeMessage(ts);
    if (!ok) {
        set_error("%s", err.c_str());
        delete m;
        return 0;
    }
    m->instance = new rigby::ModelInstance(m->data.sk);
    return m;
}

extern "C" DM_DLLEXPORT void RIGBY_Destroy(void* model) {
    delete (Model*)model;
}

extern "C" DM_DLLEXPORT int RIGBY_GetAnimationCount(void* model) {
    return model ? (int)((Model*)model)->data.sk.animations.size() : 0;
}

extern "C" DM_DLLEXPORT const char* RIGBY_GetAnimationName(void* model, int index) {
    Model* m = (Model*)model;
    if (!m || index < 0 || (size_t)index >= m->data.sk.animations.size()) return "";
    return m->data.sk.animations[(size_t)index].name.c_str();
}

extern "C" DM_DLLEXPORT int RIGBY_GetSkinCount(void* model) {
    return model ? (int)((Model*)model)->data.sk.skins.size() : 0;
}

extern "C" DM_DLLEXPORT const char* RIGBY_GetSkinName(void* model, int index) {
    Model* m = (Model*)model;
    if (!m || index < 0 || (size_t)index >= m->data.sk.skins.size()) return "";
    return m->data.sk.skins[(size_t)index].name.c_str();
}

extern "C" DM_DLLEXPORT int RIGBY_GetMissingCount(void* model) {
    return model ? (int)((Model*)model)->data.missing.size() : 0;
}

extern "C" DM_DLLEXPORT const char* RIGBY_GetMissingName(void* model, int index) {
    Model* m = (Model*)model;
    if (!m || index < 0 || (size_t)index >= m->data.missing.size()) return "";
    return m->data.missing[(size_t)index].c_str();
}

extern "C" DM_DLLEXPORT int RIGBY_SetAnimation(void* model, const char* animation, int loop) {
    Model* m = (Model*)model;
    if (!m) return 0;
    m->instance->state.stop();
    m->instance->pose.set_to_setup(m->data.sk);
    m->instance->pose.reset_physics();
    if (!animation || !*animation) {
        m->instance->update(m->data, 0);
        return 1;
    }
    bool ok = m->instance->state.set_animation(m->data.sk, 0, animation, loop != 0, 0).has;
    m->instance->update(m->data, 0);
    m->instance->state.drain_events();
    return ok ? 1 : 0;
}

extern "C" DM_DLLEXPORT int RIGBY_SetSkin(void* model, const char* skin) {
    Model* m = (Model*)model;
    if (!m) return 0;
    return m->instance->set_skin(m->data, skin ? skin : "") ? 1 : 0;
}

extern "C" DM_DLLEXPORT void RIGBY_Update(void* model, float dt) {
    Model* m = (Model*)model;
    if (!m) return;
    m->instance->update(m->data, dt);
    m->instance->state.drain_events();
}

extern "C" DM_DLLEXPORT int RIGBY_BuildVertices(void* model) {
    Model* m = (Model*)model;
    if (!m) return 0;
    m->vertices.clear();
    float b[4] = {1e30f, 1e30f, -1e30f, -1e30f};
    m->instance->write(m->data, 0, m->vertices, b);
    if (b[0] <= b[2]) {
        for (int k = 0; k < 4; k++) m->bounds[k] = b[k];
    } else {
        m->bounds[0] = m->bounds[1] = m->bounds[2] = m->bounds[3] = 0;
    }
    return (int)m->vertices.size();
}

extern "C" DM_DLLEXPORT const void* RIGBY_GetVertices(void* model) {
    Model* m = (Model*)model;
    return m && !m->vertices.empty() ? (const void*)m->vertices.data() : 0;
}

extern "C" DM_DLLEXPORT void RIGBY_GetBounds(void* model, float* out) {
    Model* m = (Model*)model;
    for (int k = 0; k < 4; k++) out[k] = m ? m->bounds[k] : 0;
}
