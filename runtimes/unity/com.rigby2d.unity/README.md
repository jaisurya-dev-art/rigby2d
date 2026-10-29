# Rigby2D for Unity

Play [Rigby2D](https://rigby2d.com/) skeletons and scenes in Unity 2021.3 or
newer (Unity 6 included), with the Built-in or the Universal render pipeline, on every platform
Unity builds for, with IL2CPP or Mono. The runtime is pure C# and matches the Rigby2D editor frame
by frame. Tested in Unity 6.3 (Built-in and URP, Gamma and Linear) and 2022.3, and in Windows
players built with IL2CPP and Mono.

## Install

In Unity, open **Window ▸ Package Manager ▸ + ▸ Install package from git URL…** and enter:

```
https://github.com/jaisurya-dev-art/rigby2d.git?path=/runtimes/unity/com.rigby2d.unity
```

Add `#v0.3.4` (or any release tag) to the end to pin a version. Each release also has the package as
a `.tgz` file for **Install package from tarball…**.

To try it, open the package in the Package Manager and import the **Demo** sample: Rigbytron in a
scene, with a script that plays animations and listens for events (Space: slash, F: flip).

## Use

1. In Rigby2D, export your skeleton: *File ▸ Export ▸ Binary .skel + atlas* (or *JSON + atlas*).
2. Put the `.skel` (or `.json`), the `.atlas` and its `.png` pages together in a folder under
   `Assets`. The `.atlas` becomes a **Rigby2D skeleton asset**, and the pages are set up for
   correct edges in any color space. Changing any of those files reimports it.
3. Drag the skeleton asset into the Scene view or Hierarchy. Pick an *Animation* in the inspector;
   tick *Preview in Edit Mode* to see it play without entering Play mode.

```csharp
using Rigby2D.Unity;
using UnityEngine;

public class Hero : MonoBehaviour
{
    [SerializeField] RigbySkeleton skeleton;
    [SerializeField] AudioSource step;
    [SerializeField] Transform gun;

    void Start()
    {
        skeleton.Play("walk", loop: true, mix: 0.2f);              // track 0, 0.2 s crossfade
        skeleton.SetAnimation(1, "shoot", loop: false);           // track 1 layers on top
        skeleton.AddAnimation(0, "idle", loop: true, mix: 0.3f);   // after walk ends
        skeleton.AnimationEvent += (s, e) =>
        {
            if (e.Name == "footstep") step.Play();
        };
    }

    void LateUpdate() => gun.position = skeleton.GetBoneWorldPosition("gun-tip");
}
```

Or add a **Rigby Bone Follower** to an object to make it follow a bone (position, rotation, scale).

### Scenes

A scene composed in the Rigby2D editor (several characters, clips, a camera and parallax) plays as
it does there:

1. In Rigby2D: *File ▸ Export ▸ Scene for runtimes*.
2. Put every file it writes in one folder under `Assets`: the skeletons import as above and the
   `.scene.json` gets a **Rigby2D scene asset** next to it.
3. Drag the scene asset into the Scene view. Its *Follow Camera* moves (and with *Follow Zoom*,
   zooms) an orthographic camera with the stage's camera bone.

```csharp
var cutscene = GetComponent<RigbyScene>();
cutscene.ShotFinished += shot => SceneManager.LoadScene("Level1");
cutscene.Play("intro", loop: false);
```

The [Demos page](https://rigby2d.com/demos/) has the NILA and Rigbytron scene
as an export, ready to drop in.

## Components

| Component | What it does |
| --- | --- |
| **Rigby Skeleton** | Plays a skeleton: animation, loop, skin, speed, update mode (scaled, unscaled, manual), tint, flips, events. |
| **Rigby Scene** | Plays an exported scene: shot, loop, speed, camera follow and zoom, events at the end of a shot. |
| **Rigby Bone Follower** | Moves an object with a bone of a Rigby Skeleton. |

### RigbySkeleton

| Member | Description |
| --- | --- |
| `Play(name, loop, mix)` | Plays on track 0 with a crossfade. Returns false if there is no such animation. |
| `SetAnimation(track, name, loop, mix)` | Plays on any track; higher tracks layer over lower ones. Returns the `TrackEntry` (set its `Alpha`, `TimeScale`). |
| `AddAnimation(track, name, loop, mix, delay)` | Queues after the current animation (`delay` < 0: when it ends). |
| `ClearTrack(track)`, `Stop()` | Stop a track, or all of them. |
| `Skin`, `TimeScale`, `Color`, `FlipX`, `FlipY`, `UpdateMode` | Properties, also in the inspector. |
| `Advance(seconds)` | Moves playback forward and redraws (with *Update Mode: Manual*, for Timeline or replays). |
| `GetBoneWorldPosition(name)`, `GetBoneLocalMatrix(index)`, `FindBone(name)` | Where bones are. |
| `AnimationEvent`, `AnimationStarted`, `AnimationCompleted`, `AnimationEnded` | C# events; the inspector's *On Event* is a UnityEvent with the event name. |
| `PoseUpdated` | Runs after posing and before drawing: change `Pose.Local` and call `Pose.UpdateWorld()` for procedural touches (look-at, aiming). |
| `State`, `Pose`, `Data` | The underlying `PlaybackState`, `SkeletonPose` and `SkeletonData` of the core runtime. |
| `ResetPhysics()` | Restarts physics from the current pose (after teleporting the character). |

## Why it is fast and stays out of your way

- **Every core.** Playing skeletons update together after your scripts' `Update`: time, poses
  (animation, IK, constraints, physics) and mesh geometry run in parallel on worker threads, then
  meshes upload on the main thread. Your callbacks always run on the main thread. Set
  `RigbySettings.WorkerThreads = 0` to use the main thread only. WebGL always does.
- **No garbage.** Steady playback allocates nothing, so there are no garbage collector pauses: one
  compact vertex buffer (28 bytes a vertex) and one sub-mesh per atlas page and blend mode, reused
  every frame; triangles upload only when they change.
- **Measured.** 200 NILAs on screen (39 bones, 1,002 skinned vertices, physics on her braid each), in
  a Windows player on a laptop (Core i5-10300H, 4 cores and 8 threads, GTX 1650):

  | 200 NILAs per frame | IL2CPP, all cores | IL2CPP, one core | Mono, all cores |
  | --- | ---: | ---: | ---: |
  | Animation, constraints, physics | 0.73 ms | 2.88 ms | 1.43 ms |
  | Mesh geometry | 1.79 ms | 6.40 ms | 3.45 ms |
  | Upload to the GPU | 2.46 ms | 2.00 ms | 3.23 ms |
  | **Total** | **5.0 ms (25 µs a character)** | 11.3 ms | 8.2 ms |
  | Garbage | 0 bytes | 0 bytes | 0 bytes |

  `RigbyStats` gives these timings for your own frames, and Unity's Profiler shows them as
  `Rigby2D.Pose`, `Rigby2D.Events`, `Rigby2D.Geometry` and `Rigby2D.Upload`.
- **Off screen, nearly free.** Skeletons no camera sees keep their time (and fire events) but skip
  posing and geometry, unless *Update When Invisible* is on.
- **Clean edges in Gamma and Linear.** Atlas pages import as raw pixels and the shader handles
  premultiplied or straight alpha and the color space itself, so there are no dark or bright
  fringes. Two-color tint and the normal, additive, multiply and screen blend modes are included,
  and the shader works in the Built-in and Universal render pipelines.
- **Reads what you export.** Skeleton JSON 3.8, 4.2 and 4.3 and binary `.skel` 4.3, checked at
  import with readable warnings, so a broken file is reported in the Console with its name rather
  than failing in Play mode.
- **The same results everywhere.** The C# runtime is tested against the JavaScript runtime that the
  Rigby2D editor uses, frame by frame, on every animation, crossfade, layered track, skin, event,
  physics simulation and scene of the demo projects (maximum difference 3e-9, see `Tests~`).

## Notes

- Skeleton units are pixels of the art; *Pixels Per Unit* (100 by default) is on the `.atlas`
  file's import settings.
- The core runtime (`Rigby2D.Core`, namespace `Rigby2D`) has no Unity dependency and runs in any
  .NET runtime: Godot (C#), MonoGame, Stride, servers or tools.
- NILA and Rigbytron (the demo) are demo content © Rigby2D, for learning and evaluating only; see
  the sample's `LICENSE.md`. The code is MIT OR Apache-2.0.

## Development

`Tests~` (not imported by Unity) holds the tests:

```bash
node runtimes/unity/com.rigby2d.unity/Tests~/run.mjs                    # golden tests (uses Unity's bundled .NET)
node runtimes/unity/com.rigby2d.unity/Tests~/run.mjs --bench <skeleton> <atlas>
node runtimes/unity/com.rigby2d.unity/Tests~/run-unity.mjs <unity project>   # in the Unity Editor: import, play, render, crowd
node runtimes/unity/com.rigby2d.unity/Tests~/run-unity.mjs <unity project> --player il2cpp   # build and run the player benchmark
RIGBY_URP=1 node runtimes/unity/com.rigby2d.unity/Tests~/run-unity.mjs <URP project>         # the same check in the Universal render pipeline
```
