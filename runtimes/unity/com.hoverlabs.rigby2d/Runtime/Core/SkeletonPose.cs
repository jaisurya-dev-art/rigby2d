// SPDX-License-Identifier: MIT OR Apache-2.0
// Evaluated skeleton state: local and world transforms of every bone, slot state, mesh deformation,
// draw order and constraints. Behaves exactly like the JavaScript runtime's Pose and the Rust port
// (runtimes/rust/rigby-runtime/src/pose.rs); the golden tests check it frame by frame.

using System;
using System.Collections.Generic;
using System.Linq;

namespace Rigby2D
{
    public struct IkState
    {
        public double Mix, Softness;
        public bool BendPositive, Compress, Stretch;
    }

    /// <summary>Persistent physics simulation of one constraint.</summary>
    internal sealed class PhysicsSim
    {
        public double Rest;
        public double Ox, Oy, Ovx, Ovy, Tx, Ty, Tvx, Tvy;
        public double LastOx, LastOy, LastTx, LastTy;
    }

    /// <summary>A visible region or mesh in draw order (see Pose.Quads).</summary>
    public sealed class Quad
    {
        public int Slot;
        public int Image;
        /// <summary>World positions, flat: regions TL, TR, BR, BL; meshes one pair per vertex.</summary>
        public double[] Positions;
        public Color4 Color;
    }

    /// <summary>A mutable pose for one skeleton instance.</summary>
    public sealed class SkeletonPose
    {
        const double Epsilon = 1e-5;

        // Path state layout in ConstraintState.
        const int PPosition = 0, PSpacing = 1, PMixRotate = 2, PMixX = 3, PMixY = 4;

        /// <summary>Animated local transforms.</summary>
        public Transform2[] Local;
        /// <summary>Local transforms after constraints; world transforms are computed from these.</summary>
        public Transform2[] Applied;
        public Affine[] World;
        public Inherit[] Inherit;
        /// <summary>Attachment name id shown by each slot, or -1.</summary>
        public int[] Attachment;
        public Color4[] Color;
        public Color4[] Dark;
        public bool[] HasDark;
        public int[] DrawOrder;
        public long[] Sequence;
        /// <summary>Deform deltas by (slot, attachment name): see DeformKey.</summary>
        public readonly Dictionary<long, double[]> Deform = new Dictionary<long, double[]>();
        public IkState[] Ik;
        /// <summary>Animatable constraint state: transform 6 mixes; path position, spacing, mixRotate, mixX, mixY; physics 7 values; slider time, mix.</summary>
        public double[][] ConstraintState;
        PhysicsSim[] physics;
        /// <summary>Seconds of physics to simulate in the next UpdateWorld (0 = only apply offsets).</summary>
        public double PhysicsDelta;
        /// <summary>Active skin, or -1 for the default skin only.</summary>
        public int Skin = -1;
        /// <summary>Transform above the root bones (where a scene places this skeleton), null = identity. Physics simulates in the skeleton's own units, so a placed character swings like it does at full size.</summary>
        public Affine? Placement;

        readonly SkeletonData sk;
        readonly int[] steps; // >= 0: IK constraint; < 0: ~index of another constraint
        readonly byte[] dirty;
        /// <summary>While a slider applies its animation, keys go to Applied instead of Local.</summary>
        bool intoApplied;
        readonly List<double> scratch = new List<double>();
        readonly List<double> verts = new List<double>();
        readonly List<KeyValuePair<int, Affine>> desired = new List<KeyValuePair<int, Affine>>();
        readonly double[] targetValues = new double[Props.Count];
        readonly bool[] targeted = new bool[Props.Count];

        public SkeletonData Data => sk;

        public static long DeformKey(int slot, int attachment) => ((long)slot << 32) | (uint)attachment;

        public SkeletonPose(SkeletonData data)
        {
            sk = data ?? throw new ArgumentNullException(nameof(data));
            var order = new List<(double order, int step)>();
            for (int i = 0; i < sk.Ik.Count; i++) order.Add((sk.Ik[i].Order, i));
            for (int i = 0; i < sk.Constraints.Count; i++) order.Add((sk.Constraints[i].Order, ~i));
            // Stable, like Rust's sort_by; NaN orders compare equal.
            steps = order.Select((o, k) => (o, k)).OrderBy(x => x.o.order, OrderComparer.Instance).ThenBy(x => x.k).Select(x => x.o.step).ToArray();
            int nb = sk.Bones.Count, ns = sk.Slots.Count;
            Local = new Transform2[nb];
            Applied = new Transform2[nb];
            World = new Affine[nb];
            for (int i = 0; i < nb; i++) World[i] = Affine.Identity;
            Inherit = new Inherit[nb];
            Attachment = new int[ns];
            Color = new Color4[ns];
            Dark = new Color4[ns];
            HasDark = new bool[ns];
            DrawOrder = new int[ns];
            Sequence = new long[ns];
            Ik = new IkState[sk.Ik.Count];
            ConstraintState = new double[sk.Constraints.Count][];
            for (int i = 0; i < ConstraintState.Length; i++) ConstraintState[i] = SetupState(sk.Constraints[i]);
            physics = new PhysicsSim[sk.Constraints.Count];
            dirty = new byte[nb];
            SetToSetup();
        }

        sealed class OrderComparer : IComparer<double>
        {
            public static readonly OrderComparer Instance = new OrderComparer();
            public int Compare(double a, double b) => a < b ? -1 : a > b ? 1 : 0;
        }

        static double[] SetupState(ConstraintData c)
        {
            switch (c.Kind)
            {
                case ConstraintKind.Transform: return (double[])c.Transform.Mix.Clone();
                case ConstraintKind.Path:
                    var s = c.Path.Setup;
                    return new[] { s.Position, s.Spacing, s.MixRotate, s.MixX, s.MixY };
                case ConstraintKind.Physics: return (double[])c.Physics.Setup.Clone();
                default: return (double[])c.Slider.Setup.Clone();
            }
        }

        static void CopyInto(double[] from, double[] to) => Array.Copy(from, to, Math.Min(from.Length, to.Length));

        /// <summary>Resets everything to the setup pose and recomputes world transforms.</summary>
        public void SetToSetup()
        {
            Reset();
            UpdateWorld();
        }

        /// <summary>Resets local state to the setup pose without computing world transforms.</summary>
        public void Reset()
        {
            for (int i = 0; i < sk.Bones.Count; i++)
            {
                Local[i] = sk.Bones[i].Setup;
                Inherit[i] = sk.Bones[i].Inherit;
            }
            for (int i = 0; i < sk.Slots.Count; i++)
            {
                var s = sk.Slots[i];
                Attachment[i] = s.Attachment;
                Color[i] = s.Color;
                Dark[i] = s.Dark;
                HasDark[i] = s.HasDark;
                DrawOrder[i] = i;
                Sequence[i] = -1;
            }
            // Deform arrays go back to a pool by length, so steady playback allocates none.
            foreach (var d in Deform.Values) Release(d);
            Deform.Clear();
            for (int i = 0; i < sk.Ik.Count; i++)
            {
                var c = sk.Ik[i];
                Ik[i] = new IkState { Mix = c.Mix, Softness = c.Softness, BendPositive = c.BendPositive, Compress = c.Compress, Stretch = c.Stretch };
            }
            for (int i = 0; i < sk.Constraints.Count; i++)
            {
                var c = sk.Constraints[i];
                switch (c.Kind)
                {
                    case ConstraintKind.Transform: CopyInto(c.Transform.Mix, ConstraintState[i]); break;
                    case ConstraintKind.Path:
                        var s = c.Path.Setup;
                        var st = ConstraintState[i];
                        st[PPosition] = s.Position;
                        st[PSpacing] = s.Spacing;
                        st[PMixRotate] = s.MixRotate;
                        st[PMixX] = s.MixX;
                        st[PMixY] = s.MixY;
                        break;
                    case ConstraintKind.Physics: CopyInto(c.Physics.Setup, ConstraintState[i]); break;
                    default: CopyInto(c.Slider.Setup, ConstraintState[i]); break;
                }
            }
        }

        /// <summary>Clears physics so every simulated bone starts again from its animated pose.</summary>
        public void ResetPhysics() => Array.Clear(physics, 0, physics.Length);

        /// <summary>Applies animation anim at time on top of the current pose, blended by alpha.</summary>
        public void Apply(int anim, double time, double alpha)
        {
            if (anim < 0 || anim >= sk.Animations.Count) return;
            ApplyAnimation(sk.Animations[anim], time, alpha);
        }

        public void Apply(SkeletonAnimation anim, double time, double alpha)
        {
            if (anim != null) ApplyAnimation(anim, time, alpha);
        }

