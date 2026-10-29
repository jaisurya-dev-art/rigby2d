// SPDX-License-Identifier: MIT OR Apache-2.0
// A scene exported from the Rigby2D editor (<name>.scene.json) gets a RigbySceneAsset next to it
// (<name>.rigbyscene.asset) that links the skeleton assets of its stage and characters. Skeletons
// with an atlas come from the .atlas importer; a stage without images (no atlas) is stored in its
// own skeleton asset (<file>.asset).

using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Rigby2D.Unity.Editor
{
    public sealed class RigbySceneImport : AssetPostprocessor
    {
        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            var scenes = new List<string>();
            foreach (var path in imported)
            {
                if (path.EndsWith(".scene.json")) scenes.Add(path);
                else if (path.EndsWith(".atlas") || path.EndsWith(".json") || path.EndsWith(".skel"))
                {
                    // A skeleton of a scene changed: refresh the scenes in its folder.
                    string dir = Path.GetDirectoryName(path);
                    if (dir != null && Directory.Exists(dir))
                        foreach (var s in Directory.GetFiles(dir, "*.scene.json"))
                        {
                            string sp = s.Replace('\\', '/');
                            if (!scenes.Contains(sp)) scenes.Add(sp);
                        }
                }
            }
            foreach (var path in scenes) Build(path);
        }

        /// <summary>Makes or updates the RigbySceneAsset of a scene manifest.</summary>
        public static RigbySceneAsset Build(string manifestPath)
        {
            string text;
            try
            {
                text = File.ReadAllText(manifestPath);
            }
            catch (IOException)
            {
                return null;
            }
            SceneData scene;
            string stageFile;
            try
            {
                scene = SceneData.ReadManifest(System.Text.Encoding.UTF8.GetBytes(text), out stageFile);
            }
            catch (LoadException e)
            {
                Debug.LogError($"Rigby2D: {manifestPath}: {e.Message}");
                return null;
            }
            string dir = Path.GetDirectoryName(manifestPath).Replace('\\', '/');
            var files = new List<string> { stageFile };
            foreach (var a in scene.Actors)
                if (a.Skeleton != null && !files.Contains(a.Skeleton)) files.Add(a.Skeleton);
            var parts = new List<RigbySceneAsset.Part>();
            foreach (var f in files) parts.Add(new RigbySceneAsset.Part { file = f, skeleton = SkeletonAssetFor(dir, f) });

            string assetPath = manifestPath.Substring(0, manifestPath.Length - ".scene.json".Length) + ".rigbyscene.asset";
            var asset = AssetDatabase.LoadAssetAtPath<RigbySceneAsset>(assetPath);
            bool create = asset == null;
            if (create) asset = ScriptableObject.CreateInstance<RigbySceneAsset>();
            asset.Set(text, parts);
            if (create) AssetDatabase.CreateAsset(asset, assetPath);
            else EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssetIfDirty(asset);
            return asset;
        }

        static RigbySkeletonAsset SkeletonAssetFor(string dir, string file)
        {
            string stem = Path.GetFileNameWithoutExtension(file);
            var fromAtlas = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>($"{dir}/{stem}.atlas");
            if (fromAtlas != null) return fromAtlas;
            // No atlas (a stage without images): keep the skeleton in an asset of its own.
            string skeletonPath = $"{dir}/{file}";
            if (!File.Exists(skeletonPath)) return null;
            string assetPath = $"{dir}/{stem}.rigbyskeleton.asset";
            var asset = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>(assetPath);
            bool create = asset == null;
            if (create) asset = ScriptableObject.CreateInstance<RigbySkeletonAsset>();
            asset.Set(File.ReadAllBytes(skeletonPath), file, "", new Texture2D[0], 100f, Shader.Find("Rigby2D/Skeleton"));
            if (create) AssetDatabase.CreateAsset(asset, assetPath);
            else EditorUtility.SetDirty(asset);
            return asset;
        }
    }
}
