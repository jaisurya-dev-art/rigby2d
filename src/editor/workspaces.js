// SPDX-License-Identifier: MIT OR Apache-2.0
// Workspaces: the way of working a project is set up for. A workspace only decides which tools,
// panels and menus the editor shows (and defaults for new projects); it never changes animation
// data, so exports are the same from either workspace and switching is always safe.
//
// - Game: rigging and animation for game engines and apps, exported as skeleton JSON / .skel +
//   atlas and played by the runtimes. The editor as it has always been.
// - Film: animation for film, video and motion graphics, rendered to image sequences and video:
//   output settings, rendering, face controls, timecode.
import { tn } from './i18n.js';

export const WORKSPACES = {
  game: {
    id: 'game',
    label: tn('Game'),
    description: tn('Rig and animate for game engines and apps; export skeleton JSON or .skel with a texture atlas.'),
    fps: 30,
    features: new Set(['poses']),
  },
  film: {
    id: 'film',
    label: tn('Film'),
    description: tn('Animate for film, video and motion graphics; render image sequences and video.'),
    fps: 24,
    features: new Set(['poses', 'output', 'render', 'faceControls', 'timecode', 'outputFrame', 'audio', 'scene']),
  },
};

export const WORKSPACE_IDS = Object.keys(WORKSPACES);

/** The workspace definition for an id (unknown ids are the game workspace). */
export function workspace(id) {
  return WORKSPACES[id] ?? WORKSPACES.game;
}

/** Whether the app's current workspace offers `feature`. */
export function has(app, feature) {
  return workspace(app.workspace).features.has(feature);
}

/** "02:03:04" (minutes, seconds, frames), with hours in front from one hour: "01:02:03:04". */
export function timecode(seconds, fps) {
  const base = Math.max(1, Math.round(fps));
  const total = Math.round(seconds * fps);
  const frames = total % base;
  const s = Math.floor(total / base);
  const pad = (v, n = 2) => String(v).padStart(n, '0');
  // Frames take as many digits as the frame rate needs (2 up to 99 fps).
  const ff = pad(frames, String(base - 1).length);
  // Hours only once there are any: minutes:seconds:frames keeps the timeline narrow.
  const head = s >= 3600 ? `${pad(Math.floor(s / 3600))}:` : '';
  return `${head}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${ff}`;
}
