# Export

Games and apps load **skeleton exports**: the skeleton data plus a texture atlas. Your `.rigby` work
file stays the source; export again whenever it changes.

## Export commands

| Command | Writes |
| --- | --- |
| *File ▸ Export ▸ JSON + atlas…* (<kbd>Ctrl</kbd>+<kbd>E</kbd>) | `name.json` in the project's format version, `name.atlas`, `name.png` |
| *Export ▸ JSON format 3.8… / 4.2… / 4.3…* | The same, in that skeleton JSON version. |
| *Export ▸ Binary .skel + atlas (4.3)…* | Binary `name.skel` (smaller, faster to load), `name.atlas`, `name.png` |
| *Export ▸ Scene for runtimes…* (scenes only) | A [scene](scenes.md#in-games-and-apps): `name.scene.json`, plus the stage and each character as skeleton JSON 4.3 with their own atlas |

The images actually used are packed into one atlas page. Its filter follows the project's
**Textures** setting (`Linear` or, for pixel art, `Nearest`).

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

## Share to r/rigby2d

*File ▸ Share to r/rigby2d…* turns an animation into a clip for the community in one step:

1. Pick the animation, **GIF** (plays everywhere) or **MP4** (sharper and smaller, where the
   browser can encode video), the size (360 to 720 pixels on the longer side) and the frame rate.
   **Fit the animation** frames the character itself; a project with a fixed framing can keep it.
   GIFs sit on a background colour, or are transparent with hard edges.
2. Choose where to save the file. The clip is rendered (up to 20 seconds) and saved.
3. The new-post page of [r/rigby2d](https://www.reddit.com/r/rigby2d/) opens in your browser with
   the title filled in. Drop the file in, pick the **Showcase** flair and post.

GIFs use one palette for the whole clip and store only what changes between frames, so a short
loop is usually well under a megabyte.
