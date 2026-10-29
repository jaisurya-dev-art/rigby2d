// SPDX-License-Identifier: MIT OR Apache-2.0
// Clipping attachments: a polygon that masks the slots drawn after it (up to its end slot). The
// polygon is split into triangles (it may be concave) and each drawn triangle is clipped against
// each of them, interpolating UVs. A port of runtimes/rust/rigby-runtime/src/clipping.rs.

using System;
using System.Collections.Generic;

namespace Rigby2D
{
    public sealed class Clipper
    {
        struct V
        {
            public double X, Y, U, Vv;
        }

        /// <summary>Triangles of the clip polygon in world space, 6 numbers each.</summary>
        readonly List<double[]> triangles = new List<double[]>();
        List<V> poly = new List<V>(9), tmp = new List<V>(9);

        public int TriangleCount => triangles.Count;

        /// <summary>Sets the clip polygon (flat world positions).</summary>
        public void SetPolygon(IList<double> polygon)
        {
            // Reuse the triangle arrays of the last polygon.
            foreach (var t in triangles) spare.Push(t);
            triangles.Clear();
            Triangulate(polygon, triangles, work, spare);
        }

        readonly List<double> work = new List<double>();
        readonly Stack<double[]> spare = new Stack<double[]>();

        /// <summary>Signed area of a flat [x, y, ...] polygon (positive when counter-clockwise, Y up).</summary>
        static double SignedArea(IList<double> p)
        {
            int n = p.Count;
            double a = 0.0;
            for (int i = 0; i + 1 < n; i += 2)
            {
                int j = (i + 2) % n;
                a += p[i] * p[j + 1] - p[j] * p[i + 1];
            }
            return a / 2.0;
        }

        /// <summary>Ear-clipping triangulation of a simple polygon; counter-clockwise triangles (6 numbers each).</summary>
        public static void Triangulate(IList<double> polygon, List<double[]> output) => Triangulate(polygon, output, new List<double>(), null);

        [ThreadStatic] static List<int> idxBuffer;

        static void Triangulate(IList<double> polygon, List<double[]> output, List<double> p, Stack<double[]> spare)
        {
            p.Clear();
            if (SignedArea(polygon) < 0.0)
                for (int i = polygon.Count - 2; i >= 0; i -= 2)
                {
                    p.Add(polygon[i]);
                    p.Add(polygon[i + 1]);
                }
            else
                for (int i = 0; i < polygon.Count; i++) p.Add(polygon[i]);
            var idx = idxBuffer ?? (idxBuffer = new List<int>());
            idx.Clear();
            for (int i = 0; i < p.Count / 2; i++) idx.Add(i);
            double X(int i) => p[2 * i];
            double Y(int i) => p[2 * i + 1];
            double Cross(int a, int b, int c) => (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));
            bool Inside(int a, int b, int c, int q) => Cross(a, b, q) >= 0.0 && Cross(b, c, q) >= 0.0 && Cross(c, a, q) >= 0.0;
            int guard = 0;
            while (idx.Count > 3 && guard < 10000)
            {
                guard++;
                bool clipped = false;
                for (int k = 0; k < idx.Count; k++)
                {
                    int a = idx[(k + idx.Count - 1) % idx.Count], b = idx[k], c = idx[(k + 1) % idx.Count];
                    if (Cross(a, b, c) <= 0.0) continue; // reflex or degenerate corner
                    bool blocked = false;
                    foreach (int q in idx)
                        if (q != a && q != b && q != c && Inside(a, b, c, q))
                        {
                            blocked = true;
                            break;
                        }
                    if (blocked) continue;
                    output.Add(Tri(spare, X(a), Y(a), X(b), Y(b), X(c), Y(c)));
                    idx.RemoveAt(k);
                    clipped = true;
                    break;
                }
                if (!clipped) break; // self-intersecting input: keep what we have
            }
            if (idx.Count == 3) output.Add(Tri(spare, X(idx[0]), Y(idx[0]), X(idx[1]), Y(idx[1]), X(idx[2]), Y(idx[2])));
        }

        static double[] Tri(Stack<double[]> spare, double ax, double ay, double bx, double by, double cx, double cy)
        {
            var t = spare != null && spare.Count > 0 ? spare.Pop() : new double[6];
            t[0] = ax;
            t[1] = ay;
            t[2] = bx;
            t[3] = by;
            t[4] = cx;
            t[5] = cy;
            return t;
        }

        /// <summary>Clips a convex polygon against a counter-clockwise triangle (Sutherland-Hodgman).</summary>
        void ClipConvex(V a0, V a1, V a2, double[] tri)
        {
            poly.Clear();
            poly.Add(a0);
            poly.Add(a1);
            poly.Add(a2);
            for (int e = 0; e < 3; e++)
            {
                if (poly.Count == 0) break;
                double ax = tri[2 * e], ay = tri[2 * e + 1];
                double bx = tri[(2 * e + 2) % 6], by = tri[(2 * e + 3) % 6];
                var t = poly;
                poly = tmp;
                tmp = t;
                poly.Clear();
                for (int i = 0; i < tmp.Count; i++)
                {
                    var p = tmp[i];
                    var q = tmp[(i + 1) % tmp.Count];
                    double sp = (bx - ax) * (p.Y - ay) - (by - ay) * (p.X - ax);
                    double sq = (bx - ax) * (q.Y - ay) - (by - ay) * (q.X - ax);
                    if (sp >= 0.0) poly.Add(p);
                    if ((sp >= 0.0) != (sq >= 0.0))
                    {
                        double f = sp / (sp - sq);
                        poly.Add(new V { X = p.X + (q.X - p.X) * f, Y = p.Y + (q.Y - p.Y) * f, U = p.U + (q.U - p.U) * f, Vv = p.Vv + (q.Vv - p.Vv) * f });
                    }
                }
            }
        }

        /// <summary>Clips a triangle mesh (flat positions and UVs, vertex indices), appending the result.</summary>
        public void Clip(List<double> positions, List<double> uvs, int[] tris, int triCount, List<double> outP, List<double> outUv, List<int> outT)
        {
            for (int t = 0; t + 2 < triCount; t += 3)
            {
                var v0 = Vertex(positions, uvs, tris[t]);
                var v1 = Vertex(positions, uvs, tris[t + 1]);
                var v2 = Vertex(positions, uvs, tris[t + 2]);
                // Counter-clockwise, so "inside" is on the left of every edge.
                double area = (v1.X - v0.X) * (v2.Y - v0.Y) - (v1.Y - v0.Y) * (v2.X - v0.X);
                if (area < 0.0)
                {
                    var s = v1;
                    v1 = v2;
                    v2 = s;
                }
                foreach (var clip in triangles)
                {
                    ClipConvex(v0, v1, v2, clip);
                    if (poly.Count < 3) continue;
                    int b = outP.Count / 2;
                    foreach (var p in poly)
                    {
                        outP.Add(p.X);
                        outP.Add(p.Y);
                        outUv.Add(p.U);
                        outUv.Add(p.Vv);
                    }
                    for (int k = 1; k < poly.Count - 1; k++)
                    {
                        outT.Add(b);
                        outT.Add(b + k);
                        outT.Add(b + k + 1);
                    }
                }
            }
        }

        static V Vertex(List<double> positions, List<double> uvs, int i)
        {
            if (2 * i + 1 >= positions.Count || 2 * i + 1 >= uvs.Count) return default;
            return new V { X = positions[2 * i], Y = positions[2 * i + 1], U = uvs[2 * i], Vv = uvs[2 * i + 1] };
        }
    }
}
