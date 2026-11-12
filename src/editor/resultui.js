// SPDX-License-Identifier: MIT OR Apache-2.0
// The dialog shown when an export or render ends: it worked (where it went, with Show in folder on
// desktop) or it failed (and why). The status bar keeps the same line.

import * as platform from './platform.js';
import { h } from './widgets.js';
import { button, dialog, uiIcon } from './ui.js';
import { t } from './i18n.js';

/**
 * Shows the outcome of an export or render. `ok`: whether it worked; `title`: e.g. 'Sprite sheet
 * exported'; `detail`: one or two sentences; `path`: the file or folder written, if any. Enter or
 * Escape closes it.
 */
export function showResult(app, { ok, title, detail = '', path = null }) {
  app.setStatus(`${title}${detail ? `: ${detail}` : ''}`);
  const onKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    close();
  };
  const reveal =
    ok && path && platform.isDesktop
      ? button(t('Show in folder'), { icon: 'folder-open', onclick: () => platform.revealPath(path).catch((e) => app.setStatus(t('Could not open the folder: {error}', { error: e?.message ?? e }))) })
      : null;
  const { el, body, footer, close } = dialog({
    title,
    className: `result-dialog ${ok ? 'result-ok' : 'result-failed'}`,
    backdropClass: 'result-backdrop',
    role: 'alertdialog',
    footer: [reveal, button(t('Close'), { kind: 'primary', onclick: () => close() })],
    onClose: () => document.removeEventListener('keydown', onKey, true),
  });
  el.querySelector('.dialog-head h3').prepend(uiIcon(ok ? 'check' : 'triangle-alert'));
  body.append(...[detail ? h('p', null, detail) : null, path ? h('p', { class: 'small result-path' }, path) : null].filter(Boolean));
  document.addEventListener('keydown', onKey, true);
  footer.querySelector('.ui-btn-primary')?.focus();
}

/**
 * Asks one question with a few buttons. `choices`: [{ label, value, primary? }]. Resolves with the
 * chosen value, or null when dismissed (Escape).
 */
export function askChoice({ title, detail = '', list = [], choices }) {
  return new Promise((resolve) => {
    let answer = null;
    const pick = (value) => () => {
      answer = value;
      close();
    };
    // More than two answers stack as a list in the body (labels stay on one line); two sit in the footer.
    const stacked = choices.length > 2;
    const ordered = stacked ? choices : [...choices.filter((c) => !c.primary), ...choices.filter((c) => c.primary)];
    const buttons = ordered.map((c) => button(c.label, { kind: c.primary ? 'primary' : 'secondary', onclick: pick(c.value) }));
    const { body, close } = dialog({
      title,
      className: 'result-dialog',
      backdropClass: 'result-backdrop',
      footer: stacked ? null : buttons,
      onClose: () => resolve(answer),
    });
    body.append(
      ...[
        detail ? h('p', null, detail) : null,
        list.length ? h('ul', { class: 'small result-list' }, list.map((item) => h('li', null, item))) : null,
        stacked ? h('div', { class: 'choice-stack' }, buttons) : null,
      ].filter(Boolean),
    );
    buttons.find((b) => b.classList.contains('ui-btn-primary'))?.focus();
  });
}

/**
 * Asks for a line of text, starting from `value`. Resolves with the text (trimmed), or null when
 * cancelled (Cancel or Escape).
 */
export function askText({ title, detail = '', value = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    let answer = null;
    const input = h('input', { type: 'text', value, spellcheck: false, style: { width: '100%' } });
    const submit = () => {
      answer = input.value.trim();
      close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      submit();
    });
    const { body, close } = dialog({
      title,
      className: 'result-dialog',
      backdropClass: 'result-backdrop',
      footer: [button(t('Cancel'), { onclick: () => close() }), button(t(okLabel), { kind: 'primary', onclick: submit })],
      onClose: () => resolve(answer),
    });
    body.append(...[detail ? h('p', null, detail) : null, input].filter(Boolean));
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
    let answer = null;
    const confirm = (v) => {
      answer = v;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm(selected);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = options.findIndex((o) => o.value === selected) + (e.key === 'ArrowDown' ? 1 : -1);
        if (options[i]) select(options[i].value);
      }
    };
    const rows = options.map((o) =>
      h(
        'button',
        { class: 'option-row', role: 'radio', onclick: () => select(o.value), ondblclick: () => confirm(o.value) },
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
    const { body, footer, close } = dialog({
      title,
      className: 'result-dialog',
      backdropClass: 'result-backdrop',
      footer: [button(t('Cancel'), { onclick: () => close() }), button(t(okLabel), { kind: 'primary', onclick: () => confirm(selected) })],
      onClose: () => {
        document.removeEventListener('keydown', onKey, true);
        resolve(answer);
      },
    });
    body.append(...[detail ? h('p', null, detail) : null, h('div', { class: 'option-list', role: 'radiogroup' }, rows)].filter(Boolean));
    select(selected);
    document.addEventListener('keydown', onKey, true);
    footer.querySelector('.ui-btn-primary')?.focus();
  });
}

/** Stops playback for a long export or render, so the viewport doesn't compete for the CPU/GPU. */
export function pausePlayback(app) {
  if (!app.playing) return;
  app.playing = false;
  app.changed();
}
