// SPDX-License-Identifier: MIT OR Apache-2.0
// File > Open demo: the bundled demo projects as cards with a thumbnail; choosing one opens it.

import { DEMOS, DEMOS_REMOTE, DEMO_LICENSE_URL } from './demos.js';
import { openExternal } from './platform.js';
import { h } from './widgets.js';
import { button, dialog } from './ui.js';
import { t } from './i18n.js';

export function openDemoPicker(app) {
  const { body, close } = dialog({
    title: t('Open demo'),
    subtitle: t('Demo projects to explore and learn from. Opening one keeps your project file untouched; Save keeps a copy of the demo.') + (DEMOS_REMOTE ? ' ' + t('Demos download from the Rigby2D website when you open them.') : ''),
    className: 'modal-wide demo-picker',
    footer: [button(t('Cancel'), { onclick: () => close() })],
  });
  const choose = (demo) => {
    close();
    app.openDemo(demo.id);
  };
  body.append(
    // The demos are Rigby2D demo content, not open source like the editor: say so where they are picked.
    h(
      'div',
      { class: 'demo-license', role: 'note' },
      h('span', { class: 'demo-license-mark', 'aria-hidden': 'true' }, '©'),
      h('p', null, h('b', null, t('Demo content © Rigby2D. ')), t('Free to open, study and modify to learn Rigby2D, and to show in tutorials with credit. Not for use in your own games, apps or films, or for AI training.')),
      button(t('Demo license'), { kind: 'ghost', size: 'sm', icon: 'external-link', onclick: () => openExternal(DEMO_LICENSE_URL) }),
    ),
    h(
      'div',
      { class: 'demo-grid' },
      DEMOS.map((d) =>
        h(
          'button',
          { class: 'demo-card', 'data-demo': d.id, onclick: () => choose(d) },
          h('img', { src: d.thumbnail, alt: '', width: 480, height: 360, onerror: (e) => (e.target.style.visibility = 'hidden') }),
          h('strong', null, d.name),
          h('span', { class: 'small weak' }, t(d.description)),
        ),
      ),
    ),
  );
}
