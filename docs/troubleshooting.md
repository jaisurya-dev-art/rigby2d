# Troubleshooting

| Problem | Solution |
| --- | --- |
| My change vanished when I moved the time cursor. | In Animate mode, changes must be keyed (<kbd>K</kbd>) or *Auto key* turned on. Unkeyed changes are discarded when the time, animation or mode changes. |
| I can't create bones. | Bones are created in Setup mode: press <kbd>Tab</kbd>. |
| An image won't move with the tools. | Only image (region) attachments can be placed; meshes follow their bones. Image placement is setup-pose only: animate the bone instead. |
| An elbow or knee bends the wrong way. | Select the IK constraint and flip **Bend**. |
| A mesh creases at a joint. | Paint a softer weight blend across the joint. See [Weights](meshes.md#weights). |
| Hair or earrings don't swing. | Physics only runs while the animation plays. |
| Pixel art looks blurry. | Turn on **Pixel grid** (or just set **Textures** to *Pixel art (nearest)*) in the Project panel. New projects do this by themselves when the first art imported is pixel art. |
| Rotated pixel art has tilted, mixed-size pixels. | Turn on **Pixel grid** in the Project panel (see [Pixel grid](importing-art.md#pixel-grid)). |
| Export to `.skel` refused. | The rig uses a feature `.skel` can't hold; export JSON instead. |
| MP4 has a black background. | MP4 has no transparency: set a background color, or render WebM or PNG. |
| Lip-sync transcription is slow the first time. | The speech model (about 77 MB) downloads once, then it is cached. |
| Windows warns about the download. | The builds are not code-signed yet: compare the SHA-256 checksum, then *More info ▸ Run anyway*. |
| A script failed. | The project is left untouched; the traceback is in *View ▸ Log*. |
| The MCP server doesn't start. | Run `node src/mcp/server.js --help`; start it with `node`, not `npm run`. See [MCP](mcp.md). |

Still stuck? *View ▸ Log* → **Copy**, and [open an issue](https://github.com/jaisurya-dev-art/rigby2d/issues)
with it.
