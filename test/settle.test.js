import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VERSION_FIELD as V, readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';
import { hasPhysics, settlePhysics } from '../src/editor/render/settle.js';

// A bone pointing right with gravity physics: unsettled, it drops on the first frames.
const rig = (constraints) =>
  readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'tail', parent: 'root', length: 100 }],
    slots: [],
    constraints,
    skins: [{ name: 'default', attachments: {} }],
    animations: { idle: {} },
  }).skeleton;

const tailRotation = (sk, pose) => pose.world[1].rotation();

/** Rotation change of the tail between frame 0 and frame 1, as the renderer steps them. */
function firstFrameJump(sk, settle) {
  const pose = new Pose(sk);
  const state = new AnimationState();
  state.setAnimation(sk, 0, 'idle', false, 0);
  if (settle) settlePhysics(sk, state, pose, 24);
  state.apply(sk, pose);
  const frame0 = tailRotation(sk, pose);
  state.update(sk, 1 / 24);
  state.apply(sk, pose);
  return Math.abs(tailRotation(sk, pose) - frame0);
}

test('settle: physics rests before frame 0, so frame 1 does not drop', () => {
  const sk = rig([{ type: 'physics', name: 'p', bone: 'tail', rotate: 1, gravity: 20 }]);
  assert.ok(hasPhysics(sk));
  const raw = firstFrameJump(sk, false);
  const settled = firstFrameJump(sk, true);
  assert.ok(raw > 0.5, `without settling the tail drops on frame 1 (${raw}°)`);
  assert.ok(settled < raw / 20, `settled jump ${settled}° vs ${raw}°`);
});

test('settle: rigs without physics are left alone', () => {
  const sk = rig([]);
  assert.equal(hasPhysics(sk), false);
  assert.equal(hasPhysics(null, sk), false);
});
