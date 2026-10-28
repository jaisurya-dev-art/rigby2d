// SPDX-License-Identifier: MIT OR Apache-2.0
// Workspaces: the way of working a project is set up for. A workspace only decides which tools,
// panels and menus the editor shows (and defaults for new projects); it never changes animation
// data, so exports are the same from either workspace and switching is always safe.
//
// - Game: rigging and animation for game engines and apps, exported as skeleton JSON / .skel +
//   atlas and played by the runtimes. The editor as it has always been.
// - Film: animation for film, video and motion graphics, rendered to image sequences and video:
//   output settings, rendering, face controls, timecode.

export const WORKSPACES = {
  game: {
    id: 'game',
    label: 'Game',
    description: 'Rig and animate for game engines and apps; export skeleton JSON or .skel with a texture atlas.',
    fps: 30,
    features: new Set(['poses']),
  },
  film: {
    id: 'film',
    label: 'Film',
    description: 'Animate for film, video and motion graphics; render image sequences and video.',
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

/** "01:02:03:04" (hours, minutes, seconds, frames) for a time in seconds at `fps`. */
export function timecode(seconds, fps) {
  const base = Math.max(1, Math.round(fps));
  const total = Math.round(seconds * fps);
  const frames = total % base;
  const s = Math.floor(total / base);
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames)}`;
}
