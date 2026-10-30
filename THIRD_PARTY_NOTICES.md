# Third-party notices

Rigby2D's own code is MIT OR Apache-2.0. The desktop editor and the web build also distribute the
components below, unmodified, under their own licenses.

## Pyodide (Python scripting)

The editor ships Pyodide to run Python scripts: the files in `pyodide/` of the build come from the
[`pyodide`](https://www.npmjs.com/package/pyodide) npm package.

- **Pyodide**: Mozilla Public License 2.0. Source: <https://github.com/pyodide/pyodide>.
  License text: <https://www.mozilla.org/MPL/2.0/>.
- **CPython** (compiled to WebAssembly in `pyodide.asm.wasm`, standard library in
  `python_stdlib.zip`): Python Software Foundation License Version 2. Source:
  <https://github.com/python/cpython>. License text: <https://docs.python.org/3/license.html>.

The source code of these components, as distributed, is available from the links above and from
the npm package.

## Speech recognition (automatic lip-sync timing)

The editor ships these to transcribe audio for lip-sync, bundled into the build's assets:

- **Transformers.js**: Apache License 2.0. Source: <https://github.com/huggingface/transformers.js>.
- **ONNX Runtime Web** (including `ort-wasm-simd-threaded.asyncify.wasm`): MIT License. Source:
  <https://github.com/microsoft/onnxruntime>.

The Whisper speech model is not distributed with Rigby2D: the editor downloads it from Hugging Face
(`onnx-community/whisper-base_timestamped`) the first time it is used. Whisper is by OpenAI, MIT
License: <https://github.com/openai/whisper>.

## Icons

The editor's dialogs and the website use icons from:

- **Lucide**: ISC License, Copyright (c) Lucide Contributors. Source: <https://lucide.dev>.
- **Simple Icons** (the Unity, Godot, JavaScript, Rust, Apple and Linux marks): CC0 1.0. Source:
  <https://simpleicons.org>. The marks are trademarks of their owners and only name the engines and
  platforms the runtimes and downloads are for.

## Godot runtime

The Godot addon includes godot-rust (MPL-2.0); see `THIRD_PARTY_NOTICES.md` inside the addon.

## DragonBones demo characters (website only)

The "Coming from DragonBones" section of rigby2d.com shows four DragonBones demo characters, kept in
`site/showcase/dragonbones/`. They are not under the Rigby2D license: they are licensed CC BY-NC-SA
4.0, Copyright (c) 2012-2018 The DragonBones team and other contributors. Source:
<https://github.com/DragonBones/Demos>. Details in `site/showcase/dragonbones/README.md`. Rigby2D is
not affiliated with DragonBones.
