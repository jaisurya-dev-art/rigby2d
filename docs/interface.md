# The interface

The editor is one window with five areas around the viewport. Panels can be resized by dragging the
borders between them (double-click a border to reset it), and in the desktop app the Timeline, Tree
and Inspector can be popped out into their own windows. The side panels start narrow, so the viewport
gets most of the room; *View ▸ Panels* saves an arrangement you like.

![The editor with numbered areas: 1 menus, 2 workspace switch, 3 viewport toolbar, 4 viewport, 5 tree, 6 inspector, 7 timeline controls, 8 dopesheet, 9 status bar](images/interface-tour.jpg "The parts of the editor")

| | Area | What it is for |
| --- | --- | --- |
| 1 | **Menu bar** | *File* (with *New*, *Open recent*, *Import* and *Export* submenus), *Edit*, *View*, *Scripts* and *Help* (see [The Help menu](#the-help-menu)), the **SETUP** and **ANIMATE** mode tabs, and buttons for *Undo*, *Redo*, *Fit the skeleton in view* and *Show or hide bones* (hover one to see its shortcut). When an update is ready, an **Update available** button appears here too. |
| 2 | **Workspace switch** | **Game** or **Film**: which tools are shown. See [Workspaces](#workspaces). |
| 3 | **Viewport toolbar** | Transform tools, the active tool's values with a key button, axes, **Bone only** (Setup mode), **Weights** (when a mesh is selected), onion skin, guides and auto key. |
| 4 | **Viewport** | The character. Select, pose and edit here. |
| 5 | **Tree** | The skeleton (bones, slots, attachments) and the draw order, skins, constraints, events, animations and images. |
| 6 | **Inspector** | Properties of the selection (a bone, slot, constraint, skin or event) and, on its **Project** tab, the project settings. Poses and face controls sit at the bottom. |
| 7 | **Timeline controls** | Animation list, **+** (new animation), length, playback, loop, speed, the time display and **Key**. |
| 8 | **Dopesheet / Graph** | Keys over time, or their curves. |
| 9 | **Status bar** | Messages, rig statistics and zoom, and the **Log** button. |

## Modes: Setup and Animate

Every edit means one of two things, chosen by the mode:

| | Setup mode | Animate mode |
| --- | --- | --- |
| Changes | The **setup pose**: the rig at rest. | **Keys** at the current frame of the current animation. |
| Bones | Create, delete, reparent, set length. | Pose them. |
| Images and meshes | Place them, edit vertices, paint weights. | Swap images, deform meshes (deform keys). |
| Mode tab | **SETUP** lit blue | **ANIMATE** glows orange |
| Timeline | Hidden, so the viewport gets the room (*View ▸ Timeline in Setup mode* keeps it) | Shown |

Switch with <kbd>Tab</kbd> or by clicking the other tab in the menu bar. The same transform tools
work in both modes; only the result differs.

## Viewport

| To | Do |
| --- | --- |
| Select a bone or image | Click it. |
| Add to or remove from the selection | <kbd>Ctrl</kbd>+click. |
| Box select | Drag in empty space (with <kbd>Ctrl</kbd> held, adds to the selection). |
| Transform the selection | Drag it with the active tool, or drag empty space while bones are selected. |
| Pan | Right or middle drag. |
| Zoom | Mouse wheel. |
| Fit the skeleton in view | The fit button in the menu bar, or *View ▸ Fit the skeleton in view* (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>). |
| Deselect | <kbd>Esc</kbd>, or click empty space. |

Hovering a bone — in the viewport, the tree or a timeline track — highlights it in all three at
once with a short glow, so you can tell which bone is which across the panels (and across detached
panel windows). The selection is shown the same way.

<figure><video src="videos/bone-highlight.mp4" poster="videos/bone-highlight.jpg" controls muted loop playsinline preload="none" aria-label="Hovering a bone highlights it in the viewport, the tree and the timeline at once"></video><figcaption>Hovering a bone highlights it in the viewport, the tree and the timeline at once (video by @maruccimauro)</figcaption></figure>

### Tools

| Tool | Key | Does |
| --- | --- | --- |
| **Pose** | <kbd>B</kbd> | Drag a bone to aim it at the cursor; drag near its origin to move it. The quickest way to pose. |
| **Create** | <kbd>N</kbd> | Drag to draw a bone (Setup mode). Select a bone first to chain the new one from it. |
| **Rotate** | <kbd>C</kbd> | Rotates the selection. |
| **Translate** | <kbd>V</kbd> | Moves the selection. Hold <kbd>Shift</kbd> while dragging to move along one axis only. |
| **Scale** | <kbd>X</kbd> | Scales the selection. |
| **Shear** | <kbd>Z</kbd> | Shears the selection. |

Keys are those of the default *Spine-like* preset; a *Blender-like* preset is in *Preferences ▸ Interface*. See
[Keyboard shortcuts](shortcuts.md).

Next to the tools, the active tool's values for the selected bone can be dragged or typed. In
Animate mode a **◆** button keys them; its color says whether the value is keyed at this frame,
changed but not keyed, or not keyed.

**Axes**: *Local*, *Parent* and *World* decide the space the values are shown in and the
direction the Translate tool moves.

**Guides**: optional real-time transform guides and Photoshop-style ruler guides; see
[Guides](guides.md).

### View options

The *View* menu has three groups.

**Viewport**, what is drawn over the art (remembered between sessions):

- *Show bones*. The bone button in the menu bar and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>
  do the same.
- *Bone size*: a slider (50% to 250%) for how big bones are drawn, smaller for tiny or pixel-art
  characters and bigger for large ones. The viewport follows as you drag; *Normal size* puts it back.
  Bones stay as easy to click at any size.
- *Shapes*: clipping masks, bounding boxes, paths and points, one switch per kind. A shape you
  select stays visible even when its kind is hidden, so you can still edit it.
- *Bone links* draws a dashed line from a bone to its parent wherever the child doesn't start at its
  parent's tip, so the hierarchy reads in the viewport: *Selected branch* (the default: the selected
  bones up to the root and down to their children), *All bones* or *Off*.
- *Show output frame* and *Preview film effects* (Film workspace).
- **Hide overlays** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>, or <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd>
  with the Blender-like shortcuts) hides bones, shapes, selection outlines and guides at once, to
  watch the animation as it renders. Press it again to bring them back.
- *Show and unlock all* undoes every eye and lock set in the tree.

**Timeline**:

- *Timeline in Setup mode* keeps the timeline on screen in Setup mode.
- *Tween lines* draws a thin line in the dopesheet between keys that blend into each other (on by
  default). See [The dopesheet](animating.md#the-dopesheet).

**Window**:

- *Panels*: the **Rig panel** (skins, constraints, meshes and events in a panel of their own, left
  of the viewport, so the tree keeps only the bone hierarchy), your [saved layouts](#saved-layouts),
  and *Reset panels*.
- *Themes…* and the **Log** window.

The menu ends with the zoom commands. The viewport renderer and the shortcut preset are in
[Preferences](preferences.md) (*Interface*).

## Tree

The tree has collapsible sections:

- **Skeleton**: bones in their hierarchy, each with its slots. Guide lines join each bone to its
  children and run down past open branches, so deep rigs stay readable. A slot shows its visible attachment
  next to its name; click **▸** (with the number of attachments) to list them all, and click one to
  show it (in Animate mode, that sets an image-swap key). **+ Bone** adds a child to the selected
  bone, as long as its parent, and **+ Point** a [point bone](bones-and-slots.md#point-bones) at its
  tip. **Collapse all bones** shows the root and its immediate children. **Expand all bones** opens
  the full hierarchy. The **Find** box at the top shows only the bones and slots whose names contain
  what you type (with the bones above them), and Esc clears it. In Setup mode, drag a bone's row onto another bone
  to make that its parent, or onto the skeleton's title for the root; the bone keeps its place.
- **Draw order**: slots back to front; *Draw in front* and *Draw behind* move the selected slot, or
  drag a row to drop it anywhere (a side preview shows its image between its new neighbours as you
  drag). See [Draw order](bones-and-slots.md#draw-order).
- **Skins**, **Constraints** and **Events**: with **+** buttons to create them. See
  [Skins and events](skins-and-events.md) and [Constraints](constraints.md).
- **Animations** and **Images**.

Bones also have an onion-skin button that limits onion skinning to that bone and its children.
See [Onion skin](onion-skin.md).

### Show and lock

Hover a bone or slot row for its **eye** and **lock** buttons:

- **Eye**: hides the bone (or the slot's images) in the viewport, to work on what's behind it. A
  hidden row is dimmed in the tree.
- **Lock**: the viewport no longer picks it, so clicks and box selections go to what's around it.
  You can still select it in the tree and edit it there.
- **Alt+click** on a bone's eye or lock applies it to the whole branch: the bone, every bone below it
  and all their slots.

Both only change the editor's view: renders, exports and the runtimes always show everything. They
are saved in the work file and are part of undo. *View ▸ Show and unlock all* clears them all.

## Inspector

The inspector shows what is selected:

- **Nothing**: the **Project**: name, texture filtering (smooth or pixel art), the
  [pixel grid](importing-art.md#pixel-grid), the **Output** section in the Film workspace, rig
  statistics, images and audio tracks. With something selected, the same settings are on the
  inspector's **Project** tab (the selection stays; selecting something else goes back to it).
- **A bone**: name, parent, length, inheritance, and its pose at the current frame.
- **A slot**: its attachments, color and blending, and the selected attachment's settings.
- **A constraint, skin or event**: every setting of it.

At the bottom, **Poses & face controls** is always there. See [Poses and face controls](poses-and-faces.md).

## Timeline

The timeline row holds the animation menu, **+** (new animation), the animation's name and **Length**, a delete
button, playback (start, previous frame, play, next frame), **Loop**, **Boomerang**, playback speed,
the project's **frame rate**, **Key**, the key tools, **Dopesheet** and **Graph** (which switch
the view below), and last the time: frame and seconds, or timecode and frame in the Film workspace.
On a narrow window the timeline row and the viewport toolbar keep every button but hide their labels;
hover a button for its name and shortcut.
See [Animating](animating.md) and [Graph editor](graph-editor.md).

## Workspaces

| | Game | Film |
| --- | --- | --- |
| For | Game engines and apps | Film, video, motion graphics |
| Output | Skeleton JSON / `.skel` + atlas | PNG sequences, WebM, MP4 (exports stay available) |
| New projects | 30 fps | 24 fps |
| Time display | Frames and seconds | Timecode `MM:SS:FF` and frames (hours appear past one hour) |
| Output settings, output frame, *Render animation* | Hidden | Shown |
| Audio tracks, lip-sync, face controls | Hidden | Shown |

The workspace is saved in the `.rigby` file. Switching is always safe: film settings, poses and face
controls never reach skeleton exports.

## Themes

*View ▸ Themes…* switches the editor's colours. Themes change colour only: layout, type, shortcuts and
your projects stay the same, and detached panels follow the main window.

| Theme | |
| --- | --- |
| **Rigby Dark** | The default. |
| **Mammoth** | Deep ice surfaces, warm ivory text and an amber accent. New in 0.6. |
| **Rigby Light** | For bright rooms. |

The Themes dialog lists the **Built-in** themes and **Your themes** (the ones you made or imported) in two sections. A quick theme picker is also in *Edit ▸ Preferences ▸ Interface*.

- **New theme** copies the current theme. Change any of its colours (surfaces, text, accent,
  state and the viewport's canvas and grid) and the editor updates as you go. Give it a name and
  say whether it is dark or light.
- **Export theme…** saves the current theme as a `.rigbytheme` file; **Import theme…** adds one.
  Share them on Discord: anyone can import them.
- **Delete theme** removes one of your themes (it shows only for your own; built-in themes stay).

Colours are picked with the editor's own colour picker, which follows the theme: click a colour
to open it, then drag in the square (saturation and brightness) and along the hue strip, type a
 hex code, or click one of the theme's colours to reuse it. The editor updates as you drag;
<kbd>Esc</kbd> closes the picker, and the arrow keys nudge the colour (<kbd>Shift</kbd> for larger
steps). The same picker sets bone and slot colours, the film background, onion skin and guide
colours.

A `.rigbytheme` file is JSON you can also write by hand. Colours are `#rrggbb`, `rgb()` or `hsl()`;
any colour that is missing or does not read falls back to Rigby Dark's (Rigby Light's for a
`"scheme": "light"` theme), and the import says how many did:

```json
{
  "rigby2d-theme": 1,
  "name": "Night shift",
  "scheme": "dark",
  "colors": {
    "app0": "#0a161c", "app": "#0e1c23", "panel": "#13242c", "control": "#1a2f38",
    "hover": "#223a44", "popover": "#182c35", "line": "#24404b", "lineStrong": "#36545f",
    "text": "#f1ece4", "textStrong": "#ffffff", "textMuted": "#9fb3bd", "textFaint": "#7a909a",
    "accent": "#f08a3a", "accentText": "#f5a263", "onAccent": "#1c0f05", "selected": "#5a3216",
    "focus": "#9cc3de", "success": "#6fcf97", "warning": "#e9c46a", "danger": "#e76f51",
    "modeSetup": "#9cc3de", "modeAnimate": "#f08a3a", "viewport": "#0b1a21", "viewportGrid": "#15303a"
  }
}
```

## Log

*View ▸ Log* (or **Log** at the right of the status bar) lists status messages, script output,
warnings and errors with expandable tracebacks. Filter by level or text, and **Copy** entries for a
bug report. The status bar button turns red and counts errors you have not seen yet.

## Moving panels

The Tree, Inspector, Timeline and Rig panels sit in three regions around the viewport: left, right and
bottom. Drag a panel by its tab:

- onto another panel's tab strip, and the two share that space as tabs;
- onto the edge of a panel, and it gets its own space next to it;
- onto an edge of the viewport, and it docks on that side.

Drag the borders between panels to resize them; double-click a border to reset it. *View ▸ Panels ▸
Reset panels* puts everything back.

## Saved layouts

*View ▸ Panels* saves your panel arrangement under a name and loads it again later:

- **Save current layout…** stores where each panel sits and how wide or tall the panel areas are.
  In the desktop app it also stores which panels are popped out into their own windows, and where.
- Pick a saved layout in the submenu to load it.
- **Manage layouts…** renames, updates and deletes layouts, and binds a shortcut
  (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd> to <kbd>9</kbd>) that loads a layout.

*View ▸ Panels ▸ Reset panels* puts every panel back in its default place and size. Layouts are
kept on this computer (in the browser editor, in this browser).

## Detached panels

In the desktop app, the Timeline, Tree and Inspector can each be popped out into a window of its own,
for example on a second monitor. Everything stays in sync with the main window, and a
[saved layout](#saved-layouts) remembers where the windows are. The pin button at the top right of a
popped-out window keeps it above every other window, other apps included, and it stays pinned the
next time that panel pops out.

## The Help menu

| Item | What it does |
| --- | --- |
| *What's new in 0.6…* | A short tour of the latest big release. |
| *Welcome screen…* | New projects, recent work, demos and lessons. |
| *Tutorials…*, *Keyboard shortcuts…* | Interactive lessons, and every shortcut with a search. |
| *Documentation* | These pages. |
| *Connect an AI assistant…* | Sets up the [MCP server](mcp.md) for an AI assistant. |
| *Community ▸* | *Discord* (the community), the *Devlog* (release news) and this version's *Release notes*. |
| *Report a problem ▸* | *Report an issue* on GitHub, or *Report a crash…*: a report of recent errors to copy or post. |
| *Support Rigby2D…* | The monthly goal, the Founding Supporters, everyone who funds Rigby2D and the code contributors, with a link to sponsor. |
| *Check for updates…* | Desktop app: looks for a new version now (it also checks at startup and every few hours; *Preferences ▸ General*). |
| *About Rigby2D* | Version, licenses and credits. |
