# Add-ons

Add-ons extend the editor with Python, like Blender's add-ons. An add-on is a [Python script](scripting.md)
packaged so anyone can install it: its tools appear in the **Scripts** menu, and it loads every time
the editor starts.

## Installing

From the gallery:

1. *Edit ▸ Preferences ▸ Add-ons ▸ Get add-ons*.
2. Choose **Install** next to an add-on. It is downloaded, installed and enabled. **Update** appears
   when a newer version is listed.

The gallery is also on the website, with search, tags and a page for each add-on:
[rigby2d.com/addons](https://rigby2d.com/addons/). Downloads from the gallery are checked against the
checksum the website lists.

From a file: *Edit ▸ Preferences ▸ Add-ons ▸ Install from file…*, then pick the add-on's `.zip` or
`.py` file.

Turn an add-on off with its checkbox, or delete it with **Remove**. Installing a newer version of an
add-on asks to replace the old one.

Add-ons run in the same sandbox as [scripts](scripting.md): they can change the open project, but
not your files or the network. They can still change your project in ways you didn't expect, so
prefer add-ons from people you trust, and keep backups on (Preferences ▸ Files and recovery).

## Official add-ons

| Add-on | What it does |
| --- | --- |
| Mirror tools | Mirrors the selected bones across X = 0, and swaps left and right in bone names (`arm_l` ↔ `arm_r`). |
| Breathing idle | Makes a looping "breathe" animation from the chest, spine or selected bones, with the head following. |
| Rig report | Lists possible problems before export (empty slots, unused bones, look-alike names, empty animations) in *View ▸ Log*. |

Their source is in the [addons folder](https://github.com/jaisurya-dev-art/rigby2d/tree/develop/addons)
of the repository, and makes good examples.

## Where add-ons are installed

Each add-on is unpacked into its own folder, named after its id:

- **Desktop:** the `addons` folder in the app's data. On Windows:
  `%LOCALAPPDATA%\io.github.jaisurya-dev-art.rigby2d\addons\<id>\`. On macOS:
  `~/Library/Application Support/io.github.jaisurya-dev-art.rigby2d/addons/<id>/`. On Linux:
  `~/.local/share/io.github.jaisurya-dev-art.rigby2d/addons/<id>/`.
- **Browser:** the site's storage for this browser (IndexedDB).

The Add-ons page shows the folder. Next to the add-on's code, the editor keeps `rigby-addon.json`
with the details it read when installing.

## Writing an add-on

An add-on is a Python package, shipped as either:

- **a `.py` file**: one module. `mirror_tools.py` installs as the add-on `mirror_tools`.
- **a `.zip` file**: a package folder with `__init__.py` and any other modules and files it needs.
  The folder can be at the top of the zip or inside one folder, as GitHub's *Download ZIP* makes
  them. The folder name becomes the add-on's id (`mirror-tools-main` → `mirror_tools_main`).

```
mirror_tools/
  __init__.py      addon_info, register(), unregister()
  ops.py           more modules, imported with `from . import ops`
```

The main module (`__init__.py`, or the `.py` file) describes the add-on with `addon_info`, and can
define `register()` and `unregister()`:

```python
addon_info = {
    "name": "Mirror tools",
    "version": (1, 0, 0),
    "author": "Your name",
    "description": "Mirror bones and animations across X = 0.",
    "rigby": (0, 4, 0),          # the oldest Rigby2D it works with
    "url": "https://github.com/you/mirror-tools",
}

import rigby


def register():
    @rigby.tool("Mirror selected bones", description="Flip the selected bones across X = 0")
    def mirror():
        for b in rigby.selected_bones():
            b.x, b.rotation = -b.x, 180 - b.rotation


def unregister():
    pass  # tools are removed for you
```

| `addon_info` key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Shown in the Add-ons page. |
| `version` | no | A tuple such as `(1, 2, 0)`, or a string. |
| `author`, `description` | no | Shown in the Add-ons page. Needed to [publish](#publishing). |
| `rigby` | no | The oldest editor version the add-on needs. Older editors refuse to install it. |
| `url` | no | A documentation link, shown as **Docs**. |

`addon_info` is read without running your code, so keep it a plain dictionary of text, numbers and
tuples.

- **Enabling** imports the package and calls `register()`. Tools made with `@rigby.tool` appear in
  the **Scripts** menu.
- **Disabling** calls `unregister()` and removes the add-on's tools.
- Each run of a tool is one undo step, and an error rolls the project back, as with scripts. Errors
  go to *View ▸ Log*.

The add-on uses the same `rigby` API as scripts: see the [API reference](scripting.md#api-reference).

### Testing while you write

Develop the code in the script editor (*Scripts ▸ Script editor…*). Then zip the folder and install
it. Installing the zip again replaces the add-on with your new version.

## Publishing

Publishing is free. Your add-on stays in your own GitHub repository; the add-on registry lists it on
[rigby2d.com/addons](https://rigby2d.com/addons/) and in every editor's gallery, and picks up each
new release by itself, the way the ComfyUI registry follows custom nodes.

1. **Put it on GitHub.** A public repository with `__init__.py` (and `addon_info`) at its top, or in
   one folder, and a `LICENSE` file. A `README.md` becomes the add-on's page on the website.
2. **Publish a release.** Tag it (`v1.0.0`) and publish a GitHub release. Attach a `.zip` of the
   package, or attach nothing and the tag's source zip is used. A repository without releases offers
   its default branch instead.
3. **Submit it** with the [Submit an add-on](https://github.com/jaisurya-dev-art/rigby2d/issues/new?template=addon-submission.yml)
   form: the repository, an optional id, and tags. Checks run at once and answer in a comment.
4. **Review.** A maintainer reads the code and labels the issue `approved`. The add-on is added to
   the registry and appears on the website and in the editor after the next site build.
5. **Updates.** Raise `version` in `addon_info` and publish a new release. The registry checks new
   releases every six hours.

### What the checks look at

Every version is checked before it is listed, without running it:

- `__init__.py` has an `addon_info` with `name`, `author`, `description` and a numeric `version`
  such as `(1, 2, 0)`.
- Only Python, text, data and image files (no native libraries, which cannot load in the sandbox
  anyway), at most 300 files and 5 MB.
- The id is 2-40 lowercase letters, digits and `_`, and not taken by another add-on.

A release that fails the checks is skipped, and earlier versions stay listed. The website mirrors
the newest good version and records a hash of its files, so the copy that people install is the one
that was checked; the editor verifies the download against the gallery's checksum.

### The registry files

The registry lives in [registry/](https://github.com/jaisurya-dev-art/rigby2d/tree/develop/registry)
in the Rigby2D repository. Each add-on has an entry, `registry/addons/<id>.json`:

```json
{
  "repo": "you/my-tool",
  "publisher": "you",
  "tags": ["rigging", "export"],
  "added": "2026-11-02"
}
```

Tags are `rigging`, `animation`, `mesh`, `export`, `import`, `film`, `workflow` and `utility`.
`registry/index.json` holds the versions found, written by `node registry/sync.mjs`. You can also
open a pull request that adds an entry instead of using the form; the same checks run on it.

