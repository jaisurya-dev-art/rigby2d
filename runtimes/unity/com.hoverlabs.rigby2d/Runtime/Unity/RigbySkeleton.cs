// SPDX-License-Identifier: MIT OR Apache-2.0
// Plays a Rigby2D skeleton: animation tracks with crossfades and queues, skins, events, physics,
// and a mesh drawn with one sub-mesh per atlas page and blend mode. Shows the pose in the editor
// too (Edit mode preview). Matches the Rigby2D editor frame by frame.
//
//   var hero = GetComponent<RigbySkeleton>();
//   hero.Play("walk", loop: true, mix: 0.2f);
//   hero.SetAnimation(1, "shoot", loop: false);        // layered on top
//   hero.AddAnimation(0, "idle", loop: true, mix: 0.3f); // after walk ends
//   hero.AnimationEvent += (skeleton, e) => { if (e.Name == "footstep") step.Play(); };
//   gun.position = hero.GetBoneWorldPosition("gun-tip");

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using RigbyEvent = Rigby2D.SkeletonEvent;

namespace Rigby2D.Unity
{
    public enum RigbyUpdateMode
    {
        /// <summary>Scaled game time (Time.deltaTime).</summary>
        Normal,
        /// <summary>Unscaled time: keeps playing while the game is paused with timeScale 0.</summary>
        UnscaledTime,
        /// <summary>Only when you call Advance(seconds).</summary>
        Manual,
    }

    [Serializable]
    public sealed class RigbyStringEvent : UnityEvent<string> { }

    [ExecuteAlways]
    [DisallowMultipleComponent]
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    [AddComponentMenu("Rigby2D/Rigby Skeleton")]
    [HelpURL("https://jaisurya-dev-art.github.io/rigby2d/docs/runtimes.html#unity")]
    public sealed class RigbySkeleton : MonoBehaviour
    {
        [Tooltip("The imported skeleton (made from a .atlas with its .json or .skel next to it).")]
        [SerializeField] RigbySkeletonAsset skeletonAsset;
        [Tooltip("Animation played on track 0 when the component starts.")]
        [SerializeField] string animationName = "";
        [SerializeField] bool loop = true;
        [Tooltip("Skin shown (empty: the default skin only).")]
        [SerializeField] string skinName = "";
        [Tooltip("Playback speed multiplier.")]
        [SerializeField, Min(0f)] float timeScale = 1f;
        [SerializeField] RigbyUpdateMode updateMode = RigbyUpdateMode.Normal;
        [Tooltip("Multiplies every color (alpha fades the whole skeleton).")]
        [SerializeField] Color color = Color.white;
        [SerializeField] bool flipX, flipY;
        [Tooltip("Keep animating (and simulating physics) while no camera sees the skeleton. Off: only time advances, which is far cheaper for crowds.")]
        [SerializeField] bool updateWhenInvisible;
        [Tooltip("Play the animation in the Scene view while not in Play mode.")]
        [SerializeField] bool previewInEditMode;
        [Tooltip("Called with the event name when an animation passes an event key.")]
        [SerializeField] RigbyStringEvent onEvent = new RigbyStringEvent();

        /// <summary>An event key was passed: the event merged with its definition (int, float, string, audio, volume, balance).</summary>
        public event Action<RigbySkeleton, RigbyEvent> AnimationEvent;
        /// <summary>An animation started on a track.</summary>
        public event Action<RigbySkeleton, int, string> AnimationStarted;
        /// <summary>An animation reached its end (every loop for looping animations).</summary>
        public event Action<RigbySkeleton, int, string> AnimationCompleted;
        /// <summary>An animation stopped affecting the pose (replaced, faded out or cleared).</summary>
        public event Action<RigbySkeleton, int, string> AnimationEnded;
        /// <summary>After the pose is computed and before the mesh is built: adjust bones here (look-at, IK targets, ragdoll blends).</summary>
        public event Action<RigbySkeleton> PoseUpdated;

