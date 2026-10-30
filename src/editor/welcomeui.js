// SPDX-License-Identifier: MIT OR Apache-2.0
// The welcome screen after the splash (Help ▸ Welcome screen): start something new, reopen recent
// work, open a starter project, or learn. "Show at startup" is a preference (General).

import { DEMOS } from './demos.js';
import { LINKS, VERSION } from './helpui.js';
import { t } from './i18n.js';
import { isDesktop, openExternal, saveDownload } from './platform.js';
import { ago, recentProjects, splitPath } from './recent.js';
import { newScene } from './sceneui.js';
import { engineIcon, icon } from './icons.js';
import { COMMUNITY_URL, DEVLOG_URL, cachedNews, fetchNews, isNew, markSeen } from './news.js';
import { h } from './widgets.js';
import markUrl from '../../branding/rigby2d-mark.svg?url';

/** Game starters, made by the website build (site/vite.config.js) from runtimes/phaser/starter. */
export const STARTERS = [
  {
    id: 'phaser',
    file: 'rigby2d-phaser-starter.zip',
    url: 'https://rigby2d.com/starters/rigby2d-phaser-starter.zip',
    name: 'Phaser game starter',
    description: 'A small Phaser game with NILA: move her with the arrow keys, wave with Space, switch moods with crossfades. Unzip and follow its README.',
  },
];

