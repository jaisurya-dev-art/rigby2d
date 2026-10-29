// SPDX-License-Identifier: MIT OR Apache-2.0
// Skeleton data: bones, slots, attachments, skins, constraints, events and animations, loaded once
// and shared by every instance (see Pose and PlaybackState for per-instance state).
// A port of runtimes/rust/rigby-runtime/src/model.rs. Indices that may be absent use -1.

using System;
using System.Collections.Generic;

namespace Rigby2D
{
    public enum Inherit : byte
    {
        Normal,
        OnlyTranslation,
        NoRotationOrReflection,
        NoScale,
        NoScaleOrReflection,
    }

    public static class InheritNames
    {
        public static bool TryParse(string s, out Inherit inherit)
        {
            switch (s)
            {
                case "normal": inherit = Inherit.Normal; return true;
                case "onlyTranslation": inherit = Inherit.OnlyTranslation; return true;
                case "noRotationOrReflection": inherit = Inherit.NoRotationOrReflection; return true;
                case "noScale": inherit = Inherit.NoScale; return true;
                case "noScaleOrReflection": inherit = Inherit.NoScaleOrReflection; return true;
                default: inherit = Inherit.Normal; return false;
            }
        }
    }

    public enum Blend : byte
    {
        Normal,
        Additive,
        Multiply,
        Screen,
    }

    public static class BlendNames
    {
        public static Blend Parse(string s)
        {
            switch (s)
            {
                case "additive": return Blend.Additive;
                case "multiply": return Blend.Multiply;
                case "screen": return Blend.Screen;
                default: return Blend.Normal;
            }
        }
    }

    public sealed class BoneData
    {
        public string Name;
        /// <summary>Parent bone index, or -1 for a root.</summary>
        public int Parent = -1;
        public double Length;
        public Transform2 Setup = Transform2.Identity;
        public Inherit Inherit;
        public bool SkinRequired;
    }

    public sealed class SlotData
    {
        public string Name;
        public int Bone;
        /// <summary>Setup attachment name id, or -1.</summary>
        public int Attachment = -1;
        public Color4 Color = Color4.White;
        public bool HasDark;
        public Color4 Dark;
        public Blend Blend;
        /// <summary>The default skin's attachments for this slot.</summary>
        public List<Attachment> Attachments = new List<Attachment>();
    }

    /// <summary>An RGBA color with 0..1 components.</summary>
    [Serializable]
    public struct Color4
    {
        public double R, G, B, A;
        public static readonly Color4 White = new Color4(1, 1, 1, 1);

        public Color4(double r, double g, double b, double a)
        {
            R = r;
            G = g;
            B = b;
            A = a;
        }

        public double this[int i]
        {
            get => i == 0 ? R : i == 1 ? G : i == 2 ? B : A;
            set
            {
                switch (i)
                {
                    case 0: R = value; break;
                    case 1: G = value; break;
                    case 2: B = value; break;
                    default: A = value; break;
                }
            }
        }
    }

    public struct Weight
    {
        public int Bone;
        public double X, Y, W;
    }

    /// <summary>Vertices of a mesh-like attachment: plain (x, y per vertex, in the slot bone's space) or weighted to several bones.</summary>
    public sealed class Vertices
    {
        /// <summary>Plain vertices, or null when weighted.</summary>
        public double[] Plain;
        /// <summary>Per vertex, the bones it is weighted to; null when plain.</summary>
        public Weight[][] Weighted;

        public bool IsWeighted => Weighted != null;
        public int VertexCount => Weighted != null ? Weighted.Length : Plain.Length / 2;

        /// <summary>Floats a deform key covers: one x/y pair per vertex, or per bone weight.</summary>
        public int DeformLength
        {
            get
            {
                if (Weighted == null) return Plain.Length;
                int n = 0;
                foreach (var v in Weighted) n += v.Length * 2;
                return n;
            }
        }
    }

    public sealed class Sequence
    {
        public long Count, Start, Setup;
        public int Digits;
        /// <summary>Frame image names (image + zero-padded start + i), precomputed.</summary>
        public int[] Frames;
    }

    public enum AttachmentKind : byte
    {
        Region,
        Mesh,
        LinkedMesh,
        BoundingBox,
        Path,
        Clipping,
        Point,
    }

