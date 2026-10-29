// SPDX-License-Identifier: MIT OR Apache-2.0
// Imports a Rigby2D export: the .atlas file becomes a RigbySkeletonAsset that holds the skeleton with
// the same name next to it (.skel or .json) and the atlas page textures. Changing any of those
// files reimports it. Drop an export folder into Assets and drag the asset into a scene.

using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace Rigby2D.Unity.Editor
{
    // After textures (default queue 0), so the page textures exist when the atlas imports.
    [ScriptedImporter(3, "atlas", 100)]
    public sealed class RigbyAtlasImporter : ScriptedImporter
    {
        [Tooltip("Skeleton units (pixels of the art) per Unity unit.")]
        public float pixelsPerUnit = 100f;

        [Tooltip("The skeleton file; empty: <atlas name>.skel, else <atlas name>.json.")]
        public string skeletonFile = "";

        public override void OnImportAsset(AssetImportContext ctx)
        {
            string atlasPath = ctx.assetPath;
            string dir = Path.GetDirectoryName(atlasPath).Replace('\\', '/');
            string stem = Path.GetFileNameWithoutExtension(atlasPath);
            string atlasText = File.ReadAllText(atlasPath);

            string skelPath = FindSkeleton(dir, stem);
            var asset = ScriptableObject.CreateInstance<RigbySkeletonAsset>();
            asset.name = stem;
            byte[] bytes = null;
            if (skelPath != null)
            {
                ctx.DependsOnSourceAsset(skelPath);
                bytes = File.ReadAllBytes(skelPath);
            }
            else ctx.LogImportWarning($"Rigby2D: no skeleton next to {atlasPath} (expected {stem}.skel or {stem}.json)");

            // Page textures, in atlas order, from the atlas's folder.
            var atlas = Atlas.Parse(atlasText);
            var pages = new List<Texture2D>();
            foreach (var page in atlas.Pages)
            {
                string pagePath = dir + "/" + page.Name;
                ctx.DependsOnSourceAsset(pagePath);
                var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(pagePath);
                if (tex == null) ctx.LogImportWarning($"Rigby2D: atlas page {pagePath} is missing (or not imported yet)");
                pages.Add(tex);
            }
            var shader = Shader.Find("Rigby2D/Skeleton");
            asset.Set(bytes, skelPath != null ? Path.GetFileName(skelPath) : "", atlasText, pages.ToArray(), pixelsPerUnit, shader);

            // Validate now, so problems show in the Console at import rather than in Play mode.
            if (bytes != null)
            {
                try
                {
                    var data = Skeletons.Load(bytes);
                    foreach (var w in data.Warnings) ctx.LogImportWarning($"Rigby2D: {Path.GetFileName(skelPath)}: {w}");
                    var missing = new RegionLookup(data, atlas).Missing(data);
                    if (missing.Count > 0) ctx.LogImportWarning($"Rigby2D: {missing.Count} image(s) of {Path.GetFileName(skelPath)} are not in {Path.GetFileName(atlasPath)}: {string.Join(", ", missing)}");
                }
                catch (LoadException e)
                {
                    ctx.LogImportError($"Rigby2D: {Path.GetFileName(skelPath)}: {e.Message}");
                }
            }
            var icon = AssetPreview.GetMiniTypeThumbnail(typeof(RigbySkeletonAsset));
            ctx.AddObjectToAsset("skeleton", asset, icon);
            ctx.SetMainObject(asset);
        }

        string FindSkeleton(string dir, string stem)
        {
            if (!string.IsNullOrEmpty(skeletonFile))
            {
                string p = dir + "/" + skeletonFile;
                return File.Exists(p) ? p : null;
            }
            foreach (var ext in new[] { ".skel", ".skel.bytes", ".json" })
            {
                string p = dir + "/" + stem + ext;
                if (File.Exists(p)) return p;
            }
            return null;
        }
    }

    /// <summary>Atlas pages import as raw pixels with clamped, unscaled, uncompressed settings (see RigbySkeleton.shader for why sRGB is off).</summary>
    public sealed class RigbyTextureImport : AssetPostprocessor
    {
        void OnPreprocessTexture()
        {
            string dir = Path.GetDirectoryName(assetPath);
            string file = Path.GetFileName(assetPath);
            if (dir == null || !Directory.Exists(dir)) return;
            foreach (var atlasPath in Directory.GetFiles(dir, "*.atlas"))
            {
                Atlas atlas;
                try
                {
                    atlas = Atlas.Parse(File.ReadAllText(atlasPath));
                }
                catch
                {
                    continue;
                }
                foreach (var page in atlas.Pages)
                {
                    if (page.Name != file) continue;
                    var ti = (TextureImporter)assetImporter;
                    // Only the first import: later changes in the inspector are the user's.
                    if (!ti.importSettingsMissing) return;
                    ti.textureType = TextureImporterType.Default;
                    ti.sRGBTexture = false;
                    ti.alphaSource = TextureImporterAlphaSource.FromInput;
                    ti.alphaIsTransparency = !page.Pma;
                    ti.mipmapEnabled = false;
                    ti.npotScale = TextureImporterNPOTScale.None;
                    ti.wrapMode = TextureWrapMode.Clamp;
                    ti.filterMode = page.MinFilter.StartsWith("Nearest") ? FilterMode.Point : FilterMode.Bilinear;
                    ti.maxTextureSize = 8192;
                    ti.textureCompression = TextureImporterCompression.Uncompressed;
                    return;
                }
            }
        }

        // A skeleton that changed reimports the atlas that holds it.
        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            foreach (var path in imported)
            {
                if (!(path.EndsWith(".skel") || path.EndsWith(".json") || path.EndsWith(".png"))) continue;
                string dir = Path.GetDirectoryName(path);
                if (dir == null) continue;
                string stem = Path.GetFileNameWithoutExtension(path);
                string atlasPath = Path.Combine(dir, stem + ".atlas").Replace('\\', '/');
                if (File.Exists(atlasPath) && AssetImporter.GetAtPath(atlasPath) is RigbyAtlasImporter)
                {
                    // DependsOnSourceAsset already covers this when the atlas imported after the file; this catches the first import order.
                    var asset = AssetDatabase.LoadAssetAtPath<RigbySkeletonAsset>(atlasPath);
                    if (asset == null || asset.Data == null) AssetDatabase.ImportAsset(atlasPath);
                }
            }
        }
    }
}
