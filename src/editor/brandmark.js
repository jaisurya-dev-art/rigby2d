// SPDX-License-Identifier: MIT OR Apache-2.0
// The Rigby2D mark, inline so its white bowl can follow the theme (dark on Rigby Light; style.css
// .brand-mark). The top bar, the welcome screen and About use it; the What's new tour stays dark.

import markSvg from '../../branding/rigby2d-mark.svg?raw';
import { h } from './widgets.js';

/** The mark at `size` px, decorative (the name is always written beside it). */
export function brandMark(size, className = '') {
  const el = h('span', { class: `brand-mark ${className}`.trim(), 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` });
  el.innerHTML = markSvg.replace(/role="img"[^>]*?aria-label="[^"]*"/, '');
  return el;
}