        void ApplyAnimation(SkeletonAnimation anim, double time, double alpha)
        {
            bool hold = alpha >= 0.5;
            foreach (var t in anim.Bones)
            {
                if (t.Bone < 0 || t.Bone >= sk.Bones.Count) continue;
                var setup = sk.Bones[t.Bone].Setup;
                var target = intoApplied ? Applied : Local;
                var l = target[t.Bone];
                double x = l.X, y = l.Y, rotation = l.Rotation, sx = l.ScaleX, sy = l.ScaleY, hx = l.ShearX, hy = l.ShearY;
                var c = t.Channels;
                if (c[Channel.Rotate].Count > 0) rotation = setup.Rotation + SampleComponent(c[Channel.Rotate], time, 0);
                if (c[Channel.Translate].Count > 0)
                {
                    x = setup.X + SampleComponent(c[Channel.Translate], time, 0);
                    y = setup.Y + SampleComponent(c[Channel.Translate], time, 1);
                }
                if (c[Channel.TranslateX].Count > 0) x = setup.X + SampleComponent(c[Channel.TranslateX], time, 0);
                if (c[Channel.TranslateY].Count > 0) y = setup.Y + SampleComponent(c[Channel.TranslateY], time, 0);
                if (c[Channel.Scale].Count > 0)
                {
                    sx = setup.ScaleX * SampleComponent(c[Channel.Scale], time, 0);
                    sy = setup.ScaleY * SampleComponent(c[Channel.Scale], time, 1);
                }
                if (c[Channel.ScaleX].Count > 0) sx = setup.ScaleX * SampleComponent(c[Channel.ScaleX], time, 0);
                if (c[Channel.ScaleY].Count > 0) sy = setup.ScaleY * SampleComponent(c[Channel.ScaleY], time, 0);
                if (c[Channel.Shear].Count > 0)
                {
                    hx = setup.ShearX + SampleComponent(c[Channel.Shear], time, 0);
                    hy = setup.ShearY + SampleComponent(c[Channel.Shear], time, 1);
                }
                if (c[Channel.ShearX].Count > 0) hx = setup.ShearX + SampleComponent(c[Channel.ShearX], time, 0);
                if (c[Channel.ShearY].Count > 0) hy = setup.ShearY + SampleComponent(c[Channel.ShearY], time, 0);
                if (hold && t.Inherit.Count > 0) Inherit[t.Bone] = SampleDiscrete(t.Inherit, time);
                if (alpha >= 1.0)
                {
                    target[t.Bone] = new Transform2(x, y, rotation, sx, sy, hx, hy);
                }
                else
                {
                    l.X = MathUtil.Lerp(l.X, x, alpha);
                    l.Y = MathUtil.Lerp(l.Y, y, alpha);
                    l.Rotation = MathUtil.Lerp(l.Rotation, rotation, alpha);
                    l.ScaleX = MathUtil.Lerp(l.ScaleX, sx, alpha);
                    l.ScaleY = MathUtil.Lerp(l.ScaleY, sy, alpha);
                    l.ShearX = MathUtil.Lerp(l.ShearX, hx, alpha);
                    l.ShearY = MathUtil.Lerp(l.ShearY, hy, alpha);
                    target[t.Bone] = l;
                }
            }
            foreach (var t in anim.Slots)
            {
                int i = t.Slot;
                if (i < 0 || i >= Attachment.Length) continue;
                if (hold && t.Attachment.Count > 0) Attachment[i] = SampleDiscrete(t.Attachment, time);
                var color = Color[i];
                var dark = Dark[i];
                bool hasDark = HasDark[i];
                var v = scratch;
                if (SampleInto(t.Color, time, v))
                    for (int k = 0; k < Math.Min(4, v.Count); k++) color[k] = v[k];
                // An 8-digit color in an rgb key also sets alpha (as the JavaScript runtime does).
                if (SampleInto(t.Rgb, time, v))
                    for (int k = 0; k < Math.Min(4, v.Count); k++) color[k] = v[k];
                if (SampleInto(t.Alpha, time, v) && v.Count > 0) color.A = v[0];
                bool newDark = false;
                if (SampleInto(t.Rgba2, time, v) && v.Count >= 7)
                {
                    for (int k = 0; k < 4; k++) color[k] = v[k];
                    dark = new Color4(v[4], v[5], v[6], 1);
                    hasDark = newDark = true;
                }
                if (SampleInto(t.Rgb2, time, v) && v.Count >= 6)
                {
                    for (int k = 0; k < 3; k++) color[k] = v[k];
                    dark = new Color4(v[3], v[4], v[5], 1);
                    hasDark = newDark = true;
                }
                var current = Color[i];
                for (int k = 0; k < 4; k++) current[k] = MathUtil.Lerp(current[k], color[k], alpha);
                Color[i] = current;
                if (hasDark)
                {
                    var from = HasDark[i] ? Dark[i] : dark;
                    Dark[i] = new Color4(MathUtil.Lerp(from.R, dark.R, alpha), MathUtil.Lerp(from.G, dark.G, alpha), MathUtil.Lerp(from.B, dark.B, alpha), 1);
                    HasDark[i] = true;
                }
                _ = newDark;
            }
            foreach (var t in anim.Deform)
            {
                if (t.Keys.Count == 0 || t.Slot < 0 || t.Slot >= sk.Slots.Count) continue;
                int skin = t.Skin != null ? sk.FindSkin(t.Skin) : Skin;
                // A named skin that does not exist resolves through the default skin only.
                var att = sk.Attachment(t.Slot, t.Attachment, skin);
                if (att == null) continue;
                var source = sk.MeshSource(t.Slot, att, Skin) ?? att;
                int n = source.Vertices?.DeformLength ?? 0;
                long key = DeformKey(t.Slot, t.Attachment);
                if (alpha < 1.0 && Deform.TryGetValue(key, out var prev))
                {
                    var deltas = Rent(n);
                    SampleDeform(t.Keys, time, n, deltas);
                    for (int j = 0; j < prev.Length; j++) prev[j] = MathUtil.Lerp(prev[j], j < deltas.Length ? deltas[j] : 0.0, alpha);
                    Release(deltas);
                }
                else
                {
                    var deltas = Rent(n);
                    SampleDeform(t.Keys, time, n, deltas);
                    if (Deform.TryGetValue(key, out var old)) Release(old);
                    Deform[key] = deltas;
                }
            }
            // Sequence keys: the frame of the image sequence a slot's attachment shows.
            if (hold)
            {
                foreach (var t in anim.Sequences)
                {
                    if (t.Slot < 0 || t.Slot >= Attachment.Length || Attachment[t.Slot] != t.Attachment) continue;
                    int skin = t.Skin != null ? sk.FindSkin(t.Skin) : -1;
                    var att = sk.Attachment(t.Slot, t.Attachment, skin) ?? sk.Attachment(t.Slot, t.Attachment, Skin);
                    var seq = att?.Sequence;
                    if (seq == null) continue;
                    if (SequenceIndexAt(t.Keys, time, seq.Count, out long index)) Sequence[t.Slot] = index;
                }
            }
            if (hold && anim.DrawOrder.Count > 0)
            {
                int i = PartitionDrawOrder(anim.DrawOrder, time) - 1;
                if (i >= 0) drawOrderWork.Apply(sk.Slots.Count, anim.DrawOrder[i].Offsets, DrawOrder);
            }
            ApplyConstraintTimelines(anim, time, alpha);
            foreach (var t in anim.Ik)
            {
                if (t.Constraint < 0 || t.Constraint >= Ik.Length) continue;
                int i = PartitionIk(t.Keys, time) - 1;
                if (i < 0) continue;
                var a = t.Keys[i];
                var b = i + 1 < t.Keys.Count ? t.Keys[i + 1] : null;
                double frac = b != null && b.Time > a.Time ? (time - a.Time) / (b.Time - a.Time) : 0.0;
                double mix = MathUtil.Lerp(a.Mix, b?.Mix ?? a.Mix, frac);
                double softness = MathUtil.Lerp(a.Softness, b?.Softness ?? a.Softness, frac);
                ref var state = ref Ik[t.Constraint];
                state.Mix = MathUtil.Lerp(state.Mix, mix, alpha);
                state.Softness = MathUtil.Lerp(state.Softness, softness, alpha);
                if (hold)
                {
                    state.BendPositive = a.BendPositive;
                    state.Compress = a.Compress;
                    state.Stretch = a.Stretch;
                }
            }
        }

