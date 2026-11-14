// SPDX-License-Identifier: MIT OR Apache-2.0
// Theme colours for the code that paints canvases (viewport, timeline, graph editor): the theme's
// CSS token when one is set (themes.js), otherwise the colour the caller gives, which is Rigby
// Dark's. Read once per theme and cached; a theme change ('themechange') clears the cache.

import { parseColor } from './themes.js';

const cache = new Map();

function read(name) {
  const doc = globalThis.document;
  if (!doc?.documentElement) return '';
  return getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
}

/** The theme's colour for token `name` (e.g. '--tl-bg'), or `fallback` when the theme sets none. */
export function canvasColor(name, fallback) {
  let value = cache.get(name);
  if (value === undefined) {
    value = parseColor(read(name)) ? read(name) : null;
    cache.set(name, value);
  }
  return value ?? fallback;
}

/** The same as [r, g, b, a] in 0..1, for WebGL; `fallback` is such an array too. */
export function canvasRgba(name, fallback) {
  const value = canvasColor(name, null);
  if (value === null) return fallback;
  const [r, g, b, a] = parseColor(value);
  return [r / 255, g / 255, b / 255, a];
}

globalThis.addEventListener?.('themechange', () => cache.clear());
