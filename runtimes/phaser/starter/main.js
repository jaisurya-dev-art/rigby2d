// Rigby2D Phaser starter: NILA on a stage. Arrow keys move her, Space waves, 1-9 switch her mood
// with a crossfade, and a ball follows her head bone. Replace assets/nila.* with your own export.
import { rigbyPhaser } from './rigby2d-phaser.mjs';

const { RigbyPlugin } = rigbyPhaser(window.Phaser);

class Stage extends window.Phaser.Scene {
  preload() {
    this.load.rigby('nila', 'assets/nila.skel', 'assets/nila.atlas');
  }

  create() {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height - 30, width, 60, 0x2d4f7c);

    this.nila = this.add.rigby(width / 2, height - 30, 'nila', 'idle');
    this.nila.setScale(380 / this.nila.localBounds.height);

    // Moods: every animation except idle and wave, on number keys.
    this.moods = this.nila.animationNames.filter((n) => n !== 'idle' && n !== 'wave');
    const help = `← → move   Space wave   1-${Math.min(9, this.moods.length)} ${this.moods.slice(0, 9).join(', ')}`;
    this.add.text(16, 14, help, { fontSize: '16px', color: '#dddddd', wordWrap: { width: width - 32 } });
    this.label = this.add.text(16, 64, 'idle', { fontSize: '22px', color: '#ffcc55' });

    this.keys = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-SPACE', () => this.play('wave', false));
    this.input.keyboard.on('keydown', (e) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < this.moods.length) this.play(this.moods[i], true);
    });
    // After a one-shot animation, go back to idle.
    this.nila.on('complete', (entry) => {
      if (!entry.looping) this.play('idle', true);
    });

    this.ball = this.add.circle(0, 0, 8, 0xffcc55);
  }

  play(name, loop) {
    this.nila.play(name, loop, 0.25);
    this.label.setText(name);
  }

  update(_time, delta) {
    const speed = 0.25 * delta;
    if (this.keys.left.isDown) {
      this.nila.x -= speed;
      this.nila.flipX = true;
    } else if (this.keys.right.isDown) {
      this.nila.x += speed;
      this.nila.flipX = false;
    }
    this.nila.x = window.Phaser.Math.Clamp(this.nila.x, 60, this.scale.width - 60);
    const head = this.nila.boneWorld('head');
    if (head) this.ball.setPosition(head.x, head.y - 150); // above her head
  }
}

new window.Phaser.Game({
  type: window.Phaser.WEBGL,
  width: 960,
  height: 540,
  backgroundColor: '#262626',
  plugins: { scene: [{ key: 'RigbyPlugin', plugin: RigbyPlugin, mapping: 'rigby' }] },
  scene: Stage,
});