    /// <summary>An attachment of a slot. Which fields are used depends on Kind.</summary>
    public sealed class Attachment
    {
        public int Name;
        /// <summary>Image (atlas region) shown: the attachment's path, else its name.</summary>
        public int Image;
        public Color4 Color = Color4.White;
        public AttachmentKind Kind;
        public Sequence Sequence;

        // Region, Point
        public Transform2 Offset = Transform2.Identity;
        // Region, Mesh, LinkedMesh
        public double Width, Height;
        // Mesh
        public double[] Uvs;
        public int[] Triangles;
        public int Hull;
        // Mesh, BoundingBox, Path, Clipping
        public Vertices Vertices;
        // LinkedMesh
        public int Parent;
        public string ParentSkin;
        public bool Deform;
        // Path
        public bool Closed, ConstantSpeed;
        public double[] Lengths;
        // Clipping: slot index where clipping ends, or -1.
        public int End = -1;
    }

    public sealed class SkinData
    {
        public string Name;
        public List<KeyValuePair<int, List<Attachment>>> Slots = new List<KeyValuePair<int, List<Attachment>>>();
        public List<int> Bones = new List<int>();
        public List<int> Ik = new List<int>();
        /// <summary>Names of the transform, path, physics and other constraints listed by the skin.</summary>
        public List<string> Constraints = new List<string>();
    }

    public sealed class IkData
    {
        public string Name;
        public double Order;
        public bool SkinRequired;
        public int[] Bones;
        public int Target;
        public double Mix, Softness;
        public bool BendPositive, Compress, Stretch, Uniform;
    }

    /// <summary>Transform constraint properties, in this order everywhere.</summary>
    public static class Props
    {
        public const int Count = 6;
        public const int Rotate = 0, X = 1, Y = 2, ScaleX = 3, ScaleY = 4, ShearY = 5;
    }

    public struct PropTarget
    {
        public int Prop;
        public double Offset, Max, Scale;
    }

    public sealed class PropMap
    {
        public int From;
        public double Offset;
        public PropTarget[] To;
    }

    public sealed class TransformData
    {
        public int Source;
        public double[] Offsets = new double[Props.Count];
        public double[] Mix = new double[Props.Count];
        public List<PropMap> PropMaps = new List<PropMap>();
        public bool LocalSource, LocalTarget, Additive, Clamp;
    }

    public enum PositionMode : byte { Fixed, Percent }
    public enum SpacingMode : byte { Length, Fixed, Percent, Proportional }
    public enum RotateMode : byte { Tangent, Chain, ChainScale }

    public struct PathState
    {
        public double Position, Spacing, MixRotate, MixX, MixY;
    }

    public sealed class PathData
    {
        public int Slot;
        public PositionMode PositionMode;
        public SpacingMode SpacingMode;
        public RotateMode RotateMode;
        public double OffsetRotation;
        public PathState Setup;
    }

    public sealed class PhysicsData
    {
        /// <summary>Physics values keys can animate, in this order.</summary>
        public static readonly string[] Values = { "inertia", "strength", "damping", "mass", "wind", "gravity", "mix" };

        public int Bone;
        /// <summary>Weights of x, y, rotate, scaleX, shearX.</summary>
        public double X, Y, Rotate, ScaleX, ShearX;
        public double Limit, Fps;
        public bool[] Globals = new bool[7];
        /// <summary>inertia, strength, damping, mass, wind, gravity, mix.</summary>
        public double[] Setup = new double[7];
    }

    public enum Property : byte { Rotate, X, Y, ScaleX, ScaleY, ShearY }

    public sealed class SliderData
    {
        public int Animation;
        /// <summary>Bone driving the slider, or -1.</summary>
        public int Bone = -1;
        public Property Property;
        public double Scale, Offset;
        public bool Local, Looping, Additive;
        /// <summary>time, mix.</summary>
        public double[] Setup = new double[2];
    }

    public enum ConstraintKind : byte { Transform, Path, Physics, Slider }

    /// <summary>A transform, path, physics or slider constraint (IK constraints are in SkeletonData.Ik).</summary>
    public sealed class ConstraintData
    {
        public string Name;
        public double Order;
        public bool SkinRequired;
        public int[] Bones;
        public ConstraintKind Kind;
        public TransformData Transform;
        public PathData Path;
        public PhysicsData Physics;
        public SliderData Slider;
    }

