---
name: rigby2d-pixi-js
description: Use when playing Rigby2D skeletal animations in a PixiJS 8 project with @rigby2d/pixi-js — installing the package, creating the runtime with rigbyPixi(PIXI), loading a .skel/.json and .atlas with loadRigby/parseRigby, adding a RigbySkeleton to the stage, playing/queueing animations on tracks, switching skins, listening to events, attaching display objects to bones, saving and restoring track state, driving updates manually, or using the WebAssembly core. Not for the Rigby2D editor itself or other engines (Phaser, Unity, Godot, Defold, Ren'Py).
---

# Rigby2D for PixiJS

`@rigby2d/pixi-js` plays skeletons exported from the Rigby2D editor in **PixiJS 8** (WebGL and
WebGPU). A `RigbySkeleton` is an ordinary PixiJS `Container`: its attachments are PixiJS meshes that
go through PixiJS's batcher, so a character is usually one batched mesh. Filters, masks, tint, alpha,
blend modes, `getBounds()`, pointer events, render groups and render textures work as for any display
object. Animation runs in JavaScript and matches the editor: meshes, skins, IK, transform, path,
physics and slider constraints, clipping, draw order, two-color tint, events, layered tracks,
crossfades and queues.

Docs: [runtimes guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/pixi/README.md)
and [rigby2d.com/docs/runtimes.html#pixijs](https://rigby2d.com/docs/runtimes.html#pixijs).

## Installation

```sh
npm install pixi.js @rigby2d/pixi-js
```

`pixi.js` (^8) is a **peer dependency**: the app installs and controls it. Only PixiJS 8 is
supported (`Mesh`, `MeshGeometry`, the v8 shader system); the Canvas renderer is not.

## Basic use

Export the character from Rigby2D (*File ▸ Export*): the `.skel` (binary) or `.json`, the `.atlas`
and its `.png` pages, all in one folder.

```ts
import * as PIXI from "pixi.js";
import { rigbyPixi, type RigbySkeleton } from "@rigby2d/pixi-js";

const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI);

const app = new PIXI.Application();
await app.init({ width: 960, height: 600, preference: "webgl" }); // or "webgpu"
document.body.appendChild(app.canvas);

const data = await loadRigby("assets/hero.skel", "assets/hero.atlas"); // pages load from the atlas's folder
const hero: RigbySkeleton = new RigbySkeleton(data, { animation: "idle" });
hero.position.set(400, 550); // the skeleton's origin (usually between the feet)
hero.scale.set(0.5);
app.stage.addChild(hero);
```

### Critical: `rigbyPixi(PIXI)` takes your PixiJS

The package never imports `pixi.js`. You call `rigbyPixi(PIXI)` with the **same PixiJS instance the
game renders with** and it returns `{ loadRigby, parseRigby, RigbySkeleton, RigbyData }`. A second
copy of PixiJS would not share the renderer. Call it once and reuse the result; classes from two
different `rigbyPixi` calls are not interchangeable (`new RigbySkeleton(data)` throws if `data` came
from another runtime). With no argument it uses `globalThis.PIXI` (script-tag builds).

To extend `RigbySkeleton`, do it from the runtime object:

```ts
const runtime = rigbyPixi(PIXI);
class Hero extends runtime.RigbySkeleton {}
```

## Loading

| Function | What it does |
| --- | --- |
| `loadRigby(skeletonUrl, atlasUrl)` | Fetches a `.skel`/`.json` and its `.atlas`, loads the atlas pages through `PIXI.Assets` (with each page's filter and premultiplied alpha) and returns `Promise<RigbyData>`. Loading the same pair again returns the same data. |
| `parseRigby(skeleton, atlasText, textures)` | Builds `RigbyData` from memory: `.skel` bytes, JSON text or parsed JSON; the atlas text; page textures as a `Map`, an object, or `(pageName, page) => Texture`. Use it with your own loader or bundler. |

`RigbyData` holds `skeleton`, `atlas`, `pages`, `animationNames` and `skinNames`. Skeletons made from
the same data share it and its textures, so a crowd costs one load. Skins are per skeleton, even when
the data is shared.

## RigbySkeleton

`new RigbySkeleton(data, options)`. Options: `animation`, `loop` (true), `skin`, `timeScale` (1),
`autoUpdate` (true), `ticker` (such as `app.ticker`, instead of `Ticker.shared`),
`physicsMovement` (0), `roundPixels` (false), `label`.

### Playing animations

```ts
hero.play("run", true, 0.2);          // name, loop = true, mix = 0 (seconds), track = 0
hero.play("shoot", false, 0, 1);      // layered on track 1, over track 0
hero.queue("idle", true, 0.2);        // after the current animation on the track
hero.stop();                          // clear every track, back to the setup pose
hero.state.clearTrack(1);             // stop one track
```

- `play` and `queue` return the `TrackEntry` (not with WebAssembly). **They throw** on an unknown
  animation name; check with `hasAnimation(name)` first when the name comes from data.
- Track 0 is the base layer. Higher tracks apply on top and only change what their animations key.
- Tracks play one entry at a time, crossfading from the previous one over `mix` seconds.
- `queue(name, loop, mix, track, delay)`: `delay` is seconds after the previous entry started;
  `null` starts when it ends. On an empty track it starts immediately.
- `state` is the `AnimationState` (`setAnimation`, `addAnimation`, `clearTrack`, `tracks`, `speed`,
  `addListener`). A `TrackEntry` exposes `name`, `looping`, `time`, `mixDuration`, `alpha`,
  `timeScale` and `queue`.

### Members

| Member | What it does |
| --- | --- |
| `animationNames`, `skinNames`, `boneNames` | What the skeleton has. |
| `hasAnimation(name)`, `hasSkin(name)` | Whether it has that name. |
| `animationDuration(name)` | Length in seconds, or `null`. |
| `isPlaying(name?, track?)` | Whether that animation (or anything) is playing. |
| `skin`, `setSkin(name)` | This skeleton's skin; `null` is the default skin. Throws on an unknown skin. |
| `timeScale` | Speed of this skeleton's animations. |
| `update(seconds)` | Advances, poses and redraws. The ticker calls it unless `autoUpdate` is off. |
| `autoUpdate` | Whether it follows the ticker. Turn it off to drive `update(seconds)` yourself. |
| `resetPhysics()` | Restart physics from the current pose, after a teleport. |
| `physicsMovement` | How strongly moving the object drives physics. Leave at 0 unless the rig is made to be moved (try 0.05 first). |
| `meshCount` | Meshes drawn in the last update. |
| `boneTransform(name, out?)` | `{ x, y, rotation, scaleX, scaleY }` of a bone in the skeleton's coordinates, or `null`. |
| `boneGlobal(name, out?)` | A bone's screen position as a `Point`, or `null`. |
| `attachToBone(name, child, { rotate, scale })` | Makes any display object follow a bone. Returns the child. |
| `detachFromBone(child)` | Stops following. |
| `destroy()` | Stops the ticker hook, clears the tracks and listeners, and destroys the meshes. |

### Saving and restoring tracks (since 0.6.1)

```ts
const saved = hero.snapshotTracks();   // plain values: safe for JSON and save files
// ...later, on a skeleton made from the same data:
hero.restoreTracks(saved);             // each animation resumes at its time, with its queue
```

A `TrackSnapshot` has `track`, `name`, `looping`, `time`, `mixDuration`, `alpha`, `timeScale` and
`queue`. `restoreTracks` clears the current tracks first and skips animations the skeleton does not
have. `snapshotTracks()` is empty with WebAssembly. Skin is separate: store `hero.skin`.

## Events

A `RigbySkeleton` is an event emitter:

```ts
hero.on("start", (entry) => {});
hero.on("end", (entry) => {});        // replaced or cleared
hero.on("complete", (entry) => {});   // reached its end (every loop, for looping entries)
hero.on("event", (entry, event) => console.log(event.name, event.int, event.string));
```

`event` is `{ name, time, int, float, string, audio, volume, balance }`: the editor's animation
events, with their values.

## Coordinates and placement

- The skeleton's origin is at the object's position. Skeleton Y points up and PixiJS Y down; the
  runtime flips it for you, so `position`, `scale` and `rotation` work as usual.
- Meshes live in a flipped child container, so `skeleton.children[0]` is **not** a sprite. Do not
  add your own children expecting them to be in skeleton space: use `attachToBone`.
- `getBounds()` and pointer events work on the drawn meshes.

## CDN without a bundler

```js
import * as PIXI from "https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/+esm";
import { rigbyPixi } from "https://cdn.jsdelivr.net/npm/@rigby2d/pixi-js@<version>/+esm";
const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI);
```

Pin a published `<version>`. Standalone bundles (`rigby2d-pixi-<version>.mjs` and a script-tag
`.js`) are attached to each GitHub release; build them with `npm run build:pixi` in the Rigby2D
repository. They use the PixiJS your app provides and do not include it.

## WebAssembly core (optional)

```ts
import { rigbyPixi, loadRigbyWasm } from "@rigby2d/pixi-js";
const wasm = await loadRigbyWasm("rigby.wasm"); // URL, Response, bytes or WebAssembly.Module
const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI, { wasm });
```

Posing and geometry then run in WebAssembly (about twice as fast in the README's benchmark of 50 to 500 characters). `play`, `queue`,
`stop`, `skin`, `boneTransform`, `attachToBone` and `meshCount` work as usual, but `state`, `pose`,
animation events, `physicsMovement`, the returned track entries, `snapshotTracks` and
`isPlaying` still belong to the JavaScript runtime and are not driven. Use the default JavaScript
core unless profiling shows you need this.

## Common mistakes

- Importing `RigbySkeleton` as a value from the package: it is a property of the object
  `rigbyPixi(PIXI)` returns. The package's own value exports are only `rigbyPixi`, `loadRigbyWasm`
  and `BLEND_MODES`; everything else it exports is a type (`import type { RigbySkeleton }`).
- Passing a second PixiJS copy, or calling `rigbyPixi` more than once and mixing the results.
- Calling `play("name")` with a name the skeleton lacks: it throws; use `hasAnimation`.
- Forgetting the `.atlas` pages: they load from the atlas's folder, so keep the `.png` files next to
  it.
- Turning `physicsMovement` up on rigs not made for movement.
