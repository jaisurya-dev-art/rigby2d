// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Support page: the monthly goal and the supporters wall, from /supporters.json (kept in
// step with GitHub Sponsors by .github/workflows/supporters.yml).

import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';

startAnalytics();
installMobileNav();

const $ = (id) => document.getElementById(id);

function person(p, founding) {
  const a = document.createElement(p.url ? 'a' : 'span');
  a.className = 'supporter';
  if (p.url) {
    a.href = p.url;
    a.rel = 'noopener';
  }
  if (p.avatar) {
    const img = document.createElement('img');
    img.src = p.avatar;
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.loading = 'lazy';
    a.append(img);
  }
  const name = document.createElement('span');
  name.textContent = p.name;
  a.append(name);
  if (founding) {
    const mark = document.createElement('small');
    mark.textContent = 'Founding';
    a.append(mark);
  }
  return a;
}

try {
  const data = await (await fetch('/supporters.json', { cache: 'no-cache' })).json();
  const goal = data.goal ?? {};
  const percent = Math.max(0, Math.min(100, Math.round(goal.percent ?? 0)));
  $('goal-title').textContent = goal.title ?? 'Signed by Rigby2D';
  $('goal-amount').textContent = `Goal: $${goal.monthly ?? 25} a month`;
  $('goal-fill').style.width = `${Math.max(percent, 1.5)}%`;
  document.querySelector('.goal-bar').setAttribute('aria-valuenow', String(percent));
  $('goal-note').textContent =
    percent >= 100 ? 'Reached. Thank you. On to the next goal.' : percent > 0 ? `${percent}% there. Every dollar a month gets it there sooner.` : 'Just getting started. The first 20 supporters are Founding Supporters.';
  if (data.kofi) {
    $('kofi').href = data.kofi;
    $('kofi').hidden = false;
  }
  const founding = new Set(data.founding ?? []);
  const people = [...(data.github ?? []), ...(data.others ?? [])];
  $('wall').replaceChildren(...people.map((p) => person(p, founding.has(p.login ?? p.name))));
  $('wall-empty').hidden = people.length > 0;
} catch {
  // Offline or not built yet: the page still reads well with its defaults.
}
