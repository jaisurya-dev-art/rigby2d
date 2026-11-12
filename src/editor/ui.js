// SPDX-License-Identifier: MIT OR Apache-2.0
// Shared interface components (Rigby2D Interface 1): one dialog, one button family, one toggle per
// meaning, field rows, sections and one-line hints, all styled from the design tokens in style.css
// (the `ui-` classes). New interface code builds on these instead of its own markup and styles.

import { icon } from './icons.js';
import { t } from './i18n.js';
import { openExternal } from './platform.js';
import { h } from './widgets.js';

const DOCS = 'https://rigby2d.com/docs/';

/** Icon sizes: toolbars and buttons use 16, rows and dense lists 14. */
const ICON = { sm: 14, md: 16 };
const STROKE = 1.75;

/** An interface icon at the design system's size and line width. */
export function uiIcon(name, size = 'md') {
  return icon(name, ICON[size] ?? size, STROKE);
}

/** A tooltip with the shortcut in it: "Undo (Ctrl+Z)". */
export function tooltip(title, shortcut) {
  return shortcut ? `${title} (${shortcut})` : title;
}

/**
 * A button. `kind`: 'secondary' (default), 'primary' (the one main action of a dialog or panel),
 * 'ghost' (quiet, for toolbars and rows) or 'danger' (deletes or discards). `size`: 'md' or 'sm'.
 */
export function button(label, { kind = 'secondary', size = 'md', icon: iconName = null, title, shortcut, disabled = false, onclick, type = 'button' } = {}) {
  return h(
    'button',
    { type, class: `ui-btn ui-btn-${kind}${size === 'sm' ? ' ui-btn-sm' : ''}`, title: title || shortcut ? tooltip(title ?? label, shortcut) : undefined, disabled, onclick },
    iconName ? uiIcon(iconName, size === 'sm' ? 'sm' : 'md') : null,
    label ? h('span', null, label) : null,
  );
}

/** A square button with only an icon; its title (and shortcut) is the tooltip and the accessible name. */
export function iconButton(iconName, { title, shortcut, active = false, disabled = false, onclick, size = 'md' } = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: `ui-icon-btn${size === 'sm' ? ' ui-icon-btn-sm' : ''}${active ? ' active' : ''}`,
      title: tooltip(title, shortcut),
      'aria-label': title,
      'aria-pressed': active ? 'true' : undefined,
      disabled,
      onclick,
    },
    uiIcon(iconName, size),
  );
}

/** A checkbox: for settings that stay as they are (Loop, Transparent background). */
export function checkbox(label, checked, onChange, { title, disabled = false } = {}) {
  return h(
    'label',
    { class: 'ui-check', title },
    h('input', { type: 'checkbox', checked: !!checked, disabled, onchange: (e) => onChange(e.target.checked) }),
    h('span', null, label),
  );
}

