# SPDX-License-Identifier: MIT OR Apache-2.0
"""Turns a posed skeleton into textured triangle batches for an engine to draw: regions and meshes
in draw order, mapped into atlas pages, masked by clipping attachments, split into batches by page
and blend mode. A port of ``render.rs`` (and the reference WebGL renderer)."""

from . import model as M
from .clipping import Clipper

QUAD = (0, 1, 2, 0, 2, 3)

# Per-vertex attributes after x, y: u, v, light rgba, dark rgb and a has-dark flag.
STRIDE = 10


class RegionLookup(object):
    """Atlas regions by skeleton image name."""

    def __init__(self, sk, atlas):
        self.regions = atlas.lookup()

    def get(self, image):
        return self.regions.get(image)

    def missing(self, sk):
        """Images the skeleton's region and mesh attachments use that have no atlas region."""
        used = set()
        atts = []
        for slot in sk.slots:
            atts.extend(slot.attachments.values())
        for skin in sk.skins:
            for slot_atts in skin.slots.values():
                atts.extend(slot_atts.values())
        for a in atts:
            if a.kind in (M.REGION, M.MESH, M.LINKED_MESH):
                if a.sequence is not None:
                    used.update(a.sequence.frames)
                else:
                    used.add(a.image)
        return sorted(i for i in used if self.get(i) is None)


class Batch(object):
    """Triangles that share an atlas page and a blend mode, in draw order.

    ``points`` holds world positions (x, y, Y up); ``attributes`` holds ``STRIDE`` floats per point:
    page UV (v down), light color (straight alpha: slot tint x attachment color x tint), dark color
    and a flag that is 1 when the slot has a dark color.
    """

    __slots__ = ("page", "blend", "points", "attributes", "indices")

    def __init__(self, page, blend):
        self.page = page
        self.blend = blend
        self.points = []
        self.attributes = []
        self.indices = []


class RenderOutput(object):

    def __init__(self):
        self.batches = []
        self._transform = None
        # Page UVs of the attachment each slot drew last, by (source id, image).
        self._uv_cache = {}

    def build(self, pose, lookup, tint=(1.0, 1.0, 1.0, 1.0), transform=None):
        """Builds the geometry of ``pose``; ``tint`` multiplies every color. ``transform`` is
        ``(sx, ox, sy, oy)``: positions become ``(x * sx + ox, y * sy + oy)`` (for example skeleton
        units, Y up, to screen pixels, Y down). Returns the batches."""
        self.batches = []
        self._transform = transform
        sk = pose.sk
        clipper = None
        clip_end = None
        for i in pose.draw_order:
            att = pose.slot_attachment(i)
            if att is not None:
                kind = att.kind
                if kind == M.CLIPPING:
                    clipper = Clipper(pose.world_vertices(i, att))
                    clip_end = None if att.end == i else att.end  # ending at its own slot: to the end
                elif kind in (M.REGION, M.MESH, M.LINKED_MESH):
                    self._draw_attachment(sk, pose, i, att, lookup, tint, clipper)
            if clipper is not None and clip_end == i:
                clipper = None
        return self.batches

    def _draw_attachment(self, sk, pose, i, att, lookup, tint, clipper):
        is_region = att.kind == M.REGION
        source = att if is_region else sk.mesh_source(i, att, pose.skin)
        if source is None:
            return
        image = pose.image_of(i, source if att.kind == M.MESH else att)
        entry = lookup.get(image)
        if entry is None:
            return
        c = pose.color[i]
        ac = att.color
        light = (c[0] * ac[0] * tint[0], c[1] * ac[1] * tint[1], c[2] * ac[2] * tint[2], c[3] * ac[3] * tint[3])
        d = pose.dark[i]
        dark = (d[0], d[1], d[2], 1.0) if d is not None else (0.0, 0.0, 0.0, 0.0)
        blend = sk.slots[i].blend
        key = (id(source), image)
        cached = self._uv_cache.get(i)
        uvs = cached[1] if cached is not None and cached[0] == key else None
        if is_region:
            m = pose.attachment_world(i, att.offset)
            u0, v0, u1, v1 = entry.trim
            w = att.width
            h = att.height
            hw = w / 2.0
            hh = h / 2.0
            positions = []
            fresh = []
            for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
                lx = -hw + u * w
                ly = hh - v * h
                positions.append(m[0] * lx + m[2] * ly + m[4])
                positions.append(m[1] * lx + m[3] * ly + m[5])
                if uvs is None:
                    fresh.extend(entry.map(u, v))
            if uvs is None:
                uvs = fresh
            triangles = QUAD
        else:
            positions = pose.world_vertices(i, att)
            if source.kind != M.MESH:
                return
            if uvs is None or len(uvs) != len(positions):
                mesh_uvs = source.uvs
                n = len(mesh_uvs)
                uvs = []
                for k in range(len(positions) // 2):
                    uvs.extend(entry.map(mesh_uvs[2 * k] if 2 * k < n else 0.0, mesh_uvs[2 * k + 1] if 2 * k + 1 < n else 0.0))
            triangles = source.triangles
        self._uv_cache[i] = (key, uvs)
        if clipper is not None:
            positions, uvs, triangles = clipper.clip(positions, uvs, triangles)
            if not triangles:
                return
        self._emit(entry.page, blend, positions, uvs, triangles, light, dark)

    def _emit(self, page, blend, positions, uvs, triangles, light, dark):
        b = self.batches[-1] if self.batches else None
        if b is None or b.page != page or b.blend != blend:
            b = Batch(page, blend)
            self.batches.append(b)
        base = len(b.points) // 2
        t = self._transform
        if t is None:
            b.points.extend(positions)
        else:
            sx, ox, sy, oy = t
            pts = b.points
            for k in range(0, len(positions) - 1, 2):
                pts.append(positions[k] * sx + ox)
                pts.append(positions[k + 1] * sy + oy)
        attrs = b.attributes
        lr, lg, lb, la = light
        dr, dg, db, da = dark
        for k in range(len(positions) // 2):
            attrs.extend((uvs[2 * k], uvs[2 * k + 1], lr, lg, lb, la, dr, dg, db, da))
        b.indices.extend([base + t for t in triangles])
