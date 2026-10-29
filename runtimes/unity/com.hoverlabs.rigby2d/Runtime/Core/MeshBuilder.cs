// SPDX-License-Identifier: MIT OR Apache-2.0
// Turns a posed skeleton into textured triangles for an engine to draw: regions and meshes in draw
// order, mapped into atlas pages, masked by clipping attachments, split into batches by atlas page
// and blend mode. Matches the reference WebGL renderer (src/webgl/renderer.js) and the Rust
// RenderOutput, but writes one shared vertex buffer with an index range per batch, so an engine
// can upload a single mesh with one sub-mesh per batch. Buffers are reused: no garbage per frame.

using System;
using System.Collections.Generic;

namespace Rigby2D
{
    /// <summary>Atlas regions by skeleton image name id.</summary>
    public sealed class RegionLookup
    {
        readonly RegionUv[] regions;
        readonly bool[] has;

        public RegionLookup(SkeletonData sk, Atlas atlas)
        {
            var map = atlas.Lookup();
            regions = new RegionUv[sk.Names.Count];
            has = new bool[sk.Names.Count];
            for (int i = 0; i < sk.Names.Count; i++)
                if (map.TryGetValue(sk.Names[i], out var r))
                {
                    regions[i] = r;
                    has[i] = true;
                }
        }

        public bool TryGet(int image, out RegionUv region)
        {
            if (image >= 0 && image < has.Length && has[image])
            {
                region = regions[image];
                return true;
            }
            region = default;
            return false;
        }

        /// <summary>Images the skeleton's region and mesh attachments use that have no atlas region.</summary>
        public List<string> Missing(SkeletonData sk)
        {
            var used = new SortedSet<int>();
            void Visit(Attachment a)
            {
                if (a.Kind != AttachmentKind.Region && a.Kind != AttachmentKind.Mesh && a.Kind != AttachmentKind.LinkedMesh) return;
                if (a.Sequence != null)
                    foreach (int f in a.Sequence.Frames) used.Add(f);
                else used.Add(a.Image);
            }
            foreach (var slot in sk.Slots)
            foreach (var a in slot.Attachments)
                Visit(a);
            foreach (var skin in sk.Skins)
            foreach (var e in skin.Slots)
            foreach (var a in e.Value)
                Visit(a);
            var output = new List<string>();
            foreach (int i in used)
                if (!TryGet(i, out _)) output.Add(sk.Name(i));
            return output;
        }
    }

    /// <summary>Triangles that share an atlas page and a blend mode, in draw order: indices [IndexStart, IndexStart + IndexCount).</summary>
    public struct MeshBatch
    {
        /// <summary>Which skeleton's atlas Page belongs to: the source given to Append (0 for Build).</summary>
        public int Source;
        public int Page;
        public Blend Blend;
        public int IndexStart, IndexCount;
    }

    /// <summary>Reusable geometry output (its buffers are kept between frames).</summary>
    public sealed class MeshBuilder
    {
        /// <summary>Vertex count of the last build.</summary>
        public int VertexCount;
        /// <summary>World positions, 2 per vertex, Y up.</summary>
        public float[] Positions = new float[256];
        /// <summary>Page UVs, 2 per vertex, 0..1 with v down (flip for engines with v up).</summary>
        public float[] Uvs = new float[256];
        /// <summary>Light color (straight alpha), 4 per vertex: slot tint × attachment color × build tint.</summary>
        public float[] Colors = new float[512];
        /// <summary>Dark color for two-color tint (rgb), 4 per vertex; a = 1 when the slot has one.</summary>
        public float[] Darks = new float[512];
        public int IndexCount;
        public int[] Indices = new int[384];
        public readonly List<MeshBatch> Batches = new List<MeshBatch>();

        /// <summary>Bounds of the last build (world units, Y up); empty when nothing was drawn.</summary>
        public float MinX, MinY, MaxX, MaxY;

        /// <summary>Interleaved output for engines that upload one vertex buffer: when on, the separate
        /// arrays are left empty and Interleaved holds, per vertex, x, y, 0 (scaled by ScaleX / ScaleY),
        /// light r, g, b, a, u, v (v flipped when FlipV), dark r, g, b, a: InterleavedStride floats.</summary>
        public bool Interleave;
        public const int InterleavedStride = 13;
        public float[] Interleaved = new float[13 * 64];
        public float ScaleX = 1f, ScaleY = 1f;
        public bool FlipV;

