// SPDX-License-Identifier: MIT OR Apache-2.0
// Help menu dialogs: Keyboard shortcuts (searchable, grouped, with the shortcut set switcher) and
// About Rigby2D (version, links, license).

import { ACTIONS, PRESETS, shortcutLabel } from './keymap.js';
import { openExternal } from './platform.js';
import { h } from './widgets.js';
import markUrl from '../../branding/rigby2d-mark.svg?url';

/* global __RIGBY_VERSION__ */
export const VERSION = typeof __RIGBY_VERSION__ === 'string' ? __RIGBY_VERSION__ : '';

const SITE = 'https://jaisurya-dev-art.github.io/rigby2d/';
const REPO = 'https://github.com/jaisurya-dev-art/rigby2d';

export const LINKS = {
  docs: `${SITE}docs/`,
  website: SITE,
  repo: REPO,
  issues: `${REPO}/issues/new/choose`,
  releaseNotes: VERSION ? `${REPO}/releases/tag/v${VERSION}` : `${REPO}/releases`,
};

/** A modal dialog; returns { body, close }. Escape and a click outside close it. */
function dialog(className, title, subtitle) {
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
  const body = h('div', { class: 'dialog-body' });
  overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());
  overlay.append(
    h(
      'div',
      { class: `modal dialog ${className}`, role: 'dialog', 'aria-label': title },
      h(
        'header',
        { class: 'dialog-head' },
        h('div', null, h('h3', null, title), subtitle ? h('p', { class: 'dialog-sub' }, subtitle) : null),
        h('button', { class: 'dialog-close', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, '✕'),
      ),
      body,
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { body, close };
}

/** Key chips for a shortcut label such as "Ctrl+Shift+S". */
export function keyChips(label) {
  return h(
    'span',
    { class: 'keys-combo' },
    label.split('+').map((k) => h('kbd', null, k)),
  );
}

const GROUPS = [
  ['Tools', (id) => id.startsWith('tool.')],
  ['Playback and time', (id) => /^(mode|play|time|frame|loop)\./.test(id) || id === 'key.next' || id === 'key.previous'],
  ['Keys', (id) => /^key\.(changed|tool|transforms|shown)$/.test(id) || id === 'autokey.toggle'],
  ['Selection and editing', (id) => /^(select|edit)\./.test(id) || id === 'delete'],
  ['View', (id) => id.startsWith('view.')],
  ['File', (id) => id.startsWith('file.')],
];

const MOUSE = [
  ['Click', 'Select'],
  ['Ctrl+Click', 'Add to or remove from the selection'],
  ['Drag on empty space', 'Box select'],
  ['Right or middle drag', 'Pan the view'],
  ['Wheel', 'Zoom'],
];

/** Help ▸ Keyboard shortcuts: every bound action, grouped and searchable. */
export function openShortcuts(app) {
  const { body } = dialog('shortcuts-dialog', 'Keyboard shortcuts', null);
  const search = h('input', { type: 'search', class: 'dialog-search', placeholder: 'Search shortcuts', 'aria-label': 'Search shortcuts' });
  const presets = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Shortcut set' });
  const list = h('div', { class: 'shortcut-groups' });
  const render = () => {
    presets.replaceChildren(
      ...Object.entries(PRESETS).map(([id, p]) =>
        h(
          'button',
          {
            class: app.keymap === id ? 'active' : '',
            role: 'tab',
            'aria-selected': String(app.keymap === id),
            onclick: () => {
              app.setKeymap(id);
              app.setStatus(`Keyboard shortcuts: ${p.label}`);
              render();
            },
          },
          p.label,
        ),
      ),
    );
    const q = search.value.trim().toLowerCase();
    const match = (label, keys) => !q || label.toLowerCase().includes(q) || keys.toLowerCase().includes(q);
    const groups = GROUPS.map(([title, test]) => [
      title,
      ACTIONS.filter(([id]) => test(id))
        .map(([id, label]) => [label, shortcutLabel(app.keymap, id)])
        .filter(([label, keys]) => keys && match(label, keys)),
    ]);
    groups.push(['Mouse', MOUSE.filter(([keys, label]) => match(label, keys)).map(([keys, label]) => [label, keys])]);
    const shown = groups.filter(([, rows]) => rows.length);
    list.classList.toggle('filtered', !!q);
    list.replaceChildren(
      ...(shown.length
        ? shown.map(([title, rows]) =>
            h(
              'section',
              { class: 'shortcut-group' },
              h('h4', null, title),
              rows.map(([label, keys]) => h('div', { class: 'shortcut-row' }, h('span', null, label), keyChips(keys))),
            ),
          )
        : [h('p', { class: 'dialog-empty' }, `No shortcut matches “${search.value.trim()}”.`)]),
    );
  };
  search.addEventListener('input', render);
  body.append(h('div', { class: 'dialog-toolbar' }, search, presets), list);
  render();
  search.focus();
}

/** Help ▸ About Rigby2D. */
export function openAbout() {
  const { body } = dialog('about-dialog', 'About Rigby2D', null);
  const link = (label, url) => h('button', { class: 'link-button', onclick: () => openExternal(url) }, label, h('span', { class: 'ext', 'aria-hidden': 'true' }, '↗'));
  body.append(
    h(
      'div',
      { class: 'about-hero' },
      h('img', { src: markUrl, alt: '', width: 56, height: 56 }),
      h(
        'div',
        null,
        h('div', { class: 'about-name' }, 'Rigby2D'),
        h('div', { class: 'about-version' }, VERSION ? `Version ${VERSION}` : 'Development build', h('span', { class: 'badge' }, 'Public beta')),
        h('p', { class: 'about-tagline' }, 'Open-source 2D skeletal animation for games, films and interactive experiences.'),
      ),
    ),
    h('div', { class: 'about-links' }, link('Website', LINKS.website), link('Documentation', LINKS.docs), link('Source code', LINKS.repo), link('Release notes', LINKS.releaseNotes)),
    h(
      'p',
      { class: 'about-fine' },
      'Code: MIT OR Apache-2.0, by Hoverlabs and Rigby2D contributors. Includes open-source components listed in THIRD_PARTY_NOTICES.md. The Rigby2D, Hoverlabs, NILA and Rigbytron names, logos and artwork are trademarks of Hoverlabs.',
    ),
  );
}
