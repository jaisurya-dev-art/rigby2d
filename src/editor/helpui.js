// SPDX-License-Identifier: MIT OR Apache-2.0
// Help menu dialogs: Keyboard shortcuts (searchable, grouped, with the shortcut set switcher and the
// custom keymap editor) and
// About Rigby2D (version, links, license).

import { ACTIONS, PRESETS, bindCombo, comboLabel, comboOf, importKeymapFile, keymapFile, newCustom, reservedCombo, resetCustom, unbindCombo } from './keymap.js';
import { confirmDialog, fetchBytes, openExternal, pickImportFiles as importFiles, pickSaveTarget as saveTarget } from './platform.js';
import { t, tn } from './i18n.js';
import { h } from './widgets.js';
import markUrl from '../../branding/rigby2d-mark.svg?url';

/* global __RIGBY_VERSION__ */
export const VERSION = typeof __RIGBY_VERSION__ === 'string' ? __RIGBY_VERSION__ : '';

const SITE = 'https://rigby2d.com/';
const REPO = 'https://github.com/jaisurya-dev-art/rigby2d';

export const LINKS = {
  docs: `${SITE}docs/`,
  website: SITE,
  repo: REPO,
  issues: `${REPO}/issues/new/choose`,
  releaseNotes: VERSION ? `${REPO}/releases/tag/v${VERSION}` : `${REPO}/releases`,
  fund: `${SITE}fund/`,
  sponsor: 'https://github.com/sponsors/jaisurya-dev-art',
};

/**
 * A modal dialog; returns { body, close }. Escape and a click outside close it; `onClose` runs
 * however it closes.
 */
export function dialog(className, title, subtitle, { onClose } = {}) {
  const overlay = h('div', { class: 'modal-backdrop' });
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // With a dialog opened from another (Preferences ▸ Customize…), Escape closes only the top one.
    const backdrops = document.querySelectorAll('.modal-backdrop');
    if (backdrops[backdrops.length - 1] !== overlay) return;
    e.stopImmediatePropagation();
    close();
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
        h('button', { class: 'dialog-close', title: t('Close (Esc)'), 'aria-label': t('Close'), onclick: close }, '✕'),
      ),
      body,
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { body, close };
}

/**
 * Asks a question with buttons [{ id, label, primary }]; resolves with the chosen id, or null when
 * the dialog is dismissed (Escape, a click outside).
 */
export function askChoice(title, message, buttons) {
  return new Promise((resolve) => {
    let answer = null;
    const { body, close } = dialog('choice-dialog', title, null, { onClose: () => resolve(answer) });
    const row = h('div', { class: 'dialog-actions' });
    for (const b of buttons) {
      const button = h('button', { class: b.primary ? 'primary' : '', onclick: () => ((answer = b.id), close()) }, b.label);
      row.append(button);
    }
    body.append(...(Array.isArray(message) ? message : [h('p', null, message)]), row);
    row.querySelector('.primary')?.focus();
  });
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
  [tn('Tools'), (id) => id.startsWith('tool.')],
  [tn('Playback and time'), (id) => /^(mode|play|time|frame|loop)\./.test(id) || id === 'key.next' || id === 'key.previous'],
  [tn('Keys'), (id) => /^key\.(changed|tool|transforms|shown)$/.test(id) || id === 'autokey.toggle'],
  [tn('Selection and editing'), (id) => /^(select|edit)\./.test(id) || id === 'delete'],
  [tn('View'), (id) => id.startsWith('view.')],
  [tn('File'), (id) => id.startsWith('file.')],
];

const MOUSE = [
  [tn('Click'), tn('Select')],
  [tn('Ctrl+Click'), tn('Add to or remove from the selection')],
  [tn('Drag on empty space'), tn('Box select')],
  [tn('Right or middle drag'), tn('Pan the view')],
  [tn('Wheel'), tn('Zoom')],
];

/**
 * Help ▸ Keyboard shortcuts: every action, grouped and searchable, with the shortcut set switcher.
 * With the Custom set active, every shortcut can be changed: click a key to replace it, + to add
 * one, × to remove one, ↺ to put an action back; the keymap saves as you go and can be exported.
 */
