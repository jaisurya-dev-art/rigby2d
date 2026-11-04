// SPDX-License-Identifier: MIT OR Apache-2.0
// The dialog shown when an export or render ends: it worked (where it went, with Show in folder on
// desktop) or it failed (and why). The status bar keeps the same line.

import * as platform from './platform.js';
import { h } from './widgets.js';

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
    ? h('button', { onclick: () => platform.revealPath(path).catch((e) => app.setStatus(`Could not open the folder: ${e?.message ?? e}`)) }, 'Show in folder')
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

/** Stops playback for a long export or render, so the viewport doesn't compete for the CPU/GPU. */
export function pausePlayback(app) {
  if (!app.playing) return;
  app.playing = false;
  app.changed();
}
