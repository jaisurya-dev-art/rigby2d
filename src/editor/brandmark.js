// SPDX-License-Identifier: MIT OR Apache-2.0
// The Rigby2D R, inline in both brand-kit versions (branding/logos): the one for dark backgrounds,
// and the one for light backgrounds, shown on light themes (style.css .brand-mark). The top bar,
// the welcome screen and About use it; the What's new tour stays dark.

import darkSvg from '../../branding/logos/rigby2d-r.svg?raw';
import lightSvg from '../../branding/logos/rigby2d-r-light.svg?raw';
import { h } from './widgets.js';

const plain = (svg) => svg.replace(/role="img"[^>]*?aria-label="[^"]*"/, '');

/** The mark at `size` px, decorative (the name is always written beside it). */
export function brandMark(size, className = '') {
  const el = h('span', { class: `brand-mark ${className}`.trim(), 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` });
  el.innerHTML = `<span class="brand-mark-dark">${plain(darkSvg)}</span><span class="brand-mark-light">${plain(lightSvg)}</span>`;
  return el;
}
