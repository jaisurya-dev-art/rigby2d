// SPDX-License-Identifier: MIT OR Apache-2.0
// Binary skeleton files (".skel", format 4.3), converted to the skeleton JSON structure so one
// reader handles both. Mirrors the clean-room layout of the JavaScript runtime (src/core/binary.js):
// only encodings observed in exports are read; anything else is reported as unsupported.
// A port of runtimes/rust/rigby-runtime/src/binary.rs.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Rigby2D
{
    public static class SkeletonBinary
    {
        static readonly string[] InheritModes = { "normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection" };
        static readonly string[] BlendModes = { "normal", "additive", "multiply", "screen" };
        static readonly (string name, int count)[] BoneTimelines =
        {
            ("rotate", 1), ("translate", 2), ("translatex", 1), ("translatey", 1), ("scale", 2),
            ("scalex", 1), ("scaley", 1), ("shear", 2), ("shearx", 1), ("sheary", 1),
        };
        static readonly string[] PositionModes = { "fixed", "percent" };
        static readonly string[] SpacingModes = { "length", "fixed", "percent", "proportional" };
        static readonly string[] RotateModes = { "tangent", "chain", "chainScale" };
        static readonly string[] TransformProperties = { "rotate", "x", "y", "scaleX", "scaleY", "shearY" };
        static readonly string[] TransformOffsets = { "rotation", "x", "y", "scaleX", "scaleY", "shearY" };
        /// <summary>Mix key, the property it applies to, and the mix it defaults to (index, -1 = 1.0) when omitted.</summary>
        static readonly (string key, string property, int sameAs)[] TransformMixes =
        {
            ("mixRotate", "rotate", -1), ("mixX", "x", -1), ("mixY", "y", 1), ("mixScaleX", "scaleX", -1), ("mixScaleY", "scaleY", 3), ("mixShearY", "shearY", -1),
        };
        static readonly string[] PhysicsGlobals = { "inertia", "strength", "damping", "mass", "wind", "gravity", "mix" };
        static readonly string[] SequenceModes = { "hold", "once", "loop", null, "onceReverse" };

        static LoadException Unsupported(string what) => new LoadException($"{what} is not supported in .skel files yet; use skeleton JSON for this skeleton");

        /// <summary>The shortest decimal that encodes back to the same 32-bit float, as a double.</summary>
        internal static double Shortest(float v)
        {
            if (v == 0f) return 0.0;
            if (float.IsNaN(v) || float.IsInfinity(v)) return v;
            for (int p = 1; p <= 9; p++)
            {
                string s = v.ToString("G" + p.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
                if (float.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture) == v) return double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
            }
            return v;
        }

        static Json N(double v) => Json.Num(v);
        static Json S(string v) => Json.Str(v);

        sealed class R
        {
            public byte[] B;
            public int P;
            public List<string> Strings = new List<string>();
            public List<string> Slots = new List<string>();
            public Dictionary<string, List<string>> TransformMapped = new Dictionary<string, List<string>>();

            void Check(int n)
            {
                if (n < 0 || P + n > B.Length) throw new LoadException("unexpected end of .skel data");
            }

            public byte Byte()
            {
                Check(1);
                return B[P++];
            }

            public bool Bool() => Byte() != 0;

            public uint UInt()
            {
                Check(4);
                uint v = ((uint)B[P] << 24) | ((uint)B[P + 1] << 16) | ((uint)B[P + 2] << 8) | B[P + 3];
                P += 4;
                return v;
            }

            public double Float() => Shortest(BitConverter.Int32BitsToSingle((int)UInt()));

            public uint Varint()
            {
                uint result = 0;
                int shift = 0;
                while (true)
                {
                    byte b = Byte();
                    result |= (uint)(b & 0x7f) << (shift & 31);
                    shift += 7;
                    if ((b & 0x80) == 0 || shift >= 35) break;
                }
                return result;
            }

            public long SVarint()
            {
                uint r = Varint();
                return (int)(r >> 1) ^ -(int)(r & 1);
            }

            public string String()
            {
                int n = (int)Math.Min(Varint(), int.MaxValue);
                if (n == 0) return null;
                Check(n - 1);
                string text = new UTF8Encoding(false, false).GetString(B, P, n - 1);
                P += n - 1;
                return text;
            }

            public Json StrJson()
            {
                string s = String();
                return s != null ? Json.Str(s) : Json.Null;
            }

            public string Reference()
            {
                uint i = Varint();
                if (i == 0) return null;
                if (i - 1 >= (uint)Strings.Count) throw new LoadException("invalid string reference in .skel data");
                return Strings[(int)(i - 1)];
            }

            public Json RefJson()
            {
                string s = Reference();
                return s != null ? Json.Str(s) : Json.Null;
            }

            public string Color() => UInt().ToString("x8", CultureInfo.InvariantCulture);

            public string Color3()
            {
                Check(3);
                string hex = B[P].ToString("x2", CultureInfo.InvariantCulture) + B[P + 1].ToString("x2", CultureInfo.InvariantCulture) + B[P + 2].ToString("x2", CultureInfo.InvariantCulture);
                P += 3;
                return hex;
            }

            public string SlotName(uint i)
            {
                if (i >= (uint)Slots.Count) throw new LoadException("invalid slot index in .skel data");
                return Slots[(int)i];
            }
        }

        static Json NameAt(List<Json> list, uint i, string what)
        {
            if (i >= (uint)list.Count) throw new LoadException($"invalid {what} index in .skel data");
            return list[(int)i]["name"];
        }

        static bool IsDigit(byte c) => c >= '0' && c <= '9';

        /// <summary>True when bytes look like a binary skeleton (8-byte hash, then a version string).</summary>
        public static bool IsSkeletonBinary(byte[] bytes)
        {
            if (bytes.Length <= 9 || bytes[8] <= 1 || bytes[8] >= 64) return false;
            int len = bytes[8] - 1;
            int end = Math.Min(9 + len, bytes.Length);
            int digits = 0;
            while (9 + digits < end && IsDigit(bytes[9 + digits])) digits++;
            return digits > 0 && 9 + digits + 1 < end && bytes[9 + digits] == '.' && IsDigit(bytes[9 + digits + 1]);
        }

        /// <summary>Converts a binary skeleton into the skeleton JSON structure (4.3 field names).</summary>
        public static Json Read(byte[] bytes)
        {
            var r = new R { B = bytes, P = 8 };
            string version = r.String() ?? "";
            if (!version.StartsWith("4.3", StringComparison.Ordinal)) throw Unsupported($"Binary format {version}");
            var skeleton = Json.Obj();
            skeleton.Set(SkeletonJson.VersionField, S(version));
            foreach (var k in new[] { "x", "y", "width", "height" }) skeleton.Set(k, N(r.Float()));
            r.Float(); // reference scale
            bool nonessential = r.Bool();
            if (nonessential)
            {
                double fps = r.Float();
                if (fps != 30.0) skeleton.Set("fps", N(fps));
                skeleton.Set("images", r.StrJson());
                skeleton.Set("audio", r.StrJson());
            }
            var output = Json.Obj();
            output.Set("skeleton", skeleton);
            for (uint i = 0, n = r.Varint(); i < n; i++) r.Strings.Add(r.String());

            // Bones.
            var bones = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                var b = Json.Obj();
                b.Set("name", r.StrJson());
                if (i > 0) b.Set("parent", NameAt(bones, r.Varint(), "bone"));
                double rotation = r.Float(), x = r.Float(), y = r.Float(), scaleX = r.Float(), scaleY = r.Float(), shearX = r.Float(), shearY = r.Float();
                byte ib = r.Byte();
                string inherit = ib < InheritModes.Length ? InheritModes[ib] : "normal";
                double length = r.Float();
                if (length != 0.0) b.Set("length", N(length));
                if (rotation != 0.0) b.Set("rotation", N(rotation));
                if (x != 0.0) b.Set("x", N(x));
                if (y != 0.0) b.Set("y", N(y));
                if (scaleX != 1.0) b.Set("scaleX", N(scaleX));
                if (scaleY != 1.0) b.Set("scaleY", N(scaleY));
                if (shearX != 0.0) b.Set("shearX", N(shearX));
                if (shearY != 0.0) b.Set("shearY", N(shearY));
                if (inherit != "normal") b.Set("inherit", S(inherit));
                if (r.Bool()) b.Set("skin", Json.Bool(true));
                if (nonessential)
                {
                    r.Color();
                    r.String();
                    r.Float();
                    r.Float();
                    r.Bool();
                }
                bones.Add(b);
            }

            // Slots.
            var slots = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                var sl = Json.Obj();
                string name = r.String() ?? "";
                sl.Set("name", S(name));
                sl.Set("bone", NameAt(bones, r.Varint(), "bone"));
                string color = r.Color(), dark = r.Color();
                if (color != "ffffffff") sl.Set("color", S(color));
                if (dark != "ffffffff") sl.Set("dark", S(dark.Substring(2)));
                string a = r.Reference();
                if (a != null) sl.Set("attachment", S(a));
                byte bb = r.Byte();
                string blend = bb < BlendModes.Length ? BlendModes[bb] : "normal";
                if (blend != "normal") sl.Set("blend", S(blend));
                if (nonessential) r.Bool();
                r.Slots.Add(name);
                slots.Add(sl);
            }

            // Constraints, in application order.
            var constraints = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                byte kind = r.Byte();
                Json c;
                if (kind == 3) c = ReadPhysics(r, name, bones);
                else if (kind == 4) c = ReadSlider(r, name, bones);
                else if (kind <= 2)
                {
                    var list = new List<Json>();
                    for (uint j = 0, m = r.Varint(); j < m; j++) list.Add(NameAt(bones, r.Varint(), "bone"));
                    c = kind == 0 ? ReadIk(r, name, list, bones) : kind == 1 ? ReadPath(r, name, list, slots) : ReadTransform(r, name, list, bones);
                }
                else throw Unsupported($"Constraint type {kind} ('{name}')");
                constraints.Add(c);
            }

            // Skins: the default skin, then named skins.
            var skins = new List<Json>();
            var defaultSkin = Json.Obj();
            defaultSkin.Set("name", S("default"));
            defaultSkin.Set("attachments", ReadSkin(r, slots, nonessential));
            skins.Add(defaultSkin);
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                var skin = Json.Obj();
                skin.Set("name", r.StrJson());
                if (nonessential) r.Color();
                uint nb = r.Varint();
                if (nb > 0)
                {
                    var list = new List<Json>();
                    for (uint j = 0; j < nb; j++) list.Add(NameAt(bones, r.Varint(), "bone"));
                    skin.Set("bones", Json.Arr(list));
                }
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    uint ci = r.Varint();
                    if (ci >= (uint)constraints.Count) throw new LoadException("invalid constraint index in .skel data");
                    var c = constraints[(int)ci];
                    string kind = c.StrOr("type", "");
                    var list = new List<Json>(skin[kind].AsArray) { c["name"] };
                    skin.Set(kind, Json.Arr(list));
                }
                skin.Set("attachments", ReadSkin(r, slots, nonessential));
                skins.Add(skin);
            }
            // Linked meshes: resolve the skin index they name.
            var skinNames = skins.Select(k => k["name"]).ToList();
            foreach (var skin in skins)
            foreach (var slotAtts in skin["attachments"].Entries)
            foreach (var ae in slotAtts.Value.Entries)
            {
                var att = ae.Value;
                var idx = att.Remove("_skinIndex");
                if (idx != null && idx.AsNumber.HasValue)
                {
                    int k = Num.ToIndex(idx.AsNumber.Value);
                    att.Set("skin", k < skinNames.Count ? skinNames[k] : Json.Null);
                }
                att.Remove("_sourceSlot");
            }

            // Events.
            var events = Json.Obj();
            var eventNames = new List<string>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                var e = Json.Obj();
                long iv = r.SVarint();
                double fv = r.Float();
                string sv = r.String();
                string audio = r.String();
                if (iv != 0) e.Set("int", N(iv));
                if (fv != 0.0) e.Set("float", N(fv));
                if (!string.IsNullOrEmpty(sv)) e.Set("string", S(sv));
                if (audio != null)
                {
                    e.Set("audio", S(audio));
                    e.Set("volume", N(r.Float()));
                    e.Set("balance", N(r.Float()));
                }
                events.Set(name, e);
                eventNames.Add(name);
            }

            // Animations.
            var animations = Json.Obj();
            var animationNames = new List<string>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                animations.Set(name, ReadAnimation(r, bones, slots, constraints, skins, events, eventNames));
                animationNames.Add(name);
            }
            // Slider constraints name their animation after the animations.
            foreach (var c in constraints)
            {
                if (c["type"].AsString != "slider") continue;
                uint i = r.Varint();
                if (i >= (uint)animationNames.Count) throw new LoadException("invalid animation index in .skel data");
                c.Set("animation", S(animationNames[(int)i]));
            }
            if (r.P != bytes.Length) throw new LoadException($"unexpected data after the animations ({bytes.Length - r.P} bytes)");
            output.Set("bones", Json.Arr(bones));
            output.Set("slots", Json.Arr(slots));
            if (constraints.Count > 0) output.Set("constraints", Json.Arr(constraints));
            output.Set("skins", Json.Arr(skins));
            if (eventNames.Count > 0) output.Set("events", events);
            output.Set("animations", animations);
            return output;
        }

        /// <summary>A mix stored as two flags, "not 0" and "not 1"; a float follows only when both are set.</summary>
        static double ReadMix(R r, bool not0, bool not1) => !not0 ? 0.0 : !not1 ? 1.0 : r.Float();

        static Json ReadIk(R r, string name, List<Json> bones, List<Json> all)
        {
            var target = NameAt(all, r.Varint(), "bone");
            byte flags = r.Byte();
            if ((flags & ~(0x01 | 0x04 | 0x20 | 0x40)) != 0) throw Unsupported($"IK constraint options (flags 0x{flags:x}) on '{name}'");
            bool single = bones.Count <= 1;
            var c = Json.Obj();
            c.Set("type", S("ik"));
            c.Set("name", S(name));
            c.Set("target", target);
            c.Set("bones", Json.Arr(bones));
            if ((flags & 0x01) != 0) c.Set("skin", Json.Bool(true));
            if ((flags & 0x04) != 0 && !single) c.Set("bendPositive", Json.Bool(false));
            double mix = ReadMix(r, (flags & 0x20) != 0, (flags & 0x40) != 0);
            if (mix != 1.0) c.Set("mix", N(mix));
            return c;
        }

        static Json ReadPath(R r, string name, List<Json> bones, List<Json> slots)
        {
            var slot = NameAt(slots, r.Varint(), "slot");
            byte flags = r.Byte();
            if ((flags & ~0x3f) != 0) throw Unsupported($"Path constraint options (flags 0x{flags:x}) on '{name}'");
            var c = Json.Obj();
            c.Set("type", S("path"));
            c.Set("name", S(name));
            c.Set("slot", slot);
            c.Set("bones", Json.Arr(bones));
            if ((flags & 0x01) != 0) c.Set("skin", Json.Bool(true));
            string positionMode = PositionModes[(flags >> 1) & 1];
            string spacingMode = SpacingModes[(flags >> 2) & 3];
            int ri = (flags >> 4) & 3;
            string rotateMode = ri < RotateModes.Length ? RotateModes[ri] : "tangent";
            if (positionMode != "percent") c.Set("positionMode", S(positionMode));
            if (spacingMode != "length") c.Set("spacingMode", S(spacingMode));
            if (rotateMode != "tangent") c.Set("rotateMode", S(rotateMode));
            double position = r.Float(), spacing = r.Float();
            if (position != 0.0) c.Set("position", N(position));
            if (spacing != 0.0) c.Set("spacing", N(spacing));
            double mixRotate = r.Float(), mixX = r.Float(), mixY = r.Float();
            if (mixRotate != 1.0) c.Set("mixRotate", N(mixRotate));
            if (mixX != 1.0) c.Set("mixX", N(mixX));
            if (mixY != mixX) c.Set("mixY", N(mixY));
            return c;
        }

        static Json ReadSlider(R r, string name, List<Json> bones)
        {
            var c = Json.Obj();
            c.Set("type", S("slider"));
            c.Set("name", S(name));
            byte flags = r.Byte();
            if ((flags & (0x01 | 0x04 | 0x20)) != 0 || (flags & 0x10) == 0) throw Unsupported($"Slider constraint options (flags 0x{flags:x}) on '{name}'");
            if ((flags & 0x02) != 0) c.Set("loop", Json.Bool(true));
            c.Set("animation", Json.Null);
            if ((flags & 0x08) != 0) c.Set("time", N(r.Float()));
            if ((flags & 0x40) != 0)
            {
                c.Set("bone", NameAt(bones, r.Varint(), "bone"));
                byte pi = r.Byte();
                if (pi >= TransformProperties.Length) throw Unsupported($"Slider property on '{name}'");
                c.Set("property", S(TransformProperties[pi]));
                if (r.Float() != 0.0 || r.Float() != 0.0) throw Unsupported($"Slider property offsets on '{name}'");
                c.Set("scale", N(r.Float()));
                if ((flags & 0x80) != 0) c.Set("local", Json.Bool(true));
            }
            return c;
        }

        static Json ReadPhysics(R r, string name, List<Json> bones)
        {
            var c = Json.Obj();
            c.Set("type", S("physics"));
            c.Set("name", S(name));
            c.Set("bone", NameAt(bones, r.Varint(), "bone"));
            byte flags = r.Byte();
            if ((flags & 0x01) != 0) c.Set("skin", Json.Bool(true));
            foreach (var (bit, key) in new[] { (0x02, "x"), (0x04, "y"), (0x08, "rotate"), (0x10, "scaleX"), (0x20, "shearX") })
                if ((flags & bit) != 0) c.Set(key, N(r.Float()));
            if ((flags & 0x40) != 0) c.Set("limit", N(r.Float()));
            double fps = r.Byte();
            if (fps != 60.0) c.Set("fps", N(fps));
            foreach (var (key, def) in new[] { ("inertia", 0.5), ("strength", 100.0), ("damping", 0.85) })
            {
                double v = r.Float();
                if (v != def) c.Set(key, N(v));
            }
            if ((flags & 0x80) != 0)
            {
                // Mass is stored as its inverse.
                double inv = r.Float();
                c.Set("mass", N(Shortest((float)(1.0 / inv))));
            }
            double wind = r.Float(), gravity = r.Float();
            if (wind != 0.0) c.Set("wind", N(wind));
            if (gravity != 0.0) c.Set("gravity", N(gravity));
            byte globals = r.Byte();
            if ((globals & 0x80) != 0) throw Unsupported($"Physics constraint options (0x{globals:x}) on '{name}'");
            for (int i = 0; i < PhysicsGlobals.Length; i++)
                if ((globals & (1 << i)) != 0) c.Set(PhysicsGlobals[i] + "Global", Json.Bool(true));
            return c;
        }

        static Json ReadTransform(R r, string name, List<Json> bones, List<Json> all)
        {
            var source = NameAt(all, r.Varint(), "bone");
            byte flags = r.Byte();
            if ((flags & 0x1e) != 0) throw Unsupported($"Transform constraint options (flags 0x{flags:x}) on '{name}'");
            var c = Json.Obj();
            c.Set("type", S("transform"));
            c.Set("name", S(name));
            c.Set("source", source);
            c.Set("bones", Json.Arr(bones));
            if ((flags & 0x01) != 0) c.Set("skin", Json.Bool(true));
            var properties = Json.Obj();
            var mapped = new List<string>();
            for (int i = 0; i < flags >> 5; i++)
            {
                byte fi = r.Byte();
                if (fi >= TransformProperties.Length) throw Unsupported($"Transform property on '{name}'");
                string from = TransformProperties[fi];
                var entry = Json.Obj();
                double offset = r.Float();
                if (offset != 0.0) entry.Set("offset", N(offset));
                var toMap = Json.Obj();
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    byte ti = r.Byte();
                    if (ti >= TransformProperties.Length) throw Unsupported($"Transform property on '{name}'");
                    string to = TransformProperties[ti];
                    var target = Json.Obj();
                    double toOffset = r.Float(), max = r.Float(), scale = r.Float();
                    if (toOffset != 0.0) target.Set("offset", N(toOffset));
                    if (max != 1.0) target.Set("max", N(max));
                    if (scale != 1.0) target.Set("scale", N(scale));
                    toMap.Set(to, target);
                    if (!mapped.Contains(to)) mapped.Add(to);
                }
                entry.Set("to", toMap);
                properties.Set(from, entry);
            }
            byte offsets = r.Byte();
            if ((offsets & ~0x3f) != 0) throw Unsupported($"Transform offsets on '{name}'");
            for (int bit = 0; bit < TransformOffsets.Length; bit++)
                if ((offsets & (1 << bit)) != 0) c.Set(TransformOffsets[bit], N(r.Float()));
            c.Set("properties", properties);
            byte mixes = r.Byte();
            if ((mixes & ~0x3f) != 0) throw Unsupported($"Transform mixes on '{name}'");
            var value = new double[6];
            for (int bit = 0; bit < 6; bit++)
                if ((mixes & (1 << bit)) != 0) value[bit] = r.Float();
            for (int bit = 0; bit < TransformMixes.Length; bit++)
            {
                var (key, property, sameAs) = TransformMixes[bit];
                if (!mapped.Contains(property)) continue;
                double def = sameAs >= 0 ? value[sameAs] : 1.0;
                if (value[bit] != def) c.Set(key, N(value[bit]));
            }
            r.TransformMapped[name] = mapped;
            return c;
        }

        /// <summary>Vertex count and vertices (weighted: size hint, then bone count + bone/x/y/weight).</summary>
        static int ReadVertices(R r, Json a, bool weighted)
        {
            uint count = r.Varint();
            a.Set("vertexCount", N(count));
            var v = new List<Json>();
            if (weighted)
            {
                r.Varint();
                for (uint i = 0; i < count; i++)
                {
                    uint n = r.Varint();
                    v.Add(N(n));
                    for (uint j = 0; j < n; j++)
                    {
                        v.Add(N(r.Varint()));
                        for (int k = 0; k < 3; k++) v.Add(N(r.Float()));
                    }
                }
            }
            else
            {
                for (long i = 0; i < (long)count * 2; i++) v.Add(N(r.Float()));
            }
            a.Set("vertices", Json.Arr(v));
            return (int)Math.Min(count, int.MaxValue);
        }

        static void SetColor(Json a, string kind, string color)
        {
            string def = kind == "boundingbox" ? "60f000ff" : kind == "path" ? "ff7f00ff" : "";
            if (color != def) a.Set("color", S(color));
        }

        static Json ReadSequence(R r)
        {
            var seq = Json.Obj();
            seq.Set("count", N(r.Varint()));
            uint start = r.Varint(), digits = r.Varint(), setup = r.Varint();
            if (start != 1) seq.Set("start", N(start));
            if (digits != 0) seq.Set("digits", N(digits));
            if (setup != 0) seq.Set("setup", N(setup));
            return seq;
        }

        static Json ReadSkin(R r, List<Json> slots, bool nonessential)
        {
            var skin = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string slot = NameAt(slots, r.Varint(), "slot").AsString ?? "";
                var atts = Json.Obj();
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    string key = r.Reference() ?? "";
                    byte flags = r.Byte();
                    atts.Set(key, ReadAttachment(r, flags, key, nonessential));
                }
                skin.Set(slot, atts);
            }
            return skin;
        }

        static Json ReadAttachment(R r, byte flags, string key, bool nonessential)
        {
            int kind = flags & 0x07;
            var a = Json.Obj();
            switch (kind)
            {
                case 1:
                case 6:
                {
                    if ((flags & ~0x10) != kind) throw Unsupported($"Attachment options (flags 0x{flags:x}) on '{key}'");
                    string t = kind == 6 ? "clipping" : "boundingbox";
                    a.Set("type", S(t));
                    if (kind == 6) a.Set("end", S(r.SlotName(r.Varint())));
                    ReadVertices(r, a, (flags & 0x10) != 0);
                    if (nonessential) SetColor(a, t, r.Color());
                    return a;
                }
                case 4:
                {
                    if ((flags & ~(4 | 0x10 | 0x20 | 0x40)) != 0) throw Unsupported($"Path attachment options (flags 0x{flags:x}) on '{key}'");
                    a.Set("type", S("path"));
                    if ((flags & 0x10) != 0) a.Set("closed", Json.Bool(true));
                    if ((flags & 0x20) == 0) a.Set("constantSpeed", Json.Bool(false));
                    int count = ReadVertices(r, a, (flags & 0x40) != 0);
                    var lengths = new List<Json>();
                    for (int i = 0; i < count / 3; i++) lengths.Add(N(r.Float()));
                    a.Set("lengths", Json.Arr(lengths));
                    if (nonessential) SetColor(a, "path", r.Color());
                    return a;
                }
                case 3:
                {
                    if ((flags & ~(0x08 | 0x80 | 0x07)) != 0) throw Unsupported($"Linked mesh options (flags 0x{flags:x}) on '{key}'");
                    a.Set("type", S("linkedmesh"));
                    if ((flags & 0x08) != 0) a.Set("name", r.RefJson());
                    a.Set("_sourceSlot", N(r.Varint()));
                    uint skin = r.Varint();
                    a.Set("source", r.RefJson());
                    if (skin != 0) a.Set("_skinIndex", N(skin));
                    if ((flags & 0x80) == 0) a.Set("timelines", Json.Bool(false));
                    if (nonessential)
                    {
                        a.Set("width", N(r.Float()));
                        a.Set("height", N(r.Float()));
                    }
                    return a;
                }
                case 0:
                case 2:
                {
                    const int known = 0x08 | 0x10 | 0x20 | 0x40 | 0x80 | 0x07;
                    if ((flags & ~known) != 0) throw Unsupported($"Attachment options (flags 0x{flags:x}) on '{key}'");
                    if ((flags & 0x08) != 0) a.Set("name", r.RefJson());
                    if (kind == 2) a.Set("type", S("mesh"));
                    if ((flags & 0x10) != 0) a.Set("path", r.RefJson());
                    if ((flags & 0x20) != 0) a.Set("color", S(r.Color()));
                    if ((flags & 0x40) != 0) a.Set("sequence", ReadSequence(r));
                    if (kind == 0)
                    {
                        double rotation = (flags & 0x80) != 0 ? r.Float() : 0.0;
                        var names = new[] { "x", "y", "scaleX", "scaleY", "width", "height" };
                        var vals = new double[6];
                        for (int i = 0; i < 6; i++) vals[i] = r.Float();
                        if (rotation != 0.0) a.Set("rotation", N(rotation));
                        for (int i = 0; i < 6; i++)
                        {
                            string k = names[i];
                            double? def = k == "scaleX" || k == "scaleY" ? 1.0 : k == "x" || k == "y" ? 0.0 : (double?)null;
                            if (def != vals[i]) a.Set(k, N(vals[i]));
                        }
                        return a;
                    }
                    uint hull = r.Varint();
                    a.Set("hull", N(hull));
                    uint count = r.Varint();
                    var v = new List<Json>();
                    if ((flags & 0x80) != 0)
                    {
                        r.Varint();
                        for (uint i = 0; i < count; i++)
                        {
                            uint n = r.Varint();
                            v.Add(N(n));
                            for (uint j = 0; j < n; j++)
                            {
                                v.Add(N(r.Varint()));
                                for (int k = 0; k < 3; k++) v.Add(N(r.Float()));
                            }
                        }
                    }
                    else
                    {
                        for (long i = 0; i < (long)count * 2; i++) v.Add(N(r.Float()));
                    }
                    a.Set("vertices", Json.Arr(v));
                    var uvs = new List<Json>();
                    for (long i = 0; i < (long)count * 2; i++) uvs.Add(N(r.Float()));
                    a.Set("uvs", Json.Arr(uvs));
                    long triCount = 3 * Math.Max(2L * count - hull - 2, 0);
                    var tris = new List<Json>();
                    for (long i = 0; i < triCount; i++) tris.Add(N(r.Varint()));
                    a.Set("triangles", Json.Arr(tris));
                    if (r.Byte() != 0) throw Unsupported($"Mesh options ('{key}')");
                    if (nonessential)
                    {
                        for (uint i = 0, n = r.Varint(); i < n; i++) r.Varint();
                        a.Set("width", N(r.Float()));
                        a.Set("height", N(r.Float()));
                    }
                    return a;
                }
                default:
                    throw Unsupported($"Attachment type {kind} ('{key}')");
            }
        }

        /// <summary>Keys of n values; the curve of a segment follows the segment's second key.</summary>
        static List<Json> ReadCurveKeys(R r, uint frames, Func<R, Json, int> read)
        {
            var keys = new List<Json>();
            for (uint f = 0; f < frames; f++)
            {
                var key = Json.Obj();
                key.Set("time", N(r.Float()));
                int n = read(r, key);
                if (f > 0)
                {
                    byte kind = r.Byte();
                    var prev = keys[keys.Count - 1];
                    switch (kind)
                    {
                        case 0:
                            break;
                        case 1:
                            prev.Set("curve", S("stepped"));
                            break;
                        case 2:
                        {
                            var c = new List<Json>(4 * n);
                            for (int i = 0; i < 4 * n; i++) c.Add(N(r.Float()));
                            prev.Set("curve", Json.Arr(c));
                            break;
                        }
                        default:
                            throw new LoadException($"invalid curve type {kind}");
                    }
                }
                keys.Add(key);
            }
            foreach (var k in keys)
                if (k["time"].AsNumber == 0.0) k.Remove("time");
            return keys;
        }

        static Func<R, Json, int> OneValue(double def) => (r, key) =>
        {
            double v = r.Float();
            if (v != def) key.Set("value", N(v));
            return 1;
        };

        static string ConstraintName(List<Json> constraints, uint i)
        {
            string n = i < (uint)constraints.Count ? constraints[(int)i]["name"].AsString : null;
            if (n == null) throw new LoadException("invalid constraint index in .skel data");
            return n;
        }

        static Json GetOrNew(Json parent, string key)
        {
            var v = parent[key];
            if (!v.IsNull) return v;
            v = Json.Obj();
            parent.Set(key, v);
            return v;
        }

        static Json ReadAnimation(R r, List<Json> bones, List<Json> slots, List<Json> constraints, List<Json> skins, Json events, List<string> eventNames)
        {
            var anim = Json.Obj();
            r.Varint(); // total timeline count

            var slotTl = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string slot = NameAt(slots, r.Varint(), "slot").AsString ?? "";
                var timelines = Json.Obj();
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    byte kind = r.Byte();
                    uint frames = r.Varint();
                    switch (kind)
                    {
                        case 0:
                        {
                            var keys = new List<Json>();
                            for (uint f = 0; f < frames; f++)
                            {
                                double time = r.Float();
                                string name = r.Reference();
                                var key = Json.Obj();
                                if (time != 0.0) key.Set("time", N(time));
                                if (name != null) key.Set("name", S(name));
                                keys.Add(key);
                            }
                            timelines.Set("attachment", Json.Arr(keys));
                            break;
                        }
                        case 1:
                            r.Varint();
                            timelines.Set("rgba", Json.Arr(ReadCurveKeys(r, frames, (rr, key) =>
                            {
                                key.Set("color", S(rr.Color()));
                                return 4;
                            })));
                            break;
                        case 3:
                            r.Varint();
                            timelines.Set("rgba2", Json.Arr(ReadCurveKeys(r, frames, (rr, key) =>
                            {
                                key.Set("light", S(rr.Color()));
                                key.Set("dark", S(rr.Color3()));
                                return 7;
                            })));
                            break;
                        default:
                            throw Unsupported($"Slot timeline type {kind}");
                    }
                }
                slotTl.Set(slot, timelines);
            }
            if (slotTl.Entries.Count > 0) anim.Set("slots", slotTl);

            var boneTl = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string bone = NameAt(bones, r.Varint(), "bone").AsString ?? "";
                var timelines = Json.Obj();
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    byte kind = r.Byte();
                    uint frames = r.Varint();
                    r.Varint();
                    if (kind >= BoneTimelines.Length) throw Unsupported($"Bone timeline type {kind}");
                    var (name, count) = BoneTimelines[kind];
                    double def = name.StartsWith("scale", StringComparison.Ordinal) ? 1.0 : 0.0;
                    var keys = ReadCurveKeys(r, frames, (rr, key) =>
                    {
                        if (count == 1)
                        {
                            double v = rr.Float();
                            if (v != def) key.Set("value", N(v));
                        }
                        else
                        {
                            double x = rr.Float(), y = rr.Float();
                            if (x != def) key.Set("x", N(x));
                            if (y != def) key.Set("y", N(y));
                        }
                        return count;
                    });
                    timelines.Set(name, Json.Arr(keys));
                }
                boneTl.Set(bone, timelines);
            }
            if (boneTl.Entries.Count > 0) anim.Set("bones", boneTl);

            var ik = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = ConstraintName(constraints, r.Varint());
                uint frames = r.Varint();
                r.Varint();
                var keys = new List<Json>();
                for (uint f = 0; f < frames; f++)
                {
                    byte flags = r.Byte();
                    var key = Json.Obj();
                    double time = r.Float();
                    if (time != 0.0) key.Set("time", N(time));
                    if ((flags & 0x01) == 0) key.Set("mix", N(0.0));
                    else if ((flags & 0x02) != 0) key.Set("mix", N(r.Float()));
                    if ((flags & 0x04) != 0) key.Set("softness", N(r.Float()));
                    if ((flags & 0x08) == 0) key.Set("bendPositive", Json.Bool(false));
                    if ((flags & 0x10) != 0) key.Set("compress", Json.Bool(true));
                    if ((flags & 0x20) != 0) key.Set("stretch", Json.Bool(true));
                    if ((flags & 0x40) != 0)
                    {
                        if (f > 0) keys[keys.Count - 1].Set("curve", S("stepped"));
                    }
                    else if ((flags & 0x80) != 0)
                    {
                        var curve = new List<Json>(8);
                        for (int k = 0; k < 8; k++) curve.Add(N(r.Float()));
                        if (f > 0) keys[keys.Count - 1].Set("curve", Json.Arr(curve));
                    }
                    keys.Add(key);
                }
                ik.Set(name, Json.Arr(keys));
            }
            if (ik.Entries.Count > 0) anim.Set("ik", ik);

            var transform = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = ConstraintName(constraints, r.Varint());
                uint frames = r.Varint();
                r.Varint();
                var mapped = r.TransformMapped.TryGetValue(name, out var m) ? m : TransformProperties.ToList();
                var keys = ReadCurveKeys(r, frames, (rr, key) =>
                {
                    foreach (var (mix, property, _) in TransformMixes)
                    {
                        double v = rr.Float();
                        if (v != 1.0 && mapped.Contains(property)) key.Set(mix, N(v));
                    }
                    return 6;
                });
                transform.Set(name, Json.Arr(keys));
            }
            if (transform.Entries.Count > 0) anim.Set("transform", transform);

            // Path, physics and slider keys.
            var path = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = ConstraintName(constraints, r.Varint());
                var entry = Json.Obj();
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    byte code = r.Byte();
                    if (code != 0) throw Unsupported($"Path constraint key type {code}");
                    uint frames = r.Varint();
                    r.Varint();
                    entry.Set("position", Json.Arr(ReadCurveKeys(r, frames, OneValue(0.0))));
                }
                path.Set(name, entry);
            }
            if (path.Entries.Count > 0) anim.Set("path", path);

            var physics = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                uint index = r.Varint();
                string name = index == 0 ? "" : ConstraintName(constraints, index - 1);
                var entry = GetOrNew(physics, name);
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    byte code = r.Byte();
                    if (code != 5) throw Unsupported($"Physics key type {code}");
                    uint frames = r.Varint();
                    r.Varint();
                    entry.Set("wind", Json.Arr(ReadCurveKeys(r, frames, OneValue(0.0))));
                }
            }
            if (physics.Entries.Count > 0) anim.Set("physics", physics);

            var slider = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = ConstraintName(constraints, r.Varint());
                var entry = Json.Obj();
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    byte code = r.Byte();
                    if (code != 1) throw Unsupported($"Slider key type {code}");
                    uint frames = r.Varint();
                    r.Varint();
                    entry.Set("mix", Json.Arr(ReadCurveKeys(r, frames, OneValue(1.0))));
                }
                slider.Set(name, entry);
            }
            if (slider.Entries.Count > 0) anim.Set("slider", slider);

            var attachments = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                uint ki = r.Varint();
                string skin = ki < (uint)skins.Count ? skins[(int)ki]["name"].AsString : null;
                if (skin == null) throw new LoadException("invalid skin index in .skel data");
                var skinEntry = GetOrNew(attachments, skin);
                for (uint j = 0, m = r.Varint(); j < m; j++)
                {
                    string slot = r.SlotName(r.Varint());
                    var slotEntry = GetOrNew(skinEntry, slot);
                    for (uint q = 0, qn = r.Varint(); q < qn; q++)
                    {
                        string att = r.Reference() ?? "";
                        byte kind = r.Byte();
                        uint frames = r.Varint();
                        var timelines = GetOrNew(slotEntry, att);
                        switch (kind)
                        {
                            case 0:
                            {
                                r.Varint();
                                var keys = new List<Json>();
                                for (uint f = 0; f < frames; f++)
                                {
                                    var key = Json.Obj();
                                    double time = r.Float();
                                    if (time != 0.0) key.Set("time", N(time));
                                    if (f > 0)
                                    {
                                        byte c = r.Byte();
                                        var prev = keys[keys.Count - 1];
                                        switch (c)
                                        {
                                            case 0:
                                                break;
                                            case 1:
                                                prev.Set("curve", S("stepped"));
                                                break;
                                            case 2:
                                            {
                                                var cv = new List<Json>(4);
                                                for (int k = 0; k < 4; k++) cv.Add(N(r.Float()));
                                                prev.Set("curve", Json.Arr(cv));
                                                break;
                                            }
                                            default:
                                                throw new LoadException($"invalid curve type {c}");
                                        }
                                    }
                                    uint count = r.Varint();
                                    if (count > 0)
                                    {
                                        uint offset = r.Varint();
                                        if (offset != 0) key.Set("offset", N(offset));
                                        var v = new List<Json>((int)Math.Min(count, 1u << 20));
                                        for (uint k = 0; k < count; k++) v.Add(N(r.Float()));
                                        key.Set("vertices", Json.Arr(v));
                                    }
                                    keys.Add(key);
                                }
                                timelines.Set("deform", Json.Arr(keys));
                                break;
                            }
                            case 1:
                            {
                                var keys = new List<Json>();
                                double lastDelay = 0.0;
                                for (uint f = 0; f < frames; f++)
                                {
                                    var key = Json.Obj();
                                    double time = r.Float();
                                    uint modeIndex = r.UInt();
                                    double delay = r.Float();
                                    uint mi = modeIndex & 0x0f;
                                    string mode = mi < (uint)SequenceModes.Length ? SequenceModes[mi] : null;
                                    if (mode == null) throw Unsupported($"Sequence mode {mi}");
                                    if (time != 0.0) key.Set("time", N(time));
                                    if (mode != "hold") key.Set("mode", S(mode));
                                    if (modeIndex >> 4 != 0) key.Set("index", N(modeIndex >> 4));
                                    if (delay != lastDelay) key.Set("delay", N(delay));
                                    lastDelay = delay;
                                    keys.Add(key);
                                }
                                timelines.Set("sequence", Json.Arr(keys));
                                break;
                            }
                            default:
                                throw Unsupported($"Attachment timeline type {kind}");
                        }
                    }
                }
            }
            if (attachments.Entries.Count > 0) anim.Set("attachments", attachments);

            var draw = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                var key = Json.Obj();
                double time = r.Float();
                if (time != 0.0) key.Set("time", N(time));
                uint count = r.Varint();
                if (count > 0)
                {
                    var offsets = new List<Json>();
                    for (uint k = 0; k < count; k++)
                    {
                        var o = Json.Obj();
                        o.Set("slot", NameAt(slots, r.Varint(), "slot"));
                        o.Set("offset", N((int)r.Varint()));
                        offsets.Add(o);
                    }
                    key.Set("offsets", Json.Arr(offsets));
                }
                draw.Add(key);
            }
            if (draw.Count > 0) anim.Set("drawOrder", Json.Arr(draw));
            if (r.Varint() != 0) throw Unsupported("An unknown animation section");
            var ev = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                double time = r.Float();
                var key = Json.Obj();
                if (time != 0.0) key.Set("time", N(time));
                uint ni = r.Varint();
                string name = ni < (uint)eventNames.Count ? eventNames[(int)ni] : "";
                key.Set("name", S(name));
                long iv = r.SVarint();
                double fv = r.Float();
                var def = events[name];
                if (iv != def.Num("int", 0)) key.Set("int", N(iv));
                if (fv != def.Num("float", 0)) key.Set("float", N(fv));
                if (r.Bool()) key.Set("string", r.StrJson());
                if (def.Truthy("audio"))
                {
                    key.Set("volume", N(r.Float()));
                    key.Set("balance", N(r.Float()));
                }
                ev.Add(key);
            }
            if (ev.Count > 0) anim.Set("events", Json.Arr(ev));
            r.Color();
            return anim;
        }
    }
}
