# Preferences

*Edit ▸ Preferences* (**Ctrl+,**) holds the editor's settings. They apply to every project and are
saved as you change them. **Reset page** puts the settings of the page you are on back to their
defaults.

## General

| Setting | What it does |
| --- | --- |
| Language | The language of menus and dialogs: English, 日本語, 简体中文, 한국어, Español or Português (Brasil). *System* follows your computer. Some panels are still in English. |
| Welcome screen | Shows the welcome screen at startup: new projects, recent work, starter projects and lessons. *Help ▸ Welcome screen* opens it any time. |
| Check for updates | Looks for a new version when the editor starts and every few hours, and shows **Update available** in the menu bar (desktop app). See [Installation](installation.md#updates). |

## Interface

| Setting | What it does |
| --- | --- |
| Interface scale | Size of all text and controls, from 75% to 200% (desktop app). In the browser, use the browser's zoom. |
| Keyboard shortcuts | The Reference keys, or keys that follow Blender. See [Shortcuts](shortcuts.md). |
| Viewport drawing | WebGL, or Canvas 2D for graphics drivers that have trouble with WebGL. |
| New projects | The workspace (Game or Film) that *File ▸ New* starts in. |

## Editing

| Setting | What it does |
| --- | --- |
| Undo steps | How many steps *Edit ▸ Undo* can go back (20 to 1000, 200 by default). More steps use more memory on large projects. |

## Files and recovery

| Setting | What it does |
| --- | --- |
| Backup versions | How many previous versions Save keeps next to the file (0 to 9, 1 by default): `walk.rigby1`, `walk.rigby2` … |
| Auto-save | Keeps a copy of unsaved work, offered back after a crash. |
| Auto-save every | How often, in minutes (2 by default). |
| Reopen the last project | Opens the most recent project when the editor starts (desktop app). |

See [Saving and recovery](recovery.md) for how backups and auto-saves work.

## Add-ons

Installs, enables, disables and removes [add-ons](addons.md):

- **Install from file…** takes an add-on `.zip` or `.py` file and enables it.
- The checkbox turns an add-on on or off. Its tools appear in, or leave, the **Scripts** menu.
- **Remove** deletes the add-on.

An add-on that fails to load is shown in red, with the reason (the details are in *View ▸ Log*).

## Where preferences are kept

Preferences are stored with the editor's own data: on the desktop in the app's data, in the browser
in the site's storage for this browser. Clearing the browser's site data resets them.
