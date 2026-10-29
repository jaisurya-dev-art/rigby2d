// SPDX-License-Identifier: MIT OR Apache-2.0
// Scene composition: several characters (actors) acting together on a stage, with a camera and
// parallax. A port of src/core/scene.js (and the Rust runtime's scene.rs); it matches them frame by
// frame. The stage is an ordinary skeleton (backgrounds and props are its slots, the camera is its
// "camera" bone, its animations are the shots). Each actor is a character skeleton placed on an
// anchor bone of the stage, drawn where its slot sits in the stage's draw order, playing clips of
// its own animations on the scene timeline. Scenes are exported from the editor as
// <name>.scene.json (the manifest) next to the stage and character skeletons.

using System;
using System.Collections.Generic;
using System.Text;

namespace Rigby2D
{
    /// <summary>Loads skeletons from file bytes.</summary>
    public static class Skeletons
    {
        /// <summary>Loads skeleton data from file bytes: binary .skel or skeleton JSON.</summary>
        public static SkeletonData Load(byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0) throw new LoadException("the skeleton file is empty");
            Json json;
            if (SkeletonBinary.IsSkeletonBinary(bytes)) json = SkeletonBinary.Read(bytes);
            else
            {
                string text;
                try
                {
                    text = new UTF8Encoding(false, true).GetString(bytes);
                }
                catch (ArgumentException)
                {
                    throw new LoadException("the file is neither a binary skeleton nor UTF-8 JSON");
                }
                try
                {
                    json = Json.Parse(text);
                }
                catch (JsonParseException e)
                {
                    throw new LoadException($"invalid JSON: {e.Message}");
                }
            }
            return SkeletonJson.Read(json);
        }
    }

    /// <summary>A clip of an actor's animation on the scene timeline.</summary>
    public sealed class Clip
    {
        public string Animation;
        /// <summary>Scene time the clip starts.</summary>
        public double Start;
        /// <summary>In and out points in animation seconds (out null = the animation's end).</summary>
        public double InPoint;
        public double? OutPoint;
        public double Speed;
        /// <summary>Times played; 0 repeats until the next clip.</summary>
        public long Loops;
        /// <summary>Crossfade from the clip before, in seconds.</summary>
        public double Blend;
    }

    /// <summary>A character placed on the stage.</summary>
    public sealed class Actor
    {
        public string Id, Name;
        /// <summary>The stage bone it stands on and the stage slot it is drawn at.</summary>
        public string Bone, Slot;
        /// <summary>The character's skeleton file, relative to the manifest.</summary>
        public string Skeleton;
        public string Skin;
        public bool Flip;
        /// <summary>How far the character is raised so its feet stand on the anchor.</summary>
        public double Ground;
        /// <summary>Clips by shot (stage animation name), sorted by start.</summary>
        public List<KeyValuePair<string, List<Clip>>> Clips = new List<KeyValuePair<string, List<Clip>>>();

        static readonly List<Clip> None = new List<Clip>(0);

        public List<Clip> ClipsOf(string shot)
        {
            foreach (var e in Clips)
                if (e.Key == shot) return e.Value;
            return None;
        }
    }

    /// <summary>A composed scene: its actors and the depth of stage layers for parallax.</summary>
    public sealed class SceneData
    {
        /// <summary>Default distance from the camera to the picture plane, in world units (parallax strength).</summary>
        public const double DefaultFocal = 1000.0;
        /// <summary>Newest scene manifest format this runtime reads.</summary>
        public const double Format = 1.0;

        public List<Actor> Actors = new List<Actor>();
        /// <summary>Depth by top-level stage bone name.</summary>
        public List<KeyValuePair<string, double>> Depth = new List<KeyValuePair<string, double>>();
        public double Focal = DefaultFocal;

        /// <summary>A finite number of at least min, else def (like readClip in scene.js).</summary>
        static double Num(Json v, double def, double min)
        {
            var n = v.AsNumber;
            return n.HasValue && !double.IsNaN(n.Value) && !double.IsInfinity(n.Value) && n.Value >= min ? n.Value : def;
        }

        /// <summary>A clip with defaults for missing or invalid fields, or null when it has no animation.</summary>
        public static Clip ReadClip(Json c)
        {
            string animation = c["animation"].AsString;
            if (string.IsNullOrEmpty(animation)) return null;
            var o = c["out"];
            double outPoint = o.IsNull ? double.NaN : Num(o, double.NaN, 0.0);
            return new Clip
            {
                Animation = animation,
                Start = Num(c["start"], 0.0, 0.0),
                InPoint = Num(c["in"], 0.0, 0.0),
                OutPoint = double.IsNaN(outPoint) ? (double?)null : outPoint,
                Speed = Num(c["speed"], 1.0, 0.01),
                Loops = Rigby2D.Num.ToLong(Math.Floor(Num(c["loops"], 1.0, 0.0) + 0.5)),
                Blend = Num(c["blend"], 0.2, 0.0),
            };
        }

        /// <summary>A scene with defaults (see readScene in scene.js).</summary>
        public static SceneData Read(Json o)
        {
            var scene = new SceneData();
            foreach (var a in o["actors"].AsArray)
            {
                string id = a["id"].AsString, name = a["name"].AsString, bone = a["bone"].AsString, slot = a["slot"].AsString;
                if (id == null || name == null || bone == null || slot == null) continue;
                var actor = new Actor
                {
                    Id = id,
                    Name = name,
                    Bone = bone,
                    Slot = slot,
                    Skeleton = a["skeleton"].AsString,
                    Skin = string.IsNullOrEmpty(a["skin"].AsString) ? null : a["skin"].AsString,
                    Flip = a.Truthy("flip"),
                };
                var g = a["ground"].AsNumber;
                actor.Ground = g.HasValue && !double.IsNaN(g.Value) && !double.IsInfinity(g.Value) ? g.Value : 0.0;
                foreach (var e in a["clips"].Entries)
                {
                    var list = new List<(Clip c, int k)>();
                    int k = 0;
                    foreach (var cj in e.Value.AsArray)
                    {
                        var c = ReadClip(cj);
                        if (c != null) list.Add((c, k++));
                    }
                    // Stable sort by start, like the JavaScript and Rust runtimes.
                    list.Sort((x, y) =>
                    {
                        int r = x.c.Start < y.c.Start ? -1 : x.c.Start > y.c.Start ? 1 : 0;
                        return r != 0 ? r : x.k.CompareTo(y.k);
                    });
                    var clips = new List<Clip>(list.Count);
                    foreach (var x in list) clips.Add(x.c);
                    actor.Clips.Add(new KeyValuePair<string, List<Clip>>(e.Key, clips));
                }
                scene.Actors.Add(actor);
            }
            foreach (var e in o["depth"].Entries)
            {
                var z = e.Value.AsNumber;
                if (z.HasValue && !double.IsNaN(z.Value) && !double.IsInfinity(z.Value) && z.Value > -DefaultFocal * 0.95) scene.Depth.Add(new KeyValuePair<string, double>(e.Key, z.Value));
            }
            var f = o["focal"].AsNumber;
            scene.Focal = f.HasValue && f.Value > 0.0 ? f.Value : DefaultFocal;
            return scene;
        }

        /// <summary>Reads a scene manifest (&lt;name&gt;.scene.json): the stage skeleton's file and the scene.</summary>
        public static SceneData ReadManifest(byte[] bytes, out string stageFile)
        {
            Json o;
            try
            {
                o = Json.Parse(bytes);
            }
            catch (ArgumentException)
            {
                throw new LoadException("the scene manifest is not UTF-8");
            }
            catch (JsonParseException e)
            {
                throw new LoadException($"invalid JSON: {e.Message}");
            }
            var format = o["rigbyScene"].AsNumber;
            if (!format.HasValue) throw new LoadException("not a Rigby2D scene manifest");
            if (format.Value > Format) throw new LoadException($"scene format {format.Value} is newer than this runtime ({Format})");
            stageFile = o["stage"].AsString ?? throw new LoadException("the scene manifest names no stage skeleton");
            return Read(o);
        }

        /// <summary>Loads an exported scene. read(file) returns the bytes of a file named in the manifest (relative to it): the stage and character skeletons (JSON or .skel).</summary>
        public static ScenePlayer Load(byte[] manifest, Func<string, byte[]> read)
        {
            var scene = ReadManifest(manifest, out string stageFile);
            SkeletonData LoadFile(string file)
            {
                byte[] bytes;
                try
                {
                    bytes = read(file);
                }
                catch (Exception e)
                {
                    throw new LoadException($"{file}: {e.Message}", e);
                }
                try
                {
                    return Skeletons.Load(bytes);
                }
                catch (LoadException e)
                {
                    throw new LoadException($"{file}: {e.Message}", e);
                }
            }
            var stage = LoadFile(stageFile);
            var characters = new List<KeyValuePair<string, SkeletonData>>();
            foreach (var a in scene.Actors)
            {
                if (characters.Exists(c => c.Key == a.Id)) continue;
                if (a.Skeleton != null) characters.Add(new KeyValuePair<string, SkeletonData>(a.Id, LoadFile(a.Skeleton)));
            }
            return new ScenePlayer(stage, scene, characters);
        }

        // ---- clips ---------------------------------------------------------------------------------------

        static SkeletonAnimation AnimOf(SkeletonData data, string name)
        {
            int i = data.FindAnimation(name);
            return i >= 0 ? data.Animations[i] : null;
        }

        /// <summary>The part of the animation a clip plays: (in, out) in animation seconds.</summary>
        public static void ClipSpan(Clip clip, SkeletonAnimation anim, out double inPoint, out double outPoint)
        {
            double end = anim?.Duration ?? 0.0;
            outPoint = clip.OutPoint.HasValue ? Rigby2D.Num.Min(clip.OutPoint.Value, end != 0.0 && !double.IsNaN(end) ? end : clip.OutPoint.Value) : end;
            inPoint = Rigby2D.Num.Min(clip.InPoint, outPoint);
        }

        /// <summary>How long a clip lasts on the scene timeline (infinite for loops = 0).</summary>
        public static double ClipLength(Clip clip, SkeletonAnimation anim)
        {
            ClipSpan(clip, anim, out double a, out double b);
            if (clip.Loops == 0) return double.PositiveInfinity;
            return ((b - a) * clip.Loops) / clip.Speed;
        }

        /// <summary>The animation time a clip shows at scene time t (holding its last frame once it is over).</summary>
        public static double ClipTime(Clip clip, SkeletonAnimation anim, double t)
        {
            ClipSpan(clip, anim, out double a, out double b);
            double span = b - a;
            double local = Rigby2D.Num.Max(t - clip.Start, 0.0) * clip.Speed;
            if (span <= 0.0) return a;
            double total = clip.Loops == 0 ? double.PositiveInfinity : span * clip.Loops;
            if (local >= total) return b;
            return a + local % span;
        }

        /// <summary>What an actor shows at a scene time: the current clip's animation and time and, while crossfading, the previous clip's (from) with alpha (0 = all from, 1 = all current).</summary>
        public struct ActorState
        {
            public int Anim;
            public double Time;
            public int FromAnim;
            public double FromTime;
            public double Alpha;
        }

        /// <summary>The actor's state at scene time t in shot; false before its first clip (setup pose).</summary>
        public static bool ActorStateAt(Actor actor, SkeletonData data, string shot, double t, out ActorState state)
        {
            state = default;
            var clips = actor.ClipsOf(shot);
            int k = -1;
            for (int i = clips.Count - 1; i >= 0; i--)
                if (clips[i].Start <= t + 1e-9)
                {
                    k = i;
                    break;
                }
            if (k < 0) return false;
            var cur = clips[k];
            int curAnim = data.FindAnimation(cur.Animation);
            state.Anim = curAnim;
            state.Time = ClipTime(cur, curAnim >= 0 ? data.Animations[curAnim] : null, t);
            state.FromAnim = -1;
            state.Alpha = 1.0;
            if (k > 0 && cur.Blend > 0.0 && t - cur.Start < cur.Blend)
            {
                var prev = clips[k - 1];
                int p = data.FindAnimation(prev.Animation);
                if (p >= 0)
                {
                    state.FromAnim = p;
                    state.FromTime = ClipTime(prev, data.Animations[p], t);
                }
                state.Alpha = MathUtil.Clamp((t - cur.Start) / cur.Blend, 0.0, 1.0);
            }
            return true;
        }

        /// <summary>The scene time an actor's finite clips end in shot.</summary>
        public static double ActorEnd(Actor actor, SkeletonData data, string shot)
        {
            double end = 0.0;
            foreach (var c in actor.ClipsOf(shot))
            {
                double len = ClipLength(c, AnimOf(data, c.Animation));
                end = Rigby2D.Num.Max(end, c.Start + (double.IsInfinity(len) || double.IsNaN(len) ? 0.0 : len));
            }
            return end;
        }

        // ---- posing --------------------------------------------------------------------------------------

        /// <summary>The placement of an actor: its anchor bone's world transform, mirrored when flipped, raised by its ground offset.</summary>
        public static Affine ActorPlacement(SkeletonData stage, SkeletonPose stagePose, Actor actor)
        {
            int b = stage.FindBone(actor.Bone);
            var w = b >= 0 ? stagePose.World[b] : Affine.Identity;
            if (actor.Flip)
            {
                w.A = -w.A;
                w.B = -w.B;
            }
            double g = actor.Ground;
            if (g != 0.0)
            {
                w.Tx += w.C * g;
                w.Ty += w.D * g;
            }
            return w;
        }

        /// <summary>Poses an actor at scene time t: resets pose, applies its clip (crossfading from the previous one), places it on its anchor bone and updates world transforms, simulating physicsDelta seconds of physics.</summary>
        public static void PoseActor(SkeletonData stage, SkeletonPose stagePose, Actor actor, SkeletonData data, string shot, double t, SkeletonPose pose, double physicsDelta)
        {
            if (actor.Skin != null)
            {
                int skin = data.FindSkin(actor.Skin);
                if (skin >= 0) pose.Skin = skin;
            }
            pose.Reset();
            if (ActorStateAt(actor, data, shot, t, out var st))
            {
                if (st.FromAnim >= 0) pose.Apply(st.FromAnim, st.FromTime, 1.0);
                if (st.Anim >= 0) pose.Apply(st.Anim, st.Time, st.FromAnim >= 0 ? st.Alpha : 1.0);
            }
            // A new pose simulated its setup pose at the origin: start physics afresh where the actor stands.
            if (!pose.Placement.HasValue) pose.ResetPhysics();
            pose.Placement = ActorPlacement(stage, stagePose, actor);
            pose.PhysicsDelta = physicsDelta;
            pose.UpdateWorld();
        }

        // ---- parallax ------------------------------------------------------------------------------------

        /// <summary>Depth factor of a layer at depth z: how much of the camera's motion it keeps up with.</summary>
        public static double DepthFactor(double z, double focal) => focal / (focal + z);

        /// <summary>World position of the stage's camera bone; false when there is none.</summary>
        public static bool CameraPosition(SkeletonData stage, SkeletonPose pose, out double x, out double y)
        {
            int c = stage.FindBone("camera");
            if (c < 0)
            {
                x = y = 0;
                return false;
            }
            x = pose.World[c].Tx;
            y = pose.World[c].Ty;
            return true;
        }

        readonly List<KeyValuePair<int, Affine>> desired = new List<KeyValuePair<int, Affine>>();

        /// <summary>Moves every bone with a depth, with its children, by (1 - depth factor) of how far the camera has moved from its setup position.</summary>
        public void ApplyParallax(SkeletonData stage, SkeletonPose pose, bool hasSetupCamera, double setupX, double setupY)
        {
            if (Depth.Count == 0 || !hasSetupCamera) return;
            if (!CameraPosition(stage, pose, out double cx, out double cy)) return;
            double dx = cx - setupX, dy = cy - setupY;
            if (Math.Abs(dx) < 1e-9 && Math.Abs(dy) < 1e-9) return;
            desired.Clear();
            foreach (var e in Depth)
            {
                int b = stage.FindBone(e.Key);
                if (b < 0 || e.Value == 0.0) continue;
                double k = 1.0 - DepthFactor(e.Value, Focal);
                var w = pose.World[b];
                w.Tx += dx * k;
                w.Ty += dy * k;
                desired.RemoveAll(d => d.Key == b);
                desired.Add(new KeyValuePair<int, Affine>(b, w));
            }
            if (desired.Count > 0) pose.SetWorlds(desired);
        }
    }

    /// <summary>A character of a scene: its skeleton and pose (shared by actors with the same id).</summary>
    public sealed class SceneCharacter
    {
        public string Id;
        public SkeletonData Data;
        public SkeletonPose Pose;
    }

    /// <summary>One entry of the stage's draw order: a stage slot, or the actor drawn at it.</summary>
    public struct SceneLayer
    {
        public int Slot;
        /// <summary>Index into scene.Actors when an actor is drawn here, else -1.</summary>
        public int Actor;
        /// <summary>The slot's color, which tints and fades the actor.</summary>
        public Color4 Tint;
    }

    /// <summary>Plays a composed scene: the stage animation (shot), parallax and every actor's clips.</summary>
    public sealed class ScenePlayer
    {
        public readonly SkeletonData Stage;
        public readonly SceneData Scene;
        public readonly SkeletonPose Pose;
        public readonly List<SceneCharacter> Characters = new List<SceneCharacter>();
        public readonly bool HasSetupCamera;
        public readonly double SetupCameraX, SetupCameraY;
        public string Shot;
        public double Time;
        public bool Looping;

        public ScenePlayer(SkeletonData stage, SceneData scene, List<KeyValuePair<string, SkeletonData>> characters)
        {
            Stage = stage;
            Scene = scene;
            foreach (var c in characters) Characters.Add(new SceneCharacter { Id = c.Key, Data = c.Value, Pose = new SkeletonPose(c.Value) });
            Pose = new SkeletonPose(stage);
            HasSetupCamera = SceneData.CameraPosition(stage, new SkeletonPose(stage), out SetupCameraX, out SetupCameraY);
            Shot = stage.Animations.Count > 0 ? stage.Animations[0].Name : null;
        }

        /// <summary>The character an actor shows, or null.</summary>
        public SceneCharacter Character(int actor)
        {
            if (actor < 0 || actor >= Scene.Actors.Count) return null;
            string id = Scene.Actors[actor].Id;
            foreach (var c in Characters)
                if (c.Id == id) return c;
            return null;
        }

        /// <summary>Starts a shot from its beginning.</summary>
        public void Play(string shot, bool looping)
        {
            Shot = shot;
            Time = 0.0;
            Looping = looping;
            foreach (var c in Characters) c.Pose.ResetPhysics();
            Evaluate(0.0);
        }

        /// <summary>The shot's length: its stage animation, or the end of its last finite clip if later.</summary>
        public double Duration()
        {
            string shot = Shot ?? "";
            int a = Stage.FindAnimation(shot);
            double end = a >= 0 ? Stage.Animations[a].Duration : 0.0;
            foreach (var actor in Scene.Actors)
            foreach (var c in Characters)
                if (c.Id == actor.Id)
                {
                    end = Num.Max(end, SceneData.ActorEnd(actor, c.Data, shot));
                    break;
                }
            return end;
        }

        /// <summary>Advances the scene by dt seconds (looping or holding at the end) and poses everything.</summary>
        public void Update(double dt)
        {
            double t = Time + dt;
            double d = Duration();
            if (d > 0.0 && t > d) t = Looping ? t % d : d;
            Time = t;
            Evaluate(dt);
        }

        /// <summary>Poses the stage and every actor at the current time, simulating dt seconds of physics.</summary>
        public void Evaluate(double dt)
        {
            string shot = Shot ?? "";
            Pose.Reset();
            int a = Stage.FindAnimation(shot);
            if (a >= 0) Pose.Apply(a, Num.Min(Time, Stage.Animations[a].Duration), 1.0);
            Pose.PhysicsDelta = dt;
            Pose.UpdateWorld();
            Scene.ApplyParallax(Stage, Pose, HasSetupCamera, SetupCameraX, SetupCameraY);
            foreach (var actor in Scene.Actors)
            foreach (var c in Characters)
                if (c.Id == actor.Id)
                {
                    SceneData.PoseActor(Stage, Pose, actor, c.Data, shot, Time, c.Pose, dt);
                    break;
                }
        }

        /// <summary>The stage's draw order with actors in place, back to front.</summary>
        public void DrawList(List<SceneLayer> output)
        {
            output.Clear();
            foreach (int i in Pose.DrawOrder)
            {
                if (i < 0 || i >= Stage.Slots.Count) continue;
                int actor = -1;
                for (int k = Scene.Actors.Count - 1; k >= 0; k--)
                    if (Scene.Actors[k].Slot == Stage.Slots[i].Name)
                    {
                        actor = k;
                        break;
                    }
                output.Add(new SceneLayer { Slot = i, Actor = actor, Tint = Pose.Color[i] });
            }
        }
    }
}
