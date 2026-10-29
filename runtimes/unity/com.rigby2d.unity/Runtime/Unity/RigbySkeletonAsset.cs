// SPDX-License-Identifier: MIT OR Apache-2.0
// An imported Rigby2D skeleton: the skeleton file (JSON or .skel), its atlas and page textures.
// Made by the .atlas importer (drop an export folder into the project) or at runtime with Create.
// The skeleton is parsed once, on first use, and shared by every component that shows it.

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Rigby2D.Unity
{
    [CreateAssetMenu(menuName = "Rigby2D/Skeleton Asset (empty)", fileName = "Skeleton")]
    public sealed class RigbySkeletonAsset : ScriptableObject
    {
        [Tooltip("The skeleton export: binary .skel or skeleton JSON.")]
        [SerializeField, HideInInspector] byte[] skeletonBytes;
        [SerializeField] string skeletonFile;
        [SerializeField, HideInInspector] string atlasText;
        [Tooltip("Atlas page textures, in the atlas's page order.")]
        [SerializeField] Texture2D[] pages = new Texture2D[0];
        [Tooltip("Skeleton units (pixels of the art) per Unity unit.")]
        [SerializeField] float pixelsPerUnit = 100f;
        [SerializeField, HideInInspector] Shader shader;

        [NonSerialized] SkeletonData data;
        [NonSerialized] RegionLookup lookup;
        [NonSerialized] Atlas atlas;
        [NonSerialized] string loadError;
        [NonSerialized] Material[] materials;
        [NonSerialized] int version;

        /// <summary>Skeleton units per Unity unit.</summary>
        public float PixelsPerUnit
        {
            get => pixelsPerUnit > 0f ? pixelsPerUnit : 100f;
            set
            {
                pixelsPerUnit = value;
                version++;
            }
        }

        public string SkeletonFile => skeletonFile;
        public IReadOnlyList<Texture2D> Pages => pages;
        /// <summary>Changes whenever the asset is reloaded, so components know to rebuild.</summary>
        public int Version => version;

        /// <summary>Why the skeleton could not be loaded, or null.</summary>
        public string LoadError
        {
            get
            {
                Load();
                return loadError;
            }
        }

        /// <summary>The skeleton data, or null when it cannot be loaded (see LoadError).</summary>
        public SkeletonData Data
        {
            get
            {
                Load();
                return data;
            }
        }

        public RegionLookup Lookup
        {
            get
            {
                Load();
                return lookup;
            }
        }

        public Atlas Atlas
        {
            get
            {
                Load();
                return atlas;
            }
        }

        /// <summary>Makes a skeleton asset at runtime from file contents (e.g. downloaded mods or user content).</summary>
        public static RigbySkeletonAsset Create(byte[] skeleton, string atlasText, Texture2D[] pages, float pixelsPerUnit = 100f, string name = "Skeleton")
        {
            var a = CreateInstance<RigbySkeletonAsset>();
            a.name = name;
            a.Set(skeleton, name, atlasText, pages, pixelsPerUnit, null);
            return a;
        }

        /// <summary>Sets the asset's files (used by the importer).</summary>
        public void Set(byte[] skeleton, string file, string atlas, Texture2D[] pageTextures, float ppu, Shader skeletonShader)
        {
            skeletonBytes = skeleton;
            skeletonFile = file;
            atlasText = atlas ?? "";
            pages = pageTextures ?? new Texture2D[0];
            if (ppu > 0f) pixelsPerUnit = ppu;
            if (skeletonShader != null) shader = skeletonShader;
            Unload();
        }

        void OnValidate() => Unload();

        void OnDisable() => Unload();

        /// <summary>Drops the parsed data and materials; the next use loads them again.</summary>
        public void Unload()
        {
            data = null;
            lookup = null;
            atlas = null;
            loadError = null;
            if (materials != null)
                foreach (var m in materials)
                    if (m != null) DestroyMaterial(m);
            materials = null;
            version++;
        }

        static void DestroyMaterial(Material m)
        {
            if (Application.isPlaying) Destroy(m);
            else DestroyImmediate(m);
        }

        void Load()
        {
            if (data != null || loadError != null) return;
            try
            {
                if (skeletonBytes == null || skeletonBytes.Length == 0) throw new LoadException("no skeleton file");
                data = Skeletons.Load(skeletonBytes);
                atlas = Atlas.Parse(atlasText ?? "");
                lookup = new RegionLookup(data, atlas);
            }
            catch (Exception e)
            {
                data = null;
                loadError = string.IsNullOrEmpty(skeletonFile) ? e.Message : $"{skeletonFile}: {e.Message}";
                Debug.LogError($"Rigby2D: {loadError}", this);
            }
        }

        /// <summary>The material for an atlas page and a blend mode (shared by every component using this asset).</summary>
        public Material GetMaterial(int page, Blend blend)
        {
            Load();
            int pageCount = Math.Max(pages.Length, 1);
            if (materials == null || materials.Length != pageCount * 4) materials = new Material[pageCount * 4];
            page = Mathf.Clamp(page, 0, pageCount - 1);
            int k = page * 4 + (int)blend;
            var m = materials[k];
            if (m != null) return m;
            var s = shader != null ? shader : Shader.Find("Rigby2D/Skeleton");
            if (s == null) return null;
            m = new Material(s) { name = $"{name} page {page} {blend}", hideFlags = HideFlags.DontSave };
            if (page < pages.Length && pages[page] != null) m.mainTexture = pages[page];
            bool pma = atlas != null && page < atlas.Pages.Count && atlas.Pages[page].Pma;
            m.SetFloat("_Pma", pma ? 1f : 0f);
            SetBlend(m, blend);
            materials[k] = m;
            return m;
        }

        /// <summary>Blend factors for premultiplied output (see RigbySkeleton.shader).</summary>
        public static void SetBlend(Material m, Blend blend)
        {
            BlendMode src = BlendMode.One, dst = BlendMode.OneMinusSrcAlpha;
            switch (blend)
            {
                case Blend.Additive:
                    dst = BlendMode.One;
                    break;
                case Blend.Multiply:
                    src = BlendMode.DstColor;
                    dst = BlendMode.Zero;
                    break;
                case Blend.Screen:
                    dst = BlendMode.OneMinusSrcColor;
                    break;
            }
            m.SetFloat("_SrcBlend", (float)src);
            m.SetFloat("_DstBlend", (float)dst);
            m.SetFloat("_Multiply", blend == Blend.Multiply ? 1f : 0f);
            m.SetFloat("_Screen", blend == Blend.Screen ? 1f : 0f);
        }
    }
}