        void ApplyConstraintTimelines(SkeletonAnimation anim, double time, double alpha)
        {
            if (!anim.HasConstraintKeys) return;
            var v = scratch;
            foreach (var t in anim.Constraints)
            {
                if (t.Constraint < 0 || t.Constraint >= sk.Constraints.Count) continue;
                var c = sk.Constraints[t.Constraint];
                var s = ConstraintState[t.Constraint];
                switch (c.Kind)
                {
                    case ConstraintKind.Transform:
                        if (t.Transform.Count == 0) continue;
                        RawCurves.Sample(t.Transform, time, v);
                        for (int j = 0; j < Props.Count && j < v.Count; j++) s[j] += (v[j] - s[j]) * alpha;
                        break;
                    case ConstraintKind.Slider:
                        for (int k = 0; k < 2; k++)
                        {
                            var keys = k == 0 ? t.SliderTime : t.SliderMix;
                            if (keys.Count == 0) continue;
                            RawCurves.Sample(keys, time, v);
                            if (v.Count > 0) s[k] += (v[0] - s[k]) * alpha;
                        }
                        break;
                    case ConstraintKind.Physics:
                        for (int g = 0; g < 2; g++)
                        {
                            var lists = g == 0 ? t.Physics : t.PhysicsGlobal;
                            for (int k = 0; k < lists.Length; k++)
                            {
                                if (lists[k].Count == 0 || (g == 1 && !c.Physics.Globals[k])) continue;
                                RawCurves.Sample(lists[k], time, v);
                                if (v.Count > 0) s[k] += (v[0] - s[k]) * alpha;
                            }
                        }
                        break;
                    case ConstraintKind.Path:
                        if (t.Position.Count > 0)
                        {
                            RawCurves.Sample(t.Position, time, v);
                            if (v.Count > 0) s[PPosition] += (v[0] - s[PPosition]) * alpha;
                        }
                        if (t.Spacing.Count > 0)
                        {
                            RawCurves.Sample(t.Spacing, time, v);
                            if (v.Count > 0) s[PSpacing] += (v[0] - s[PSpacing]) * alpha;
                        }
                        if (t.PathMix.Count > 0)
                        {
                            RawCurves.Sample(t.PathMix, time, v);
                            if (v.Count >= 3)
                            {
                                s[PMixRotate] += (v[0] - s[PMixRotate]) * alpha;
                                s[PMixX] += (v[1] - s[PMixX]) * alpha;
                                s[PMixY] += (v[2] - s[PMixY]) * alpha;
                            }
                        }
                        break;
                }
            }
        }

        /// <summary>Recomputes world transforms from local transforms, then applies constraints in order.</summary>
        public void UpdateWorld()
        {
            Array.Copy(Local, Applied, Local.Length);
            ComputeWorld();
            double delta = PhysicsDelta;
            PhysicsDelta = 0.0;
            foreach (int step in steps)
            {
                if (step >= 0)
                {
                    var c = sk.Ik[step];
                    if (c.SkinRequired && !(Skin >= 0 && sk.Skins[Skin].Ik.Contains(step))) continue;
                    SolveIk(c, Ik[step]);
                    continue;
                }
                int i = ~step;
                var cd = sk.Constraints[i];
                if (!ConstraintActive(cd)) continue;
                switch (cd.Kind)
                {
                    case ConstraintKind.Transform:
                        SolveTransform(cd, cd.Transform, i);
                        break;
                    case ConstraintKind.Path:
                        if (SolvePath(cd, cd.Path, i)) SetWorlds(desired);
                        break;
                    case ConstraintKind.Slider:
                        if (SolveSlider(cd.Slider, i)) ComputeWorld();
                        break;
                    case ConstraintKind.Physics:
                        if (SolvePhysics(cd.Physics, i, delta)) SetWorlds(desired);
                        break;
                }
            }
        }

        bool ConstraintActive(ConstraintData c)
        {
            if (!c.SkinRequired) return true;
            return Skin >= 0 && sk.Skins[Skin].Constraints.Contains(c.Name);
        }

        void ComputeWorld()
        {
            for (int i = 0; i < sk.Bones.Count; i++) UpdateBone(i);
        }

        void UpdateBone(int i)
        {
            var local = Applied[i].ToAffine();
            int p = sk.Bones[i].Parent;
            if (p < 0) World[i] = Placement.HasValue ? Placement.Value.Mul(local) : local;
            else World[i] = InheritWorld(World[p], local, Inherit[i]);
        }

        /// <summary>Recomputes the world transform of root and its descendants.</summary>
        void UpdateBranch(int root)
        {
            Array.Clear(dirty, 0, dirty.Length);
            dirty[root] = 1;
            UpdateBone(root);
            for (int i = root + 1; i < sk.Bones.Count; i++)
            {
                int p = sk.Bones[i].Parent;
                if (p >= 0 && dirty[p] != 0)
                {
                    dirty[i] = 1;
                    UpdateBone(i);
                }
            }
        }

        /// <summary>Sets the world transforms of some bones, updating their applied local transforms to match and moving their descendants along.</summary>
        public void SetWorlds(List<KeyValuePair<int, Affine>> want)
        {
            Array.Clear(dirty, 0, dirty.Length);
            int first = sk.Bones.Count;
            foreach (var d in want) first = Math.Min(first, d.Key);
            for (int i = first; i < sk.Bones.Count; i++)
            {
                int p = sk.Bones[i].Parent;
                int found = -1;
                for (int k = want.Count - 1; k >= 0; k--)
                    if (want[k].Key == i)
                    {
                        found = k;
                        break;
                    }
                if (found >= 0)
                {
                    var w = want[found].Value;
                    if (p < 0 && Placement.HasValue) Applied[i] = LocalFromWorld(Placement.Value, true, w, Rigby2D.Inherit.Normal);
                    else Applied[i] = p < 0 ? LocalFromWorld(Affine.Identity, false, w, Inherit[i]) : LocalFromWorld(World[p], true, w, Inherit[i]);
                    World[i] = w;
                    dirty[i] = 1;
                }
                else if (p >= 0 && dirty[p] != 0)
                {
                    UpdateBone(i);
                    dirty[i] = 1;
                }
            }
        }

        // ---- IK ----------------------------------------------------------------------------------

        double ParentSign(int b)
        {
            int p = sk.Bones[b].Parent;
            return p >= 0 && World[p].Determinant < 0.0 ? -1.0 : 1.0;
        }

        void Aim(int b, double fx, double fy, double tx, double ty, double gx, double gy, double mix)
        {
            double delta = MathUtil.WrapDegrees(MathUtil.AngleOf(gx - fx, gy - fy) - MathUtil.AngleOf(tx - fx, ty - fy));
            Applied[b].Rotation += delta * mix * ParentSign(b);
        }

        /// <summary>Rotates (and optionally stretches) the constrained bones so the chain reaches the target.</summary>
        void SolveIk(IkData c, IkState state)
        {
            double mix = state.Mix;
            if (mix <= 0.0 || c.Bones.Length == 0) return;
            double gx = World[c.Target].Tx, gy = World[c.Target].Ty;
            if (c.Bones.Length == 1)
            {
                int b = c.Bones[0];
                var w = World[b];
                double ox = w.Tx, oy = w.Ty;
                w.Apply(1.0, 0.0, out double ax, out double ay);
                Aim(b, ox, oy, ax, ay, gx, gy, mix);
                double boneLen = sk.Bones[b].Length * MathUtil.Hypot(w.A, w.B);
                double dist = MathUtil.Hypot(gx - ox, gy - oy);
                if (boneLen > 1e-4 && ((state.Compress && dist < boneLen) || (state.Stretch && dist > boneLen)))
                {
                    double s = (dist / boneLen - 1.0) * mix + 1.0;
                    Applied[b].ScaleX *= s;
                    if (c.Uniform) Applied[b].ScaleY *= s;
                }
                UpdateBranch(b);
                return;
            }
            int p = c.Bones[0], ch = c.Bones[1];
            double ppx = World[p].Tx, ppy = World[p].Ty;
            double ccx = World[ch].Tx, ccy = World[ch].Ty;
            World[ch].Apply(sk.Bones[ch].Length, 0.0, out double tipx, out double tipy);
            double a = MathUtil.Hypot(ccx - ppx, ccy - ppy);
            double bLen = MathUtil.Hypot(tipx - ccx, tipy - ccy);
            if (a < 1e-4 || bLen < 1e-4)
            {
                double tox = ccx, toy = ccy;
                if (!(ccx != ppx || ccy != ppy)) World[p].Apply(1.0, 0.0, out tox, out toy);
                Aim(p, ppx, ppy, tox, toy, gx, gy, mix);
                UpdateBranch(p);
                return;
            }
            double d = MathUtil.Hypot(gx - ppx, gy - ppy);
            if (state.Stretch && d > a + bLen)
            {
                double s = (d / (a + bLen) - 1.0) * mix + 1.0;
                Applied[p].ScaleX *= s;
                if (c.Uniform) Applied[p].ScaleY *= s;
                UpdateBranch(p);
                FinishTwoBone(ch, gx, gy, mix);
                return;
            }
            double soft = state.Softness;
            if (soft > 0.0 && d > a + bLen - soft) d = a + bLen - soft * Math.Exp(-(d - (a + bLen - soft)) / soft);
            d = Num.Min(Num.Max(d, Math.Abs(a - bLen) + 1e-6), a + bLen - 1e-6);
            double cosA = MathUtil.Clamp((a * a + d * d - bLen * bLen) / (2.0 * a * d), -1.0, 1.0);
            double angle = Math.Acos(cosA) / MathUtil.Deg;
            // A mirrored chain bends the other way on screen.
            double bend = (state.BendPositive ? 1.0 : -1.0) * (World[p].Determinant < 0.0 ? -1.0 : 1.0);
            double want = MathUtil.AngleOf(gx - ppx, gy - ppy) - bend * angle;
            double delta = MathUtil.WrapDegrees(want - MathUtil.AngleOf(ccx - ppx, ccy - ppy));
            Applied[p].Rotation += delta * mix * ParentSign(p);
            UpdateBranch(p);
            FinishTwoBone(ch, gx, gy, mix);
        }

