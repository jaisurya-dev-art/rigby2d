# Runtimes

Rigby2D animations play in games and apps through the included runtimes. All of them load skeleton
`.json` (3.8, 4.2, 4.3) or binary `.skel` (4.3) with an `.atlas`, and evaluate meshes, weights, skins,
image sequences, clipping, IK, transform, path, physics and slider constraints, draw order, events and
layered tracks with crossfades. They also play [scenes](scenes.md#in-games-and-apps): several
characters on a stage with a moving camera and parallax.

| Runtime | Language | Status |
| --- | --- | --- |
| [JavaScript](#javascript) (`src/core`) + WebGL renderer (`src/webgl`) | JavaScript, no dependencies | Complete |
| [Rust](#rust) (`runtimes/rust/rigby-runtime`) | Rust, no dependencies; 3 to 4× faster | Complete |
| [Godot](#godot) (`RigbySkeleton2D`, `RigbyScene2D`) | GDExtension on the Rust core | Preview |
| Unity | On the Rust core | Planned |

The landing page of the [website](https://jaisurya-dev-art.github.io/rigby2d/) plays NILA with the
JavaScript runtime.

## JavaScript

Copy `src/core/` into your project (and `src/webgl/` for a ready-made renderer):

```js
import { AnimationState, Pose, parseAtlas, readSkeletonJson } from './core/index.js';
import { WebGLRenderer } from './webgl/renderer.js';

const { skeleton } = readSkeletonJson(JSON.parse(jsonText), 'hero'); // hero.json
const pose = new Pose(skeleton);
const state = new AnimationState();
state.play(skeleton, 'walk', true, 0.2);              // track 0, 0.2 s crossfade
state.setAnimation(skeleton, 1, 'shoot', false, 0.1); // track 1 layers on top
state.addAnimation(skeleton, 0, 'idle', true, 0.3);   // queued after walk

const renderer = new WebGLRenderer(gl);
const textures = renderer.atlasTextures(parseAtlas(atlasText), { 'hero.png': pageImage });

function frame(dt) {
  state.update(skeleton, dt);
  state.apply(skeleton, pose);
  renderer.begin(canvas.width, canvas.height, { x: 0, y: 200, zoom: 1 });
  renderer.drawSkeleton(skeleton, pose, textures);
  renderer.end();
}
```

For `.skel` files use `readSkeletonJson(readSkeletonBinary(bytes), 'hero')`. With another renderer,
draw `pose.quads(skeleton)`: world-space positions (Y up), UVs, tint and blend mode per region and
mesh. `examples/webgl.html` is a small player (`npm run web:dev`, then open `/examples/webgl.html`).

### Events

```js
state.addListener({
  start: (entry) => {},
  complete: (entry) => {},
  event: (entry, e) => playSound(e.audio ?? e.name, e.volume), // { name, time, int, float, string, audio, volume, balance }
});
```

Physics simulates while `AnimationState` updates; `pose.resetPhysics()` starts it over.

## Rust

```rust
use rigby_runtime::{load_skeleton, Atlas, AnimationState, Pose, RegionLookup, RenderOutput};

let data = load_skeleton(&std::fs::read("hero.skel")?)?;
let atlas = Atlas::parse(&std::fs::read_to_string("hero.atlas")?);
let lookup = RegionLookup::new(&data, &atlas);
let (mut pose, mut state, mut out) = (Pose::new(&data), AnimationState::new(), RenderOutput::default());
state.play(&data, "walk", true, 0.2);

// Every frame:
state.update(&data, dt);
state.apply(&data, &mut pose);
out.build(&data, &pose, &lookup, [1.0; 4]);
for batch in out.batches() { /* positions, UVs, colors, indices for atlas page `batch.page` */ }
```

Scenes: `rigby_runtime::scene::load_scene(&manifest, |file| std::fs::read(dir.join(file)))` returns a
`ScenePlayer` (`play`, `update`, `draw_list`).

It matches the JavaScript runtime frame by frame (golden tests, including a scene). Build and test with
`cargo test --release --workspace` in `runtimes/rust`. See the
[runtimes README](../runtimes/README.md).

## Godot

The `RigbySkeleton2D` node for Godot 4.3+ (preview; prebuilt for Windows x64, build from source
elsewhere). Install the `rigby2d-godot-addon` zip from the
[Releases](https://github.com/jaisurya-dev-art/rigby2d/releases) into your project, add the node, and
set *Skeleton File*, *Atlas File* and *Animation*.

```gdscript
@onready var hero: RigbySkeleton2D = $Hero

func _ready() -> void:
	hero.animation_event.connect(_on_event)
	hero.play("walk", true, 0.2)
	hero.queue(0, "idle", true, 0.3, -1.0)
```

For scenes, the `RigbyScene2D` node plays a `.scene.json` export: the stage, every character
and their clips, with the stage's camera available for a `Camera2D`. See the
[Godot guide](../runtimes/godot/addons/rigby2d/README.md) for every property and method.

## Performance

One character, one frame (apply, constraints, world transforms and vertices), median of 2,000 frames:

| Rig | JavaScript | Rust |
| --- | ---: | ---: |
| 67 bones, 276 mesh vertices | 50 µs | 14.5 µs |
| 76 bones, 667 weighted vertices, 9 IK | 71 µs | 22 µs |
| 143 bones, 879 vertices, 21 transform/path constraints | 90 µs | 22 µs |
