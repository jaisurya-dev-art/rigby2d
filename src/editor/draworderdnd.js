// SPDX-License-Identifier: MIT OR Apache-2.0
// Drag-and-drop reordering for the Draw order list. While a row is dragged, a side viewer
// shows the slot being moved between the two slots it will sit between once dropped, so the
// resulting stacking (front at the top, back at the bottom) is visible before releasing.

import { h, widgetState } from './widgets.js';

const THUMB = 52; // preview thumbnail size, px
const START = 4; // pointer travel before a click turns into a drag, px

/**
 * Glow colour per role, one source of truth for the viewport render and the preview card so they
 * match: a distinct hue tells the three images apart (drawn in front / moving / drawn behind).
 */
export const GLOW_COLORS = {
  above: 'rgb(95,220,130)', // ends up drawn in front (top cell)
  dragged: 'rgb(95,185,255)', // the slot being moved (middle cell)
  below: 'rgb(255,165,90)', // ends up drawn behind (bottom cell)
};

let drag = null; // the active gesture, or null when idle

/**
 * Wires pointer-drag reordering onto a slot row in the Draw order list.
 * `handle` is the slot row element, `from` its draw-order index, `n` the slot count.
 * The row keeps its own `onclick` for selection: a press that does not travel stays a click.
 */
export function dragOrderRow(app, handle, from, n) {
  // A detached panel has no image pixels until it asks for them: warm this slot's image now so its
  // thumbnail is ready for the first drag (a no-op in the editor window, where images are loaded).
  const setup = app.doc.slots[from]?.attachment;
  const warm = setup ? app.doc.attachment(from, setup) : null;
  if (warm && warm.image) app.ensureImage(warm.image);

  handle.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0 || n < 2) return;
    drag = { app, from, n, handle, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, started: false };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

function onMove(e) {
  const d = drag;
  if (!d) return;
  if (!d.started) {
    if (Math.abs(e.clientX - d.startX) < START && Math.abs(e.clientY - d.startY) < START) return;
    startDrag(d);
  }
  update(d, e.clientY);
}

function onUp(e) {
  const d = drag;
  if (!d) return;
  try {
    d.handle.releasePointerCapture(d.pointerId);
  } catch {
    /* capture may already be gone */
  }
  if (d.started) {
    const { to } = computeDrop(d, e.clientY);
    cleanup(d);
    if (to !== d.from) {
      d.app.doc.moveSlot(d.from, to);
      d.app.select({ slot: to });
    } else {
      d.app.changed(); // nothing moved: just rebuild the frozen panel
    }
    // Swallow the click this drag would otherwise fire, so it does not re-select. `once`
    // removes it when that click lands; the timeout removes it if the browser fires no click,
    // so it can never eat a later, unrelated click.
    const docu = d.handle.ownerDocument;
    const swallow = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    docu.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => docu.removeEventListener('click', swallow, true), 400);
  }
  drag = null;
}

function startDrag(d) {
  d.started = true;
  widgetState.dragging = true; // freeze the panel rebuild for the whole gesture
  d.list = d.handle.closest('.order-list');
  d.rows = [...d.list.querySelectorAll('.order-row')]; // visual order, top (front) to bottom (back)
  d.handle.closest('.order-row').classList.add('dragging');
  const body = d.handle.ownerDocument.body;
  d.line = h('div', { class: 'order-dropline' });
  d.viewer = h('div', { class: 'order-viewer' });
  body.append(d.line, d.viewer);
}

/**
 * Maps the pointer to an insertion gap and the resulting neighbours.
 * Rows are top (front) to bottom (back); the dragged row is excluded from the neighbour list
 * so it can never appear as its own neighbour. `to` is the index to pass to moveSlot.
 */
function computeDrop(d, y) {
  const rows = d.rows;
  const n = d.n;
  let gf = rows.length; // full gap: below everything by default
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k].getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      gf = k;
      break;
    }
  }
  const dv = rows.findIndex((el) => +el.dataset.slot === d.from); // dragged row's visual position
  const gv = gf <= dv ? gf : gf - 1; // gap once the dragged row is taken out
  const rest = rows.map((el) => +el.dataset.slot).filter((s) => s !== d.from);
  const above = gv > 0 ? rest[gv - 1] : null; // ends up in front of the dropped slot
  const below = gv < rest.length ? rest[gv] : null; // ends up behind it
  const to = n - 1 - gv; // visual gap -> slot index (slots run back..front)
  return { gf, above, below, to };
}

