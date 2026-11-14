// SPDX-License-Identifier: MIT OR Apache-2.0
// The editor's own colour picker, in the theme's colours (the system picker looks like the system):
// a swatch button that opens a popover with a saturation/brightness square, a hue strip, a hex field
// and quick swatches. Drags update live (onInput); closing reports the final colour (onCommit).

import { parseColor, toHex } from './themes.js';
import { t } from './i18n.js';
import { h } from './widgets.js';

/** #rrggbb -> [h 0-360, s 0-1, v 0-1]. */
function toHsv(hex) {
  const [r, g, b] = (parseColor(hex) ?? [0, 0, 0]).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, max ? d / max : 0, max];
}

/** [h, s, v] -> #rrggbb. */
function fromHsv([hue, s, v]) {
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return toHex([f(5), f(3), f(1)]);
}

let open = null;

/** Closes the open picker, if any. */
export function closeColorPicker() {
  open?.close();
}

/**
 * A colour swatch button. Clicking it opens the picker beside it. `onInput(hex)` follows every
 * change; `onCommit(hex)` runs when the picker closes after a change. `swatches`: quick colours.
 */
export function colorButton(value, { onInput, onCommit = null, swatches = [], label = '' } = {}) {
  let current = value;
  const btn = h('button', { type: 'button', class: 'cp-swatch', style: `background:${value}`, 'aria-label': label ? t('{name}: change colour', { name: label }) : t('Change colour'), title: value.toUpperCase() });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = open?.anchor === btn;
    closeColorPicker();
    if (wasOpen) return;
    openPicker(btn, current, {
      swatches,
      onInput: (hex) => {
        current = hex;
        btn.style.background = hex;
        btn.title = hex.toUpperCase();
        onInput?.(hex);
      },
      onCommit: (hex) => onCommit?.(hex),
    });
  });
  return btn;
}

function openPicker(anchor, start, { swatches, onInput, onCommit }) {
  let hsv = toHsv(start);
  let changed = false;
  const knob = h('span', { class: 'cp-knob' });
  const sv = h('div', { class: 'cp-sv', role: 'slider', 'aria-label': t('Saturation and brightness'), tabindex: '0' }, knob);
  const hueKnob = h('span', { class: 'cp-hue-knob' });
  const hue = h('div', { class: 'cp-hue', role: 'slider', 'aria-label': t('Hue'), 'aria-valuemin': '0', 'aria-valuemax': '360', tabindex: '0' }, hueKnob);
  const preview = h('span', { class: 'cp-preview' });
  const hex = h('input', { type: 'text', class: 'cp-hex', spellcheck: false, maxlength: 7, 'aria-label': t('Hex colour') });

  const draw = (fromHex = false) => {
    const color = fromHsv(hsv);
    sv.style.backgroundColor = `hsl(${hsv[0]} 100% 50%)`;
    knob.style.left = `${hsv[1] * 100}%`;
    knob.style.top = `${(1 - hsv[2]) * 100}%`;
    knob.style.background = color;
    hueKnob.style.left = `${(hsv[0] / 360) * 100}%`;
    hueKnob.style.background = `hsl(${hsv[0]} 100% 50%)`;
    hue.setAttribute('aria-valuenow', String(Math.round(hsv[0])));
    preview.style.background = color;
    if (!fromHex) hex.value = color.toUpperCase();
  };
  const emit = () => {
    changed = true;
    onInput(fromHsv(hsv));
  };
  const setHex = (value) => {
    const c = parseColor(value.startsWith('#') ? value : `#${value}`);
    if (!c) return false;
    // Keep the hue of greys (their hue is undefined).
    const next = toHsv(toHex(c));
    hsv = next[1] === 0 ? [hsv[0], 0, next[2]] : next;
    draw(true);
    emit();
    return true;
  };

  /** Pointer drags on the square and the strip. */
  const dragOn = (el, apply) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = el.getBoundingClientRect();
        apply(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        draw();
        emit();
      };
      move(e);
      el.onpointermove = move;
      el.onpointerup = () => {
        el.onpointermove = null;
        el.onpointerup = null;
      };
    });
  };
  dragOn(sv, (x, y) => {
    hsv = [hsv[0], x, 1 - y];
  });
  dragOn(hue, (x) => {
    hsv = [x * 360, hsv[1], hsv[2]];
  });
  // Arrow keys nudge (Shift: larger steps).
  const nudge = (el, fn) =>
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      fn(...d);
      draw();
      emit();
    });
  nudge(sv, (dx, dy) => {
    hsv = [hsv[0], Math.min(1, Math.max(0, hsv[1] + dx)), Math.min(1, Math.max(0, hsv[2] + dy))];
  });
  nudge(hue, (dx) => {
    hsv = [(hsv[0] + dx * 360 + 360) % 360, hsv[1], hsv[2]];
  });
  hex.addEventListener('input', () => hex.value.length >= 4 && setHex(hex.value.trim()));
  hex.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') close();
  });

  const chips = [...new Set(swatches.map((s) => s.toLowerCase()))].slice(0, 24);
  const pop = h(
    'div',
    { class: 'cp-popover', role: 'dialog', 'aria-label': t('Colour') },
    sv,
    h('div', { class: 'cp-row' }, preview, hue),
    h('div', { class: 'cp-row' }, h('span', { class: 'cp-hash' }, '#'), hex),
    chips.length
      ? h(
          'div',
          { class: 'cp-chips', 'aria-label': t('Theme colours') },
          ...chips.map((c) => h('button', { type: 'button', class: 'cp-chip', style: `background:${c}`, title: c.toUpperCase(), 'aria-label': c.toUpperCase(), onclick: () => setHex(c) })),
        )
      : null,
  );
  document.body.append(pop);
  draw();

  // Beside the swatch, kept inside the window.
  const a = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const left = Math.min(window.innerWidth - p.width - 8, Math.max(8, a.left));
  const below = a.bottom + 6 + p.height <= window.innerHeight - 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? a.bottom + 6 : Math.max(8, a.top - p.height - 6)}px`;

  // Close on a click elsewhere or Escape (before the dialog underneath sees the key).
  const onDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) close();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
    anchor.focus();
  };
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  window.addEventListener('keydown', onKey, true);
  function close() {
    if (!pop.isConnected) return;
    pop.remove();
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    open = null;
    if (changed) onCommit(fromHsv(hsv));
  }
  open = { anchor, close };
  requestAnimationFrame(() => sv.focus({ preventScroll: true }));
}
