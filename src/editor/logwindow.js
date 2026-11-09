// SPDX-License-Identifier: MIT OR Apache-2.0
// The log window (View ▸ Log): filter by level, search, expand tracebacks, copy, clear.

import { LEVELS, clear, entries, formatEntries, markRead, stamp, subscribe } from './log.js';
import { h } from './widgets.js';
import { t } from './i18n.js';

let win = null;
// Expanded tracebacks stay open when the list is redrawn for new entries.
const view = { levels: new Set(['info', 'warn', 'error']), search: '', follow: true, opened: new Set() };

export const windowOpen = () => !!win;

/** Shows or hides the log window. */
export function toggleLogWindow() {
  if (win) closeLogWindow();
  else openLogWindow();
}

export function closeLogWindow() {
  if (!win) return;
  win.unsubscribe();
  markRead(false);
  win.el.remove();
  win = null;
}

export function openLogWindow() {
  if (win) return;
  markRead(true);
  const list = h('div', { class: 'log-list' });
  const count = h('span', { class: 'weak' });
  const levelToggle = (level) =>
    h(
      'label',
      { class: `log-filter log-${level}` },
      h('input', {
        type: 'checkbox',
        checked: view.levels.has(level),
        onchange: (e) => {
          if (e.target.checked) view.levels.add(level);
          else view.levels.delete(level);
          redraw();
        },
      }),
      ` ${level}`,
    );
  const visible = () => entries.filter(matches);
  const row = (e) =>
    e.trace
      ? h(
          'details',
          { class: `log-entry log-${e.level}`, open: view.opened.has(e.id), ontoggle: (ev) => (ev.target.open ? view.opened.add(e.id) : view.opened.delete(e.id)) },
          h('summary', null, ...line(e)),
          h('pre', { class: 'log-trace' }, e.trace),
        )
      : h('div', { class: `log-entry log-${e.level}` }, ...line(e));
  const line = (e) => [h('span', { class: 'log-time' }, stamp(e.time)), h('span', { class: 'log-source' }, e.source), h('span', { class: 'log-message' }, e.message)];
  const matches = (e) => {
    const q = view.search.toLowerCase();
    return view.levels.has(e.level) && (!q || `${e.source} ${e.message} ${e.trace ?? ''}`.toLowerCase().includes(q));
  };
  let shownCount = 0;
  const redraw = () => {
    const shown = visible();
    list.replaceChildren(...shown.map(row));
    shownCount = shown.length;
    count.textContent = `${shownCount} of ${entries.length}`;
    if (view.follow) list.scrollTop = list.scrollHeight;
  };
  /** A new entry: one row added (the oldest dropped past the log's limit), nothing rebuilt. */
  const append = (e) => {
    if (matches(e)) {
      list.append(row(e));
      shownCount++;
      while (list.childElementCount > entries.length) {
        list.firstElementChild.remove();
        shownCount--;
      }
      if (view.follow) list.scrollTop = list.scrollHeight;
    }
    count.textContent = `${shownCount} of ${entries.length}`;
  };
  list.addEventListener('scroll', () => (view.follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 4));

  const header = h(
    'div',
    { class: 'float-header' },
    h('b', null, t('Log')),
    h('span', { class: 'float-spacer' }),
    h('button', { title: t('Close'), onclick: () => closeLogWindow() }, '✕'),
  );
  const toolbar = h(
    'div',
    { class: 'log-toolbar' },
    ...LEVELS.map(levelToggle),
    h('input', {
      type: 'search',
      placeholder: t('Filter…'),
      value: view.search,
      oninput: (e) => {
        view.search = e.target.value;
        redraw();
      },
    }),
    count,
    h('span', { class: 'float-spacer' }),
    h(
      'button',
      {
        title: t('Copy the shown entries, with tracebacks'),
        onclick: async (e) => {
          const button = e.currentTarget;
          try {
            await navigator.clipboard.writeText(formatEntries(visible()));
            button.textContent = t('Copied');
          } catch {
            button.textContent = t('Copy failed');
          }
          setTimeout(() => (button.textContent = t('Copy')), 1200);
        },
      },
      t('Copy'),
    ),
    h('button', { onclick: () => clear() }, t('Clear')),
  );
  const el = h('div', { class: 'float-window log-window' }, header, toolbar, list);
  makeDraggable(el, header);
  document.body.append(el);
  win = {
    el,
    // null means the log was cleared.
    unsubscribe: subscribe((e) => (e ? append(e) : redraw())),
  };
  redraw();
}

/**
 * Lets a floating window be moved by its header (it stays inside the editor window). While
 * dragging it moves with a transform on its own compositor layer, so neither the window nor its
 * shadow is repainted on every pointer move; its position is written once when the drag ends.
 */
export function makeDraggable(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, right: 'auto', bottom: 'auto', willChange: 'transform' });
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    let dx = 0;
    let dy = 0;
    const move = (m) => {
      dx = clamp(m.clientX - e.clientX, -r.left, window.innerWidth - 80 - r.left);
      dy = clamp(m.clientY - e.clientY, -r.top, window.innerHeight - 30 - r.top);
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.removeEventListener(type, end);
      Object.assign(el.style, { left: `${r.left + dx}px`, top: `${r.top + dy}px`, transform: '', willChange: '' });
    };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (a very quick click): nothing to drag.
      return end();
    }
    handle.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, end);
  });
}
