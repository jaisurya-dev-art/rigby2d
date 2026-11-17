# SPDX-License-Identifier: MIT OR Apache-2.0
"""Texture atlas text files (``.atlas``): pages of packed regions. Both the current (bounds/offsets)
and the legacy (xy/size/orig/offset) field names are read. A port of ``atlas.rs``."""

import math


class AtlasRegion(object):
    __slots__ = ("name", "index", "x", "y", "width", "height", "rotate", "offset_x", "offset_y", "original_width", "original_height")

    def __init__(self, name):
        self.name = name
        self.index = -1
        self.x = 0.0
        self.y = 0.0
        self.width = 0.0
        self.height = 0.0
        self.rotate = 0.0
        self.offset_x = 0.0
        self.offset_y = 0.0
        self.original_width = -1.0
        self.original_height = -1.0


class AtlasPage(object):
    __slots__ = ("name", "width", "height", "filter", "repeat", "pma", "regions")

    def __init__(self, name):
        self.name = name
        self.width = 0.0
        self.height = 0.0
        self.filter = ["Nearest", "Nearest"]
        self.repeat = "none"
        self.pma = False
        self.regions = []


def _floats(v):
    out = []
    for s in v.split(","):
        try:
            out.append(float(s.strip()))
        except ValueError:
            out.append(float("nan"))
    return out


def _set(obj, fields, values):
    for f, v in zip(fields, values):
        setattr(obj, f, v)


class Atlas(object):

    def __init__(self, pages=None):
        self.pages = pages or []

    @staticmethod
    def parse(text):
        """Parses atlas text."""
        if text.startswith("﻿"):
            text = text[1:]
        pages = []
        in_page = False
        in_region = False
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                in_page = False
                in_region = False
                continue
            colon = line.find(":")
            if colon < 0:
                if not in_page:
                    pages.append(AtlasPage(line))
                    in_page = True
                else:
                    pages[-1].regions.append(AtlasRegion(line))
                    in_region = True
                continue
            if not in_page:
                continue
            key = line[:colon].strip()
            value = line[colon + 1:].strip()
            page = pages[-1]
            if in_region:
                r = page.regions[-1]
                if key == "bounds":
                    _set(r, ("x", "y", "width", "height"), _floats(value))
                elif key == "offsets":
                    _set(r, ("offset_x", "offset_y", "original_width", "original_height"), _floats(value))
                elif key == "xy":
                    _set(r, ("x", "y"), _floats(value))
                elif key == "size":
                    _set(r, ("width", "height"), _floats(value))
                elif key == "orig":
                    _set(r, ("original_width", "original_height"), _floats(value))
                elif key == "offset":
                    _set(r, ("offset_x", "offset_y"), _floats(value))
                elif key == "rotate":
                    if value == "true":
                        r.rotate = 90.0
                    elif value == "false":
                        r.rotate = 0.0
                    else:
                        try:
                            r.rotate = float(value)
                        except ValueError:
                            r.rotate = 0.0
                elif key == "index":
                    try:
                        r.index = int(value)
                    except ValueError:
                        r.index = -1
            else:
                if key == "size":
                    _set(page, ("width", "height"), _floats(value))
                elif key == "filter":
                    f = [s.strip() for s in value.split(",")]
                    page.filter = [f[0] if f else "", f[1] if len(f) > 1 else (f[0] if f else "")]
                elif key == "repeat":
                    page.repeat = value
                elif key == "pma":
                    page.pma = value == "true"
        for p in pages:
            for r in p.regions:
                if r.original_width < 0.0:
                    r.original_width = r.width
                if r.original_height < 0.0:
                    r.original_height = r.height
        return Atlas(pages)

    def lookup(self):
        """Region lookup by image name (``name`` + ``index`` for indexed regions)."""
        out = {}
        for p, page in enumerate(self.pages):
            for r in page.regions:
                key = "%s%d" % (r.name, r.index) if r.index >= 0 else r.name
                out[key] = RegionUv(p, r, page.width, page.height)
        return out


def _round6(v):
    return math.floor(v * 1e6 + 0.5) / 1e6


class RegionUv(object):
    """Maps an attachment's 0..1 image coordinates (y down) to page UVs, handling whitespace
    stripping and rotation in the page."""

    __slots__ = ("page", "trim", "ow", "oh", "dx", "dy", "w", "h", "src_x", "src_y", "cx", "cy", "cos", "sin", "page_w", "page_h")

    def __init__(self, page, r, page_w, page_h):
        swap = abs(math.fmod(r.rotate, 180.0)) == 90.0
        src_w, src_h = (r.height, r.width) if swap else (r.width, r.height)
        self.page = page
        self.ow = max(r.original_width, 1.0)
        self.oh = max(r.original_height, 1.0)
        self.dx = r.offset_x
        self.dy = r.original_height - r.height - r.offset_y
        self.w = r.width
        self.h = r.height
        # Part of the original image the packed pixels cover: u0, v0, u1, v1.
        self.trim = (self.dx / self.ow, self.dy / self.oh, (self.dx + self.w) / self.ow, (self.dy + self.h) / self.oh)
        self.src_x = r.x
        self.src_y = r.y
        self.cx = src_w / 2.0
        self.cy = src_h / 2.0
        # The page holds the packed image rotated by -rotate degrees about its center.
        rad = -r.rotate * math.pi / 180.0
        self.cos = _round6(math.cos(rad))
        self.sin = _round6(math.sin(rad))
        self.page_w = max(page_w, 1.0)
        self.page_h = max(page_h, 1.0)

    def map(self, u, v):
        """Page UV for image coordinates (u, v), clamped inside the region."""
        qx = min(max(u * self.ow - self.dx, 0.0), self.w) - self.w / 2.0
        qy = min(max(v * self.oh - self.dy, 0.0), self.h) - self.h / 2.0
        return ((self.src_x + self.cx + qx * self.cos - qy * self.sin) / self.page_w,
                (self.src_y + self.cy + qx * self.sin + qy * self.cos) / self.page_h)
