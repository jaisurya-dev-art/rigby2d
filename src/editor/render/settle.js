// SPDX-License-Identifier: MIT OR Apache-2.0
// Physics settling for renders: before the first frame is drawn, it is held for a few seconds of
// simulated time so hair, tails and cloth fall into their rest under gravity and wind instead of
// dropping into place on frame 1.

import { compileConstraints } from '../../core/constraints.js';

/** Seconds of physics simulated on the first frame before it is drawn. */
export const PHYSICS_SETTLE = 3;

/** True when any of the skeletons has a physics constraint. */
export function hasPhysics(...skeletons) {
  return skeletons.some((sk) => sk && compileConstraints(sk).some((c) => c.type === 'physics'));
}

/**
 * Holds `state`'s current time on `pose` for `seconds`, stepping physics at `fps`; `each(dt)` runs
 * after every step (scene actors step their own physics there). Returns the number of steps.
 */
export function settlePhysics(sk, state, pose, fps, seconds = PHYSICS_SETTLE, each = null) {
  const dt = 1 / fps;
  const steps = Math.round(seconds * fps);
  for (let i = 0; i < steps; i++) {
    state.physicsDelta = dt;
    state.apply(sk, pose);
    each?.(dt);
  }
  return steps;
}
