// SPDX-License-Identifier: MIT OR Apache-2.0
// The lessons, from the very basics. Every step is either an action (it moves on by itself the
// moment it is done) or an explanation (Next). Targets are fixed anchors (see targets.js), and each
// action has a `student`: how the arena does that step with real input, to prove it works.

import { isPractice, openPractice } from './practice.js';
import { choose, click, drag, dragEmpty, layerBox, menu, screenOf, wheel } from './student.js';

const boneIndex = (app, name) => app.doc.bones.findIndex((b) => b.name === name);
const selectedBone = (app) => (app.sel?.bone !== undefined ? app.doc.bones[app.sel.bone]?.name : null);
const selectedSlot = (app) => (app.sel?.slot !== undefined ? app.doc.slots[app.sel.slot]?.name : null);
const fps = (app) => app.doc.settings?.fps ?? 30;
const frame = (app) => Math.round(app.time * fps(app));
const keyAt = (app, name, f) => {
  const keys = app.currentAnimation()?.boneTimeline(boneIndex(app, name))?.rotate ?? [];
  return keys.some((k) => Math.abs(k.time * fps(app) - f) < 0.5);
};
const slotOn = (app, slot) => app.doc.slots.find((s) => s.name === slot)?.bone ?? 0;
/** The bones the user drew in lesson 3 (everything after the root). */
const drawn = (app) => app.doc.bones.slice(1).map((b) => b.name);

