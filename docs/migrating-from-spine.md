# Coming from Spine

Rigby2D reads and writes the skeleton JSON and binary `.skel` formats that Spine exports (3.8, 4.0
to 4.3), so you can bring existing characters over as they are and keep the same workflow: bones,
slots, skins, meshes, constraints and animations work the way you already know.

> Spine is a trademark of Esoteric Software. Rigby2D is an independent open-source project, not
> affiliated with or endorsed by Esoteric Software, and it uses none of its code. It reads and
> writes the same file formats so your work can move between tools.

## 1. Check your files

*File ▸ Import ▸ Check a skeleton file…* reads a `.json` or `.skel` and lists what it holds and how
each feature carries over, before you open anything:

| Mark | Means |
| --- | --- |
| ✓ | Plays as in the original |
| ● | Kept and exported, but not shown in the editor (bounding boxes, points) |
| ◐ | Partly supported: kept as it is, so a later export still has it, but not played |

Files older than 3.8 can't be read. Open the project in the tool that made it and export it again
as JSON 3.8 or newer.

## 2. Export and open

1. In Spine, export **JSON** (or **Binary**) with **Texture Atlas** packing, format 3.8 or newer.
   Keep the `.json` or `.skel`, the `.atlas` and its `.png` pages in one folder.
2. In Rigby2D, *File ▸ Open…* and pick the `.json` or `.skel`. The atlas and images load from the
   same folder (or from the `images` folder next to it, for unpacked exports).
3. *File ▸ Save* keeps it as a `.rigby` work file: the whole project with its images in one file.

Opening and exporting again is **lossless**: anything Rigby2D reads is written back, including data
it doesn't use, so a round trip doesn't strip your files.

## What carries over

| You have | In Rigby2D |
| --- | --- |
| Bones, inherit modes, colors | The same, in the tree and inspector |
| Slots, draw order, blend modes, two-color tint | The same |
| Region, mesh, linked mesh, clipping and path attachments | The same; meshes with weights and deform keys |
| Image sequences | The same |
| Skins (including skin bones and constraints) | The same |
| IK, transform, path, physics and slider constraints | Evaluated, with their keys |
| Events, with audio | The same, and audio plays in the Film workspace |
| Animations: every timeline, Bézier curves, draw order, deform | The same, in the dopesheet and graph editor |
| Bounding boxes and points | Kept and exported for your game, not drawn |

## Where things are

| Spine | Rigby2D |
| --- | --- |
| Setup mode / Animate mode | **Setup** / **Animate** (Tab), the same idea: edits in Animate write keys |
| Tree | The **tree** panel (right) |
| Dopesheet, Graph | **Dopesheet** and **Graph** tabs under the viewport |
| Export JSON / Binary | *File ▸ Export ▸ JSON + atlas* or *Binary .skel + atlas*, with the format version |
| Texture packer | Built into every export |
| — | **AutoRig** a layered PSD, **lip-sync** from audio, **film** rendering, **scenes**, **Python scripting** and add-ons, an **MCP server** for AI assistants |

## Switching runtimes

Rigby2D's runtimes are free and open source (MIT or Apache-2.0), with no license needed to ship
your game. They load the same `.json` / `.skel` + `.atlas` exports:

| Engine | Rigby2D runtime |
| --- | --- |
| Unity | `com.rigby2d.unity`: `RigbySkeleton` and `RigbyScene` components ([guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/unity/com.rigby2d.unity/README.md)) |
| Godot | `RigbySkeleton2D` and `RigbyScene2D` nodes ([guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/godot/addons/rigby2d/README.md)) |
| Phaser | `this.load.rigby()` and `this.add.rigby()` ([guide](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/phaser/README.md)) |
| Web (any engine) | The JavaScript runtime and WebGL renderer |
| Native | The Rust runtime |

*File ▸ Get runtimes…* downloads the runtime that matches your editor. The APIs follow the same
model (a skeleton, an animation state with tracks, crossfades and queues, events, skins), so
porting game code is mostly renaming: see [Runtimes](runtimes.md).
