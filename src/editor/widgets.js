// SPDX-License-Identifier: MIT OR Apache-2.0
// Small DOM helpers: element builder, draggable number fields and popup menus.

/** Shared widget state: panels are not rebuilt while a value is being dragged. */
export const widgetState = { dragging: false };

/** Creates an element. Props starting with `on` become listeners; known DOM properties are set directly. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else if (v === false) continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const round = (v, decimals) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/**
 * A number field edited by dragging horizontally, or by clicking to type a value.
 * `onChange(value)` is called for every change.
 */
export function dragValue(value, onChange, opts = {}) {
  const { speed = 1, prefix = '', suffix = '', decimals = 2, min = -Infinity, max = Infinity, disabled = false } = opts;
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const fmt = (v) => `${prefix}${round(v, decimals)}${suffix}`;
  let cur = value;
  const input = h('input', { class: 'drag', type: 'text', readOnly: true, disabled, value: fmt(cur), spellcheck: false });
  let startX = null;
  let startValue = 0;
  let moved = false;

  input.addEventListener('pointerdown', (e) => {
    if (!input.readOnly || disabled || e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startValue = cur;
    moved = false;
    input.setPointerCapture(e.pointerId);
    widgetState.dragging = true;
  });
  input.addEventListener('pointermove', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 2) return;
    moved = true;
    const fine = e.shiftKey ? 0.1 : 1;
    cur = clamp(round(startValue + dx * speed * fine, decimals));
    input.value = fmt(cur);
    onChange(cur);
  });
  const end = () => {
    if (startX === null) return;
    startX = null;
    widgetState.dragging = false;
    if (!moved) {
      input.readOnly = false;
      input.value = String(round(cur, decimals));
      input.focus();
      input.select();
    }
  };
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = String(cur);
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    if (input.readOnly) return;
    input.readOnly = true;
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && clamp(v) !== cur) {
      cur = clamp(v);
      onChange(cur);
    }
    input.value = fmt(cur);
  });
  return input;
}

/** A text field; Enter confirms. */
export function textField(value, onInput, { disabled = false, width } = {}) {
  const input = h('input', { type: 'text', value, disabled, spellcheck: false, style: width ? { width } : undefined });
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') input.blur();
  });
  return input;
}

/** A <select>; `options` is a list of [value, label]. Values are compared as strings. */
export function select(options, value, onChange, { disabled = false, placeholder, tut = null } = {}) {
  const el = h(
    'select',
    { disabled, 'data-tut': tut },
    placeholder ? h('option', { value: '', disabled: true }, placeholder) : null,
    options.map(([v, label]) => h('option', { value: String(v) }, label)),
  );
  el.value = placeholder && value === undefined ? '' : String(value);
  el.addEventListener('change', () => {
    const picked = options.find(([v]) => String(v) === el.value);
    el.blur();
    if (picked) onChange(picked[0]);
  });
  return el;
}

let openMenu = null;

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

/** Builds one popup entry: a separator, a raw DOM node, or a { label, shortcut, disabled, action } item. */
function menuEntry(it) {
  if (it === 'separator') return h('div', { class: 'sep' });
  if (it instanceof Node) return it;
  return h(
    'button',
    {
      class: `item${it.class ? ` ${it.class}` : ''}`,
      'data-tut': `item:${it.label}`,
      title: it.title ?? null,
      disabled: !!it.disabled,
      onclick: () => {
        closeMenu();
        it.action();
      },
    },
    h('span', null, it.label),
    it.shortcut ? h('span', { class: 'shortcut' }, it.shortcut) : null,
  );
}

/**
 * A menu entry that opens a nested popup to its right (on hover or click). `items` is a list like
 * popupMenu's, or a function returning one (built fresh each time it opens, so it can show live
 * state). The child popup lives inside this entry, so the outside-click logic keeps it open.
 */
export function submenuItem(label, items, { title } = {}) {
  const btn = h('button', { class: 'item submenu', title: title ?? null }, h('span', null, label), h('span', { class: 'shortcut' }, '▸'));
  let child = null;
  const closeChild = () => {
    child?.remove();
    child = null;
  };
  const open = () => {
    if (child) return;
    child = h('div', { class: 'popup submenu-popup' }, (typeof items === 'function' ? items() : items).filter(Boolean).map(menuEntry));
    btn.append(child);
    const r = btn.getBoundingClientRect();
    child.style.left = `${Math.max(0, Math.min(r.right - 2, window.innerWidth - child.offsetWidth - 4))}px`;
    child.style.top = `${Math.max(0, Math.min(r.top - 4, window.innerHeight - child.offsetHeight - 4))}px`;
    // Moving the pointer to a sibling entry closes this submenu.
    const parent = btn.closest('.popup');
    const onOver = (e) => {
      const it = e.target.closest('.item');
      if (it && it !== btn && !btn.contains(it)) {
        closeChild();
        parent?.removeEventListener('pointerover', onOver);
      }
    };
    parent?.addEventListener('pointerover', onOver);
  };
  btn.addEventListener('pointerenter', open);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });
  return btn;
}

/**
 * Shows a popup menu at screen position (x, y). Items are { label, shortcut, disabled, action }
 * or 'separator' or a DOM node (e.g. submenuItem).
 */
export function popupMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'popup' }, items.filter(Boolean).map(menuEntry));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 4))}px`;
  openMenu = menu;
  return menu;
}

export function isMenuOpen() {
  return openMenu !== null;
}

window.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target) && !e.target.closest?.('.menu-title')) closeMenu();
});
