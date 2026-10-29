// SPDX-License-Identifier: MIT OR Apache-2.0
// Texture atlas text files (".atlas"): pages of packed regions. Both the current (bounds/offsets)
// and the legacy (xy/size/orig/offset) field names are read.
// A port of runtimes/rust/rigby-runtime/src/atlas.rs.

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Rigby2D
{
    public sealed class AtlasRegion
    {
        public string Name;
        public long Index = -1;
        public double X, Y, Width, Height, Rotate, OffsetX, OffsetY;
        public double OriginalWidth = -1, OriginalHeight = -1;
    }

    public sealed class AtlasPage
    {
        public string Name;
        public double Width, Height;
        /// <summary>Min and mag filter names, e.g. "Linear".</summary>
        public string MinFilter = "Nearest", MagFilter = "Nearest";
        public string Repeat = "none";
        /// <summary>Premultiplied alpha.</summary>
        public bool Pma;
        public List<AtlasRegion> Regions = new List<AtlasRegion>();
    }

    public sealed class Atlas
    {
        public List<AtlasPage> Pages = new List<AtlasPage>();

        static double ParseNum(string s) =>
            double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : double.NaN;

        static double[] Ints(string v)
        {
            var parts = v.Split(',');
            var out_ = new double[parts.Length];
            for (int i = 0; i < parts.Length; i++) out_[i] = ParseNum(parts[i]);
            return out_;
        }

        /// <summary>Parses atlas text.</summary>
        public static Atlas Parse(string text)
        {
            if (text.Length > 0 && text[0] == '﻿') text = text.Substring(1);
            var atlas = new Atlas();
            var pages = atlas.Pages;
            bool inPage = false, inRegion = false;
            foreach (var raw in text.Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0)
                {
                    inPage = false;
                    inRegion = false;
                    continue;
                }
                int colon = line.IndexOf(':');
                if (colon < 0)
                {
                    if (!inPage)
                    {
                        pages.Add(new AtlasPage { Name = line });
                        inPage = true;
                    }
                    else
                    {
                        pages[pages.Count - 1].Regions.Add(new AtlasRegion { Name = line });
                        inRegion = true;
                    }
                    continue;
                }
                if (!inPage) continue;
                string key = line.Substring(0, colon).Trim();
                string value = line.Substring(colon + 1).Trim();
                var page = pages[pages.Count - 1];
                if (inRegion)
                {
                    var r = page.Regions[page.Regions.Count - 1];
                    double[] n;
                    switch (key)
                    {
                        case "bounds":
                            n = Ints(value);
                            if (n.Length > 0) r.X = n[0];
                            if (n.Length > 1) r.Y = n[1];
                            if (n.Length > 2) r.Width = n[2];
                            if (n.Length > 3) r.Height = n[3];
                            break;
                        case "offsets":
                            n = Ints(value);
                            if (n.Length > 0) r.OffsetX = n[0];
                            if (n.Length > 1) r.OffsetY = n[1];
                            if (n.Length > 2) r.OriginalWidth = n[2];
                            if (n.Length > 3) r.OriginalHeight = n[3];
                            break;
                        case "xy":
                            n = Ints(value);
                            if (n.Length > 0) r.X = n[0];
                            if (n.Length > 1) r.Y = n[1];
                            break;
                        case "size":
                            n = Ints(value);
                            if (n.Length > 0) r.Width = n[0];
                            if (n.Length > 1) r.Height = n[1];
                            break;
                        case "orig":
                            n = Ints(value);
                            if (n.Length > 0) r.OriginalWidth = n[0];
                            if (n.Length > 1) r.OriginalHeight = n[1];
                            break;
                        case "offset":
                            n = Ints(value);
                            if (n.Length > 0) r.OffsetX = n[0];
                            if (n.Length > 1) r.OffsetY = n[1];
                            break;
                        case "rotate":
                            r.Rotate = value == "true" ? 90.0 : value == "false" ? 0.0 : double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double rot) ? rot : 0.0;
                            break;
                        case "index":
                            r.Index = long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long ix) ? ix : -1;
                            break;
                    }
                }
                else
                {
                    switch (key)
                    {
                        case "size":
                        {
                            var n = Ints(value);
                            if (n.Length > 0) page.Width = n[0];
                            if (n.Length > 1) page.Height = n[1];
                            break;
                        }
                        case "filter":
                        {
                            var f = value.Split(',');
                            page.MinFilter = f[0].Trim();
                            page.MagFilter = (f.Length > 1 ? f[1] : f[0]).Trim();
                            break;
                        }
                        case "repeat":
                            page.Repeat = value;
                            break;
                        case "pma":
                            page.Pma = value == "true";
                            break;
                    }
                }
            }
            foreach (var p in pages)
            foreach (var r in p.Regions)
            {
                if (r.OriginalWidth < 0.0) r.OriginalWidth = r.Width;
                if (r.OriginalHeight < 0.0) r.OriginalHeight = r.Height;
            }
            return atlas;
        }

        /// <summary>Region lookup by image name (name + index for indexed regions).</summary>
        public Dictionary<string, RegionUv> Lookup()
        {
            var output = new Dictionary<string, RegionUv>(StringComparer.Ordinal);
            for (int p = 0; p < Pages.Count; p++)
            {
                var page = Pages[p];
                foreach (var r in page.Regions)
                {
                    string key = r.Index >= 0 ? r.Name + r.Index.ToString(CultureInfo.InvariantCulture) : r.Name;
                    output[key] = new RegionUv(p, r, page.Width, page.Height);
                }
            }
            return output;
        }
    }

    /// <summary>Maps an attachment's 0..1 image coordinates (y down) to page UVs, handling whitespace stripping and rotation in the page.</summary>
    public readonly struct RegionUv
    {
        public readonly int Page;
        /// <summary>Part of the original image the packed pixels cover: u0, v0, u1, v1.</summary>
        public readonly double TrimU0, TrimV0, TrimU1, TrimV1;
        readonly double ow, oh, dx, dy, w, h, srcX, srcY, cx, cy, cos, sin, pageW, pageH;

        public RegionUv(int page, AtlasRegion r, double pageWidth, double pageHeight)
        {
            bool swap = Math.Abs(r.Rotate % 180.0) == 90.0;
            double srcW = swap ? r.Height : r.Width, srcH = swap ? r.Width : r.Height;
            ow = Math.Max(r.OriginalWidth, 1.0);
            oh = Math.Max(r.OriginalHeight, 1.0);
            dx = r.OffsetX;
            dy = r.OriginalHeight - r.Height - r.OffsetY;
            w = r.Width;
            h = r.Height;
            // The page holds the packed image rotated by -rotate degrees about its center.
            double rad = -r.Rotate * Math.PI / 180.0;
            Page = page;
            TrimU0 = dx / ow;
            TrimV0 = dy / oh;
            TrimU1 = (dx + w) / ow;
            TrimV1 = (dy + h) / oh;
            srcX = r.X;
            srcY = r.Y;
            cx = srcW / 2.0;
            cy = srcH / 2.0;
            cos = Round6(Math.Cos(rad));
            sin = Round6(Math.Sin(rad));
            pageW = Math.Max(pageWidth, 1.0);
            pageH = Math.Max(pageHeight, 1.0);
        }

        static double Round6(double v) => Math.Floor(v * 1e6 + 0.5) / 1e6;

        /// <summary>Page UV for image coordinates (u, v), clamped inside the region.</summary>
        public void Map(double u, double v, out double pu, out double pv)
        {
            double qx = MathUtil.Clamp(u * ow - dx, 0.0, w) - w / 2.0;
            double qy = MathUtil.Clamp(v * oh - dy, 0.0, h) - h / 2.0;
            pu = (srcX + cx + qx * cos - qy * sin) / pageW;
            pv = (srcY + cy + qx * sin + qy * cos) / pageH;
        }
    }
}
