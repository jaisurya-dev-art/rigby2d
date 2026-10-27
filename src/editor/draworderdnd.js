// SPDX-License-Identifier: MIT OR Apache-2.0
// Drag-and-drop reordering for the Draw order list. While a row is dragged, a side viewer
// shows the slot being moved between the two slots it will sit between once dropped, so the
// resulting stacking (front at the top, back at the bottom) is visible before releasing.

import { h, widgetState } from './widgets.js';

const THUMB = 52; // preview thumbnail size, px
const START = 4; // pointer travel before a click turns into a drag, px

let drag = null; // the active gesture, or null when idle

/**
 * Wires pointer-drag reordering onto a slot row in the Draw order list.
 * `handle` is the slot row element, `from` its draw-order index, `n` the slot count.
 * The row keeps its own `onclick` for selection: a press that does not travel stays a click.
 */
export function dragOrderRow(app, handle, from, n) {
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

  // Park the viewer beside the list, flipping to the other side if it would overflow.
  const vr = d.viewer.getBoundingClientRect();
  let x = lr.right + 12;
  if (x + vr.width > win.innerWidth - 8) x = lr.left - vr.width - 12;
  x = Math.max(8, x);
  const top = Math.max(8, Math.min(y - vr.height / 2, win.innerHeight - vr.height - 8));
  Object.assign(d.viewer.style, { left: `${x}px`, top: `${top}px` });
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
  return h(
    'div',
    { class: `ov-cell ov-${role}` },
    h('div', { class: 'ov-thumb' }, canvas ?? h('span', { class: 'ov-noimg' }, '▣')),
    h('div', { class: 'ov-name', title: name }, name),
  );
}

/** A square thumbnail of a slot's visible attachment, or null when it has no image. */
function thumb(app, pose, slot) {
  const doc = app.doc;
  const name = pose.attachment[slot] ?? doc.slots[slot].attachment;
  const att = name ? doc.attachment(slot, name) : null;
  const src = att && att.image ? app.images.get(att.image) : null;
  if (!src || !src.width || !src.height) return null;
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
  widgetState.dragging = false;
}
