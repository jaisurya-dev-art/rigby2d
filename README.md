<p align="center">
  <img src="branding/rigby2d-lockup-dark.svg" alt="Rigby2D by Hoverlabs" width="460">
</p>

<p align="center">
  <strong>Open-source 2D skeletal animation for games, films and interactive experiences.</strong><br>
  Rig your art with bones and meshes, animate it, and play it anywhere with the included runtime.<br>
  Built-in <a href="docs/mcp.md">MCP server</a>: AI assistants can inspect, validate and animate your projects.
</p>

<p align="center">
  <a href="https://jaisurya-dev-art.github.io/rigby2d/"><img alt="Try it in your browser: the full editor, nothing to install" src="https://img.shields.io/badge/%E2%96%B6%20Try%20it%20in%20your%20browser-the%20full%20editor%2C%20nothing%20to%20install-b5d3e7?style=for-the-badge&labelColor=0a0a0b" height="40"></a><br>
  <sub><a href="https://jaisurya-dev-art.github.io/rigby2d/editor/"><b>Open the editor</b></a> with the Rigbytron and NILA demos, tutorials and Python scripting · <a href="https://jaisurya-dev-art.github.io/rigby2d/">Website</a> · <a href="https://jaisurya-dev-art.github.io/rigby2d/docs/">Documentation</a></sub>
</p>

<p align="center">
  <img alt="Status: public beta" src="https://img.shields.io/badge/status-public%20beta-blue">
  <a href="https://upstar.dev/r/jaisurya-dev-art/rigby2d"><img alt="Upstar" src="https://upstar.dev/badge/jaisurya-dev-art/rigby2d.svg"></a>
  <a href="https://youtu.be/3StZlHwZeSo"><img alt="Watch the NILA promo on YouTube" src="https://img.shields.io/badge/watch-NILA%20promo-ff0000?logo=youtube&logoColor=white"></a>
  <a href="runtimes/godot/addons/rigby2d/README.md"><img alt="Runtime ready: Godot" src="https://img.shields.io/badge/runtime%20ready-Godot-478cbf?logo=godotengine&logoColor=white"></a>
  <a href="docs/mcp.md"><img alt="MCP server built in" src="https://img.shields.io/badge/MCP-server%20built%20in-7c3aed"></a>
  <a href="#license"><img alt="License: MIT or Apache-2.0" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-24c8db">
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

<p align="center">
  <a href="https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_x64_portable.exe"><b>Download (portable)</b></a>: the latest portable editor for Windows, no install needed
</p>

<p align="center">
  <a href="https://youtu.be/3StZlHwZeSo"><img src="docs/images/nila-promo.jpg" alt="Watch Meet NILA on YouTube: the Rigby2D mascot, animated in Rigby2D" width="800"></a><br>
  <sub>▶ <a href="https://youtu.be/3StZlHwZeSo">Watch <b>Meet NILA</b></a>: our new mascot, rigged, animated, lip-synced and rendered in Rigby2D · Also: <a href="https://www.youtube.com/watch?v=KK3WT9YzhAE">the 75-second overview</a></sub>
</p>

<p align="center">
  <img src="docs/screenshot.jpg" alt="The Rigby2D editor animating NILA: viewport with her rig, bone tree, inspector and dopesheet" width="800"><br>
  <sub>The editor animating NILA: the head bone selected in the tree, its keys in the dopesheet, its pose in the inspector.</sub>
</p>

## Documentation

