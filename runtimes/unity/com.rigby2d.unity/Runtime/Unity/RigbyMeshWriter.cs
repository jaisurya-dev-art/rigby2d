// SPDX-License-Identifier: MIT OR Apache-2.0
// Uploads MeshBuilder output to a Unity Mesh: one interleaved vertex buffer, one sub-mesh per batch
// (atlas page and blend mode), and the matching materials. Buffers and the material array are
// reused, so steady playback allocates nothing.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Rendering;

namespace Rigby2D.Unity
{
    internal sealed class RigbyMeshWriter : IDisposable
    {
        static readonly VertexAttributeDescriptor[] Layout =
        {
            // 28 bytes per vertex: colors as bytes, as in MeshBuilder's interleaved output.
            new VertexAttributeDescriptor(VertexAttribute.Position, VertexAttributeFormat.Float32, 3),
            new VertexAttributeDescriptor(VertexAttribute.Color, VertexAttributeFormat.UNorm8, 4),
            new VertexAttributeDescriptor(VertexAttribute.TexCoord0, VertexAttributeFormat.Float32, 2),
            new VertexAttributeDescriptor(VertexAttribute.TexCoord1, VertexAttributeFormat.UNorm8, 4),
        };

        public readonly Mesh Mesh;
        int vertexCapacity = -1, indexCapacity = -1;
        Material[] materials = new Material[0];
        SubMeshDescriptor[] descriptors = new SubMeshDescriptor[4];
        readonly List<Material> wanted = new List<Material>();

        public RigbyMeshWriter(string name)
        {
            Mesh = new Mesh { name = name, hideFlags = HideFlags.DontSave };
            Mesh.MarkDynamic();
        }

        /// <summary>Sets up a builder for this writer: interleaved output in Unity's vertex layout, scaled and mirrored.</summary>
        public static void Configure(MeshBuilder b, float scale, bool flipX, bool flipY)
        {
            b.Interleave = true;
            b.FlipV = true;
            b.ScaleX = flipX ? -scale : scale;
            b.ScaleY = flipY ? -scale : scale;
        }

        /// <summary>Writes the geometry of a builder set up with Configure. material(source, page, blend)
        /// gives the material of each batch. Returns the materials array for the renderer (the same
        /// instance while nothing changes).</summary>
        public Material[] Write(MeshBuilder b, float z, Func<int, int, Blend, Material> material)
        {
            int n = b.VertexCount;
            float sx = b.ScaleX, sy = b.ScaleY;
            const MeshUpdateFlags quiet = MeshUpdateFlags.DontValidateIndices | MeshUpdateFlags.DontResetBoneBounds | MeshUpdateFlags.DontNotifyMeshUsers | MeshUpdateFlags.DontRecalculateBounds;
            // Grow the GPU buffers in steps, so a mesh that changes size every frame does not reallocate every frame.
            int vCap = Math.Max(n, 4);
            if (vCap > vertexCapacity || vCap < vertexCapacity / 4)
            {
                vertexCapacity = Mathf.NextPowerOfTwo(vCap);
                Mesh.SetVertexBufferParams(vertexCapacity, Layout);
            }
            Mesh.SetVertexBufferData(b.Interleaved, 0, 0, n * MeshBuilder.InterleavedStride, 0, quiet);
            int ic = Math.Max(b.IndexCount, 3);
            bool topology = !SameTopology(b);
            if (ic > indexCapacity || ic < indexCapacity / 4)
            {
                indexCapacity = Mathf.NextPowerOfTwo(ic);
                Mesh.SetIndexBufferParams(indexCapacity, IndexFormat.UInt32);
                topology = true;
            }
            // Most frames only move vertices: the triangles and sub-meshes upload only when they change.
            if (topology) Mesh.SetIndexBufferData(b.Indices, 0, 0, b.IndexCount, quiet);

            // Sub-meshes: count and ranges in one call (the subMeshCount setter would resize the index buffer).
            int batches = b.Batches.Count;
            int subMeshes = Math.Max(batches, 1);
            if (descriptors.Length < subMeshes) descriptors = new SubMeshDescriptor[Math.Max(subMeshes, descriptors.Length * 2)];
            wanted.Clear();
            var bounds = n > 0
                ? new Bounds(new Vector3((b.MinX + b.MaxX) * 0.5f * sx, (b.MinY + b.MaxY) * 0.5f * sy, z), new Vector3(Mathf.Abs((b.MaxX - b.MinX) * sx), Mathf.Abs((b.MaxY - b.MinY) * sy), 0f))
                : new Bounds(new Vector3(0, 0, z), Vector3.zero);
            if (batches == 0) descriptors[0] = new SubMeshDescriptor(0, 0) { bounds = bounds, vertexCount = 0 };
            for (int k = 0; k < batches; k++)
            {
                var batch = b.Batches[k];
                descriptors[k] = new SubMeshDescriptor(batch.IndexStart, batch.IndexCount) { bounds = bounds, firstVertex = 0, vertexCount = n };
                wanted.Add(material(batch.Source, batch.Page, batch.Blend));
            }
            if (topology)
            {
                Mesh.SetSubMeshes(descriptors, 0, subMeshes, quiet);
                Remember(b);
            }
            Mesh.bounds = bounds;
            if (!SameMaterials())
            {
                materials = wanted.ToArray();
            }
            return materials;
        }

        int[] lastIndices = new int[0];
        int lastIndexCount = -1, lastVertexCount = -1;
        readonly List<MeshBatch> lastBatches = new List<MeshBatch>();

        bool SameTopology(MeshBuilder b)
        {
            if (b.IndexCount != lastIndexCount || b.VertexCount != lastVertexCount || b.Batches.Count != lastBatches.Count) return false;
            for (int i = 0; i < lastBatches.Count; i++)
            {
                MeshBatch x = b.Batches[i], y = lastBatches[i];
                if (x.IndexStart != y.IndexStart || x.IndexCount != y.IndexCount) return false;
            }
            var idx = b.Indices;
            for (int i = 0; i < lastIndexCount; i++)
                if (idx[i] != lastIndices[i]) return false;
            return true;
        }

        void Remember(MeshBuilder b)
        {
            // Sized like the GPU index buffer (a power of two), so it is reallocated as rarely as that.
            if (lastIndices.Length < b.IndexCount) lastIndices = new int[Math.Max(Math.Max(b.IndexCount, indexCapacity), lastIndices.Length * 2)];
            Array.Copy(b.Indices, lastIndices, b.IndexCount);
            lastIndexCount = b.IndexCount;
            lastVertexCount = b.VertexCount;
            lastBatches.Clear();
            lastBatches.AddRange(b.Batches);
        }

        bool SameMaterials()
        {
            if (materials.Length != wanted.Count) return false;
            for (int i = 0; i < wanted.Count; i++)
                if (materials[i] != wanted[i]) return false;
            return true;
        }

        public void Dispose()
        {
            if (Mesh == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(Mesh);
            else UnityEngine.Object.DestroyImmediate(Mesh);
        }
    }
}
