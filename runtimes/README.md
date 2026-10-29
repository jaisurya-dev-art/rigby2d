# Rigby2D native runtimes

Engine runtimes for Rigby2D animations, built on one Rust core.

| Folder | What it is | Status |
| --- | --- | --- |
| [`rust/rigby-runtime`](rust/rigby-runtime) | The runtime in Rust: loads skeleton `.json` (3.8, 4.2, 4.3) and binary `.skel` (4.3) with `.atlas`, evaluates poses, constraints and playback, plays scenes (`.scene.json`), and builds textured, clipped draw batches. No dependencies. | Complete |
| [`rust/rigby-godot`](rust/rigby-godot) | Godot 4.3+ GDExtension: the `RigbySkeleton2D` and `RigbyScene2D` nodes. | Preview: Windows x64 download on [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases); build from source elsewhere |
| [`godot`](godot) | Godot addon (`addons/rigby2d`, with [user guide](godot/addons/rigby2d/README.md)), demo scene and tests. | Preview |
| [`unity/com.hoverlabs.rigby2d`](unity/com.hoverlabs.rigby2d) | Unity 2021.3+ package ([guide](unity/com.hoverlabs.rigby2d/README.md)): `RigbySkeleton`, `RigbyScene`, `RigbyBoneFollower`, importers and a shader. A C# port of the core (`Rigby2D.Core`, no Unity dependency), golden-tested like the Rust one; multi-core and garbage-free. | Complete |

## The Rust core

`rigby-runtime` is a port of the JavaScript runtime in `src/core` with the same behaviour: bones
with every inherit mode, region and mesh attachments with weights and deform keys, linked meshes,
IK (one and two bones, softness, stretch), transform, path, physics and slider constraints, skins,
image sequences, clipping, draw order keys, two-color tint, events, `AnimationState` with
layered tracks, crossfades and queues, and scenes (`scene::ScenePlayer`: actors placed on stage
bones, clips with crossfades, ground offsets, flips, camera parallax and the stage's draw order).

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
for event in state.drain_events() { /* starts, ends, completions, event keys */ }
out.build(&data, &pose, &lookup, [1.0; 4]);
for batch in out.batches() { /* positions, UVs, colors, dark colors, indices for atlas page `batch.page` */ }
```

### Correctness

The Rust runtime must match the JavaScript runtime frame by frame. `tests/golden/generate.mjs`
plays a skeleton with the JavaScript runtime through fixed scenarios (every animation looping, a
crossfade with a layered track and a queued animation, skins) and records bone world matrices,
drawables, draw order and events; `tests/golden.rs` replays them in Rust and compares.

- `tests/golden/rigbytron.golden.json` (checked in) covers the Rigbytron demo.
- `tests/golden/scene.golden.json`, made by `tests/golden/scene.mjs`, plays the demo scene
  (`runtimes/godot/demo/scene`: NILA with hair physics and Rigbytron on a parallax stage) with the
  JavaScript `ScenePlayer` and records the stage, every character and the draw list per frame;
  Rust matches within 1e-11.
- Any other skeleton can be checked locally:

  ```bash
  node rigby-runtime/tests/golden/generate.mjs /tmp/golden/hero.golden.json path/to/hero.skel
  RIGBY_GOLDEN_DIR=/tmp/golden cargo test --release -p rigby-runtime --test golden
  ```

  On 16 sample rigs exported as both `.json` and `.skel` (about 3,500 frames, including physics,
  path, transform and slider constraints, meshes, skins, clipping and sequences) every value
  matches within a relative error of 1e-10.

### Performance

Animating one character for one frame: apply the animation, solve constraints, compute world
transforms and vertices (`cargo run --release --example bench -- <skeleton>`, median of 2,000
frames of the *walk* animation), against the JavaScript runtime on the same machine. The rigs are
the ones of the main README's benchmark:

| Rig | JavaScript | Rust | Speed-up |
| --- | ---: | ---: | ---: |
| M: 67 bones, 276 mesh vertices | 50 µs | 14.5 µs | 3.4× |
| L: 76 bones, 667 weighted mesh vertices, 9 IK constraints | 71 µs | 22 µs | 3.2× |
| XL: 143 bones, 879 mesh vertices, 21 transform and path constraints | 90 µs | 22 µs | 4.1× |

## Building and testing

Needs [Rust](https://rustup.rs) (stable) and, for the Godot tests, Godot 4.3 or newer.

```bash
cd runtimes/rust
cargo test --release --workspace          # unit and golden tests
cargo build --release -p rigby-godot      # the Godot library

# Godot: copy the library into the addon, import the project, run the tests headless.
cp target/release/rigby_godot.dll ../godot/addons/rigby2d/bin/   # .so / .dylib elsewhere
godot --headless --path ../godot --import
godot --headless --path ../godot --script res://tests/test_runtime.gd
```

`runtimes/godot/tests/test_runtime.gd` checks the node against reference results from the
JavaScript runtime (`tests/expected.json`, made by `tests/make_expected.mjs`): bone transforms at
several frames of an animation, event and completion timing, tracks, queues, the demo scene's
camera and character bones through a whole shot, and error handling. `tests/capture.gd` and
`tests/capture_scene.gd` render the demos at fixed times into `tests/output/` (run them without
`--headless`).

### Packaging

`node runtimes/godot/package.mjs windows-x64` (or `linux-x64`, `macos`, after building the library
on that platform) writes the download zips to `runtimes/godot/dist/`: the addon alone, and the demo
project with the addon. Test a package by extracting the demo, copying `tests/` into it and running
the headless tests there.
