// SPDX-License-Identifier: MIT OR Apache-2.0
// Interpolation curves between keys. Bezier control points are normalized: endpoints (0,0) and
// (1,1), x the fraction of the time between the keys, y the fraction of the value change.
// A port of runtimes/rust/rigby-runtime/src/curve.rs.

using System;
using System.Collections.Generic;

namespace Rigby2D
{
    public enum CurveKind : byte
    {
        Linear,
        /// <summary>Holds the value until the next key.</summary>
        Stepped,
        /// <summary>One bezier shared by every value of the key.</summary>
        Bezier,
        /// <summary>One bezier per value component.</summary>
        Beziers,
    }

    /// <summary>The curve from a key to the next one.</summary>
    public sealed class Curve : IEquatable<Curve>
    {
        public static readonly Curve Linear = new Curve(CurveKind.Linear, null);
        public static readonly Curve Stepped = new Curve(CurveKind.Stepped, null);

        public readonly CurveKind Kind;
        /// <summary>4 numbers per bezier (cx1, cy1, cx2, cy2).</summary>
        public readonly double[] Points;

        public Curve(CurveKind kind, double[] points)
        {
            Kind = kind;
            Points = points;
        }

        public static Curve Bezier(double cx1, double cy1, double cx2, double cy2) => new Curve(CurveKind.Bezier, new[] { cx1, cy1, cx2, cy2 });

        public static Curve Beziers(List<double[]> list)
        {
            var p = new double[list.Count * 4];
            for (int i = 0; i < list.Count; i++) Array.Copy(list[i], 0, p, i * 4, 4);
            return new Curve(CurveKind.Beziers, p);
        }

        /// <summary>Maps linear progress t to eased progress for value component of a key.</summary>
        public double Ease(double t, int component)
        {
            t = Clamp01(t);
            switch (Kind)
            {
                case CurveKind.Stepped:
                    return 0.0;
                case CurveKind.Bezier:
                    return BezierYForX(Points[0], Points[1], Points[2], Points[3], t);
                case CurveKind.Beziers:
                {
                    int n = Points.Length / 4;
                    if (n == 0) return t;
                    int k = component < n ? component : 0;
                    return BezierYForX(Points[4 * k], Points[4 * k + 1], Points[4 * k + 2], Points[4 * k + 3], t);
                }
                default:
                    return t;
            }
        }

        static double Clamp01(double t) => t < 0 ? 0 : t > 1 ? 1 : t;

        static double Cubic(double p1, double p2, double t)
        {
            double u = 1.0 - t;
            return 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t;
        }

        static double CubicDerivative(double p1, double p2, double t)
        {
            double u = 1.0 - t;
            return 3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2);
        }

        static double BezierYForX(double x1, double y1, double x2, double y2, double x)
        {
            x1 = Clamp01(x1);
            x2 = Clamp01(x2);
            // Newton iterations, falling back to bisection when the slope is too flat.
            double t = x;
            for (int i = 0; i < 8; i++)
            {
                double err = Cubic(x1, x2, t) - x;
                if (Math.Abs(err) < 1e-5) return Cubic(y1, y2, t);
                double d = CubicDerivative(x1, x2, t);
                if (Math.Abs(d) < 1e-6) break;
                t = Clamp01(t - err / d);
            }
            double lo = 0.0, hi = 1.0;
            t = x;
            for (int i = 0; i < 30; i++)
            {
                double v = Cubic(x1, x2, t);
                if (Math.Abs(v - x) < 1e-5) break;
                if (v < x) lo = t;
                else hi = t;
                t = (lo + hi) * 0.5;
            }
            return Cubic(y1, y2, t);
        }

        public bool Equals(Curve other)
        {
            if (other is null || other.Kind != Kind) return false;
            if (Points == null || other.Points == null) return Points == other.Points;
            if (Points.Length != other.Points.Length) return false;
            for (int i = 0; i < Points.Length; i++)
                if (!Points[i].Equals(other.Points[i])) return false;
            return true;
        }

        public override bool Equals(object obj) => Equals(obj as Curve);
        public override int GetHashCode() => (int)Kind;
    }

    // ---- raw curves (constraint keys, as stored in the file) -------------------------------------

    public enum RawCurveKind : byte
    {
        Linear,
        Stepped,
        /// <summary>4.x: absolute control points, 4 per value.</summary>
        Absolute,
        /// <summary>3.8: one normalized bezier.</summary>
        Normalized,
    }

    /// <summary>A constraint key: time, values and the curve to the next key.</summary>
    public sealed class RawKey
    {
        public double Time;
        public double[] Values;
        public RawCurveKind Curve;
        public double[] CurvePoints;
    }

    public static class RawCurves
    {
        /// <summary>Samples raw keys at time (keys must not be empty).</summary>
        public static void Sample(List<RawKey> keys, double time, List<double> output)
        {
            output.Clear();
            if (time < keys[0].Time)
            {
                output.AddRange(keys[0].Values);
                return;
            }
            int i = 0;
            while (i + 1 < keys.Count && keys[i + 1].Time <= time) i++;
            var a = keys[i];
            if (i + 1 >= keys.Count || a.Curve == RawCurveKind.Stepped)
            {
                output.AddRange(a.Values);
                return;
            }
            var b = keys[i + 1];
            double t0 = a.Time, t1 = b.Time;
            if (t1 <= t0)
            {
                output.AddRange(b.Values);
                return;
            }
            var c = a.CurvePoints;
            for (int j = 0; j < a.Values.Length; j++)
            {
                double v0 = a.Values[j];
                double v1 = j < b.Values.Length ? b.Values[j] : double.NaN;
                double v;
                if (a.Curve == RawCurveKind.Absolute && c.Length >= 4 * (j + 1) && c.Length >= 4 * a.Values.Length)
                    v = BezierAt(t0, v0, c[4 * j], c[4 * j + 1], c[4 * j + 2], c[4 * j + 3], t1, v1, time);
                else if (a.Curve == RawCurveKind.Absolute && c.Length == 4)
                    v = v0 + (v1 - v0) * NormalizedBezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0));
                else if (a.Curve == RawCurveKind.Normalized)
                    v = v0 + (v1 - v0) * NormalizedBezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0));
                else
                    v = v0 + (v1 - v0) * ((time - t0) / (t1 - t0));
                output.Add(v);
            }
        }

        public static double Cubic4(double p0, double p1, double p2, double p3, double s)
        {
            double u = 1.0 - s;
            return u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3;
        }

        /// <summary>Value of an absolute bezier segment from (x0, y0) to (x3, y3) at x.</summary>
        static double BezierAt(double x0, double y0, double x1, double y1, double x2, double y2, double x3, double y3, double x)
        {
            double lo = 0.0, hi = 1.0;
            double s = (x - x0) / (x3 - x0);
            for (int i = 0; i < 40; i++)
            {
                double v = Cubic4(x0, x1, x2, x3, s);
                if (Math.Abs(v - x) < 1e-7) break;
                if (v < x) lo = s;
                else hi = s;
                s = (lo + hi) / 2.0;
            }
            return Cubic4(y0, y1, y2, y3, s);
        }

        static double NormalizedBezier(double x1, double y1, double x2, double y2, double x) => BezierAt(0.0, 0.0, x1, y1, x2, y2, 1.0, 1.0, x);
    }
}
