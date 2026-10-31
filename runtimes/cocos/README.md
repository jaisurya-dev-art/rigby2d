# Rigby2D for Cocos Creator

[中文说明](README.zh-CN.md)

Plays Rigby2D skeletons in **Cocos Creator 3.8** with the Rigby2D runtime, so characters move exactly
as in the editor: meshes and weights, IK, transform, path, physics and slider constraints, clipping,
two-color tint, every blend mode, skins, events, and layered tracks with crossfades.

- **A 2D renderer**: under a Canvas it draws in order with your sprites and labels and follows the
  node's color and opacity. It needs no 3D engine module, so 2D-only projects work as they are.
- **Zero setup**: drop the exported `.json` and `.atlas` into your project; Cocos turns the pair into
  a *Skeleton Data* asset. Drag that onto the component and pick an animation.
- **Bone followers**: keep any node (a sword, particles, a collider) on a bone.
- **Animations preview in the Cocos editor** while you set the scene up.

Tested in Cocos Creator 3.8.8 (web build, 60 fps).

## Coming from DragonBones

Open your DragonBones project (`_ske.json` + `_tex.json` + `_tex.png`) in Rigby2D: bones, meshes,
weights, IK, skins, nested armatures (weapons and effects) and every animation come in, checked against
the official DragonBones runtime. Export it and play it in Cocos Creator with RigbySkeleton. See
[Coming from DragonBones](https://rigby2d.com/docs/migrating-from-dragonbones.html).

## Install

1. Download `rigby2d-cocos-<version>.zip` from the
   [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases), or get it in Rigby2D with
   *File ▸ Get runtimes…*.
2. Unzip it into your project's `assets/` folder, so you have `assets/rigby2d/`.

## Use

1. In Rigby2D, export the character: *File ▸ Export ▸ JSON + atlas…* (or binary `.skel`).
2. Copy the `.json` (or `.skel`), `.atlas` and `.png` files into your project's `assets/`.
3. Add a node under your Canvas, then add **Rigby2D ▸ RigbySkeleton**.
4. Set **Skeleton Data** to the asset Cocos made from the `.json` and `.atlas` pair, and
   **Animation** to the one to play.

Or set **Skeleton Json** (or **Skeleton Binary**), **Atlas Text** and **Textures** yourself. Cocos
imports `.skel` as a binary asset when you name it `.skel.bin`, and `.atlas` as text when you name it
`.atlas.txt`.

```ts
import { _decorator, Component } from 'cc';
import { RigbySkeleton, RigbyEvent } from './rigby2d/RigbySkeleton';

@_decorator.ccclass('Hero')
export class Hero extends Component {
  start() {
    const rigby = this.getComponent(RigbySkeleton)!;
    rigby.setAnimation(0, 'run', true, 0.2);         // track 0, 0.2 s crossfade
    rigby.setAnimation(1, 'shoot', false);            // layered on top
    rigby.addAnimation(0, 'idle', true, 0.3);         // queued after run
    rigby.setSkin('armored');
    this.node.on(RigbySkeleton.EVENT, (e: RigbyEvent) => console.log(e.name, e.time));
    this.node.on(RigbySkeleton.COMPLETE, (animation: string, track: number) => console.log(animation, 'looped'));
  }
}
```

- `setAnimation(track, name, loop, mix)`, `addAnimation(track, name, loop, mix, delay)`, `clearTrack(track)`
- `setSkin(name)`, `animationNames`, `skinNames`, `timeScale`
- `boneTransform(name)`: a bone's position, rotation and scale in the node's space
- Node events: `RigbySkeleton.EVENT` (a `RigbyEvent`), `START`, `END`, `COMPLETE` (animation, track)
- `skeleton`, `pose` and `state`: the Rigby2D runtime's own objects, for everything else

**RigbyBoneFollower**: add it to a child node of the skeleton, set **Bone**, and the node follows that
bone (its rotation and scale too, if you like).

## Notes

- One `rigby2d.effect` draws every skeleton. Its uuid is fixed (in `rigby2d.effect.meta`), so the
  component finds it by itself; keep the `.meta` file when you copy the folder.
- Each texture and blend mode in draw order is one draw call, as in the editor.
- `rigby2d-core.ts` is the Rigby2D runtime (`src/core`) as one module; `npm run build:cocos`
  rebuilds the package from source.

License: MIT OR Apache-2.0, like the rest of the Rigby2D runtimes.
