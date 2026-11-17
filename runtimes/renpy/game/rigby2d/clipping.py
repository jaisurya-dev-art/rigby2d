# SPDX-License-Identifier: MIT OR Apache-2.0
"""Clipping attachments: a polygon that masks the slots drawn after it (up to its end slot). The
polygon is split into triangles (it may be concave) and each drawn triangle is clipped against each
of them, interpolating UVs. A port of ``clipping.rs``."""


def _signed_area(p):
    n = len(p)
    a = 0.0
    i = 0
    while i + 1 < n:
        j = (i + 2) % n
        a += p[i] * p[j + 1] - p[j] * p[i + 1]
        i += 2
    return a / 2.0


def triangulate(polygon):
    """Ear-clipping triangulation of a simple polygon; counter-clockwise triangles (6 floats each)."""
    p = list(polygon)
    if _signed_area(p) < 0.0:
        r = []
        i = len(p) - 2
        while i >= 0:
            r.append(p[i])
            r.append(p[i + 1])
            i -= 2
        p = r
    idx = list(range(len(p) // 2))

    def x(i):
        return p[2 * i]

    def y(i):
        return p[2 * i + 1]

    def cross(a, b, c):
        return (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a))

    def inside(a, b, c, q):
        return cross(a, b, q) >= 0.0 and cross(b, c, q) >= 0.0 and cross(c, a, q) >= 0.0

    out = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        clipped = False
        n = len(idx)
        for k in range(n):
            a = idx[(k + n - 1) % n]
            b = idx[k]
            c = idx[(k + 1) % n]
            if cross(a, b, c) <= 0.0:
                continue  # reflex or degenerate corner
            if any(q != a and q != b and q != c and inside(a, b, c, q) for q in idx):
                continue
            out.append((x(a), y(a), x(b), y(b), x(c), y(c)))
            del idx[k]
            clipped = True
            break
        if not clipped:
            break  # self-intersecting input: keep what we have
    if len(idx) == 3:
        out.append((x(idx[0]), y(idx[0]), x(idx[1]), y(idx[1]), x(idx[2]), y(idx[2])))
    return out


def _clip_convex(poly, tri):
    """Clips a convex polygon of (x, y, u, v) against a counter-clockwise triangle (Sutherland-Hodgman)."""
    out = list(poly)
    for e in range(3):
        if not out:
            break
        ax, ay = tri[2 * e], tri[2 * e + 1]
        bx, by = tri[(2 * e + 2) % 6], tri[(2 * e + 3) % 6]
        src = out
        out = []
        n = len(src)
        for i in range(n):
            p = src[i]
            q = src[(i + 1) % n]
            sp = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)
            sq = (bx - ax) * (q[1] - ay) - (by - ay) * (q[0] - ax)
            if sp >= 0.0:
                out.append(p)
            if (sp >= 0.0) != (sq >= 0.0):
                t = sp / (sp - sq)
                out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, p[3] + (q[3] - p[3]) * t))
    return out


class Clipper(object):
    """An active clipping region: triangles of the clip polygon in world space."""

    def __init__(self, polygon):
        self.triangles = triangulate(polygon)

    def clip(self, positions, uvs, triangles):
        """Clips a triangle mesh (flat positions and UVs, vertex indices); returns (positions, uvs, indices)."""
        out_p = []
        out_uv = []
        out_t = []

        def vertex(i):
            return (positions[2 * i], positions[2 * i + 1], uvs[2 * i], uvs[2 * i + 1])

        for k in range(0, len(triangles) - 2, 3):
            tri = [vertex(triangles[k]), vertex(triangles[k + 1]), vertex(triangles[k + 2])]
            # Counter-clockwise, so "inside" is on the left of every edge.
            area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0])
            if area < 0.0:
                tri[1], tri[2] = tri[2], tri[1]
            for clip in self.triangles:
                poly = _clip_convex(tri, clip)
                if len(poly) < 3:
                    continue
                base = len(out_p) // 2
                for p in poly:
                    out_p.append(p[0])
                    out_p.append(p[1])
                    out_uv.append(p[2])
                    out_uv.append(p[3])
                for j in range(1, len(poly) - 1):
                    out_t.extend((base, base + j, base + j + 1))
        return out_p, out_uv, out_t
