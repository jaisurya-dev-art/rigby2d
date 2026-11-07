# Export

Games and apps load **skeleton exports**: the skeleton data plus a texture atlas. Your `.rigby` work
file stays the source; export again whenever it changes.

## Export commands

| Command | Writes |
| --- | --- |
| *File ▸ Export ▸ JSON + atlas…* (<kbd>Ctrl</kbd>+<kbd>E</kbd>) | `name.json` in the project's format version, `name.atlas`, `name.png` |
| *Export ▸ JSON format 3.8… / 4.2… / 4.3…* | The same, in that skeleton JSON version. |
| *Export ▸ Binary .skel + atlas (4.3)…* | Binary `name.skel` (smaller, faster to load), `name.atlas`, `name.png` |
| *Export ▸ Sprite sheet…* | Animations rendered as frames: a packed sheet with its data, a Defold atlas with frames, or PNG frames. See [Sprite sheets](#sprite-sheets). |
| *Export ▸ Scene for runtimes…* (scenes only) | A [scene](scenes.md#in-games-and-apps): `name.scene.json`, plus the stage and each character as skeleton JSON 4.3 with their own atlas |

The images actually used are packed into one atlas page. Its filter follows the project's
**Textures** setting (`Linear` or, for pixel art, `Nearest`).

## Sprite sheets

For engines and tools that play frames instead of bones (or to hand an animation to a 2D artist),
*File ▸ Export ▸ Sprite sheet…* renders the chosen animations frame by frame.

| Format | Writes | For |
| --- | --- | --- |
| **JSON hash + PNG** | `name.png` and `name.json` (or several sheets, below): TexturePacker's JSON hash with each frame's duration and a pivot at the skeleton's origin, Aseprite's `frameTags` (one per animation) and PixiJS's `animations` lists | Phaser, PixiJS, Godot and Unity importers, anything that reads TexturePacker or Aseprite JSON |
| **Defold atlas + frames** | `name/<animation>_000.png` … and `name.atlas` with one animation per animation, at the frame rate | Defold sprites (put the folder and the atlas at the project root, or edit the paths) |
| **PNG frames** | `name/<animation>_000.png` … | Video tools, other engines |

- **Frame rate**, **size** (25 % to 200 %) and **skin** are yours to pick. All frames share one
  canvas, so the character's origin stays on the same pixel in every frame.
- **Loops**: the last frame, which repeats the first, is left out, and physics plays the loop once
  before the frames are taken, so hair and cloth carry over from the last frame into the first.
- **Sheets** are packed tight or laid out in a grid, with padding, trimmed to each frame's visible
  pixels (the JSON keeps where each frame sits on the full canvas), and identical frames are stored
  once. **Power-of-two sheet sizes** round each sheet up for engines and GPUs that need them.
- **Max sheet size** is the largest side of each sheet: 2048 loads on every phone, 4096 on most
  devices, 16384 on desktop GPUs. Frames that don't fit go on more sheets: `name-0.png` +
  `name-0.json`, `name-1.png` + `name-1.json` … (each JSON names the others in
  `related_multi_packs`, so PixiJS loads them all from the first), and `name.json`, a multi-atlas
  over every sheet for Phaser's `load.multiatlas`. When everything fits, you get one `name.png` and
  `name.json` as before.
- **Before you export**, the dialog shows the frame size and how many sheets it will take at most,
  and the largest size that fits on one sheet.

Frames are drawn on the GPU when there is one (WebGL), and by a renderer built into Rigby2D
otherwise (the same one the [MCP server](mcp.md) uses), with two-color tint and every blend mode, so
a sheet looks the same wherever it is made.
- **Pixel art**: with the project's **Textures** set to `Nearest`, frames are sampled without
  smoothing, one sample per pixel.

## What is exported

Bones, slots, skins, all attachment types, IK, transform, path, physics and slider constraints,
events, and every animation with bone, slot, deform, sequence, constraint, draw-order and event keys.
Import and export are lossless: a file opened and exported again keeps its data.

Not exported (editor-only, kept in `.rigby`): film output settings, poses and face controls, audio
tracks and the workspace. What they produced (keys) is exported.

> [!NOTE]
> Binary `.skel` covers format 4.3 rigs. Rigs using features it cannot hold (point attachments,
> separate RGB / alpha color keys) export to `.json` instead; `validate_project` in the
> [MCP server](mcp.md) tells you before you try.

## Opening exports

*File ▸ Open* also imports `.json` and `.skel` exports (with their `.atlas` or an `images` folder),
in the Game workspace. Save them as `.rigby` to keep working.

Next: [play the export in your game](runtimes.md).

## Share to Discord

*File ▸ Share to Discord…* turns an animation into a clip for the community in one step:

1. Pick the animation, **GIF** (plays everywhere) or **MP4** (sharper and smaller, where the
   browser can encode video), the size (360 to 720 pixels on the longer side) and the frame rate.
   **Fit the animation** frames the character itself; a project with a fixed framing can keep it.
   GIFs sit on a background colour, or are transparent with hard edges.
2. Choose where to save the file. The clip is rendered (up to 20 seconds) and saved.
3. The **#showcase** forum of the [Rigby2D Discord](https://discord.gg/PGgaTwbNH) opens. Start a post,
   drop the file in, pick a tag and post. (First time? Join with the link above.)

GIFs use one palette for the whole clip and store only what changes between frames, so a short
loop is usually well under a megabyte.
