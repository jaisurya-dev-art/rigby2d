// SPDX-License-Identifier: MIT OR Apache-2.0
// Viewport toolbar: tools, numeric fields for the active tool with key buttons, transform axes
// (local / parent / world) and auto key.

import { Affine, wrapDegrees } from '../core/math.js';
import { Mode, TOOLS, selBone } from './app.js';
import * as edit from './edit.js';
import { shortcutLabel } from './keymap.js';
import { onionPanel } from './onionui.js';
import { dragValue, h } from './widgets.js';

const AXES = [
  ['local', 'Local'],
  ['parent', 'Parent'],
  ['world', 'World'],
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
  const tools = TOOLS.map((t) => {
    const key = shortcutLabel(app.keymap, `tool.${t.id}`);
    return h(
      'button',
      {
        class: `tool${app.tool === t.id ? ' active' : ''}`,
        'data-tut': `tool:${t.id}`,
        title: key ? `${t.label.replace(/^\S+ /, '')} (${key})` : t.label,
        onclick: () => {
          app.tool = t.id;
          app.changed();
        },
      },
      t.label,
    );
  });

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
      fields.push(
        h('button', { class: `keybtn ${state}`, title: 'Key this property', onclick: () => edit.keyChannels(app, app.selectedBones(), [channel]) }, '◆'),
      );
    }
  } else if (channel) {
    fields.push(h('span', { class: 'weak' }, 'Select a bone'));
  }

  const axes = h(
    'span',
    { class: 'axes', title: 'Axes for the values and the translate tool' },
    AXES.map(([id, label]) =>
      h(
        'button',
        {
          class: `axis${app.axis === id ? ' active' : ''}`,
          onclick: () => {
            app.axis = id;
            app.changed();
          },
        },
        label,
      ),
    ),
  );

  const autoKey =
    app.mode === Mode.Animate
      ? h(
          'button',
          {
            class: `autokey${app.autoKey ? ' on' : ''}`,
            'data-tut': 'autokey',
            title: 'Auto key: every change in Animate mode sets keys right away',
            onclick: () => {
              app.autoKey = !app.autoKey;
              app.changed();
            },
          },
          app.autoKey ? '● Auto key' : '○ Auto key',
        )
      : null;

  // Onion skinning: master toggle + quick options panel (Animate mode only).
  const onion =
    app.mode === Mode.Animate
      ? h(
          'span',
          { class: 'onion-tool', title: 'Onion skin: draw past and future frames in the viewport' },
          h(
            'button',
            {
              class: `onion-toggle${app.onion.enabled ? ' on' : ''}`,
              'data-tut': 'onion',
              onclick: () => {
                app.onion.enabled = !app.onion.enabled;
                app.changed();
              },
            },
            app.onion.enabled ? '◉ Onion' : '○ Onion',
          ),
          h(
            'button',
            {
              class: 'onion-gear',
              title: 'Onion-skin options',
              onclick: (e) => {
                const r = e.target.getBoundingClientRect();
                onionPanel(app, r.left, r.bottom);
              },
            },
            '⚙',
          ),
        )
      : null;

  el.replaceChildren(
    ...[
      h('div', { class: 'toolgroup' }, tools),
      h('span', { class: 'vsep' }),
      h('div', { class: 'toolgroup fields' }, fields),
      h('span', { class: 'vsep' }),
      axes,
      onion ? h('span', { class: 'vsep' }) : null,
      onion,
      autoKey ? h('span', { class: 'vsep' }) : null,
      autoKey,
    ].filter(Boolean),
  );
}