**[Read the documentation](https://jaisurya-dev-art.github.io/rigby2d/docs/)**: guides with screenshots for every part of the editor, the
runtimes and the MCP server. The pages are also in [`docs/`](docs/).

| Get started | Rig | Animate | Ship and automate |
| --- | --- | --- | --- |
| [Installation](https://jaisurya-dev-art.github.io/rigby2d/docs/installation.html) | [Importing art](https://jaisurya-dev-art.github.io/rigby2d/docs/importing-art.html) | [Animating](https://jaisurya-dev-art.github.io/rigby2d/docs/animating.html) | [Export](https://jaisurya-dev-art.github.io/rigby2d/docs/export.html) |
| [Quick start](https://jaisurya-dev-art.github.io/rigby2d/docs/quick-start.html) | [AutoRig](https://jaisurya-dev-art.github.io/rigby2d/docs/autorig.html) | [Graph editor](https://jaisurya-dev-art.github.io/rigby2d/docs/graph-editor.html) | [Runtimes](https://jaisurya-dev-art.github.io/rigby2d/docs/runtimes.html) |
| [The interface](https://jaisurya-dev-art.github.io/rigby2d/docs/interface.html) | [Bones and slots](https://jaisurya-dev-art.github.io/rigby2d/docs/bones-and-slots.html) | [Poses and faces](https://jaisurya-dev-art.github.io/rigby2d/docs/poses-and-faces.html) | [Python scripting](https://jaisurya-dev-art.github.io/rigby2d/docs/scripting.html) |
| [Demo projects](https://jaisurya-dev-art.github.io/rigby2d/docs/demos.html) | [Meshes](https://jaisurya-dev-art.github.io/rigby2d/docs/meshes.html) · [Constraints](https://jaisurya-dev-art.github.io/rigby2d/docs/constraints.html) | [Film](https://jaisurya-dev-art.github.io/rigby2d/docs/film.html) · [Scenes](https://jaisurya-dev-art.github.io/rigby2d/docs/scenes.html) · [Lip-sync](https://jaisurya-dev-art.github.io/rigby2d/docs/lip-sync.html) | [AI assistants (MCP)](https://jaisurya-dev-art.github.io/rigby2d/docs/mcp.html) |

## Features

- **AutoRig**: a layered PSD becomes an editable rig in one step: bones, joints, bending meshes and IK.
- **Full rigging toolset**: bones, weighted meshes, linked meshes, image sequences, skins, events,
  clipping and paths, with IK, transform, path, physics and slider constraints.
- **Animation**: Setup and Animate modes, dopesheet, graph editor with Bézier handles, onion
  skinning, pose library, face controls and retargeting between characters.
- **Film workspace**: 4K, timecode, an animatable camera, audio tracks, viseme lip-sync with
  on-device Whisper transcription, and renders to PNG sequences, WebM with alpha and MP4.
- **Scene composition** (new in 0.3): several characters on one stage as actors with NLE-style clips
  (trim, speed, loops, crossfades, their own audio), painted layers with parallax, and a camera,
  and they play in games through every runtime. See [Scenes](https://jaisurya-dev-art.github.io/rigby2d/docs/scenes.html).
- **A focused editor**: Game and Film workspaces, panels you can resize or pop out to a second
  monitor, *Open recent*, and a searchable shortcut reference with Reference and Blender-like keys.
- **Python scripting** and custom tools, and a built-in **MCP server** so AI assistants such as
  Claude can inspect, rig and animate your projects.
- **Lossless skeleton JSON (3.8, 4.2, 4.3) and binary `.skel`** with texture atlases, played by the
  **JavaScript, Rust and Godot runtimes**.
- Built-in **tutorials** and demo projects (**NILA**, **Rigbytron**, and a **scene** with both), also on the
  [Demos page](https://jaisurya-dev-art.github.io/rigby2d/demos/) with their game-ready exports
  (demo content © Hoverlabs, under its own [demo license](branding/DEMO-LICENSE.md)).

## Getting started

- **In your browser:** [open the editor](https://jaisurya-dev-art.github.io/rigby2d/editor/), nothing to install.
- **Windows:** [download the portable editor](https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_x64_portable.exe)
  or an installer from [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases).
  Windows code signing comes from the SignPath Foundation (application under review; see the
  [code signing policy](https://jaisurya-dev-art.github.io/rigby2d/docs/code-signing.html)).
- **AI assistants:** install [Rigby2D-AI.mcpb](https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D-AI.mcpb)
  in Claude Desktop, or see the [MCP guide](https://jaisurya-dev-art.github.io/rigby2d/docs/mcp.html).
- **From source** (Node.js 20+ and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)):

```bash
git clone https://github.com/jaisurya-dev-art/rigby2d.git
cd rigby2d
npm install
npm run dev        # desktop app; npm run web:dev for the browser, npm test for the tests
```

See [Installation](https://jaisurya-dev-art.github.io/rigby2d/docs/installation.html) for every option.

## Project structure

```
src/core/       Runtime: data model, skeleton JSON/.skel + atlas I/O, pose evaluation, constraints, playback
src/editor/     Editor UI: viewport, tree, inspector, dopesheet, graph editor, import/export, scripting
src/webgl/      Reference WebGL renderer for the runtime
src/mcp/        Model Context Protocol server for AI assistants
runtimes/       Rust runtime and the Godot 4 node (preview)
site/           Website and documentation site (GitHub Pages)
docs/           Documentation pages and images
branding/       Logo, icons, Rigbytron and NILA (proprietary, see TRADEMARKS.md)
src-tauri/      Native desktop shell
test/           node:test suites
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup,
coding style and pull request process.

## License

Rigby2D's source code is licensed under either of

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option. © 2026 [jaisurya-dev-art](https://github.com/jaisurya-dev-art)

Unless you state otherwise, any contribution you submit for inclusion in Rigby2D is licensed under
both licenses as above, without any additional terms or conditions.

The editor distributes Pyodide and CPython for Python scripting under their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Trademarks

**Rigby2D**, **Hoverlabs**, **Rigbytron** and **NILA**, and the Rigby2D logo, lockups, icons and the Rigbytron
and NILA mascots in [`branding/`](branding/), are proprietary trademarks of Hoverlabs. They are not covered by the MIT or Apache 2.0 licenses. Forks
and modified versions must use their own name and branding. See [TRADEMARKS.md](TRADEMARKS.md).

## Disclaimer

Rigby2D is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by the makers of any other animation software. All trademarks belong to their respective owners.

Rigby2D reads and writes the skeleton JSON, binary `.skel` and texture atlas file formats solely for interoperability, so that users can work with their own exported files. This support was implemented clean-room:

- **JSON and atlas formats:** implemented from publicly available documentation.
- **Binary `.skel` format:** implemented from the publicly documented binary layout of earlier versions and by comparing JSON and binary exports of the same skeleton (black-box observation of exported data).

No source code, runtimes, editor files or assets of other animation software are used or distributed with Rigby2D. Compatibility with files from any particular editor or runtime version is provided as-is and is not guaranteed.
