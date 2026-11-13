// SPDX-License-Identifier: MIT OR Apache-2.0
// Drag-and-drop reparenting in the tree: drag a bone row onto another bone to make that its parent,
// or onto the skeleton's title for the root. The bone keeps its place in the setup pose. Pointer
// events (like the draw order), not HTML drag and drop, so it works the same in the desktop app.

import * as edit from './edit.js';
import { t } from './i18n.js';
import { canReparent } from './treefind.js';

const START = 4; // pointer travel before a press turns into a drag, px

let drag = null; // the active gesture, or null

/** Makes a bone row draggable onto other bone rows (and onto elements with `data-drop-bone`). */
export function dragBoneRow(app, row, bone) {
  row.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0 || app.pick || e.target.closest('.twisty, .onion-bonebtn, button')) return;
    drag = { app, bone, row, pointerId: e.pointerId, x: e.clientX, y: e.clientY, started: false, target: null };
    row.setPointerCapture(e.pointerId);
  });
  row.addEventListener('pointermove', onMove);
  row.addEventListener('pointerup', onUp);
  row.addEventListener('pointercancel', onUp);
}

/** The skeleton section's title takes drops too: they parent the bone to the root. */
export function rootDropTarget(sectionEl) {
  const heading = sectionEl.querySelector('.tree-heading');
  if (heading) heading.dataset.dropBone = '0';
  return sectionEl;
}

function targetAt(d, x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.row[data-bone], [data-drop-bone]');
  if (!el) return null;
  const bone = Number(el.dataset.bone ?? el.dataset.dropBone);
  return canReparent(d.app.doc, d.bone, bone) ? { el, bone } : null;
}

function onMove(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  if (!d.started) {
    if (Math.abs(e.clientX - d.x) < START && Math.abs(e.clientY - d.y) < START) return;
    d.started = true;
    d.row.classList.add('dragging');
    document.body.classList.add('bone-dragging');
    // Set directly: setStatus would rebuild the tree under the drag.
    d.app.status = t('Drop on a bone to make it the parent, or on the skeleton title for the root. The bone keeps its place.');
  }
  const target = targetAt(d, e.clientX, e.clientY);
  if (target?.el !== d.target?.el) {
    d.target?.el.classList.remove('drop-target');
    target?.el.classList.add('drop-target');
  }
  d.target = target;
}

function onUp(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  drag = null;
  try {
    d.row.releasePointerCapture(d.pointerId);
  } catch {
    // Already released.
  }
  d.row.classList.remove('dragging');
  document.body.classList.remove('bone-dragging');
  d.target?.el.classList.remove('drop-target');
  if (!d.started) return;
  // The press ends as a drag: the row's click (select) does not run.
  window.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
  if (e.type !== 'pointerup' || !d.target) {
    d.app.setStatus('');
    return;
  }
  const doc = d.app.doc;
  const name = doc.bones[d.bone].name;
  edit.reparentBoneKeepWorld(d.app, d.bone, d.target.bone);
  d.app.setStatus(t('{bone} is now a child of {parent}', { bone: name, parent: doc.bones[d.target.bone]?.name ?? '' }));
}
