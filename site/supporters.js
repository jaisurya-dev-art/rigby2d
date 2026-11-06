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

/** The tier a monthly amount belongs to (GitHub Sponsors tiers). */
export const tierName = (t = 0) =>
  t >= 1000 ? 'Studio Partner' : t >= 250 ? 'Studio' : t >= 50 ? 'Indie Team' : t >= 10 ? 'Sponsor' : t >= 5 ? 'Backer' : 'Supporter';
/** Studio tiers start here. */
export const STUDIO_TIER = 50;

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
  a.className = `supporter${(p.tier ?? 0) >= STUDIO_TIER ? ' studio' : ''}`;
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

// ---- The Founding 20 (Support page and home page) ----

export const FOUNDING_SEATS = 20;

const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  e.append(...children.filter((c) => c !== null && c !== undefined));
  return e;
};

/** A supporter's picture: their avatar, or the first letter of their name. */
function avatar(p, size) {
  const src = p.avatar ?? (p.login ? `https://github.com/${encodeURIComponent(p.login)}.png?size=${size * 2}` : null);
  if (!src) return el('span', { class: 'avatar letter', 'aria-hidden': 'true' }, (p.name ?? '?').slice(0, 1).toUpperCase());
  return el('img', { class: 'avatar', src, alt: '', width: size, height: size, loading: 'lazy' });
}

/** Names link to their profile for Sponsor tiers and up, as in the chips. */
const linkedProfile = (p) => p.url && (p.tier ?? 10) >= 10;

/** One of the Founding seats: filled with the supporter who took it, or open for the next. */
function seat(n, p) {
  if (!p) {
    return el(
      'li',
      { class: 'seat open' },
      el('a', { href: SPONSOR_URL, rel: 'noopener', 'aria-label': `Founding seat ${n}: open. Become a Founding Supporter` }, el('span', { class: 'seat-ring' }, el('span', { class: 'seat-num' }, String(n))), el('span', { class: 'seat-name' }, 'Open')),
    );
  }
  const inner = [el('span', { class: 'seat-ring' }, avatar(p, 72), el('span', { class: 'seat-badge' }, `#${n}`)), el('span', { class: 'seat-name' }, p.name), el('span', { class: 'seat-role' }, 'Founding Supporter')];
  return el('li', { class: 'seat filled' }, linkedProfile(p) ? el('a', { href: p.url, rel: 'noopener' }, ...inner) : el('div', {}, ...inner));
}

/** A supporter who isn't one of the Founding 20. */
function patron(p) {
  const tier = tierName(p.tier);
  const inner = [avatar(p, 44), el('span', { class: 'patron-text' }, el('span', { class: 'patron-name' }, p.name), el('span', { class: 'patron-tier' }, tier))];
  const attrs = { class: `patron${p.tier >= STUDIO_TIER ? ' studio' : ''}` };
  return linkedProfile(p) ? el('a', { ...attrs, href: p.url, rel: 'noopener' }, ...inner) : el('div', attrs, ...inner);
}

/**
 * Fills the Founding seats (in the order they were taken, kept for good even after a sponsorship
 * ends), the other supporters, and the counts. `ids` are element ids; any of them may be missing.
 */
export function renderFounding(data, ids) {
  const $ = (k) => (ids[k] ? document.getElementById(ids[k]) : null);
  const everyone = people(data);
  const byId = new Map(everyone.map((p) => [p.login ?? p.name, p]));
  const founders = data.founding.slice(0, FOUNDING_SEATS).map((id) => byId.get(id) ?? { login: id, name: id, url: `https://github.com/${id}` });
  $('seats')?.replaceChildren(...Array.from({ length: FOUNDING_SEATS }, (_, i) => seat(i + 1, founders[i])));
  const others = everyone.filter((p) => !data.founding.includes(p.login ?? p.name));
  $('others')?.replaceChildren(...others.map(patron));
  if ($('othersBlock')) $('othersBlock').hidden = others.length === 0;
  if ($('empty')) $('empty').hidden = everyone.length > 0 || founders.length > 0;
  if ($('supporters')) $('supporters').textContent = String(everyone.length);
  if ($('spotsLeft')) $('spotsLeft').textContent = String(Math.max(0, FOUNDING_SEATS - data.founding.length));
}

// ---- Studio sponsors (studios page, home page) ----

/** A studio sponsor's logo (their GitHub avatar) and name, linked to their profile. */
function studioLogo(p) {
  const a = el(p.url ? 'a' : 'div', { class: `st-logo${p.tier >= 1000 ? ' pro' : ''}`, href: p.url, rel: p.url ? 'noopener' : null });
  if (p.avatar) a.append(el('img', { src: p.avatar, alt: '', loading: 'lazy' }));
  a.append(el('span', {}, p.name));
  return a;
}

/**
 * Fills `wall` with the studios sponsoring at `min` dollars a month or more, biggest first. With
 * `spots`, empty "Your studio here" places fill the row up to that many; without, `block` (the
 * wall's section) hides while there are none.
 */
export function renderStudios(wall, data, { min = STUDIO_TIER, spots = 0, block = null } = {}) {
  if (!wall) return;
  const studios = people(data).filter((p) => (p.tier ?? 0) >= min);
  const open = Array.from({ length: spots ? Math.max(1, spots - studios.length) : 0 }, () => el('a', { class: 'st-logo open', href: SPONSOR_URL, rel: 'noopener' }, 'Your studio here'));
  wall.replaceChildren(...studios.map(studioLogo), ...open);
  if (block) block.hidden = studios.length === 0;
}
