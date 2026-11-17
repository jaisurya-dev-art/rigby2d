# SPDX-License-Identifier: MIT OR Apache-2.0
"""2D math: local transforms and affine matrices. Y up, degrees, counter-clockwise rotation.

A local transform is a list ``[x, y, rotation, scale_x, scale_y, shear_x, shear_y]``; an affine
matrix is a tuple ``(a, b, c, d, tx, ty)`` that maps (x, y) to (a*x + c*y + tx, b*x + d*y + ty).
Lists and tuples keep the per-frame work fast in pure Python.
"""

import math

DEG = math.pi / 180.0

X, Y, ROT, SX, SY, HX, HY = range(7)

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

_cos = math.cos
_sin = math.sin
_atan2 = math.atan2
_hypot = math.hypot
_fmod = math.fmod


def setup_transform(x=0.0, y=0.0, rotation=0.0, scale_x=1.0, scale_y=1.0, shear_x=0.0, shear_y=0.0):
    return [x, y, rotation, scale_x, scale_y, shear_x, shear_y]


def wrap_degrees(d):
    """Wraps an angle in degrees to (-180, 180]."""
    w = _fmod(_fmod(d + 180.0, 360.0) + 360.0, 360.0) - 180.0
    return 180.0 if w == -180.0 else w


def angle_of(x, y):
    """``atan2(y, x)`` in degrees."""
    return _atan2(y, x) / DEG


def to_affine(t):
    """The matrix of local transform ``t``: X axis along rotation + shear_x, Y along rotation + 90 + shear_y."""
    rx = (t[2] + t[5]) * DEG
    ry = (t[2] + 90.0 + t[6]) * DEG
    return (_cos(rx) * t[3], _sin(rx) * t[3], _cos(ry) * t[4], _sin(ry) * t[4], t[0], t[1])


def mul(p, r):
    """``p * r``: applies ``r`` first, then ``p``."""
    pa, pb, pc, pd, ptx, pty = p
    ra, rb, rc, rd, rtx, rty = r
    return (
        pa * ra + pc * rb,
        pb * ra + pd * rb,
        pa * rc + pc * rd,
        pb * rc + pd * rd,
        pa * rtx + pc * rty + ptx,
        pb * rtx + pd * rty + pty,
    )


def determinant(m):
    return m[0] * m[3] - m[1] * m[2]


def inverse(m):
    det = m[0] * m[3] - m[1] * m[2]
    if abs(det) < 1e-12:
        return IDENTITY
    inv = 1.0 / det
    a = m[3] * inv
    b = -m[1] * inv
    c = -m[2] * inv
    d = m[0] * inv
    return (a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5]))


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def decompose(m):
    """Translation, rotation, scale and Y shear (shear_x is 0); reflection is a negative Y scale."""
    a, b, c, d, tx, ty = m
    scale_x = _hypot(a, b)
    if scale_x < 1e-12:
        return [tx, ty, 0.0, 0.0, 0.0, 0.0, 0.0]
    rotation = angle_of(a, b)
    det = a * d - b * c
    scale_y = _hypot(c, d) * (-1.0 if det < 0.0 else 1.0)
    y_angle = rotation + 90.0 if scale_y == 0.0 else angle_of(c / scale_y, d / scale_y)
    shear_y = wrap_degrees(y_angle - rotation - 90.0)
    return [tx, ty, rotation, scale_x, scale_y, 0.0, 0.0 if abs(shear_y) < 1e-9 else shear_y]


def rotate_linear(m, deg):
    """``m`` with its linear part rotated by ``deg`` degrees."""
    if deg == 0.0 or deg != deg:
        return m
    cos = _cos(deg * DEG)
    sin = _sin(deg * DEG)
    a, b, c, d, tx, ty = m
    return (cos * a - sin * b, sin * a + cos * b, cos * c - sin * d, sin * c + cos * d, tx, ty)


def js_round(v):
    """JavaScript ``Math.round``."""
    return math.floor(v + 0.5)


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v
