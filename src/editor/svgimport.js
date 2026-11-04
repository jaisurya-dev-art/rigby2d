// SPDX-License-Identifier: MIT OR Apache-2.0
// SVG drawings as layers: Inkscape layers, or the groups Affinity and Illustrator export, each drawn
// on its own at the chosen size, so io.importSvg can crop it and place it where it was drawn (like a
// PSD). Parsing and drawing need the DOM; svgSize and layerLabel are plain and tested under Node.

const INKSCAPE = 'http://www.inkscape.org/namespaces/inkscape';
const SERIF = 'http://www.serif.com/'; // Affinity's layer names
const UNITS = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, '': 1 };
const NOT_DRAWN = new Set(['defs', 'style', 'metadata', 'title', 'desc', 'script', 'namedview', 'sodipodi:namedview', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'filter', 'symbol', 'marker']);

/**
 * The drawing's size in CSS pixels from its root attributes: width / height (with units; a
 * percentage or none falls back to the viewBox), and the viewBox [x, y, w, h] it shows.
 */
export function svgSize({ width = null, height = null, viewBox = null } = {}) {
  const box = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vb = box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box : null;
  const length = (v) => {
    const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(v ?? '');
    return m ? Number(m[1]) * UNITS[(m[2] ?? '').toLowerCase()] : null;
  };
  let w = length(width);
  let h = length(height);
  if (vb) {
    if (w === null && h === null) [w, h] = [vb[2], vb[3]];
    else if (w === null) w = (h * vb[2]) / vb[3];
    else if (h === null) h = (w * vb[3]) / vb[2];
  }
  if (!(w > 0 && h > 0)) return null;
  return { width: w, height: h, viewBox: vb ?? [0, 0, w, h] };
}

/** A layer's name: Inkscape's label, Affinity's name, the id, or "layer N". */
export function layerLabel({ label = null, serif = null, id = null } = {}, index = 0) {
  const clean = (s) => (s ?? '').trim();
  return clean(label) || clean(serif) || (id && !/^(g|path|layer|_?x?\d)[\d_-]*$/i.test(id) ? clean(id) : '') || `layer ${index + 1}`;
}

/** Parses SVG text: { svg (the root element), size, layers: [{ el, name, hidden }] }, back to front. */
export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('not an SVG file');
  const size = svgSize({ width: svg.getAttribute('width'), height: svg.getAttribute('height'), viewBox: svg.getAttribute('viewBox') });
  if (!size) throw new Error('the SVG has no size (width, height or viewBox)');
  return { svg, size, layers: findLayers(svg) };
}

const drawn = (el) => el.nodeType === 1 && !NOT_DRAWN.has(el.localName) && !NOT_DRAWN.has(el.nodeName);
const isInkscapeLayer = (el) => el.localName === 'g' && el.getAttributeNS(INKSCAPE, 'groupmode') === 'layer';
const hiddenStyle = (el) => el.getAttribute('display') === 'none' || /(^|;)\s*display\s*:\s*none/.test(el.getAttribute('style') ?? '');

/**
 * The parts to import: Inkscape's innermost layers (sublayers are parts of their own); otherwise the
 * drawing's top-level groups and shapes, looking inside a single group that wraps everything.
 */
function findLayers(svg) {
  const all = [...svg.getElementsByTagName('*')].filter(isInkscapeLayer);
  let picked = all.filter((g) => ![...g.getElementsByTagName('*')].some(isInkscapeLayer));
  if (!picked.length) {
    let items = [...svg.children].filter(drawn);
    while (items.length === 1 && items[0].localName === 'g') items = [...items[0].children].filter(drawn);
    picked = items;
  }
  return picked.map((el, i) => ({
    el,
    name: layerLabel({ label: el.getAttributeNS(INKSCAPE, 'label'), serif: el.getAttributeNS(SERIF, 'id'), id: el.getAttribute('id') }, i),
    // Hidden in the drawing (it or a group around it): imported, but hidden in Rigby2D too.
    hidden: ancestors(el, svg).some(hiddenStyle),
  }));
}

function ancestors(el, root) {
  const out = [];
  for (let e = el; e && e !== root; e = e.parentElement) out.push(e);
  return out;
}

/**
 * Draws the drawing on a `width` × `height` canvas with only `keep` shown (null: only what is in no
 * layer). Hidden layers are shown when they are the one kept.
 */
export async function drawLayer({ svg, layers }, keep, width, height, viewBox) {
  const marks = layers.map((l, i) => {
    l.el.setAttribute('data-rigby-layer', String(i));
    return l;
  });
  const copy = svg.cloneNode(true);
  for (const l of marks) l.el.removeAttribute('data-rigby-layer');
  const index = keep === null ? -1 : layers.indexOf(keep);
  const hide = (el) => el.setAttribute('style', `${el.getAttribute('style') ?? ''};display:none`);
  let kept = null;
  for (const el of copy.querySelectorAll('[data-rigby-layer]')) {
    const i = Number(el.getAttribute('data-rigby-layer'));
    el.removeAttribute('data-rigby-layer');
    if (i === index) kept = el;
    else if (index < 0) hide(el); // the rest of the drawing: every layer hidden
  }
  if (kept) {
    // Only this layer: everything beside it, and beside each group around it, is hidden (other
    // layers and shapes outside any layer), and the groups around it are shown even if hidden.
    const chain = ancestors(kept, copy);
    for (const el of chain) {
      if (hiddenStyle(el)) show(el);
      for (const sibling of el.parentElement.children) if (sibling !== el && drawn(sibling) && !chain.includes(sibling)) hide(sibling);
    }
  }
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  copy.setAttribute('viewBox', viewBox.join(' '));
  copy.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function show(el) {
  if (el.getAttribute('display') === 'none') el.removeAttribute('display');
  const style = el.getAttribute('style');
  if (style) el.setAttribute('style', style.replace(/(^|;)\s*display\s*:\s*none\s*/g, '$1'));
}
