# Command line (rigby)

`rigby` runs editor operations from a terminal, with no window: inspect and validate projects,
convert and export them, import PSDs, rig artwork with AutoRig, run Python scripts and render
animations to video. Use it in build scripts, CI, batch jobs, or when you just prefer the terminal.

It runs the same code as the editor, the runtimes and the [MCP server](mcp.md), so a file it writes is
the file the editor would write.

## Setup

`rigby` comes with the Rigby2D source and runs on Node.js 20 or newer:

```bash
git clone https://github.com/jaisurya-dev-art/rigby2d.git
cd rigby2d
npm install
npx rigby --help
```

`node bin/rigby.js` works too. To have `rigby` everywhere, run `npm link` once in the folder.

Rendering uses the installed Rigby2D desktop app (0.6 or newer), Chromium for Playwright
(`npx playwright install chromium`), and for MP4 [ffmpeg](https://ffmpeg.org) with NVIDIA NVENC; see
[Rendering](#rendering).

## Commands

| Command | What it does |
| --- | --- |
| `rigby inspect <project>` | Summary: counts, animations, skins, constraints, film settings |
| `rigby rig <project>` | Bone hierarchy (setup pose), slots in draw order, skins |
| `rigby animation <project> <name>` | One animation: duration and the key times of every timeline |
| `rigby pose <project> [-a <anim>] [-t <s>]` | World transforms, attachments and bounds at a moment |
| `rigby validate <project>` | Checks for problems; exit code 1 when the project is invalid |
| `rigby convert <in> <out>` | `.rigby`, skeleton JSON (3.8 / 4.2 / 4.3) and `.skel`, any direction |
| `rigby export <project> --format … --out …` | Skeleton with a packed atlas, a Defold model, or sprite sheets |
| `rigby import-psd <file.psd>` | A layered PSD as a `.rigby` work file, one slot per layer |
| `rigby autorig <file.psd \| project.rigby>` | [AutoRig](autorig.md): bones, meshes, weights and IK in one step |
| `rigby run <project> --script <file.py>` | A [Python script](scripting.md) against a project, then save |
| `rigby render <project> --out <file>` | MP4, WebM, PNG sequence or GIF, drawn on the GPU |
| `rigby tools` / `rigby call <tool>` | Any [MCP tool](mcp-tools.md): keys, poses, audio, scenes, retargeting… |

A *project* is a `.rigby` work file or a skeleton `.json` / `.skel` export (with its `.atlas` or
`images` folder next to it, when images are needed). `rigby <command> --help` lists every option.

**Every command** takes `--json` to print its result as JSON for scripts (errors too, as
`{"error": "…"}`), and `-q` / `--quiet` to hide progress messages. Commands never replace an existing
file unless you pass `--force` (`-f`); output folders are created as needed.

**Exit codes:** `0` done, `1` failed (or `validate` found problems), `2` wrong usage.

## Inspecting and validating

```bash
rigby inspect hero.rigby
rigby rig hero.rigby
rigby animation hero.rigby walk --json
rigby pose hero.rigby --animation walk --time 0.5
rigby validate export/hero.skel
```

`validate` checks the structure, images missing from the work file or atlas, animations without
keys, that skeleton JSON 4.3 reproduces the data exactly, and that binary `.skel` export works. It exits
with code 1 when it finds errors, so it can stop a build:

```bash
rigby validate characters/hero.rigby || exit 1
```

## Converting and exporting

`convert` changes the format; the output extension picks it:

```bash
rigby convert hero.rigby hero.json --version 4.2   # skeleton data only
rigby convert hero.rigby hero.skel
rigby convert export/hero.json hero.rigby          # a work file holding the images
```

To `.json` or `.skel`, `convert` writes the skeleton data only, for when you keep an existing atlas.
To `.rigby`, it reads the export's images from its atlas or `images` folder, as the editor opens it.

`export` writes what games load, like *File ▸ Export*:

```bash
# Skeleton + atlas: hero.json, hero.atlas and hero.png
rigby export hero.rigby --out build/hero.json
rigby export hero.rigby --format skel --out build/hero.skel

# A Defold model (.rigbyskel, .atlas, images/, .rigbymodel, .go) in a Defold project
rigby export hero.rigby --format defold --out game/assets/hero --animation idle

# Sprite sheets for engines that play frames
rigby export hero.rigby --format spritesheet --out sheets --animation walk,run --fps 24 --scale 0.5
```

Sprite sheets take `--sheet json|defold|frames`, `--layout packed|grid`, `--padding`, `--max-width`,
`--pot`, `--no-trim`, `--no-dedupe` and `--no-loop`, as in [Export](export.md).

> [!NOTE]
> In Git Bash, a Defold path such as `--folder /assets/hero` is turned into a Windows path before
> `rigby` sees it. Write `//assets/hero`, or run the command from PowerShell or cmd.

## Artwork and rigging

```bash
rigby import-psd hero.psd                    # hero.rigby: one slot per layer, laid out as drawn
rigby autorig hero.psd --dry-run             # which body part each layer was taken for
rigby autorig hero.psd --out hero.rigby      # rigged in one step
rigby autorig hero.psd --role "Layer 7=none" --side "arm 2=l" --meshes all --force
```

`import-psd` follows *File ▸ Import PSD*: the canvas' bottom centre is the origin, and hidden layers
start hidden. `autorig` rigs a PSD into a new work file, or an unrigged `.rigby` in place (or into
`--out`). `--role layer=role` and `--side layer=l|r` correct what it detected.

## Python scripts

`run` runs a script with the editor's [`rigby` Python module](scripting.md) and saves the project.
`print()` output is shown; if the script raises, nothing is saved, the traceback is shown and the exit
code is 1.

```bash
rigby run hero.rigby --script tools/add_tail.py
rigby run hero.rigby tools/add_tail.py --out hero-tail.rigby
rigby run hero.rigby --code "import rigby; print([b.name for b in rigby.bones()])" --dry-run
```

`--animation` and `--time` set what `rigby.current_animation()` and `rigby.time()` return (the script
runs in Animate mode), `--select a,b` sets the selected bones, and `--dry-run` saves nothing.

## Rendering

`render` draws animations with the editor's own renderer and the project's output settings
(*File ▸ Output*), so files match *File ▸ Render animation*:

```bash
rigby render hero.rigby --animation walk --out renders/walk.mp4
rigby render hero.rigby --all --out renders/hero.webm          # hero_walk.webm, hero_run.webm…
rigby render hero.rigby --all --out renders/ --format png      # hero_walk_0000.png…
rigby render hero.rigby -a walk --skin red,blue --out "renders/{animation}-{skin}.gif"
rigby render hero.rigby -a walk --out walk.mp4 --width 1280 --height 720 --fps 24 --background #202020
```

| Format | Encoded by | Transparency |
| --- | --- | --- |
| `.mp4` (H.264) | ffmpeg `h264_nvenc` on the GPU (or the app's WebCodecs encoder) | no: black, or `--background` |
| `.webm` (VP9) | the editor's encoder | yes, unless there is a background |
| `.png` sequence | the editor's encoder | yes |
| `.gif` | the editor's encoder | one-bit |

Frames are always drawn by the GPU, by one of two engines:

- **app**: the Rigby2D desktop app, 0.6 or newer, renders in a hidden window and exits. It is the
  same renderer and the same encoders as its Render dialog, so the files are the ones the dialog
  writes. Video is encoded by the app's web view (WebCodecs), which may encode H.264 on the CPU.
- **chromium**: headless Chromium through Playwright, on the dedicated graphics card. MP4 frames are
  encoded by ffmpeg with NVIDIA NVENC (`h264_nvenc`), so it needs an NVIDIA card and an ffmpeg build
  with NVENC: set its path with `--ffmpeg` or the `RIGBY_FFMPEG` environment variable.

By default WebM, PNG and GIF render in the app when it is installed, and MP4 goes to ffmpeg with
NVENC when there is one, so the H.264 encode runs on the GPU too; without the app (on CI machines,
say) everything uses Chromium. `rigby` says which engine it used. Choose one with `--engine app` or
`--engine chromium`; `--app <path>` also picks the app. The app is
looked for in `RIGBY2D_APP`, on `PATH`, then where the installers put it (`%LOCALAPPDATA%\Rigby2D` or
`Program Files\Rigby2D` on Windows, `/Applications` on macOS, `/usr/bin` on Linux); `--app <path>`
names one, such as a development build. An app older than 0.6 has no render mode and is skipped.

Either engine stops with an error if it would draw on the CPU (software rendering); pass
`--allow-software` to render slowly anyway.
WebM's VP9 is encoded on the CPU by both engines, since most GPUs (GeForce GTX 16 series included)
have no VP9 encoder. MP4 and WebM include the animation's audio tracks, and every render gets the
mixed audio next to it as a `.wav`, as the Render dialog writes it.

The app's render mode can also be run by itself:

```bash
start /wait Rigby2D.exe --render hero.rigby --animation walk --out walk.mp4 > report.jsonl
```

It takes the same options as `rigby render`, opens no window, and leaves an editor that is already
open alone (it runs as a separate process). It reports as JSON lines on standard output (on Windows
only when the output is redirected, as above or by `rigby`), and exits with 0 when done or 1 on
failure.

Other options: `--quality high|medium|low` for video, and `--start` / `--end` (frame numbers) for
a single render.

## Anything else: MCP tools

Every [MCP tool](mcp-tools.md) runs from the command line with `rigby call`. `rigby tools` lists them
and `rigby call <tool> --help` shows a tool's arguments. Give arguments as `--name value` (values that
read as JSON are JSON: numbers, `true`, `[lists]`, `{objects}`), as one JSON object, or from a file:

```bash
rigby call add_bone --path hero.rigby --name tail --parent hip --x -40 --length 80
rigby call set_bone_key --path hero.rigby --animation wag --bone tail --channel rotate --time 0.5 --value 25
rigby call retarget_animation '{"path": "hero.rigby", "source": "walker.rigby", "animation": "walk"}'
rigby call batch_edit --args-file edits.json
```

With `call`, paths may be anywhere on disk: unlike the MCP server, the command line is not limited to
workspace folders.

## In scripts and CI

```bash
set -e
for f in characters/*.rigby; do
  rigby validate "$f"
  name=$(basename "$f" .rigby)
  rigby export "$f" --format skel --out "build/$name/$name.skel" --force
done
rigby inspect characters/hero.rigby --json | jq '.animations[].name'
```