export function openShortcuts(app, { onClose } = {}) {
  let recording = null; // { action, replace } while waiting for a key press
  let flash = null; // { action, text } after a change, explained under the toolbar
  const onRecordKey = (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      recording = null;
      return render();
    }
    const combo = comboOf(e);
    if (!combo) return; // a modifier alone: wait for the key
    if (reservedCombo(combo)) {
      flash = { action: recording.action, text: t('{key} is kept for window layouts (Ctrl+Alt+1 to 9). Pick another key.', { key: comboLabel(combo) }) };
      return render();
    }
    const { custom, moved } = bindCombo(app.customKeymap, recording.action, combo, recording.replace);
    const label = (id) => ACTIONS.find(([a]) => a === id)?.[1] ? t(ACTIONS.find(([a]) => a === id)[1]) : id;
    flash = { action: recording.action, text: moved.length ? t('{key} was {old}; it now does {action}.', { key: comboLabel(combo), old: moved.map(label).join(', '), action: label(recording.action) }) : null };
    recording = null;
    app.setCustomKeymap(custom);
    render();
  };
  window.addEventListener('keydown', onRecordKey, true);
  const { body } = dialog('shortcuts-dialog', t('Keyboard shortcuts'), null, {
    onClose: () => {
      window.removeEventListener('keydown', onRecordKey, true);
      onClose?.();
    },
  });
  const search = h('input', { type: 'search', class: 'dialog-search', placeholder: t('Search shortcuts'), 'aria-label': t('Search shortcuts') });
  const presets = h('div', { class: 'segmented', role: 'tablist', 'aria-label': t('Shortcut set') });
  const tools = h('div', { class: 'shortcut-tools' });
  const list = h('div', { class: 'shortcut-groups' });

  const customize = () => {
    if (!app.customKeymap) app.setCustomKeymap(newCustom(app.keymap));
    else app.setKeymap('custom');
    app.setStatus(t('Keyboard shortcuts: Custom. Click a key to change it.'));
    render();
  };

  const exportKeymap = async () => {
    try {
      const target = await saveTarget('rigby2d-keymap.json', t('Rigby2D keymap'), 'json', { single: true });
      if (!target) return;
      await target.fs.writeFile(target.path, new TextEncoder().encode(keymapFile(app.customKeymap)));
      await target.fs.finish();
      app.setStatus(t('Saved the keymap: {path}', { path: target.path }));
    } catch (e) {
      app.setStatus(t('Could not save the keymap: {error}', { error: e.message ?? e }));
    }
  };

  const importKeymap = async () => {
    try {
      const [file] = await importFiles(t('Rigby2D keymap'), ['json'], false);
      if (!file) return;
      app.setCustomKeymap(importKeymapFile(new TextDecoder().decode(file.bytes)));
      app.setStatus(t('Keyboard shortcuts loaded from {file}', { file: file.name }));
      render();
    } catch (e) {
      app.setStatus(t('Could not load the keymap: {error}', { error: e.message ?? e }));
    }
  };

  /** One action's keys: plain chips, or editable ones in the Custom set. */
  const keysFor = (id, combos, editing) => {
    if (!editing) return combos.length ? keyChips(comboLabel(combos[0])) : null;
    const isRecording = (replace) => recording && recording.action === id && recording.replace === replace;
    const record = (replace) => () => {
      recording = { action: id, replace };
      flash = null;
      render();
    };
    const chips = combos.map((combo) =>
      isRecording(combo)
        ? h('span', { class: 'key-record' }, t('Press a key…'))
        : h(
            'span',
            { class: 'key-edit' },
            h('button', { class: 'key-edit-combo', title: t('Press to change this key'), onclick: record(combo) }, keyChips(comboLabel(combo))),
            h(
              'button',
              {
                class: 'key-edit-remove',
                title: t('Remove this key'),
                'aria-label': t('Remove {key}', { key: comboLabel(combo) }),
                onclick: () => {
                  app.setCustomKeymap(unbindCombo(app.customKeymap, id, combo));
                  render();
                },
              },
              '×',
            ),
          ),
    );
    const changed = id in app.customKeymap.changes;
    return h(
      'span',
      { class: 'key-edits' },
      ...chips,
      isRecording(null) ? h('span', { class: 'key-record' }, t('Press a key…')) : h('button', { class: 'key-add', title: t('Add a key for this'), onclick: record(null) }, '+'),
      changed
        ? h(
            'button',
            {
              class: 'key-reset',
              title: t('Back to {name}', { name: t(PRESETS[app.customKeymap.base].label) }),
              onclick: () => {
                app.setCustomKeymap(resetCustom(app.customKeymap, id));
                render();
              },
            },
            '↺',
          )
        : null,
    );
  };

  const render = () => {
    const editing = app.keymap === 'custom' && !!app.customKeymap;
    presets.replaceChildren(
      ...Object.entries(PRESETS).map(([id, p]) =>
        h(
          'button',
          {
            class: app.keymap === id ? 'active' : '',
            role: 'tab',
            'aria-selected': String(app.keymap === id),
            onclick: () => {
              recording = null;
              app.setKeymap(id);
              app.setStatus(t('Keyboard shortcuts: {name}', { name: t(p.label) }));
              render();
            },
          },
          t(p.label),
        ),
      ),
      ...(app.customKeymap ? [] : [h('button', { onclick: customize, title: t('Make your own keymap, starting from this one') }, t('Customize…'))]),
    );
    tools.replaceChildren(
      ...(editing
        ? [
            h('span', { class: 'shortcut-hint' }, recording ? t('Press the new key, or Esc to cancel.') : t('Click a key to change it, + to add one. Changes save as you go.')),
            h('span', { class: 'shortcut-tools-spacer' }),
            h('label', { class: 'shortcut-base' }, t('Start again from '), baseSelect()),
            h('button', { onclick: importKeymap }, t('Import…')),
            h('button', { onclick: exportKeymap }, t('Export…')),
          ]
        : []),
      ...(flash?.text ? [h('p', { class: 'shortcut-flash' }, flash.text)] : []),
    );
    tools.hidden = !editing && !flash?.text;
    const bindings = PRESETS[app.keymap]?.bindings ?? PRESETS.reference.bindings;
    const q = search.value.trim().toLowerCase();
    const match = (label, keys) => !q || label.toLowerCase().includes(q) || keys.toLowerCase().includes(q);
    const grouped = new Set();
    const groups = [...GROUPS, [tn('Other'), (id) => !grouped.has(id)]].map(([title, test]) => [
      t(title),
      ACTIONS.filter(([id]) => {
        if (grouped.has(id) || !test(id)) return false;
        grouped.add(id);
        return true;
      })
        .map(([id, label]) => [id, t(label), bindings[id] ?? []])
        .filter(([, label, combos]) => (editing || combos.length) && match(label, combos.map(comboLabel).join(' '))),
    ]);
    const rows = groups.map(([title, items]) => [
      title,
      items.map(([id, label, combos]) => h('div', { class: `shortcut-row${flash?.action === id ? ' flash' : ''}` }, h('span', null, label), keysFor(id, combos, editing))),
    ]);
    rows.push([t('Mouse'), MOUSE.filter(([keys, label]) => match(t(label), t(keys))).map(([keys, label]) => h('div', { class: 'shortcut-row' }, h('span', null, t(label)), keyChips(t(keys))))]);
    const shown = rows.filter(([, r]) => r.length);
    list.classList.toggle('filtered', !!q);
    list.classList.toggle('editing', editing);
    list.replaceChildren(
      ...(shown.length
        ? shown.map(([title, r]) => h('section', { class: 'shortcut-group' }, h('h4', null, title), r))
        : [h('p', { class: 'dialog-empty' }, t('No shortcut matches “{text}”.', { text: search.value.trim() }))]),
    );
  };

  /** Start the custom keymap again from a built-in preset (asks first if it has changes). */
  const baseSelect = () => {
    const el = h(
      'select',
      {
        onchange: async () => {
          const base = el.value;
          el.value = '';
          if (!base) return;
          const changes = Object.keys(app.customKeymap.changes).length;
          if (changes && !(await confirmDialog((changes === 1 ? t('Start the custom keymap again from {name}? Your 1 change will be lost.', { name: t(PRESETS[base].label) }) : t('Start the custom keymap again from {name}? Your {count} changes will be lost.', { name: t(PRESETS[base].label), count: changes })), 'Keyboard shortcuts'))) return;
          app.setCustomKeymap(newCustom(base));
          flash = null;
          render();
        },
      },
      h('option', { value: '' }, '…'),
      ...Object.entries(PRESETS)
        .filter(([id]) => id !== 'custom')
        .map(([id, p]) => h('option', { value: id }, t(p.label))),
    );
    return el;
  };

  search.addEventListener('input', render);
  body.append(h('div', { class: 'dialog-toolbar' }, search, presets), tools, list);
  render();
  search.focus();
}

