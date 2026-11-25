// SPDX-License-Identifier: MIT OR Apache-2.0
// Command search (Ctrl+Shift+P; F3 with the Blender-like keys): type part of a command's name and run
// it. It lists every menu item (submenus included, with the path they sit under) and every keyboard
// action, with its shortcut. Like Blender's F3 menu search and the command palettes of code editors:
// nobody has to remember which menu something lives in. The matching itself (commandMatches) has no
// DOM, for tests (commandmatch.js).

import { t } from './i18n.js';
import { commandMatches } from './commandmatch.js';
import { dialog, uiIcon } from './ui.js';
import { h } from './widgets.js';

let open = null;

/** Opens the search over everything `commands()` returns (built fresh, so it reflects the state). */
export function openCommandSearch(commands) {
  if (open) return open.focus();
  const all = commands();
  let shown = [];
  let at = 0;
  const list = h('div', { class: 'cmd-list', role: 'listbox', 'aria-label': t('Commands') });
  const input = h('input', {
    class: 'cmd-input',
    type: 'search',
    placeholder: t('Type a command, e.g. "frame", "paste", "bones"'),
    'aria-label': t('Find a command'),
    spellcheck: false,
    oninput: () => draw(),
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        at = Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
        mark();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runAt(at);
      }
    },
  });
  // The shared dialog (focus trap, Escape, backdrop click), bare: just the field and the list.
  const { el, close: closeDialog } = dialog({ title: t('Find a command'), className: 'cmd-box', backdropClass: 'cmd-backdrop', bare: true, onClose: () => (open = null) });
  el.append(input, list);

  function runAt(i) {
    const c = shown[i];
    if (!c || c.disabled) return;
    close();
    c.run();
  }
  function mark() {
    [...list.children].forEach((el, i) => el.classList.toggle('active', i === at));
    list.children[at]?.scrollIntoView({ block: 'nearest' });
  }
  function draw() {
    shown = commandMatches(all, input.value);
    at = 0;
    list.replaceChildren(
      ...(shown.length
        ? shown.map((c, i) =>
            h(
              'button',
              { class: `cmd-item${c.disabled ? ' disabled' : ''}`, role: 'option', disabled: c.disabled, onpointerenter: () => ((at = i), mark()), onclick: () => runAt(i) },
              h('span', { class: 'cmd-check' }, c.checked === true ? uiIcon('check', 'sm') : null),
              h('span', { class: 'cmd-name' }, c.label),
              c.path.length ? h('span', { class: 'cmd-path' }, c.path.join(' / ')) : null,
              c.shortcut ? h('span', { class: 'cmd-key' }, c.shortcut) : null,
            ),
          )
        : [h('div', { class: 'cmd-empty' }, t('No command matches.'))]),
    );
    mark();
  }
  function close() {
    closeDialog();
  }
  open = input;
  draw();
  input.focus();
}