export function openWelcome(app, { tutorials, onClose } = {}) {
  const overlay = h('div', { class: 'modal-backdrop welcome-backdrop' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const run = (fn) => async () => {
    close();
    await fn();
  };

  const action = (name, label, hint, fn) => h('button', { class: 'welcome-action', onclick: run(fn) }, h('span', { class: 'welcome-icon' }, icon(name, 17)), h('span', null, h('b', null, label), h('small', null, hint)));

  const recent = recentProjects().slice(0, 8);
  const recentList = recent.length
    ? recent.map((entry) => {
        const { name, folder } = entry.kind === 'file' ? splitPath(entry.path) : { name: entry.name, folder: t('Demo') };
        return h('button', { class: 'welcome-recent', title: entry.path ?? entry.name, onclick: run(() => app.openRecent(entry)) }, h('span', { class: 'welcome-recent-icon' }, icon(entry.kind === 'demo' ? 'layers' : 'file-text', 16)), h('span', { class: 'welcome-recent-text' }, h('b', null, name), h('small', null, `${folder} · ${ago(entry.time)}`)));
      })
    : [h('p', { class: 'weak' }, t('Projects you open or save appear here.'))];

  /** A starter card: a thumbnail, or an art tile with an icon (`art`: { icon } or { engine }, `tone`). */
  const card = ({ img, art, tone, tag, title, text, fn }) =>
    h(
      'button',
      { class: 'welcome-card', onclick: run(fn) },
      img
        ? h('img', { src: img, alt: '', loading: 'lazy', onerror: (e) => (e.target.style.visibility = 'hidden') })
        : h('div', { class: `welcome-card-art tone-${tone}` }, art.engine ? engineIcon(art.engine, 40) : icon(art.icon, 38)),
      h('span', { class: 'welcome-tag' }, tag),
      h('b', null, title),
      h('small', null, text),
    );

  const starters = [
    card({ art: { icon: 'gamepad-2' }, tone: 'blue', tag: t('Template'), title: t('Game character'), text: t('An empty project for a game character: bones, meshes, skins and animations for the runtimes.'), fn: () => app.newDocument('game') }),
    card({ art: { icon: 'clapperboard' }, tone: 'rose', tag: t('Template'), title: t('Film shot'), text: t('An empty film project: 4K output, a camera, audio and lip-sync, rendered to video.'), fn: () => app.newDocument('film') }),
    card({ art: { icon: 'users' }, tone: 'violet', tag: t('Template'), title: t('Scene'), text: t('Several characters on one stage, with clips, parallax and a camera.'), fn: () => newScene(app) }),
    ...DEMOS.map((d) => card({ img: d.thumbnail, tag: t('Demo'), title: d.name, text: d.description, fn: () => app.openDemo(d.id) })),
    ...STARTERS.map((s) =>
      card({
        art: { engine: s.id },
        tone: 'phaser',
        tag: t('Game starter'),
        title: t(s.name),
        text: t(s.description),
        fn: async () => {
          const saved = await saveDownload(s.url, s.file).catch((e) => app.setStatus(t('Could not download {file}: {error}', { file: s.file, error: e.message })));
          if (saved) app.setStatus(t('Saved {file}', { file: saved }));
        },
      }),
    ),
  ];

  // What's new: the newest devlog posts, from the last copy at once, then fresh from the website.
  const newsRow = h('div', { class: 'welcome-news', hidden: true });
  const drawNews = (news) => {
    const items = news?.items?.slice(0, 3) ?? [];
    newsRow.hidden = !items.length;
    if (!items.length) return;
    newsRow.replaceChildren(
      h('div', { class: 'welcome-news-head' }, h('h4', null, t("What's new")), h('button', { class: 'link', onclick: () => openExternal(DEVLOG_URL) }, `${t('Devlog')} ↗`)),
      h(
        'div',
        { class: 'welcome-news-list' },
        ...items.map((item) =>
          h(
            'button',
            { class: 'welcome-post', title: item.url, onclick: () => openExternal(item.url) },
            item.image ? h('img', { src: item.image, alt: '', onerror: (e) => e.target.remove() }) : null,
            h('span', { class: 'welcome-post-text' }, h('small', null, item.date, isNew(item) ? h('span', { class: 'welcome-new' }, t('New')) : null), h('b', null, item.title)),
          ),
        ),
      ),
    );
  };
  drawNews(cachedNews());
  fetchNews().then((news) => {
    drawNews(news);
    markSeen(news?.updated);
  });

  const show = h('input', { type: 'checkbox', checked: app.prefs.get('general.welcome'), onchange: (e) => app.prefs.set('general.welcome', e.target.checked) });

  overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());
  overlay.append(
    h(
      'div',
      { class: 'modal welcome', role: 'dialog', 'aria-label': t('Welcome to Rigby2D') },
      h(
        'aside',
        { class: 'welcome-side' },
        h('div', { class: 'welcome-brand' }, h('img', { src: markUrl, alt: '', width: 34, height: 34 }), h('div', null, h('b', null, 'Rigby2D'), h('small', null, VERSION ? `${t('Version')} ${VERSION}` : t('Development build')))),
        h('h4', null, t('Start')),
        action('plus', t('New game project'), t('Characters for games'), () => app.newDocument('game')),
        action('plus', t('New film project'), t('Animation rendered to video'), () => app.newDocument('film')),
        action('folder-open', t('Open…'), t('A .rigby work file, or a skeleton .json / .skel'), () => app.openDialog()),
        h('h4', null, t('Learn')),
        tutorials ? action('play', t('Take the tour'), t('Four minutes around the editor'), () => tutorials.tour()) : null,
        tutorials ? action('graduation-cap', t('Tutorials'), t('Lessons from drawing to moving character'), () => tutorials.open()) : null,
        action('book-open', t('Documentation'), 'rigby2d.com/docs', () => openExternal(LINKS.docs)),
        action('sparkles', t("What's new"), VERSION ? `${t('Version')} ${VERSION}` : '', () => openExternal(LINKS.releaseNotes)),
        action('users', t('Community'), 'r/rigby2d', () => openExternal(COMMUNITY_URL)),
      ),
      h(
        'main',
        { class: 'welcome-main' },
        h('header', { class: 'welcome-head' }, h('h2', null, t('Welcome to Rigby2D')), h('button', { class: 'dialog-close', 'aria-label': t('Close'), title: t('Close (Esc)'), onclick: close }, '✕')),
        h(
          'button',
          { class: 'welcome-community', onclick: () => openExternal(COMMUNITY_URL) },
          h('span', { class: 'welcome-community-mark' }, engineIcon('reddit', 26)),
          h('span', { class: 'welcome-community-text' }, h('b', null, t('Join r/rigby2d')), h('small', null, t('Show your work, get help, and hear about every release first.'))),
          h('span', { class: 'welcome-community-join' }, t('Join')),
        ),
        newsRow,
        h('h4', null, t('Recent')),
        h('div', { class: 'welcome-recents' }, ...recentList),
        h('h4', null, t('Starter projects')),
        h('div', { class: 'welcome-cards' }, ...starters),
        h('footer', { class: 'welcome-foot' }, h('label', null, show, ` ${t('Show this at startup')}`), isDesktop ? null : h('small', { class: 'weak' }, t('Tip: the desktop app adds backups, detachable panels and auto-update.'))),
      ),
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  overlay.querySelector('.welcome-action')?.focus();
  return close;
}
