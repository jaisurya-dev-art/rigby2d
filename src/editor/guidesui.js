// SPDX-License-Identifier: MIT OR Apache-2.0
// Guides UI: the "Guides" options popover (like the onion-skin one). It reads and writes the model
// on app.guides (see app.js); the actual drawing of guides lives in the viewport overlay. The panel
// has two sections: real-time transform guides and static ruler guides, each a row with an enable
// checkbox, a color picker and a reset-to-default button.

import { GUIDES_DEFAULTS } from './app.js';
import { h, popupMenu } from './widgets.js';

const toHex = (rgb) => '#' + rgb.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** One "enable | color + reset | name" line for a guide type. `cfg` is `{ enabled, color }`. */
function guideRow(label, cfg, def, refresh) {
  const cb = h('input', { type: 'checkbox', checked: cfg.enabled });
  cb.addEventListener('change', () => {
    cfg.enabled = cb.checked;
    refresh();
  });
  const color = h('input', { class: 'guides-color', type: 'color', value: toHex(cfg.color) });
  color.addEventListener('input', () => {
    cfg.color = fromHex(color.value);
    refresh();
  });
  const reset = h(
    'button',
    {
      class: 'guides-reset',
      type: 'button',
      title: 'Reset to the default color',
      onclick: () => {
        cfg.color = [...def];
        color.value = toHex(cfg.color);
        refresh();
      },
    },
    '↺',
  );
  return h('label', { class: 'guides-row' }, cb, h('span', { class: 'guides-color-wrap' }, color, reset), h('span', { class: 'guides-name' }, label));
}

/** Opens the Guides options popover anchored at (x, y). */
export function guidesPanel(app, x, y) {
  const g = app.guides;
  const D = GUIDES_DEFAULTS;
  const refresh = () => app.changed();
  const placed = g.lines?.length ?? 0;
  const node = h(
    'div',
    { class: 'guides-panel', onpointerdown: (e) => e.stopPropagation() },
    h('div', { class: 'guides-title' }, 'Guides'),
    h('div', { class: 'guides-subtitle' }, 'Real-time guides'),
    guideRow('Rotate', g.realtime.rotate, D.rotate, refresh),
    guideRow('Translate', g.realtime.translate, D.translate, refresh),
    guideRow('Scale', g.realtime.scale, D.scale, refresh),
    guideRow('Shear', g.realtime.shear, D.shear, refresh),
    h('div', { class: 'guides-sep' }),
    h('div', { class: 'guides-subtitle' }, 'Static guides'),
    guideRow('Vertical', g.static.vertical, D.vertical, refresh),
    guideRow('Horizontal', g.static.horizontal, D.horizontal, refresh),
    placed
      ? h(
          'button',
          {
            class: 'guides-clear',
            type: 'button',
            onclick: () => {
              g.lines.length = 0;
              refresh();
            },
          },
          `Clear ${placed} placed guide${placed === 1 ? '' : 's'}`,
        )
      : null,
  );
  popupMenu(x, y, [node]);
}
