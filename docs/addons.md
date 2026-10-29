# Add-ons

Add-ons extend the editor with Python, like Blender's add-ons. An add-on is a [Python script](scripting.md)
packaged so anyone can install it: its tools appear in the **Scripts** menu, and it loads every time
the editor starts.

## Installing

From the gallery:

1. *Edit ▸ Preferences ▸ Add-ons ▸ Get add-ons*.
2. Choose **Install** next to an add-on. It is downloaded, installed and enabled. **Update** appears
   when a newer version is listed.

The gallery is also on the website: [rigby2d.com/addons](https://rigby2d.com/addons/).

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
| `author`, `description` | no | Shown in the Add-ons page. |
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

### Listing your add-on in the gallery

Publish the `.zip` somewhere stable (a GitHub release is ideal), then open a pull request that adds
an entry to [addons/gallery.json](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/addons/gallery.json):

```json
{
  "id": "my_tool",
  "name": "My tool",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What it does, in one sentence.",
  "url": "https://github.com/you/my-tool/releases/download/v1.0.0/my_tool.zip",
  "repo": "https://github.com/you/my-tool"
}
```

The `id` and `version` must match the add-on's folder name and `addon_info`. In the browser editor,
the gallery can only download add-ons hosted on rigby2d.com; the desktop app downloads from any
listed address.

### Testing while you write

Develop the code in the script editor (*Scripts ▸ Script editor…*). Then zip the folder and install
it. Installing the zip again replaces the add-on with your new version.
