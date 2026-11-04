---
title: Seven runtimes, one answer
date: 2026-11-04
time: 18:00
summary: How an animation made in Rigby2D plays the same in Unity, Godot, Defold, Cocos Creator, Phaser, JavaScript and Rust: one reference runtime, and every port checked against it frame by frame.
image: /docs/images/devlog-runtimes.jpg
tag: Behind the scenes
---

An animation should look the same everywhere you ship it. The arm you posed in the editor should
bend the same way in Unity, the braid should swing the same way in Godot, and the mesh should
deform the same way in Defold. In most toolchains each engine's runtime is written on its own, and
small differences creep in: an IK chain that settles a little differently, physics that drift over a
few seconds, a weighted mesh that's half a pixel off. Then something "looked right in the editor".
Here's how Rigby2D keeps seven runtimes giving one answer. [中文版本](/blog/seven-runtimes-one-answer-zh.html).

## One reference

There is exactly one definition of how a Rigby2D animation plays: the JavaScript runtime in
[`src/core`](https://github.com/jaisurya-dev-art/rigby2d/tree/develop/src/core). It's the same code
the editor uses to show you your animation. Everything else either *is* that code or is checked
against it.

| Engine | What runs your animation | How it's checked |
| --- | --- | --- |
| Phaser | The JavaScript runtime itself | It is the reference |
| Cocos Creator | The JavaScript runtime itself | It is the reference |
| JavaScript (any web engine) | The JavaScript runtime itself | It is the reference |
| Rust | A port of it | Golden files, on every push |
| Defold | A C++ port | The same golden files, on every push |
| Godot | The Rust port, as a GDExtension | Golden files through Rust, plus headless tests of the nodes |
| Unity | A C# port (`Rigby2D.Core`) | Golden files, before every release |

## Golden files

A golden file is a recording. A script plays a skeleton with the JavaScript runtime through fixed
scenarios (every animation looping, a crossfade into a layered track with a queued animation,
every skin) and writes down everything it produces, frame by frame:

- the world transform of every bone,
- every vertex and colour of everything drawn,
- the draw order,
- every event, and exactly when it fired.

Each port then plays the same skeleton through the same scenarios and compares its numbers with the
recording. Not a screenshot diff that a blurry pixel can pass: the actual values.

## A millionth off, and the build fails

The rule every port must meet: positions and transforms within a relative error of one in a million
(1e-6), colours and timing within one in a billion (1e-9). Anything more, on any frame, fails the
test.

In practice the ports are far closer than that. On 16 sample rigs, exported both as JSON and as
binary `.skel` (about 3,500 frames, covering physics, path, transform and slider constraints,
meshes, skins, clipping and image sequences), the Rust runtime matches every value within 1e-10.
The demo scene, with NILA's hair physics and a parallax stage, matches within 1e-11. At that
precision, the difference is the rounding of the last digits of a 64-bit number.

## Every demo, on every push

The checked-in golden files are only the start. On every push, CI exports golden data from every
demo skeleton in the repository, in both formats, and runs the Rust and C++ runtimes against it.
A change to the JavaScript runtime that one port doesn't follow turns the build red the same day.
The Unity port runs the same golden tests with Unity's own .NET, and the Godot addon is tested
headless against results from the JavaScript runtime: bone transforms over an animation, event and
completion timing, tracks and queues, and a whole shot of the demo scene.

## Why it matters

This is what "production-ready" means here. When the [Godot runtime came out of
preview](/blog/defold-and-sprite-sheets.html) and [Defold arrived](/blog/defold-and-sprite-sheets.html),
neither got there on a screenshot that looked right. Each one passed the same recordings as every
other runtime.

It also means speed doesn't cost correctness. The Rust runtime animates a 143-bone rig with 21
constraints about four times faster than the JavaScript one, and still gives the same answer to ten
decimal places.

## Check it yourself

Everything is in the repository. Record your own skeleton and compare:

```bash
node runtimes/rust/rigby-runtime/tests/golden/generate.mjs /tmp/golden/hero.golden.json path/to/hero.skel
RIGBY_GOLDEN_DIR=/tmp/golden cargo test --release -p rigby-runtime --test golden
```

The details, including the speed of each rig, are in
[runtimes/README.md](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/README.md),
and every runtime is on [rigby2d.com/runtimes](/runtimes/).

Rigby2D 0.5 ships on Friday, Defold runtime included. Questions about any of this? Leave a comment
below, or ask on [r/rigby2d](https://www.reddit.com/r/rigby2d/).
