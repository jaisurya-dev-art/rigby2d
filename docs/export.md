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
