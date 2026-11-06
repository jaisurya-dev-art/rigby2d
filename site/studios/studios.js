// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's page for studios: mostly static, plus the studios that sponsor Rigby2D (from
// supporters.js), the shared navigation and visit counts.

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';
import { SPONSOR_URL, loadSupporters, people } from '../supporters.js';

startAnalytics();
installMobileNav();

const STUDIO_TIER = 25;

/** A studio sponsor's logo (their GitHub avatar) and name, linked to their profile. */
function logo(p) {
  const a = document.createElement(p.url ? 'a' : 'div');
  a.className = `st-logo${p.tier >= 100 ? ' pro' : ''}`;
  if (p.url) {
    a.href = p.url;
    a.rel = 'noopener';
  }
  if (p.avatar) {
    const img = document.createElement('img');
    img.src = p.avatar;
    img.alt = '';
    img.loading = 'lazy';
    a.append(img);
  }
  const name = document.createElement('span');
  name.textContent = p.name;
  a.append(name);
  return a;
}

/** An empty spot, inviting the next studio. */
function spot() {
  const a = document.createElement('a');
  a.className = 'st-logo open';
  a.href = SPONSOR_URL;
  a.rel = 'noopener';
  a.textContent = 'Your studio here';
  return a;
}

const wall = document.getElementById('studio-logos');
if (wall) {
  loadSupporters().then((data) => {
    const studios = people(data).filter((p) => (p.tier ?? 0) >= STUDIO_TIER);
    wall.replaceChildren(...studios.map(logo), ...Array.from({ length: Math.max(1, 3 - studios.length) }, spot));
  });
}