        MeshFilter meshFilter;
        MeshRenderer meshRenderer;
        RigbyMeshWriter writer;
        readonly MeshBuilder builder = new MeshBuilder();
        readonly List<StateEvent> drained = new List<StateEvent>();
        SkeletonData data;
        int assetVersion = -1;
        bool dirty = true;
        bool visible = true;
        Material[] assignedMaterials;
        Func<int, int, Blend, Material> materialOf;

        /// <summary>The playing animation state (tracks, queues, speed). Null until the skeleton is loaded.</summary>
        public PlaybackState State { get; private set; }
        /// <summary>The evaluated pose: bone transforms (skeleton units, Y up), slot colors, attachments. Null until loaded.</summary>
        public SkeletonPose Pose { get; private set; }
        public SkeletonData Data => data;

        public RigbySkeletonAsset SkeletonAsset
        {
            get => skeletonAsset;
            set
            {
                if (skeletonAsset == value) return;
                skeletonAsset = value;
                Initialize(true);
            }
        }

        public float TimeScale { get => timeScale; set => timeScale = Mathf.Max(0f, value); }
        public Color Color { get => color; set { color = value; dirty = true; } }
        public bool FlipX { get => flipX; set { flipX = value; dirty = true; } }
        public bool FlipY { get => flipY; set { flipY = value; dirty = true; } }
        public RigbyUpdateMode UpdateMode { get => updateMode; set => updateMode = value; }
        public bool UpdateWhenInvisible { get => updateWhenInvisible; set => updateWhenInvisible = value; }
        float Scale => skeletonAsset != null ? 1f / skeletonAsset.PixelsPerUnit : 0.01f;

        /// <summary>The skin shown (null or empty: the default skin only).</summary>
        public string Skin
        {
            get => skinName;
            set
            {
                skinName = value ?? "";
                ApplySkin();
            }
        }

        void OnEnable()
        {
            Initialize(false);
            RigbyRunner.Register(this);
#if UNITY_EDITOR
            UnityEditor.EditorApplication.update -= EditorTick;
            UnityEditor.EditorApplication.update += EditorTick;
#endif
        }

        void OnDisable()
        {
            RigbyRunner.Unregister(this);
#if UNITY_EDITOR
            UnityEditor.EditorApplication.update -= EditorTick;
#endif
        }

        void OnDestroy()
        {
            writer?.Dispose();
            writer = null;
        }

        void OnValidate()
        {
            dirty = true;
            if (!isActiveAndEnabled) return;
            if (skeletonAsset == null || skeletonAsset.Version != assetVersion) Initialize(true);
            else
            {
                ApplySkin();
                if (!Application.isPlaying) StartDefaultAnimation();
            }
        }

        /// <summary>Loads (or reloads) the skeleton. Called automatically; call it after changing the asset's files at runtime.</summary>
        public void Initialize(bool overwrite)
        {
            if (!overwrite && Pose != null && skeletonAsset != null && skeletonAsset.Version == assetVersion) return;
            meshFilter = GetComponent<MeshFilter>();
            meshRenderer = GetComponent<MeshRenderer>();
            if (writer == null) writer = new RigbyMeshWriter(name);
            meshFilter.sharedMesh = writer.Mesh;
            data = skeletonAsset != null ? skeletonAsset.Data : null;
            assetVersion = skeletonAsset != null ? skeletonAsset.Version : -1;
            if (data == null)
            {
                Pose = null;
                State = null;
                writer.Mesh.Clear();
                assignedMaterials = new Material[0];
                meshRenderer.sharedMaterials = assignedMaterials;
                return;
            }
            Pose = new SkeletonPose(data);
            State = new PlaybackState();
            ApplySkin();
            StartDefaultAnimation();
            dirty = true;
            Refresh();
        }

