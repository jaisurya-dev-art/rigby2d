// SPDX-License-Identifier: MIT OR Apache-2.0
// The dialog shown when an export or render ends: it worked (where it went, with Show in folder on
// desktop) or it failed (and why). The status bar keeps the same line.

import * as platform from './platform.js';
import { h } from './widgets.js';
import { t } from './i18n.js';

/**
 * Shows the outcome of an export or render. `ok`: whether it worked; `title`: e.g. 'Sprite sheet
 * exported'; `detail`: one or two sentences; `path`: the file or folder written, if any.
 */
export function showResult(app, { ok, title, detail = '', path = null }) {
  app.setStatus(`${title}${detail ? `: ${detail}` : ''}`);
  const overlay = h('div', { class: 'modal-backdrop result-backdrop' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const reveal = ok && path && platform.isDesktop
    ? h('button', { onclick: () => platform.revealPath(path).catch((e) => app.setStatus(t('Could not open the folder: {error}', { error: e?.message ?? e }))) }, t('Show in folder'))
    : null;
  overlay.append(
    h(
      'div',
      { class: 'modal result-dialog', role: 'alertdialog', 'aria-labelledby': 'result-title' },
      h('h3', { id: 'result-title', class: ok ? 'result-ok' : 'result-failed' }, ok ? '✓ ' : '✕ ', title),
      detail ? h('p', null, detail) : null,
      path ? h('p', { class: 'small result-path' }, path) : null,
      h('div', { class: 'modal-buttons' }, reveal, h('button', { class: 'primary', onclick: close }, 'OK')),
    ),
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  overlay.querySelector('button.primary')?.focus();
}

/**
 * Asks one question with a few buttons. `choices`: [{ label, value, primary? }]. Resolves with the
 * chosen value, or null when dismissed (Escape).
 */
export function askChoice({ title, detail = '', list = [], choices }) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal-backdrop result-backdrop' });
    const done = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    overlay.append(
      h(
        'div',
        { class: 'modal result-dialog', role: 'dialog', 'aria-labelledby': 'choice-title' },
        h('h3', { id: 'choice-title' }, title),
        detail ? h('p', null, detail) : null,
        list.length ? h('ul', { class: 'small result-list' }, list.map((item) => h('li', null, item))) : null,
        // More than two answers stack as a list (labels stay on one line).
        h('div', { class: choices.length > 2 ? 'modal-buttons choice-stack' : 'modal-buttons' }, choices.map((c) => h('button', { class: c.primary ? 'primary' : null, onclick: () => done(c.value) }, c.label))),
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('button.primary')?.focus();
  });
}

/**
 * Asks for a line of text, starting from `value`. Resolves with the text (trimmed), or null when
 * cancelled (Cancel or Escape).
 */
export function askText({ title, detail = '', value = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal-backdrop result-backdrop' });
    const input = h('input', { type: 'text', value, spellcheck: false, style: { width: '100%' } });
    const done = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        done(input.value.trim());
      }
    };
    overlay.append(
      h(
        'div',
        { class: 'modal result-dialog', role: 'dialog', 'aria-labelledby': 'text-title' },
        h('h3', { id: 'text-title' }, title),
        detail ? h('p', null, detail) : null,
        input,
        h('div', { class: 'modal-buttons' }, h('button', { onclick: () => done(null) }, t('Cancel')), h('button', { class: 'primary', onclick: () => done(input.value.trim()) }, t(okLabel))),
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    input.focus();
    input.select();
  });
}

/**
 * Asks to pick one option from a list, then confirm. `options`: [{ label, value }]; `value` is
 * selected at first. Clicking an option only selects it; `okLabel` (or Enter, or a double-click)
 * confirms. Resolves with the chosen value, or null when cancelled (Cancel or Escape).
 */
export function askOption({ title, detail = '', options, value, okLabel = 'OK' }) {
  return new Promise((resolve) => {
    let selected = options.some((o) => o.value === value) ? value : options[0]?.value;
    const overlay = h('div', { class: 'modal-backdrop result-backdrop' });
    const done = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        done(e.key === 'Enter' ? selected : null);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = options.findIndex((o) => o.value === selected) + (e.key === 'ArrowDown' ? 1 : -1);
        if (options[i]) select(options[i].value);
      }
    };
    const rows = options.map((o) =>
      h(
        'button',
        { class: 'option-row', role: 'radio', onclick: () => select(o.value), ondblclick: () => done(o.value) },
        h('span', { class: 'option-dot' }),
        o.label,
      ),
    );
    const select = (v) => {
      selected = v;
      options.forEach((o, i) => {
        rows[i].classList.toggle('selected', o.value === v);
        rows[i].setAttribute('aria-checked', String(o.value === v));
      });
    };
    overlay.append(
      h(
        'div',
        { class: 'modal result-dialog', role: 'dialog', 'aria-labelledby': 'option-title' },
        h('h3', { id: 'option-title' }, title),
        detail ? h('p', null, detail) : null,
        h('div', { class: 'option-list', role: 'radiogroup' }, rows),
        h('div', { class: 'modal-buttons' }, h('button', { onclick: () => done(null) }, t('Cancel')), h('button', { class: 'primary', onclick: () => done(selected) }, okLabel)),
      ),
    );
    select(selected);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('button.primary')?.focus();
  });
}

/** Stops playback for a long export or render, so the viewport doesn't compete for the CPU/GPU. */
export function pausePlayback(app) {
  if (!app.playing) return;
  app.playing = false;
  app.changed();
}