        int source;
        readonly List<double> scratchP = new List<double>(), scratchUv = new List<double>();
        readonly List<double> clipP = new List<double>(), clipUv = new List<double>();
        readonly List<int> clipT = new List<int>();
        readonly Clipper clipper = new Clipper();
        static readonly int[] Quad = { 0, 1, 2, 0, 2, 3 };

        /// <summary>Builds the geometry of pose. tint multiplies every color.</summary>
        public void Build(SkeletonPose pose, RegionLookup lookup, Color4 tint)
        {
            Clear();
            Append(pose, lookup, tint, pose.DrawOrder, pose.DrawOrder.Length, 0);
        }

        /// <summary>Empties the output before a series of Appends.</summary>
        public void Clear()
        {
            VertexCount = 0;
            IndexCount = 0;
            Batches.Clear();
            MinX = MinY = float.PositiveInfinity;
            MaxX = MaxY = float.NegativeInfinity;
        }

        /// <summary>Adds the geometry of some slots of pose (slots, in draw order) after what is already built. Several skeletons can be layered this way (a scene's stage and characters); source tells their atlases apart in the batches.</summary>
        public void Append(SkeletonPose pose, RegionLookup lookup, Color4 tint, int[] slots, int slotCount, int source)
        {
            this.source = source;
            var sk = pose.Data;
            bool clipping = false;
            int clipEnd = -1;
            for (int s = 0; s < slotCount; s++)
            {
                int i = slots[s];
                if (i < 0 || i >= sk.Slots.Count) continue;
                var att = pose.SlotAttachment(i);
                if (att != null)
                {
                    switch (att.Kind)
                    {
                        case AttachmentKind.Clipping:
                            pose.WorldVertices(i, att, scratchP);
                            clipper.SetPolygon(scratchP);
                            clipping = true;
                            clipEnd = att.End == i ? -1 : att.End; // ending at its own slot: to the end
                            break;
                        case AttachmentKind.Region:
                        case AttachmentKind.Mesh:
                        case AttachmentKind.LinkedMesh:
                            DrawAttachment(pose, sk, i, att, lookup, tint, clipping);
                            break;
                    }
                }
                if (clipping && clipEnd == i) clipping = false;
            }
        }

        /// <summary>Atlas UVs of a mesh for one image: they never change, so they are worked out once.</summary>
        sealed class UvCache
        {
            public int Image;
            public float[] Uv;
        }

        readonly Dictionary<Attachment, UvCache> uvCache = new Dictionary<Attachment, UvCache>();
        double[] world = new double[64];
        readonly double[] quad = new double[8];
        readonly float[] quadUv = new float[8];

        float[] MeshUvs(Attachment source, int image, in RegionUv entry)
        {
            if (uvCache.TryGetValue(source, out var c) && c.Image == image) return c.Uv;
            var meshUvs = source.Uvs ?? new double[0];
            var uv = new float[meshUvs.Length & ~1];
            for (int k = 0; k + 1 < meshUvs.Length; k += 2)
            {
                entry.Map(meshUvs[k], meshUvs[k + 1], out double pu, out double pv);
                uv[k] = (float)pu;
                uv[k + 1] = (float)pv;
            }
            uvCache[source] = new UvCache { Image = image, Uv = uv };
            return uv;
        }