/** A toggle button: for modes switched while working (Onion skin, Auto key). */
export function toggleButton(label, on, onChange, { icon: iconName = null, title, shortcut, disabled = false } = {}) {
  return h(
    'button',
    { type: 'button', class: `ui-toggle${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', title: title || shortcut ? tooltip(title ?? label, shortcut) : undefined, disabled, onclick: () => onChange(!on) },
    iconName ? uiIcon(iconName) : null,
    label ? h('span', null, label) : null,
  );
}

/** A segmented control: one of a few options ([value, label] pairs). */
export function segmented(options, value, onChange, { title } = {}) {
  return h(
    'div',
    { class: 'ui-segmented', role: 'group', title },
    options.map(([v, label]) =>
      h('button', { type: 'button', class: v === value ? 'active' : '', 'aria-pressed': v === value ? 'true' : 'false', onclick: () => v !== value && onChange(v) }, label),
    ),
  );
}

/** A label and its value or controls, in the two-column field grid (put rows in `fields()`). */
export function fieldRow(label, ...content) {
  return [h('label', { class: 'ui-field-label' }, label), h('div', { class: 'ui-field-value' }, ...content)];
}

/** The two-column grid for field rows. */
export function fields(...rows) {
  return h('div', { class: 'ui-fields' }, ...rows);
}

/** Sections that are folded, and those the user has folded or unfolded (kept for the session). */
const folded = new Set();
const touched = new Set();

/**
 * A section with a title; with `id`, the title folds and unfolds it (remembered for the session).
 * `actions` sit on the right of the title.
 */
export function section(title, children, { id = null, actions = null, open = true } = {}) {
  if (id && !open && !touched.has(id)) folded.add(id);
  const isOpen = !id || !folded.has(id);
  const el = h('section', { class: `ui-section${isOpen ? '' : ' folded'}` });
  const body = h('div', { class: 'ui-section-body' }, children);
  const head = h(
    'div',
    { class: 'ui-section-head' },
    id
      ? h(
          'button',
          {
            type: 'button',
            class: 'ui-section-toggle',
            'aria-expanded': isOpen ? 'true' : 'false',
            onclick: () => {
              const nowOpen = folded.has(id);
              if (nowOpen) folded.delete(id);
              else folded.add(id);
              touched.add(id);
              el.classList.toggle('folded', !nowOpen);
              head.querySelector('.ui-section-toggle').setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
            },
          },
          uiIcon('chevron-down', 'sm'),
          h('span', null, title),
        )
      : h('span', { class: 'ui-section-title' }, title),
    actions ? h('div', { class: 'ui-section-actions' }, actions) : null,
  );
  el.append(head, body);
  return el;
}

/**
 * A one-line hint under a control or at the top of a dialog. `docs` is a docs page (and anchor),
 * as in 'meshes#generating-a-mesh-from-the-image', shown as a "Learn more" link. `tone`: 'muted'
 * (default), 'warning' or 'danger'.
 */
export function hint(text, { docs = null, tone = 'muted' } = {}) {
  const [page, anchor] = docs ? docs.split('#') : [];
  return h(
    'p',
    { class: `ui-hint ui-hint-${tone}` },
    tone !== 'muted' ? uiIcon(tone === 'danger' ? 'triangle-alert' : 'info', 'sm') : null,
    h('span', null, text),
    docs
      ? h(
          'a',
          {
            href: `${DOCS}${page}.html${anchor ? `#${anchor}` : ''}`,
            onclick: (e) => {
              e.preventDefault();
              openExternal(e.currentTarget.href);
            },
          },
          t('Learn more'),
        )
      : null,
  );
}

/** The close button of a dialog or window (the ✕ in its header). */
export function closeButton(onclick) {
  return h('button', { type: 'button', class: 'dialog-close', title: tooltip(t('Close'), 'Esc'), 'aria-label': t('Close'), onclick }, uiIcon('x'));
}

/**
 * A modal dialog: header (title, optional one-line subtitle, close button), body, optional footer.
 * Escape, the close button and a click outside close it; with several open, Escape closes the top
 * one. `footer` is a list of buttons, laid out on the right (secondary first, primary last).
 * `backdropClass: 'result-backdrop'` stacks it above other dialogs (results and questions that
 * come up while a dialog is open).
 * `bare: true` leaves out the header, body and footer, for a screen with its own layout (the
 * welcome screen): put its content in `el`, and its own close button calls `close`.
 * Returns { el, body, footer, close, setFooter }.
 */
export function dialog({ title, subtitle = null, className = '', onClose = null, footer = null, closeOnBackdrop = true, backdropClass = '', role = 'dialog', bare = false } = {}) {
  const overlay = h('div', { class: `modal-backdrop ${backdropClass}`.trim() });
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const backdrops = document.querySelectorAll('.modal-backdrop');
    if (backdrops[backdrops.length - 1] !== overlay) return;
    e.stopImmediatePropagation();
    close();
  };
  const body = h('div', { class: 'dialog-body' });
  const foot = h('footer', { class: 'dialog-foot' });
  const setFooter = (buttons) => {
    foot.replaceChildren(...(buttons ?? []).filter(Boolean));
    foot.hidden = !foot.childElementCount;
  };
  setFooter(footer);
  const el = bare
    ? h('div', { class: `modal ${className}`.trim(), role, 'aria-modal': 'true', 'aria-label': title })
    : h(
        'div',
        { class: `modal dialog ${className}`.trim(), role, 'aria-modal': 'true', 'aria-label': title },
        h(
          'header',
          { class: 'dialog-head' },
          h('div', { class: 'dialog-titles' }, h('h3', null, title), subtitle ? h('p', { class: 'dialog-sub' }, subtitle) : null),
          closeButton(close),
        ),
        body,
        foot,
      );
  if (closeOnBackdrop) overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());
  overlay.append(el);
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { el, body, footer: foot, close, setFooter };
}
