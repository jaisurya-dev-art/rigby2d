// SPDX-License-Identifier: MIT OR Apache-2.0
// Sprite sheets off the main thread: the dialog (spritesheetui.js) sends the project as a snapshot
// with its images as RGBA; the worker renders, packs and encodes the PNGs, reporting progress.

import { Skeleton } from '../core/model.js';
import { imageLookup } from '../core/draw.js';
import { buildSpriteSheet } from './spritesheet.js';
import { createGLFrameRenderer } from './glframes.js';

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
      // Drawn on the GPU when this thread has WebGL; the software renderer otherwise.
      renderer: createGLFrameRenderer,
      progress: (done, total) => {
        const now = Date.now();
        if (now - shown > 100 || done === total) {
          shown = now;
          self.postMessage({ progress: done / total, text: 'Frame {done} of {total}', vars: { done, total } });
        }
      },
    });
    // PNGs encode several at a time (the browser compresses them off this thread), in file order.
    const files = new Array(result.files.length);
    let next = 0;
    let encoded = 0;
    const pngs = result.files.filter((f) => f.png).length;
    const lane = async () => {
      while (next < result.files.length) {
        const k = next++;
        const f = result.files[k];
        files[k] = { path: f.path, bytes: f.png ? await encode(f.png) : new TextEncoder().encode(f.text) };
        if (f.png && ++encoded % 8 === 0) self.postMessage({ progress: 1, text: 'Encoding PNG {done} of {total}', vars: { done: encoded, total: pngs } });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(8, (self.navigator?.hardwareConcurrency ?? 4) - 1)) }, lane));
    self.postMessage({ done: true, files, summary: result.summary, gpu: result.gpu, gpuIssue: result.gpuIssue }, files.map((f) => f.bytes.buffer));
  } catch (err) {
    self.postMessage({ error: err.message ?? String(err) });
  }
};
