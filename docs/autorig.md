# AutoRig

AutoRig turns layered artwork into an editable rig in one step: it identifies the body parts, places
joints where the parts meet, builds the skeleton, turns bending parts into weighted meshes and adds IK
to arms and legs.

![NILA rigged by AutoRig: 31 bones, a bending torso mesh and IK on arms and legs](images/autorig-result.jpg "One click: 31 bones, a torso mesh and 4 IK constraints from 72 layers")

## Rigging a character

1. Start from a project with the layers imported and no bones yet: *File ▸ Import ▸ PSD…*, or the
   **Import PSD…** button inside the AutoRig dialog. See [Importing art](importing-art.md).
2. Choose *File ▸ AutoRig artwork…*. The table lists every layer with the **Part** and **Side**
   AutoRig found for it, and whether it was **found by** the layer's name or its position.
3. Correct any row that is wrong, or choose *— leave unrigged —* for layers that should not move
   (a background, a shadow you will place by hand).
4. Press **Generate rig**. It is one undo step.

![The AutoRig dialog: each layer with its detected part and side](images/autorig-dialog.jpg "Every row can be corrected before generating")

> [!NOTE]
> AutoRig works on unrigged artwork. If the project already has bones, the dialog says so and offers
> **Start over from a PSD…**, which opens a fresh project for the artwork.

## What it builds

- **Spine**: a `hip` bone low in the body and a `chest` bone up to the shoulders. The body layer
  becomes a mesh that bends with both.
- **Neck and head**: the head turns at its base.
- **Arms and legs**: `upperarm`, `forearm`, `hand`, `thigh`, `shin` and `foot` bones, with joints
  where the layers meet.
  - A single layer for a whole arm or leg is split into two bones and turned into a weighted mesh,
    so it bends at the elbow or knee.
  - IK targets (`ik_hand_l`, `ik_foot_r`, …) are added for two-bone limbs. A limb drawn bent keeps
    its bend direction; a straight one bends its middle joint away from the body. Flip **Bend** in
    the IK settings to reverse it.
- **Face**: small bones for the eyes, pupils (following their eye), brows, nose, mouth and jaw, under
  the head.
- **Extras**: hair and ears hang from the head, wings from the chest, and tails from the hip as a
  three-bone chain with a mesh.
- **Anything else** rides on the nearest bone, and the log lists it.

Every layer stays exactly where it was drawn, and everything AutoRig makes is ordinary rig data:
rename bones, move joints, repaint weights, add constraints.

## Naming layers

Names are read loosely: case, separators and word order do not matter. `L_UpperArm`,
`upper arm left`, `arm.l` and `LeftArm2` are all understood.

| Part | Names that work |
| --- | --- |
| Torso | `torso`, `body`, `chest`, `trunk`, `belly`, `shirt`, `jacket`, `dress` |
| Pelvis | `pelvis`, `hip(s)`, `waist`, `pants`, `shorts`, `skirt`, `belt` |
| Head and neck | `head`, `face`, `skull`; `neck` |
| Arms | `upperarm` / `upper arm` / `shoulder` / `sleeve`; `forearm` / `lower arm` / `elbow`; `hand`, `fist`, `glove`, `fingers`, `claw`; or `arm` for a whole arm |
| Legs | `thigh` / `upper leg`; `shin` / `calf` / `lower leg` / `knee`; `foot`, `shoe`, `boot`, `paw`; or `leg` for a whole leg |
| Face | `eye`, `pupil` / `iris`, `brow` / `eyebrow`, `mouth` / `lips` / `teeth`, `nose`, `jaw` / `chin`, `ear` |
| Extras | `hair`, `bangs`, `ponytail`, `hat`, `helmet`, `horns`; `tail`; `wing` |

**Sides**: `l`, `left`, `r` or `right`, anywhere in the name. Sides are the **character's**. When a
layer has no side, AutoRig assumes the character faces you, so its left is on the image's right.

**Alternate images** of a part, such as `hand_open` and `hand_fist` or `mouth_A` and `mouth_O`,
share the part's bone, and their slot gets each alternate as an attachment.

> [!TIP]
> Layers named for nothing in particular (`Layer 12`) are identified by where they sit. Naming them
> is still faster than fixing rows in the table.

## After AutoRig

- Check the joints by rotating bones with the Rotate tool, and move any joint that is off: in Setup
  mode, translate the bone (its children and images stay where they are drawn).
- Repaint mesh weights where a bend looks soft or stiff. See [Meshes](meshes.md#weights).
- Add [physics](constraints.md#physics) to hair, earrings and cloth.
- Save [poses](poses-and-faces.md) for expressions, and set up [lip-sync](lip-sync.md).

## Through MCP

| Tool | What it does |
| --- | --- |
| `detect_parts` | Previews AutoRig on a PSD or an unrigged `.rigby` file. |
| `autorig` | Rigs a PSD into a new `.rigby` file, or rigs an unrigged one. |

See the [MCP guide](mcp.md) and [Retargeting](retargeting.md) for reusing animations between
characters.
