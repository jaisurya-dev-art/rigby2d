// SPDX-License-Identifier: MIT OR Apache-2.0
// A small Rigby2D player for SDL3: plays an export's animations in a window.
//
//   rigby2d_sdl_player <skeleton .skel or .json> <atlas> [animation]
//
// Space: next animation. Left/right: turn around. 1-9: skins. Escape: quit.

#include "rigby_sdl.h"

#include <cstdio>

int main(int argc, char** argv) {
    if (argc < 3) {
        std::printf("usage: %s <skeleton .skel|.json> <atlas> [animation]\n", argv[0]);
        return 1;
    }
    if (!SDL_Init(SDL_INIT_VIDEO)) {
        SDL_Log("SDL_Init: %s", SDL_GetError());
        return 1;
    }
    SDL_Window* window = nullptr;
    SDL_Renderer* renderer = nullptr;
    if (!SDL_CreateWindowAndRenderer("Rigby2D for SDL3", 1280, 720, SDL_WINDOW_RESIZABLE, &window, &renderer)) {
        SDL_Log("window: %s", SDL_GetError());
        return 1;
    }
    SDL_SetRenderVSync(renderer, 1);

    rigby::sdl::Skeleton skeleton;
    std::string err;
    if (!skeleton.load(renderer, argv[1], argv[2], err)) {
        SDL_Log("%s", err.c_str());
        return 1;
    }
    rigby::sdl::Character character(skeleton);
    const auto& anims = skeleton.data.animations;
    size_t current = 0;
    if (argc > 3) {
        int found = skeleton.data.find_animation(argv[3]);
        if (found >= 0) current = (size_t)found;
    }
    if (!anims.empty()) character.state.set_animation(skeleton.data, 0, anims[current].name, true, 0.0);

    bool facing_left = false;
    bool running = true;
    Uint64 last = SDL_GetTicksNS();
    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_EVENT_QUIT) running = false;
            if (e.type != SDL_EVENT_KEY_DOWN) continue;
            SDL_Keycode key = e.key.key;
            if (key == SDLK_ESCAPE) running = false;
            if (key == SDLK_SPACE && !anims.empty()) {
                current = (current + 1) % anims.size();
                character.state.set_animation(skeleton.data, 0, anims[current].name, true, 0.2);
                SDL_Log("animation: %s", anims[current].name.c_str());
            }
            if (key == SDLK_LEFT) facing_left = true;
            if (key == SDLK_RIGHT) facing_left = false;
            if (key >= SDLK_1 && key <= SDLK_9) {
                size_t skin = (size_t)(key - SDLK_1);
                if (skin < skeleton.data.skins.size()) character.set_skin(skeleton.data.skins[skin].name);
            }
        }
        Uint64 now = SDL_GetTicksNS();
        double dt = (double)(now - last) / 1e9;
        last = now;
        character.update(dt);

        int w = 0, h = 0;
        SDL_GetRenderOutputSize(renderer, &w, &h);
        SDL_SetRenderDrawColor(renderer, 24, 26, 32, 255);
        SDL_RenderClear(renderer);
        // The character stands on a line 85% down the window, about half the window tall.
        character.draw(renderer, rigby::sdl::View(w * 0.5f, h * 0.85f, h / 1400.0f, facing_left));
        SDL_RenderPresent(renderer);
    }
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