        void DrawAttachment(SkeletonPose pose, SkeletonData sk, int i, Attachment att, RegionLookup lookup, Color4 tint, bool clipping)
        {
            bool isRegion = att.Kind == AttachmentKind.Region;
            var source = isRegion ? att : sk.MeshSource(i, att, pose.Skin);
            if (source == null) return;
            int image = pose.ImageOf(i, att.Kind == AttachmentKind.Mesh ? source : att);
            if (!lookup.TryGet(image, out var entry)) return;
            var c = pose.Color[i];
            var ac = att.Color;
            float lr = (float)(c.R * ac.R * tint.R), lg = (float)(c.G * ac.G * tint.G), lb = (float)(c.B * ac.B * tint.B), la = (float)(c.A * ac.A * tint.A);
            if (la <= 0f) return; // invisible: skip the geometry
            float dr = 0, dg = 0, db = 0, da = 0;
            if (pose.HasDark[i])
            {
                var d = pose.Dark[i];
                dr = (float)d.R;
                dg = (float)d.G;
                db = (float)d.B;
                da = 1f;
            }
            var blend = sk.Slots[i].Blend;
            double[] pos;
            float[] uvs;
            int n;
            int[] triangles;
            int triCount;
            if (isRegion)
            {
                // The packed (trimmed) part of the image, as corners of the attachment quad.
                var m = pose.AttachmentWorld(i, att.Offset);
                double hw = att.Width / 2.0, hh = att.Height / 2.0;
                Corner(m, entry, entry.TrimU0, entry.TrimV0, hw, hh, att, 0);
                Corner(m, entry, entry.TrimU1, entry.TrimV0, hw, hh, att, 1);
                Corner(m, entry, entry.TrimU1, entry.TrimV1, hw, hh, att, 2);
                Corner(m, entry, entry.TrimU0, entry.TrimV1, hw, hh, att, 3);
                pos = quad;
                uvs = quadUv;
                n = 4;
                triangles = Quad;
                triCount = 6;
            }
            else
            {
                if (source.Kind != AttachmentKind.Mesh) return;
                int count = pose.WorldVertices(i, att, ref world);
                pos = world;
                n = count / 2;
                uvs = MeshUvs(source, image, entry);
                triangles = source.Triangles;
                triCount = triangles.Length;
            }
            if (clipping)
            {
                scratchP.Clear();
                scratchUv.Clear();
                for (int k = 0; k < n; k++)
                {
                    scratchP.Add(pos[2 * k]);
                    scratchP.Add(pos[2 * k + 1]);
                    scratchUv.Add(2 * k + 1 < uvs.Length ? uvs[2 * k] : 0.0);
                    scratchUv.Add(2 * k + 1 < uvs.Length ? uvs[2 * k + 1] : 0.0);
                }
                clipP.Clear();
                clipUv.Clear();
                clipT.Clear();
                clipper.Clip(scratchP, scratchUv, triangles, triCount, clipP, clipUv, clipT);
                if (clipT.Count == 0) return;
                int cn = clipP.Count / 2;
                if (clipPos.Length < clipP.Count) clipPos = new double[clipP.Count * 2];
                if (clipUvF.Length < clipUv.Count) clipUvF = new float[clipUv.Count * 2];
                if (clipTri.Length < clipT.Count) clipTri = new int[clipT.Count * 2];
                for (int k = 0; k < clipP.Count; k++) clipPos[k] = clipP[k];
                for (int k = 0; k < clipUv.Count; k++) clipUvF[k] = (float)clipUv[k];
                for (int k = 0; k < clipT.Count; k++) clipTri[k] = clipT[k];
                Emit(entry.Page, blend, clipPos, clipUvF, cn, clipTri, clipT.Count, lr, lg, lb, la, dr, dg, db, da);
            }
            else Emit(entry.Page, blend, pos, uvs, n, triangles, triCount, lr, lg, lb, la, dr, dg, db, da);
        }

        double[] clipPos = new double[0];
        float[] clipUvF = new float[0];
        int[] clipTri = new int[0];

        void Corner(in Affine m, in RegionUv entry, double u, double v, double hw, double hh, Attachment att, int k)
        {
            double lx = -hw + u * att.Width;
            double ly = hh - v * att.Height;
            m.Apply(lx, ly, out quad[2 * k], out quad[2 * k + 1]);
            entry.Map(u, v, out double tu, out double tv);
            quadUv[2 * k] = (float)tu;
            quadUv[2 * k + 1] = (float)tv;
        }

