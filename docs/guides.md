# Guides

Guides are optional viewport aids: thin overlays while you transform a bone, and Photoshop-style
rulers with guide lines to align work to. Turn them on with **▦ Guides** in the viewport toolbar;
the **⚙** button next to it opens the options. Guides are on by default.

## Options

The **⚙** popover has a row per guide type — a checkbox to enable it, a colour swatch and a reset
button — in two groups:

- **Real-time guides**: Rotate, Translate, Scale, Shear.
- **Static guides**: Vertical, Horizontal.

Each type keeps its own colour. Placed static guides can be cleared from the popover.

## Real-time transform guides

While you drag a bone with a transform tool, a thin guide traces the change:

| Tool | Guide |
| --- | --- |
| **Rotate** | An arc from where the tip was to where it is now. |
| **Translate** | Two straight lines, from the anchor base and from the tip. |
| **Scale** | A curve at the tip. |
| **Shear** | A sphere around the anchor (see below). |

### Shear sphere

Shear tilts the bone's X and Y axes independently, in degrees (the X axis points along
`rotation + shear_x`, the Y axis along `rotation + 90 + shear_y`). With the **Shear** tool and a
bone selected, a sphere is drawn around the anchor; its two great circles are the X- and Y-axis
lines. Where you press picks what you change:

- on the **X-axis line** — `shear_x` (the X axis);
- on the **Y-axis line** — `shear_y` (the Y axis);
- **inside, off the lines** — free: whichever axis the cursor is nearer.

Each axis shows its tilt in degrees, counting whole turns (for example `⟳×2 20°`) and sign.
