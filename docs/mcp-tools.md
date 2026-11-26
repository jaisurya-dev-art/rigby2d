# MCP tool reference

Every tool of the Rigby2D MCP server with its parameters. This page is generated from the server's
own tool definitions, so it always matches the version you run. For setup and the tools explained by
task, see [AI assistants (MCP)](mcp.md).

Paths are relative to the first `--root` folder, and the server never reads or writes outside the
root folders. Editing tools save the file in its own format, or a copy when `output` is given.

<!-- generated:mcp-tools -->

The server has **61 tools**. Parameters marked **required** must be given; the others are optional.

### `inspect_project`

Summarize a Rigby2D project file: format and version, counts of bones, slots, skins, constraints, events and images, the animations with their durations, and any read warnings. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |

### `describe_rig`

List the bone hierarchy with setup-pose transforms (Y up, degrees), the slots in draw order with their attachments, and the attachments of each extra skin. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |

### `describe_animation`

Show one animation: its duration, the key times of every bone, slot, deform, IK and draw-order timeline, its events, and other timelines it holds. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `animation` **required** | string | Animation name (see inspect_project). |

### `sample_pose`

Evaluate the skeleton with the Rigby2D runtime: the setup pose, or an animation at a time. Returns world transforms of every bone, the visible attachment of each slot, the draw order, events up to that time and the bounds of everything drawn. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `animation` | string | Animation to apply. Omit for the setup pose. |
| `time` | number | Time in seconds (default 0). |
| `skin` | string | Skin to show (default 'default'). |

### `validate_project`

Check a project for problems: structure, images missing from its work file, atlas or images folder, animations without keys, whether skeleton JSON 4.3 round-trips the data exactly, and whether binary .skel export is possible. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |

### `convert_project`

Write a project as skeleton JSON (format 3.8, 4.2 or 4.3) or binary .skel (4.3). Reads .rigby, .json or .skel (4.2 or 4.3). Writes skeleton data only; atlas and images are not repacked. Refuses to replace an existing file unless overwrite is true.

| Parameter | Type | Description |
| --- | --- | --- |
| `input` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` **required** | string | Output file ending in .json or .skel, inside the workspace. Its folder must exist. |
| `version` | `'3.8'`, `'4.2'`, `'4.3'` | Skeleton JSON format version (default 4.3; .skel is always 4.3). |
| `overwrite` | boolean | Replace the output file if it exists (default false). |

### `export_defold_model`

Write a Rigby2D model for Defold from a character (.rigby work file, or .skel / .json with its atlas or images): the skeleton (<name>.rigbyskel), its images unpacked into images/ with a Defold atlas (<name>.atlas), the component (<name>.rigbymodel) and a game object holding it (<name>.go). With the rigby2d library, the Defold editor plays the model live in the scene view and the game plays it natively. The output folder path in the Defold project is found from the game.project above it, or given as folder.

| Parameter | Type | Description |
| --- | --- | --- |
| `input` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output_folder` | string | Folder to write into, inside the workspace (default: the input file folder). Created files go here and in its images/ subfolder. |
| `name` | string | Base name of the files (default: the input file name). |
| `folder` | string | The output folder path in the Defold project, such as "/assets/hero" (default: found from game.project). |
| `animation` | string | Animation the model plays from the start (its default_animation; default none). |
| `skin` | string | Skin to show (default: the default skin). |
| `overwrite` | boolean | Replace files from an earlier export (default false). |

### `export_sprite_sheet`

