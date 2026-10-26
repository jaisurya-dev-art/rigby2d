# Rigby2D for film and video

Rigby2D started as an editor for game animation and now also makes animation for film, video and
motion graphics. The **Film workspace** gathers the tools for that. Switch to it with the
**Game | Film** switch at the top right of the editor, or start with *File ▸ New film project*.

## Workspaces

A workspace decides which tools the editor shows; it never changes the animation itself.

| | Game workspace | Film workspace |
| --- | --- | --- |
| For | Game engines and apps | Film, video, motion graphics |
| Output | Skeleton JSON / `.skel` + atlas, played by the runtimes | PNG sequences, WebM and MP4 renders (exports stay available) |
| Frame rate of new projects | 30 fps | 24 fps |
| Time display | Frames and seconds | Timecode (`HH:MM:SS:FF`) and frames |
| Output panel, output frame, render | Hidden | Shown |
| Pose library | Yes | Yes |
| Face controls | Hidden | Shown |

The workspace is saved with the project (`.rigby`), so a film project opens in the Film workspace.
New projects use the workspace you used last. Skeleton exports opened with *File ▸ Open* start in
the Game workspace.

Switching is always safe: film settings, poses and face controls live only in the project file and
are never written to skeleton exports, so game files are identical whichever workspace was used.

## Output settings

Select nothing (click an empty area of the viewport) to see the project panel. Its **Output**
section sets:

- **Frame rate**: 12, 15, 23.976, 24, 25, 29.97, 30, 48, 50 or 60 fps, or any rate. It also sets
  the frame grid of the timeline and keys.
- **Size**: 4K UHD, QHD, Full HD, HD, 2K Scope (2048×858), 2K Flat (1998×1080), vertical and
  square presets, or any size.
- **Background**: transparent, or a color.
- **Framing**: *Fit the animation* frames everything visible during the animation with a small
  margin; *Fixed* sets the frame's center and scale (world units per output pixel), or takes them
  from the viewport with *Use the current view*; *Follow the 'camera' bone* adds a bone named
  `camera` (if there is none) that moves the frame: key its position to pan and its scale to zoom
  in (scale 2 shows half as much). The output frame overlay follows it.

*View ▸ Show output frame* outlines the framed area in the viewport.

## Rendering

*File ▸ Render animation* renders at the output settings:

| Format | Transparency | Notes |
| --- | --- | --- |
| PNG sequence | Yes | One numbered PNG per frame (`name_0000.png`, …). |
| WebM, VP9 | Yes | Alpha is stored as the format expects; plays with transparency in browsers. Audio: Opus. |
| MP4, H.264 | No | Uses the background color (black when transparent). 23.976 and 29.97 fps are exact. Audio: AAC (Opus on systems without an AAC encoder). |

Tick several animations (and skins) to **batch render** them in one go: each combination becomes
its own file or sequence. For WebM and MP4, tick **Merge into one video** to put them back to
back in a single file instead, with their audio joined in the same order; each animation starts on
a key frame, so players seek to it cleanly. With one animation you can render a frame range.

Rendering is fast: at 1080p an MP4 frame takes about 12 ms and a PNG frame about 20 ms on a desktop
PC (PNG frames are encoded on several threads at once).

Renders are deterministic: physics and other time-dependent effects are simulated frame by frame
from the start of the animation. Video encoding uses the system's encoders through WebCodecs.

## Poses and face controls

The **Poses & face controls** section at the bottom of the inspector:

- **Save pose** stores the selected bones' pose (every bone when none is selected) together with
  the images their slots show, such as mouth shapes.
- **Apply** puts a pose back, at any amount (*Apply at*). In Setup mode it changes the setup pose;
  in Animate mode it sets keys at the current frame.
- **Face controls** are sliders that blend from the setup pose (or another pose) to a pose: brows
  up, eyes closed, mouth open. Rotations take the short way round, and image swaps switch at the
  halfway point. In Animate mode, dragging a slider keys the face at the current frame.

## Audio and lip-sync

*File ▸ Import audio* (or *Import audio* in the project panel) adds WAV, MP3, OGG, M4A or FLAC files
as audio tracks of the current animation. Each track has a start time and volume; tracks play with
the timeline and are stored inside the `.rigby` file.

**Lip-sync (mouth shapes)**: *Lip-sync…* in the audio section keys a mouth slot shape by shape from
the speech, so every sound gets its mouth. It uses the nine shapes animators use:

| Shape | For |
| --- | --- |
| A | ah, as in "father" |
| E | eh, as in "bed" |
| I | ee, and most consonants (C D G K N R S T Y Z) |
| O | oh, as in "go" |
| U | oo and w, as in "you" |
| MBP | lips closed: M, B, P |
| FV | lower lip on teeth: F, V |
| L | tongue up: L, TH |
| rest | silence between words |

The timing comes from one of:

- **The words spoken**: type the line; Rigby2D lays the words over the speech in the track (its
  loudness), each taking time for its sounds. Nothing else is needed.
- **A timing file** for exact timing:
  - ElevenLabs text-to-speech timestamps (character timings, so the voice you generated syncs
    exactly)
  - Whisper or any `[{ word, start, end }]` word-timing JSON
  - Rhubarb Lip Sync (`.tsv` or `.json`) and Papagayo / Moho switch files (`.dat`)

Pick the mouth slot (the slot whose images cover the most shapes is chosen for you) and check the
mapping: images are matched by name (`mouth_viseme_A`, `A`, `ah`, `MBP`, `mouth_smile` for rest...),
and any shape can be set by hand; a shape without an image uses the rest mouth. *Lead* sets how many
frames each mouth lands before its sound (2 by default, as animators time it) and *Hold at least*
how long a shape stays, so the mouth never flickers. *Generate lip-sync* replaces the mouth keys over
the length of the track as one undo step; the result is ordinary image-swap keys, so it exports to
skeleton JSON and `.skel` and plays in every runtime.

**Lip-sync (loudness)**: the *Lip-sync* button of a face control keys that control on every frame
from the loudness of the animation's first audio track: a "mouth open" control opens on speech and
closes in silence. Use it for mouths drawn as one shape that opens and closes.

WebM and MP4 renders include the animation's audio, mixed. Every render also writes it as
`<name>.wav` next to the frames or video, ready for your video editor.

## Coming next

Scene composition: several characters in one shot.
