# Runtimes

Rigby2D animations play in games and apps through the included runtimes. All of them load skeleton
`.json` (3.8, 4.2, 4.3) or binary `.skel` (4.3) with an `.atlas`, and evaluate meshes, weights, skins,
image sequences, clipping, IK, transform, path, physics and slider constraints, draw order, events and
layered tracks with crossfades. They also play [scenes](scenes.md#in-games-and-apps): several
characters on a stage with a moving camera and parallax.

<div class="cards engines">
<a href="#godot" data-mark="godot"><strong>Godot <span class="status preview">Preview</span></strong><code>RigbySkeleton2D</code> and <code>RigbyScene2D</code> nodes, a GDExtension on the Rust core. <small>Godot 4.3+ · Windows, macOS, Linux</small></a>
<a href="#unity" data-mark="unity"><strong>Unity <span class="status">Complete</span></strong><code>RigbySkeleton</code> and <code>RigbyScene</code> components in C#, multi-core, no garbage. <small>Unity 2021.3+ and Unity 6 · every platform</small></a>
<a href="#phaser" data-mark="phaser"><strong>Phaser <span class="status">Complete</span></strong>A plugin: <code>this.add.rigby()</code>, on the JavaScript runtime. <small>Phaser 3.60+ · WebGL</small></a>
<a href="#javascript" data-mark="javascript"><strong>JavaScript <span class="status">Complete</span></strong>No dependencies, with a ready-made WebGL renderer. <small><code>src/core</code> · <code>src/webgl</code></small></a>
<a href="#rust" data-mark="rust"><strong>Rust <span class="status">Complete</span></strong>No dependencies; matches the JavaScript runtime frame by frame, 3 to 4× faster. <small><code>runtimes/rust/rigby-runtime</code></small></a>
</div>

The landing page of the [website](https://rigby2d.com/) plays NILA with the
JavaScript runtime.

**From the editor:** *File ▸ Get runtimes…* downloads the runtimes that match your editor's version:
the Unity package (or its git URL), the Godot addon for your system (or installs it straight into a
Godot project), and the Phaser bundles. The welcome screen also offers a **Phaser game starter**: a
small playable game with NILA to build on.

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

## Phaser

A plugin for [Phaser](https://phaser.io) 3.60 or newer (WebGL). Download `rigby2d-phaser-<version>.mjs`
or the script-tag `rigby2d-phaser-<version>.js` from the
[latest release](https://github.com/jaisurya-dev-art/rigby2d/releases/latest):

```js
import { rigbyPhaser } from './rigby2d-phaser-0.4.0.mjs';
const { RigbyPlugin } = rigbyPhaser(Phaser);
// game config: plugins: { scene: [{ key: 'RigbyPlugin', plugin: RigbyPlugin, mapping: 'rigby' }] }

// in a scene:
preload() { this.load.rigby('hero', 'assets/hero.skel', 'assets/hero.atlas'); }
create() {
  const hero = this.add.rigby(400, 500, 'hero', 'idle');
  hero.play('run', true, 0.2);                       // crossfade over 0.2 s
  hero.on('event', (entry, e) => console.log(e.name));
}
```

A `RigbySkeleton` is an ordinary Phaser game object (position, scale, rotation, alpha, depth, flips,
input) with the full animation state: tracks, crossfades, queues, skins, events and bone positions
for attaching objects. It plays exactly as the editor does. See the
[Phaser guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/phaser/README.md).

## Unity

The `com.rigby2d.unity` package for Unity 2021.3 or newer (Unity 6 included), Built-in or
Universal render pipeline. In Unity: *Window ▸ Package Manager ▸ + ▸ Install package from git URL…*

```
https://github.com/jaisurya-dev-art/rigby2d.git?path=/runtimes/unity/com.rigby2d.unity
```

Drop an export (`.skel` or `.json`, `.atlas` and its `.png`) into `Assets`: the `.atlas` becomes a
skeleton asset. Drag it into the scene, pick an animation, and it plays (in the editor too). Scenes
exported with *File ▸ Export ▸ Scene for runtimes* import the same way and play with the `RigbyScene`
component, which can drive a camera.

```csharp
var hero = GetComponent<RigbySkeleton>();
hero.Play("walk", loop: true, mix: 0.2f);
hero.AddAnimation(0, "idle", loop: true, mix: 0.3f);
hero.AnimationEvent += (s, e) => { if (e.Name == "footstep") step.Play(); };
gun.position = hero.GetBoneWorldPosition("gun-tip");
```

- **Every core, no garbage**: playing skeletons pose and build their meshes in parallel, and steady
  playback allocates nothing. 200 NILAs (39 bones, 1,002 skinned vertices each) take 5.0 ms a frame
  in an IL2CPP player on a 4-core laptop, upload included: 25 µs a character.
- **Tested** in Unity 6.3 (Built-in and Universal render pipelines) and 2022.3, in IL2CPP and Mono
  players.
- **Clean edges in Gamma and Linear color space**: the shader handles straight or premultiplied
  atlases itself, with two-color tint and every blend mode.
- **The same animation as the editor**: the C# runtime is tested frame by frame against the
  JavaScript runtime, like the Rust one.

See the [Unity guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/unity/com.rigby2d.unity/README.md) for every component, property and event.

## Godot

The `RigbySkeleton2D` node for Godot 4.3+ (preview; prebuilt for Windows x64, macOS and Linux x64).
Install the `rigby2d-godot-addon` zip for your system from the
[Releases](https://github.com/jaisurya-dev-art/rigby2d/releases), or with *File ▸ Get runtimes…* in
the editor, into your project, add the node, and set *Skeleton File*, *Atlas File* and *Animation*.

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
