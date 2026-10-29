# Rigby2D for Phaser

Play Rigby2D skeletons in [Phaser](https://phaser.io) 3.60 or newer (WebGL renderer). The plugin is
built on the JavaScript runtime and the reference WebGL renderer, so characters move exactly as in
the editor: meshes, weights, skins, IK, transform, path, physics and slider constraints, clipping,
draw order, events, and layered tracks with crossfades and queues.

## Install

Download `rigby2d-phaser-<version>.mjs` (ES module) or `rigby2d-phaser-<version>.js` (script tag,
`window.RigbyPhaser`) from the [latest release](https://github.com/jaisurya-dev-art/rigby2d/releases/latest),
or build them with `npm run build:phaser` (writes `dist-phaser/`).

## Use

Export your character from Rigby2D (*File ▸ Export*): the `.skel` or `.json`, the `.atlas` and its
`.png` pages, in one folder.

```js
import Phaser from 'phaser';
import { rigbyPhaser } from './rigby2d-phaser-0.4.0.mjs';

const { RigbyPlugin } = rigbyPhaser(Phaser);

class Level extends Phaser.Scene {
  preload() {
    this.load.rigby('hero', 'assets/hero.skel', 'assets/hero.atlas'); // pages load from the atlas's folder
  }

  create() {
    const hero = this.add.rigby(400, 500, 'hero', 'idle'); // x, y, key, animation, loop = true
    hero.setScale(0.5);
    hero.on('event', (entry, event) => console.log(event.name));
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  width: 960,
  height: 600,
  plugins: { scene: [{ key: 'RigbyPlugin', plugin: RigbyPlugin, mapping: 'rigby' }] },
  scene: Level,
});
```

With a script tag, Phaser and the plugin are globals:

```html
<script src="phaser.min.js"></script>
<script src="rigby2d-phaser-0.4.0.js"></script>
<script>
  const { RigbyPlugin } = RigbyPhaser.rigbyPhaser(Phaser);
</script>
```

The skeleton's origin (usually between the feet) is placed at `x, y`. Skeleton Y points up and
Phaser's down; the plugin turns it around for you.

## RigbySkeleton

A Phaser game object (it has position, scale, rotation, alpha, depth, flipX/flipY, visible, scroll
factor and input like any other) with:

| Member | What it does |
| --- | --- |
| `play(name, loop = true, mix = 0)` | Plays an animation on track 0, crossfading over `mix` seconds. |
| `queue(name, loop = true, mix = 0.2, track = 0, delay = null)` | Plays `name` after the current animation. |
| `state` | The `AnimationState`: `setAnimation(skeleton, track, name, loop, mix)`, `addAnimation`, `clearTrack`, `stop`, layered tracks. |
| `timeScale` | Speed of this skeleton's animations (1 = real time). |
| `skin`, `setSkin(name)` | The active skin (`null` for the default). |
| `animationNames`, `skinNames` | What the skeleton has. |
| `boneWorld(name)` | `{ x, y, rotation }` of a bone in the scene, to attach sprites, particles or hit boxes. |
| `localBounds` | The setup pose's bounds, for example `hero.setScale(200 / hero.localBounds.height)`. |
| `skeleton`, `pose` | The skeleton data and its current pose (the JavaScript runtime). |

Events: `'start'`, `'end'` and `'complete'` (with the track entry) and `'event'` (entry, event with
`name`, `int`, `float`, `string`, `audio`, `volume`, `balance`).

`setInteractive()` uses the setup pose's bounds as the hit area. Skeletons loaded under the same key
share their data and textures.

## Notes

- WebGL only. The Canvas renderer draws nothing for skeletons.
- Every skeleton is drawn in its own batch. A crowd of hundreds is fine; for thousands, consider
  sprite sheets for the far ones.
- The example in `examples/phaser.html` plays NILA, Rigbytron and a crowd among Phaser sprites,
  shapes and text (`npm run web:dev`, then open `/examples/phaser.html`).