Render animations frame by frame into a sprite sheet for engines that play frames: 'json' writes <name>.png and <name>.json (a JSON hash as TexturePacker writes it, read by Phaser, PixiJS and others, with Aseprite frameTags, durations and a pivot at the skeleton's origin); 'defold' writes <name>/<animation>_<n>.png frames and <name>.atlas; 'frames' writes the frames only. Physics settles into loops first. Reads .rigby, or .json / .skel with its atlas. Refuses to replace files unless overwrite is true.

| Parameter | Type | Description |
| --- | --- | --- |
| `input` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output_folder` **required** | string | Existing folder inside the workspace to write into. |
| `name` | string | Base name of the files (default: the input file name). |
| `format` | `'json'`, `'defold'`, `'frames'` | 'json' (default), 'defold' or 'frames'. |
| `animations` | list of string | Animations to include (default: all). |
| `fps` | number | Frames per second (default 30). |
| `scale` | number | Pixels per skeleton unit (default 1). |
| `layout` | `'packed'`, `'grid'` | Sheet layout for 'json' (default packed). |
| `padding` | integer | Pixels between frames (default 2). |
| `trim` | boolean | Trim empty space around frames (json; default true). |
| `dedupe` | boolean | Store identical frames once (json; default true). |
| `loop` | boolean | Animations loop: leave out the last frame, which repeats the first (default true). |
| `max_width` | integer | Largest side of each sheet in pixels (default 4096); frames that don't fit go on more sheets (name-0.png + name-0.json …, and name.json as a Phaser multi-atlas). |
| `power_of_two` | boolean | Round each sheet up to power-of-two sides (json; default false). |
| `skin` | string | Skin to show (default: the default skin). |
| `defold_folder` | string | Project path the Defold atlas lists frames under (default '/<name>'). |
| `overwrite` | boolean | Replace existing files (default false). |

### `add_bone`

Add a bone as a child of an existing bone, with its setup pose relative to the parent (x, y, rotation in degrees, length). Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | New bone name. |
| `parent` **required** | string | Parent bone name. |
| `x` | number |  |
| `y` | number |  |
| `rotation` | number |  |
| `length` | number |  |

### `set_bone_setup`

Change a bone's setup (rest) pose relative to its parent: x, y, rotation, scaleX, scaleY, shearX, shearY (degrees for angles) and length. Only the given fields change. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `bone` **required** | string | Bone name. |
| `x` | number |  |
| `y` | number |  |
| `rotation` | number |  |
| `scaleX` | number |  |
| `scaleY` | number |  |
| `shearX` | number |  |
| `shearY` | number |  |
| `length` | number |  |

### `add_animation`

Add an empty animation. Its duration grows as keys are set later. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Animation name. |
| `duration` | number | Initial duration in seconds (default 0). |

### `set_bone_key`

Set a key on a bone in an animation (replacing a key at the same time). Values are relative to the setup pose: rotate takes value (degrees added); translate and shear take x/y (added); scale takes x/y (multiplied). curve shapes the motion to the next key. The animation grows to include the key. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `bone` **required** | string | Bone name. |
| `channel` **required** | `'rotate'`, `'translate'`, `'scale'`, `'shear'` |  |
| `time` **required** | number | Seconds. |
| `value` | number | rotate: degrees added to the setup rotation. |
| `x` | number | translate/shear: added to the setup value; scale: factor. |
| `y` | number | translate/shear: added to the setup value; scale: factor. |
| `curve` | `'linear'`, `'stepped'`, `'easeIn'`, `'easeOut'`, `'easeInOut'` or list of number | Interpolation to the next key: 'linear' (default), 'stepped', 'easeIn', 'easeOut', 'easeInOut', or a custom cubic bezier [cx1, cy1, cx2, cy2] with control points in key-to-key space (time 0..1 on x, value 0..1 on y; x must stay within 0..1), as in CSS cubic-bezier(). |

### `delete_bone_key`

Delete the key of a bone channel at a time in an animation. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `bone` **required** | string | Bone name. |
| `channel` **required** | `'rotate'`, `'translate'`, `'scale'`, `'shear'` |  |
| `time` **required** | number |  |

### `set_attachment_key`

Show an attachment in a slot from a time on in an animation (an image swap), or hide the slot's attachment with hide: true. The attachment must belong to the slot. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `slot` **required** | string | Slot name. |
| `time` **required** | number |  |
| `attachment` | string | Attachment to show (see describe_rig). |
| `hide` | boolean | Hide the attachment instead. |

### `set_event_key`

Fire an event at a time in an animation (games receive it during playback). Creates the event definition if it does not exist; int, float and string override its default values. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `event` **required** | string | Event name. |
| `time` **required** | number |  |
| `int` | integer |  |
| `float` | number |  |
| `string` | string |  |

### `add_constraint`

Add a constraint, applied after the existing ones. ik: 'bones' is the chain (1 or 2 bones), 'target' the target bone. transform: 'bones' follow 'target' (the source bone); by default every property is mapped and offsets keep the current pose (nothing jumps). path: 'bones' along the path attachment in slot 'target'. physics: one constraint per bone in 'bones' (names get a number), with rotate 1 unless 'settings' say otherwise. slider: 'settings.animation' is the animation it plays; optional 'target' is the bone that drives it. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `type` **required** | `'ik'`, `'transform'`, `'path'`, `'physics'`, `'slider'` |  |
| `name` **required** | string | Constraint name (must be new). |
| `bones` | list of string | Constrained bones (see the description per type). |
| `target` | string | IK target bone, transform source bone, path slot, or the bone driving a slider. |
| `keepPose` | boolean | Transform only: set offsets so the bones stay where they are (default true). |
| `settings` | object | Settings in skeleton JSON 4.3 spelling. IK: mix, softness, bendPositive, compress, stretch, uniform. Transform: properties ({ from: { offset, to: { to: { offset, max, scale } } } }), offsetX, offsetY, offsetRotation, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, localSource, localTarget, additive, clamp. Path: positionMode, spacingMode, rotateMode, position, spacing, mixRotate, mixX, mixY. Physics: x, y, rotate, scaleX, shearX, inertia, strength, damping, mass, wind, gravity, mix, limit, fps. Slider: animation, loop, bone, property, scale, offset, local, additive, time, mix. On set_constraint, null removes a setting. |

### `set_constraint`

Change a constraint's settings (skeleton JSON 4.3 spelling; null removes one), rename it, or move it in the application order. IK also takes 'target' in settings. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `constraint` **required** | string | Constraint name. |
| `settings` | object | Settings in skeleton JSON 4.3 spelling. IK: mix, softness, bendPositive, compress, stretch, uniform. Transform: properties ({ from: { offset, to: { to: { offset, max, scale } } } }), offsetX, offsetY, offsetRotation, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, localSource, localTarget, additive, clamp. Path: positionMode, spacingMode, rotateMode, position, spacing, mixRotate, mixX, mixY. Physics: x, y, rotate, scaleX, shearX, inertia, strength, damping, mass, wind, gravity, mix, limit, fps. Slider: animation, loop, bone, property, scale, offset, local, additive, time, mix. On set_constraint, null removes a setting. |
| `rename` | string | New name (keys and skins follow). |
| `order` | integer | New position in the application order (0 = first). |

### `delete_constraint`

Delete a constraint with its animation keys and skin memberships. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `constraint` **required** | string | Constraint name. |

### `set_constraint_key`

Key a constraint's values in an animation (replacing a key at the same time). Keyable values: IK mix, softness, bendPositive, compress, stretch; transform mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY; path position, spacing, mixRotate, mixX, mixY; physics inertia, strength, damping, mass, wind, gravity, mix; slider time, mix. Values left out keep what the constraint has at that time. The animation grows to include the key. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `constraint` **required** | string | Constraint name. |
| `time` **required** | number | Seconds. |
| `values` **required** | object |  |
| `curve` | `'linear'`, `'stepped'`, `'easeIn'`, `'easeOut'`, `'easeInOut'` or list of number | Interpolation to the next key: 'linear' (default), 'stepped', 'easeIn', 'easeOut', 'easeInOut', or a custom cubic bezier [cx1, cy1, cx2, cy2]. |

### `set_ik_target_key`

Key an IK constraint's target bone so it reaches a world point (Y up) at a time, using the pose at that time: the point is converted into the target's parent space and keyed as translate (an offset from the setup pose). Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `constraint` **required** | string | IK constraint name. |
| `time` **required** | number |  |
| `world_point` **required** | list of number |  |
| `curve` | `'linear'`, `'stepped'`, `'easeIn'`, `'easeOut'`, `'easeInOut'` or list of number | Interpolation to the next key: 'linear' (default), 'stepped', 'easeIn', 'easeOut', 'easeInOut', or a custom cubic bezier [cx1, cy1, cx2, cy2]. |

### `add_skin`

Add a skin (an outfit or variant). With 'copy_from', it starts with a copy of that skin's attachments, bones and constraints; otherwise empty. Fill it with duplicate_attachment. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | New skin name. |
| `copy_from` | string | Skin to copy. |

### `delete_skin`

Delete a skin and its attachments. If it was the active skin, the default skin becomes active. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Skin name. |

### `duplicate_attachment`

Copy an attachment of a slot (with its mesh and weights) under a new name, into the same skin or into 'target_skin' (default skin when left out). For skins, copy with the same name into the target skin and change it there. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `slot` **required** | string | Slot name. |
| `attachment` **required** | string | Attachment name. |
| `skin` | string | Skin holding the attachment (default skin when left out). |
| `new_name` **required** | string | Name of the copy (may equal the original in another skin). |
| `target_skin` | string | Skin to put the copy in ('default' for the default skin). |

### `make_mesh`

Turn a region attachment into a mesh so it can bend. mode 'outline' (default) traces the image's alpha, as the editor's Generate mesh does (work files only, since it needs the pixels): 'points' outline vertices (default 24) and 'interior' density (none, low, medium, high). mode 'grid' makes a rectangular grid with cells of about 'spacing' world units. The mesh starts rigid to the slot's bone; bind it with auto_weight. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `slot` **required** | string | Slot name. |
| `attachment` **required** | string | Attachment name. |
| `skin` | string | Skin holding the attachment (default skin when left out). |
| `mode` | `'outline'`, `'grid'` |  |
| `spacing` | number | Grid cell size in world units (mode 'grid'). |
| `points` | integer |  |
| `interior` | `'none'`, `'low'`, `'medium'`, `'high'` |  |

### `auto_weight`

Bind a mesh to bones with automatic weights (by distance to each bone, as the editor's Bind does): each vertex follows the listed bones, at most four. Deform keys whose layout no longer fits are removed and counted. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `slot` **required** | string | Slot name. |
| `attachment` **required** | string | Attachment name. |
| `skin` | string | Skin holding the attachment (default skin when left out). |
| `bones` **required** | list of string |  |

### `set_weights`

Set the weights of some vertices of a mesh: vertices[i] gets weights[i], a list of { bone, weight }. Weights are normalized and at most four kept; the mesh keeps its setup shape. An unweighted mesh becomes weighted (its other vertices follow the slot bone fully). Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `slot` **required** | string | Slot name. |
| `attachment` **required** | string | Attachment name. |
| `skin` | string | Skin holding the attachment (default skin when left out). |
| `vertices` **required** | list of integer |  |
| `weights` **required** | list of list of object |  |

### `smooth_weights`

Smooth a weighted mesh's weights: each pass averages every vertex's weights with its triangle neighbours (geometry unchanged). Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `slot` **required** | string | Slot name. |
| `attachment` **required** | string | Attachment name. |
| `skin` | string | Skin holding the attachment (default skin when left out). |
| `iterations` | integer |  |

### `bake_physics`

Simulate physics constraints over an animation and write the result as ordinary bone keys (rotate, translate, scale, shear at 'fps', default 30), for engines without physics or to hand-tune it. By default the baked constraints are then keyed off (mix 0) in this animation only. 'loop' settles one cycle first so the loop joins. Refuses bones that another constraint (IK, transform, path) also moves. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `constraints` | list of string | Physics constraints to bake (default all). |
| `fps` | number |  |
| `loop` | boolean |  |
| `disable` | boolean |  |

### `batch_edit`

Apply many edits in one call, loading and saving the project once, atomically: all of them are saved, or none. Each operation is { op, ...arguments } where op is one of add_bone, set_bone_setup, add_animation, set_bone_key, delete_bone_key, set_attachment_key, set_event_key, add_constraint, set_constraint, delete_constraint, set_constraint_key, set_ik_target_key, add_skin, delete_skin, duplicate_attachment, make_mesh, auto_weight, set_weights, smooth_weights, bake_physics and the arguments are that tool's (without path, output and overwrite). Operations run in order, so later ones can use what earlier ones created (add_animation, then its keys). Much faster than one call per key for building animations. Curves can be presets or a custom bezier [cx1, cy1, cx2, cy2].

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `operations` **required** | list of object | The edits, in order: { op, ...that tool's arguments } with op one of add_bone, set_bone_setup, add_animation, set_bone_key, delete_bone_key, set_attachment_key, set_event_key, add_constraint, set_constraint, delete_constraint, set_constraint_key, set_ik_target_key, add_skin, delete_skin, duplicate_attachment, make_mesh, auto_weight, set_weights, smooth_weights, bake_physics. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |

### `set_workspace`

Set the project's workspace: 'game' (for game engines; skeleton exports) or 'film' (for film and video: output settings, renders, face controls, audio). It only changes which tools the editor shows; animation data is untouched. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `workspace` **required** | `'game'`, `'film'` |  |

### `set_output`

Set the film output: frame rate (presets: 12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 60; any rate up to 240), size in pixels, background ('transparent' or a #rrggbb color), and framing: 'auto' (fit the animation), 'fixed' (center frame_x, frame_y and frame_scale world units per pixel), or 'camera' (follow a bone named 'camera', created if missing). Only the given fields change. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `fps` | number |  |
| `width` | integer |  |
| `height` | integer |  |
| `background` | string | 'transparent' or #rrggbb. |
| `framing` | `'auto'`, `'fixed'`, `'camera'` |  |
| `frame_x` | number |  |
| `frame_y` | number |  |
| `frame_scale` | number | World units per output pixel. |

### `save_pose`

Save a pose to the pose library: the local transforms of the given bones (default: every bone) and the attachments their slots show (mouth shapes, eyes). Taken from the setup pose, or from an animation at a time. Replaces a pose with the same name only with replace: true. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Pose name. |
| `bones` | list of string | Bone names (default: all). |
| `animation` | string | Take the pose from this animation (default: setup pose). |
| `time` | number | Seconds. With an animation, keys are set at this time (default 0). |
| `frame` | integer | Frame number at the project's frame rate, instead of time. |
| `replace` | boolean |  |

### `apply_pose`

Apply a saved pose at an amount (0 to 1; image swaps switch at 0.5). Without an animation it changes the setup pose; with one it sets keys at the time (all transform channels of the pose's bones, attachment keys for its slots). Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `pose` **required** | string | Pose name. |
| `amount` | number | Default 1. |
| `animation` | string | Animation to key. Leave it out to change the setup pose instead. |
| `time` | number | Seconds. With an animation, keys are set at this time (default 0). |
| `frame` | integer | Frame number at the project's frame rate, instead of time. |

### `delete_pose`

Delete a pose from the pose library. Face controls that use it are deleted too. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Pose name. |

### `add_face_control`

Add a face control: a slider from 0 to 1 that blends from one pose ('from', default the setup pose) to another ('to'), such as brows up, eyes closed or mouth open. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Face control name. |
| `to` **required** | string | Pose at value 1. |
| `from` | string | Pose at value 0 (default: setup pose). |

### `set_face_control`

Set a face control to a value (0 to 1). Without an animation it changes the setup pose; with one it keys the face at the time, like dragging the slider in Animate mode. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `control` **required** | string | Face control name. |
| `value` **required** | number |  |
| `animation` | string | Animation to key. Leave it out to change the setup pose instead. |
| `time` | number | Seconds. With an animation, keys are set at this time (default 0). |
| `frame` | integer | Frame number at the project's frame rate, instead of time. |

### `delete_face_control`

Delete a face control (its poses stay in the library). Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Face control name. |

### `add_audio_track`

Add a sound file (.wav, .mp3, .ogg, .m4a, .aac, .flac) as an audio track of an animation, starting at 'offset' seconds. The file is stored inside the work file; it plays with the timeline, drives lip-sync, and is mixed into renders. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `audio_file` **required** | string | Sound file inside the workspace. |
| `animation` **required** | string | Animation name. |
| `offset` | number | Start time in seconds (default 0; negative skips the start of the sound). |
| `volume` | number | Default 1. |
| `replace` | boolean | Replace a stored sound with the same file name. |

### `set_audio_track`

Change an audio track's start time (offset, seconds) or volume. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `sound` **required** | string | Sound name. |
| `animation` **required** | string | Animation name. |
| `offset` | number |  |
| `volume` | number |  |

### `remove_audio_track`

Remove an audio track from an animation. The sound file is removed from the work file when no other track uses it. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `sound` **required** | string | Sound name. |
| `animation` **required** | string | Animation name. |

### `lip_sync`

Lip-sync an animation to one of its audio tracks. With `text` (the words spoken) or `timing_file` (ElevenLabs timestamps or Whisper/word-timing JSON, Rhubarb Lip Sync .tsv/.json, Papagayo .dat), keys mouth shapes (visemes A, E, I, O, U, MBP, FV, L and rest) as image swaps on a mouth slot, each landing a little before its sound; the slot and the shape-to-image mapping are found from image names unless given. Without them, keys a face control (such as 'mouth open') from the loudness of the track instead. Reading the audio (text or loudness) needs a WAV track; a timing file does not. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `sound` | string | Audio track to follow (default: the animation's first). |
| `text` | string | The words spoken in the track, timed against its loudness (viseme lip-sync). |
| `timing_file` | string | A timing file inside the workspace: ElevenLabs timestamps, Whisper or [{ word, start, end }] JSON, Rhubarb (.tsv/.json) or Papagayo (.dat). Times are from the start of the sound. |
| `slot` | string | Mouth slot for viseme lip-sync (default: the slot whose images cover the most mouth shapes). |
| `mouths` | object | Override the image used for mouth shapes: { A: 'mouth_open', rest: 'mouth_smile', ... }. |
| `lead` | integer | Frames each mouth lands before its sound (default 2). |
| `min_hold` | integer | Frames a mouth shape is held at least (default about 0.05 s). |
| `control` | string | Face control to key from loudness (when neither text nor timing_file is given). |

### `rename_bone`

Rename a bone. Constraints, poses and film effects that refer to it follow the new name. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `bone` **required** | string | Bone name. |
| `name` **required** | string | New name. |

### `rename_animation`

Rename an animation. Its audio tracks follow. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |
| `name` **required** | string | New name. |

### `delete_animation`

Delete an animation and its audio tracks. Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `animation` **required** | string | Animation name. |

### `set_slot`

Change a slot's setup: the attachment it shows (or hide: true to show none) and its color (#rrggbb or #rrggbbaa). Saves the project.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `slot` **required** | string | Slot name. |
| `attachment` | string |  |
| `hide` | boolean |  |
| `color` | string | #rrggbb or #rrggbbaa. |

### `set_film_effects`

Set the frame-wide film effects of a work file: the light direction used by layer shading, a colour grade over the whole frame, render-time motion blur and depth of field. Only the given ones change; null turns one off. They change only renders (Render, rigby render): skeleton exports and game runtimes never see them. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `lightAngle` | number | Light direction in degrees: 0 = from the right, 90 = from above (default 135, upper left). |
| `grade` | object or null or boolean | Colour grade of the whole frame. An object turns it on (given fields over the defaults: brightness, contrast, saturation (each -1..1), hue (degrees), tint (colour; its alpha is the amount)); null or false turns it off. |
| `motionBlur` | object or null or boolean | Motion blur: { samples (2..64, default 8), shutter (degrees, 180 = half a frame) }, or null to turn it off. |
| `dof` | object or null or boolean | Depth of field: { focus (the layer depth in focus), aperture (blur radius per unit of depth away from it) }, or null. Layers get a depth with set_layer_effects. |

### `set_layer_effects`

Set the film effects of one layer: a bone (its whole branch of slots, drawn as one layer) or a single slot. Effects: shadow, shading (light and shade from the light direction), glow, blur and grade; an object turns one on, null or false turns it off, and fields left out keep their value. 'depth' places the layer for depth of field. remove: true deletes the layer's effects. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `bone` | string | Bone whose branch is the layer (give 'bone' or 'slot'). |
| `slot` | string | Slot that is the layer. |
| `enabled` | boolean |  |
| `depth` | number | Depth for depth of field (0 = the focus plane by default). |
| `shadow` | object or null or boolean | Shadow. An object turns it on (given fields over the defaults: x, y (offset in world units), softness, color); null or false turns it off. |
| `shading` | object or null or boolean | Shading. An object turns it on (given fields over the defaults: width (edge band in units), shade and light (colours)); null or false turns it off. |
| `glow` | object or null or boolean | Glow. An object turns it on (given fields over the defaults: radius, color, strength); null or false turns it off. |
| `blur` | object or null or boolean | Blur. An object turns it on (given fields over the defaults: radius); null or false turns it off. |
| `grade` | object or null or boolean | Grade. An object turns it on (given fields over the defaults: brightness, contrast, saturation (each -1..1), hue (degrees), tint (colour; its alpha is the amount)); null or false turns it off. |
| `remove` | boolean | Delete this layer's effects. |

### `set_emitter`

Add or change a particle emitter (snow, rain, dust, sparks...), found by name; a new one starts from gentle falling snow. Settings: bone, slot, image, enabled, seed, shape, x, y, width, height, rate, max, warmup, life, angle, spread, speed, gravity, wind, drag, turbulence, size, grow, spin, color, colorEnd, fadeIn, fadeOut, blend. 'bone' moves the emitter with a bone, 'slot' draws the particles just below that slot (null = on top), 'image' is an attachment image name (null = soft dots). Ranges (life, speed, size, spin) are [min, max]. remove: true deletes it. Particles are deterministic (seeded) and only appear in renders. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `name` **required** | string | Emitter name. |
| `settings` | object | Emitter settings; null removes a setting (back to its default). |
| `remove` | boolean | Delete the emitter. |

### `detect_parts`

Preview Rigby AutoRig on layered artwork: which body part each layer is (head, torso, upperarm, forearm, hand, arm, thigh, shin, foot, leg, eye, mouth, hair, tail, ...), its side and whether that came from the layer name or its position. Nothing is saved. Use the roles and sides arguments of autorig to correct it. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `psd_file` | string | Layered artwork (.psd) inside the workspace, one layer per body part. Instead of path. |
| `roles` | object | Override detected roles: { layerName: role }. 'none' leaves a layer unrigged. |
| `sides` | object | Override sides: { layerName: 'l' \| 'r' }. The character's left (l) is on the image's right when it faces the viewer. |

### `autorig`

Rigby AutoRig: rig layered artwork in one step. Identifies body parts from layer names (or positions), places joints where parts meet, builds the skeleton (hip, chest, neck, head, arms, legs, face, hair, ears, tail, wings), attaches every layer to its bone, turns parts that bend across bones into weighted meshes (a single arm layer gets an elbow) and adds IK for arms and legs. From psd_file it writes a new .rigby work file to 'output'; from path it rigs an unrigged .rigby work file. The result is ordinary, editable rig data.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `psd_file` | string | Layered artwork (.psd) inside the workspace, one layer per body part. Instead of path. |
| `meshes` | `'deforming'`, `'all'`, `'none'` | 'deforming' (default): meshes for parts that bend across bones; 'all': every part; 'none'. |
| `ik` | boolean | IK for two-bone arms and legs (default true). |
| `roles` | object | Override detected roles: { layerName: role }. 'none' leaves a layer unrigged. |
| `sides` | object | Override sides: { layerName: 'l' \| 'r' }. The character's left (l) is on the image's right when it faces the viewer. |
| `output` | string | Where to save. Required with psd_file (a new .rigby file). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |

### `import_aseprite`

Turns an Aseprite file (.aseprite / .ase) into a new .rigby work file, like the editor's File > Import > Aseprite: every image layer becomes a slot on the root bone where it was drawn, with one image per different picture it shows; each tag (or the whole timeline) becomes an animation that swaps the images at Aseprite's frame durations. Hidden layers become variant animations. Pixel art stays sharp. Rig it afterwards with autorig or the edit tools.

| Parameter | Type | Description |
| --- | --- | --- |
| `aseprite_file` **required** | string | The Aseprite file (.aseprite or .ase) inside the workspace. |
| `output` **required** | string | The new .rigby work file to write. |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |

### `map_bones`

Preview how retarget_animation matches the bones of a source character to a target character: by name, similar name ("L_Arm" and "arm.l"), body part ("UpperArm_Left" and "upperarm_l") or your mapping. Lists unmatched bones. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `source` **required** | string | Character the animation comes from. |
| `path` **required** | string | Character to retarget to. |
| `mapping` | object | Override bone matches: { sourceBone: targetBone }, or null to leave a source bone out. |

### `retarget_animation`

Copy animations from one character to another (any format): bones are matched automatically (see map_bones; override with mapping), movement is scaled to the target's size (scale 'auto') and rotated into its bones' frames, curves are kept, and slot, event and IK keys follow by name. mode 'relative' (default) keeps the target's own rest pose; 'world' makes bones point the way the source's do, compensating for different rest poses. Saves the target.

| Parameter | Type | Description |
| --- | --- | --- |
| `source` **required** | string | Character the animations come from. |
| `path` **required** | string | Character to retarget to (saved). |
| `animation` | string | Source animation. |
| `animations` | list of string | Several source animations, instead of animation. |
| `name` | string | Name in the target (single animation only; default: the same name). |
| `mode` | `'relative'`, `'world'` |  |
| `scale` | number | Movement scale (default: target height / source height). |
| `mapping` | object | Override bone matches: { sourceBone: targetBone }, or null to leave a source bone out. |
| `replace` | boolean | Replace target animations with the same name. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |

### `add_actor`

Put a character (another .rigby work file) into this scene as an actor. Its whole project is stored inside the scene, and a stage bone and slot named after it are created: the bone places it (animate it to move, turn or scale the actor), the slot sets where it is drawn among the other layers. The character stands with its feet on the bone (y is the ground line), however it was drawn. Optionally give it a first clip. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `character` **required** | string | The character: a .rigby work file inside the workspace. |
| `name` | string | Actor name (default: the character's name). |
| `x` | number | Position on the stage (default 0). |
| `y` | number | Position on the stage (default 0, the ground line). |
| `scale` | number | Size (default 1). |
| `flip` | boolean | Face the other way. |
| `shot` | string | Shot (an animation of the scene) name. |
| `animation` | string | The character's animation to play. |
| `start` | number | When the first clip starts (default 0), when animation is given. |
| `in` | number | Where in the animation to start (seconds, default 0). |
| `out` | number | Where in the animation to stop (seconds, default its end). |
| `speed` | number | Playback speed (default 1). |
| `loops` | integer | How many times it plays (default 1; 0 = repeats until the next clip). |
| `blend` | number | Crossfade from the previous clip, in seconds (default 0.25 after another clip). |

### `add_clip`

Place a clip of an actor's animation on a shot of the scene, NLE-style: from 'start' it plays the animation between 'in' and 'out' at 'speed', 'loops' times, crossfading from the actor's previous clip over 'blend' seconds; after it ends the actor holds the last frame until its next clip. The shot grows to fit. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `actor` **required** | string | Actor name. |
| `shot` **required** | string | Shot (an animation of the scene) name. |
| `animation` **required** | string | The character's animation to play. |
| `start` **required** | number | When the clip starts on the shot, in seconds. |
| `in` | number | Where in the animation to start (seconds, default 0). |
| `out` | number | Where in the animation to stop (seconds, default its end). |
| `speed` | number | Playback speed (default 1). |
| `loops` | integer | How many times it plays (default 1; 0 = repeats until the next clip). |
| `blend` | number | Crossfade from the previous clip, in seconds (default 0.25 after another clip). |

### `remove_clip`

Remove an actor's clip that starts at 'start' (seconds) on a shot. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `actor` **required** | string | Actor name. |
| `shot` **required** | string | Shot name. |
| `start` **required** | number |  |

### `set_actor`

Change an actor: its setup position, size, facing, skin or name. To move it over time, key its bone (named in add_actor's result) with set_bone_key. Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `actor` **required** | string | Actor name. |
| `x` | number |  |
| `y` | number |  |
| `scale` | number |  |
| `flip` | boolean |  |
| `skin` | string | One of the character's skins ('' for the default). |
| `rename` | string | New actor name. |

### `set_layer_depth`

Set the depth of a top-level stage bone (a background or foreground layer) for parallax: when the 'camera' bone moves, a layer at depth z keeps up with focal / (focal + z) of the motion (focal 1000 by default), keeping its drawn size. 0 = no parallax; negative = in front of the picture plane (moves faster). Saves the work file.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |
| `bone` **required** | string | Bone name. |
| `depth` **required** | number |  |
| `focal` | number | Optional: the focal distance for the whole scene. |

### `run_script`

Run a Python script against a project with the Rigby2D scripting API (`import rigby`: bones, slots, animations, keys, selection, time; see https://rigby2d.com/docs/scripting.html), then save the project. The script runs in a sandbox (CPython 3.14 on Pyodide, standard library only). print() output is returned. If the script raises, nothing is saved and the traceback is returned. dry_run: true runs it without saving (for queries). 'animation' and 'time' set what rigby.current_animation() and rigby.time() return; 'selection' sets rigby.selected_bones().

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `script` | string | Python source. |
| `script_file` | string | A .py file inside the workspace, instead of script. |
| `animation` | string | Animation open while the script runs (Animate mode). Default: none (Setup mode). |
| `time` | number |  |
| `selection` | list of string | Selected bone names. |
| `dry_run` | boolean | Run without saving. |
| `output` | string | Save to this file instead of changing the input (same format as the input, inside the workspace). |
| `overwrite` | boolean | Replace `output` if it already exists (default false). |

### `world_to_local`

Convert a world point (Y up) into a bone's local coordinates, in the setup pose or at a time in an animation. Useful to place keys or attachments at a world position. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `bone` **required** | string | Bone name. |
| `point` **required** | list of number |  |
| `animation` | string | Animation name. |
| `time` | number |  |

### `lint_animations`

Check animations for common motion problems. Warnings: frame_jump (a bone moves more than 'jump_threshold' world units or turns more than 'rotation_threshold' degrees between frames), loop_seam and loop_attachment (a looping animation's last frame doesn't match its first; animations named idle, breath, walk, run or loop count as loops unless 'loop' says otherwise), missing_attachment (a key shows an attachment the slot doesn't have), overridden_keys (rotate keys on bones a full-mix IK constraint moves). Advisory only. *Read only.*

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `animation` | string | One animation (default all). |
| `loop` | boolean |  |
| `fps` | number |  |
| `jump_threshold` | number |  |
| `rotation_threshold` | number |  |

<!-- /generated:mcp-tools -->
