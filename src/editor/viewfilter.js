// SPDX-License-Identifier: MIT OR Apache-2.0
// The viewport's Show and select panel (top left): for each kind of thing in the viewport (bones,
// images, shapes), whether it is drawn and whether a click or a box picks it. Turning off images'
// selection lets you work on the bones without grabbing the art; hiding the images leaves the
// skeleton alone. Like Spine's and Blender's viewport filters. Editor-only, remembered between
// sessions; the eye and lock on tree rows still work per bone and slot.

import { SHAPE_KINDS, saveSetting, saveShapes } from './app.js';
import { t } from './i18n.js';
import { uiIcon } from './ui.js';
import { h } from './widgets.js';

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
      pick: app.pick.bones,
      setPick: (on) => (app.pick.bones = on),
      names: app.showNames,
      setNames: (on) => (app.showNames = on),
    },
    {
      id: 'images',
      icon: 'image',
      label: t('Images and meshes'),
      shown: app.showImages,
      setShown: (on) => (app.showImages = on),
      pick: app.pick.images,
      setPick: (on) => (app.pick.images = on),
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

/** Remembers the panel's state (the images' visibility, what can be picked, folded or not). */
export function saveViewFilter(app) {
  saveSetting('rigby.view.filter', JSON.stringify({ showImages: app.showImages, pick: app.pick, open: app.viewFilterOpen, names: app.showNames }));
}

/** Whether anything is off, so the folded button can say so. */
const anyOff = (app) => !app.showBones || !app.showImages || !app.pick.bones || !app.pick.images || SHAPE_KINDS.some((k) => app.showShapes[k] === false);

export function render(app, el) {
  const changed = () => {
    saveViewFilter(app);
    app.changed();
  };
  const fold = h(
    'button',
    {
      class: `vf-fold${anyOff(app) ? ' filtered' : ''}`,
      title: app.viewFilterOpen ? t('Hide the Show and select panel') : anyOff(app) ? t('Show and select: some kinds are hidden or cannot be picked') : t('Show and select: what the viewport draws and what a click can pick'),
      'aria-expanded': app.viewFilterOpen ? 'true' : 'false',
      onclick: () => {
        app.viewFilterOpen = !app.viewFilterOpen;
        changed();
      },
    },
    uiIcon(app.viewFilterOpen ? 'chevron-down' : 'chevron-right', 'sm'),
    app.viewFilterOpen ? null : uiIcon('eye', 'sm'),
  );
  if (!app.viewFilterOpen) {
    el.replaceChildren(h('div', { class: 'vf folded' }, fold));
    return;
  }
  const cell = (on, set, titleOn, titleOff, disabled = false) =>
    h(
      'button',
      {
        class: `vf-dot${on === true ? ' on' : on === 'some' ? ' some' : ''}`,
        disabled,
        title: disabled ? t('Picked with their tools, not by clicking') : on === true ? titleOn : titleOff,
        'aria-pressed': on === true ? 'true' : on === 'some' ? 'mixed' : 'false',
        onclick: () => {
          set(on !== true);
          changed();
        },
      },
      h('span'),
    );
  const rows = kinds(app).map((k) =>
    h(
      'div',
      { class: 'vf-row' },
      h('span', { class: 'vf-kind', title: k.label }, uiIcon(k.icon, 'sm')),
      cell(k.shown, k.setShown, t('{kind}: shown (click to hide)', { kind: k.label }), t('{kind}: hidden (click to show)', { kind: k.label })),
      cell(k.pick, k.pick === null ? () => {} : k.setPick, t('{kind}: a click picks them (click to stop)', { kind: k.label }), t('{kind}: clicks pass through (click to allow)', { kind: k.label }), k.pick === null),
      k.setNames ? cell(k.names, k.setNames, t('{kind}: names shown (click to hide)', { kind: k.label }), t('{kind}: names hidden (click to show)', { kind: k.label })) : h('span'),
    ),
  );
  el.replaceChildren(
    h(
      'div',
      { class: 'vf', role: 'group', 'aria-label': t('Show and select') },
      h('div', { class: 'vf-row vf-head' }, fold, h('span', { class: 'vf-col', title: t('Shown in the viewport') }, uiIcon('eye', 'sm')), h('span', { class: 'vf-col', title: t('Picked by a click or a box') }, uiIcon('mouse-pointer-2', 'sm')), h('span', { class: 'vf-col', title: t('Names in the viewport') }, uiIcon('tag', 'sm'))),
      ...rows,
    ),
  );
}
