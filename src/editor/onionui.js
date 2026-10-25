// SPDX-License-Identifier: MIT OR Apache-2.0
// Onion-skinning UI: the quick "palette" panels for the global defaults and for a single bone.
// The model lives on app.onion (see app.js); these panels just read and write it.

import { ONION_DEFAULTS } from './app.js';
import { h, popupMenu } from './widgets.js';

const toHex = (rgb) => '#' + rgb.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const rgbCss = (rgb) => `rgb(${rgb.slice(0, 3).map((x) => Math.round(x * 255)).join(',')})`;

function checkRow(label, checked, onChange) {
  const cb = h('input', { type: 'checkbox', checked });
  cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: 'onion-check' }, cb, ' ' + label);
}

// Each ghost frame is a full pose evaluation and a skeleton draw, every frame while playing, so the
// counts stay in a range that keeps large rigs responsive (30 each way = 60 ghost poses).
const MAX_ONION_FRAMES = 30;

function numRow(label, value, onChange, { min = 0, max = MAX_ONION_FRAMES } = {}) {
  const input = h('input', { class: 'onion-num', type: 'number', min, max, step: 1, value: String(value) });
  const commit = () => {
    const v = Math.max(min, Math.min(max, Math.round(+input.value || 0)));
    input.value = String(v);
    onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
  });
  return h('label', { class: 'onion-row' }, h('span', null, label), input);
}

/** A color picker with a reset-to-default button. `onReset` returns the value to show afterwards. */
function colorRow(label, rgb, onChange, onReset) {
  const inp = h('input', { class: 'onion-color', type: 'color', value: toHex(rgb) });
  inp.addEventListener('input', () => onChange(fromHex(inp.value)));
  const reset = onReset
    ? h(
        'button',
        {
          class: 'onion-reset',
          type: 'button',
          title: 'Reset to the default color',
          onclick: () => {
            const v = onReset();
            if (v) inp.value = toHex(v);
          },
        },
        '↺',
      )
    : null;
  return h('label', { class: 'onion-row' }, h('span', null, label), h('span', { class: 'onion-color-wrap' }, inp, reset));
}

/** Global defaults panel (opened from the viewport toolbar). */
export function onionPanel(app, x, y) {
  const o = app.onion;
  const refresh = () => app.changed();
  const node = h(
    'div',
    { class: 'onion-panel', onpointerdown: (e) => e.stopPropagation() },
    h('div', { class: 'onion-title' }, 'Onion skin'),
    checkRow('Show future', o.showFuture, (v) => { o.showFuture = v; refresh(); }),
    numRow('Future frames', o.future, (v) => { o.future = v; refresh(); }),
    colorRow('Future color', o.futureColor, (c) => { o.futureColor = c; refresh(); }, () => {
      o.futureColor = [...ONION_DEFAULTS.futureColor];
      refresh();
      return o.futureColor;
    }),
    h('div', { class: 'onion-sep' }),
    checkRow('Show past', o.showPast, (v) => { o.showPast = v; refresh(); }),
    numRow('Past frames', o.past, (v) => { o.past = v; refresh(); }),
    colorRow('Past color', o.pastColor, (c) => { o.pastColor = c; refresh(); }, () => {
      o.pastColor = [...ONION_DEFAULTS.pastColor];
      refresh();
      return o.pastColor;
    }),
    h('div', { class: 'onion-sep' }),
    checkRow('Loop', o.loop, (v) => { o.loop = v; refresh(); }),
    h('div', { class: 'onion-note' }, app.onionOverrideCount() ? `${app.onionOverrideCount()} bone(s) have their own settings: prediction shows only on those. Clear them from each bone or the ANIMATE notice.` : 'Applies to the whole skeleton. Enable individual bones from the tree to limit it.'),
  );
  popupMenu(x, y, [node]);
}

/** Per-bone panel (opened from the bone's button in the tree). */
export function onionBonePanel(app, bone, x, y) {
  const o = app.onion;
  const name = app.doc.bones[bone]?.name ?? `#${bone}`;
  const ensure = () => {
    if (!app.onionOverride(bone)) app.setOnionOverride(bone, {});
    o.enabled = true; // configuring a bone implies showing predictions
    return app.onionOverride(bone);
  };
  const ov = app.onionOverride(bone) ?? {};
  const refresh = () => app.changed();
  // Removing an override falls back to the global default; return that value for the picker.
  const clearOverride = (key, fallback) => () => {
    const e = app.onionOverride(bone);
    if (e) delete e[key];
    refresh();
    return fallback;
  };
  const node = h(
    'div',
    { class: 'onion-panel', onpointerdown: (e) => e.stopPropagation() },
    h('div', { class: 'onion-title' }, `Onion skin · ${name}`),
    checkRow('Show on this bone (and its children)', !!app.onionOverride(bone), (v) => {
      if (v) ensure();
      else app.setOnionOverride(bone, null);
      refresh();
    }),
    h('div', { class: 'onion-sep' }),
    checkRow('Show future', ov.showFuture ?? o.showFuture, (v) => { ensure().showFuture = v; refresh(); }),
    numRow('Future frames', ov.future ?? o.future, (v) => { ensure().future = v; refresh(); }),
    colorRow('Future color', ov.futureColor ?? o.futureColor, (c) => { ensure().futureColor = c; refresh(); }, clearOverride('futureColor', o.futureColor)),
    h('div', { class: 'onion-sep' }),
    checkRow('Show past', ov.showPast ?? o.showPast, (v) => { ensure().showPast = v; refresh(); }),
    numRow('Past frames', ov.past ?? o.past, (v) => { ensure().past = v; refresh(); }),
    colorRow('Past color', ov.pastColor ?? o.pastColor, (c) => { ensure().pastColor = c; refresh(); }, clearOverride('pastColor', o.pastColor)),
    h('div', { class: 'onion-note' }, 'Blank values use the global defaults.'),
  );
  popupMenu(x, y, [node]);
}
