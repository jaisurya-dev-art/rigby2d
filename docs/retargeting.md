# Retargeting

Make an animation once and reuse it on other characters. Retargeting copies animations from another
project, matching bones automatically and scaling movement to the character's size.

## Retargeting animations

1. Open the character that should receive the animations.
2. Choose *File ▸ Retarget animations…* and pick the project that has the
   animations (`.rigby`, `.json` or `.skel`).
3. Tick the animations you want, then check the bone matches in the table: each bone of **this
   character** with its **source bone** and how it was **matched**.
4. Set the options and press **Retarget**. It is one undo step.

If this character already has an animation of the same name, tick **Replace** to overwrite it;
Retarget stays disabled until you do.

## How bones are matched

Bones are matched in this order:

1. Your choice in the table.
2. The same name.
3. A similar name: `arm.L` and `Arm_Left` match.
4. The same body part and side: `L_UpperArm` and `upperarm_l` match.

Control bones such as `ik_hand_l` only match other control bones. Keys of bones that have no match
are left out.

## Proportions and poses

- **Movement scale**: translations are scaled by the ratio of the two characters' heights. You can
  type your own value.
- **Bone frames**: translations are turned from each source bone's parent frame into the target
  bone's, so they move the same way in the world even when the rigs are built differently.
- **Mirrored bones**: when a bone is mirrored in one rig but not the other, its rotations are
  reversed.

**Rotations** have two modes:

| Mode | Use it when |
| --- | --- |
| **Relative** (default) | The characters are rigged alike. Rotations are added to the target's own rest pose. |
| **Match world directions** | The rest poses differ, such as arms down in one rig and arms out in the other. Bones point the way the source's bones point. |

## What is carried over

| Carried over | Left out |
| --- | --- |
| Bone keys and their curves | Mesh deformation keys (meshes differ between characters) |
| Slot keys, by slot name; image swaps only for images the target has | Draw order keys |
| Events (missing event definitions are added) | |
| IK mix keys, by constraint name | |

The log lists anything left out.

## Through MCP

| Tool | What it does |
| --- | --- |
| `map_bones` | Previews the bone matching between two characters. |
| `retarget_animation` | Copies one or more animations to another character. |

See the [MCP guide](mcp.md).