        void FinishTwoBone(int ch, double gx, double gy, double mix)
        {
            double ccx = World[ch].Tx, ccy = World[ch].Ty;
            World[ch].Apply(Num.Max(sk.Bones[ch].Length, 1e-3), 0.0, out double tipx, out double tipy);
            double delta = MathUtil.WrapDegrees(MathUtil.AngleOf(gx - ccx, gy - ccy) - MathUtil.AngleOf(tipx - ccx, tipy - ccy));
            Applied[ch].Rotation += delta * mix * ParentSign(ch);
            UpdateBranch(ch);
        }

        // ---- transform constraints -----------------------------------------------------------------

        void SourceValues(TransformData t, double[] o)
        {
            if (t.LocalSource)
            {
                var a = Applied[t.Source];
                o[0] = a.Rotation;
                o[1] = a.X;
                o[2] = a.Y;
                o[3] = a.ScaleX;
                o[4] = a.ScaleY;
                o[5] = a.ShearY;
                return;
            }
            var s = World[t.Source];
            s.Apply(t.Offsets[Props.X], t.Offsets[Props.Y], out double x, out double y);
            double xAngle = MathUtil.AngleOf(s.A, s.B);
            o[0] = xAngle;
            o[1] = x;
            o[2] = y;
            o[3] = MathUtil.Hypot(s.A, s.B);
            o[4] = MathUtil.Hypot(s.C, s.D);
            o[5] = MathUtil.WrapDegrees(MathUtil.AngleOf(s.C, s.D) - xAngle - 90.0);
        }

        readonly double[] sourceValues = new double[Props.Count];

        /// <summary>Target property values after the mapping and offsets (targeted[p] false = property not targeted).</summary>
        void TargetValues(TransformData t)
        {
            SourceValues(t, sourceValues);
            bool reflected = !t.LocalSource && World[t.Source].Determinant < 0.0;
            for (int i = 0; i < Props.Count; i++)
            {
                targeted[i] = false;
                targetValues[i] = 0.0;
            }
            foreach (var p in t.PropMaps)
            {
                double from = sourceValues[p.From] - p.Offset;
                foreach (var to in p.To)
                {
                    double v = from * to.Scale + to.Offset;
                    if (t.Clamp) v = Num.Min(Num.Max(v, Num.Min(to.Offset, to.Max)), Num.Max(to.Offset, to.Max));
                    // World x/y offsets are already applied through the source bone.
                    bool pointOffset = !t.LocalSource && (to.Prop == Props.X || to.Prop == Props.Y) && (p.From == Props.X || p.From == Props.Y);
                    double off = pointOffset ? 0.0 : t.Offsets[to.Prop];
                    if (reflected && (to.Prop == Props.Rotate || to.Prop == Props.ShearY)) off = -off;
                    targetValues[to.Prop] += v + off;
                    targeted[to.Prop] = true;
                }
            }
        }

        void SolveTransform(ConstraintData c, TransformData t, int index)
        {
            var mix = ConstraintState[index];
            bool any = false;
            for (int i = 0; i < Props.Count; i++)
                if (mix[i] != 0.0) any = true;
            if (!any) return;
            TargetValues(t);
            var v = targetValues;
            if (t.LocalTarget)
            {
                foreach (int b in c.Bones)
                {
                    ref var a = ref Applied[b];
                    double M(int p) => targeted[p] ? mix[p] : 0.0;
                    double Val(int p) => targeted[p] ? v[p] : double.NaN;
                    if (t.Additive)
                    {
                        if (M(Props.Rotate) != 0.0) a.Rotation += Val(Props.Rotate) * mix[Props.Rotate];
                        if (M(Props.X) != 0.0) a.X += Val(Props.X) * mix[Props.X];
                        if (M(Props.Y) != 0.0) a.Y += Val(Props.Y) * mix[Props.Y];
                        if (M(Props.ScaleX) != 0.0) a.ScaleX *= (Val(Props.ScaleX) - 1.0) * mix[Props.ScaleX] + 1.0;
                        if (M(Props.ScaleY) != 0.0) a.ScaleY *= (Val(Props.ScaleY) - 1.0) * mix[Props.ScaleY] + 1.0;
                        if (M(Props.ShearY) != 0.0) a.ShearY += Val(Props.ShearY) * mix[Props.ShearY];
                    }
                    else
                    {
                        if (M(Props.Rotate) != 0.0) a.Rotation += MathUtil.WrapDegrees(Val(Props.Rotate) - a.Rotation) * mix[Props.Rotate];
                        if (M(Props.X) != 0.0) a.X += (Val(Props.X) - a.X) * mix[Props.X];
                        if (M(Props.Y) != 0.0) a.Y += (Val(Props.Y) - a.Y) * mix[Props.Y];
                        if (M(Props.ScaleX) != 0.0) a.ScaleX += (Val(Props.ScaleX) - a.ScaleX) * mix[Props.ScaleX];
                        if (M(Props.ScaleY) != 0.0) a.ScaleY += (Val(Props.ScaleY) - a.ScaleY) * mix[Props.ScaleY];
                        if (M(Props.ShearY) != 0.0) a.ShearY += MathUtil.WrapDegrees(Val(Props.ShearY) - a.ShearY) * mix[Props.ShearY];
                    }
                }
                foreach (int b in c.Bones) UpdateBranch(b);
                return;
            }
            desired.Clear();
            foreach (int b in c.Bones)
            {
                var m = World[b];
                if (targeted[Props.Rotate] && mix[Props.Rotate] != 0.0)
                {
                    double r = t.Additive ? v[Props.Rotate] : MathUtil.WrapDegrees(v[Props.Rotate] - MathUtil.AngleOf(m.A, m.B));
                    RotateLinear(ref m, r * mix[Props.Rotate]);
                }
                if (targeted[Props.X] && mix[Props.X] != 0.0) m.Tx += t.Additive ? v[Props.X] * mix[Props.X] : (v[Props.X] - m.Tx) * mix[Props.X];
                if (targeted[Props.Y] && mix[Props.Y] != 0.0) m.Ty += t.Additive ? v[Props.Y] * mix[Props.Y] : (v[Props.Y] - m.Ty) * mix[Props.Y];
                if (targeted[Props.ScaleX] && mix[Props.ScaleX] != 0.0) Scale(ref m, t.Additive, v[Props.ScaleX], mix[Props.ScaleX], false);
                if (targeted[Props.ScaleY] && mix[Props.ScaleY] != 0.0) Scale(ref m, t.Additive, v[Props.ScaleY], mix[Props.ScaleY], true);
                if (targeted[Props.ShearY] && mix[Props.ShearY] != 0.0)
                {
                    double shear = v[Props.ShearY];
                    double xAngle = MathUtil.AngleOf(m.A, m.B);
                    double gap = MathUtil.WrapDegrees(MathUtil.AngleOf(m.C, m.D) - xAngle);
                    double want = t.Additive ? gap + shear * mix[Props.ShearY] : gap + MathUtil.WrapDegrees(90.0 + shear - gap) * mix[Props.ShearY];
                    double len = MathUtil.Hypot(m.C, m.D);
                    m.C = Math.Cos((xAngle + want) * MathUtil.Deg) * len;
                    m.D = Math.Sin((xAngle + want) * MathUtil.Deg) * len;
                }
                desired.Add(new KeyValuePair<int, Affine>(b, m));
            }
            SetWorlds(desired);
        }

