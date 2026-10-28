// SPDX-License-Identifier: MIT OR Apache-2.0
// Demo files for the browser editor and development: bundled with the editor (see demos.js).
// The desktop build uses demo-sources-remote.js instead (vite.config.js chooses).

import rigbytronUrl from '../../branding/rigbytron/rigbytron.rigby?url&no-inline';
import rigbytronThumb from '../../branding/rigbytron/thumbnail.png?url';
import nilaUrl from '../../branding/nila/nila.rigby?url&no-inline';
import nilaThumb from '../../branding/nila/thumbnail.png?url';
import sceneUrl from '../../branding/scene/scene.rigby?url&no-inline';
import sceneThumb from '../../branding/scene/thumbnail.png?url';

export const REMOTE = false;

export const SOURCES = {
  rigbytron: { url: rigbytronUrl, thumbnail: rigbytronThumb },
  nila: { url: nilaUrl, thumbnail: nilaThumb },
  scene: { url: sceneUrl, thumbnail: sceneThumb },
};
