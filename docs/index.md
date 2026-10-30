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

<div class="cards">
<a href="autorig.html" data-icon="wand-sparkles"><strong>Rig in one step</strong>Import a layered PSD; AutoRig finds the parts and builds bones, meshes and IK.</a>
<a href="bones-and-slots.html" data-icon="bone"><strong>Rig by hand</strong>Bones, weighted meshes, constraints, skins and events.</a>
<a href="animating.html" data-icon="play"><strong>Animate</strong>Dopesheet, graph editor, onion skin, poses and face controls.</a>
<a href="retargeting.html" data-icon="repeat-2"><strong>Reuse animation</strong>Retarget animations from one character to another.</a>
<a href="film.html" data-icon="clapperboard"><strong>Make films</strong>Camera, audio, lip-sync, and renders to PNG, WebM and MP4.</a>
<a href="scenes.html" data-icon="drama"><strong>Compose scenes</strong>Several characters, clips, parallax layers and a camera.</a>
<a href="scripting.html" data-icon="code"><strong>Automate</strong>Python scripts, add-ons, and AI assistants over MCP.</a>
<a href="runtimes.html" data-icon="gamepad-2"><strong>Ship to any engine</strong>JSON or <code>.skel</code> for Godot, Unity, Phaser, JavaScript and Rust.</a>
</div>

## Where to start

<div class="cards">
<a href="installation.html" data-icon="download"><strong>Installation</strong>Use it in the browser, download the app for Windows, macOS or Linux, or build from source.</a>
<a href="quick-start.html" data-icon="rocket"><strong>Quick start</strong>From a layered PSD to a moving character in ten minutes.</a>
<a href="interface.html" data-icon="panels-top-left"><strong>The interface</strong>A tour of the viewport, tree, inspector and timeline.</a>
<a href="autorig.html" data-icon="wand-sparkles"><strong>AutoRig</strong>Rig layered artwork in one step.</a>
<a href="animating.html" data-icon="play"><strong>Animating</strong>Keys, the dopesheet, curves and playback.</a>
<a href="film.html" data-icon="clapperboard"><strong>Film workspace</strong>Output, camera, audio and rendering.</a>
<a href="runtimes.html" data-icon="gamepad-2"><strong>Runtimes</strong>Play your animations in games and apps.</a>
<a href="mcp.html" data-icon="bot"><strong>AI assistants</strong>Connect Claude or another MCP client.</a>
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