        static void Scale(ref Affine m, bool additive, double value, double mixValue, bool yAxis)
        {
            double ax = yAxis ? m.C : m.A, ay = yAxis ? m.D : m.B;
            double s = MathUtil.Hypot(ax, ay);
            if (s < Epsilon) return;
            double f = additive ? (value - 1.0) * mixValue + 1.0 : (s + (value - s) * mixValue) / s;
            if (yAxis)
            {
                m.C *= f;
                m.D *= f;
            }
            else
            {
                m.A *= f;
                m.B *= f;
            }
        }

        // ---- path constraints ----------------------------------------------------------------------

        double[] spaces = new double[8], lens = new double[8];
        double[] pointsX = new double[8], pointsY = new double[8], pointsA = new double[8];
        readonly PathCurve pathCurve = new PathCurve();

        static void Grow(ref double[] a, int n)
        {
            if (a.Length < n) a = new double[Math.Max(n, a.Length * 2)];
        }

        bool SolvePath(ConstraintData c, PathData p, int index)
        {
            var state = ConstraintState[index];
            double mixRotate = state[PMixRotate], mixX = state[PMixX], mixY = state[PMixY], spacing = state[PSpacing];
            if (mixRotate == 0.0 && mixX == 0.0 && mixY == 0.0) return false;
            var att = SlotAttachment(p.Slot);
            if (att == null || att.Kind != AttachmentKind.Path) return false;
            WorldVertices(p.Slot, att, verts);
            if (!pathCurve.Build(verts, att.Closed, att.ConstantSpeed, att.Lengths)) return false;
            var path = pathCurve;

            int n = c.Bones.Length;
            bool tangents = p.RotateMode == RotateMode.Tangent;
            bool chainScale = p.RotateMode == RotateMode.ChainScale;
            int count = tangents ? n : n + 1;
            Grow(ref lens, n);
            Grow(ref spaces, count);
            Grow(ref pointsX, count);
            Grow(ref pointsY, count);
            Grow(ref pointsA, count);
            for (int i = 0; i < n; i++)
            {
                int b = c.Bones[i];
                lens[i] = sk.Bones[b].Length * MathUtil.Hypot(World[b].A, World[b].B);
            }
            Array.Clear(spaces, 0, count);
            bool percentSpacing = p.SpacingMode == SpacingMode.Percent;
            for (int i = 0; i < count - 1; i++)
            {
                double len = i < n ? lens[i] : double.NaN;
                switch (p.SpacingMode)
                {
                    case SpacingMode.Percent:
                    case SpacingMode.Fixed:
                        spaces[i + 1] = spacing;
                        break;
                    case SpacingMode.Proportional:
                        spaces[i + 1] = len;
                        break;
                    default:
                        spaces[i + 1] = len < Epsilon ? 0.0 : len + spacing;
                        break;
                }
            }
            if (p.SpacingMode == SpacingMode.Proportional)
            {
                double sum = 0.0;
                for (int i = 0; i < count; i++) sum += spaces[i];
                if (sum > Epsilon)
                    for (int i = 1; i < count; i++) spaces[i] *= (path.Length * (1.0 - Num.Min(spacing, 1.0))) / sum;
            }
            double position = state[PPosition];
            if (p.PositionMode == PositionMode.Percent) position *= path.Length;
            double at = position;
            for (int i = 0; i < count; i++)
            {
                at += percentSpacing ? spaces[i] * path.Length : spaces[i];
                path.At(at, out pointsX[i], out pointsY[i], out pointsA[i]);
            }
            desired.Clear();
            for (int i = 0; i < n; i++)
            {
                int b = c.Bones[i];
                var m = World[b];
                double x = pointsX[i], y = pointsY[i], angle = pointsA[i];
                m.Tx += (x - m.Tx) * mixX;
                m.Ty += (y - m.Ty) * mixY;
                if (mixRotate > 0.0)
                {
                    double r;
                    if (tangents) r = angle;
                    else
                    {
                        double dx = pointsX[i + 1] - m.Tx, dy = pointsY[i + 1] - m.Ty;
                        if (chainScale && lens[i] >= Epsilon)
                        {
                            double s = (MathUtil.Hypot(dx, dy) / lens[i] - 1.0) * mixRotate + 1.0;
                            m.A *= s;
                            m.B *= s;
                        }
                        r = MathUtil.Hypot(dx, dy) > Epsilon ? MathUtil.AngleOf(dx, dy) : angle;
                    }
                    double reflect = m.Determinant < 0.0 ? -1.0 : 1.0;
                    r = MathUtil.WrapDegrees(r - MathUtil.AngleOf(m.A, m.B) + p.OffsetRotation * reflect);
                    RotateLinear(ref m, r * mixRotate);
                }
                desired.Add(new KeyValuePair<int, Affine>(b, m));
            }
            return true;
        }

        // ---- physics -------------------------------------------------------------------------------

        bool SolvePhysics(PhysicsData p, int index, double delta)
        {
            // Wind and gravity are scaled by this to accelerations in skeleton units per second².
            const double ForceScale = 100.0;
            // Tip distance used for rotation, scale and shear of bones without a length.
            const double MinTip = 10.0;
            var st = ConstraintState[index];
            double inertia = st[0], strength = st[1], damping = st[2], mass = st[3], wind = st[4], gravity = st[5], mix = st[6];
            var m = World[p.Bone];
            double h = MathUtil.Hypot(m.A, m.B);
            double axis = h == 0.0 || double.IsNaN(h) ? 1.0 : h;
            // A placed skeleton simulates in its own units (see Placement): positions are divided by the
            // placement's scale going in and the result multiplied by it coming out.
            double ps = 1.0;
            if (Placement.HasValue)
            {
                double s = Math.Sqrt(Math.Abs(Placement.Value.Determinant));
                ps = s == 0.0 || double.IsNaN(s) ? 1.0 : s;
            }
            double len = Num.Max(MinTip, sk.Bones[p.Bone].Length * axis / ps);
            double ox = m.Tx / ps, oy = m.Ty / ps;
            double tx = ox + (m.A / axis) * len, ty = oy + (m.B / axis) * len;
            var sim = physics[index];
            if (sim == null) physics[index] = sim = new PhysicsSim { LastOx = ox, LastOy = oy, LastTx = tx, LastTy = ty };
            if (delta > 0.0)
            {
                double step = 1.0 / Num.Max(p.Fps, 1.0);
                sim.Rest += delta;
                double steps = Math.Floor(sim.Rest / step);
                sim.Rest -= steps * step;
                steps = Num.Min(steps, Num.Max(p.Fps, 1.0)); // at most one second of catching up
                if (steps > 0.0)
                {
                    // Inertia: part of the animated movement since the last update is left behind.
                    sim.Ox -= (ox - sim.LastOx) * inertia;
                    sim.Tx -= (tx - sim.LastTx) * inertia;
                    sim.Oy -= (oy - sim.LastOy) * inertia;
                    sim.Ty -= (ty - sim.LastTy) * inertia;
                    double massInv = mass > 0.0 ? 1.0 / mass : 1.0;
                    double keep = Math.Pow(MathUtil.Clamp(damping, 0.0, 1.0), 60.0 * step);
                    double fx = wind * ForceScale, fy = -gravity * ForceScale;
                    long n = Num.ToLong(steps);
                    for (long k = 0; k < n; k++)
                    {
                        Integrate(ref sim.Ox, ref sim.Oy, ref sim.Ovx, ref sim.Ovy, fx, fy, strength, massInv, step, keep, p.Limit);
                        Integrate(ref sim.Tx, ref sim.Ty, ref sim.Tvx, ref sim.Tvy, fx, fy, strength, massInv, step, keep, p.Limit);
                    }
                    sim.LastOx = ox;
                    sim.LastOy = oy;
                    sim.LastTx = tx;
                    sim.LastTy = ty;
                }
            }
            if (mix == 0.0) return false;
            var output = m;
            output.Tx += sim.Ox * p.X * mix * ps;
            output.Ty += sim.Oy * p.Y * mix * ps;
            if (p.Rotate != 0.0 || p.ScaleX != 0.0 || p.ShearX != 0.0)
            {
                double fromX = tx - ox, fromY = ty - oy;
                double toX = fromX + sim.Tx, toY = fromY + sim.Ty;
                double angle = MathUtil.WrapDegrees(MathUtil.AngleOf(toX, toY) - MathUtil.AngleOf(fromX, fromY));
                RotateLinear(ref output, angle * p.Rotate * mix);
                if (p.ShearX != 0.0)
                {
                    // Tilt only the X axis.
                    double r = angle * p.ShearX * mix * MathUtil.Deg;
                    double a = output.A, b = output.B;
                    output.A = a * Math.Cos(r) - b * Math.Sin(r);
                    output.B = a * Math.Sin(r) + b * Math.Cos(r);
                }
                if (p.ScaleX != 0.0)
                {
                    double f = (MathUtil.Hypot(toX, toY) / len - 1.0) * p.ScaleX * mix + 1.0;
                    output.A *= f;
                    output.B *= f;
                }
            }
            desired.Clear();
            desired.Add(new KeyValuePair<int, Affine>(p.Bone, output));
            return true;
        }