        void ApplySkin()
        {
            if (Pose == null) return;
            if (string.IsNullOrEmpty(skinName) || skinName == "default") Pose.Skin = -1;
            else
            {
                Pose.Skin = data.FindSkin(skinName);
                if (Pose.Skin < 0) Debug.LogWarning($"Rigby2D: '{name}' has no skin '{skinName}'", this);
            }
            dirty = true;
        }

        void StartDefaultAnimation()
        {
            if (State == null) return;
            State.ClearTrack(0);
            if (!string.IsNullOrEmpty(animationName) && State.SetAnimation(data, 0, animationName, loop, 0.0) == null)
                Debug.LogWarning($"Rigby2D: '{name}' has no animation '{animationName}'", this);
            Pose.ResetPhysics();
            dirty = true;
        }

        // ---- playback ----------------------------------------------------------------------------

        /// <summary>Plays name on track 0, crossfading over mix seconds. False if there is no such animation.</summary>
        public bool Play(string animation, bool loop = true, float mix = 0.2f) => SetAnimation(0, animation, loop, mix) != null;

        /// <summary>Starts name on track now (dropping its queue). Higher tracks layer over lower ones.</summary>
        public TrackEntry SetAnimation(int track, string animation, bool loop = true, float mix = 0.2f)
        {
            if (State == null) Initialize(false);
            if (State == null) return null;
            var e = State.SetAnimation(data, track, animation, loop, mix);
            if (e == null) Debug.LogWarning($"Rigby2D: '{name}' has no animation '{animation}'", this);
            dirty = true;
            return e;
        }

        /// <summary>Queues name on track after the current entry: when it ends (delay &lt; 0) or delay seconds after it starts.</summary>
        public TrackEntry AddAnimation(int track, string animation, bool loop = true, float mix = 0.2f, float delay = -1f)
        {
            if (State == null) Initialize(false);
            if (State == null) return null;
            var e = State.AddAnimation(data, track, animation, loop, mix, delay < 0f ? (double?)null : delay);
            if (e == null) Debug.LogWarning($"Rigby2D: '{name}' has no animation '{animation}'", this);
            return e;
        }

        public void ClearTrack(int track)
        {
            State?.ClearTrack(track);
            dirty = true;
        }

        /// <summary>Stops every track: the skeleton returns to its setup pose.</summary>
        public void Stop()
        {
            State?.Stop();
            dirty = true;
        }

        /// <summary>Name of the animation playing on track (null when none).</summary>
        public string CurrentAnimation(int track = 0)
        {
            var e = State?.Current(track);
            return e != null ? data.Animations[e.Animation].Name : null;
        }

        public bool HasAnimation(string animation) => data != null && data.FindAnimation(animation) >= 0;

        /// <summary>Restarts physics simulation from the current pose (after teleporting the character, for example).</summary>
        public void ResetPhysics() => Pose?.ResetPhysics();

        /// <summary>Advances playback by seconds and redraws now (for RigbyUpdateMode.Manual, Timeline scrubbing or tests).</summary>
        public void Advance(float seconds)
        {
            if (State == null) return;
            State.Update(data, seconds);
            dirty = true;
            Refresh();
        }

        // ---- frame phases (driven by RigbyRunner, on all cores) ------------------------------------

        bool frameDraw;
        double frameDt;
        float frameScale;
        Color4 frameTint;
        RegionLookup frameLookup;
        Exception frameError;

        /// <summary>Main thread, before the parallel phases: reads everything Unity-side. False when this skeleton does not update this frame.</summary>
        internal bool PrepareFrame()
        {
            if (State == null || Pose == null || updateMode == RigbyUpdateMode.Manual || !isActiveAndEnabled) return false;
            frameDt = (updateMode == RigbyUpdateMode.UnscaledTime ? Time.unscaledDeltaTime : Time.deltaTime) * timeScale;
            frameDraw = visible || updateWhenInvisible;
            frameScale = Scale;
            frameTint = new Color4(color.r, color.g, color.b, color.a);
            frameLookup = skeletonAsset.Lookup;
            frameError = null;
            return true;
        }

