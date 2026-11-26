// SPDX-License-Identifier: MIT OR Apache-2.0
// Binary skeleton files in format 4.2, read into the 4.2 skeleton JSON structure (separate ik,
// transform and path lists), which the skeleton JSON reader converts as it does 4.2 JSON. A port of
// runtimes/rust/rigby-runtime/src/binary42.rs: only what the observed 4.2 export pair shows is read;
// anything else stops as unsupported.

using System.Collections.Generic;

namespace Rigby2D
{
    public static partial class SkeletonBinary
    {
        const byte Ik42BendPositive = 0x02;
        const byte Ik42Mix = 0x20;
        const byte Ik42Key = 0x0a;
        static readonly string[] Transform42Offsets = { "rotation", "x", "y", "scaleX", "scaleY" };

        static Json Start42(string name, uint order)
        {
            var c = Json.Obj();
            c.Set("name", S(name));
            if (order != 0) c.Set("order", N(order));
            return c;
        }

        static Json BoneList42(R r, List<Json> bones)
        {
            var list = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++) list.Add(NameAt(bones, r.Varint(), "bone"));
            return Json.Arr(list);
        }

        /// <summary>Reads a 4.2 file after its header and string table into output.</summary>
        static Json Read42(R r, Json output, bool nonessential)
        {
            var bones = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                var b = Json.Obj();
                string name = r.String() ?? "";
                b.Set("name", S(name));
                if (i > 0) b.Set("parent", NameAt(bones, r.Varint(), "bone"));
                var t = new double[7];
                for (int k = 0; k < 7; k++) t[k] = r.Float();
                double length = r.Float();
                byte ib = r.Byte();
                if (ib >= InheritModes.Length) throw Unsupported($"Bone inherit mode on '{name}'");
                if (r.Bool()) throw Unsupported($"Skin bones in format 4.2 ('{name}')");
                if (length != 0.0) b.Set("length", N(length));
                string[] keys = { "rotation", "x", "y", "scaleX", "scaleY", "shearX", "shearY" };
                double[] defs = { 0, 0, 0, 1, 1, 0, 0 };
                for (int k = 0; k < 7; k++)
                    if (t[k] != defs[k]) b.Set(keys[k], N(t[k]));
                if (ib != 0) b.Set("inherit", S(InheritModes[ib]));
                if (nonessential)
                {
                    r.Color();
                    r.String();
                    // One more byte: the 4.3 visibility flag, not confirmed as such in 4.2, so not mapped.
                    r.Byte();
                }
                bones.Add(b);
            }

