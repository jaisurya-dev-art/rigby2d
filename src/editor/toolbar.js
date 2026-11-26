// SPDX-License-Identifier: MIT OR Apache-2.0
// Viewport toolbar: tools, numeric fields for the active tool with key buttons, transform axes
// (local / parent / world), Bone only (with its one-time tip), Show and select, and auto key.

import { Affine, wrapDegrees } from '../core/math.js';
import { Mode, TOOLS, saveSetting, selBone, selSlot } from './app.js';
import * as edit from './edit.js';
import { shortcutLabel, withShortcut } from './keymap.js';
import { onionPanel } from './onionui.js';
import { guidesPanel } from './guidesui.js';
import { viewFilterButton } from './viewfilter.js';
import { dragValue, h } from './widgets.js';
import { button, iconButton, segmented, toggleButton, tooltip, uiIcon } from './ui.js';
import { t, tn } from './i18n.js';

const AXES = [
  ['local', tn('Local')],
  ['parent', tn('Parent')],
  ['world', tn('World')],
];

const DEG = Math.PI / 180;
const rotateVec = (v, deg) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};

/** Transform values shown for the bone in the chosen axes, and a setter that converts back. */
function boneFields(app, b) {
  const pose = app.pose();
  const local = pose.local[b];
  const parentIdx = app.doc.bones[b].parent;
  const parent = parentIdx === null ? new Affine() : pose.world[parentIdx];
  const set = (changes) => edit.setBoneLocal(app, b, { ...app.pose().local[b], ...changes });
  const axis = app.axis;
  return {
    rotate: {
      values: [axis === 'world' ? pose.world[b].rotation() : local.rotation],
      set: ([v]) => set({ rotation: axis === 'world' ? local.rotation + (parent.determinant() < 0 ? -1 : 1) * wrapDegrees(v - pose.world[b].rotation()) : v }),
    },
    translate: (() => {
      if (axis === 'world') {
        const w = pose.world[b].apply([0, 0]);
        return { values: w, set: (v) => set(Object.fromEntries(['x', 'y'].map((k, i) => [k, parent.inverse().apply(v)[i]]))) };
      }
      if (axis === 'local') {
        return {
          values: rotateVec([local.x, local.y], -local.rotation),
          set: (v) => {
            const p = rotateVec(v, local.rotation);
            set({ x: p[0], y: p[1] });
          },
        };
      }
      return { values: [local.x, local.y], set: ([x, y]) => set({ x, y }) };
    })(),
    scale: { values: [local.scale_x, local.scale_y], set: ([scale_x, scale_y]) => set({ scale_x, scale_y }) },
    shear: { values: [local.shear_x ?? 0, local.shear_y ?? 0], set: ([shear_x, shear_y]) => set({ shear_x, shear_y }) },
  };
}

const FIELD_SPECS = {
  rotate: { labels: [''], suffix: '°', speed: 0.5, decimals: 2 },
  translate: { labels: ['x ', 'y '], suffix: '', speed: 0.5, decimals: 2 },
  scale: { labels: ['x ', 'y '], suffix: '', speed: 0.01, decimals: 3 },
  shear: { labels: ['x ', 'y '], suffix: '°', speed: 0.5, decimals: 2 },
};

