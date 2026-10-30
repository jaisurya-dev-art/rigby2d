// SPDX-License-Identifier: MIT OR Apache-2.0
// The Add-ons page: search, tag filters and sorting over the cards the build wrote (data-* fields).

import { installMobileNav } from '../nav.js';

installMobileNav();

const grid = document.getElementById('market-grid');
const cards = [...grid.querySelectorAll('.addon-card')];
const search = document.getElementById('market-search');
const sort = document.getElementById('market-sort');
const count = document.querySelector('.market-count');
const empty = document.querySelector('.market-empty');
const chips = [...document.querySelectorAll('.chips button')];
let tag = '';

const order = {
  popular: (a, b) => b.dataset.official - a.dataset.official || b.dataset.stars - a.dataset.stars || a.dataset.name.localeCompare(b.dataset.name),
  new: (a, b) => b.dataset.date.localeCompare(a.dataset.date),
  name: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
};

function draw() {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const card of cards.sort(order[sort.value])) {
    const ok = (!tag || card.dataset.tags.split(' ').includes(tag)) && words.every((w) => card.dataset.search.includes(w));
    card.hidden = !ok;
    shown += ok;
    grid.append(card);
  }
  count.textContent = `${shown} add-on${shown === 1 ? '' : 's'}`;
  empty.hidden = shown > 0;
  for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.tag === tag));
}

for (const c of chips) c.addEventListener('click', () => ((tag = c.dataset.tag), draw()));
search.addEventListener('input', draw);
sort.addEventListener('change', draw);
// "/" jumps to the search, as on the docs.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    search.focus();
  }
});
const q = new URLSearchParams(location.search);
if (q.get('q')) search.value = q.get('q');
if (q.get('tag')) tag = q.get('tag');
draw();
