// SPDX-License-Identifier: MIT OR Apache-2.0
// The monthly goal and the supporters, from /supporters.json (kept in step with GitHub Sponsors by
// .github/workflows/supporters.yml), drawn the same way on the home page, the Support page and the
// download thank-you card.

export const SPONSOR_URL = 'https://github.com/sponsors/jaisurya-dev-art';

let cached = null;

/** The supporters file: { goal, github, others, founding, kofi }, or defaults when it can't load. */
export function loadSupporters() {
  cached ??= fetch('/supporters.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .catch(() => ({}))
    .then((d) => ({ goal: { title: 'Signed by Rigby2D', monthly: 25, percent: 0, ...d.goal }, github: d.github ?? [], others: d.others ?? [], founding: d.founding ?? [], kofi: d.kofi ?? null, contributors: d.contributors ?? [] }));
  return cached;
}

/** Everyone to thank, best supported first (tier, then Founding, then the order they joined). */
export function people(data) {
  const founding = new Set(data.founding);
  return [...data.github, ...data.others]
    .map((p, i) => ({ ...p, founding: founding.has(p.login ?? p.name), order: i }))
    .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || Number(b.founding) - Number(a.founding) || a.order - b.order);
}

/** Fills a goal block: .goal-title, .goal-amount, .goal-bar > span, and an optional .goal-note. */
export function renderGoal(root, goal) {
  const percent = Math.max(0, Math.min(100, Math.round(goal.percent ?? 0)));
  root.querySelector('.goal-title').textContent = goal.title;
  root.querySelector('.goal-amount').textContent = `Goal: $${goal.monthly} a month`;
  root.querySelector('.goal-bar span').style.width = `${Math.max(percent, 1.5)}%`;
  root.querySelector('.goal-bar').setAttribute('aria-valuenow', String(percent));
  const note = root.querySelector('.goal-note');
  if (note) {
    note.textContent =
      percent >= 100
        ? 'Reached. Thank you. On to the next goal.'
        : percent > 0
          ? `${percent}% there. Every dollar a month gets it there sooner.`
          : 'Just getting started. The first 20 supporters are Founding Supporters.';
  }
}

/** One supporter: avatar and name, linked for Sponsor tiers and up, marked when Founding. */
function chip(p) {
  const linked = p.url && (p.tier ?? 10) >= 10;
  const a = document.createElement(linked ? 'a' : 'span');
  a.className = `supporter${(p.tier ?? 0) >= 25 ? ' studio' : ''}`;
  if (linked) {
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
  if (p.founding) {
    const mark = document.createElement('small');
    mark.textContent = 'Founding';
    a.append(mark);
  }
  return a;
}

/** Fills a wall with the supporters; `empty` (optional) shows when there are none yet. */
export function renderWall(wall, empty, data) {
  const list = people(data);
  wall.replaceChildren(...list.map(chip));
  if (empty) empty.hidden = list.length > 0;
}

/** Fills a list with the code contributors, each linked to their GitHub profile. */
export function renderContributors(list, data) {
  list.replaceChildren(...data.contributors.map((c) => chip({ ...c, tier: 10 })));
}
