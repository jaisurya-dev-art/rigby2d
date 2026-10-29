# Saving and recovery

Rigby2D is built so that a crash, a power cut or a closed window never costs more than a few
minutes of work.

## Safe saves

On the desktop, Save writes the new file next to the old one first (`walk.rigby.saving`) and then
swaps it in, in one step. If anything goes wrong while saving, such as a full disk or a crash, the
file you had stays complete.

## Backups: walk.rigby1

Each save keeps the previous version next to the file, as Blender does with `.blend1`:

| File | Is |
| --- | --- |
| `walk.rigby` | the file you saved last |
| `walk.rigby1` | the version before that |
| `walk.rigby2` | the one before that (when you keep 2 or more) |

*Edit ▸ Preferences ▸ Files and recovery ▸ Backup versions* sets how many are kept (1 by default,
up to 9, 0 for none). To go back to a backup, open it with *File ▸ Open* (choose the
*Rigby2D backup* file type). A backup opens as a copy: Save asks where to keep it, so the backup
itself is never overwritten.

Backups are made by the desktop app. In the browser, files are downloaded or written to a folder
you pick, without backups.

## Auto-save

While you have unsaved changes, the editor keeps a copy of your work every 2 minutes (change it in
Preferences) in its recovery folder. The copy is deleted as soon as you save, so it never clutters
your projects.

## After a crash

If the editor crashes, is killed or the computer goes down, the next start offers the work back:

- **Recover** opens the auto-saved work as an unsaved project, tied to its original file: Save
  writes it there (and keeps the old version as `.rigby1`).
- **Later** keeps it for *File ▸ Recover*.
- **Discard** deletes it.

Several editors can run at the same time (several browser tabs, for example); only work from an
editor that is really gone is offered.

## Closing with unsaved changes

Closing the desktop app (or *File ▸ Quit*) with unsaved changes asks **Save**, **Don't save** or
**Cancel**. Work you chose not to save is still kept until the next time you quit: *File ▸ Recover ▸
Last session* brings it back.

In the browser, the page asks before it closes. If it closes anyway, its last auto-save is offered
back the next time you open the editor.

## When something goes wrong

When the editor runs into an unexpected error, it auto-saves your work at once and shows a red
banner. **Report…** (also *Help ▸ Report a crash…*) shows a report of the recent errors, with the
version and platform and your folder names hidden. You can copy it or post it as a GitHub issue.
Nothing is sent unless you choose to. *View ▸ Log* has the full details.

## The recovery folder

- **Desktop:** the `recovery` folder in the app's data. On Windows:
  `%LOCALAPPDATA%\io.github.jaisurya-dev-art.rigby2d\recovery`. On macOS:
  `~/Library/Application Support/io.github.jaisurya-dev-art.rigby2d/recovery`. On Linux:
  `~/.local/share/io.github.jaisurya-dev-art.rigby2d/recovery`.
- **Browser:** the site's storage for this browser (IndexedDB). Clearing the site data deletes it.

It holds the auto-saves (`autosave-<session>.rigby`), the last session (`quit.rigby`) and the crash
reports (`crash-<time>.txt`). These are ordinary `.rigby` files and text files.