            var slots = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                var sl = Json.Obj();
                string name = r.String() ?? "";
                sl.Set("name", S(name));
                sl.Set("bone", NameAt(bones, r.Varint(), "bone"));
                string color = r.Color(), dark = r.Color();
                if (color != "ffffffff" || dark != "ffffffff") throw Unsupported($"Slot colors in format 4.2 ('{name}')");
                string attachment = r.Reference();
                if (attachment != null) sl.Set("attachment", S(attachment));
                if (r.Byte() != 0) throw Unsupported($"Slot blend modes in format 4.2 ('{name}')");
                if (nonessential) r.Bool();
                r.Slots.Add(name);
                slots.Add(sl);
            }

            var ik = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                uint order = r.Varint();
                var list = BoneList42(r, bones);
                var target = NameAt(bones, r.Varint(), "bone");
                byte flags = r.Byte();
                if ((flags & ~Ik42BendPositive) != Ik42Mix) throw Unsupported($"IK constraint options (flags 0x{flags:x}) on '{name}'");
                var c = Start42(name, order);
                c.Set("bones", list);
                c.Set("target", target);
                if ((flags & Ik42BendPositive) == 0) c.Set("bendPositive", Json.Bool(false));
                ik.Add(c);
            }

            var transform = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                uint order = r.Varint();
                var list = BoneList42(r, bones);
                var c = Start42(name, order);
                c.Set("bones", list);
                c.Set("target", NameAt(bones, r.Varint(), "bone"));
                byte offsets = r.Byte();
                if ((offsets & 0x07) != 0) throw Unsupported($"Transform constraint options (flags 0x{offsets:x}) on '{name}'");
                for (int k = 0; k < 5; k++)
                    if ((offsets & (8 << k)) != 0) c.Set(Transform42Offsets[k], N(r.Float()));
                byte more = r.Byte();
                if ((more & 0x80) != 0) throw Unsupported($"Transform constraint options (0x{more:x}) on '{name}'");
                if ((more & 0x01) != 0) c.Set("shearY", N(r.Float()));
                var mix = new double[6];
                for (int k = 0; k < 6; k++) mix[k] = (more & (2 << k)) != 0 ? r.Float() : 0.0;
                for (int k = 0; k < 6; k++)
                {
                    int same = TransformMixes[k].sameAs;
                    double def = same < 0 ? 1.0 : mix[same];
                    if (mix[k] != def) c.Set(TransformMixes[k].key, N(mix[k]));
                }
                transform.Add(c);
            }

            var path = new List<Json>();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                uint order = r.Varint();
                if (r.Bool()) throw Unsupported($"Path constraint options on '{name}'");
                var list = BoneList42(r, bones);
                var c = Start42(name, order);
                c.Set("bones", list);
                c.Set("target", NameAt(slots, r.Varint(), "slot"));
                byte modes = r.Byte();
                int rotateI = (modes >> 3) & 3;
                if ((modes & ~0x1f) != 0 || rotateI >= RotateModes.Length) throw Unsupported($"Path constraint options (flags 0x{modes:x}) on '{name}'");
                string position = PositionModes[modes & 1], spacing = SpacingModes[(modes >> 1) & 3], rotate = RotateModes[rotateI];
                if (position != "percent") c.Set("positionMode", S(position));
                if (spacing != "length") c.Set("spacingMode", S(spacing));
                if (rotate != "tangent") c.Set("rotateMode", S(rotate));
                double pos = r.Float(), spc = r.Float(), mixRotate = r.Float(), mixX = r.Float(), mixY = r.Float();
                if (pos != 0.0) c.Set("position", N(pos));
                if (spc != 0.0) c.Set("spacing", N(spc));
                if (mixRotate != 1.0) c.Set("mixRotate", N(mixRotate));
                if (mixX != 1.0) c.Set("mixX", N(mixX));
                if (mixY != mixX) c.Set("mixY", N(mixY));
                path.Add(c);
            }
            if (r.Varint() != 0) throw Unsupported("Physics constraints in format 4.2");

            var skin = Json.Obj();
            skin.Set("name", S("default"));
            skin.Set("attachments", ReadSkin42(r, slots, nonessential));
            if (r.Varint() != 0) throw Unsupported("Named skins in format 4.2");
            if (r.Varint() != 0) throw Unsupported("Events in format 4.2");

            var animations = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string name = r.String() ?? "";
                animations.Set(name, ReadAnimation42(r, bones, ik));
            }
            if (r.P != r.B.Length) throw new LoadException($"unexpected data after the animations ({r.B.Length - r.P} bytes)");
            output.Set("bones", Json.Arr(bones));
            output.Set("slots", Json.Arr(slots));
            if (ik.Count > 0) output.Set("ik", Json.Arr(ik));
            if (transform.Count > 0) output.Set("transform", Json.Arr(transform));
            if (path.Count > 0) output.Set("path", Json.Arr(path));
            output.Set("skins", Json.Arr(new List<Json> { skin }));
            output.Set("animations", animations);
            return output;
        }

        static Json ReadSkin42(R r, List<Json> slots, bool nonessential)
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
                    atts.Set(key, ReadAttachment42(r, flags, key, nonessential));
                }
                skin.Set(slot, atts);
            }
            return skin;
        }

        static Json ReadWeights42(R r, uint count)
        {
            var list = new List<Json>();
            for (uint v = 0; v < count; v++)
            {
                uint n = r.Varint();
                list.Add(N(n));
                for (uint k = 0; k < n; k++)
                {
                    list.Add(N(r.Varint()));
                    list.Add(N(r.Float()));
                    list.Add(N(r.Float()));
                    list.Add(N(r.Float()));
                }
            }
            return Json.Arr(list);
        }

        /// <summary>A region, a weighted mesh, or a weighted, open, constant-speed path.</summary>
        static Json ReadAttachment42(R r, byte flags, string key, bool nonessential)
        {
            var a = Json.Obj();
            if ((flags & 0x07) == 0 && (flags & ~0x80) == 0)
            {
                double rotation = (flags & 0x80) != 0 ? r.Float() : 0.0;
                double x = r.Float(), y = r.Float(), sx = r.Float(), sy = r.Float(), w = r.Float(), h = r.Float();
                if (rotation != 0.0) a.Set("rotation", N(rotation));
                if (x != 0.0) a.Set("x", N(x));
                if (y != 0.0) a.Set("y", N(y));
                if (sx != 1.0) a.Set("scaleX", N(sx));
                if (sy != 1.0) a.Set("scaleY", N(sy));
                a.Set("width", N(w));
                a.Set("height", N(h));
                return a;
            }
            if (flags == (2 | 0x80))
            {
                a.Set("type", S("mesh"));
                uint hull = r.Varint();
                a.Set("hull", N(hull));
                uint count = r.Varint();
                a.Set("vertices", ReadWeights42(r, count));
                var uvs = new List<Json>();
                for (uint i = 0; i < count * 2; i++) uvs.Add(N(r.Float()));
                a.Set("uvs", Json.Arr(uvs));
                var tris = new List<Json>();
                long nt = 3L * ((long)(2 * count) - hull - 2);
                for (long i = 0; i < nt; i++) tris.Add(N(r.Varint()));
                a.Set("triangles", Json.Arr(tris));
                if (nonessential)
                {
                    var edges = new List<Json>();
                    for (uint i = 0, m = r.Varint(); i < m; i++) edges.Add(N(r.Varint()));
                    a.Set("edges", Json.Arr(edges));
                    a.Set("width", N(r.Float()));
                    a.Set("height", N(r.Float()));
                }
                return a;
            }
            if (flags == (4 | 0x20 | 0x40))
            {
                a.Set("type", S("path"));
                uint count = r.Varint();
                a.Set("vertexCount", N(count));
                a.Set("vertices", ReadWeights42(r, count));
                var lengths = new List<Json>();
                for (uint i = 0; i < count / 3; i++) lengths.Add(N(r.Float()));
                a.Set("lengths", Json.Arr(lengths));
                if (nonessential)
                {
                    string color = r.Color();
                    if (color != "ff7f00ff") a.Set("color", S(color));
                }
                return a;
            }
            throw Unsupported($"Attachment options in format 4.2 (flags 0x{flags:x}) on '{key}'");
        }

        static List<Json> ReadDeformKeys42(R r, uint frames)
        {
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
                    if (c == 1) prev.Set("curve", S("stepped"));
                    else if (c == 2) prev.Set("curve", Json.Arr(new List<Json> { N(r.Float()), N(r.Float()), N(r.Float()), N(r.Float()) }));
                    else if (c != 0) throw new LoadException($"invalid curve type {c}");
                }
                uint count = r.Varint();
                if (count > 0)
                {
                    uint offset = r.Varint();
                    if (offset != 0) key.Set("offset", N(offset));
                    var v = new List<Json>();
                    for (uint i = 0; i < count; i++) v.Add(N(r.Float()));
                    key.Set("vertices", Json.Arr(v));
                }
                keys.Add(key);
            }
            return keys;
        }

        static Json ReadAnimation42(R r, List<Json> bones, List<Json> ik)
        {
            var anim = Json.Obj();
            r.Varint(); // total timeline count
            if (r.Varint() != 0) throw Unsupported("Slot keys in format 4.2");
            var boneTl = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                string bone = NameAt(bones, r.Varint(), "bone").AsString ?? "";
                var timelines = Json.Obj();
                for (uint t = 0, m = r.Varint(); t < m; t++)
                {
                    byte kind = r.Byte();
                    uint frames = r.Varint();
                    r.Varint(); // bezier count
                    if (kind >= BoneTimelines.Length) throw Unsupported($"Bone timeline type {kind}");
                    var (name, count) = BoneTimelines[kind];
                    double def = name.StartsWith("scale", System.StringComparison.Ordinal) ? 1.0 : 0.0;
                    timelines.Set(name, Json.Arr(ReadCurveKeys(r, frames, (rr, key) =>
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
                    })));
                }
                boneTl.Set(bone, timelines);
            }
            if (boneTl.Entries.Count > 0) anim.Set("bones", boneTl);

            var ikTl = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                uint ci = r.Varint();
                if (ci >= ik.Count) throw new LoadException("invalid constraint index in .skel data");
                uint frames = r.Varint();
                r.Varint(); // bezier count
                if (frames != 1) throw Unsupported("IK keys with curves in format 4.2");
                byte flags = r.Byte();
                if (flags != Ik42Key) throw Unsupported($"IK key options in format 4.2 (flags 0x{flags:x})");
                var key = Json.Obj();
                double time = r.Float();
                if (time != 0.0) key.Set("time", N(time));
                key.Set("mix", N(0.0));
                ikTl.Set(ik[(int)ci]["name"].AsString ?? "", Json.Arr(new List<Json> { key }));
            }
            if (ikTl.Entries.Count > 0) anim.Set("ik", ikTl);
            foreach (var what in new[] { "Transform", "Path", "Physics" })
                if (r.Varint() != 0) throw Unsupported($"{what} constraint keys in format 4.2");

            var skinsTl = Json.Obj();
            for (uint i = 0, n = r.Varint(); i < n; i++)
            {
                if (r.Varint() != 0) throw new LoadException("invalid skin index in .skel data");
                var slotsTl = Json.Obj();
                for (uint k = 0, m = r.Varint(); k < m; k++)
                {
                    string slot = r.SlotName(r.Varint());
                    var atts = Json.Obj();
                    for (uint a = 0, na = r.Varint(); a < na; a++)
                    {
                        string attachment = r.Reference() ?? "";
                        byte kind = r.Byte();
                        uint frames = r.Varint();
                        if (kind != 0) throw Unsupported($"Attachment timeline type {kind} in format 4.2");
                        r.Varint(); // bezier count
                        var tl = Json.Obj();
                        tl.Set("deform", Json.Arr(ReadDeformKeys42(r, frames)));
                        atts.Set(attachment, tl);
                    }
                    slotsTl.Set(slot, atts);
                }
                skinsTl.Set("default", slotsTl);
            }
            if (skinsTl.Entries.Count > 0) anim.Set("attachments", skinsTl);
            if (r.Varint() != 0) throw Unsupported("Draw order keys in format 4.2");
            if (r.Varint() != 0) throw Unsupported("Event keys in format 4.2");
            return anim;
        }
    }
}
