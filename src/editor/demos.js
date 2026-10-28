// SPDX-License-Identifier: MIT OR Apache-2.0
// The demo projects (File > Open demo): Hoverlabs characters, proprietary (see TRADEMARKS.md). The
// browser editor bundles them; the desktop app downloads them from the website when one is opened,
// so the signed app contains no character artwork ('@demo-sources' is chosen in vite.config.js).
// Adding one: its .rigby and a 480x360 thumbnail in branding/, an entry here and in both sources,
// and its files in site/vite.config.js.

import { REMOTE, SOURCES } from '@demo-sources';

/** Whether demos are downloaded from the website (the desktop app) rather than bundled. */
export const DEMOS_REMOTE = REMOTE;

export const DEMOS = [
  {
    id: 'rigbytron',
    name: 'Rigbytron',
    file: 'rigbytron.rigby',
    url: SOURCES.rigbytron.url,
    thumbnail: SOURCES.rigbytron.thumbnail,
    animation: 'release',
    description: 'The Rigby2D mascot: a robot rig with IK, a meshed body and its hold and release animations.',
  },
  {
    id: 'nila',
    name: 'NILA',
    file: 'nila.rigby',
    url: SOURCES.nila.url,
    thumbnail: SOURCES.nila.thumbnail,
    animation: 'wave',
    description: 'A layered character with bending meshes, physics on her braid and jhumkas, face poses, voice with viseme lip-sync, and the 70-second promo animation (Film workspace).',
  },
  {
    id: 'scene',
    name: 'Scene: NILA meets Rigbytron',
    file: 'scene.rigby',
    url: SOURCES.scene.url,
    thumbnail: SOURCES.scene.thumbnail,
    animation: 'meet',
    description: 'Scene composition: both characters as actors with clips (her line with its voice and lip-sync, then his hello in a robot voice and his slash), a painted multiplane stage with parallax and a moving camera.',
  },
];

export const demoById = (id) => DEMOS.find((d) => d.id === id) ?? DEMOS[0];
