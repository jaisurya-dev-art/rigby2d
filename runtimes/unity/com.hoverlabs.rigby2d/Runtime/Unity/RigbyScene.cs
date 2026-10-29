// SPDX-License-Identifier: MIT OR Apache-2.0
// Plays a scene made in the Rigby2D editor: the stage with its painted layers and camera, every
// character with its clips and crossfades, and parallax, drawn as one mesh in the stage's draw
// order. Optionally drives a Camera so it frames the scene like the editor's film output.
//
//   var cutscene = GetComponent<RigbyScene>();
//   cutscene.ShotFinished += shot => LoadNextLevel();
//   cutscene.Play("intro", loop: false);

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Rigby2D.Unity
{
    [ExecuteAlways]
    [DisallowMultipleComponent]
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    [AddComponentMenu("Rigby2D/Rigby Scene")]
    [HelpURL("https://jaisurya-dev-art.github.io/rigby2d/docs/scenes.html#in-games-and-apps")]
    public sealed class RigbyScene : MonoBehaviour
    {
        [SerializeField] RigbySceneAsset sceneAsset;
        [Tooltip("Shot (stage animation) played at start; empty: the first one.")]
        [SerializeField] string shot = "";
        [SerializeField] bool loop = true;
        [SerializeField] bool playOnStart = true;
        [SerializeField, Min(0f)] float speed = 1f;
        [SerializeField] RigbyUpdateMode updateMode = RigbyUpdateMode.Normal;
        [Tooltip("An orthographic camera to move with the stage's camera bone.")]
        [SerializeField] Camera followCamera;
        [Tooltip("Also zoom the camera: the stage's camera bone scale zooms in, like the editor's film framing.")]
        [SerializeField] bool followZoom;
        [Tooltip("World units visible vertically at camera scale 1 (the editor's output frame height ÷ pixels per unit).")]
        [SerializeField] float frameHeight = 10.8f;
        [SerializeField] bool previewInEditMode;

        /// <summary>The shot reached its end (each time round when looping).</summary>
        public event Action<string> ShotFinished;

        RigbyMeshWriter writer;
        readonly MeshBuilder builder = new MeshBuilder();
        readonly List<SceneLayer> layers = new List<SceneLayer>();
        int[] run = new int[64];
        List<RigbySkeletonAsset> sources = new List<RigbySkeletonAsset>();
        Material[] assignedMaterials;
        Func<int, int, Blend, Material> materialOf;
        MeshRenderer meshRenderer;
        bool finished;

        /// <summary>The scene player (stage pose, characters, time). Null until loaded.</summary>
        public ScenePlayer Player { get; private set; }

        public RigbySceneAsset SceneAsset
        {
            get => sceneAsset;
            set
            {
                sceneAsset = value;
                Load();
            }
        }

        public float Speed { get => speed; set => speed = Mathf.Max(0f, value); }
        public string CurrentShot => Player?.Shot;
        public float Time => Player != null ? (float)Player.Time : 0f;
        public float Duration => Player != null ? (float)Player.Duration() : 0f;
        float Scale => Player != null && sources.Count > 0 ? 1f / sources[0].PixelsPerUnit : 0.01f;

        void OnEnable()
        {
            Load();
#if UNITY_EDITOR
            UnityEditor.EditorApplication.update -= EditorTick;
            UnityEditor.EditorApplication.update += EditorTick;
#endif
        }

        void OnDisable()
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.update -= EditorTick;
#endif
        }

        void OnDestroy() => writer?.Dispose();

        void OnValidate()
        {
            if (isActiveAndEnabled) Load();
        }

        void Load()
        {
            meshRenderer = GetComponent<MeshRenderer>();
            if (writer == null) writer = new RigbyMeshWriter(name);
            GetComponent<MeshFilter>().sharedMesh = writer.Mesh;
            Player = sceneAsset != null ? sceneAsset.CreatePlayer(out sources) : null;
            if (Player == null)
            {
                writer.Mesh.Clear();
                return;
            }
            string s = string.IsNullOrEmpty(shot) ? Player.Shot : shot;
            if (s != null && Player.Stage.FindAnimation(s) < 0)
            {
                Debug.LogWarning($"Rigby2D: scene '{sceneAsset.name}' has no shot '{s}'", this);
                s = Player.Shot;
            }
            if (s != null && (playOnStart || !Application.isPlaying)) Player.Play(s, loop);
            else Player.Evaluate(0.0);
            finished = false;
            Draw();
        }

        /// <summary>Plays a shot from its start. False if there is no such shot.</summary>
        public bool Play(string shotName, bool loop = false)
        {
            if (Player == null || Player.Stage.FindAnimation(shotName) < 0) return false;
            this.loop = loop;
            Player.Play(shotName, loop);
            finished = false;
            Draw();
            return true;
        }

        /// <summary>Jumps to seconds into the current shot (physics starts again from there).</summary>
        public void Seek(float seconds)
        {
            if (Player == null) return;
            foreach (var c in Player.Characters) c.Pose.ResetPhysics();
            Player.Time = Mathf.Clamp(seconds, 0f, (float)Player.Duration());
            Player.Evaluate(0.0);
            finished = false;
            Draw();
        }

        /// <summary>Advances the scene by seconds and redraws.</summary>
        public void Advance(float seconds)
        {
            if (Player == null) return;
            double before = Player.Time;
            Player.Update(seconds);
            double d = Player.Duration();
            bool ended = d > 0 && (Player.Looping ? Player.Time < before : Player.Time >= d);
            Draw();
            if (ended && (Player.Looping || !finished))
            {
                finished = true;
                try
                {
                    ShotFinished?.Invoke(Player.Shot);
                }
                catch (Exception e)
                {
                    Debug.LogException(e, this);
                }
            }
        }

        void Update()
        {
            if (!Application.isPlaying || Player == null || updateMode == RigbyUpdateMode.Manual) return;
            Advance((updateMode == RigbyUpdateMode.UnscaledTime ? UnityEngine.Time.unscaledDeltaTime : UnityEngine.Time.deltaTime) * speed);
        }

        void LateUpdate()
        {
            if (followCamera == null || Player == null) return;
            if (!SceneData.CameraPosition(Player.Stage, Player.Pose, out double cx, out double cy)) return;
            var world = transform.TransformPoint(new Vector3((float)cx * Scale, (float)cy * Scale, 0f));
            followCamera.transform.position = new Vector3(world.x, world.y, followCamera.transform.position.z);
            if (followZoom && followCamera.orthographic)
            {
                int c = Player.Stage.FindBone("camera");
                double zoom = c >= 0 ? MathUtil.Hypot(Player.Pose.World[c].A, Player.Pose.World[c].B) : 1.0;
                followCamera.orthographicSize = frameHeight * 0.5f / (float)Math.Max(zoom, 1e-3);
            }
        }

#if UNITY_EDITOR
        double lastEditorTime;

        void EditorTick()
        {
            if (Application.isPlaying || this == null || Player == null) return;
            double now = UnityEditor.EditorApplication.timeSinceStartup;
            double dt = Math.Min(now - lastEditorTime, 0.1);
            lastEditorTime = now;
            if (!previewInEditMode) return;
            Advance((float)dt * speed);
            LateUpdate();
            UnityEditor.SceneView.RepaintAll();
        }
#endif

        /// <summary>The camera bone's position in world space (for your own camera rigs).</summary>
        public Vector3 GetCameraWorldPosition()
        {
            if (Player == null || !SceneData.CameraPosition(Player.Stage, Player.Pose, out double cx, out double cy)) return transform.position;
            return transform.TransformPoint(new Vector3((float)cx * Scale, (float)cy * Scale, 0f));
        }

        /// <summary>A bone of an actor (by its name in the scene) in world space.</summary>
        public Vector3 GetActorBoneWorldPosition(string actor, string bone)
        {
            if (Player == null) return transform.position;
            int a = Player.Scene.Actors.FindIndex(x => x.Name == actor);
            var c = Player.Character(a);
            int b = c != null ? c.Data.FindBone(bone) : -1;
            if (b < 0) return transform.position;
            var m = c.Pose.World[b];
            return transform.TransformPoint(new Vector3((float)m.Tx * Scale, (float)m.Ty * Scale, 0f));
        }

        void Draw()
        {
            if (Player == null || sources.Count == 0) return;
            RigbyMeshWriter.Configure(builder, Scale, false, false);
            builder.Clear();
            Player.DrawList(layers);
            int runCount = 0;
            void Flush()
            {
                if (runCount == 0) return;
                builder.Append(Player.Pose, sources[0].Lookup, Color4.White, run, runCount, 0);
                runCount = 0;
            }
            foreach (var layer in layers)
            {
                int ch = -1;
                if (layer.Actor >= 0)
                {
                    string id = Player.Scene.Actors[layer.Actor].Id;
                    for (int k = 0; k < Player.Characters.Count; k++)
                        if (Player.Characters[k].Id == id)
                        {
                            ch = k;
                            break;
                        }
                }
                if (ch < 0)
                {
                    if (run.Length <= runCount) Array.Resize(ref run, run.Length * 2);
                    run[runCount++] = layer.Slot;
                    continue;
                }
                Flush();
                var character = Player.Characters[ch];
                if (layer.Tint.A > 0.0 && ch + 1 < sources.Count)
                    builder.Append(character.Pose, sources[ch + 1].Lookup, layer.Tint, character.Pose.DrawOrder, character.Pose.DrawOrder.Length, ch + 1);
            }
            Flush();
            var mats = writer.Write(builder, 0f, materialOf ?? (materialOf = (source, page, blend) => source < sources.Count ? sources[source].GetMaterial(page, blend) : null));
            if (!ReferenceEquals(assignedMaterials, mats))
            {
                assignedMaterials = mats;
                meshRenderer.sharedMaterials = mats;
            }
        }
    }
}
