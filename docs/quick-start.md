# Quick start

This walk-through takes a layered character from a PSD to a looping animation and an export a game
can load. It takes about ten minutes. You need a PSD with **one layer per body part** (head, torso,
upper arm, forearm, hand, thigh, shin, foot, and so on). No PSD at hand? Open a demo instead
(*File ▸ Open demo*) and skip to [step 4](#4-make-an-animation).

> [!TIP]
> Prefer to learn by doing inside the editor? *Help ▸ Tutorials* has hands-on lessons that point at
> each button and move on as you work. The first one starts with a 4-minute tour.

## 1. Import the artwork

Open the editor and choose *File ▸ Import ▸ PSD…*. Every pixel layer becomes an image in its own slot,
exactly where it was drawn. Hidden layers are imported hidden.

![A layered PSD of NILA imported into Rigby2D: every layer is an image on the root bone](images/psd-imported.jpg "After File ▸ Import ▸ PSD: the layers are in place, but nothing is rigged yet")

Layer names matter for the next step. `upperarm_l`, `L Upper Arm` and `arm.left.upper` all work; see
[naming layers](autorig.md#naming-layers).

## 2. Rig it with AutoRig

Choose *File ▸ AutoRig artwork…*. The dialog lists each layer with the **part** and **side**
AutoRig found for it. Fix any that are wrong, or choose *leave unrigged*, then press
**Generate rig**.

![The AutoRig dialog listing every layer with its detected body part and side](images/autorig-dialog.jpg "Check the detected parts, then Generate rig")

AutoRig builds a spine, neck and head, arms and legs with IK targets, small face bones, and turns
bending parts (a torso, a one-piece arm) into weighted meshes. It is one undo step, and everything it
makes is ordinary rig data you can edit.

![NILA after AutoRig: bones drawn over the artwork, from the hips to the head, arms and legs](images/autorig-result.jpg "The generated rig: bones, IK targets and a bending torso mesh")

## 3. Check the rig

Select **Rotate** in the viewport toolbar (or press <kbd>C</kbd>) and drag a bone: its children and
their images follow. Things to look at:

- Does the head turn at the neck, and do the arms bend at the elbows?
- Do the images sit in the right **draw order**? Select a slot in the tree and use *Draw in front* /
  *Draw behind*.
- Want the knee to bend the other way? Select the leg's IK constraint in the tree and flip
  **Bend**.

Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) puts back anything you did not mean to change. You are still in
**Setup mode**, so these edits change the rig's rest pose.

## 4. Make an animation

1. Press <kbd>Tab</kbd> to switch to **Animate mode**. The viewport gets a red border.
2. In the timeline, press **+ New** and name the animation `idle`.
3. Set its **Length** to `2` seconds.
4. At frame 0, select the `chest` bone, rotate it a little and press <kbd>K</kbd> to key the
   change. A diamond appears in the dopesheet.
5. Move the time cursor to frame 30 (click the ruler, or press <kbd>R</kbd> and
   <kbd>F</kbd> to step), rotate the chest the other way and press <kbd>K</kbd> again.
6. Go to the last frame and key the chest back to where it started, so the loop is seamless.
7. Press <kbd>Space</kbd> to play. Press it again to stop.

![The dopesheet: rows of keys for each bone channel and image swap, with the time cursor](images/dopesheet.jpg "Each row is a bone channel or image swap; diamonds are keys")

> [!TIP]
> Turn on **Auto key** in the viewport toolbar and every change sets keys right away, without
> pressing <kbd>K</kbd>.

Smooth the motion with easing: right-click a key and choose **Ease in-out**, or open the
**Graph** view to shape the curve with Bézier handles. See [Graph editor](graph-editor.md).

## 5. Save and export

- *File ▸ Save* (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes `name.rigby`: the whole project with its
  images in one file. Reopen it any time with *File ▸ Open*.
- *File ▸ Export ▸ JSON + atlas…* (<kbd>Ctrl</kbd>+<kbd>E</kbd>) writes `name.json`, `name.atlas`
  and `name.png` for a game. *Export ▸ Binary .skel + atlas* writes the compact binary format instead.

Then [play it in your game](runtimes.md), or switch to the Film workspace and
[render a video](film.md#rendering).

## Next steps

- [The interface](interface.md): every panel, mode and tool.
- [Bones, slots and attachments](bones-and-slots.md): rigging by hand.
- [Poses and face controls](poses-and-faces.md): expressions and mouth shapes.
- [Lip-sync](lip-sync.md): make the character talk from an audio file.
