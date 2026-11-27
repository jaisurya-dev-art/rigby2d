// SPDX-License-Identifier: MIT OR Apache-2.0
// Texture atlas packing.

const PAD = 2;
const MAX = 8192;

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Shelf-packs `items` ({ name, width, height }) into a power-of-two sheet with 2px padding, at most
 * `max` pixels on a side.
 * Returns { width, height, regions } with regions sorted by name.
 */
export function pack(items, max = MAX) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].height - items[a].height);
  const widest = items.reduce((m, it) => Math.max(m, it.width + PAD * 2), 1);
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
    if (height <= width * 2 || width >= max) {
      if (width > max || height > max) throw new Error(`images do not fit in an ${max}px atlas`);
      const regions = placed.map(({ i, x, y }) => ({ name: items[i].name, x, y, width: items[i].width, height: items[i].height }));
      regions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { width, height, regions };
    }
    width *= 2;
  }
}

/**
 * Packs `items` into as few atlas pages as it takes, each at most `max` pixels square: one page when
 * everything fits (the same result as `pack`), otherwise more, filled largest image first. Returns
 * a list of { width, height, regions }. An image too big for the padding around it (up to `max`
 * itself) gets a page of its own, at 0,0. Throws only when one image is bigger than a page.
 */
export function packPages(items, max = MAX) {
  try {
    return [pack(items, max)];
  } catch {
    // more than one page
  }
  for (const it of items) {
    if (it.width > max || it.height > max) {
      throw new Error(`image '${it.name}' (${it.width}x${it.height}) is bigger than an atlas page (${max}x${max} at most)`);
    }
  }
  const alone = (it) => it.width + PAD * 2 > max || it.height + PAD * 2 > max;
  const order = items.map((_, i) => i).sort((a, b) => items[b].width * items[b].height - items[a].width * items[a].height || a - b);
  const pages = [];
  for (const i of order) {
    const page = alone(items[i]) ? null : pages.find((p) => !alone(p[0]) && fits([...p, items[i]], max));
    if (page) page.push(items[i]);
    else pages.push([items[i]]);
  }
  return pages.map((p) => {
    if (!alone(p[0])) return pack(p, max);
    const { name, width, height } = p[0];
    return { width: nextPowerOfTwo(width), height: nextPowerOfTwo(height), regions: [{ name, x: 0, y: 0, width, height }] };
  });
}

function fits(items, max) {
  try {
    pack(items, max);
    return true;
  } catch {
    return false;
  }
}
