# SPDX-License-Identifier: MIT OR Apache-2.0
"""Interpolation curves between keys.

A key curve is ``None`` (linear), ``STEPPED``, a tuple of four normalized bezier control values
shared by every value of the key, or a list of such tuples, one per value component. Normalized
means the endpoints are (0, 0) and (1, 1): x is the fraction of the time between the keys and y the
fraction of the value change.

Raw curves (constraint keys, sampled from file data) are ``None``, ``STEPPED``, ``("abs", [...])``
(4.x absolute control points, four per value) or ``("norm", (c1, c2, c3, c4))`` (3.8).
"""

STEPPED = "stepped"


def _clamp01(t):
    return 0.0 if t < 0.0 else 1.0 if t > 1.0 else t


def _cubic(p1, p2, t):
    u = 1.0 - t
    return 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t


def _cubic_derivative(p1, p2, t):
    u = 1.0 - t
    return 3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)


def bezier_y_for_x(x1, y1, x2, y2, x):
    x1 = _clamp01(x1)
    x2 = _clamp01(x2)
    # Newton iterations, falling back to bisection when the slope is too flat.
    t = x
    for _ in range(8):
        err = _cubic(x1, x2, t) - x
        if abs(err) < 1e-5:
            return _cubic(y1, y2, t)
        d = _cubic_derivative(x1, x2, t)
        if abs(d) < 1e-6:
            break
        t = _clamp01(t - err / d)
    lo, hi = 0.0, 1.0
    t = x
    for _ in range(30):
        v = _cubic(x1, x2, t)
        if abs(v - x) < 1e-5:
            break
        if v < x:
            lo = t
        else:
            hi = t
        t = (lo + hi) * 0.5
    return _cubic(y1, y2, t)


def ease(curve, t, component):
    """Maps linear progress ``t`` to eased progress for value ``component`` of a key."""
    t = _clamp01(t)
    if curve is None:
        return t
    if curve is STEPPED or curve == STEPPED:
        return 0.0
    if isinstance(curve, list):
        b = curve[component] if component < len(curve) else (curve[0] if curve else None)
        if b is None:
            return t
    else:
        b = curve
    return bezier_y_for_x(b[0], b[1], b[2], b[3], t)


def cubic4(p0, p1, p2, p3, s):
    u = 1.0 - s
    return u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3


def bezier_at(x0, y0, x1, y1, x2, y2, x3, y3, x):
    """Value of an absolute bezier segment from (x0, y0) to (x3, y3) at x."""
    lo, hi = 0.0, 1.0
    s = (x - x0) / (x3 - x0)
    for _ in range(40):
        v = cubic4(x0, x1, x2, x3, s)
        if abs(v - x) < 1e-7:
            break
        if v < x:
            lo = s
        else:
            hi = s
        s = (lo + hi) / 2.0
    return cubic4(y0, y1, y2, y3, s)


def normalized_bezier(x1, y1, x2, y2, x):
    return bezier_at(0.0, 0.0, x1, y1, x2, y2, 1.0, 1.0, x)


class RawKey(object):
    """A constraint key: time, values and the curve to the next key."""

    __slots__ = ("time", "values", "curve")

    def __init__(self, time, values, curve):
        self.time = time
        self.values = values
        self.curve = curve


def sample_raw(keys, time):
    """Samples raw keys at ``time`` (keys must not be empty); returns a list of values."""
    if time < keys[0].time:
        return list(keys[0].values)
    i = 0
    n = len(keys)
    while i + 1 < n and keys[i + 1].time <= time:
        i += 1
    a = keys[i]
    if i + 1 >= n:
        return list(a.values)
    b = keys[i + 1]
    if a.curve == STEPPED:
        return list(a.values)
    t0, t1 = a.time, b.time
    if t1 <= t0:
        return list(b.values)
    out = []
    curve = a.curve
    count = len(a.values)
    for j, v0 in enumerate(a.values):
        v1 = b.values[j] if j < len(b.values) else float("nan")
        if curve is not None and curve[0] == "abs" and len(curve[1]) >= 4 * (j + 1) and len(curve[1]) >= 4 * count:
            c = curve[1]
            v = bezier_at(t0, v0, c[4 * j], c[4 * j + 1], c[4 * j + 2], c[4 * j + 3], t1, v1, time)
        elif curve is not None and curve[0] == "abs" and len(curve[1]) == 4:
            c = curve[1]
            u = normalized_bezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0))
            v = v0 + (v1 - v0) * u
        elif curve is not None and curve[0] == "norm":
            c = curve[1]
            u = normalized_bezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0))
            v = v0 + (v1 - v0) * u
        else:
            v = v0 + (v1 - v0) * ((time - t0) / (t1 - t0))
        out.append(v)
    return out