        static void Integrate(ref double px, ref double py, ref double vx, ref double vy, double fx, double fy, double strength, double massInv, double step, double keep, double limit)
        {
            vx = (vx + (fx - strength * px) * massInv * step) * keep;
            vy = (vy + (fy - strength * py) * massInv * step) * keep;
            double speed = MathUtil.Hypot(vx, vy);
            if (speed > limit)
            {
                vx *= limit / speed;
                vy *= limit / speed;
            }
            px += vx * step;
            py += vy * step;
        }

        // ---- slider --------------------------------------------------------------------------------

        bool SolveSlider(SliderData s, int index)
        {
            var st = ConstraintState[index];
            double stateTime = st[0], stateMix = st[1];
            if (s.Animation < 0 || s.Animation >= sk.Animations.Count) return false;
            var anim = sk.Animations[s.Animation];
            if (stateMix <= 0.0) return false;
            double time = stateTime;
            if (s.Bone >= 0)
            {
                double value = s.Local ? LocalProperty(Applied[s.Bone], s.Property) : WorldProperty(World[s.Bone], s.Property);
                time = value * s.Scale + s.Offset;
            }
            double d = anim.Duration;
            if (d > 0.0) time = s.Looping ? ((time % d) + d) % d : MathUtil.Clamp(time, 0.0, d);
            // Apply onto the constrained (applied) transforms, then recompute world transforms.
            intoApplied = true;
            ApplyAnimation(anim, time, Num.Min(stateMix, 1.0));
            intoApplied = false;
            return true;
        }

        // ---- attachments ---------------------------------------------------------------------------

        /// <summary>The attachment a slot shows, resolved through the active skin.</summary>
        public Attachment SlotAttachment(int slot) => sk.Attachment(slot, Attachment[slot], Skin);

        /// <summary>Image an attachment shows in a slot: its image, or the current frame of its sequence.</summary>
        public int ImageOf(int slot, Attachment att)
        {
            var seq = att.Sequence;
            if (seq == null) return att.Image;
            long index = slot >= 0 && slot < Sequence.Length ? Sequence[slot] : -1;
            long i = index >= 0 ? index : seq.Setup;
            if (seq.Frames.Length == 0) return att.Image;
            i = Math.Max(0, Math.Min(i, seq.Frames.Length - 1));
            return seq.Frames[i];
        }

        /// <summary>World transform of a region or point attachment.</summary>
        public Affine AttachmentWorld(int slot, in Transform2 offset) => World[sk.Slots[slot].Bone].Mul(offset.ToAffine());

        /// <summary>World positions of a mesh-like attachment's vertices, flat [x, y, ...].</summary>
        public double[] WorldVertices(int slot, Attachment att)
        {
            var list = new List<double>();
            WorldVertices(slot, att, list);
            return list.ToArray();
        }

        static Vertices VerticesOf(Attachment att)
        {
            switch (att.Kind)
            {
                case AttachmentKind.Mesh:
                case AttachmentKind.BoundingBox:
                case AttachmentKind.Path:
                case AttachmentKind.Clipping:
                    return att.Vertices;
                default:
                    return null;
            }
        }

        public void WorldVertices(int slot, Attachment att, List<double> output)
        {
            output.Clear();
            int n = WorldVertices(slot, att, ref wvBuffer);
            for (int i = 0; i < n; i++) output.Add(wvBuffer[i]);
        }

        double[] wvBuffer = new double[64];

        /// <summary>World positions of a mesh-like attachment's vertices into buffer (grown as needed), flat [x, y, ...]. Returns the number of values written.</summary>
        public int WorldVertices(int slot, Attachment att, ref double[] buffer)
        {
            var source = sk.MeshSource(slot, att, Skin);
            if (source == null) return 0;
            int deformName = att.Kind == AttachmentKind.LinkedMesh && att.Deform ? att.Parent : att.Name;
            Deform.TryGetValue(DeformKey(slot, deformName), out var deform);
            var vertices = VerticesOf(source);
            if (vertices == null) return 0;
            int count = vertices.VertexCount * 2;
            if (buffer == null || buffer.Length < count) buffer = new double[Math.Max(count, (buffer?.Length ?? 0) * 2)];
            var o = buffer;
            var world = World;
            if (vertices.Weighted != null)
            {
                int k = 0, w = 0;
                bool hasDeform = deform != null;
                int dl = hasDeform ? deform.Length : 0;
                foreach (var v in vertices.Weighted)
                {
                    double x = 0.0, y = 0.0;
                    for (int q = 0; q < v.Length; q++)
                    {
                        ref var wt = ref v[q];
                        double bx = wt.X, by = wt.Y;
                        if (hasDeform)
                        {
                            if (k < dl) bx += deform[k];
                            if (k + 1 < dl) by += deform[k + 1];
                        }
                        k += 2;
                        if ((uint)wt.Bone >= (uint)world.Length) continue;
                        ref var m = ref world[wt.Bone];
                        x += (m.A * bx + m.C * by + m.Tx) * wt.W;
                        y += (m.B * bx + m.D * by + m.Ty) * wt.W;
                    }
                    o[w++] = x;
                    o[w++] = y;
                }
                return w;
            }
            var pv = vertices.Plain;
            ref var mm = ref world[sk.Slots[slot].Bone];
            int written = 0;
            for (int i = 0; i + 1 < pv.Length; i += 2)
            {
                double vx = pv[i] + D(deform, i), vy = pv[i + 1] + D(deform, i + 1);
                o[written++] = mm.A * vx + mm.C * vy + mm.Tx;
                o[written++] = mm.B * vx + mm.D * vy + mm.Ty;
            }
            return written;
        }

        static double D(double[] deform, int k) => deform != null && k < deform.Length ? deform[k] : 0.0;

        /// <summary>Visible regions and meshes in draw order, with world positions and tint (for tests and simple renderers; MeshBuilder makes textured, clipped geometry).</summary>
        public List<Quad> Quads()
        {
            var output = new List<Quad>();
            foreach (int i in DrawOrder)
            {
                var att = SlotAttachment(i);
                if (att == null) continue;
                var tint = Color[i];
                var color = new Color4(tint.R * att.Color.R, tint.G * att.Color.G, tint.B * att.Color.B, tint.A * att.Color.A);
                switch (att.Kind)
                {
                    case AttachmentKind.Region:
                    {
                        var m = AttachmentWorld(i, att.Offset);
                        double hw = att.Width * 0.5, hh = att.Height * 0.5;
                        var positions = new double[8];
                        m.Apply(-hw, hh, out positions[0], out positions[1]);
                        m.Apply(hw, hh, out positions[2], out positions[3]);
                        m.Apply(hw, -hh, out positions[4], out positions[5]);
                        m.Apply(-hw, -hh, out positions[6], out positions[7]);
                        output.Add(new Quad { Slot = i, Image = ImageOf(i, att), Positions = positions, Color = color });
                        break;
                    }
                    case AttachmentKind.Mesh:
                    case AttachmentKind.LinkedMesh:
                    {
                        var source = sk.MeshSource(i, att, Skin);
                        if (source == null) continue;
                        int image = ImageOf(i, att.Kind == AttachmentKind.LinkedMesh ? att : source);
                        output.Add(new Quad { Slot = i, Image = image, Positions = WorldVertices(i, att), Color = color });
                        break;
                    }
                }
            }
            return output;
        }

        // ---- sampling ------------------------------------------------------------------------------