function update(d, y) {
  const { gf, above, below } = computeDrop(d, y);
  const lr = d.list.getBoundingClientRect();
  const win = d.handle.ownerDocument.defaultView;

  // Glow the same three images in the viewport (shared, so it shows even with the Tree detached).
  d.app.setImageGlow({ above, dragged: d.from, below });

  // Insertion line across the list at the chosen gap.
  const lineY = gf === 0 ? d.rows[0].getBoundingClientRect().top : d.rows[gf - 1].getBoundingClientRect().bottom;
  Object.assign(d.line.style, { left: `${lr.left + 2}px`, width: `${lr.width - 4}px`, top: `${lineY}px` });

  // Side viewer: in front (top), the moving slot (middle), behind (bottom).
  const pose = d.app.pose();
  d.viewer.replaceChildren(
    h('div', { class: 'ov-cap' }, '▲ In front'),
    cell(d.app, pose, above, 'above'),
    h('div', { class: 'ov-seam' }),
    cell(d.app, pose, d.from, 'dragged'),
    h('div', { class: 'ov-seam' }),
    cell(d.app, pose, below, 'below'),
    h('div', { class: 'ov-cap' }, '▼ Behind'),
  );

  placeViewer(d, y, lr, win);
}

// Viewer placement, in px.
const GAP = 12; // space between the viewer and the list
const EDGE = 8; // keep this clear of the window edges
const FULL = 148; // the viewer's natural width (matches the CSS)
const MIN = 100; // below this it is unreadable, so hide it instead
const NAMES = 150; // width the row names are assumed to take before the overlay may start

/**
 * Parks the viewer near the list. First choice is the full card in the gutter beside the list
 * (right, else left): this is the docked panel, with the canvas or another panel alongside.
 * A detached panel fills its own window and has no gutter: there the names sit at the left, so
 * the viewer overlays the empty strip to their right, anchored a fixed distance from the rows
 * (never flung to the window edge) and shrunk to fit, or hidden when even that is too narrow,
 * leaving the insertion line to show the drop.
 */
function placeViewer(d, y, lr, win) {
  const v = d.viewer;
  const winW = win.innerWidth;
  let width = FULL;
  let x;
  if (winW - EDGE - (lr.right + GAP) >= FULL) {
    x = lr.right + GAP; // gutter on the right
  } else if (lr.left - GAP - EDGE >= FULL) {
    x = lr.left - FULL - GAP; // gutter on the left
  } else {
    x = lr.left + NAMES + GAP; // no gutter: overlay the empty strip past the names
    if (x + width > winW - EDGE) width = winW - EDGE - x;
    if (width < MIN) {
      v.style.display = 'none';
      return;
    }
  }
  v.style.display = '';
  v.style.width = `${width}px`;
  const vh = v.getBoundingClientRect().height;
  const top = Math.max(EDGE, Math.min(y - vh / 2, win.innerHeight - vh - EDGE));
  Object.assign(v.style, { left: `${Math.max(EDGE, x)}px`, top: `${top}px` });
}

function cell(app, pose, slot, role) {
  if (slot == null) {
    return h(
      'div',
      { class: `ov-cell ov-empty ov-${role}` },
      h('span', { class: 'ov-empty-icon' }, '∅'),
      h('span', { class: 'ov-empty-text' }, role === 'above' ? 'Nothing in front' : 'Nothing behind'),
    );
  }
  const name = app.doc.slots[slot].name;
  const canvas = thumb(app, pose, slot);
  // A left bar in the cell's glow colour, so the card is a legend for the viewport glow.
  return h(
    'div',
    { class: `ov-cell ov-${role}`, style: { borderLeft: `3px solid ${GLOW_COLORS[role]}` } },
    h('div', { class: 'ov-thumb' }, canvas ?? h('span', { class: 'ov-noimg' }, '▣')),
    h('div', { class: 'ov-name', title: name }, name),
  );
}

/** A square thumbnail of a slot's visible attachment, or null when it has no image. */
function thumb(app, pose, slot) {
  const doc = app.doc;
  const name = pose.attachment[slot] ?? doc.slots[slot].attachment;
  const att = name ? doc.attachment(slot, name) : null;
  if (!att || !att.image) return null;
  const src = app.images.get(att.image);
  if (!src || !src.width || !src.height) {
    app.ensureImage(att.image); // detached panel: pull the pixels from the editor; it redraws on arrival
    return null;
  }
  const c = document.createElement('canvas');
  c.width = THUMB;
  c.height = THUMB;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const s = Math.min(THUMB / src.width, THUMB / src.height);
  const w = src.width * s;
  const hgt = src.height * s;
  ctx.drawImage(src, (THUMB - w) / 2, (THUMB - hgt) / 2, w, hgt);
  return c;
}

function cleanup(d) {
  d.line?.remove();
  d.viewer?.remove();
  d.handle.closest('.order-row')?.classList.remove('dragging');
  d.app.setImageGlow(null);
  widgetState.dragging = false;
}
