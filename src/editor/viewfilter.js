// SPDX-License-Identifier: MIT OR Apache-2.0
// The viewport's Show and select button (in the viewport toolbar) and its popover: for each kind of
// thing in the viewport (bones, images, shapes), whether it is drawn and whether a click or a box
// picks it. Turning off images' selection lets you work on the bones without grabbing the art;
// hiding the images leaves the skeleton alone. Like Blender's viewport filters. Editor-only,
// remembered between sessions; the eye and lock on tree rows still work per bone and slot.

import { SHAPE_KINDS, saveSetting, saveShapes } from './app.js';
import { t } from './i18n.js';
import { uiIcon } from './ui.js';
import { h, popupMenu } from './widgets.js';

/** The kinds, each with its icon, how to read and set its show and select states. */
function kinds(app) {
  const shapes = app.showShapes;
  const shapesOn = SHAPE_KINDS.filter((k) => shapes[k] !== false).length;
  return [
    {
      id: 'bones',
      icon: 'bone',
      label: t('Bones'),
      shown: app.showBones,
      setShown: (on) => (app.showBones = on),
      pick: app.pickable.bones,
      setPick: (on) => (app.pickable.bones = on),
      names: app.showNames,
      setNames: (on) => (app.showNames = on),
    },
    {
      id: 'images',
      icon: 'image',
      label: t('Images and meshes'),
      shown: app.showImages,
      setShown: (on) => (app.showImages = on),
      pick: app.pickable.images,
      setPick: (on) => (app.pickable.images = on),
    },
    {
      id: 'shapes',
      icon: 'shapes',
      label: t('Shapes (clipping, bounding boxes, paths, points)'),
      // Partly on when only some kinds are shown (View ▸ Shapes picks them one by one).
      shown: shapesOn === SHAPE_KINDS.length ? true : shapesOn ? 'some' : false,
      setShown: (on) => {
        for (const k of SHAPE_KINDS) shapes[k] = on;
        saveShapes(shapes);
      },
      pick: null, // shapes are picked with their tools, not by clicking the viewport
    },
  ];
}

/** Remembers the panel's state (the images' visibility, what can be picked, bone names). */
export function saveViewFilter(app) {
  saveSetting('rigby.view.filter', JSON.stringify({ showImages: app.showImages, pick: app.pickable, names: app.showNames }));
}

/** Whether anything is off, so the toolbar button can say so. */
export const anyOff = (app) => !app.showBones || !app.showImages || !app.pickable.bones || !app.pickable.images || SHAPE_KINDS.some((k) => app.showShapes[k] === false);

/** The table of switches, rebuilt in place after each click so the popover stays open. */
function table(app) {
  const box = h('div', { class: 'vf', role: 'group', 'aria-label': t('Show and select') });
  const fill = () => {
    const cell = (on, set, titleOn, titleOff, disabled = false) =>
      h(
        'button',
        {
          type: 'button',
          class: `vf-dot${on === true ? ' on' : on === 'some' ? ' some' : ''}`,
          disabled,
          title: disabled ? t('Picked with their tools, not by clicking') : on === true ? titleOn : titleOff,
          'aria-pressed': on === true ? 'true' : on === 'some' ? 'mixed' : 'false',
          onclick: () => {
            set(on !== true);
            saveViewFilter(app);
            app.changed();
            fill();
          },
        },
        h('span'),
      );
    const rows = kinds(app).map((k) =>
      h(
        'div',
        { class: 'vf-row' },
        h('span', { class: 'vf-kind' }, uiIcon(k.icon, 'sm'), h('span', { class: 'vf-label' }, k.label)),
        cell(k.shown, k.setShown, t('{kind}: shown (click to hide)', { kind: k.label }), t('{kind}: hidden (click to show)', { kind: k.label })),
        cell(k.pick, k.pick === null ? () => {} : k.setPick, t('{kind}: a click picks them (click to stop)', { kind: k.label }), t('{kind}: clicks pass through (click to allow)', { kind: k.label }), k.pick === null),
        k.setNames ? cell(k.names, k.setNames, t('{kind}: names shown (click to hide)', { kind: k.label }), t('{kind}: names hidden (click to show)', { kind: k.label })) : h('span'),
      ),
    );
    box.replaceChildren(
      h(
        'div',
        { class: 'vf-row vf-head' },
        h('span', { class: 'vf-title' }, t('Show and select')),
        h('span', { class: 'vf-col', title: t('Shown in the viewport') }, uiIcon('eye', 'sm')),
        h('span', { class: 'vf-col', title: t('Picked by a click or a box') }, uiIcon('mouse-pointer-2', 'sm')),
        h('span', { class: 'vf-col', title: t('Names in the viewport') }, uiIcon('tag', 'sm')),
      ),
      ...rows,
    );
  };
  fill();
  return box;
}

/** Opens the Show and select popover just above `anchor` (the toolbar button), its left edges lined up. */
export function viewFilterPanel(app, anchor) {
  const r = anchor.getBoundingClientRect();
  const box = h('div', { class: 'vf-popover', onpointerdown: (e) => e.stopPropagation() }, table(app));
  popupMenu(r.left, r.top, [box]);
  const menu = box.closest('.popup');
  if (!menu) return;
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - m.width - 4))}px`;
  menu.style.top = `${Math.max(4, r.top - m.height - 6)}px`;
}

/** The viewport toolbar's Show and select button: highlighted while anything is hidden or unpickable. */
export function viewFilterButton(app) {
  const off = anyOff(app);
  return h(
    'button',
    {
      type: 'button',
      class: `ui-toggle vf-button${off ? ' filtered' : ''}`,
      'data-tut': 'viewfilter',
      title: off ? t('Show and select: some kinds are hidden or cannot be picked') : t('Show and select: what the viewport draws and what a click can pick'),
      onclick: (e) => viewFilterPanel(app, e.currentTarget),
    },
    uiIcon(off ? 'eye-off' : 'eye'),
    h('span', null, t('Show')),
  );
}
