# Rigby2D for PixiJS

Play Rigby2D skeletons in [PixiJS](https://pixijs.com) 8, on WebGL and WebGPU. Animation runs on
the JavaScript runtime, so characters move exactly as in the editor: meshes, weights, skins, IK,
transform, path, physics and slider constraints, clipping, draw order, two-color tint, events, and
layered tracks with crossfades and queues.

Drawing is PixiJS's own. A skeleton is an ordinary `Container` whose attachments are PixiJS meshes
that go through PixiJS's batcher, so it can share draw calls with your sprites. It also works with
everything a display object does: filters, masks, tint, alpha, blend modes, `getBounds()`, pointer
events, render groups and render textures. A whole character with one atlas page is usually a
single mesh.

## Install

Download `rigby2d-pixi-<version>.mjs` (ES module) or `rigby2d-pixi-<version>.js` (script tag,
`window.RigbyPixi`) from the [latest release](https://github.com/jaisurya-dev-art/rigby2d/releases/latest),
or build them with `npm run build:pixi` (writes `dist-pixi/`). PixiJS isn't bundled: the runtime
uses the PixiJS your game already loads.

## Use

Export your character from Rigby2D (*File ▸ Export*): the `.skel` or `.json`, the `.atlas` and its
`.png` pages, in one folder.

```js
import * as PIXI from 'pixi.js';
import { rigbyPixi } from './rigby2d-pixi-<version>.mjs';

const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI);

const app = new PIXI.Application();
await app.init({ width: 960, height: 600, preference: 'webgl' }); // or 'webgpu'
document.body.appendChild(app.canvas);

const data = await loadRigby('assets/hero.skel', 'assets/hero.atlas'); // pages load from the atlas's folder
const hero = new RigbySkeleton(data, { animation: 'idle' });
hero.position.set(400, 550);
hero.scale.set(0.5);
hero.on('event', (entry, event) => console.log(event.name));
app.stage.addChild(hero);
```

With script tags, PixiJS and the runtime are globals:

```html
<script src="pixi.min.js"></script>
<script src="rigby2d-pixi-<version>.js"></script>
<script>
  const { loadRigby, RigbySkeleton } = RigbyPixi.rigbyPixi(PIXI);
</script>
```

The skeleton's origin (usually between the feet) is at the object's position. Skeleton Y points up
and PixiJS's down; the runtime turns it around for you. Skeletons made from the same loaded data
share it and its textures, so a crowd costs one load.

## Loading

| Function | What it does |
| --- | --- |
| `loadRigby(skeletonUrl, atlasUrl)` | Loads a `.skel` or `.json`, its `.atlas` and the atlas pages (through `PIXI.Assets`, with each page's filter and premultiplied alpha). Returns a promise of `RigbyData`; loading the same pair again gives the same data. |
| `parseRigby(skeleton, atlasText, textures)` | The same from memory: `.skel` bytes, JSON text or parsed JSON, the atlas text, and the page textures (page name → `Texture`, as a `Map`, an object or a function). For your own loaders and bundlers. |

`RigbyData` has `skeleton`, `atlas`, `pages`, `animationNames` and `skinNames`.

## RigbySkeleton

`new RigbySkeleton(data, options)`. Options: `animation`, `loop` (true), `skin`, `timeScale` (1),
`autoUpdate` (true), `ticker`, `physicsMovement` (0), `roundPixels` (false), `label`.

| Member | What it does |
| --- | --- |
| `play(name, loop = true, mix = 0, track = 0)` | Plays an animation, crossfading over `mix` seconds. Returns the track entry. |
| `queue(name, loop = true, mix = 0.2, track = 0, delay = null)` | Plays `name` after the current animation on `track`. |
| `stop()` | Clears every track and goes back to the setup pose. |
| `state` | The `AnimationState`: `setAnimation(skeleton, track, name, loop, mix)`, `addAnimation`, `clearTrack`, layered tracks. |
| `timeScale` | Speed of this skeleton's animations (1 = real time). |
| `skin`, `setSkin(name)` | This skeleton's skin (`null` for the default). Each skeleton has its own, even when they share data. |
| `animationNames`, `skinNames` | What the skeleton has. |
| `update(seconds)` | Advances, poses and redraws. Called by the ticker unless `autoUpdate` is off. |
| `autoUpdate` | Whether it advances with `PIXI.Ticker.shared` (or the `ticker` option, such as `app.ticker`). Turn it off to drive it yourself. |
| `boneTransform(name)` | `{ x, y, rotation, scaleX, scaleY }` of a bone, in the skeleton's coordinates. |
| `boneGlobal(name)` | Where a bone is on screen (global coordinates). |
| `attachToBone(name, child, { rotate, scale })` | Makes any display object follow a bone: weapons, particles, hit boxes, name tags. It is drawn in front of the skeleton. |
| `detachFromBone(child)` | Stops it following. |
| `physicsMovement` | How strongly moving the object drives physics (hair, cloth). 0 = only the animation does, as in the editor; up to 1 = as if the character itself moved that far. Physics is tuned for animation, so start small (0.05) and only with rigs made to be moved around. |
| `resetPhysics()` | Restarts physics from the current pose, after a teleport. |
| `meshCount` | How many meshes the last update drew with. |
| `skeleton`, `pose`, `data` | The skeleton data, its current pose and the loaded data. |

Events: `'start'`, `'end'` and `'complete'` (with the track entry) and `'event'` (entry, event with
`name`, `int`, `float`, `string`, `audio`, `volume`, `balance`).

For clicks, set `eventMode = 'static'`: hit testing uses the meshes' bounds. `getBounds()` and
`getLocalBounds()` work as for any container, for example `hero.scale.set(200 / hero.getLocalBounds().height)`.

## How it draws

Each frame, the runtime walks the draw order (clipping included) and feeds the triangles into
PixiJS meshes. Consecutive attachments that share an atlas page, blend mode and tint go into one
mesh, and every mesh is batched by PixiJS whatever its size. The slot blend modes are PixiJS's own
(`normal`, `add`, `multiply`, `screen`). A slot with a dark color (two-color tint) is drawn with a
small shader of its own, written for both WebGL and WebGPU, and draws outside the batcher.

## Notes

- PixiJS 8 only (`Mesh`, `MeshGeometry` and the v8 shader system). The Canvas renderer is not
  supported.
- The example in `examples/pixi.html` plays NILA, Rigbytron and a blurred crowd among PixiJS
  graphics and text, with a star attached to a bone (`npm run web:dev`, then open
  `/examples/pixi.html`; add `?webgpu` for WebGPU).
- Tests: `node --test test/pixi.test.js` checks the meshes hold exactly the JavaScript runtime's
  triangles, and covers blend modes, per-object skins, two-color tint, events and bone children.
