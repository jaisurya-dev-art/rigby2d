// SPDX-License-Identifier: MIT OR Apache-2.0
// The bone inspector's warp deformer section (warp.js): add a lattice over the bone's meshes, edit
// it in the viewport (warptool.js), resize its grid (keeping its deformation), nest it in another
// warp, add a child warp over one of its meshes, delete it.

import { Mode } from './app.js';
import { t } from './i18n.js';
import { regionToGrid } from './turn.js';
import { button, hint, iconButton, section } from './ui.js';
import { bakeWarps, createWarp, removeWarp, resizeWarp } from './warp.js';
import { dragValue, h, select } from './widgets.js';

/** Replaces an attachment wherever it is listed (default skin and other skins). */
function replaceAttachment(doc, old, neu) {
  const lists = doc.slots.map((s) => s.attachments);
  for (const skin of doc.skins) for (const e of skin.slots) lists.push(e.attachments);
  for (const list of lists) {
    const i = list.indexOf(old);
    if (i >= 0) list[i] = neu;
  }
}

/** The slots on bone `b` that show a picture, with regions turned into grid meshes so they can bend. */
function meshSlots(doc, b) {
  const out = [];
  doc.slots.forEach((s, i) => {
    if (s.bone !== b || !s.attachment) return;
    const att = doc.attachment(i, s.attachment);
    if (att?.type === 'region') replaceAttachment(doc, att, regionToGrid(att, Math.min(8, Math.max(2, Math.round(Math.max(att.width, att.height) / 24)))));
    if (doc.attachment(i, s.attachment)?.type === 'mesh') out.push(i);
  });
  return out;
}

const uniqueWarpName = (doc, base) => {
  let name = base;
  for (let k = 2; doc.warps.some((w) => w.name === name); k++) name = `${base} ${k}`;
  return name;
};

/** Is slot `s`'s shown mesh moved by any warp? */
const warped = (doc, s) => doc.warps.some((w) => w.targets.some((x) => x.slot === doc.slots[s].name && x.attachment === doc.slots[s].attachment));

function done(app) {
  bakeWarps(app.doc);
  app.changed();
}

/** One warp: edit, grid, parent, a child warp over one of its meshes, delete. */
function warpRow(app, w) {
  const doc = app.doc;
  const editing = app.warpEdit?.name === w.name;
  const setup = app.mode === Mode.Setup;
  const parents = [['', t('(none)')], ...doc.warps.filter((x) => x !== w && x.parent !== w.name).map((x) => [x.name, x.name])];
  return h(
    'div',
    { class: `warp-row${editing ? ' editing' : ''}` },
    h(
      'div',
      { class: 'warp-head' },
      h('span', { class: 'warp-name', title: w.targets.map((x) => x.slot).join(', ') }, w.name),
      button(editing ? t('Done') : t('Edit'), {
        size: 'sm',
        kind: editing ? 'primary' : 'secondary',
        title: editing ? t('Stop editing the lattice (Esc)') : app.mode === Mode.Animate ? t('Drag lattice points to key the warp at this frame') : t('Drag lattice points to reshape the meshes'),
        onclick: () => {
          app.warpEdit = editing ? null : { name: w.name, picked: new Set() };
          if (app.warpEdit) app.meshEdit = null;
          app.changed();
        },
      }),
      iconButton('trash-2', {
        size: 'sm',
        title: t('Delete this warp (its keys too; the meshes keep their own)'),
        disabled: !setup,
        onclick: () => {
          removeWarp(doc, w.name);
          if (app.warpEdit?.name === w.name) app.warpEdit = null;
          done(app);
        },
      }),
    ),
    h(
      'div',
      { class: 'grid' },
      h('label', null, t('Grid')),
      h(
        'div',
        { class: 'cell' },
        dragValue(w.cols, (v) => (resizeWarp(w, Math.round(v), w.rows), done(app)), { min: 1, max: 12, speed: 0.05, decimals: 0, suffix: ' ×', disabled: !setup }),
        dragValue(w.rows, (v) => (resizeWarp(w, w.cols, Math.round(v)), done(app)), { min: 1, max: 12, speed: 0.05, decimals: 0, disabled: !setup }),
      ),
      h('label', null, t('Inside')),
      h('div', { class: 'cell' }, select(parents, w.parent ?? '', (v) => ((w.parent = v || null), done(app)), { disabled: !setup })),
      w.targets.length > 1 && setup
        ? [
            h('label', null, t('Child warp')),
            h(
              'div',
              { class: 'cell' },
              select(
                [['', t('Over one mesh…')], ...w.targets.map((x) => [x.slot, x.slot])],
                '',
                (slotName) => {
                  if (!slotName) return;
                  const s = doc.slots.findIndex((x) => x.name === slotName);
                  // The mesh moves to the child, which sits inside this warp.
                  w.targets = w.targets.filter((x) => x.slot !== slotName);
                  const child = createWarp(doc, { name: uniqueWarpName(doc, `${slotName}-warp`), bone: doc.slots[s].bone, slots: [s], cols: 2, rows: 2, parent: w.name });
                  if (child) app.warpEdit = { name: child.name, picked: new Set() };
                  done(app);
                },
              ),
            ),
          ]
        : null,
    ),
  );
}

/** The warp deformer section for bone `b`. */
export function warpUi(app, b) {
  const doc = app.doc;
  const setup = app.mode === Mode.Setup;
  const mine = doc.warps.filter((w) => w.bone === doc.bones[b].name);
  const free = doc.slots.some((s, i) => s.bone === b && s.attachment && !warped(doc, i) && ['region', 'mesh'].includes(doc.attachment(i, s.attachment)?.type));
  if (!mine.length && !free) return null;
  return section(
    t('Warp deformers'),
    [
      mine.length ? null : hint(t('A lattice over the pictures on this bone: drag its points to reshape them, or key it in an animation. Warps can sit inside warps.')),
      mine.map((w) => warpRow(app, w)),
      free
        ? h(
            'div',
            { class: 'buttons' },
            button(t('Add warp'), {
              icon: 'plus',
              disabled: !setup,
              title: setup ? t('A lattice over the pictures on this bone that no warp moves yet') : t('In Setup mode'),
              onclick: () => {
                const slots = meshSlots(doc, b).filter((s) => !warped(doc, s));
                const w = createWarp(doc, { name: uniqueWarpName(doc, `${doc.bones[b].name}-warp`), bone: b, slots, cols: 3, rows: 3, parent: null });
                if (w) app.warpEdit = { name: w.name, picked: new Set() };
                done(app);
              },
            }),
          )
        : null,
    ],
    { id: 'warps', open: mine.length > 0 },
  );
}
