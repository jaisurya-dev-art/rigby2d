// SPDX-License-Identifier: MIT OR Apache-2.0
// The demo projects bundled with the editor (File > Open demo): Hoverlabs characters, proprietary
// (see TRADEMARKS.md). Adding one: its .rigby and a 480x360 thumbnail in branding/, and an entry here.

import rigbytronUrl from '../../branding/rigbytron/rigbytron.rigby?url&no-inline';
import rigbytronThumb from '../../branding/rigbytron/thumbnail.png?url';
import nilaUrl from '../../branding/nila/nila.rigby?url&no-inline';
import nilaThumb from '../../branding/nila/thumbnail.png?url';
import sceneUrl from '../../branding/scene/scene.rigby?url&no-inline';
import sceneThumb from '../../branding/scene/thumbnail.png?url';

export const DEMOS = [
  {
    id: 'rigbytron',
    name: 'Rigbytron',
    file: 'rigbytron.rigby',
    url: rigbytronUrl,
    thumbnail: rigbytronThumb,
    animation: 'release',
    description: 'The Rigby2D mascot: a robot rig with IK, a meshed body and its hold and release animations.',
  },
  {
    id: 'nila',
    name: 'NILA',
    file: 'nila.rigby',
    url: nilaUrl,
    thumbnail: nilaThumb,
    animation: 'wave',
    description: 'A layered character with bending meshes, physics on her braid and jhumkas, face poses, voice with viseme lip-sync, and the 70-second promo animation (Film workspace).',
  },
  {
    id: 'scene',
    name: 'Scene: NILA meets Rigbytron',
    file: 'scene.rigby',
    url: sceneUrl,
    thumbnail: sceneThumb,
    animation: 'meet',
    description: 'Scene composition: both characters as actors with clips (her line with its voice and lip-sync, his slash), a painted multiplane stage with parallax and a moving camera.',
  },
];

export const demoById = (id) => DEMOS.find((d) => d.id === id) ?? DEMOS[0];
