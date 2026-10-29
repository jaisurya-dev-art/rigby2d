// SPDX-License-Identifier: MIT OR Apache-2.0
// An imported Rigby2D scene (exported from the editor with File > Export > Scene for runtimes): the
// manifest and the skeleton asset of the stage and of each character. Made automatically next to a
// <name>.scene.json when the export folder is in the project.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Rigby2D.Unity
{
    public sealed class RigbySceneAsset : ScriptableObject
    {
        [Serializable]
        public sealed class Part
        {
            [Tooltip("The skeleton file the manifest names.")]
            public string file;
            public RigbySkeletonAsset skeleton;
        }

        [SerializeField, TextArea(3, 12)] string manifest = "";
        [SerializeField] List<Part> parts = new List<Part>();

        [NonSerialized] SceneData scene;
        [NonSerialized] string stageFile;
        [NonSerialized] string loadError;

        public IReadOnlyList<Part> Parts => parts;
        public string Manifest => manifest;

        public void Set(string manifestText, List<Part> skeletonParts)
        {
            manifest = manifestText ?? "";
            parts = skeletonParts ?? new List<Part>();
            scene = null;
            loadError = null;
        }

        void OnValidate()
        {
            scene = null;
            loadError = null;
        }

        /// <summary>Why the scene cannot be played, or null.</summary>
        public string LoadError
        {
            get
            {
                Load();
                return loadError;
            }
        }

        /// <summary>The parsed scene (actors, clips, depths), or null.</summary>
        public SceneData Scene
        {
            get
            {
                Load();
                return scene;
            }
        }

        public string StageFile
        {
            get
            {
                Load();
                return stageFile;
            }
        }

        /// <summary>The skeleton asset of a file named in the manifest, or null.</summary>
        public RigbySkeletonAsset SkeletonOf(string file)
        {
            foreach (var p in parts)
                if (p.file == file) return p.skeleton;
            return null;
        }

        void Load()
        {
            if (scene != null || loadError != null) return;
            try
            {
                scene = SceneData.ReadManifest(System.Text.Encoding.UTF8.GetBytes(manifest ?? ""), out stageFile);
                var missing = new List<string>();
                if (SkeletonOf(stageFile) == null) missing.Add(stageFile);
                foreach (var a in scene.Actors)
                    if (a.Skeleton != null && SkeletonOf(a.Skeleton) == null && !missing.Contains(a.Skeleton)) missing.Add(a.Skeleton);
                if (missing.Count > 0) loadError = $"missing skeleton assets for {string.Join(", ", missing)} (put each skeleton's .atlas, .png and .json next to the scene)";
            }
            catch (Exception e)
            {
                scene = null;
                loadError = e.Message;
            }
            if (loadError != null) Debug.LogError($"Rigby2D scene '{name}': {loadError}", this);
        }

        /// <summary>A new player for the scene, or null when it cannot be loaded.</summary>
        public ScenePlayer CreatePlayer(out List<RigbySkeletonAsset> sources)
        {
            sources = new List<RigbySkeletonAsset>();
            Load();
            if (scene == null) return null;
            var stage = SkeletonOf(stageFile);
            if (stage == null || stage.Data == null) return null;
            sources.Add(stage);
            var characters = new List<KeyValuePair<string, SkeletonData>>();
            foreach (var a in scene.Actors)
            {
                if (characters.Exists(c => c.Key == a.Id) || a.Skeleton == null) continue;
                var asset = SkeletonOf(a.Skeleton);
                if (asset == null || asset.Data == null) continue;
                characters.Add(new KeyValuePair<string, SkeletonData>(a.Id, asset.Data));
                sources.Add(asset);
            }
            return new ScenePlayer(stage.Data, scene, characters);
        }
    }
}
