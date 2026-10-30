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
| Nested armatures (weapons, effects and parts shown inside a slot) | Bones and slots under that slot, with their animations baked in |
| Frame actions that play another animation | An `action` event, with the animation's name, for your game to act on |

DragonBones measures Y downwards and Rigby2D upwards: the importer converts every position,
rotation, skew, mesh and deform key, so the character looks and moves the same. Rotations turn the
way the DragonBones runtime turns them (the short way round, or the full turns a key asks for), and
flags written as text (`"bendPositive": "false"`) are read as DragonBones reads them.

### Nested armatures

A slot can show another armature: a weapon, a muzzle flash, a slash effect. Rigby2D's format has no
armature inside a slot, so the importer flattens each one into the character:

- Its bones hang from the slot's bone, placed with the display's transform, and are named after the
  slot and display (`weapon_r/weapon_1502b_r/fire`). Its slots draw where the slot draws, tinted by
  the slot's color.
- Its animations are baked into every animation of the character, following the DragonBones
  runtime: the child plays its default animation, starts over each time the slot switches to it,
  plays an animation of the same name when the character does, and plays what the character's
  `gotoAndPlay` actions start (a weapon's `fire` during an attack).
- It shows only while the slot shows that display.

The result plays the same in every runtime. To edit a weapon on its own, import its armature as a
project too.

### Checked against DragonBones

The importer is checked against the official DragonBones runtime on DragonBones' own demo characters
(mechs, a scorpion and a character with hair and dress physics, 55 animations): every bone, nested
bone, image and color matches the DragonBones runtime within rounding (under 0.1 pixel).

## Not imported yet

- **Skew keys** and **surface** deformers.
- **Sounds** on frames (add the audio in the Film workspace instead).
- Only the **first armature** of a file is imported when there are several.
- Binary `.dbbin` files: export JSON instead.

Each of these is listed in the import report when a file uses it.

## Runtimes

After saving, export with *File ▸ Export* and play the character with the Unity, Godot, Phaser,
JavaScript or Rust runtime: see [Runtimes](runtimes.md). *File ▸ Get runtimes…* downloads them.