        /// <summary>First index whose key time is after time (keys sorted by time).</summary>
        static int PartitionPoint(List<Key> keys, double time)
        {
            int lo = 0, hi = keys.Count;
            while (lo < hi)
            {
                int mid = (lo + hi) >> 1;
                if (keys[mid].Time <= time) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        static int PartitionDrawOrder(List<DrawOrderKey> keys, double time)
        {
            int lo = 0, hi = keys.Count;
            while (lo < hi)
            {
                int mid = (lo + hi) >> 1;
                if (keys[mid].Time <= time) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        static int PartitionIk(List<IkKey> keys, double time)
        {
            int lo = 0, hi = keys.Count;
            while (lo < hi)
            {
                int mid = (lo + hi) >> 1;
                if (keys[mid].Time <= time) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        static int PartitionDeform(List<DeformKey> keys, double time)
        {
            int lo = 0, hi = keys.Count;
            while (lo < hi)
            {
                int mid = (lo + hi) >> 1;
                if (keys[mid].Time <= time) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        }

        static double Comp(Key k, int c) => c < k.Values.Length ? k.Values[c] : double.NaN;

        /// <summary>Samples component c of numeric keys at time (keys must not be empty).</summary>
        static double SampleComponent(List<Key> keys, double time, int c)
        {
            if (time <= keys[0].Time) return Comp(keys[0], c);
            int next = PartitionPoint(keys, time);
            if (next >= keys.Count) return Comp(keys[keys.Count - 1], c);
            Key a = keys[next - 1], b = keys[next];
            double span = b.Time - a.Time;
            double va = Comp(a, c);
            return va + (Comp(b, c) - va) * a.Curve.Ease(span > 0.0 ? (time - a.Time) / span : 1.0, c);
        }

        /// <summary>Samples every component of numeric keys into output; false when there are no keys.</summary>
        static bool SampleInto(List<Key> keys, double time, List<double> output)
        {
            if (keys.Count == 0) return false;
            output.Clear();
            if (time <= keys[0].Time)
            {
                output.AddRange(keys[0].Values);
                return true;
            }
            int next = PartitionPoint(keys, time);
            if (next >= keys.Count)
            {
                output.AddRange(keys[keys.Count - 1].Values);
                return true;
            }
            Key a = keys[next - 1], b = keys[next];
            double span = b.Time - a.Time;
            double t = span > 0.0 ? (time - a.Time) / span : 1.0;
            for (int i = 0; i < a.Values.Length; i++)
            {
                double va = a.Values[i];
                double vb = i < b.Values.Length ? b.Values[i] : double.NaN;
                output.Add(MathUtil.Lerp(va, vb, a.Curve.Ease(t, i)));
            }
            return true;
        }

        /// <summary>Discrete keys (names, modes): the value of the last key at or before time (the first key before it).</summary>
        static T SampleDiscrete<T>(List<KeyValuePair<double, T>> keys, double time)
        {
            if (time <= keys[0].Key) return keys[0].Value;
            int lo = 0, hi = keys.Count;
            while (lo < hi)
            {
                int mid = (lo + hi) >> 1;
                if (keys[mid].Key <= time) lo = mid + 1;
                else hi = mid;
            }
            return keys[Math.Max(lo, 1) - 1].Value;
        }

        readonly Dictionary<int, Stack<double[]>> pool = new Dictionary<int, Stack<double[]>>();
        double[] deformTo = new double[0];

        double[] Rent(int n)
        {
            if (pool.TryGetValue(n, out var s) && s.Count > 0) return s.Pop();
            return new double[n];
        }

        void Release(double[] a)
        {
            if (!pool.TryGetValue(a.Length, out var s)) pool[a.Length] = s = new Stack<double[]>();
            if (s.Count < 64) s.Push(a);
        }

        /// <summary>Deform deltas at time: each key's sparse values expanded, interpolated along its curve.</summary>
        void SampleDeform(List<DeformKey> keys, double time, int n, double[] from)
        {
            int i = Math.Max(PartitionDeform(keys, time) - 1, 0);
            var a = keys[i];
            Expand(a, n, from);
            if (i + 1 >= keys.Count) return;
            var b = keys[i + 1];
            if (time <= a.Time || a.Curve.Kind == CurveKind.Stepped) return;
            if (deformTo.Length < n) deformTo = new double[n];
            Expand(b, n, deformTo);
            double e = a.Curve.Ease((time - a.Time) / (b.Time - a.Time), 0);
            for (int j = 0; j < n; j++) from[j] += (deformTo[j] - from[j]) * e;
        }

        static void Expand(DeformKey k, int n, double[] d)
        {
            Array.Clear(d, 0, n);
            for (int j = 0; j < k.Vertices.Length; j++)
                if (k.Offset + j < n) d[k.Offset + j] = k.Vertices[j];
        }

        /// <summary>Frame for sequence keys at time; false before the first key.</summary>
        static bool SequenceIndexAt(List<SequenceKey> keys, double time, long count, out long result)
        {
            result = 0;
            int k = -1;
            double delay = 0.0;
            for (int i = 0; i < keys.Count; i++)
            {
                if (keys[i].Time > time) break;
                k = i;
                if (keys[i].Delay.HasValue) delay = keys[i].Delay.Value;
            }
            if (k < 0) return false;
            var key = keys[k];
            long index = key.Index;
            if (key.Mode == SequenceMode.Hold || count <= 1)
            {
                result = Math.Min(Math.Max(index, 0), count - 1);
                return true;
            }
            long steps = delay > 0.0 ? Num.ToLong(Math.Floor((time - key.Time) / delay + 1e-6)) : 0;
            SequenceMode mode = key.Mode;
            bool reverse = mode == SequenceMode.OnceReverse || mode == SequenceMode.LoopReverse || mode == SequenceMode.PingPongReverse;
            SequenceMode baseMode = mode == SequenceMode.OnceReverse ? SequenceMode.Once : mode == SequenceMode.LoopReverse ? SequenceMode.Loop : mode == SequenceMode.PingPongReverse ? SequenceMode.PingPong : mode;
            long f = index + steps;
            switch (baseMode)
            {
                case SequenceMode.Once:
                    f = Math.Min(f, count - 1);
                    break;
                case SequenceMode.Loop:
                    f %= count;
                    break;
                case SequenceMode.PingPong:
                {
                    long period = 2 * (count - 1);
                    f %= period;
                    if (f >= count) f = period - f;
                    break;
                }
            }
            result = reverse ? count - 1 - f : f;
            return true;
        }

        readonly DrawOrderWork drawOrderWork = new DrawOrderWork();

        /// <summary>Slot order for a draw order key: offsets move slots relative to their setup index.</summary>
        public static void ApplyDrawOrder(int count, List<KeyValuePair<int, long>> offsets, int[] output) => new DrawOrderWork().Apply(count, offsets, output);

        /// <summary>Reusable buffers for draw order keys.</summary>
        sealed class DrawOrderWork
        {
            int[] order = new int[0];
            readonly List<int> unchanged = new List<int>();
            readonly List<KeyValuePair<int, long>> sorted = new List<KeyValuePair<int, long>>();

            public void Apply(int count, List<KeyValuePair<int, long>> offsets, int[] output)
            {
            if (offsets == null || offsets.Count == 0)
            {
                for (int i = 0; i < count; i++) output[i] = i;
                return;
            }
            if (order.Length < count) order = new int[count];
            for (int i = 0; i < count; i++) order[i] = -1;
            unchanged.Clear();
            int original = 0;
            // Stable insertion sort by slot (keys hold a handful of moves).
            sorted.Clear();
            foreach (var o in offsets)
            {
                int at = sorted.Count;
                while (at > 0 && sorted[at - 1].Key > o.Key) at--;
                sorted.Insert(at, o);
            }
            foreach (var o in sorted)
            {
                int slot = o.Key;
                if (slot < 0 || slot >= count) continue;
                while (original < slot) unchanged.Add(original++);
                long at = original + o.Value;
                if (at >= 0 && at < count && order[at] == -1) order[at] = original;
                else unchanged.Add(original);
                original++;
            }
            while (original < count) unchanged.Add(original++);
            for (int i = count - 1; i >= 0; i--)
            {
                if (order[i] != -1) continue;
                if (unchanged.Count > 0)
                {
                    order[i] = unchanged[unchanged.Count - 1];
                    unchanged.RemoveAt(unchanged.Count - 1);
                }
            }
            for (int i = 0; i < count; i++) output[i] = Math.Max(order[i], 0);
            }
        }

        /// <summary>Child world transform for an inherit mode. Translation always goes through the full parent; the linear part through the part of the parent the mode keeps.</summary>
        public static Affine InheritWorld(in Affine parent, in Affine local, Inherit mode)
        {
            if (mode == Rigby2D.Inherit.Normal) return parent.Mul(local);
            double tx = parent.A * local.Tx + parent.C * local.Ty + parent.Tx;
            double ty = parent.B * local.Tx + parent.D * local.Ty + parent.Ty;
            double sx = MathUtil.Hypot(parent.A, parent.B);
            double det = parent.Determinant;
            double pa, pb, pc, pd;
            switch (mode)
            {
                case Rigby2D.Inherit.OnlyTranslation:
                    pa = 1;
                    pb = 0;
                    pc = 0;
                    pd = 1;
                    break;
                case Rigby2D.Inherit.NoRotationOrReflection:
                    pa = sx;
                    pb = 0;
                    pc = 0;
                    pd = sx > 1e-12 ? Math.Abs(det) / sx : 0.0;
                    break;
                default:
                {
                    double ux = sx > 1e-12 ? parent.A / sx : 1.0;
                    double uy = sx > 1e-12 ? parent.B / sx : 0.0;
                    double flip = mode == Rigby2D.Inherit.NoScale && det < 0.0 ? -1.0 : 1.0;
                    pa = ux;
                    pb = uy;
                    pc = -uy * flip;
                    pd = ux * flip;
                    break;
                }
            }
            return new Affine(pa * local.A + pc * local.B, pb * local.A + pd * local.B, pa * local.C + pc * local.D, pb * local.C + pd * local.D, tx, ty);
        }

        /// <summary>The local transform that gives world transform world under parent and inherit mode (hasParent false: no parent).</summary>
        public static Transform2 LocalFromWorld(in Affine parent, bool hasParent, in Affine world, Inherit mode)
        {
            if (!hasParent) return world.Decompose();
            parent.Inverse().Apply(world.Tx, world.Ty, out double x, out double y);
            var keep = InheritWorld(parent, Affine.Identity, mode);
            keep.Tx = 0.0;
            keep.Ty = 0.0;
            var linear = keep.Inverse().Mul(new Affine(world.A, world.B, world.C, world.D, 0.0, 0.0));
            linear.Tx = x;
            linear.Ty = y;
            return linear.Decompose();
        }

        /// <summary>Rotates the linear part of m by deg degrees.</summary>
        static void RotateLinear(ref Affine m, double deg)
        {
            if (deg == 0.0 || double.IsNaN(deg)) return;
            double cos = Math.Cos(deg * MathUtil.Deg), sin = Math.Sin(deg * MathUtil.Deg);
            double a = m.A, b = m.B, c = m.C, d = m.D;
            m.A = cos * a - sin * b;
            m.B = sin * a + cos * b;
            m.C = cos * c - sin * d;
            m.D = sin * c + cos * d;
        }

        static double LocalProperty(in Transform2 t, Property p)
        {
            switch (p)
            {
                case Property.X: return t.X;
                case Property.Y: return t.Y;
                case Property.ScaleX: return t.ScaleX;
                case Property.ScaleY: return t.ScaleY;
                case Property.ShearY: return t.ShearY;
                default: return t.Rotation;
            }
        }

        static double WorldProperty(in Affine m, Property p)
        {
            switch (p)
            {
                case Property.X: return m.Tx;
                case Property.Y: return m.Ty;
                case Property.ScaleX: return MathUtil.Hypot(m.A, m.B);
                case Property.ScaleY: return MathUtil.Hypot(m.C, m.D);
                case Property.ShearY: return MathUtil.WrapDegrees(MathUtil.AngleOf(m.C, m.D) - MathUtil.AngleOf(m.A, m.B) - 90.0);
                default: return MathUtil.AngleOf(m.A, m.B);
            }
        }

        // ---- paths ----------------------------------------------------------------------------------

        /// <summary>A path from world vertices laid out as [in-handle, point, out-handle] per path point.</summary>
        sealed class PathCurve
        {
            const int Segments = 16;
            double[] curves = new double[0]; // 8 per curve
            double[] tables = new double[0]; // Segments + 1 per curve
            double[] ends = new double[0];
            int curveCount;
            public double Length;
            bool closed, constant;

            public bool Build(List<double> v, bool isClosed, bool constantSpeed, double[] lengths)
            {
                int pointCount = v.Count / 6;
                if (pointCount < 2 && !(isClosed && pointCount >= 1)) return false;
                closed = isClosed;
                curveCount = isClosed ? pointCount : pointCount - 1;
                if (curves.Length < curveCount * 8) curves = new double[curveCount * 8];
                if (tables.Length < curveCount * (Segments + 1)) tables = new double[curveCount * (Segments + 1)];
                if (ends.Length < curveCount) ends = new double[curveCount];
                for (int i = 0; i < curveCount; i++)
                {
                    int o = 6 * i;
                    int next = isClosed && i == pointCount - 1 ? 0 : o + 6;
                    int c = 8 * i;
                    curves[c] = v[o + 2];
                    curves[c + 1] = v[o + 3];
                    curves[c + 2] = v[o + 4];
                    curves[c + 3] = v[o + 5];
                    curves[c + 4] = v[next];
                    curves[c + 5] = v[next + 1];
                    curves[c + 6] = v[next + 2];
                    curves[c + 7] = v[next + 3];
                    int t = (Segments + 1) * i;
                    tables[t] = 0.0;
                    double px = curves[c], py = curves[c + 1];
                    for (int s = 1; s <= Segments; s++)
                    {
                        double u = s / (double)Segments;
                        double x = RawCurves.Cubic4(curves[c], curves[c + 2], curves[c + 4], curves[c + 6], u);
                        double y = RawCurves.Cubic4(curves[c + 1], curves[c + 3], curves[c + 5], curves[c + 7], u);
                        tables[t + s] = tables[t + s - 1] + MathUtil.Hypot(x - px, y - py);
                        px = x;
                        py = y;
                    }
                }
                constant = constantSpeed || lengths == null || lengths.Length == 0;
                if (constant)
                {
                    double sum = 0.0;
                    for (int i = 0; i < curveCount; i++)
                    {
                        sum += tables[(Segments + 1) * i + Segments];
                        ends[i] = sum;
                    }
                }
                else
                {
                    for (int i = 0; i < curveCount; i++) ends[i] = i < lengths.Length ? lengths[i] : i > 0 ? ends[i - 1] : 0.0;
                }
                Length = curveCount > 0 ? ends[curveCount - 1] : 0.0;
                return !(Length < Epsilon);
            }

            void Evaluate(int i, double u, out double x, out double y, out double angle)
            {
                int c = 8 * i;
                x = RawCurves.Cubic4(curves[c], curves[c + 2], curves[c + 4], curves[c + 6], u);
                y = RawCurves.Cubic4(curves[c + 1], curves[c + 3], curves[c + 5], curves[c + 7], u);
                double dx = Deriv(curves[c], curves[c + 2], curves[c + 4], curves[c + 6], u);
                double dy = Deriv(curves[c + 1], curves[c + 3], curves[c + 5], curves[c + 7], u);
                if (MathUtil.Hypot(dx, dy) < Epsilon)
                {
                    dx = curves[c + 6] - curves[c];
                    dy = curves[c + 7] - curves[c + 1];
                }
                angle = MathUtil.AngleOf(dx, dy);
            }

            static double Deriv(double p0, double p1, double p2, double p3, double u) =>
                3.0 * (1.0 - u) * (1.0 - u) * (p1 - p0) + 6.0 * (1.0 - u) * u * (p2 - p1) + 3.0 * u * u * (p3 - p2);

            /// <summary>Point and tangent (degrees) at a distance along the path.</summary>
            public void At(double dist, out double x, out double y, out double angle)
            {
                if (closed)
                {
                    dist %= Length;
                    if (dist < 0.0) dist += Length;
                }
                else if (dist < 0.0)
                {
                    double ang = MathUtil.AngleOf(curves[2] - curves[0], curves[3] - curves[1]);
                    x = curves[0] + Math.Cos(ang * MathUtil.Deg) * dist;
                    y = curves[1] + Math.Sin(ang * MathUtil.Deg) * dist;
                    angle = ang;
                    return;
                }
                else if (dist > Length)
                {
                    int c = 8 * (curveCount - 1);
                    double ang = MathUtil.AngleOf(curves[c + 6] - curves[c + 4], curves[c + 7] - curves[c + 5]);
                    double over = dist - Length;
                    x = curves[c + 6] + Math.Cos(ang * MathUtil.Deg) * over;
                    y = curves[c + 7] + Math.Sin(ang * MathUtil.Deg) * over;
                    angle = ang;
                    return;
                }
                int i = 0;
                while (i < curveCount - 1 && dist > ends[i]) i++;
                double start = i > 0 ? ends[i - 1] : 0.0;
                double span = ends[i] - start;
                double f = span > Epsilon ? (dist - start) / span : 0.0;
                if (!constant)
                {
                    Evaluate(i, f, out x, out y, out angle);
                    return;
                }
                // Constant speed: invert the arc length table.
                int t = (Segments + 1) * i;
                double target = f * tables[t + Segments];
                int s = 1;
                while (s < Segments && tables[t + s] < target) s++;
                double seg = tables[t + s] - tables[t + s - 1];
                double u = (s - 1.0 + (seg > Epsilon ? (target - tables[t + s - 1]) / seg : 0.0)) / Segments;
                Evaluate(i, u, out x, out y, out angle);
            }
        }
    }
}
