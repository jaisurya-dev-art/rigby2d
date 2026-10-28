// SPDX-License-Identifier: MIT OR Apache-2.0
// File > Open demo: the bundled demo projects as cards with a thumbnail; choosing one opens it.

import { DEMOS, DEMOS_REMOTE, DEMO_LICENSE_URL } from './demos.js';
import { openExternal } from './platform.js';
import { h } from './widgets.js';

export function openDemoPicker(app) {
  const overlay = h('div', { class: 'modal-backdrop' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const choose = (demo) => {
    close();
    app.openDemo(demo.id);
  };
  overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());
  overlay.append(
    h(
      'div',
      { class: 'modal modal-wide demo-picker' },
      h('h3', null, 'Open demo'),
      h('p', { class: 'small weak' }, `Demo projects to explore and learn from. Opening one keeps your project file untouched; Save keeps a copy of the demo.${DEMOS_REMOTE ? ' Demos download from the Rigby2D website when you open them.' : ''}`),
      // The demos are Hoverlabs content, not open source like the editor: say so where they are picked.
      h(
        'div',
        { class: 'demo-license', role: 'note' },
        h('span', { class: 'demo-license-mark', 'aria-hidden': 'true' }, '©'),
        h(
          'p',
          null,
          h('b', null, 'Demo content © Hoverlabs. '),
          'Free to open, study and modify to learn Rigby2D, and to show in tutorials with credit. Not for use in your own games, apps or films, or for AI training.',
        ),
        h('button', { class: 'link', onclick: () => openExternal(DEMO_LICENSE_URL) }, 'Demo license ↗'),
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
            h('span', { class: 'small weak' }, d.description),
          ),
        ),
      ),
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, 'Cancel')),
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}
