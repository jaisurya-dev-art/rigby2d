// SPDX-License-Identifier: MIT OR Apache-2.0
// Output framing: frame rate and size presets, and where the output frame sits in the world
// (fitted to an animation automatically, or fixed by the project settings).

import { Pose } from '../core/pose.js';
import { tn } from './i18n.js';

export const FPS_PRESETS = [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 60];

export const SIZE_PRESETS = [
  [3840, 2160, '4K UHD'],
  [2560, 1440, 'QHD'],
  [1920, 1080, tn('Full HD')],
  [1280, 720, 'HD'],
  [2048, 858, '2K Scope'],
  [1998, 1080, '2K Flat'],
  [1080, 1920, tn('Vertical')],
  [1080, 1080, tn('Square')],
];

/** Margin left around an automatically framed animation, as a fraction of the frame. */
const AUTO_MARGIN = 0.05;

/**
 * World bounds [x0, y0, x1, y1] of everything visible while animation `anim` (an index, or null for
 * the setup pose) plays, sampled at `fps`. Null when nothing is drawn.
 */
export function animationBounds(doc, anim, fps) {
  const pose = new Pose(doc);
  const a = anim === null || anim === undefined ? null : doc.animations[anim];
  const frames = a ? Math.max(1, Math.round(a.duration * fps)) : 0;
  let b = null;
  for (let f = 0; f <= frames; f++) {
    pose.reset(doc);
    if (a) pose.apply(doc, a, Math.min(a.duration, f / fps), 1);
    pose.updateWorld(doc);
    for (const q of pose.quads(doc)) {
      if (q.color[3] <= 0) continue; // invisible: does not need to be in frame
      for (const [x, y] of q.positions) {
        if (!b) b = [x, y, x, y];
        else {
          if (x < b[0]) b[0] = x;
          if (y < b[1]) b[1] = y;
          if (x > b[2]) b[2] = x;
          if (y > b[3]) b[3] = y;
        }
      }
    }
  }
  return b;
}

/**
 * The output frame in world units (Y up): { cx, cy, scale, x0, y0, x1, y1 } where scale is world
 * units per output pixel. Fixed by the settings, or fitted to `bounds` (from `animationBounds`).
 */
export function outputFrame(settings, bounds) {
  const { width, height } = settings;
  let cx = 0;
  let cy = 0;
  let scale = 1;
  if (settings.frame) {
    ({ x: cx, y: cy, scale } = settings.frame);
  } else if (bounds) {
    cx = (bounds[0] + bounds[2]) / 2;
    cy = (bounds[1] + bounds[3]) / 2;
    const usable = 1 - 2 * AUTO_MARGIN;
    scale = Math.max((bounds[2] - bounds[0]) / (width * usable), (bounds[3] - bounds[1]) / (height * usable), 1e-6);
  }
  const hw = (width * scale) / 2;
  const hh = (height * scale) / 2;
  return { cx, cy, scale, x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

/** "1920×1080 · 24 fps" */
export function describeOutput(settings) {
  return `${settings.width}×${settings.height} · ${formatFps(settings.fps)} fps`;
}

export function formatFps(fps) {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '');
}

/** Parses "#rrggbb" into [r, g, b, 1]. */
export function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export function rgbaToHex(c) {
  return `#${c
    .slice(0, 3)
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}
