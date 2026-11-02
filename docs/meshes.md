# Meshes

A mesh is an image with vertices. Meshes bend: bind one to several bones and each vertex follows them
by its weights, so a sleeve bends at the elbow, a torso twists and a tail curls. In Animate mode, you
can also move vertices directly and key the shape (deform keys).

![NILA's torso mesh in Setup mode: the outline and inner vertices over the image](images/mesh-vertices.jpg "Editing the vertices of the torso mesh")

## Turning an image into a mesh

1. In Setup mode, select the image's slot.
2. Press **▦ Convert to mesh** in the inspector. The image is replaced by a mesh with four vertices
   at its corners, and mesh editing starts.
3. Click to add vertices: around the visible shape of the image to outline it, and inside where it
   should bend. **✎ Edit mesh** edits it again later.

AutoRig makes meshes for bending parts by itself.

## Generating a mesh from the image

Instead of clicking every vertex, let Rigby2D trace the image. While editing a mesh in Setup mode,
set the options under **Generate from image** in the mesh panel and press **✦ Generate mesh**:

| Option | What it does |
| --- | --- |
| Outline points | Exactly how many vertices the outline gets. Fewer for props, more where the art bends. |
| Alpha threshold | How opaque a pixel must be (1 to 254) to count as part of the shape. |
| Expand | Grows (or, negative, shrinks) the shape by whole pixels before tracing, to leave a margin. |
| Smoothing | Rounds off pixel steps in the outline before it is simplified. |
| Interior | Adds evenly spaced inner vertices (None, Low, Medium, High) so the mesh bends smoothly. |

The outline always contains every pixel above the threshold: when it uses few points, its edges are
pushed out so they never cut into the art. After the first generate, changing an option regenerates
the mesh right away, so you can watch the vertex count change. The status bar shows the vertex and
triangle counts. A weighted mesh keeps its bones: the new vertices take the weights of the old mesh
where they are. The settings are remembered, so the next part can use the same ones, and **Reset**
returns to the defaults. When an image has several separate shapes, the mesh traces the largest
and the status bar says how many there are.

## Editing vertices

With **Vertices** selected in the mesh panel:

| To | Do |
| --- | --- |
| Add a vertex inside | Click inside the mesh. |
| Extend the outline | Click near or outside the outline. |
| Move vertices | Drag them over the image. |
| Select several | <kbd>Ctrl</kbd>+click, or <kbd>Ctrl</kbd>+drag a box. |
| Delete | Select and press <kbd>Delete</kbd>. |

The mesh panel shows the vertex count (outline and inner) and whether it is weighted. Rigby2D
triangulates the mesh for you. Put vertices where the image should bend: rows across a joint bend
smoothly, and few vertices elsewhere keep the mesh light.

**✓ Done** finishes editing.

## Weights

A weighted mesh follows several bones. Each vertex has a weight per bone, and the weights of a vertex
add up to 1.

1. Select the bones the mesh should follow: <kbd>Ctrl</kbd>+click them in the tree.
2. Press **Bind to N selected bones**. Each vertex is weighted to the nearest of those bones.
3. Switch to **Weights** to refine them by painting.

![Painting weights on NILA's torso: red where the paint bone has full weight, blue where it has none](images/mesh-weights.jpg "Weights mode: red is full weight for the paint bone, blue is none")

| Setting | Meaning |
| --- | --- |
| **Paint bone** | The bone you are painting weight for. ● marks bones the mesh uses. |
| **Brush** | Brush radius in pixels. |
| **Strength** | How much one stroke changes the weight. |
| **Mode** | *Add* or *Subtract* (hold <kbd>Shift</kbd> to subtract while painting). |

Drag over the mesh to paint. Colors show the paint bone's weight: red is full weight, blue none.
**Unbind** removes the weights; the mesh then follows its slot's bone only.

> [!TIP]
> Check weights by rotating the bones in Animate mode, then undo. A crease at a joint means the
> weights change too suddenly across it: paint a softer blend over two or three rows of vertices.

## Deforming in Animate mode

In Animate mode, **✎ Deform mesh** lets you move vertices over time:

- Drag vertices to key their positions at the current frame; drag a box (or <kbd>Ctrl</kbd>+click)
  to select several and move them together.
- Keys appear in the dopesheet as the slot's **deform** row.

Deform keys add to what the bones do, so you can squash a face for a blink, bulge a cheek or wobble a
belly on top of the skeletal animation.

## Linked meshes

A linked mesh shows another image with the same vertices, triangles and weights as a mesh. Use it for
alternate drawings of a bending part, such as a sleeve in another color for a different outfit.

On a mesh, choose an image in **＋ Linked mesh with image…**. *Use the deform keys of the parent mesh*
decides whether it also follows the mesh's deform keys. Edit the parent mesh; the linked ones follow.

## Image sequences on meshes

Meshes can play numbered image sequences. See [Image sequences](bones-and-slots.md#image-sequences).