    public sealed class EventData
    {
        public string Name;
        public long Int;
        public double Float;
        public string String, Audio;
        public double Volume, Balance;
    }

    // ---- animations --------------------------------------------------------------------------------

    public sealed class Key
    {
        public double Time;
        public double[] Values;
        public Curve Curve;
    }

    /// <summary>Bone channels in application order.</summary>
    public static class Channel
    {
        public const int Count = 10;
        public const int Rotate = 0, Translate = 1, TranslateX = 2, TranslateY = 3, Scale = 4, ScaleX = 5, ScaleY = 6, Shear = 7, ShearX = 8, ShearY = 9;
    }

    public sealed class BoneTimeline
    {
        public int Bone;
        public List<Key>[] Channels = NewChannels();
        public List<KeyValuePair<double, Inherit>> Inherit = new List<KeyValuePair<double, Inherit>>();

        static List<Key>[] NewChannels()
        {
            var c = new List<Key>[Channel.Count];
            for (int i = 0; i < c.Length; i++) c[i] = new List<Key>();
            return c;
        }
    }

    public sealed class SlotTimeline
    {
        public int Slot;
        /// <summary>Attachment keys: time and attachment name id (-1 = none).</summary>
        public List<KeyValuePair<double, int>> Attachment = new List<KeyValuePair<double, int>>();
        public List<Key> Color = new List<Key>(), Rgb = new List<Key>(), Alpha = new List<Key>(), Rgba2 = new List<Key>(), Rgb2 = new List<Key>();
    }

    public sealed class DeformKey
    {
        public double Time;
        public int Offset;
        public double[] Vertices;
        public Curve Curve;
    }

    public sealed class DeformTimeline
    {
        /// <summary>Skin name, or null for the default skin (then the active skin is searched first).</summary>
        public string Skin;
        public int Slot;
        public int Attachment;
        public List<DeformKey> Keys = new List<DeformKey>();
    }

    public enum SequenceMode : byte { Hold, Once, Loop, PingPong, OnceReverse, LoopReverse, PingPongReverse }

    public sealed class SequenceKey
    {
        public double Time;
        public SequenceMode Mode;
        public long Index;
        public double? Delay;
    }

    public sealed class SequenceTimeline
    {
        public string Skin;
        public int Slot;
        public int Attachment;
        public List<SequenceKey> Keys = new List<SequenceKey>();
    }

    public sealed class EventKey
    {
        public double Time;
        public string Name;
        public long? Int;
        public double? Float, Volume, Balance;
        public string String;
    }

    public sealed class IkKey
    {
        public double Time, Mix, Softness;
        public bool BendPositive, Compress, Stretch;
    }

    public sealed class IkTimeline
    {
        public int Constraint;
        public List<IkKey> Keys = new List<IkKey>();
    }

    /// <summary>Keys of one transform, path, physics or slider constraint, by constraint index.</summary>
    public sealed class ConstraintTimeline
    {
        public int Constraint;
        /// <summary>Transform: 6 mixes per key. Path: position, spacing, mix (3 values). Slider: time, mix. Physics: one list per physics value (own keys), then global keys.</summary>
        public List<RawKey> Transform = new List<RawKey>(), Position = new List<RawKey>(), Spacing = new List<RawKey>(), PathMix = new List<RawKey>(), SliderTime = new List<RawKey>(), SliderMix = new List<RawKey>();
        public List<RawKey>[] Physics = NewLists(), PhysicsGlobal = NewLists();

        static List<RawKey>[] NewLists()
        {
            var l = new List<RawKey>[7];
            for (int i = 0; i < 7; i++) l[i] = new List<RawKey>();
            return l;
        }
    }

    /// <summary>A draw order key: time and (slot, offset) moves, or null to reset to the setup order.</summary>
    public sealed class DrawOrderKey
    {
        public double Time;
        public List<KeyValuePair<int, long>> Offsets;
    }

