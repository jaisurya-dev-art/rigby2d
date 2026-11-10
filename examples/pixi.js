// SPDX-License-Identifier: MIT OR Apache-2.0
// PixiJS example: NILA and Rigbytron (the demo exports in branding/) as PixiJS display objects among
// ordinary sprites, text and graphics: a blurred crowd sharing one loaded skeleton, a draggable
// NILA, and a star attached to Rigbytron's hand.

// PixiJS from its CDN; in a game, install it with npm (npm install pixi.js).
import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/dist/pixi.min.mjs';
import { rigbyPixi } from '../runtimes/pixi/rigby-pixi.js';

const { loadRigby, RigbySkeleton } = rigbyPixi(PIXI);

const app = new PIXI.Application();
await app.init({
  width: 960,
  height: 600,
  background: '#262626',
  antialias: true,
  preference: new URLSearchParams(location.search).has('webgpu') ? 'webgpu' : 'webgl',
});
document.getElementById('game').appendChild(app.canvas);

const [nilaData, robotData] = await Promise.all([
  loadRigby('../branding/nila/export/nila.skel', '../branding/nila/export/nila.atlas'),
  loadRigby('../branding/rigbytron/export/rigbytron.json', '../branding/rigbytron/export/rigbytron.atlas'),
]);

// Ground, drawn before the skeletons: they share the frame (and the batcher) with everything else.
app.stage.addChild(new PIXI.Graphics().rect(0, app.screen.height - 80, app.screen.width, 80).fill(0x2d4f7c));

/** Scales a skeleton so its setup pose is `height` pixels tall. */
const fit = (sk, height) => sk.scale.set(height / sk.getLocalBounds().height);

// A crowd from one loaded skeleton, out of step, behind a PixiJS blur filter.
const crowd = new PIXI.Container({ filters: [new PIXI.BlurFilter({ strength: 2 })], alpha: 0.55 });
for (let i = 0; i < 6; i++) {
  const extra = new RigbySkeleton(nilaData, { animation: 'idle' });
  fit(extra, 170);
  extra.position.set(80 + i * 160, app.screen.height - 70);
  extra.update(i * 0.37);
  crowd.addChild(extra);
}
app.stage.addChild(crowd);

// NILA: click for the next animation, drag to move her.
const nila = new RigbySkeleton(nilaData, { animation: 'wave' });
fit(nila, 430);
nila.position.set(app.screen.width * 0.36, app.screen.height - 40);
nila.eventMode = 'static';
nila.cursor = 'grab';
const names = nila.animationNames;
let next = names.indexOf('wave');
let drag = null;
nila.on('pointerdown', (e) => (drag = { x: e.global.x - nila.x, moved: false }));
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.on('pointermove', (e) => {
  if (!drag) return;
  if (Math.abs(e.global.x - drag.x - nila.x) > 2) drag.moved = true;
  if (drag.moved) nila.x = e.global.x - drag.x;
});
app.stage.on('pointerup', () => {
  if (drag && !drag.moved) {
    next = (next + 1) % names.length;
    nila.play(names[next], true, 0.25);
    label.text = `NILA: ${names[next]}`;
  }
  drag = null;
});
app.stage.addChild(nila);

// Rigbytron, flipped, holding and releasing in a loop.
const robot = new RigbySkeleton(robotData, { animation: 'hold' });
fit(robot, 380);
robot.scale.x *= -1;
robot.position.set(app.screen.width * 0.72, app.screen.height - 40);
robot.queue('release', false, 0.2);
robot.queue('hold', true, 0.2);
robot.on('complete', (entry) => {
  if (entry.name === 'hold') {
    robot.queue('release', false, 0.2);
    robot.queue('hold', true, 0.2);
  }
});
app.stage.addChild(robot);

// A star that rides a bone: it is a child of the skeleton, moved to the bone every update.
const hand = robotData.skeleton.bones.find((b) => /hand|fist|claw/i.test(b.name))?.name ?? robotData.skeleton.bones.at(-1).name;
const star = new PIXI.Graphics().star(0, 0, 5, 40, 18).fill(0xffcc55).stroke({ width: 4, color: 0x000000 });
robot.attachToBone(hand, star, { scale: false });

const style = { fontSize: 20, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' };
const label = new PIXI.Text({ text: `NILA: ${names[next]} (click or drag her)`, style });
label.position.set(16, 16);
const flash = new PIXI.Text({ text: '', style: { ...style, fill: 0xffcc55 } });
flash.anchor.set(1, 0);
flash.position.set(app.screen.width - 16, 16);
app.stage.addChild(label, flash);
robot.on('event', (_entry, event) => {
  flash.text = `⚡ ${event.name}`;
  setTimeout(() => (flash.text = ''), 400);
});

window.rigbyPixiDemo = { PIXI, app, nila, robot, crowd, star, hand };
