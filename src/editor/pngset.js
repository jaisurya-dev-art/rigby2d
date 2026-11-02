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

/**
 * The files in drawing order, back to front. Photoshop numbers its exports from the top layer, so a
 * numbered set is reversed; other sets keep the order they were picked in.
 */
export function backToFront(names) {
  const order = names.map((n, i) => i);
  return names.length && names.every((n) => PHOTOSHOP.test(n)) ? order.sort((a, b) => names[b].localeCompare(names[a])) : order;
}