export function render(app, el) {
  const set = (fn) => (...args) => {
    fn(...args);
    app.changed();
  };
  // Tools: icon and name; the name hides when the bar is narrow (the tooltip keeps it).
  const tools = TOOLS.map((tool) =>
    h(
      'button',
      {
        type: 'button',
        class: `tool${app.tool === tool.id ? ' active' : ''}`,
        'data-tut': `tool:${tool.id}`,
        'aria-pressed': app.tool === tool.id ? 'true' : 'false',
        title: tooltip(t(tool.label), shortcutLabel(app.keymap, `tool.${tool.id}`)),
        onclick: set(() => (app.tool = tool.id)),
      },
      uiIcon(tool.icon),
      h('span', { class: 'tool-label' }, t(tool.label)),
    ),
  );

  // Numeric fields of the active tool for the primary selected bone.
  const fields = [];
  const b = selBone(app.sel);
  const channel = { rotate: 'rotate', translate: 'translate', scale: 'scale', shear: 'shear', pose: 'rotate' }[app.tool];
  if (b !== null && channel) {
    const f = boneFields(app, b)[channel];
    const spec = FIELD_SPECS[channel];
    const values = f.values.slice();
    spec.labels.forEach((label, i) => {
      fields.push(
        dragValue(values[i], (v) => {
          values[i] = v;
          f.set(values);
        }, { speed: spec.speed, decimals: spec.decimals, prefix: label, suffix: spec.suffix, disabled: channel === 'scale' && app.axis === 'world' }),
      );
    });
    if (app.mode === Mode.Animate) {
      const state = edit.channelState(app, b, channel);
      const key = iconButton('diamond', { title: t('Key this property'), size: 'sm', onclick: () => edit.keyChannels(app, app.selectedBones(), [channel]) });
      key.classList.add('keybtn', state);
      fields.push(key);
    }
  } else if (channel) {
    fields.push(h('span', { class: 'toolbar-hint' }, t('Select a bone')));
  }

  const axes = segmented(
    AXES.map(([id, label]) => [id, t(label)]),
    app.axis,
    set((id) => (app.axis = id)),
    { title: t('Axes for the values and the translate tool') },
  );

  // Toggles with an options button: onion skin (Animate mode) and guides; then auto key.
  const withOptions = (toggle, title, open) =>
    h(
      'span',
      { class: 'toggle-with-options' },
      toggle,
      iconButton('settings-2', {
        title,
        size: 'sm',
        onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          open(r.left, r.bottom);
        },
      }),
    );
  const onion =
    app.mode === Mode.Animate
      ? withOptions(
          toggleButton(t('Onion skin'), app.onion.enabled, set((on) => (app.onion.enabled = on)), { icon: 'onion', title: t('Onion skin: draw past and future frames in the viewport') }),
          t('Onion-skin options'),
          (x, y) => onionPanel(app, x, y),
        )
      : null;
  if (onion) onion.querySelector('.ui-toggle').dataset.tut = 'onion';
  const guides = withOptions(
    toggleButton(t('Guides'), app.guides.enabled, set((on) => (app.guides.enabled = on)), { icon: 'ruler', title: t('Guides: real-time transform guides and static ruler guides') }),
    t('Guide options'),
    (x, y) => guidesPanel(app, x, y),
  );
  const autoKey =
    app.mode === Mode.Animate
      ? toggleButton(t('Auto key'), app.autoKey, set((on) => (app.autoKey = on)), {
          icon: 'circle-dot',
          title: withShortcut(t('Auto key: every change in Animate mode sets keys right away'), app.keymap, 'autokey.toggle'),
        })
      : null;
  if (autoKey) {
    autoKey.classList.add('autokey');
    autoKey.dataset.tut = 'autokey';
  }

  // Weights: one click from a selected mesh to painting its weights (Setup mode), and back.
  const meshSlot = app.meshEdit?.slot ?? selSlot(app.sel);
  const meshName = app.meshEdit?.name ?? (meshSlot !== null ? app.doc.slots[meshSlot]?.attachment : null);
  const isMesh = meshSlot !== null && meshName && app.doc.attachment(meshSlot, meshName)?.type === 'mesh';
  const weights =
    app.mode === Mode.Setup && isMesh
      ? toggleButton(
          t('Weights'),
          app.meshEdit?.mode === 'weights',
          set((on) => {
            if (!on) app.meshEdit = null;
            else if (app.meshEdit) app.meshEdit.mode = 'weights';
            else app.meshEdit = { slot: meshSlot, name: meshName, mode: 'weights', radius: 40, strength: 0.5, subtract: false, selected: null };
          }),
          { icon: 'paintbrush', title: t('Paint how strongly each bone moves this mesh (brush settings in the inspector)') },
        )
      : null;
  if (weights) weights.dataset.tut = 'weights';
  // Bone only: in Setup mode a bone moves without its child bones and images (to fix a joint).
  const boneOnly =
    app.mode === Mode.Setup && app.tool !== 'pose' && app.tool !== 'create'
      ? toggleButton(t('Bone only'), app.boneOnly, set((on) => (app.boneOnly = on)), {
          icon: 'pin',
          title: t('Moves, turns or scales just the bone: its child bones and images stay where they are drawn. Off: they move with it.'),
        })
      : null;
  if (boneOnly) {
    boneOnly.dataset.tut = 'boneonly';
    boneOnly.classList.add('boneonly');
  }
  app.onBoneOnlyMove ??= () => boneOnlyTip(app);

  el.replaceChildren(
    ...[
      h('div', { class: 'toolgroup', role: 'toolbar', 'aria-label': t('Tools') }, tools),
      h('span', { class: 'vsep' }),
      h('div', { class: 'toolgroup fields' }, fields),
      h('span', { class: 'vsep' }),
      axes,
      boneOnly,
      h('span', { class: 'toolbar-spacer' }),
      viewFilterButton(app),
      weights,
      onion,
      guides,
      autoKey,
    ].filter(Boolean),
  );
}

/**
 * The first time a bone is moved with Bone only on, a small tip over the toggle says why the images
 * stayed behind, with a way to turn it off. Shown once: either button, or Escape, ends it for good.
 */
function boneOnlyTip(app) {
  if (app.boneOnlyTipDone || document.querySelector('.boneonly-tip')) return;
  const toggle = document.querySelector('[data-tut="boneonly"]');
  const center = document.querySelector('#center');
  if (!toggle || !center) return;
  app.boneOnlyTipDone = true;
  saveSetting('rigby.tip.boneOnly', '1');
  const close = () => {
    tip.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const tip = h(
    'div',
    { class: 'boneonly-tip', role: 'status' },
    h('div', { class: 'boneonly-tip-text' }, t('Bone only is on: the bone moves without its images and child bones, to fix a joint. Turn it off to move everything together.')),
    h(
      'div',
      { class: 'boneonly-tip-actions' },
      button(t('Turn off Bone only'), {
        size: 'sm',
        onclick: () => {
          app.boneOnly = false;
          app.changed();
          close();
        },
      }),
      button(t('Got it'), { size: 'sm', kind: 'primary', onclick: close }),
    ),
  );
  center.append(tip);
  const c = center.getBoundingClientRect();
  const r = toggle.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(r.left - c.left, c.width - tip.offsetWidth - 8))}px`;
  tip.style.bottom = `${c.bottom - r.top + 8}px`;
  window.addEventListener('keydown', onKey);
}
