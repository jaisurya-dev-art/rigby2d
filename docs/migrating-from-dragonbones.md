# Coming from DragonBones

Rigby2D opens DragonBones projects directly, so characters made in DragonBones Pro keep working now
that DragonBones is no longer developed. They become ordinary Rigby2D projects that you can keep
editing, and export to every Rigby2D runtime.

## Open a DragonBones project

1. In DragonBones Pro, export the project as **DragonBones JSON** (data version 5.5 is the most
   common; 4.5 and 5.x work). You get three files, kept together in one folder:
   - `name_ske.json`: the skeleton and animations
   - `name_tex.json`: the texture atlas
   - `name_tex.png`: the texture
2. In Rigby2D, *File ▸ Open…* and pick `name_ske.json`. The atlas and texture load from the same
   folder.
3. *File ▸ Save* keeps it as a `.rigby` work file.

The import report (in the status bar and *View ▸ Log*) lists anything that didn't come over.

## What carries over

| DragonBones | In Rigby2D |
| --- | --- |
| Bones (with their inherit settings) | Bones |
| Slots, display index, color, blend modes (add, multiply, screen) | Slots with their attachment, color and blend mode |
| Image displays | Region attachments |
| Mesh displays, with weights | Meshes, with weights |
| Bounding box displays | Bounding boxes |
| IK constraints | IK constraints (one or two bones) |
| Skins | Skins |
| Animations: translate, rotate, scale, display, color, mesh deform (FFD), IK, z-order | The same keys, with their easing and curves |
| Frame events | Events |

DragonBones measures Y downwards and Rigby2D upwards: the importer converts every position,
rotation, skew, mesh and deform key, so the character looks and moves the same.

## Not imported yet

- **Nested armatures** (an armature shown inside a slot, such as a weapon): left out; import the
  nested armature as its own project.
- **Skew keys** and **surface** deformers.
- **Sounds** on frames (add the audio in the Film workspace instead).
- Only the **first armature** of a file is imported when there are several.
- Binary `.dbbin` files: export JSON instead.

Each of these is listed in the import report when a file uses it.

## Runtimes

After saving, export with *File ▸ Export* and play the character with the Unity, Godot, Phaser,
JavaScript or Rust runtime: see [Runtimes](runtimes.md). *File ▸ Get runtimes…* downloads them.
