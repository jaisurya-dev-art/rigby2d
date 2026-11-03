// SPDX-License-Identifier: MIT OR Apache-2.0
// Sprite sheets off the main thread: the dialog (spritesheetui.js) sends the project as a snapshot
// with its images as RGBA; the worker renders, packs and encodes the PNGs, reporting progress.

import { Skeleton } from '../core/model.js';
import { imageLookup } from '../core/draw.js';
import { buildSpriteSheet } from './spritesheet.js';

async function encode({ width, height, rgba }) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

self.onmessage = async (e) => {
  const { snapshot, images, options } = e.data;
  try {
    const doc = Skeleton.fromObject(JSON.parse(snapshot));
    const lookup = imageLookup(new Map(images.map((i) => [i.name, { width: i.width, height: i.height, data: new Uint8ClampedArray(i.data), pma: false }])));
    let shown = 0;
    const result = buildSpriteSheet(doc, lookup, {
      ...options,
      progress: (done, total) => {
        const now = Date.now();
        if (now - shown > 100 || done === total) {
          shown = now;
          self.postMessage({ progress: done / total, text: `Frame ${done} of ${total}` });
        }
      },
    });
    const files = [];
    for (const [k, f] of result.files.entries()) {
      if (f.png && k % 8 === 0) self.postMessage({ progress: 1, text: `Encoding ${f.path}` });
      files.push({ path: f.path, bytes: f.png ? await encode(f.png) : new TextEncoder().encode(f.text) });
    }
    self.postMessage({ done: true, files, summary: result.summary }, files.map((f) => f.bytes.buffer));
  } catch (err) {
    self.postMessage({ error: err.message ?? String(err) });
  }
};
