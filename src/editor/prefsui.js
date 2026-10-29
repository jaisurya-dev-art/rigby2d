// SPDX-License-Identifier: MIT OR Apache-2.0
// Edit ▸ Preferences (Ctrl+,): the editor's settings in pages (Interface, Editing, Files and
// recovery, Add-ons). Values live in prefs.js, or in the settings the menus already keep (shortcut
// set, viewport drawing, default workspace).

import { isDesktop } from './platform.js';
import { dialog } from './helpui.js';
import { PRESETS } from './keymap.js';
import { saveSetting } from './app.js';
import { WORKSPACES } from './workspaces.js';
import { PREFS } from './prefs.js';
import { h } from './widgets.js';
import { renderAddonsPage } from './addonui.js';
import { LANGUAGES, t } from './i18n.js';
import { icon } from './icons.js';

/** Applies the interface scale (desktop: the window's zoom, like Blender's resolution scale). */
export async function applyInterfaceScale(app) {
  if (!isDesktop) return;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  await getCurrentWebview()
    .setZoom(app.prefs.get('interface.scale'))
    .catch(() => {});
}

/** A labelled row: label and hint on the left, the control on the right. */
const row = (label, hint, control) => h('div', { class: 'pref-row' }, h('div', null, h('div', { class: 'pref-label' }, t(label)), hint ? h('div', { class: 'pref-hint' }, t(hint)) : null), control);

function choice(options, value, onChange) {
  const el = h('select', { onchange: (e) => onChange(e.target.value) }, ...options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
  return el;
}

function checkbox(value, onChange) {
  return h('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) });
}

function number(app, key, unit) {
  const def = PREFS[key];
  return h(
    'span',
    { class: 'pref-number' },
    h('input', {
      type: 'number',
      min: def.min,
      max: def.max,
      value: app.prefs.get(key),
      onchange: (e) => {
        app.prefs.set(key, Number(e.target.value));
        e.target.value = app.prefs.get(key);
      },
    }),
    unit ? h('span', { class: 'weak' }, ` ${unit}`) : null,
  );
}

const PAGES = [
  {
    id: 'general',
    label: 'General',
    render: (app) => [
      row(
        'Language',
        'The language of menus and dialogs. Some panels are still in English.',
        choice([['', t('System ({language})', { language: navigator.language })], ...LANGUAGES], app.prefs.get('interface.language'), (v) => app.prefs.set('interface.language', v)),
      ),
      row('Welcome screen', 'Show the welcome screen when the editor starts.', checkbox(app.prefs.get('general.welcome'), (v) => app.prefs.set('general.welcome', v))),
      isDesktop ? row('Check for updates', 'Look for a new version once a day, and offer to install it.', checkbox(app.prefs.get('updates.check'), (v) => app.prefs.set('updates.check', v))) : null,
    ],
  },
  {
    id: 'interface',
    label: 'Interface',
    render(app) {
      const scales = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((s) => [s, `${Math.round(s * 100)}%`]);
      return [
        isDesktop
          ? row('Interface scale', 'Size of all text and controls.', choice(scales, app.prefs.get('interface.scale'), (v) => (app.prefs.set('interface.scale', Number(v)), applyInterfaceScale(app))))
          : row('Interface scale', "In the browser, use the browser's zoom (Ctrl + and Ctrl −).", h('span')),
        row('Keyboard shortcuts', 'Reference keys, or keys that follow Blender.', choice(Object.entries(PRESETS).map(([id, p]) => [id, p.label]), app.keymap, (v) => app.setKeymap(v))),
        row(
          'Viewport drawing',
          'Canvas 2D is slower, for graphics drivers that have trouble with WebGL.',
          choice(
            [
              ['webgl', 'WebGL'],
              ['canvas', 'Canvas 2D'],
            ],
            app.renderer,
            (v) => {
              app.renderer = v;
              saveSetting('rigby.renderer', v);
              app.changed();
            },
          ),
        ),
        row(
          'New projects',
          'The workspace File ▸ New starts in by default.',
          choice(
            Object.values(WORKSPACES).map((w) => [w.id, w.label]),
            localStorage.getItem('rigby.workspace') ?? 'game',
            (v) => saveSetting('rigby.workspace', v),
          ),
        ),
      ];
    },
  },
  {
    id: 'editing',
    label: 'Editing',
    render: (app) => [row('Undo steps', 'How many steps Undo can go back. More steps use more memory on large projects.', number(app, 'editing.undoSteps'))],
  },
  {
    id: 'files',
    label: 'Files and recovery',
    render: (app) => [
      row(
        'Backup versions',
        'Saving keeps the previous versions next to the file: walk.rigby1 is the last one, walk.rigby2 the one before. Open them with File ▸ Open. 0 keeps none.',
        number(app, 'files.backups'),
      ),
      row('Auto-save', 'Keeps a copy of unsaved work in the recovery folder, offered back after a crash (File ▸ Recover).', checkbox(app.prefs.get('files.autosave'), (v) => app.prefs.set('files.autosave', v))),
      row('Auto-save every', null, number(app, 'files.autosaveMinutes', t('minutes'))),
      isDesktop ? row('Reopen the last project', 'Opens the most recent project when the editor starts.', checkbox(app.prefs.get('files.reopenLast'), (v) => app.prefs.set('files.reopenLast', v))) : null,
    ],
  },
  { id: 'addons', label: 'Add-ons' },
];

let current = 'general';

/** Opens the Preferences dialog; `page` picks the page shown first. */
export function openPreferences(app, addons, page = current) {
  let offAddons = null;
  const { body } = dialog('prefs-dialog', t('Preferences'), t('Saved as you change them, for every project.'), { onClose: () => offAddons?.() });
  const nav = h('nav', { class: 'prefs-nav' });
  const content = h('div', { class: 'prefs-page' });
  const show = (id) => {
    current = id;
    offAddons?.();
    offAddons = null;
    for (const b of nav.children) b.classList.toggle('active', b.dataset.page === id);
    content.replaceChildren();
    const def = PAGES.find((p) => p.id === id);
    if (id === 'addons') offAddons = renderAddonsPage(addons, content);
    else content.append(...def.render(app).filter(Boolean));
  };
  const ICONS = { general: 'settings-2', interface: 'monitor', editing: 'keyboard', files: 'save', addons: 'puzzle' };
  for (const p of PAGES) nav.append(h('button', { 'data-page': p.id, onclick: () => show(p.id) }, icon(ICONS[p.id], 16), h('span', null, t(p.label))));
  const reset = h(
    'button',
    {
      class: 'prefs-reset',
      title: t('Put the preferences on this page back to their defaults'),
      onclick: () => {
        const prefix = { general: 'general.', interface: 'interface.', editing: 'editing.', files: 'files.' }[current];
        if (!prefix) return;
        for (const key of Object.keys(PREFS)) if (key.startsWith(prefix)) app.prefs.reset(key);
        if (current === 'interface') applyInterfaceScale(app);
        show(current);
      },
    },
    t('Reset page'),
  );
  body.append(h('div', { class: 'prefs-layout' }, h('div', { class: 'prefs-side' }, nav, reset), content));
  show(PAGES.some((p) => p.id === page) ? page : 'general');
}