export const LESSONS = [
  {
    id: 'basics',
    title: '1 · Getting started',
    minutes: 4,
    summary: 'Find your way around: the viewport, the timeline, the tree, the inspector and the two modes.',
    steps: [
      {
        text: '<b>Welcome to Rigby2D!</b> In a few minutes you will know your way around. This lesson uses <b>Rigbytron</b>, the demo character. Nothing you do here can break anything. Click <b>Open Rigbytron</b> to begin.',
        action: { label: 'Open Rigbytron', run: ({ app }) => app.openDemo('rigbytron', true) },
        target: 'coach:action',
        done: ({ app }) => app.path === 'rigbytron.rigby',
        student: (ctx) => click(ctx, 'coach:action'),
      },
      {
        text: 'This big area is the <b>viewport</b>, where your character lives. Put the mouse over it and <b>turn the mouse wheel</b> to zoom in or out.',
        target: { area: 'viewport' },
        enter: ({ app, mark }) => (mark.zoom = app.view.zoom),
        done: ({ app, mark }) => Math.abs(app.view.zoom - mark.zoom) > 0.02,
        student: (ctx) => wheel(ctx, -240),
      },
      {
        text: 'Now <b>drag with the right mouse button</b> (or the middle one) to move the view around. Lost? <i>View ▸ Fit the skeleton in view</i> brings the character back.',
        target: { area: 'viewport' },
        enter: ({ app, mark }) => (mark.pan = [app.view.panX, app.view.panY]),
        done: ({ app, mark }) => Math.hypot(app.view.panX - mark.pan[0], app.view.panY - mark.pan[1]) > 20,
        student: async (ctx) => {
          const r = ctx.viewport.canvas.getBoundingClientRect();
          await drag(ctx, [r.left + r.width * 0.8, r.top + r.height * 0.3], [r.left + r.width * 0.65, r.top + r.height * 0.4], 2);
        },
      },
      {
        text: 'At the bottom is the <b>timeline</b>. Press <b>▶</b> to play or pause the animation. The <kbd>Space</kbd> key does the same.',
        target: 'timeline:play',
        enter: ({ app, mark }) => (mark.playing = app.playing),
        done: ({ app, mark }) => app.playing !== mark.playing,
        student: (ctx) => click(ctx, 'timeline:play'),
      },
      {
        text: 'A character can have many animations, and Rigbytron has two. Pick <b>hold</b> in this list.',
        target: 'timeline:animations',
        done: ({ app }) => app.currentAnimation()?.name === 'hold',
        student: (ctx) => choose(ctx, 'timeline:animations', 'hold'),
      },
      {
        text: 'On the right is the <b>tree</b>: the parts of the character. <b>Bones</b> 🦴 are the skeleton, <b>slots</b> ▣ hold the images 📎. Click the <b>head</b> bone 🦴.',
        target: 'bone:head',
        done: ({ app }) => selectedBone(app) === 'head',
        student: (ctx) => click(ctx, 'bone:head'),
      },
      {
        text: 'Below the tree, the <b>inspector</b> shows the details of what you selected: here, the head bone\'s name, parent, rotation, position and scale.',
        target: { area: 'inspector' },
        next: true,
      },
      {
        text: 'Rigby2D has two <b>modes</b>: <b>Setup</b> to build the character, <b>Animate</b> to make it move. Click this button to switch (or press <kbd>Tab</kbd>).',
        target: 'mode',
        enter: ({ app, mark }) => (mark.mode = app.mode),
        done: ({ app, mark }) => app.mode !== mark.mode,
        student: (ctx) => click(ctx, 'mode'),
      },
      {
        text: 'Two <b>workspaces</b> tailor the editor: <b>Game</b> for exporting to game engines, <b>Film</b> for rendering video. Switch whenever you like; it never changes your work.',
        target: 'workspaces',
        next: true,
      },
      {
        text: '<b>That\'s the tour!</b> Next you will rig your first character in five minutes. The lessons are always in <i>Help ▸ Tutorials</i>.',
        target: ['item:Tutorials…', 'menu:Help'],
        next: true,
      },
    ],
  },

  {
    id: 'autorig',
    title: '2 · Your first character',
    minutes: 5,
    summary: 'Turn a layered drawing into a moving character with AutoRig, then move it.',
    steps: [
      {
        text: 'A character starts as a <b>layered drawing</b>: one layer per body part. Normally you import your own PSD with <i>File ▸ Import ▸ PSD</i>. For practice, click <b>Load the practice character</b>.',
        action: { label: 'Load the practice character', run: ({ app }) => openPractice(app) },
        target: 'coach:action',
        done: ({ app }) => isPractice(app, false),
        student: (ctx) => click(ctx, 'coach:action'),
      },
      {
        text: 'Here are the layers in the tree: each one is a separate image, and nothing is connected yet. <b>Rigging</b> connects them with bones.',
        target: { area: 'tree' },
        next: true,
      },
      {
        text: 'Rigby2D can rig it for you. Open the <b>File</b> menu and choose <b>AutoRig artwork…</b>',
        target: ['item:AutoRig artwork…', 'menu:File'],
        done: () => !!document.querySelector('[data-tut="autorig:parts"]'),
        student: (ctx) => menu(ctx, 'File', 'AutoRig artwork…'),
      },
      {
        text: 'AutoRig read each layer\'s <b>name</b> to find the body part and its side; you could correct any of them in the list. These are right, so click <b>Generate rig</b>.',
        target: 'autorig:generate',
        done: ({ app }) => app.doc.bones.length > 1,
        student: (ctx) => click(ctx, 'autorig:generate'),
      },
      {
        text: '<b>Rigged!</b> The tree now has bones: hip, chest, head, arms and legs. Bones named <b>ik_…</b> are <b>handles</b>: move one and the whole arm or leg follows. Click <b>ik_hand_r</b> in the tree.',
        target: 'bone:ik_hand_r',
        done: ({ app }) => selectedBone(app) === 'ik_hand_r',
        student: (ctx) => click(ctx, 'bone:ik_hand_r'),
      },
      {
        text: 'Choose the <b>Translate</b> tool (or press <kbd>G</kbd>). It moves things.',
        target: 'tool:translate',
        done: ({ app }) => app.tool === 'translate',
        student: (ctx) => click(ctx, 'tool:translate'),
      },
      {
        text: 'Now <b>drag in an empty part of the viewport</b>. The hand (circled) follows the mouse and the elbow bends by itself. That is <b>IK</b>, inverse kinematics.',
        target: { bone: 'ik_hand_r' },
        enter: ({ app, mark }) => {
          const b = app.doc.bones[boneIndex(app, 'ik_hand_r')];
          mark.at = b ? [b.setup.x, b.setup.y] : null;
        },
        done: ({ app, mark }) => {
          const b = app.doc.bones[boneIndex(app, 'ik_hand_r')];
          return !!(b && mark.at && Math.hypot(b.setup.x - mark.at[0], b.setup.y - mark.at[1]) > 10);
        },
        student: (ctx) => dragEmpty(ctx, -40, -60),
      },
      {
        text: 'Made a mess? <b>Ctrl+Z</b> undoes it, as often as you like. Try the foot handle <b>ik_foot_l</b> (circled) too: it bends the knee.',
        target: { bone: 'ik_foot_l' },
        next: true,
      },
      {
        text: '<b>Your character is rigged.</b> Everything AutoRig made is ordinary rig data that you can edit. Next: building bones by hand, then animating.',
        next: true,
      },
    ],
  },

  {
    id: 'bones',
    title: '3 · Bones and images by hand',
    minutes: 6,
    summary: 'Draw bones yourself and attach images to them. This is what AutoRig does for you.',
    steps: [
      {
        text: 'AutoRig is quick, but it helps to know what it does, so let\'s rig by hand. Click <b>Load the practice character</b> (loose layers, no bones).',
        action: { label: 'Load the practice character', run: ({ app }) => openPractice(app) },
        target: 'coach:action',
        done: ({ app }) => isPractice(app, false),
        student: (ctx) => click(ctx, 'coach:action'),
      },
      {
        text: 'Bones are drawn in <b>Setup</b> mode. If the button at the top says ANIMATE, click it to switch to SETUP.',
        target: 'mode',
        done: ({ app }) => app.mode === 'setup',
        student: async (ctx) => {
          if (ctx.app.mode !== 'setup') await click(ctx, 'mode');
        },
      },
      {
        text: 'Choose the <b>Create</b> tool (or press <kbd>B</kbd>).',
        target: 'tool:create',
        done: ({ app }) => app.tool === 'create',
        student: (ctx) => click(ctx, 'tool:create'),
      },
      {
        text: '<b>Drag in the viewport</b> from the character\'s hips up to the bottom of the neck. That draws the first bone, the <b>spine</b>.',
        target: { area: 'viewport' },
        enter: ({ app, mark }) => (mark.count = app.doc.bones.length),
        done: ({ app, mark }) => app.doc.bones.length > mark.count,
        student: async (ctx) => {
          const t = layerBox(ctx, 'torso');
          await drag(ctx, screenOf(ctx, [t.x, t.y - t.hh * 0.6]), screenOf(ctx, [t.x, t.y + t.hh * 0.8]));
        },
      },
      {
        text: 'The new bone is selected, so the next one becomes its <b>child</b>. Drag again, from the neck up to the top of the head.',
        target: { area: 'viewport' },
        enter: ({ app, mark }) => (mark.count = app.doc.bones.length),
        done: ({ app, mark }) => app.doc.bones.length > mark.count,
        student: async (ctx) => {
          const t = layerBox(ctx, 'torso');
          const hd = layerBox(ctx, 'head');
          await drag(ctx, screenOf(ctx, [t.x, t.y + t.hh * 0.8]), screenOf(ctx, [hd.x, hd.y + hd.hh * 0.8]));
        },
      },
      {
        text: 'Now attach the images. Click the <b>torso</b> slot ▣ in the tree.',
        target: 'slot:torso',
        done: ({ app }) => selectedSlot(app) === 'torso',
        student: (ctx) => click(ctx, 'slot:torso'),
      },
      {
        text: 'In the inspector, open the <b>Bone</b> list and pick your first bone (the spine; it is called <b>bone</b> unless you renamed it). The torso is now attached to it.',
        target: 'slot-bone',
        done: ({ app }) => slotOn(app, 'torso') !== 0,
        student: (ctx) => choose(ctx, 'slot-bone', drawn(ctx.app)[0]),
      },
      {
        text: 'Same for the head: click the <b>head</b> slot ▣, then set its <b>Bone</b> to your second bone.',
        target: ({ app }) => (selectedSlot(app) === 'head' ? 'slot-bone' : 'slot:head'),
        done: ({ app }) => slotOn(app, 'head') !== 0,
        student: async (ctx) => {
          await click(ctx, 'slot:head');
          await choose(ctx, 'slot-bone', drawn(ctx.app)[1]);
        },
      },
      {
        text: 'Test it. Choose <b>Rotate</b> (<kbd>R</kbd>), click your spine bone in the tree, then drag in an empty part of the viewport. Torso and head turn together: the head bone is a child of the spine.',
        target: ({ app }) => (app.tool !== 'rotate' ? 'tool:rotate' : `bone:${drawn(app)[0]}`),
        enter: ({ app, mark }) => (mark.rot = app.doc.bones.map((b) => b.setup.rotation)),
        done: ({ app, mark }) => app.doc.bones.some((b, i) => i > 0 && i < mark.rot.length && Math.abs(b.setup.rotation - mark.rot[i]) > 3),
        student: async (ctx) => {
          await click(ctx, 'tool:rotate');
          await click(ctx, `bone:${drawn(ctx.app)[0]}`);
          await dragEmpty(ctx, 0, 80);
        },
      },
      {
        text: '<b>That is rigging:</b> bones in a hierarchy, with images attached to them. AutoRig does the same for every part and adds meshes and IK. Next: making it move.',
        next: true,
      },
    ],
  },

  {
    id: 'animate',
    title: '4 · Your first animation',
    minutes: 6,
    summary: 'Make the character nod: keys, frames, Auto key and playback.',
    steps: [
      {
        text: 'Animation is <b>poses at moments in time</b>; Rigby2D fills in the movement between them. Click <b>Load the rigged practice character</b>.',
        action: { label: 'Load the rigged practice character', run: ({ app }) => openPractice(app, { rigged: true }) },
        target: 'coach:action',
        // The AutoRig-made practice rig (the lesson animates its head), not lesson 3's hand-drawn one.
        done: ({ app }) => isPractice(app, true) && boneIndex(app, 'head') > 0 && boneIndex(app, 'ik_hand_r') > 0 && app.doc.animations.length === 0,
        student: (ctx) => click(ctx, 'coach:action'),
      },
      {
        text: 'Click <b>＋ New</b> in the timeline to start an animation. Rigby2D switches to <b>Animate</b> mode for you.',
        target: 'timeline:new',
        done: ({ app }) => app.doc.animations.length > 0 && app.mode === 'animate',
        student: (ctx) => click(ctx, 'timeline:new'),
      },
      {
        text: 'Turn on <b>Auto key</b>: from now on every change you make is saved as a <b>key</b>, a pose at the current frame.',
        target: 'autokey',
        done: ({ app }) => app.autoKey,
        student: (ctx) => click(ctx, 'autokey'),
      },
      {
        text: 'Click the <b>head</b> bone 🦴 in the tree, then press <b>◆ Key</b> (or <kbd>K</kbd>) to store the head\'s starting pose at <b>frame 0</b>.',
        target: ({ app }) => (selectedBone(app) === 'head' ? 'timeline:key' : 'bone:head'),
        done: ({ app }) => keyAt(app, 'head', 0),
        student: async (ctx) => {
          await click(ctx, 'bone:head');
          await click(ctx, 'timeline:key');
        },
      },
      {
        text: 'Move to around <b>frame 15</b>: click <b>▶|</b> (or press <kbd>→</kbd>) until the timeline says frame 15. Anything from 10 to 20 is fine.',
        target: 'timeline:next',
        done: ({ app }) => frame(app) >= 10 && frame(app) <= 20,
        student: async (ctx) => {
          for (let i = 0; i < 15; i++) await click(ctx, 'timeline:next');
        },
      },
      {
        text: 'Choose <b>Rotate</b> (<kbd>R</kbd>) and <b>drag in an empty part of the viewport</b> to tilt the head. With Auto key on, that sets a key at this frame.',
        target: 'tool:rotate',
        done: ({ app }) => frame(app) > 0 && keyAt(app, 'head', frame(app)),
        student: async (ctx) => {
          await click(ctx, 'tool:rotate');
          await dragEmpty(ctx, 0, 70);
        },
      },
      {
        text: 'Go on to around <b>frame 30</b> with <b>▶|</b> and tilt the head back. Every key shows as a diamond ◆ in the timeline.',
        target: 'timeline:next',
        enter: ({ app, mark }) => (mark.from = frame(app)),
        done: ({ app, mark }) => frame(app) >= mark.from + 10 && keyAt(app, 'head', frame(app)),
        student: async (ctx) => {
          for (let i = 0; i < 15; i++) await click(ctx, 'timeline:next');
          await dragEmpty(ctx, 0, -70);
        },
      },
      {
        text: 'Press <b>▶</b> (or <kbd>Space</kbd>). The character nods: Rigby2D drew every frame between your keys.',
        target: 'timeline:play',
        done: ({ app }) => app.playing,
        student: (ctx) => click(ctx, 'timeline:play'),
      },
      {
        text: '<b>You made an animation.</b> Save it with <i>File ▸ Save</i>. Next you can animate the arms with the <b>ik_…</b> handles, smooth the motion in the <b>Graph</b> view, or render a video in the <b>Film</b> workspace.',
        next: true,
      },
    ],
  },
];
