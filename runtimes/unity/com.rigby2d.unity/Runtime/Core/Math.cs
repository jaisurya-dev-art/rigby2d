// SPDX-License-Identifier: MIT OR Apache-2.0
// 2D math: local transforms and affine matrices. Y up, degrees, counter-clockwise rotation.
// A port of the Rust runtime (runtimes/rust/rigby-runtime/src/math.rs).

using System;

namespace Rigby2D
{
    public static class MathUtil
    {
        public const double Deg = Math.PI / 180.0;

        public static double Lerp(double a, double b, double t) => a + (b - a) * t;

        /// <summary>Wraps an angle in degrees to (-180, 180].</summary>
        public static double WrapDegrees(double d)
        {
            double w = (((d + 180.0) % 360.0) + 360.0) % 360.0 - 180.0;
            return w == -180.0 ? 180.0 : w;
        }

        /// <summary>atan2(y, x) in degrees.</summary>
        public static double AngleOf(double x, double y) => Math.Atan2(y, x) / Deg;

        /// <summary>sqrt(x² + y²) without needless overflow.</summary>
        public static double Hypot(double x, double y)
        {
            x = Math.Abs(x);
            y = Math.Abs(y);
            if (double.IsInfinity(x) || double.IsInfinity(y)) return double.PositiveInfinity;
            if (double.IsNaN(x) || double.IsNaN(y)) return double.NaN;
            double m = Math.Max(x, y);
            if (m == 0.0) return 0.0;
            if (m < 1e150 && m > 1e-150) return Math.Sqrt(x * x + y * y);
            double a = x / m, b = y / m;
            return m * Math.Sqrt(a * a + b * b);
        }

        public static double Clamp(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;
    }

    /// <summary>A local transform. Shear is in degrees and tilts the X and Y axes independently.</summary>
    [Serializable]
    public struct Transform2
    {
        public double X, Y, Rotation, ScaleX, ScaleY, ShearX, ShearY;

        public static readonly Transform2 Identity = new Transform2 { ScaleX = 1, ScaleY = 1 };

        public Transform2(double x, double y, double rotation, double scaleX, double scaleY, double shearX, double shearY)
        {
            X = x;
            Y = y;
            Rotation = rotation;
            ScaleX = scaleX;
            ScaleY = scaleY;
            ShearX = shearX;
            ShearY = shearY;
        }

        /// <summary>The X axis points along rotation + shearX; the Y axis along rotation + 90 + shearY.</summary>
        public Affine ToAffine()
        {
            double rx = (Rotation + ShearX) * MathUtil.Deg;
            double ry = (Rotation + 90.0 + ShearY) * MathUtil.Deg;
            return new Affine(Math.Cos(rx) * ScaleX, Math.Sin(rx) * ScaleX, Math.Cos(ry) * ScaleY, Math.Sin(ry) * ScaleY, X, Y);
        }
    }

    /// <summary>2D affine matrix mapping (x, y) to (a*x + c*y + tx, b*x + d*y + ty).</summary>
    [Serializable]
    public struct Affine
    {
        public double A, B, C, D, Tx, Ty;

        public static readonly Affine Identity = new Affine(1, 0, 0, 1, 0, 0);

        public Affine(double a, double b, double c, double d, double tx, double ty)
        {
            A = a;
            B = b;
            C = c;
            D = d;
            Tx = tx;
            Ty = ty;
        }

        /// <summary>this * r: applies r first, then this.</summary>
        public Affine Mul(in Affine r) => new Affine(
            A * r.A + C * r.B,
            B * r.A + D * r.B,
            A * r.C + C * r.D,
            B * r.C + D * r.D,
            A * r.Tx + C * r.Ty + Tx,
            B * r.Tx + D * r.Ty + Ty);

        public double Determinant => A * D - B * C;

        public Affine Inverse()
        {
            double det = Determinant;
            if (Math.Abs(det) < 1e-12) return Identity;
            double inv = 1.0 / det;
            double a = D * inv, b = -B * inv, c = -C * inv, d = A * inv;
            return new Affine(a, b, c, d, -(a * Tx + c * Ty), -(b * Tx + d * Ty));
        }

        public void Apply(double x, double y, out double ox, out double oy)
        {
            ox = A * x + C * y + Tx;
            oy = B * x + D * y + Ty;
        }

        /// <summary>World rotation of the X axis, in degrees.</summary>
        public double Rotation => MathUtil.AngleOf(A, B);

        /// <summary>Decomposes into translation, rotation, scale and Y shear (shearX is 0). Reflection is a negative Y scale.</summary>
        public Transform2 Decompose()
        {
            double scaleX = MathUtil.Hypot(A, B);
            if (scaleX < 1e-12) return new Transform2(Tx, Ty, 0, 0, 0, 0, 0);
            double rotation = Rotation;
            double scaleY = MathUtil.Hypot(C, D) * (Determinant < 0.0 ? -1.0 : 1.0);
            double yAngle = scaleY == 0.0 ? rotation + 90.0 : MathUtil.AngleOf(C / scaleY, D / scaleY);
            double shearY = MathUtil.WrapDegrees(yAngle - rotation - 90.0);
            return new Transform2(Tx, Ty, rotation, scaleX, scaleY, 0, Math.Abs(shearY) < 1e-9 ? 0 : shearY);
        }

        public override string ToString() => $"[{A}, {B}, {C}, {D}, {Tx}, {Ty}]";
    }
}
