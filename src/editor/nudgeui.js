// SPDX-License-Identifier: MIT OR Apache-2.0
// Friendly prompts, at the right moment and rarely: after you render, export or AutoRig something,
// a card offers to share it on Discord; after a few days of use, one asks for a GitHub star. Each
// stops for good once acted on, and after a couple of "Not now"s (nudge.js). Milestones come from
// analytics.js (the same moments it counts), as `rigby-milestone` events.

import { t } from './i18n.js';
import { icon, engineIcon } from './icons.js';
import { h } from './widgets.js';

import { countDay, load, mayShow, save, SHAREABLE } from './nudge.js';

let card = null;

function show(kind, { mark, title, text, primary, onPrimary }) {
  if (card) return;
  const state = load();
  (state[kind] ??= {}).shownAt = Date.now();
  save(state);
  const close = (outcome) => {
    const s = load();
    s[kind] ??= {};
    if (outcome === 'done') s[kind].done = true;
    if (outcome === 'dismiss') s[kind].dismissed = (s[kind].dismissed ?? 0) + 1;
    save(s);
    card?.remove();
    card = null;
  };
  card = h(
    'div',
    { class: `nudge nudge-${kind}`, role: 'dialog', 'aria-label': title },
    h('span', { class: 'nudge-mark' }, mark),
    h('div', { class: 'nudge-text' }, h('b', null, title), h('small', null, text)),
    h(
      'div',
      { class: 'nudge-buttons' },
      h('button', { onclick: () => close('dismiss') }, t('Not now')),
      h('button', { class: 'primary', onclick: () => (onPrimary(), close('done')) }, primary),
    ),
  );
  document.body.append(card);
}

/**
 * Starts listening for milestones, and schedules the star prompt. `share()` opens the share dialog,
 * `star()` the GitHub page, `fund()` the Support page.
 */
export function installNudges({ share, star, fund }) {
  const state = load();
  const days = countDay(state, Date.now());
  save(state);
  addEventListener('rigby-milestone', (e) => {
    const name = e.detail;
    if (name === 'editor-share-reddit') {
      const s = load();
      (s.share ??= {}).done = true;
      save(s);
      return;
    }
    if (!SHAREABLE.has(name) || !mayShow(load(), 'share', Date.now(), { gap: 7, maxDismiss: 3 })) return;
    setTimeout(
      () =>
        show('share', {
          mark: engineIcon('discord', 22),
          title: t('Nice work! Show it to the community?'),
          text: t('Share a GIF of your animation in our Discord. Other animators would love to see it.'),
          primary: t('Share to Discord…'),
          onPrimary: share,
        }),
      1200,
    );
  });
  // After ten days of use, once in a while: Rigby2D is free, and a few supporters keep it so. Never on
  // the same day as the star prompt.
  const fundDue = days >= 10 && fund && mayShow(load(), 'fund', Date.now(), { gap: 45, maxDismiss: 2 });
  const starDue = days >= 3 && mayShow(load(), 'star', Date.now(), { gap: 30, maxDismiss: 2 });
  if (fundDue && !starDue) {
    setTimeout(
      () =>
        show('fund', {
          mark: icon('heart', 20),
          title: t('Rigby2D is free, and stays free'),
          text: t('A few dollars a month pays for code signing in its name, so new users stop seeing security warnings.'),
          primary: t('Support Rigby2D ↗'),
          onPrimary: fund,
        }),
      120_000,
    );
  }
  if (starDue) {
    setTimeout(
      () =>
        show('star', {
          mark: icon('star', 20),
          title: t('Enjoying Rigby2D?'),
          text: t('A star on GitHub helps other animators find it. It takes one click and keeps the project free.'),
          primary: t('Star on GitHub ↗'),
          onPrimary: star,
        }),
      90_000,
    );
  }
}