/** Help ▸ About Rigby2D. */
export function openAbout() {
  const { body } = dialog('about-dialog', t('About Rigby2D'), null);
  const link = (label, url) => h('button', { class: 'link-button', onclick: () => openExternal(url) }, label, h('span', { class: 'ext', 'aria-hidden': 'true' }, '↗'));
  body.append(
    h(
      'div',
      { class: 'about-hero' },
      h('img', { src: markUrl, alt: '', width: 56, height: 56 }),
      h(
        'div',
        null,
        h('div', { class: 'about-name' }, t('Rigby2D')),
        h('div', { class: 'about-version' }, VERSION ? t('Version {version}', { version: VERSION }) : t('Development build'), h('span', { class: 'badge' }, t('Public beta'))),
        h('p', { class: 'about-tagline' }, t('Open-source 2D skeletal animation for games, films and interactive experiences.')),
      ),
    ),
    h('div', { class: 'about-links' }, link(t('Website'), LINKS.website), link(t('Documentation'), LINKS.docs), link(t('Source code'), LINKS.repo), link(t('Release notes'), LINKS.releaseNotes), link(t('Support Rigby2D'), LINKS.fund)),
    h('p', { class: 'about-fine' }, t('Rigby2D is free and stays free. Supporters pay for code signing and keep it moving.')),
    h(
      'p',
      { class: 'about-fine' },
      t('Code: MIT OR Apache-2.0, by the Rigby2D contributors. Includes open-source components listed in THIRD_PARTY_NOTICES.md. The Rigby2D, NILA and Rigbytron names, logos and artwork are trademarks of the Rigby2D project.'),
    ),
  );
}

