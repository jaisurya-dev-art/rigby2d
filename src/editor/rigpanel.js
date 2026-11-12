// SPDX-License-Identifier: MIT OR Apache-2.0
// The Rig panel: what a rig is built from besides its bones, gathered in one place. Skins,
// constraints by type, meshes and events, each with its add button.
// It is optional (View ▸ Panel layout): while it is open, the tree lists only the bone hierarchy,
// draw order, animations and images. The sections are the tree's own (tree.js), moved here, so
// nothing is built twice. The project settings stay in the inspector.

import { Mode, selSlot } from './app.js';
import { t } from './i18n.js';
import { startMeshEdit } from './inspector.js';
import { regionToMesh } from './meshtool.js';
import { addButton, constraintsSection, eventsSection, label, row, section, skinsSection } from './tree.js';
import { h } from './widgets.js';

/** Every mesh of the rig, as [slot index, attachment name, attachment]. */
function meshes(doc) {
  const out = [];
  doc.slots.forEach((slot, i) => {
    const names = new Set(slot.attachments.map((a) => a.name));
    if (doc.skin) for (const a of doc.skinAttachments(i, doc.skin)) names.add(a.name);
    for (const name of names) {
      const att = doc.attachment(i, name);
      if (att?.type === 'mesh' || att?.type === 'linkedmesh') out.push([i, name, att]);
    }
  });
  return out;
}

/** Meshes: click one to edit it; New turns the selected slot's image into a mesh. */
function meshSection(app) {
  const doc = app.doc;
  const list = meshes(doc);
  const s = selSlot(app.sel);
  const shown = s === null || s === undefined ? null : app.pose().attachment[s];
  const region = shown ? doc.attachment(s, shown) : null;
  const canConvert = app.mode === Mode.Setup && region?.type === 'region';
  const add = addButton(t('New'), {
    disabled: !canConvert,
    title: canConvert ? t('Turn the selected image into a mesh you can reshape and bind to bones') : t('Select a slot that shows an image (in Setup mode) to make it a mesh'),
    onclick: () => {
      regionToMesh(doc, s, region);
      startMeshEdit(app, s, region.name);
    },
  });
  const rows = list.map(([slot, name, att]) =>
    row(label('grid-2x2', name, att.type === 'linkedmesh'), {
      selected: app.meshEdit?.slot === slot && app.meshEdit?.name === name,
      title: doc.slots[slot].name,
      onclick: () => {
        app.select({ slot });
        if (att.type === 'mesh') startMeshEdit(app, slot, name);
      },
    }),
  );
  return section(app, 'meshes', t('Meshes'), list.length, rows, add);
}

/** Builds the Rig panel into `el` (rebuilt on every change, like the tree). */
export function render(app, el) {
  const scrolled = el.querySelector('.tree-scroll')?.scrollTop ?? 0;
  el.replaceChildren(
    h(
      'div',
      { class: 'tree-scroll scroll' },
      skinsSection(app),
      constraintsSection(app, { byType: true }),
      meshSection(app),
      eventsSection(app),
    ),
  );
  el.querySelector('.tree-scroll').scrollTop = scrolled;
}
