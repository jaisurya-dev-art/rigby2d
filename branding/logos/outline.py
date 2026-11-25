# Outlines the "Rigby2D" wordmark from Inter (weight 500) as SVG path data, laid out like the
# lockup's <text> (font size 70, baseline at y 94, x from 150, squeezed to a width of 277), so the
# logo files don't depend on a font being installed. Prints JSON: { "Rigby": d, "2D": d }.
# Usage: python -I outline.py <InterVariable.woff2>
import json
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = instantiateVariableFont(TTFont(sys.argv[1]), {'wght': 500, 'opsz': 32} if 'opsz' in [a.axisTag for a in TTFont(sys.argv[1])['fvar'].axes] else {'wght': 500})
upm = font['head'].unitsPerEm
cmap = font.getBestCmap()
glyphs = font.getGlyphSet()
hmtx = font['hmtx']
size, x0, baseline, width = 70, 150, 94, 277
scale = size / upm

text = 'Rigby2D'
advances = [hmtx[cmap[ord(c)]][0] for c in text]
natural = sum(advances) * scale
squeeze = width / natural  # textLength with lengthAdjust="spacingAndGlyphs"

out = {'Rigby': '', '2D': ''}
x = 0.0
for i, c in enumerate(text):
    pen = SVGPathPen(glyphs)
    # Font units (y up) to SVG (y down), squeezed horizontally like the original <text>.
    t = TransformPen(pen, (scale * squeeze, 0, 0, -scale, x0 + x * scale * squeeze, baseline))
    glyphs[cmap[ord(c)]].draw(t)
    out['Rigby' if i < 5 else '2D'] += pen.getCommands()
    x += advances[i]


def tidy(d):
    # Round coordinates to two decimals.
    import re
    return re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.2f}'.rstrip('0').rstrip('.'), d)


print(json.dumps({k: tidy(v) for k, v in out.items()}))