/**
 * Help ▸ Support Rigby2D: the monthly goal, the Founding Supporters (the first 20 monthly ones, in
 * the order they joined), the other supporters (Backer tier and up) and the code contributors, from
 * rigby2d.com/supporters.json, kept in step with GitHub Sponsors by the website. People show as
 * initials: the editor loads no images from other sites (docs/privacy.md).
 */
/** Rigby2D's founder, marked quietly among the code contributors. */
const FOUNDER = 'jaisurya-dev-art';
const FOUNDING_SEATS = 20;

/** A round monogram for a person: their initials on a colour picked from their name. */
function monogram(name) {
  const words = String(name ?? '?').replace(/[-_]+/g, ' ').trim().split(/\s+/);
  const letters = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of String(name)) hash = Math.imul(hash ^ ch.codePointAt(0), 2654435761) >>> 0;
  return h('span', { class: `sp-avatar hue-${(hash >>> 13) % 6}`, 'aria-hidden': 'true' }, letters);
}

/** One person: monogram, name, and a quiet line under it (seat, tier or role). */
const person = (name, note, extra = '') =>
  h('li', { class: `sp-person${extra}` }, monogram(name), h('span', { class: 'sp-text' }, h('span', { class: 'sp-name' }, name), note ? h('span', { class: 'sp-note' }, note) : null));

