# Rigby2D for Defold

Play Rigby2D animations in Defold 1.14 or newer. The `rigby2d` library is a native extension: the
Rigby2D runtime in C++ (`rigby2d/src`), a port of the Rust runtime that matches the JavaScript
runtime frame by frame (golden-tested in CI). It loads skeleton exports (binary `.skel` 4.3 or
skeleton `.json` 3.8 / 4.2 / 4.3) with their `.atlas`, and plays them: meshes and weights, IK,
transform, path, physics and slider constraints, skins, image sequences, clipping, draw order,
events, two-color tint and blend modes, with layered tracks, crossfades and queued animations,
and whole scenes (a stage, several characters, a camera and parallax).

Defold's build server compiles the extension for every platform (Windows, macOS, Linux, Android,
iOS, HTML5); nothing to install.

## Install

Add the library to *game.project ▸ Project ▸ Dependencies* and choose *Project ▸ Fetch Libraries*:

```
https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/rigby2d-defold.zip
```

(Pin a version with `releases/download/v<version>/rigby2d-defold.zip`.) Or copy the `rigby2d`
folder into your project.

`rigby2d-defold-demo-<version>.zip` on the [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases)
page is a ready-to-run project: Rigbytron slashes on Space or a click, NILA runs through her
animations, and Tab switches to a scene with both of them. Open its `game.project` in Defold and choose *Project ▸ Build*.

## Use

1. Export your skeleton from Rigby2D: *File ▸ Export ▸ Binary .skel + atlas (4.3)* (or *JSON + atlas*).
   Put the `.skel`/`.json`, the `.atlas` and its page images in a folder, say `/assets`, and add
   that folder to *game.project ▸ Project ▸ Custom Resources* (the runtime reads them at run time).
2. On the game object that shows the character, add a **Factory** with the id `rigby2d` and the
   prototype `/rigby2d/piece.go`, and a script:

```lua
local rigby2d = require("rigby2d.rigby2d")

function init(self)
	self.hero = rigby2d.new({ skeleton = "/assets/hero.skel", atlas = "/assets/hero.atlas", animation = "idle" })
	self.hero:on_event(function(event)
		if event.kind == "event" and event.name == "footstep" then
			-- play a sound, spawn dust...
		end
	end)
end

function update(self, dt)
	self.hero:update(dt)
end

function final(self)
	self.hero:delete()
end
```

Skeleton units are pixels, Y up as in Defold; move, rotate and scale the game object to place the
character. The character draws with the `tile` predicate (like sprites), sorted by the game
object's z.

### Player

| Call | |
| --- | --- |
| `rigby2d.new(options)` | `skeleton`, `atlas` (paths, required), `animation` (loops on track 0), `loop`, `skin`, `speed`, `factory` (url, default `#rigby2d`). Loaded files are shared between players. |
| `player:play(name, loop, mix)` | Plays on track 0, crossfading over `mix` seconds. |
| `player:set_animation(track, name, loop, mix)` | Starts an animation on a track now. Returns its entry id, or nil. |
| `player:add_animation(track, name, loop, mix, delay)` | Queues it after the current one: when that ends, or `delay` seconds after it starts. |
| `player:clear_track(track)`, `player:stop()` | Stops a track, or all of them. |
| `player:current(track)` | Name and time of the animation on a track. |
| `player:set_track_alpha(track, alpha)` | Influence of a layered track (tracks above 0 mix over the ones below). |
| `player:set_track_time_scale(track, scale)`, `player:set_speed(speed)` | Playback speed of a track, or of everything. |
| `player:set_skin(name)` | Shows a skin (`nil` or `"default"`: the default skin). |
| `player:set_tint(r, g, b, a)` | Multiplies every color. |
| `player:on_event(fn)` | `fn(event)` for each playback event: `kind` is `"start"`, `"end"`, `"complete"` or `"event"`; `track`, `animation` and `entry` are always set; event keys add `name`, `time`, `int`, `float`, `string`, `audio`, `volume`, `balance`. `update(dt)` also returns the frame's events. |
| `player:bone(name)` | A bone's `x, y, rotation, scale_x, scale_y` in the game object's space, to attach things to it. |
| `player:set_bone(name, x, y)` | Moves a bone for this frame (aiming, dragging): `update(dt, true)`, then `set_bone`, then `draw()`. |
| `player:animations()`, `skins()`, `bones()`, `events()`, `duration(name)` | What the skeleton has. |
| `player:delete()` | Removes the pieces and releases resources. |