        /// <summary>Any thread: advances time and poses the skeleton (when it is drawn).</summary>
        internal void StepPose()
        {
            try
            {
                State.Update(data, frameDt);
                if (frameDraw) State.Apply(data, Pose);
            }
            catch (Exception e)
            {
                frameError = e;
            }
        }

        /// <summary>Main thread: your PoseUpdated hooks and the animation events.</summary>
        internal void AfterPose()
        {
            if (frameError != null)
            {
                Debug.LogException(frameError, this);
                frameDraw = false;
            }
            if (frameDraw && PoseUpdated != null)
            {
                try
                {
                    PoseUpdated(this);
                }
                catch (Exception e)
                {
                    Debug.LogException(e, this);
                }
            }
            RaiseEvents();
        }

        /// <summary>Any thread: builds the mesh geometry.</summary>
        internal void StepGeometry()
        {
            if (!frameDraw) return;
            try
            {
                RigbyMeshWriter.Configure(builder, frameScale, flipX, flipY);
                builder.Build(Pose, frameLookup, frameTint);
            }
            catch (Exception e)
            {
                frameError = e;
                frameDraw = false;
            }
        }

        /// <summary>Main thread: uploads the mesh.</summary>
        internal bool Upload()
        {
            if (frameError != null) Debug.LogException(frameError, this);
            if (!frameDraw || this == null) return false;
            dirty = false;
            UploadMesh();
            return true;
        }

        void UploadMesh()
        {
            var mats = writer.Write(builder, 0f, materialOf ?? (materialOf = (source, page, blend) => skeletonAsset.GetMaterial(page, blend)));
            if (!ReferenceEquals(assignedMaterials, mats))
            {
                assignedMaterials = mats;
                meshRenderer.sharedMaterials = mats;
            }
        }

#if UNITY_EDITOR
        double lastEditorTime;

        void EditorTick()
        {
            if (Application.isPlaying || this == null) return;
            if (skeletonAsset != null && skeletonAsset.Version != assetVersion) Initialize(true);
            double now = UnityEditor.EditorApplication.timeSinceStartup;
            double dt = Math.Min(now - lastEditorTime, 0.1);
            lastEditorTime = now;
            if (previewInEditMode && State != null)
            {
                State.Update(data, dt * timeScale);
                dirty = true;
                UnityEditor.SceneView.RepaintAll();
            }
            Refresh();
        }
#endif

        void OnBecameVisible() => visible = true;
        void OnBecameInvisible() => visible = false;

        /// <summary>Applies the animation state to the pose and rebuilds the mesh when anything changed.</summary>
        public void Refresh()
        {
            if (State == null || Pose == null || !dirty) return;
            bool draw = visible || updateWhenInvisible || !Application.isPlaying;
            if (!draw)
            {
                // Off screen: keep time moving (events still fire) but skip posing and drawing.
                RaiseEvents();
                return;
            }
            dirty = false;
            State.Apply(data, Pose);
            PoseUpdated?.Invoke(this);
            RaiseEvents();
            RigbyMeshWriter.Configure(builder, Scale, flipX, flipY);
            builder.Build(Pose, skeletonAsset.Lookup, new Color4(color.r, color.g, color.b, color.a));
            UploadMesh();
        }

        /// <summary>Recomputes world transforms after you changed Pose.Local by code (between PoseUpdated and drawing, or anytime).</summary>
        public void UpdateWorld()
        {
            Pose?.UpdateWorld();
            dirty = true;
        }