    public sealed class SkeletonAnimation
    {
        public string Name;
        public double Duration;
        public List<BoneTimeline> Bones = new List<BoneTimeline>();
        public List<SlotTimeline> Slots = new List<SlotTimeline>();
        public List<DeformTimeline> Deform = new List<DeformTimeline>();
        public List<SequenceTimeline> Sequences = new List<SequenceTimeline>();
        public List<DrawOrderKey> DrawOrder = new List<DrawOrderKey>();
        public List<EventKey> Events = new List<EventKey>();
        public List<IkTimeline> Ik = new List<IkTimeline>();
        public List<ConstraintTimeline> Constraints = new List<ConstraintTimeline>();
        /// <summary>True when the file has transform, path, physics or slider keys (gates their sampling).</summary>
        public bool HasConstraintKeys;
    }

    // ---- skeleton -----------------------------------------------------------------------------------

    /// <summary>Skeleton data, loaded once and shared by every instance.</summary>
    public sealed class SkeletonData
    {
        public string Version;
        public List<BoneData> Bones = new List<BoneData>();
        public List<SlotData> Slots = new List<SlotData>();
        public List<SkinData> Skins = new List<SkinData>();
        public List<IkData> Ik = new List<IkData>();
        public List<ConstraintData> Constraints = new List<ConstraintData>();
        public List<EventData> Events = new List<EventData>();
        public List<SkeletonAnimation> Animations = new List<SkeletonAnimation>();
        /// <summary>Interned names (attachments and images).</summary>
        public List<string> Names = new List<string>();
        public Dictionary<string, int> NameIds = new Dictionary<string, int>(StringComparer.Ordinal);
        /// <summary>Format warnings found while reading.</summary>
        public List<string> Warnings = new List<string>();

        public int Intern(string name)
        {
            if (NameIds.TryGetValue(name, out int id)) return id;
            id = Names.Count;
            Names.Add(name);
            NameIds.Add(name, id);
            return id;
        }

        public string Name(int id) => Names[id];
        public int NameId(string name) => NameIds.TryGetValue(name, out int id) ? id : -1;

        public int FindBone(string name)
        {
            for (int i = 0; i < Bones.Count; i++)
                if (Bones[i].Name == name) return i;
            return -1;
        }

        public int FindSlot(string name)
        {
            for (int i = 0; i < Slots.Count; i++)
                if (Slots[i].Name == name) return i;
            return -1;
        }

        public int FindSkin(string name)
        {
            for (int i = 0; i < Skins.Count; i++)
                if (Skins[i].Name == name) return i;
            return -1;
        }

        public int FindAnimation(string name)
        {
            for (int i = 0; i < Animations.Count; i++)
                if (Animations[i].Name == name) return i;
            return -1;
        }

        static readonly List<Attachment> NoAttachments = new List<Attachment>(0);

        /// <summary>Attachments a skin defines for a slot (-1 = the default skin).</summary>
        public List<Attachment> SkinAttachments(int slot, int skin)
        {
            if (skin < 0) return slot >= 0 && slot < Slots.Count ? Slots[slot].Attachments : NoAttachments;
            if (skin >= Skins.Count) return NoAttachments;
            foreach (var e in Skins[skin].Slots)
                if (e.Key == slot) return e.Value;
            return NoAttachments;
        }

        static Attachment FindByName(List<Attachment> list, int name)
        {
            for (int i = 0; i < list.Count; i++)
                if (list[i].Name == name) return list[i];
            return null;
        }

        /// <summary>Resolves an attachment by slot and name: skin first, then the default skin.</summary>
        public Attachment Attachment(int slot, int name, int skin)
        {
            if (name < 0) return null;
            if (skin >= 0)
            {
                var a = FindByName(SkinAttachments(slot, skin), name);
                if (a != null) return a;
            }
            if (slot < 0 || slot >= Slots.Count) return null;
            return FindByName(Slots[slot].Attachments, name);
        }

        /// <summary>The mesh holding the geometry of att: itself, or the parent of a linked mesh.</summary>
        public Attachment MeshSource(int slot, Attachment att, int activeSkin)
        {
            if (att.Kind != AttachmentKind.LinkedMesh) return att;
            string skin = att.ParentSkin;
            int skinIndex = skin != null && skin != "default" ? FindSkin(skin) : -1;
            Attachment inSkin = null;
            if (!(skin != null && skin != "default" && skinIndex < 0))
                inSkin = FindByName(SkinAttachments(slot, skinIndex), att.Parent);
            var found = inSkin ?? Attachment(slot, att.Parent, activeSkin);
            return found != null && found.Kind == AttachmentKind.Mesh ? found : null;
        }
    }
}
