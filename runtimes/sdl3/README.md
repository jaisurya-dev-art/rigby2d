# Rigby2D for SDL3

Plays Rigby2D animations in C++ games built on [SDL3](https://libsdl.org)'s 2D renderer. It loads the
editor's skeleton exports (binary `.skel` or skeleton JSON, with their `.atlas`) and draws them with
`SDL_RenderGeometry`, so it works with every SDL3 renderer: Direct3D, Metal, Vulkan, OpenGL and the
GPU renderer.

The animation runtime underneath is the C++ one the Defold runtime uses
([`runtimes/defold/rigby2d`](../defold/rigby2d)). It is tested against the editor frame by frame in
CI, so a character moves the same here as in Rigby2D, Godot, Unity or Defold: meshes, weights, skins,
IK, transform, path, physics and slider constraints, image sequences, clipping, events and tracks
with crossfades.

## Build

You need CMake 3.16+, a C++17 compiler and SDL3 (3.2 or newer). SDL 3.4 loads the PNG atlas pages
itself. On SDL 3.2, add SDL3_image (found automatically) or pass your own texture loader.

```sh
cmake -S . -B build -DCMAKE_PREFIX_PATH=/path/to/SDL3
cmake --build build
./build/rigby2d_sdl_player nila.skel nila.atlas idle
```

Without CMake, with g++ and SDL3's MinGW development package:

```sh
g++ -std=c++17 -O2 -I SDL3/include -I include -I core/include example/main.cpp src/rigby_sdl.cpp core/commonsrc/rigby_*.cpp -L SDL3/lib -lSDL3 -o player
```

In your own CMake project:

```cmake
add_subdirectory(rigby2d-sdl3)
target_link_libraries(my_game PRIVATE rigby2d_sdl)
```

## Use

```cpp
#include "rigby_sdl.h"

rigby::sdl::Skeleton nila;                      // shared by every NILA on screen
std::string err;
if (!nila.load(renderer, "nila.skel", "nila.atlas", err)) SDL_Log("%s", err.c_str());

rigby::sdl::Character c(nila);                  // one character: its own pose and animations
c.state.set_animation(nila.data, 0, "idle", true, 0.0);
c.state.add_animation(nila.data, 1, "blink", true, 0.0, rigby::Opt<double>());

// every frame
c.update(dt);                                   // seconds since the last frame
c.draw(renderer, rigby::sdl::View(640, 600, 0.5f));   // origin on screen, pixels per unit
```

- `View(x, y, scale, flip_x)` places the skeleton's origin on screen; `flip_x` turns it around.
- `c.tint` multiplies every colour (fades, flashes); `c.set_skin("winter")` changes outfits.
- `c.events()` returns what happened since the last call: animation starts and completes, and the
  events you keyed in the editor (footsteps, sounds).
- `c.state` is the full animation state: tracks, crossfades, queues, speed. `c.pose` gives bone
  world transforms (to attach a weapon to a hand, say).
- Your own image loading: `nila.load(renderer, skel, atlas, err, [](SDL_Renderer* r, const std::string& path) { ... return texture; })`.

## Limits

- Two-colour tint (a slot's dark colour) is not drawn: `SDL_RenderGeometry` takes one colour per
  vertex.
- Screen blending uses a custom SDL blend mode. Every GPU renderer supports it; SDL's software
  renderer falls back to additive.

## Example

`example/main.cpp` is a small player: it opens a window and plays an export. Space switches
animations, the arrow keys turn the character around, and 1 to 9 switch skins.