        void RaiseEvents()
        {
            State.DrainEvents(drained);
            foreach (var e in drained)
            {
                string animation = e.Animation >= 0 && e.Animation < data.Animations.Count ? data.Animations[e.Animation].Name : "";
                try
                {
                    switch (e.Kind)
                    {
                        case StateEventKind.Start:
                            AnimationStarted?.Invoke(this, e.Track, animation);
                            break;
                        case StateEventKind.Complete:
                            AnimationCompleted?.Invoke(this, e.Track, animation);
                            break;
                        case StateEventKind.End:
                            AnimationEnded?.Invoke(this, e.Track, animation);
                            break;
                        case StateEventKind.Event:
                            AnimationEvent?.Invoke(this, e.Event);
                            onEvent?.Invoke(e.Event.Name);
                            break;
                    }
                }
                catch (Exception ex)
                {
                    // A broken listener must not stop the animation or the other listeners.
                    Debug.LogException(ex, this);
                }
            }
        }

        // ---- bones -------------------------------------------------------------------------------

        /// <summary>Index of a bone, or -1.</summary>
        public int FindBone(string bone) => data != null ? data.FindBone(bone) : -1;

        /// <summary>A bone's position in this object's local space.</summary>
        public Vector3 GetBoneLocalPosition(int bone)
        {
            if (Pose == null || bone < 0 || bone >= Pose.World.Length) return Vector3.zero;
            var m = Pose.World[bone];
            float s = Scale;
            return new Vector3((float)m.Tx * s * (flipX ? -1 : 1), (float)m.Ty * s * (flipY ? -1 : 1), 0f);
        }

        /// <summary>A bone's position in world space (follows this object's transform).</summary>
        public Vector3 GetBoneWorldPosition(string bone) => transform.TransformPoint(GetBoneLocalPosition(FindBone(bone)));

        /// <summary>A bone's rotation around Z in this object's local space, in degrees.</summary>
        public float GetBoneLocalRotation(int bone)
        {
            if (Pose == null || bone < 0 || bone >= Pose.World.Length) return 0f;
            var m = Pose.World[bone];
            double a = m.A * (flipX ? -1 : 1), b = m.B * (flipY ? -1 : 1);
            return (float)(Math.Atan2(b, a) * 180.0 / Math.PI);
        }

        /// <summary>A bone's world scale along its own axes (skeleton units).</summary>
        public Vector2 GetBoneScale(int bone)
        {
            if (Pose == null || bone < 0 || bone >= Pose.World.Length) return Vector2.one;
            var m = Pose.World[bone];
            return new Vector2((float)MathUtil.Hypot(m.A, m.B), (float)MathUtil.Hypot(m.C, m.D));
        }

        /// <summary>The local transform matrix of a bone in this object's space (for custom attachments).</summary>
        public Matrix4x4 GetBoneLocalMatrix(int bone)
        {
            if (Pose == null || bone < 0 || bone >= Pose.World.Length) return Matrix4x4.identity;
            var m = Pose.World[bone];
            float s = Scale, fx = flipX ? -1 : 1, fy = flipY ? -1 : 1;
            var r = Matrix4x4.identity;
            r.m00 = (float)m.A * fx;
            r.m10 = (float)m.B * fy;
            r.m01 = (float)m.C * fx;
            r.m11 = (float)m.D * fy;
            r.m03 = (float)m.Tx * s * fx;
            r.m13 = (float)m.Ty * s * fy;
            return r;
        }

        void OnDrawGizmosSelected()
        {
            if (Pose == null || data == null) return;
            Gizmos.color = new Color(1f, 0.55f, 0.1f, 0.9f);
            Gizmos.matrix = transform.localToWorldMatrix;
            float s = Scale;
            for (int i = 0; i < data.Bones.Count; i++)
            {
                var m = Pose.World[i];
                var a = new Vector3((float)m.Tx * s * (flipX ? -1 : 1), (float)m.Ty * s * (flipY ? -1 : 1));
                m.Apply(Math.Max(data.Bones[i].Length, 4.0), 0, out double bx, out double by);
                var b = new Vector3((float)bx * s * (flipX ? -1 : 1), (float)by * s * (flipY ? -1 : 1));
                Gizmos.DrawLine(a, b);
            }
        }
    }
}
