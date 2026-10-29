# Rigby2D documentation

Rigby2D is a free, open-source editor for 2D skeletal animation. You rig layered artwork with bones
and meshes, animate it for games or film, and play it anywhere with the included runtimes. A built-in
[MCP server](mcp.md) lets AI assistants inspect, rig and animate your projects.

![The Rigby2D editor with NILA, the Rigby2D mascot, in Animate mode: the viewport, the bone tree, the inspector and the dopesheet](images/editor-overview.jpg "NILA, one of the bundled demos, open in the editor")

> [!TIP]
> Watch [Meet NILA](https://youtu.be/3StZlHwZeSo), our mascot's 70-second promo, animated and rendered in Rigby2D.
>
> The fastest way to try it: [open the editor in your browser](https://rigby2d.com/editor/),
> choose *File ▸ Open demo* and pick NILA. Nothing to install.

## What you can do with it

- **Rig in one step.** Import a layered PSD and [AutoRig](autorig.md) finds the body parts, places
  the joints and builds bones, bending meshes and IK.
- **Rig by hand** with [bones, slots and attachments](bones-and-slots.md), [weighted meshes](meshes.md),
  [IK, transform, path, physics and slider constraints](constraints.md), [skins and events](skins-and-events.md).
- **Animate** with Setup and Animate modes, a [dopesheet](animating.md), a
  [graph editor](graph-editor.md) with Bézier handles, [onion skinning](onion-skin.md), a
  [pose library and face controls](poses-and-faces.md), and [retargeting](retargeting.md) between characters.
- **Make films** in the [Film workspace](film.md): resolution and frame-rate presets, an animatable
  camera, audio tracks, [viseme lip-sync](lip-sync.md) with automatic transcription, and renders to
  PNG sequences, WebM with alpha and MP4.
- **Compose scenes** with several characters: actors with NLE-style clips, parallax layers and a
  camera. See [Scenes](scenes.md).
- **Automate** with [Python scripting](scripting.md) and custom tools, or let an AI assistant work
  through the [MCP server](mcp.md).
- **Ship** skeleton JSON (3.8, 4.2, 4.3) or binary `.skel` with a texture atlas, and play it with
  the [JavaScript, Rust, Unity and Godot runtimes](runtimes.md).

## Where to start

<div class="cards">
<a href="installation.html"><strong>Installation</strong>Use it in the browser, download the app for Windows, macOS or Linux, or build from source.</a>
<a href="quick-start.html"><strong>Quick start</strong>From a layered PSD to a moving character in ten minutes.</a>
<a href="interface.html"><strong>The interface</strong>A tour of the viewport, tree, inspector and timeline.</a>
<a href="autorig.html"><strong>AutoRig</strong>Rig layered artwork in one step.</a>
<a href="animating.html"><strong>Animating</strong>Keys, the dopesheet, curves and playback.</a>
<a href="film.html"><strong>Film workspace</strong>Output, camera, audio and rendering.</a>
<a href="runtimes.html"><strong>Runtimes</strong>Play your animations in games and apps.</a>
<a href="mcp.html"><strong>AI assistants</strong>Connect Claude or another MCP client.</a>
</div>

## Key ideas

**Setup pose and animations.** Every rig has a *setup pose*: where each bone, image and mesh sits at
rest. Animations store changes relative to it. In **Setup mode** your edits change the setup pose; in
**Animate mode** the same edits set keys at the current frame. Press <kbd>Tab</kbd> to switch.

**Bones, slots and attachments.** Bones form the skeleton. A *slot* sits on a bone and decides
draw order and color; it shows one *attachment* at a time: an image, a mesh, or a shape such as a
clipping polygon. Swapping attachments is how mouths, hands and eyes change shape.

**Work files and exports.** You save your work as one `.rigby` file holding the whole project and
its images. For games you *export* skeleton JSON or `.skel` plus a texture atlas, which the runtimes
load. See [File formats](file-formats.md).

**Two workspaces.** The **Game** and **Film** workspaces show the tools for each kind of work. They
never change the animation data, so exports are identical either way.

## Status

Rigby2D is in **public beta**: ready for real projects, and still moving quickly. These pages
describe the current `develop` branch,
which is what the [website](https://rigby2d.com/) and its browser editor run.
Found something wrong or missing? [Open an issue](https://github.com/jaisurya-dev-art/rigby2d/issues)
or use *Edit this page on GitHub* below.