export async function openSupporters() {
  const { body } = dialog('supporters-dialog', t('Support Rigby2D'), t('Rigby2D is free because of these people.'));
  const status = h('p', { class: 'weak' }, t('Loading…'));
  body.append(status);
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(await fetchBytes(`${SITE}supporters.json`)));
  } catch {
    status.textContent = t('Could not load the list. Check your connection, or see it on rigby2d.com/fund.');
    return;
  }
  status.remove();

  const goal = data.goal ?? {};
  const percent = Math.max(0, Math.min(100, Math.round(goal.percent ?? 0)));
  const everyone = [...(data.github ?? []), ...(data.others ?? [])];
  const byId = new Map(everyone.map((p) => [p.login ?? p.name, p]));
  const foundingIds = (data.founding ?? []).slice(0, FOUNDING_SEATS);
  const founders = foundingIds.map((id) => byId.get(id) ?? { login: id, name: id });
  const others = everyone.filter((p) => (p.tier ?? 5) >= 5 && !foundingIds.includes(p.login ?? p.name));
  const left = FOUNDING_SEATS - foundingIds.length;

  // The goal: what it's for, how far along, and two counts.
  const fill = h('span', { class: 'sp-fill' });
  fill.style.width = `${Math.max(percent, 2)}%`;
  const goalCard = h(
    'section',
    { class: 'sp-goal' },
    h('div', { class: 'sp-goal-top' }, h('span', { class: 'sp-goal-title' }, goal.title ?? t('Signed by Rigby2D')), h('span', { class: 'sp-goal-amount' }, t('{percent}% of ${monthly} a month', { percent, monthly: goal.monthly ?? 25 }))),
    h('div', { class: 'sp-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) }, fill),
    h(
      'div',
      { class: 'sp-stats' },
      h('span', null, h('b', null, String(everyone.length)), ' ', everyone.length === 1 ? t('supporter') : t('supporters')),
      h('span', null, h('b', null, String(Math.max(0, left))), ' ', t('Founding spots left')),
    ),
  );

  // The Founding Supporters: taken seats, then one open seat inviting the next person.
  const seats = founders.map((p, i) => person(p.name ?? p.login, `#${i + 1}`, ' founding'));
  if (left > 0) seats.push(h('li', { class: 'sp-person open' }, h('span', { class: 'sp-avatar empty', 'aria-hidden': 'true' }, `#${foundingIds.length + 1}`), h('span', { class: 'sp-text' }, h('span', { class: 'sp-name' }, t('Your name here')), h('span', { class: 'sp-note' }, t('From $3 a month')))));

  const section = (title, count, list) => h('section', { class: 'sp-section' }, h('h3', null, title, count ? h('span', { class: 'sp-count' }, count) : null), list);
  const tierName = (n = 0) => (n >= 1000 ? t('Studio Partner') : n >= 250 ? t('Studio') : n >= 50 ? t('Indie Team') : n >= 10 ? t('Sponsor') : t('Backer'));

  const parts = [
    goalCard,
    section(t('Founding Supporters'), `${foundingIds.length} / ${FOUNDING_SEATS}`, h('ul', { class: 'sp-grid' }, seats)),
    others.length ? section(t('Supporters'), String(others.length), h('ul', { class: 'sp-grid' }, others.map((p) => person(p.name ?? p.login, tierName(p.tier))))) : null,
    section(t('Code contributors'), String((data.contributors ?? []).length), h('ul', { class: 'sp-grid' }, (data.contributors ?? []).map((c) => person(c.name ?? c.login, c.login === FOUNDER ? t('Founder') : null)))),
    h(
      'div',
      { class: 'sp-footer' },
      h('p', { class: 'weak' }, t('Nothing is locked behind a tier. Support keeps Rigby2D free for everyone.')),
      h('div', { class: 'buttons' }, h('button', { onclick: () => openExternal(LINKS.fund) }, t('Where the money goes ↗')), h('button', { class: 'primary', onclick: () => openExternal(LINKS.sponsor) }, t('Sponsor on GitHub ↗'))),
    ),
  ];
  body.append(...parts.filter(Boolean));
}
