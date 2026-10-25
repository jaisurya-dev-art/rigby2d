// SPDX-License-Identifier: MIT OR Apache-2.0
// Texture atlas text files (the widely used ".atlas" text format).
//
// A file is a list of pages separated by blank lines. Each page starts with its image file name,
// followed by "key: value" header lines, then regions: a name line followed by "key: value" lines.
// Both the current format (bounds/offsets) and the legacy one (xy/size/orig/offset) are read.
//
// Assumptions to verify against real exports: `bounds`/`size` hold the region's unrotated size,
// and a region with `rotate: 90` (or `true`) is stored in the page rotated 90° counter-clockwise.

/**
 * @typedef {{ name: string, index: number, x: number, y: number, width: number, height: number,
 *   rotate: number, offsetX: number, offsetY: number, originalWidth: number, originalHeight: number,
 *   split: number[]|null, pad: number[]|null, extra: Record<string, string> }} AtlasRegion
 * @typedef {{ name: string, width: number, height: number, format: string, filter: string[],
 *   repeat: string, pma: boolean, scale: number|null, regions: AtlasRegion[], extra: Record<string, string> }} AtlasPage
 */

const ints = (v) => v.split(',').map((s) => Number(s.trim()));

/** Parses atlas text. Returns { pages }. */
export function parseAtlas(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const pages = [];
  let page = null;
  let region = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      page = null;
      region = null;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) {
      if (!page) {
        page = { name: line, width: 0, height: 0, format: 'RGBA8888', filter: ['Nearest', 'Nearest'], repeat: 'none', pma: false, scale: null, regions: [], extra: {} };
        pages.push(page);
      } else {
        region = { name: line, index: -1, x: 0, y: 0, width: 0, height: 0, rotate: 0, offsetX: 0, offsetY: 0, originalWidth: -1, originalHeight: -1, split: null, pad: null, extra: {} };
        page.regions.push(region);
      }
      continue;
    }
    if (!page) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (region) readRegionField(region, key, value);
    else readPageField(page, key, value);
  }
  for (const p of pages) {
    for (const r of p.regions) {
      if (r.originalWidth < 0) r.originalWidth = r.width;
      if (r.originalHeight < 0) r.originalHeight = r.height;
    }
  }
  return { pages };
}

function readPageField(page, key, value) {
  switch (key) {
    case 'size':
      [page.width, page.height] = ints(value);
      break;
    case 'format':
      page.format = value;
      break;
    case 'filter':
      page.filter = value.split(',').map((s) => s.trim());
      break;
    case 'repeat':
      page.repeat = value;
      break;
    case 'pma':
      page.pma = value === 'true';
      break;
    case 'scale':
      page.scale = Number(value);
      break;
    default:
      page.extra[key] = value;
  }
}

function readRegionField(r, key, value) {
  switch (key) {
    case 'bounds':
      [r.x, r.y, r.width, r.height] = ints(value);
      break;
    case 'offsets':
      [r.offsetX, r.offsetY, r.originalWidth, r.originalHeight] = ints(value);
      break;
    case 'xy':
      [r.x, r.y] = ints(value);
      break;
    case 'size':
      [r.width, r.height] = ints(value);
      break;
    case 'orig':
      [r.originalWidth, r.originalHeight] = ints(value);
      break;
    case 'offset':
      [r.offsetX, r.offsetY] = ints(value);
      break;
    case 'rotate':
      r.rotate = value === 'true' ? 90 : value === 'false' ? 0 : Number(value) || 0;
      break;
    case 'index':
      r.index = Number(value);
      break;
    case 'split':
      r.split = ints(value);
      break;
    case 'pad':
      r.pad = ints(value);
      break;
    default:
      r.extra[key] = value;
  }
}

/**
 * Where a region's pixels are: `src` is the rectangle occupied in the page image (rotated
 * footprint) and `dst` where the unrotated packed image goes inside a canvas of the original
 * size (y down, whitespace restored).
 */
export function regionPlacement(r) {
  const swap = Math.abs(r.rotate % 180) === 90;
  return {
    src: { x: r.x, y: r.y, width: swap ? r.height : r.width, height: swap ? r.width : r.height },
    dst: { x: r.offsetX, y: r.originalHeight - r.height - r.offsetY, width: r.width, height: r.height },
    rotate: r.rotate,
    originalWidth: r.originalWidth,
    originalHeight: r.originalHeight,
  };
}

/** The page `filter` (min, mag) for a project texture filter ('linear' or 'nearest'). */
export function atlasFilter(textureFilter) {
  return textureFilter === 'nearest' ? ['Nearest', 'Nearest'] : ['Linear', 'Linear'];
}

/**
 * The project texture filter of an atlas: 'nearest' when every page samples Nearest, else 'linear'.
 * Pages are judged by their first (min) filter, as the runtimes do. A page without a filter line is
 * Nearest by the format's default.
 */
export function textureFilterOf(pages) {
  return pages.length && pages.every((p) => p.filter?.[0]?.startsWith('Nearest')) ? 'nearest' : 'linear';
}

/** Writes pages in the current atlas format. */
export function writeAtlas(pages) {
  const out = [];
  for (const p of pages) {
    if (out.length) out.push('');
    out.push(p.name, `size: ${p.width}, ${p.height}`);
    if (p.format && p.format !== 'RGBA8888') out.push(`format: ${p.format}`);
    out.push(`filter: ${(p.filter ?? ['Linear', 'Linear']).join(', ')}`);
    if (p.repeat && p.repeat !== 'none') out.push(`repeat: ${p.repeat}`);
    if (p.pma) out.push('pma: true');
    if (p.scale) out.push(`scale: ${p.scale}`);
    for (const [k, v] of Object.entries(p.extra ?? {})) out.push(`${k}: ${v}`);
    for (const r of p.regions) {
      out.push(r.name, `bounds: ${r.x}, ${r.y}, ${r.width}, ${r.height}`);
      const ow = r.originalWidth ?? r.width;
      const oh = r.originalHeight ?? r.height;
      if (r.offsetX || r.offsetY || ow !== r.width || oh !== r.height) out.push(`offsets: ${r.offsetX ?? 0}, ${r.offsetY ?? 0}, ${ow}, ${oh}`);
      if (r.rotate) out.push(`rotate: ${r.rotate}`);
      if (r.index !== undefined && r.index !== -1) out.push(`index: ${r.index}`);
      if (r.split) out.push(`split: ${r.split.join(', ')}`);
      if (r.pad) out.push(`pad: ${r.pad.join(', ')}`);
      for (const [k, v] of Object.entries(r.extra ?? {})) out.push(`${k}: ${v}`);
    }
  }
  return out.join('\n') + '\n';
}
