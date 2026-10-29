// SPDX-License-Identifier: MIT OR Apache-2.0
// Phaser example: NILA and Rigbytron (the demo exports in branding/) as Phaser game objects, among
// ordinary Phaser sprites, text and graphics, with a crowd that shares one loaded skeleton.

import { rigbyPhaser } from '../runtimes/phaser/rigby-phaser.js';

const { RigbyPlugin } = rigbyPhaser(window.Phaser);

class Demo extends window.Phaser.Scene {
  preload() {
    this.load.rigby('nila', '../branding/nila/export/nila.skel', '../branding/nila/export/nila.atlas');
    this.load.rigby('rigbytron', '../branding/rigbytron/export/rigbytron.json', '../branding/rigbytron/export/rigbytron.atlas');
  }

  create() {
    const { width, height } = this.scale;
    // Phaser objects drawn before and after the skeletons, to show they share the frame.
    this.add.rectangle(width / 2, height - 40, width, 80, 0x2d4f7c);
    const crowd = [];
    for (let i = 0; i < 6; i++) {
      const extra = this.add.rigby(80 + i * 160, height - 70, 'nila', 'idle').setAlpha(0.55);
      extra.setScale(170 / extra.localBounds.height); // the demo rigs are drawn large: fit a height
      extra.state.update(extra.skeleton, i * 0.37); // out of step
      crowd.push(extra);
    }

    const nila = this.add.rigby(width * 0.36, height - 40, 'nila', 'wave');
    nila.setScale(430 / nila.localBounds.height);
    const names = nila.animationNames;
    let next = names.indexOf('wave');
    nila.setInteractive({ useHandCursor: true });
    nila.on('pointerdown', () => {
      next = (next + 1) % names.length;
      nila.play(names[next], true, 0.25);
      label.setText(`NILA: ${names[next]}`);
    });

    const robot = this.add.rigby(width * 0.72, height - 40, 'rigbytron', 'hold');
    robot.setScale(380 / robot.localBounds.height);
    robot.flipX = true;
    robot.queue('release', false, 0.2);
    robot.queue('hold', true, 0.2);
    robot.on('complete', (entry) => entry.name === 'hold' && robot.queue('release', false, 0.2) && robot.queue('hold', true, 0.2));

    const label = this.add.text(16, 16, `NILA: ${names[next]} (click her)`, { fontSize: '20px', color: '#ffffff' });
    const flash = this.add.text(width - 16, 16, '', { fontSize: '20px', color: '#ffcc55' }).setOrigin(1, 0);
    robot.on('event', (_entry, event) => {
      flash.setText(`⚡ ${event.name}`);
      this.time.delayedCall(400, () => flash.setText(''));
    });

    // A marker that follows NILA's head bone.
    const head = nila.skeleton.bones.find((b) => /head/i.test(b.name))?.name;
    const marker = this.add.circle(0, 0, 9, 0xffcc55).setStrokeStyle(2, 0x000000);
    this.events.on('postupdate', () => {
      const p = head && nila.boneWorld(head);
      if (p) marker.setPosition(p.x, p.y);
    });

    window.rigbyPhaserDemo = { scene: this, nila, robot, crowd, head };
  }
}

new window.Phaser.Game({
  type: window.Phaser.WEBGL,
  parent: 'game',
  width: 960,
  height: 600,
  backgroundColor: '#262626',
  plugins: { scene: [{ key: 'RigbyPlugin', plugin: RigbyPlugin, mapping: 'rigby' }] },
  scene: Demo,
});