        void Emit(int page, Blend blend, double[] positions, float[] uvs, int n, int[] triangles, int triCount, float lr, float lg, float lb, float la, float dr, float dg, float db, float da)
        {
            bool continues = Batches.Count > 0 && Batches[Batches.Count - 1].Source == source && Batches[Batches.Count - 1].Page == page && Batches[Batches.Count - 1].Blend == blend;
            if (!continues) Batches.Add(new MeshBatch { Source = source, Page = page, Blend = blend, IndexStart = IndexCount, IndexCount = 0 });
            int baseVertex = VertexCount;
            if (Interleave)
            {
                EmitInterleaved(positions, uvs, n, baseVertex, lr, lg, lb, la, dr, dg, db, da);
                VertexCount += n;
                AddTriangles(triangles, triCount, n, baseVertex);
                return;
            }
            EnsureVertices(VertexCount + n);
            var P = Positions;
            var U = Uvs;
            var C = Colors;
            var Dk = Darks;
            float minX = MinX, minY = MinY, maxX = MaxX, maxY = MaxY;
            int uvLen = uvs.Length;
            for (int k = 0; k < n; k++)
            {
                int v = baseVertex + k;
                float x = (float)positions[2 * k], y = (float)positions[2 * k + 1];
                P[2 * v] = x;
                P[2 * v + 1] = y;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (2 * k + 1 < uvLen)
                {
                    U[2 * v] = uvs[2 * k];
                    U[2 * v + 1] = uvs[2 * k + 1];
                }
                else U[2 * v] = U[2 * v + 1] = 0f;
                int c4 = 4 * v;
                C[c4] = lr;
                C[c4 + 1] = lg;
                C[c4 + 2] = lb;
                C[c4 + 3] = la;
                Dk[c4] = dr;
                Dk[c4 + 1] = dg;
                Dk[c4 + 2] = db;
                Dk[c4 + 3] = da;
            }
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            VertexCount += n;
            AddTriangles(triangles, triCount, n, baseVertex);
        }

        void AddTriangles(int[] triangles, int triCount, int n, int baseVertex)
        {
            EnsureIndices(IndexCount + triCount);
            var I = Indices;
            int ic = IndexCount;
            for (int k = 0; k + 2 < triCount; k += 3)
            {
                int a = triangles[k], b = triangles[k + 1], c = triangles[k + 2];
                // Skip triangles that reference vertices the mesh does not have (a damaged file).
                if ((uint)a >= (uint)n || (uint)b >= (uint)n || (uint)c >= (uint)n) continue;
                I[ic++] = baseVertex + a;
                I[ic++] = baseVertex + b;
                I[ic++] = baseVertex + c;
            }
            int added = ic - IndexCount;
            IndexCount = ic;
            var batch = Batches[Batches.Count - 1];
            batch.IndexCount += added;
            Batches[Batches.Count - 1] = batch;
        }

        void EmitInterleaved(double[] positions, float[] uvs, int n, int baseVertex, float lr, float lg, float lb, float la, float dr, float dg, float db, float da)
        {
            int need = (baseVertex + n) * InterleavedStride;
            if (Interleaved.Length < need) Array.Resize(ref Interleaved, Math.Max(need, Interleaved.Length * 2));
            var o = Interleaved;
            float sx = ScaleX, sy = ScaleY;
            float minX = MinX, minY = MinY, maxX = MaxX, maxY = MaxY;
            int uvLen = uvs.Length;
            bool flipV = FlipV;
            int w = baseVertex * InterleavedStride;
            for (int k = 0; k < n; k++)
            {
                float x = (float)positions[2 * k], y = (float)positions[2 * k + 1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                o[w] = x * sx;
                o[w + 1] = y * sy;
                o[w + 2] = 0f;
                o[w + 3] = lr;
                o[w + 4] = lg;
                o[w + 5] = lb;
                o[w + 6] = la;
                float u = 0f, v = 0f;
                if (2 * k + 1 < uvLen)
                {
                    u = uvs[2 * k];
                    v = uvs[2 * k + 1];
                }
                o[w + 7] = u;
                o[w + 8] = flipV ? 1f - v : v;
                o[w + 9] = dr;
                o[w + 10] = dg;
                o[w + 11] = db;
                o[w + 12] = da;
                w += InterleavedStride;
            }
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
        }

        void EnsureVertices(int n)
        {
            if (Positions.Length >= n * 2) return;
            int cap = Math.Max(n, Positions.Length);
            Array.Resize(ref Positions, cap * 2);
            Array.Resize(ref Uvs, cap * 2);
            Array.Resize(ref Colors, cap * 4);
            Array.Resize(ref Darks, cap * 4);
        }

        void EnsureIndices(int n)
        {
            if (Indices.Length >= n) return;
            Array.Resize(ref Indices, Math.Max(n, Indices.Length * 2));
        }
    }
}
