# File formats

| File | What it is | Made by |
| --- | --- | --- |
| `.rigby` | The work file: a ZIP with `project.json` (the whole document) and `images/*.png`, plus `audio/*` for audio tracks. | *File ▸ Save* |
| `.json` | Skeleton JSON, format 3.8, 4.2 or 4.3. | *Export ▸ JSON + atlas* |
| `.skel` | Binary skeleton, format 4.3. | *Export ▸ Binary .skel + atlas* |
| `.atlas` + `.png` | Texture atlas: the packed images and where each one sits. | Every export |
| `.scene.json` | A scene for runtimes: actors, clips and depths, naming the stage and character skeletons next to it. | *Export ▸ Scene for runtimes* |

## The `.rigby` work file

One self-contained file, like a `.blend`: bones, slots, skins, constraints, events, animations,
images, and the editor-only data (workspace, film output settings, poses, face controls, audio
tracks). Open it with *File ▸ Open*. Keep it in version control or back it up; exports can always be
made again from it.

## Skeleton JSON and `.skel`

The interchange formats runtimes load. Bones are listed so parents come first, slots are in draw
order, attachments live in skins, and animations hold timelines with keys relative to the setup
pose. Images come from the `.atlas` or from loose files in the skeleton's `images` folder.

Rigby2D reads and writes these formats losslessly, for interoperability with your own exported files.
Support was implemented clean-room from public documentation and observation of exported data.

## Scene manifest (`.scene.json`)

```json
{
  "rigbyScene": 1,
  "stage": "street.json",
  "focal": 1000,
  "depth": { "hills": 500 },
  "actors": [
    {
      "id": "nila", "name": "NILA", "bone": "NILA", "slot": "NILA",
      "skeleton": "street.nila.json", "skin": null, "flip": false, "ground": -276,
      "clips": { "meet": [{ "animation": "wave", "start": 0, "in": 0, "out": null, "speed": 1, "loops": 1, "blend": 0 }] }
    }
  ]
}
```

`stage` and `skeleton` are relative to the manifest; each skeleton's atlas has the same name with
`.atlas`. An actor stands on the stage bone `bone` (raised by `ground`, mirrored when `flip`) and is
drawn at the stage slot `slot`. Clips are listed per shot (stage animation): `in`/`out` in
animation seconds (`out` null = the end), `loops` 0 = until the next clip, `blend` = crossfade
seconds from the clip before. `depth` moves top-level stage bones for parallax: a layer at depth
`z` follows `focal / (focal + z)` of the camera bone's motion.

## Coordinates and units

- Units are pixels of the artwork at scale 1.
- Y points **up** (runtimes for Y-down engines, such as Godot, convert).
- Angles are in degrees, counterclockwise.
- Times are in seconds.