### Scenes

`rigby2d.new_scene(options)` plays a scene exported with *File ▸ Export ▸ Scene for runtimes*: the
stage with its backgrounds, parallax and camera, and every character with its clips, drawn in the
stage's order. Keep the `.scene.json` and the skeletons, atlases and pages it lists in one folder
under *Custom Resources*; the game object needs the same `rigby2d` factory.

```lua
self.scene = rigby2d.new_scene({ scene = "/assets/intro/intro.scene.json", shot = "meet", loop = true })
self.scene:on_finished(function(shot) print(shot .. " finished") end)
-- every frame:
self.scene:update(dt)
local x, y, _, zoom = self.scene:camera() -- the stage's camera bone: follow it
```

| Call | |
| --- | --- |
| `scene:play(shot, loop)` | Plays a shot (a stage animation) from its start. |
| `scene:update(dt)`, `scene:seek(seconds)` | Advances or jumps; physics starts again from a seek. |
| `scene:on_finished(fn)` | `fn(shot)` when the shot ends (each time round when looping). |
| `scene:current()` | Shot name, seconds into it, and its length. |
| `scene:camera()`, `scene:stage_bone(name)`, `scene:actor_bone(actor, bone)` | Bones in the game object's space, to follow the camera or attach things to characters. |
| `scene:shots()`, `scene:actors()` | What the scene has. |
| `scene:delete()` | Removes the pieces and releases the page textures. |

The demo plays the scene from the editor's demo (NILA and Rigbytron on a moonlit stage); press
<kbd>Tab</kbd> to switch to it.

### Native module

`rigby2d.lua` is built on the native `rigby` module, usable on its own: `rigby.load(skeleton_bytes,
atlas_text)` returns skeleton data (`:animations()`, `:pages()`...), `rigby.new(data)` a skeleton
with `:set_animation`, `:update(dt)`, `:bone`, and `:build()` / `:piece(i)` / `:write(i, buffer)`
to write the geometry into a vertex buffer; `rigby.load_scene(manifest, reader)` a scene with the same
drawing calls (streams `position` 3, `texcoord0` 2, `color` 4, `dark`
4, float32).

## How it draws

Each frame the C++ runtime poses the skeleton and writes its triangles straight into the vertex
buffers of a few mesh components ("pieces", one per run of slots on the same atlas page), with
no work per vertex in Lua and no allocation once the buffers have grown to fit. The
`rigby2d/materials/rigby2d.material` shader does two-color tint, straight or premultiplied
pages, and the slot blend modes. Defold's default render script blends the world with
`SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, so normal blending is exact while additive and screen slots
add their color with its brightest channel as coverage (exact over dark backgrounds) and
multiply darkens by the color's grey level.

NILA (39 bones, 890 mesh vertices, hair physics) takes about 12 µs a frame to pose and 24 µs to
build its geometry on one desktop core (`test/bench.cpp`).

## Tests

`test/golden.cpp` replays the golden files of the Rust runtime (the JavaScript runtime's output:
bone matrices, drawables, draw order and events, frame by frame) against the C++ runtime:

```bash
g++ -std=c++17 -O2 -I runtimes/defold/rigby2d/src runtimes/defold/test/golden.cpp runtimes/defold/rigby2d/src/rigby_*.cpp -o golden
./golden .
```

NILA, Rigbytron and the Rigby2D name and logo are trademarks of the Rigby2D project: use the demo
characters to try the runtime, not in your own products. The code is MIT OR Apache-2.0.
