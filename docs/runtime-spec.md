# Runtime specification

This page is for anyone writing a Rigby2D runtime for a new engine or language. It covers what a
runtime loads, how to turn that data into a pose, and how to check the result against the
reference runtime.

The reference implementation is [`src/core`](https://github.com/jaisurya-dev-art/rigby2d/tree/main/src/core)
(JavaScript, no dependencies). Every official runtime (Unity, Godot, Defold, Cocos Creator, Phaser,
JavaScript and Rust) follows it, and the Rust and Defold runtimes are tested against it frame by
frame. When this page and `src/core` disagree, `src/core` is right. Please
[open an issue](https://github.com/jaisurya-dev-art/rigby2d/issues) so this page can be fixed.

## What a runtime loads

| File | Contents |
| --- | --- |
| `name.json` | Skeleton JSON: bones, slots, skins, constraints, events and animations. |
| `name.skel` | The same data in binary (format 4.3). Optional; JSON alone is enough. |
| `name.atlas` + pages | The packed images. Each region is named after the attachment image it holds. |
| `name.scene.json` | Optional: a scene of several skeletons (see [File formats](file-formats.md#scene-manifest-scenejson)). |

Rigby2D writes the widely used skeleton JSON format in versions 3.8, 4.2 and 4.3. A new runtime
should start with **4.2**, which this page describes. The header's version field says which version
a file uses. [4.3 differences](#format-43) are listed at the end.

The editor's `.rigby` work file (a ZIP with `project.json`) is for the editor only. Runtimes never
load it.

## Conventions

- Units are pixels of the artwork at scale 1. Y points **up**. A runtime for a Y-down engine flips Y
  once, at the end, when drawing.
- Angles are in degrees, counterclockwise. Times are in seconds.
- Colors are hex strings: `RRGGBBAA` (slot and attachment colors) or `RRGGBB` (dark colors).
  Missing colors are white.
- Optional fields are left out when they hold their default value. Every default is listed below.
- Ignore fields you don't recognize rather than failing.

## Skeleton JSON

### Header

```json
{ "skeleton": { "hash": "", "spine": "4.2.0", "x": -120, "y": 0, "width": 240, "height": 410, "fps": 30 } }
```

`x`, `y`, `width` and `height` are the setup pose's bounds. `fps` is the frame rate keys were made
at (default 30), which is informational only: keys are stored in seconds.

### Bones

An array, ordered so every bone comes after its parent. The first bone is the root.

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | | Unique name. |
| `parent` | none | Parent bone's name. Only the root has none. |
| `length` | 0 | Length along the bone's X axis (for IK and drawing only). |
| `x`, `y` | 0 | Position in the parent's space. |
| `rotation` | 0 | Degrees. |
| `scaleX`, `scaleY` | 1 | Scale. |
| `shearX`, `shearY` | 0 | Degrees. Tilt the bone's X and Y axes separately. |
| `inherit` | `normal` | What the bone takes from its parent (see [World transforms](#world-transforms)). |
| `skin` | false | The bone is only active while a skin that lists it is active. |

### Slots

An array in **draw order**, back to front.

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | | Unique name. |
| `bone` | | The bone the slot follows. |
| `color` | `FFFFFFFF` | Tint multiplied into the attachment. |
| `dark` | none | Dark color for two-color tinting. |
| `attachment` | none | Name of the attachment shown in the setup pose. |
| `blend` | `normal` | `normal`, `additive`, `multiply` or `screen`. |

### Skins and attachments

`skins` is an array. The skin named `default` is always active. At most one other skin is active
at a time. To find a slot's attachment, look in the active skin first, then in `default`.

```json
{ "name": "default", "attachments": { "slotName": { "attachmentName": { "type": "region", "...": "..." } } } }
```

Each attachment's image is its `path` if given, otherwise its name. Look the image up by that name
in the atlas.

**Region** (`type` left out or `region`): a rectangle centred on its offset.

| Field | Default | Meaning |
| --- | --- | --- |
| `x`, `y`, `rotation`, `scaleX`, `scaleY` | 0, 0, 0, 1, 1 | Offset from the slot's bone. |
| `width`, `height` | | Size in pixels. |
| `color` | `FFFFFFFF` | Multiplied with the slot color. |

**Mesh** (`type: "mesh"`):

| Field | Meaning |
| --- | --- |
| `uvs` | Texture coordinates, an `[u, v, ...]` pair per vertex, 0 to 1 across the region. |
| `triangles` | Vertex indices, three per triangle. |
| `vertices` | Unweighted: an `[x, y, ...]` pair per vertex, in the slot bone's space. Weighted: see below. |
| `hull` | The number of vertices on the outline (editor only). |

A mesh is **weighted** when `vertices` is longer than `uvs`. Then, for each vertex in turn:

```
boneCount, then boneCount times: boneIndex, x, y, weight
```

Here `x, y` is the vertex in that bone's space. The weights of each vertex add up to 1.

**Linked mesh** (`type: "linkedmesh"`): uses the geometry of the mesh `parent` in skin `skin`
(default: the same skin) with its own image. If `deform` is false, it ignores the parent's deform
keys.

`boundingbox`, `path`, `point` and `clipping` attachments are not drawn. A runtime may skip them,
except for clipping, which masks the slots up to its `end` slot.

### Events

`events` maps an event name to its default values: `int`, `float`, `string`, `audio`, `volume`
(default 1) and `balance`. Event keys in animations may override them.

## World transforms

Each bone has a local transform built from its fields. The local matrix (columns `a b` and `c d`,
translation `tx ty`) is:

```
rx = rotation + shearX          ry = rotation + 90 + shearY
a = cos(rx) * scaleX            c = cos(ry) * scaleY
b = sin(rx) * scaleX            d = sin(ry) * scaleY
tx = x                          ty = y
```

A point `(px, py)` maps to `(a*px + c*py + tx, b*px + d*py + ty)`.

The root's world matrix is its local matrix. Every other bone's world matrix combines the
parent's world matrix `P` with the bone's local matrix `L`, depending on `inherit`:

- `normal`: `P * L`.
- For every other mode, the position always follows the parent:
  `tx = P.a*L.tx + P.c*L.ty + P.tx` and `ty = P.b*L.tx + P.d*L.ty + P.ty`.
  Only the linear part `Q * L`, with `Q` replacing `P`'s linear part, depends on the mode.
  With `s = hypot(P.a, P.b)`, `det = P.a*P.d - P.b*P.c`, and `ux, uy` equal to `P.a/s, P.b/s`:

| `inherit` | `Q` as `[a, b, c, d]` |
| --- | --- |
| `onlyTranslation` | `[1, 0, 0, 1]` |
| `noRotationOrReflection` | `[s, 0, 0, abs(det)/s]` |
| `noScale` | `[ux, uy, -uy*f, ux*f]` with `f = -1` if `det < 0`, else 1 |
| `noScaleOrReflection` | `[ux, uy, -uy, ux]` |

Treat `s` below `1e-12` as 0. Then `ux, uy` are `1, 0`, and `abs(det)/s` is 0.

## Drawing

Draw the slots in draw order. For each slot with an attachment:

- **Region:** the attachment matrix is `bone world * offset local` (the offset fields, built like
  a bone's local matrix). The corners are `(-w/2, h/2)`, `(w/2, h/2)`, `(w/2, -h/2)` and
  `(-w/2, -h/2)`, which are top-left, top-right, bottom-right and bottom-left. Their UVs are
  `(0,0)`, `(1,0)`, `(1,1)` and `(0,1)`.
- **Unweighted mesh:** each vertex (plus its deform offset) is mapped by the slot bone's world matrix.
- **Weighted mesh:** each vertex is the sum, over its bones, of
  `weight * boneWorld(x + deformX, y + deformY)`. Deform offsets come two per bone entry, in order.
- **Color:** slot color times attachment color. Map the region UVs into the atlas region.

## Animations

`animations` maps a name to its timelines. An animation's duration is the time of its last key.

### Keys and curves

Each key has a `time` (default 0) and a `curve` for the change to the next key:

- left out: linear.
- `"stepped"`: hold the value until the next key.
- an array of four numbers per value, `[cx1, cy1, cx2, cy2, ...]`: a cubic bezier from this key
  to the next. `cx` is in seconds and `cy` in the value's own units. To get the eased fraction,
  normalize them: `x = (cx - t1) / (t2 - t1)` and `y = (cy - v1) / (v2 - v1)`. Solve `x(t)` for
  the elapsed fraction, then evaluate `y(t)`. Values with two parts (`translate`, `scale`, `shear`)
  have a bezier each. If `v1` equals `v2`, the value doesn't change and the curve doesn't
  matter.

Before the first key, use the first key's value. After the last key, use the last key's value.

### Bone timelines

`animations.<name>.bones.<bone>` holds:

| Timeline | Value fields | Applied as |
| --- | --- | --- |
| `rotate` | `value` (default 0) | `setup rotation + value` |
| `translate` | `x`, `y` (default 0) | `setup x + x`, `setup y + y` |
| `translatex`, `translatey` | `value` | One axis of the same. |
| `scale` | `x`, `y` (default 1) | `setup scaleX * x`, `setup scaleY * y` |
| `scalex`, `scaley` | `value` | One axis of the same. |
| `shear` | `x`, `y` (default 0) | `setup shearX + x`, `setup shearY + y` |
| `shearx`, `sheary` | `value` | One axis of the same. |
| `inherit` | `inherit` | Changes the bone's `inherit` mode (held, not blended). |

Rotation is interpolated as plain numbers, without wrapping. Keys stay relative to the setup pose,
so the setup pose can change without breaking animations.

### Slot timelines

`animations.<name>.slots.<slot>` holds `attachment` (`name`, or none for empty), `rgba` (`color`),
`rgb` (`color`), `alpha` (`value`), `rgba2` (`light`, `dark`) and `rgb2` (`light`, `dark`).
Colors are interpolated per channel.

### Deform, draw order and events

- **Deform:** `animations.<name>.attachments.<skin>.<slot>.<attachment>.deform` is a list of keys,
  each with `offset` (default 0) and `vertices`. The vertices are sparse offsets starting at index
  `offset`, and every value not listed is 0. Interpolate the expanded arrays, then add them to the
  mesh vertices, or to each bone entry for a weighted mesh.
- **Draw order:** `drawOrder` keys hold `offsets`, a list of `{ slot, offset }` that move slots
  from their setup index. A key without offsets returns to the setup order. To build the order,
  go through the listed slots by setup index and put each at `index + offset` if that place is
  free. Then fill the empty places, from the back, with the remaining slots in reverse setup order.
- **Events:** `events` keys hold `name` and any value overrides. Fire each one once when playback
  passes its time.

### Constraints

`ik` (with `transform`, `path` and `physics`) lists the constraints. Each carries an `order`, and
they are applied in that order, after the animated world transforms are computed. An IK constraint
rotates one or two `bones` toward `target`, with `mix`, `softness`, `bendPositive`, `compress`,
`stretch` and `uniform`. IK keys animate those values.

The exact math for each constraint type is in
[`pose.js`](https://github.com/jaisurya-dev-art/rigby2d/blob/main/src/core/pose.js) (`solveIk`)
and [`constraints.js`](https://github.com/jaisurya-dev-art/rigby2d/blob/main/src/core/constraints.js).
A runtime can start with IK alone: skeletons without other constraints will still match.

## Playing animations

To pose a skeleton for one frame:

1. Reset every bone, slot color, attachment and draw order to the setup pose.
2. Apply each track's animation at its current time, in track order, with a weight `alpha`.
   At `alpha` 1 a value replaces the current one. Below 1 it is blended:
   `current + (value - current) * alpha`. Attachments, draw order and `inherit` change only when
   `alpha` is at least 0.5.
3. Compute the world transforms, then apply the constraints.
4. Draw.

A looping animation plays at `time mod duration`. A non-looping one stops at `duration`. To
crossfade over `mix` seconds, apply the old animation at full weight, then the new one with
`alpha = min(1, elapsed / mix)`.

[`state.js`](https://github.com/jaisurya-dev-art/rigby2d/blob/main/src/core/state.js) has the
reference for tracks, queues and events.

## Checking your runtime

The Rust runtime is checked against golden files recorded from the reference runtime:
[`runtimes/rust/rigby-runtime/tests/golden`](https://github.com/jaisurya-dev-art/rigby2d/tree/main/runtimes/rust/rigby-runtime/tests/golden).
Each frame records the bone world matrices `[a, b, c, d, tx, ty]`, the draw order, every drawn
quad and mesh with its positions and color, and the events fired.

To record golden data for any skeleton:

```bash
node runtimes/rust/rigby-runtime/tests/golden/generate.mjs out.golden.json path/to/skeleton.json
```

Then play the same skeleton in your runtime and compare frame by frame. The Rust runtime matches
within `1e-6`.

## Format 4.3

4.3 files are the same as 4.2, except:

- All constraints are in one `constraints` array, already in application order, each with a
  `type` (`ik`, `transform`, `path`, `physics` or `slider`).
- A linked mesh names its source mesh with `source` instead of `parent`, and uses `timelines`
  instead of `deform`.

## Publishing a runtime

If you write a runtime, tell us on [Discord](https://discord.gg/PGgaTwbNH) or in an
[issue](https://github.com/jaisurya-dev-art/rigby2d/issues). Once it passes the golden tests, we'll
list it on the [runtimes page](https://rigby2d.com/runtimes/). Any license is fine. The reference
runtime is MIT or Apache-2.0, so you can port it freely.
