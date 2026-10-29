// SPDX-License-Identifier: MIT OR Apache-2.0
// Reads skeleton JSON (formats 3.8, 4.x; binary .skel files are first converted to the same
// structure by SkeletonBinary.Read) into SkeletonData.
// A port of runtimes/rust/rigby-runtime/src/reader.rs.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Rigby2D
{
    /// <summary>A skeleton or scene file could not be loaded.</summary>
    public sealed class LoadException : Exception
    {
        public LoadException(string message) : base(message) { }
        public LoadException(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>Number conversions that behave like Rust's: saturating, NaN to 0, max ignoring NaN.</summary>
    internal static class Num
    {
        public static int ToIndex(double v) => double.IsNaN(v) || v <= 0 ? 0 : v >= int.MaxValue ? int.MaxValue : (int)v;
        public static long ToLong(double v) => double.IsNaN(v) ? 0 : v <= long.MinValue ? long.MinValue : v >= long.MaxValue ? long.MaxValue : (long)v;
        public static double Max(double a, double b) => double.IsNaN(a) ? b : double.IsNaN(b) ? a : Math.Max(a, b);
        public static double Min(double a, double b) => double.IsNaN(a) ? b : double.IsNaN(b) ? a : Math.Min(a, b);
    }

    public static class SkeletonJson
    {
        /// <summary>Name of the skeleton header field holding the format version (fixed by the file format).</summary>
        public const string VersionField = "spine";

        /// <summary>True when obj looks like a skeleton JSON file.</summary>
        public static bool IsSkeletonJson(Json obj) => obj["skeleton"].IsObject && obj["bones"].IsArray;

        /// <summary>JavaScript Math.round.</summary>
        static double JsRound(double v) => Math.Floor(v + 0.5);

        static double Round5(double v) => JsRound(v * 1e5) / 1e5;

        static bool IsHex(char c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');

        /// <summary>Parses "rrggbb" or "rrggbbaa" into 0..1 components; def when invalid. A 6-digit color gets alpha 1 when def has 4 components.</summary>
        public static double[] HexToColor(Json hex, double[] def)
        {
            string s = hex.AsString;
            if (s == null || !(s.Length == 6 || s.Length == 8) || !s.All(IsHex)) return (double[])def.Clone();
            int n = s.Length / 2;
            var c = new double[n == 3 && def.Length == 4 ? 4 : n];
            for (int i = 0; i < n; i++) c[i] = int.Parse(s.Substring(i * 2, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture) / 255.0;
            if (c.Length == 4 && n == 3) c[3] = 1.0;
            return c;
        }

        static Color4 ToColor4(double[] v) => new Color4(v.Length > 0 ? v[0] : 1, v.Length > 1 ? v[1] : 1, v.Length > 2 ? v[2] : 1, v.Length > 3 ? v[3] : 1);

        static readonly double[] White = { 1, 1, 1, 1 };
        static readonly double[] White3 = { 1, 1, 1 };
        static readonly double[] Black3 = { 0, 0, 0 };

        static Color4 DefaultAttachmentColor(string kind)
        {
            string hex;
            switch (kind)
            {
                case "boundingbox": hex = "60F000FF"; break;
                case "path": hex = "FF7F00FF"; break;
                case "point": hex = "F1F100FF"; break;
                case "clipping": hex = "CE3A3AFF"; break;
                default: return Color4.White;
            }
            return ToColor4(HexToColor(Json.Str(hex), White));
        }

        static double[] Nums(Json v)
        {
            var list = v.AsArray;
            var o = new double[list.Count];
            for (int i = 0; i < o.Length; i++) o[i] = list[i].AsNumber ?? 0.0;
            return o;
        }

        static double[] ToArray(Color4 c) => new[] { c.R, c.G, c.B, c.A };

        /// <summary>Splits a packed vertex array into plain floats or per-vertex weights.</summary>
        static Vertices DecodeVertices(Json vertices, int count)
        {
            if (!vertices.IsArray) return new Vertices { Plain = new double[0] };
            var v = Nums(vertices);
            if (v.Length <= count * 2) return new Vertices { Plain = v };
            var weights = new List<Weight[]>();
            int i = 0;
            while (i < v.Length && weights.Count < count)
            {
                int n = Num.ToIndex(v[i]);
                i++;
                var w = new List<Weight>(Math.Min(n, 64));
                for (int k = 0; k < n; k++)
                {
                    if (i + 3 >= v.Length) break;
                    w.Add(new Weight { Bone = Num.ToIndex(v[i]), X = v[i + 1], Y = v[i + 2], W = v[i + 3] });
                    i += 4;
                }
                weights.Add(w.ToArray());
            }
            return new Vertices { Weighted = weights.ToArray() };
        }

        sealed class Ctx
        {
            public bool V4;
            public Dictionary<string, int> Bones = new Dictionary<string, int>(StringComparer.Ordinal);
            public Dictionary<string, int> Slots = new Dictionary<string, int>(StringComparer.Ordinal);

            public int Bone(Json name)
            {
                string n = name.AsString ?? "";
                if (!Bones.TryGetValue(n, out int i)) throw new LoadException($"unknown bone '{n}'");
                return i;
            }

            public int Slot(Json name) => Slot(name.AsString ?? "");

            public int Slot(string n)
            {
                if (!Slots.TryGetValue(n, out int i)) throw new LoadException($"unknown slot '{n}'");
                return i;
            }

            public int BoneOrMissing(Json name)
            {
                string n = name.AsString;
                return n != null && Bones.TryGetValue(n, out int i) ? i : -1;
            }
        }

        /// <summary>Converts a parsed skeleton JSON file into SkeletonData.</summary>
        public static SkeletonData Read(Json obj)
        {
            if (!IsSkeletonJson(obj)) throw new LoadException("not a skeleton JSON file");
            var header = obj["skeleton"];
            var hv = header[VersionField];
            string versionText = hv.Type == JsonType.Str ? hv.AsString : hv.Type == JsonType.Num ? FormatNumber(hv.AsNumber.Value) : "3.8";
            string first = versionText.Split('.')[0];
            double major = double.TryParse(first, NumberStyles.Float, CultureInfo.InvariantCulture, out double mj) ? mj : 3.0;
            bool v4 = (major == 0.0 ? 3.0 : major) >= 4.0;

            var sk = new SkeletonData { Version = hv.AsString };
            var ctx = new Ctx { V4 = v4 };

            // Bones.
            var bones = obj["bones"].AsArray;
            for (int i = 0; i < bones.Count; i++)
            {
                var b = bones[i];
                string name = b.StrOr("name", "");
                int parent = -1;
                var p = b["parent"];
                if (!p.IsNull)
                {
                    string pn = p.AsString ?? "";
                    if (!ctx.Bones.TryGetValue(pn, out parent)) throw new LoadException($"bone '{name}' references unknown parent '{pn}'");
                }
                ctx.Bones[name] = i;
                string inherit = b["inherit"].AsString ?? b["transform"].AsString ?? "normal";
                InheritNames.TryParse(inherit, out var inh);
                sk.Bones.Add(new BoneData
                {
                    Name = name,
                    Parent = parent,
                    Length = b.Num("length", 0),
                    Setup = new Transform2(b.Num("x", 0), b.Num("y", 0), b.Num("rotation", 0), b.Num("scaleX", 1), b.Num("scaleY", 1), b.Num("shearX", 0), b.Num("shearY", 0)),
                    Inherit = inh,
                    SkinRequired = b.Truthy("skin"),
                });
            }

            // Slots.
            var slots = obj["slots"].AsArray;
            for (int i = 0; i < slots.Count; i++)
            {
                var s = slots[i];
                string name = s.StrOr("name", "");
                ctx.Slots[name] = i;
                int bone = ctx.Bone(s["bone"]);
                string attName = s["attachment"].AsString;
                var slot = new SlotData
                {
                    Name = name,
                    Bone = bone,
                    Attachment = attName != null ? sk.Intern(attName) : -1,
                    Color = ToColor4(HexToColor(s["color"], White)),
                    Blend = BlendNames.Parse(s.StrOr("blend", "normal")),
                };
                if (s.Truthy("dark"))
                {
                    var d = HexToColor(s["dark"], Black3);
                    slot.HasDark = true;
                    slot.Dark = new Color4(d[0], d[1], d[2], 1);
                }
                sk.Slots.Add(slot);
            }

            // IK constraints; the others are compiled once animations are known (sliders name one).
            bool unified = obj["constraints"].IsArray;
            var ikSource = new List<KeyValuePair<Json, double>>();
            if (unified)
            {
                var list = obj["constraints"].AsArray;
                for (int i = 0; i < list.Count; i++)
                    if (list[i]["type"].AsString == "ik") ikSource.Add(new KeyValuePair<Json, double>(list[i], list[i].Num("order", i)));
            }
            else
            {
                var list = obj["ik"].AsArray;
                for (int i = 0; i < list.Count; i++) ikSource.Add(new KeyValuePair<Json, double>(list[i], list[i].Num("order", i)));
            }
            foreach (var e in ikSource)
            {
                var c = e.Key;
                sk.Ik.Add(new IkData
                {
                    Name = c.StrOr("name", ""),
                    Order = e.Value,
                    SkinRequired = c.Truthy("skin"),
                    Bones = c["bones"].AsArray.Select(ctx.Bone).ToArray(),
                    Target = ctx.Bone(c["target"]),
                    Mix = c.Num("mix", 1),
                    Softness = c.Num("softness", 0),
                    BendPositive = c.Flag("bendPositive", true),
                    Compress = c.Truthy("compress"),
                    Stretch = c.Truthy("stretch"),
                    Uniform = c.Truthy("uniform"),
                });
            }
            var ikIndex = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < sk.Ik.Count; i++) ikIndex[sk.Ik[i].Name] = i;
            if (unified)
            {
                int skipped = obj["constraints"].AsArray.Count(c =>
                {
                    string t = c["type"].AsString;
                    return !(t == "ik" || t == "transform" || t == "path" || t == "physics" || t == "slider");
                });
                if (skipped > 0) sk.Warnings.Add($"{skipped} constraint(s) of unknown types are kept but not evaluated");
            }

            // Skins (an array since 3.8; a map of skin name -> slots before).
            var skinsJson = obj["skins"];
            bool skinsAreArray = skinsJson.IsArray;
            var skins = new List<KeyValuePair<string, Json>>();
            if (skinsAreArray)
                foreach (var s in skinsJson.AsArray) skins.Add(new KeyValuePair<string, Json>(s.StrOr("name", ""), s));
            else
                foreach (var e in skinsJson.Entries) skins.Add(e);
            foreach (var e in skins)
            {
                string skinName = e.Key;
                var skin = e.Value;
                var attachments = skinsAreArray ? skin["attachments"] : skin;
                var entries = new List<KeyValuePair<int, List<Attachment>>>();
                foreach (var se in attachments.Entries)
                {
                    int s = ctx.Slot(se.Key);
                    var list = new List<Attachment>();
                    foreach (var ae in se.Value.Entries) list.Add(ReadAttachment(sk, ctx, ae.Key, ae.Value));
                    if (skinName == "default") sk.Slots[s].Attachments.AddRange(list);
                    else entries.Add(new KeyValuePair<int, List<Attachment>>(s, list));
                }
                if (skinName == "default") continue;
                var data = new SkinData { Name = skinName, Slots = entries };
                if (skinsAreArray)
                {
                    foreach (var key in new[] { "constraints", "transform", "path", "physics" })
                    foreach (var n in skin[key].AsArray)
                        if (n.AsString != null) data.Constraints.Add(n.AsString);
                    foreach (var b in skin["bones"].AsArray) data.Bones.Add(ctx.Bone(b));
                    foreach (var n in skin["ik"].AsArray)
                        if (n.AsString != null && ikIndex.TryGetValue(n.AsString, out int k)) data.Ik.Add(k);
                }
                sk.Skins.Add(data);
            }

            // Events.
            foreach (var e in obj["events"].Entries)
            {
                var ev = e.Value;
                sk.Events.Add(new EventData
                {
                    Name = e.Key,
                    Int = Num.ToLong(ev.Num("int", 0)),
                    Float = ev.Num("float", 0),
                    String = ev["string"].AsString,
                    Audio = ev["audio"].AsString,
                    Volume = ev.Num("volume", 1),
                    Balance = ev.Num("balance", 0),
                });
            }

            // Constraints other than IK (compiled; sliders need the animation names).
            var animationNames = obj["animations"].Entries.Select(e => e.Key).ToList();
            CompileConstraints(sk, obj, ctx, animationNames);

            // Animations.
            foreach (var e in obj["animations"].Entries) sk.Animations.Add(ReadAnimation(sk, ctx, ikIndex, e.Key, e.Value));
            Validate(sk);
            return sk;
        }

        /// <summary>Like Rust's f64 Display: shortest round-trip form, no exponent for ordinary values.</summary>
        static string FormatNumber(double n) => n == Math.Floor(n) && Math.Abs(n) < 1e15 ? ((long)n).ToString(CultureInfo.InvariantCulture) : n.ToString("R", CultureInfo.InvariantCulture);

        static void Validate(SkeletonData sk)
        {
            if (sk.Bones.Count == 0) throw new LoadException("skeleton has no bones");
            for (int i = 0; i < sk.Bones.Count; i++)
            {
                var b = sk.Bones[i];
                if (b.Parent >= i) throw new LoadException($"bone '{b.Name}' comes before its parent");
            }
        }

        static Transform2 ReadTransformOffset(Json a) => new Transform2(a.Num("x", 0), a.Num("y", 0), a.Num("rotation", 0), a.Num("scaleX", 1), a.Num("scaleY", 1), 0, 0);

        static bool IsFalseOrZero(Json j) => (j.Type == JsonType.Bool && j.AsBool == false) || (j.Type == JsonType.Num && j.AsNumber == 0.0);

        static Attachment ReadAttachment(SkeletonData sk, Ctx ctx, string key, Json a)
        {
            string kindName = a.StrOr("type", "region");
            string imageName = a["path"].AsString ?? a["name"].AsString ?? key;
            var att = new Attachment { Color = ToColor4(HexToColor(a["color"], ToArray(DefaultAttachmentColor(kindName)))) };
            switch (kindName)
            {
                case "region":
                    att.Kind = AttachmentKind.Region;
                    att.Offset = ReadTransformOffset(a);
                    att.Width = a.Num("width", 0);
                    att.Height = a.Num("height", 0);
                    break;
                case "point":
                    att.Kind = AttachmentKind.Point;
                    att.Offset = ReadTransformOffset(a);
                    break;
                case "mesh":
                {
                    var uvs = Nums(a["uvs"]);
                    att.Kind = AttachmentKind.Mesh;
                    att.Triangles = a["triangles"].AsArray.Select(t => Num.ToIndex(t.AsNumber ?? 0)).ToArray();
                    att.Hull = Num.ToIndex(a.Num("hull", 0));
                    att.Vertices = DecodeVertices(a["vertices"], uvs.Length / 2);
                    att.Width = a.Num("width", 0);
                    att.Height = a.Num("height", 0);
                    att.Uvs = uvs;
                    break;
                }
                case "linkedmesh":
                {
                    string parent = a["parent"].AsString ?? a["source"].AsString ?? "";
                    Json d = a["deform"], t = a["timelines"];
                    att.Kind = AttachmentKind.LinkedMesh;
                    att.Deform = d.IsNull ? (t.IsNull || !IsFalseOrZero(t)) : !IsFalseOrZero(d);
                    att.Parent = sk.Intern(parent);
                    att.ParentSkin = a["skin"].AsString;
                    att.Width = a.Num("width", 0);
                    att.Height = a.Num("height", 0);
                    break;
                }
                case "boundingbox":
                case "path":
                case "clipping":
                {
                    int count = Num.ToIndex(a.Num("vertexCount", 0));
                    att.Vertices = DecodeVertices(a["vertices"], count);
                    if (kindName == "boundingbox") att.Kind = AttachmentKind.BoundingBox;
                    else if (kindName == "path")
                    {
                        att.Kind = AttachmentKind.Path;
                        att.Closed = a.Truthy("closed");
                        att.ConstantSpeed = a.Flag("constantSpeed", true);
                        att.Lengths = Nums(a["lengths"]);
                    }
                    else
                    {
                        att.Kind = AttachmentKind.Clipping;
                        att.End = a["end"].IsNull ? -1 : ctx.Slot(a["end"]);
                    }
                    break;
                }
                default:
                    throw new LoadException($"unknown attachment type '{kindName}' ('{key}')");
            }
            att.Image = sk.Intern(imageName);
            if (a["sequence"].IsObject)
            {
                var s = a["sequence"];
                long count = Num.ToLong(s.Num("count", 1));
                long start = Num.ToLong(s.Num("start", 1));
                int digits = Num.ToIndex(s.Num("digits", 0));
                long frames = Math.Max(count, 1);
                if (frames > 100000) throw new LoadException($"sequence of '{key}' has too many frames ({count})");
                var ids = new int[frames];
                for (long i = 0; i < frames; i++) ids[i] = sk.Intern(imageName + PadNumber(start + i, digits));
                att.Sequence = new Sequence { Count = count, Start = start, Digits = digits, Setup = Num.ToLong(s.Num("setup", 0)), Frames = ids };
            }
            att.Name = sk.Intern(key);
            return att;
        }

        /// <summary>Like Rust's format!("{:0>width$}", n): the number's text left-padded with zeros.</summary>
        internal static string PadNumber(long n, int digits)
        {
            string t = n.ToString(CultureInfo.InvariantCulture);
            return t.Length >= digits ? t : new string('0', digits - t.Length) + t;
        }

        // ---- constraints --------------------------------------------------------------------------------

        static readonly string[] PropNames = { "rotate", "x", "y", "scaleX", "scaleY", "shearY" };
        static readonly string[] OffsetFields = { "rotation", "x", "y", "scaleX", "scaleY", "shearY" };

        static int PropIndex(string name) => Array.IndexOf(PropNames, name);

        static void CompileConstraints(SkeletonData sk, Json obj, Ctx ctx, List<string> animationNames)
        {
            var entries = new List<(Json d, string t, double order)>();
            if (obj["constraints"].IsArray)
            {
                var list = obj["constraints"].AsArray;
                for (int i = 0; i < list.Count; i++)
                {
                    string t = list[i].StrOr("type", "");
                    if (t != "ik") entries.Add((list[i], t, i));
                }
            }
            foreach (var t in new[] { "transform", "path", "physics" })
            {
                var list = obj[t].AsArray;
                for (int i = 0; i < list.Count; i++) entries.Add((list[i], t, list[i].Num("order", i)));
            }
            foreach (var (d, t, order) in entries)
            {
                string name = d.StrOr("name", "");
                bool skinRequired = d.Truthy("skin");
                switch (t)
                {
                    case "slider":
                    {
                        string an = d["animation"].AsString;
                        int animation = an != null ? animationNames.IndexOf(an) : -1;
                        if (animation < 0) continue;
                        int bone = -1;
                        if (!d["bone"].IsNull)
                        {
                            bone = ctx.BoneOrMissing(d["bone"]);
                            if (bone < 0) continue;
                        }
                        Property property;
                        switch (d.StrOr("property", "rotate"))
                        {
                            case "x": property = Property.X; break;
                            case "y": property = Property.Y; break;
                            case "scaleX": property = Property.ScaleX; break;
                            case "scaleY": property = Property.ScaleY; break;
                            case "shearY": property = Property.ShearY; break;
                            default: property = Property.Rotate; break;
                        }
                        sk.Constraints.Add(new ConstraintData
                        {
                            Name = name,
                            Order = order,
                            SkinRequired = skinRequired,
                            Bones = bone >= 0 ? new[] { bone } : new int[0],
                            Kind = ConstraintKind.Slider,
                            Slider = new SliderData
                            {
                                Animation = animation,
                                Bone = bone,
                                Property = property,
                                Scale = d.Num("scale", 1),
                                Offset = d.Num("offset", 0),
                                Local = d.Truthy("local"),
                                Looping = d.Truthy("loop"),
                                Additive = d.Truthy("additive"),
                                Setup = new[] { d.Num("time", 0), d.Num("mix", 1) },
                            },
                        });
                        break;
                    }
                    case "physics":
                    {
                        int bone = ctx.BoneOrMissing(d["bone"]);
                        if (bone < 0) continue;
                        var pd = new PhysicsData
                        {
                            Bone = bone,
                            X = d.Num("x", 0),
                            Y = d.Num("y", 0),
                            Rotate = d.Num("rotate", 0),
                            ScaleX = d.Num("scaleX", 0),
                            ShearX = d.Num("shearX", 0),
                            Limit = d.Num("limit", 5000),
                            Fps = d.Num("fps", 60),
                            Setup = new[] { d.Num("inertia", 0.5), d.Num("strength", 100), d.Num("damping", 0.85), d.Num("mass", 1), d.Num("wind", 0), d.Num("gravity", 0), d.Num("mix", 1) },
                        };
                        for (int i = 0; i < 7; i++) pd.Globals[i] = d.Truthy(PhysicsData.Values[i] + "Global");
                        sk.Constraints.Add(new ConstraintData { Name = name, Order = order, SkinRequired = skinRequired, Bones = new[] { bone }, Kind = ConstraintKind.Physics, Physics = pd });
                        break;
                    }
                    case "transform":
                    case "path":
                    {
                        var list = d["bones"].AsArray;
                        if (list.Count == 0) continue;
                        var bones = new int[list.Count];
                        bool missing = false;
                        for (int i = 0; i < list.Count; i++)
                        {
                            bones[i] = ctx.BoneOrMissing(list[i]);
                            if (bones[i] < 0) missing = true;
                        }
                        if (missing) continue;
                        if (t == "transform")
                        {
                            int source = ctx.BoneOrMissing(d.Has("source") ? d["source"] : d["target"]);
                            if (source < 0) continue;
                            sk.Constraints.Add(new ConstraintData { Name = name, Order = order, SkinRequired = skinRequired, Bones = bones, Kind = ConstraintKind.Transform, Transform = TransformDataOf(d, source) });
                        }
                        else
                        {
                            string slotName = (d.Has("slot") ? d["slot"] : d["target"]).AsString;
                            if (slotName == null || !ctx.Slots.TryGetValue(slotName, out int slot)) continue;
                            sk.Constraints.Add(new ConstraintData { Name = name, Order = order, SkinRequired = skinRequired, Bones = bones, Kind = ConstraintKind.Path, Path = PathDataOf(d, slot) });
                        }
                        break;
                    }
                }
            }
        }

        static TransformData TransformDataOf(Json d, int source)
        {
            bool legacy = d.Has("rotateMix") || d.Has("translateMix") || d.Has("scaleMix") || d.Has("shearMix");
            var td = new TransformData { Source = source };
            for (int i = 0; i < Props.Count; i++) td.Offsets[i] = d.Num(OffsetFields[i], 0);
            if (legacy)
            {
                double tm = d.Num("translateMix", 1), sm = d.Num("scaleMix", 1);
                td.Mix = new[] { d.Num("rotateMix", 1), tm, tm, sm, sm, d.Num("shearMix", 1) };
            }
            else
            {
                double x = d.Num("mixX", 1), sx = d.Num("mixScaleX", 1);
                td.Mix = new[] { d.Num("mixRotate", 1), x, d.Num("mixY", x), sx, d.Num("mixScaleY", sx), d.Num("mixShearY", 1) };
            }
            if (d["properties"].IsObject)
            {
                foreach (var pe in d["properties"].Entries)
                {
                    int from = PropIndex(pe.Key);
                    if (from < 0) continue;
                    var to = new List<PropTarget>();
                    foreach (var te in pe.Value["to"].Entries)
                    {
                        int prop = PropIndex(te.Key);
                        if (prop < 0) continue;
                        to.Add(new PropTarget { Prop = prop, Offset = te.Value.Num("offset", 0), Max = te.Value.Num("max", 1), Scale = te.Value.Num("scale", 1) });
                    }
                    td.PropMaps.Add(new PropMap { From = from, Offset = pe.Value.Num("offset", 0), To = to.ToArray() });
                }
            }
            else
            {
                for (int p = 0; p < Props.Count; p++)
                    td.PropMaps.Add(new PropMap { From = p, Offset = 0, To = new[] { new PropTarget { Prop = p, Offset = 0, Max = 1, Scale = 1 } } });
            }
            bool local = d.Truthy("local");
            td.LocalSource = d.Flag("localSource", local);
            td.LocalTarget = d.Flag("localTarget", local);
            td.Additive = d.Has("additive") ? d.Truthy("additive") : d.Truthy("relative");
            td.Clamp = d.Truthy("clamp");
            return td;
        }

        static PathData PathDataOf(Json d, int slot)
        {
            bool legacy = d.Has("rotateMix") || d.Has("translateMix");
            double x = legacy ? d.Num("translateMix", 1) : d.Num("mixX", 1);
            SpacingMode spacing;
            switch (d.StrOr("spacingMode", "length"))
            {
                case "fixed": spacing = SpacingMode.Fixed; break;
                case "percent": spacing = SpacingMode.Percent; break;
                case "proportional": spacing = SpacingMode.Proportional; break;
                default: spacing = SpacingMode.Length; break;
            }
            RotateMode rotate;
            switch (d.StrOr("rotateMode", "tangent"))
            {
                case "chain": rotate = RotateMode.Chain; break;
                case "chainScale": rotate = RotateMode.ChainScale; break;
                default: rotate = RotateMode.Tangent; break;
            }
            return new PathData
            {
                Slot = slot,
                PositionMode = d.StrOr("positionMode", "percent") == "fixed" ? PositionMode.Fixed : PositionMode.Percent,
                SpacingMode = spacing,
                RotateMode = rotate,
                OffsetRotation = d.Num("rotation", 0),
                Setup = new PathState
                {
                    Position = d.Num("position", 0),
                    Spacing = d.Num("spacing", 0),
                    MixRotate = legacy ? d.Num("rotateMix", 1) : d.Num("mixRotate", 1),
                    MixX = x,
                    MixY = legacy ? x : d.Num("mixY", x),
                },
            };
        }

        // ---- curves and keys -----------------------------------------------------------------------------

        /// <summary>Reads a key's curve. 3.8 uses normalized values; 4.x per-value absolute control points.</summary>
        static Curve ReadCurve(Json key, Json next, double[] values, double[] nextValues, bool v4)
        {
            var c = key["curve"];
            switch (c.Type)
            {
                case JsonType.Str:
                    return c.AsString == "stepped" ? Curve.Stepped : Curve.Linear;
                case JsonType.Num:
                    return Curve.Bezier(c.AsNumber.Value, key.Num("c2", 0), key.Num("c3", 1), key.Num("c4", 1));
                case JsonType.Arr:
                {
                    var n = Nums(c);
                    if (!v4 && n.Length == 4) return Curve.Bezier(n[0], n[1], n[2], n[3]);
                    if (next == null) return Curve.Linear;
                    return NormalizeCurve(n, key.Num("time", 0), next.Num("time", 0), values, nextValues);
                }
                default:
                    return Curve.Linear;
            }
        }

        static double[] R5(double[] b) => new[] { Round5(b[0]), Round5(b[1]), Round5(b[2]), Round5(b[3]) };

        static Curve NormalizeCurve(double[] c, double t1, double t2, double[] values, double[] nextValues)
        {
            double dt = t2 - t1 != 0.0 ? t2 - t1 : 1.0;
            // A component whose value does not change has no meaningful curve; it takes the shape of the others.
            var beziers = new List<double[]>();
            int i = 0;
            while (i + 3 < c.Length && beziers.Count < values.Length)
            {
                double v1 = values[beziers.Count];
                double dv = (beziers.Count < nextValues.Length ? nextValues[beziers.Count] : double.NaN) - v1;
                if (Math.Abs(dv) <= 1e-9) beziers.Add(null);
                else beziers.Add(new[] { (c[i] - t1) / dt, (c[i + 1] - v1) / dv, (c[i + 2] - t1) / dt, (c[i + 3] - v1) / dv });
                i += 4;
            }
            if (beziers.Count == 0) return Curve.Linear;
            var known = beziers.Where(b => b != null).ToList();
            if (known.Count == 0)
            {
                var b0 = R5(new[] { (c[0] - t1) / dt, 0.0, (c[2] - t1) / dt, 1.0 });
                return Curve.Bezier(b0[0], b0[1], b0[2], b0[3]);
            }
            bool shared = known.All(b =>
            {
                for (int k = 0; k < 4; k++)
                    if (!(Math.Abs(b[k] - known[0][k]) < 1e-4)) return false;
                return true;
            });
            if (beziers.Count == 1 || shared)
            {
                var r = R5(known[0]);
                return Curve.Bezier(r[0], r[1], r[2], r[3]);
            }
            return Curve.Beziers(beziers.Select(b => R5(b ?? known[0])).ToList());
        }

        static List<Key> ReadNumericKeys(Json list, bool v4, Func<Json, double[]> valuesOf)
        {
            var keys = list.AsArray;
            var output = new List<Key>(keys.Count);
            double[] values = keys.Count > 0 ? valuesOf(keys[0]) : null;
            for (int i = 0; i < keys.Count; i++)
            {
                var k = keys[i];
                Json next = i + 1 < keys.Count ? keys[i + 1] : null;
                double[] nextValues = next != null ? valuesOf(next) : values;
                output.Add(new Key { Time = k.Num("time", 0), Values = values, Curve = ReadCurve(k, next, values, nextValues, v4) });
                values = nextValues;
            }
            return output;
        }

        static List<RawKey> RawKeys(Json list, Func<Json, double[]> read)
        {
            var output = new List<RawKey>();
            foreach (var k in list.AsArray)
            {
                var c = k["curve"];
                var rk = new RawKey { Time = k.Num("time", 0), Values = read(k), Curve = RawCurveKind.Linear };
                if (c.Type == JsonType.Str && c.AsString == "stepped") rk.Curve = RawCurveKind.Stepped;
                else if (c.Type == JsonType.Num)
                {
                    rk.Curve = RawCurveKind.Normalized;
                    rk.CurvePoints = new[] { c.AsNumber.Value, k.Num("c2", 0), k.Num("c3", 1), k.Num("c4", 1) };
                }
                else if (c.Type == JsonType.Arr)
                {
                    rk.Curve = RawCurveKind.Absolute;
                    rk.CurvePoints = Nums(c);
                }
                output.Add(rk);
            }
            return output;
        }

        /// <summary>k[field] ?? def for numbers.</summary>
        static double Val(Json k, string field, double def)
        {
            var v = k[field];
            return v.IsNull ? def : v.AsNumber ?? double.NaN;
        }

        static double[] Concat(double[] a, double[] b)
        {
            var o = new double[a.Length + b.Length];
            a.CopyTo(o, 0);
            b.CopyTo(o, a.Length);
            return o;
        }

        static SkeletonAnimation ReadAnimation(SkeletonData sk, Ctx ctx, Dictionary<string, int> ikIndex, string name, Json a)
        {
            bool v4 = ctx.V4;
            var anim = new SkeletonAnimation { Name = name };

            foreach (var be in a["bones"].Entries)
            {
                var tl = new BoneTimeline { Bone = ctx.Bone(Json.Str(be.Key)) };
                foreach (var te in be.Value.Entries)
                {
                    string kind = te.Key;
                    var keys = te.Value;
                    switch (kind)
                    {
                        case "rotate":
                            tl.Channels[Channel.Rotate] = ReadNumericKeys(keys, v4, k => new[] { k.Has("value") ? Val(k, "value", 0) : Val(k, "angle", 0) });
                            break;
                        case "translate":
                            tl.Channels[Channel.Translate] = ReadNumericKeys(keys, v4, k => new[] { Val(k, "x", 0), Val(k, "y", 0) });
                            break;
                        case "scale":
                            tl.Channels[Channel.Scale] = ReadNumericKeys(keys, v4, k => new[] { Val(k, "x", 1), Val(k, "y", 1) });
                            break;
                        case "shear":
                            tl.Channels[Channel.Shear] = ReadNumericKeys(keys, v4, k => new[] { Val(k, "x", 0), Val(k, "y", 0) });
                            break;
                        case "translatex":
                        case "translatey":
                        case "scalex":
                        case "scaley":
                        case "shearx":
                        case "sheary":
                        {
                            int ch = kind == "translatex" ? Channel.TranslateX : kind == "translatey" ? Channel.TranslateY : kind == "scalex" ? Channel.ScaleX : kind == "scaley" ? Channel.ScaleY : kind == "shearx" ? Channel.ShearX : Channel.ShearY;
                            double def = kind.StartsWith("scale", StringComparison.Ordinal) ? 1.0 : 0.0;
                            tl.Channels[ch] = ReadNumericKeys(keys, v4, k => new[] { Val(k, "value", def) });
                            break;
                        }
                        case "inherit":
                        case "transform":
                            tl.Inherit = keys.AsArray.Select(k =>
                            {
                                string mode = k["inherit"].AsString ?? k["value"].AsString ?? "normal";
                                InheritNames.TryParse(mode, out var inh);
                                return new KeyValuePair<double, Inherit>(k.Num("time", 0), inh);
                            }).ToList();
                            break;
                        default:
                            sk.Warnings.Add($"animation '{name}': unsupported bone timeline '{kind}'");
                            break;
                    }
                }
                anim.Bones.Add(tl);
            }

            foreach (var se in a["slots"].Entries)
            {
                var tl = new SlotTimeline { Slot = ctx.Slot(se.Key) };
                foreach (var te in se.Value.Entries)
                {
                    var keys = te.Value;
                    switch (te.Key)
                    {
                        case "attachment":
                            tl.Attachment = keys.AsArray.Select(k =>
                            {
                                string n = k["name"].AsString;
                                return new KeyValuePair<double, int>(k.Num("time", 0), n != null ? sk.Intern(n) : -1);
                            }).ToList();
                            break;
                        case "color":
                        case "rgba":
                            tl.Color = ReadNumericKeys(keys, v4, k => HexToColor(k["color"], White));
                            break;
                        case "rgb":
                            tl.Rgb = ReadNumericKeys(keys, v4, k => HexToColor(k["color"], White3));
                            break;
                        case "alpha":
                            tl.Alpha = ReadNumericKeys(keys, v4, k => new[] { Val(k, "value", 1) });
                            break;
                        case "twoColor":
                        case "rgba2":
                            tl.Rgba2 = ReadNumericKeys(keys, v4, k => Concat(HexToColor(k["light"], White), HexToColor(k["dark"], Black3)));
                            break;
                        case "rgb2":
                            tl.Rgb2 = ReadNumericKeys(keys, v4, k => Concat(HexToColor(k["light"], White3), HexToColor(k["dark"], Black3)));
                            break;
                        default:
                            sk.Warnings.Add($"animation '{name}': unsupported slot timeline '{te.Key}'");
                            break;
                    }
                }
                anim.Slots.Add(tl);
            }

            void ReadDeform(string skin, string slotName, string att, Json keysJson)
            {
                var list = keysJson.AsArray;
                var keys = new List<DeformKey>(list.Count);
                for (int i = 0; i < list.Count; i++)
                {
                    var k = list[i];
                    keys.Add(new DeformKey
                    {
                        Time = k.Num("time", 0),
                        Offset = Num.ToIndex(k.Num("offset", 0)),
                        Vertices = Nums(k["vertices"]),
                        Curve = ReadCurve(k, i + 1 < list.Count ? list[i + 1] : null, Zero1, One1, v4),
                    });
                }
                anim.Deform.Add(new DeformTimeline { Skin = skin == "default" ? null : skin, Slot = ctx.Slot(slotName), Attachment = sk.Intern(att), Keys = keys });
            }

            foreach (var skin in a["deform"].Entries)
            foreach (var slot in skin.Value.Entries)
            foreach (var att in slot.Value.Entries)
                ReadDeform(skin.Key, slot.Key, att.Key, att.Value);

            foreach (var skin in a["attachments"].Entries)
            foreach (var slot in skin.Value.Entries)
            foreach (var att in slot.Value.Entries)
            {
                var timelines = att.Value;
                if (timelines.Has("deform")) ReadDeform(skin.Key, slot.Key, att.Key, timelines["deform"]);
                if (timelines["sequence"].IsArray)
                {
                    if (!ctx.Slots.TryGetValue(slot.Key, out int slotIndex)) continue;
                    var keys = timelines["sequence"].AsArray.Select(k =>
                    {
                        SequenceMode mode;
                        switch (k.StrOr("mode", "hold"))
                        {
                            case "once": mode = SequenceMode.Once; break;
                            case "loop": mode = SequenceMode.Loop; break;
                            case "pingpong": mode = SequenceMode.PingPong; break;
                            case "onceReverse": mode = SequenceMode.OnceReverse; break;
                            case "loopReverse": mode = SequenceMode.LoopReverse; break;
                            case "pingpongReverse": mode = SequenceMode.PingPongReverse; break;
                            default: mode = SequenceMode.Hold; break;
                        }
                        return new SequenceKey { Time = k.Num("time", 0), Mode = mode, Index = Num.ToLong(k.Num("index", 0)), Delay = k["delay"].AsNumber };
                    }).ToList();
                    anim.Sequences.Add(new SequenceTimeline { Skin = skin.Key == "default" ? null : skin.Key, Slot = slotIndex, Attachment = sk.Intern(att.Key), Keys = keys });
                }
            }

            var drawOrder = a.Has("drawOrder") ? a["drawOrder"] : a["draworder"];
            foreach (var k in drawOrder.AsArray)
            {
                List<KeyValuePair<int, long>> offsets = null;
                if (k["offsets"].IsArray)
                {
                    offsets = new List<KeyValuePair<int, long>>();
                    foreach (var o in k["offsets"].AsArray) offsets.Add(new KeyValuePair<int, long>(ctx.Slot(o["slot"]), Num.ToLong(o.Num("offset", 0))));
                }
                anim.DrawOrder.Add(new DrawOrderKey { Time = k.Num("time", 0), Offsets = offsets });
            }

            foreach (var e in a["events"].AsArray)
            {
                double? i = e["int"].AsNumber;
                anim.Events.Add(new EventKey
                {
                    Time = e.Num("time", 0),
                    Name = e.StrOr("name", ""),
                    Int = i.HasValue ? Num.ToLong(i.Value) : (long?)null,
                    Float = e["float"].AsNumber,
                    String = e["string"].AsString,
                    Volume = e["volume"].AsNumber,
                    Balance = e["balance"].AsNumber,
                });
            }

            foreach (var ie in a["ik"].Entries)
            {
                if (!ikIndex.TryGetValue(ie.Key, out int constraint)) continue;
                anim.Ik.Add(new IkTimeline
                {
                    Constraint = constraint,
                    Keys = ie.Value.AsArray.Select(k => new IkKey
                    {
                        Time = k.Num("time", 0),
                        Mix = k.Num("mix", 1),
                        Softness = k.Num("softness", 0),
                        BendPositive = k.Flag("bendPositive", true),
                        Compress = k.Truthy("compress"),
                        Stretch = k.Truthy("stretch"),
                    }).ToList(),
                });
            }

            // Transform, path, physics and slider keys, by compiled constraint.
            anim.HasConstraintKeys = new[] { "transform", "path", "physics", "slider" }.Any(k => !a[k].IsNull && !(a[k].Type == JsonType.Bool && a[k].AsBool == false));
            for (int index = 0; index < sk.Constraints.Count; index++)
            {
                var c = sk.Constraints[index];
                var tl = new ConstraintTimeline { Constraint = index };
                bool any = false;
                switch (c.Kind)
                {
                    case ConstraintKind.Transform:
                    {
                        var keys = a["transform"][c.Name];
                        if (keys.AsArray.Count > 0)
                        {
                            bool legacy = keys.AsArray.Any(k => k.Has("rotateMix") || k.Has("translateMix") || k.Has("scaleMix") || k.Has("shearMix"));
                            tl.Transform = RawKeys(keys, k =>
                            {
                                if (legacy)
                                {
                                    double tm = Val(k, "translateMix", 1), sm = Val(k, "scaleMix", 1);
                                    return new[] { Val(k, "rotateMix", 1), tm, tm, sm, sm, Val(k, "shearMix", 1) };
                                }
                                double x = Val(k, "mixX", 1), sx = Val(k, "mixScaleX", 1);
                                return new[] { Val(k, "mixRotate", 1), x, Val(k, "mixY", x), sx, Val(k, "mixScaleY", sx), Val(k, "mixShearY", 1) };
                            });
                            any = true;
                        }
                        break;
                    }
                    case ConstraintKind.Slider:
                    {
                        var t = a["slider"][c.Name];
                        if (t.IsObject)
                        {
                            tl.SliderTime = RawKeys(t["time"], k => new[] { Val(k, "value", 0) });
                            tl.SliderMix = RawKeys(t["mix"], k => new[] { Val(k, "value", 1) });
                            any = true;
                        }
                        break;
                    }
                    case ConstraintKind.Physics:
                    {
                        for (int g = 0; g < 2; g++)
                        {
                            bool global = g == 1;
                            var source = a["physics"][global ? "" : c.Name];
                            if (!source.IsObject) continue;
                            for (int i = 0; i < 7; i++)
                            {
                                var keys = RawKeys(source[PhysicsData.Values[i]], k => new[] { Val(k, "value", 0) });
                                if (global) tl.PhysicsGlobal[i] = keys;
                                else tl.Physics[i] = keys;
                            }
                            any = true;
                        }
                        break;
                    }
                    case ConstraintKind.Path:
                    {
                        var t = a["path"][c.Name];
                        if (t.IsObject)
                        {
                            tl.Position = RawKeys(t["position"], k => new[] { k.Has("value") ? Val(k, "value", 0) : Val(k, "position", 0) });
                            tl.Spacing = RawKeys(t["spacing"], k => new[] { k.Has("value") ? Val(k, "value", 0) : Val(k, "spacing", 0) });
                            tl.PathMix = RawKeys(t["mix"], k =>
                            {
                                if (k.Has("rotateMix") || k.Has("translateMix")) return new[] { Val(k, "rotateMix", 1), Val(k, "translateMix", 1), Val(k, "translateMix", 1) };
                                double x = Val(k, "mixX", 1);
                                return new[] { Val(k, "mixRotate", 1), x, k.Has("mixY") ? Val(k, "mixY", x) : x };
                            });
                            any = true;
                        }
                        break;
                    }
                }
                if (any) anim.Constraints.Add(tl);
            }

            anim.Duration = LastTime(a, anim);
            return anim;
        }

        static readonly double[] Zero1 = { 0 };
        static readonly double[] One1 = { 1 };

        static double LastTime(Json raw, SkeletonAnimation anim)
        {
            double max = 0.0;
            void Scan(double t) => max = Num.Max(max, t);
            foreach (var t in anim.Bones)
            {
                foreach (var ch in t.Channels)
                foreach (var k in ch)
                    Scan(k.Time);
                foreach (var k in t.Inherit) Scan(k.Key);
            }
            foreach (var t in anim.Slots)
            {
                foreach (var k in t.Attachment) Scan(k.Key);
                foreach (var ch in new[] { t.Color, t.Rgb, t.Alpha, t.Rgba2, t.Rgb2 })
                foreach (var k in ch)
                    Scan(k.Time);
            }
            foreach (var t in anim.Deform)
            foreach (var k in t.Keys)
                Scan(k.Time);
            foreach (var t in anim.Ik)
            foreach (var k in t.Keys)
                Scan(k.Time);
            foreach (var k in anim.DrawOrder) Scan(k.Time);
            foreach (var k in anim.Events) Scan(k.Time);

            void Deep(Json v)
            {
                if (v.IsArray)
                {
                    foreach (var k in v.AsArray)
                    {
                        var t = k["time"].AsNumber;
                        if (t.HasValue) Scan(t.Value);
                        Deep(k);
                    }
                }
                else if (v.IsObject)
                {
                    foreach (var e in v.Entries) Deep(e.Value);
                }
            }
            foreach (var key in new[] { "transform", "path", "physics", "attachments" }) Deep(raw[key]);
            return max;
        }
    }
}
