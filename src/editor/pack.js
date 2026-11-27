// SPDX-License-Identifier: MIT OR Apache-2.0
// Texture atlas packing.

const PAD = 2;
export const MAX_PAGE = 8192;

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Shelf-packs `items` ({ name, width, height }) into power-of-two pages of at most 8192px with 2px
 * padding. Everything goes on one page when it fits; otherwise full 8192px pages are filled in turn
 * and the rest goes on a last, smaller page. Returns { pages: [{ width, height, regions }] } with
 * each page's regions sorted by name.
 */
export function pack(items) {
  for (const it of items) {
    if (it.width + PAD * 2 > MAX_PAGE || it.height + PAD * 2 > MAX_PAGE) {
      throw new Error(`image '${it.name}' (${it.width}x${it.height}) does not fit in an ${MAX_PAGE}px atlas page`);
    }
  }
  const pages = [];
  let rest = items.map((_, i) => i).sort((a, b) => items[b].height - items[a].height);
  for (;;) {
    const single = packPage(items, rest);
    if (single) {
      pages.push(single);
      return { pages };
    }
    const { page, left } = fillPage(items, rest);
    pages.push(page);
    rest = left;
  }
}

const toPage = (items, width, height, placed) => ({
  width,
  height,
  regions: placed.map(({ i, x, y }) => ({ name: items[i].name, x, y, width: items[i].width, height: items[i].height })).sort(byName),
});

/** Packs `order` (indices, tallest first) on one page about twice as wide as tall, or null if it can't fit. */
function packPage(items, order) {
  const widest = order.reduce((m, i) => Math.max(m, items[i].width + PAD * 2), 1);
  let width = Math.max(256, nextPowerOfTwo(widest));
  for (;;) {
    let x = PAD;
    let y = PAD;
    let shelf = 0;
    const placed = [];
    for (const i of order) {
      const { width: w, height: h } = items[i];
      if (x + w + PAD > width) {
        x = PAD;
        y += shelf + PAD;
        shelf = 0;
      }
      placed.push({ i, x, y });
      x += w + PAD;
      shelf = Math.max(shelf, h);
    }
    const height = nextPowerOfTwo(y + shelf + PAD);
    if (height <= width * 2 || width >= MAX_PAGE) {
      if (width > MAX_PAGE || height > MAX_PAGE) return null;
      return toPage(items, width, height, placed);
    }
    width *= 2;
  }
}

/**
 * Fills one full-width page from `order` (tallest first). An item goes on the current shelf when it
 * fits across, else on a new shelf when that fits below; otherwise it waits for the next page.
 * Returns { page, left } with `left` still tallest first.
 */
function fillPage(items, order) {
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  const placed = [];
  const left = [];
  for (const i of order) {
    const { width: w, height: h } = items[i];
    // Items come tallest first, so one that fits across the current shelf also fits its height.
    if (placed.length && x + w + PAD <= MAX_PAGE) {
      placed.push({ i, x, y });
      x += w + PAD;
      continue;
    }
    const top = placed.length ? y + shelf + PAD : PAD;
    if (top + h + PAD > MAX_PAGE) {
      left.push(i);
      continue;
    }
    y = top;
    x = PAD;
    shelf = h;
    placed.push({ i, x, y });
    x += w + PAD;
  }
  return { page: toPage(items, MAX_PAGE, nextPowerOfTwo(y + shelf + PAD), placed), left };
}

/** The image of atlas page `index` for an export at `base` (path without extension): name.png, name2.png, ... */
export function pagePath(base, index) {
  return `${base}${index ? index + 1 : ''}.png`;
}
