// SPDX-License-Identifier: MIT OR Apache-2.0
// A set of PNGs exported from a layered drawing ("Export layers to files" in Photoshop, Krita, Clip
// Studio and others): every file has the canvas size, with the layer drawn in place. Imported as such,
// each image is cropped to its visible pixels and placed where it was drawn, like the layers of a PSD,
// so AutoRig can rig them in one step. No DOM here: tests run it under Node.

/** Whether the images are layers of one canvas: two or more, all the same size. */
export function isLayerSet(sizes) {
  return sizes.length > 1 && sizes.every((s) => s.width === sizes[0].width && s.height === sizes[0].height);
}

/** The rectangle of pixels that are not fully transparent in RGBA `data`, or null when there are none. */
export function alphaBounds(data, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Where a cropped layer's center goes in world space: the canvas' bottom-center is the origin and y
 * points up, the same layout as a PSD import.
 */
export function layerCenter(bounds, canvasWidth, canvasHeight) {
  return [bounds.x + bounds.width * 0.5 - canvasWidth * 0.5, canvasHeight - (bounds.y + bounds.height * 0.5)];
}

// Photoshop's "Export Layers to Files" names files "_0000_Head.png", "_0001_Arm L.png", … counting
// from the top layer (groups add "s": "_0000s_0002_Hand.png").
const PHOTOSHOP = /^_?\d{4}s?_(?:\d{4}s?_)*/;

/** A layer's name from its file name: the extension, Photoshop's numbering and an order number
 *  ("07_pelvis", "12 - head") removed. */
export function layerName(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, '');
  return stem.replace(PHOTOSHOP, '').replace(/^\d+[\s_.-]+/, '') || stem;
}

/** The file name of a path (the desktop file picker gives full paths: "F:\art\07_head.png"). */
export function fileName(path) {
  return path.split(/[\\/]/).pop();
}

/**
 * Whether images are pixel art, and at what scale: the pixel size (1 to 4 source pixels per art
 * pixel), or 0 when they are not. Pixel art has hard edges (almost no semi-transparent pixels) and
 * a small palette; art exported at 2x to 4x is made of same-colored blocks. `images` are
 * { width, height, data (RGBA), x, y } with x, y the image's place on the canvas, so blocks line up
 * across layers. No DOM: tests run it under Node.
 */
export function pixelArtScale(images) {
  let solid = 0;
  let soft = 0;
  const colors = new Set();
  for (const { width, height, data } of images) {
    for (let i = 0; i < width * height * 4; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      solid++;
      if (a < 255) soft++;
      else if (colors.size <= MAX_PIXEL_COLORS) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  if (solid < 16 || soft > solid * 0.01 || colors.size > MAX_PIXEL_COLORS) return 0;
  // The largest block size every image is made of. Strict (0.1% of stray pixels): a flat area fits
  // bigger blocks too, and a few small details are exactly what a too-big grid would destroy.
  for (const k of [4, 3, 2]) {
    let same = 0;
    let total = 0;
    for (const { width, height, data, x: ox = 0, y: oy = 0 } of images) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (data[i + 3] === 0) continue;
          // The block's first pixel, in this image (blocks are aligned to the canvas).
          const bx = Math.max(0, x - ((x + ox) % k));
          const by = Math.max(0, y - ((y + oy) % k));
          const j = (by * width + bx) * 4;
          total++;
          if (data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2] && data[i + 3] === data[j + 3]) same++;
        }
      }
    }
    if (total && same >= total * 0.999) return k;
  }
  return 1;
}

/** More distinct colors than this is painted art, not a pixel-art palette. */
const MAX_PIXEL_COLORS = 512;

/**
 * The files in drawing order, back to front. Photoshop numbers its exports from the top layer, so a
 * numbered set is reversed; other sets keep the order they were picked in.
 */
export function backToFront(names) {
  const order = names.map((n, i) => i);
  return names.length && names.every((n) => PHOTOSHOP.test(n)) ? order.sort((a, b) => names[b].localeCompare(names[a])) : order;
}
