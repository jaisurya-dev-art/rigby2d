# Film effects

Layer effects, particles, motion blur and depth of field give a shot its finish: the look you'd
otherwise build with effect nodes in Toon Boom Harmony or layer effects in Moho. They belong to the
**Film workspace** and are stored only in the project (`.rigby`): skeleton exports and the game
runtimes never see them, and a project without them renders exactly as it did before.

The viewport previews them as you work (*View ▸ Preview film effects* turns the preview off if
playback slows down). Renders always include them, motion blur too.

## Layer effects

Select a bone or a slot and open **Effects** in the inspector. On a bone, the effects apply to every
part on that bone and its children, drawn together as one layer, so a shadow or glow wraps the whole
character rather than each part on its own. On a slot, they apply to that one picture.

| Effect | What it does | Settings |
| --- | --- | --- |
| **Drop shadow** | A soft copy of the layer's shape behind it, offset like a cast shadow. | Offset, softness, colour and opacity |
| **Light shading** | Shade on the side away from the light and a rim on the side facing it, following the outline of the layer (tone and highlight). | Width, shade colour, light colour |
| **Glow** | A soft halo around the layer, added on top. | Radius, strength, colour |
| **Blur** | Softens the whole layer. | Radius |
| **Color grade** | Brightness, contrast, saturation, hue and a tint for the layer. | |

Sizes and offsets are in world units, so effects keep their size as you zoom and in renders of any
resolution. Layers can sit inside each other: effects on the head and on the whole body both apply.
The light for **Light shading** is set once for the project (*Light from* in the project panel's Film
effects section), so every layer is lit from the same side.

## Particles

Select a bone and click **Add emitter** in **Particles**. The emitter follows the bone; particles are
born at its position (a point, a line or a box, with an offset) and fly off in its direction.

- **Rate** and **Lifetime**: how many are born per second and how long each lives.
- **Direction**, **Spread** and **Speed**: where they go (−90° is straight down).
- **Gravity**, **Wind**, **Turbulence**: forces in world units per second² (gravity pulls down when
  negative), and a sideways wander.
- **Particle size**, **Size at end**, **Spin**, **Color** (with opacity), **Blend**: their look.
  **Image** uses any image of the project; *Soft dot* needs none.
- **Drawn**: on top of everything, or before a slot of the draw order (behind the character, between
  parts, or inside an effect layer, where the layer's effects apply to them too).
- **Warm-up** simulates the seconds before frame 0, so snow or rain is already falling on the first
  frame. **Seed** picks another random pattern.

Particles are deterministic: the same frame always shows the same particles, so scrubbing, playback
and every render agree.

## Motion blur and depth of field

The project panel's **Film effects** section (Film workspace) also has:

- **Color grade** for the whole frame.
- **Motion blur**: renders each frame from several moments while the shutter is open and averages
  them, physics included. **Shutter** is the film shutter angle (180° = open half the frame time);
  **Samples** is how many moments (more is smoother and slower). It shows in renders only.
- **Depth of field**: each effect layer gets a **Depth**; layers away from **Focus** are blurred by
  their distance times **Aperture**. Give the background layer a large depth and the foreground a
  negative one for a soft-focus look.

## Rendering

Renders through *File ▸ Render animation…*, `rigby render` and the desktop app's render mode all
include film effects, on the GPU. Motion blur multiplies the rendering work by its sample count.

Projects on a [pixel grid](importing-art.md#pixel-grid) draw film effects at full resolution instead of through
the grid.
