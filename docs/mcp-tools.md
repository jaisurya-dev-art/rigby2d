# MCP tool reference

Every tool of the Rigby2D MCP server with its parameters. This page is generated from the server's
own tool definitions, so it always matches the version you run. For setup and the tools explained by
task, see [AI assistants (MCP)](mcp.md).

Paths are relative to the first `--root` folder, and the server never reads or writes outside the
root folders. Editing tools save the file in its own format, or a copy when `output` is given.

<!-- generated:mcp-tools -->

The server has **40 tools**. Parameters marked **required** must be given; the others are optional.

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

Write a project as skeleton JSON (format 3.8, 4.2 or 4.3) or binary .skel (4.3). Reads .rigby, .json or .skel. Writes skeleton data only; atlas and images are not repacked. Refuses to replace an existing file unless overwrite is true.

| Parameter | Type | Description |
| --- | --- | --- |
| `input` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `output` **required** | string | Output file ending in .json or .skel, inside the workspace. Its folder must exist. |
| `version` | `'3.8'`, `'4.2'`, `'4.3'` | Skeleton JSON format version (default 4.3; .skel is always 4.3). |
| `overwrite` | boolean | Replace the output file if it exists (default false). |

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

### `batch_edit`

Apply many edits in one call, loading and saving the project once, atomically: all of them are saved, or none. Each operation is { op, ...arguments } where op is one of add_bone, set_bone_setup, add_animation, set_bone_key, delete_bone_key, set_attachment_key, set_event_key and the arguments are that tool's (without path, output and overwrite). Operations run in order, so later ones can use what earlier ones created (add_animation, then its keys). Much faster than one call per key for building animations. Curves can be presets or a custom bezier [cx1, cy1, cx2, cy2].

| Parameter | Type | Description |
| --- | --- | --- |
| `path` **required** | string | Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root. |
| `operations` **required** | list of object | The edits, in order: { op, ...that tool's arguments } with op one of add_bone, set_bone_setup, add_animation, set_bone_key, delete_bone_key, set_attachment_key, set_event_key. |
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

Rename a bone. Poses that store the bone follow the new name. Saves the project.

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

Put a character (another .rigby work file) into this scene as an actor. Its whole project is stored inside the scene, and a stage bone and slot named after it are created: the bone places it (animate it to move, turn or scale the actor), the slot sets where it is drawn among the other layers. Optionally give it a first clip. Saves the work file.

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

Run a Python script against a project with the Rigby2D scripting API (`import rigby`: bones, slots, animations, keys, selection, time; see docs/scripting.md), then save the project. The script runs in a sandbox (CPython 3.14 on Pyodide, standard library only). print() output is returned. If the script raises, nothing is saved and the traceback is returned. dry_run: true runs it without saving (for queries). 'animation' and 'time' set what rigby.current_animation() and rigby.time() return; 'selection' sets rigby.selected_bones().

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

<!-- /generated:mcp-tools -->
