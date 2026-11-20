// SPDX-License-Identifier: MIT OR Apache-2.0
// What's new in 0.6: a full-screen launch tour, one idea per screen, shown once when a new minor
// version first starts (before the welcome screen) and any time from Help ▸ What's new in 0.6. Each
// feature screen has a button that opens the feature. Arrow keys, the dots, Next and Skip move
// through it; Escape closes it.

import { VERSION } from './helpui.js';
import { t } from './i18n.js';
import { openExternal } from './platform.js';
import { openThemes } from './themeui.js';
import { asepriteArt, boneOnlyArt, dockArt, filmArt, themesArt, turnArt, warpArt, weightsArt } from './whatsnewart.js';
import { h } from './widgets.js';

/** The release this tour is for (major.minor); it shows once per release that is newer than the last one seen. */
export const TOUR_RELEASE = '0.6';
const SEEN_KEY = 'rigby2d.whatsnew.seen';

const minor = (v) => (v ?? '').split('.').slice(0, 2).join('.');
function seen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, TOUR_RELEASE);
  } catch {}
}
/** Whether to open the tour at startup: a release build of this tour's version, not yet seen. */
export const shouldShowWhatsNew = () => minor(VERSION) === TOUR_RELEASE && seen() !== TOUR_RELEASE;

// The opening plays the end of the 0.6 trailer full screen (src/editor/whatsnew/, VP9 with a still for
// its first frame); each feature screen draws its own live animation (whatsnewart.js).
const media = import.meta.glob('./whatsnew/*.{webm,jpg}', { eager: true, query: '?url', import: 'default' });
const clip = (name) => ({ src: media[`./whatsnew/${name}.webm`], poster: media[`./whatsnew/${name}.jpg`] });
const docs = (page) => () => openExternal(`https://rigby2d.com/docs/${page}.html`);

function screens(app) {
  return [
    {
      id: 'intro',
      film: clip('intro'),
      body: () => [h('p', { class: 'wn-lede' }, t('We kept something big on ice. Until now.'))],
    },
    {
      id: 'dock',
      art: dockArt,
      title: t('Dock it. Tab it.'),
      text: t('Every panel and dialog, rebuilt on one design language. Drag any panel by its tab, and save your layouts.'),
      cta: [t('Tour the interface'), docs('interface')],
    },
    {
      id: 'themes',
      art: themesArt,
      title: t('Three themes. Or your own.'),
      text: t('Rigby Dark, Mammoth and Rigby Light. Change any colour and share it as a file.'),
      cta: [t('Open Themes'), () => openThemes(app)],
    },
    {
      id: 'weights',
      art: weightsArt,
      title: t('Watch your weights work.'),
      text: t('Try a pose while you paint, or let the bone wiggle. Every stroke shows its effect, live.'),
      cta: [t('Learn about weights'), docs('meshes')],
    },
    {
      id: 'boneonly',
      art: boneOnlyArt,
      title: t('Move a joint. The art stays.'),
      text: t('Fix a bone after the rig is built, IK chains included. Plus point bones, and constraints that never jump.'),
      cta: [t('Learn more'), docs('bones-and-slots')],
    },
    {
      id: 'turn',
      art: turnArt,
      title: t('Drag one handle. It turns.'),
      text: t('A 2.5D turn and tilt from flat art, built for you. Plays in every runtime.'),
      cta: [t('Learn more'), docs('meshes')],
    },
    {
      id: 'warp',
      art: warpArt,
      title: t('Bend anything.'),
      text: t('Warp deformers, nested and keyable. Shape any side of a turn by hand.'),
      cta: [t('Learn more'), docs('meshes')],
    },
    {
      id: 'film',
      art: filmArt,
      title: t('Then the film.'),
      text: t('Shadow, light, glow, snow, sparks, motion blur and depth of field. Live in the viewport, rendered on your GPU.'),
      cta: [t('Learn about film effects'), docs('film-effects')],
    },
    {
      id: 'aseprite',
      art: asepriteArt,
      title: t('Aseprite files, already animated.'),
      text: t('Layers become parts and tags become animations. Then add bones on top.'),
      cta: [t('Learn more'), docs('importing-art')],
    },
    {
      id: 'more',
      body: () => [
        h('h2', { class: 'wn-title' }, t('And so much more.')),
        h(
          'div',
          { class: 'wn-more' },
          ...[
            [t('The Rig panel'), t('skins, constraints, meshes and events in one place')],
            [t('Better meshes'), t('locked points, holes, every shape in an image')],
            [t('Tween lines'), t('see where values blend between keys')],
            [t('Find and reparent'), t('search the tree, drag a bone onto its new parent')],
            [t('The rigby command'), t('convert, export and render from scripts and CI')],
            [t("Ren'Py runtime"), t('our ninth: lip-sync for visual novels')],
            [t('Weights button'), t('one click from a mesh to painting')],
            [t('Constraints over MCP'), t('add and edit them from your AI assistant')],
            [t('Fixes'), t('Spine 4.3 .skel options, shortcuts on any keyboard layout')],
          ].map(([b, s], i) => h('div', { class: 'wn-more-item', style: `animation-delay:${0.15 + i * 0.07}s` }, h('b', null, b), h('span', null, s))),
        ),
        h('p', { class: 'wn-free' }, t('Free. Forever.')),
      ],
      cta: [t('Start animating'), null],
    },
  ];
}

/** Opens the tour. `onClose` runs once it closes. */
export function openWhatsNew(app, { onClose } = {}) {
  markSeen();
  const list = screens(app);
  let index = 0;
  const overlay = h('div', { class: 'wn-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('What is new in Rigby2D 0.6') });
  const stage = h('div', { class: 'wn-stage' });
  const dots = h('div', { class: 'wn-dots' });
  const back = h('button', { class: 'wn-nav', onclick: () => go(index - 1) }, t('Back'));
  const next = h('button', { class: 'wn-nav wn-next', onclick: () => (index === list.length - 1 ? close() : go(index + 1)) });
  const skip = h('button', { class: 'wn-skip', onclick: () => close() }, t('Skip'));
  const filmLayer = h('div', { class: 'wn-film' });
  overlay.append(filmLayer, skip, stage, h('div', { class: 'wn-bar' }, back, dots, next));

  const close = () => {
    if (!overlay.isConnected) return;
    overlay.classList.add('wn-out');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => (overlay.remove(), onClose?.()), 260);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') index === list.length - 1 ? close() : go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  function go(i) {
    index = Math.max(0, Math.min(list.length - 1, i));
    const s = list[index];
    const page = h('div', { class: `wn-page wn-page-${s.id}${s.film ? ' wn-on-film' : ''}` });
    overlay.classList.toggle('wn-filmed', !!s.film);
    const old = [...filmLayer.children];
    if (s.film) {
      const v = h('video', { src: s.film.src, poster: s.film.poster, muted: '', loop: '', playsinline: '', autoplay: '', 'aria-hidden': 'true' });
      v.muted = true;
      v.addEventListener('loadeddata', () => v.classList.add('on'), { once: true });
      v.addEventListener('error', () => v.classList.add('on'), { once: true });
      filmLayer.append(v);
      v.play?.().catch(() => {});
    }
    old.forEach((o) => (o.classList.remove('on'), setTimeout(() => o.remove(), 500)));
    if (s.body) page.append(...s.body());
    else
      page.append(
        ...(s.art ? [h('div', { class: 'wn-art' }, s.art())] : []),
        h('div', { class: 'wn-copy' }, h('h2', { class: 'wn-title' }, s.title), h('p', { class: 'wn-text' }, s.text)),
      );
    if (s.cta?.[1]) {
      const [label, fn] = s.cta;
      page.append(h('button', { class: 'wn-cta', onclick: () => (close(), fn()) }, label, ' ›'));
    }
    stage.replaceChildren(page);
    dots.replaceChildren(...list.map((_, d) => h('button', { class: d === index ? 'on' : '', 'aria-label': `${d + 1} / ${list.length}`, onclick: () => go(d) })));
    back.style.visibility = index ? 'visible' : 'hidden';
    next.textContent = index === list.length - 1 ? s.cta[0] : index === 0 ? t('See what is new') : t('Next');
    next.classList.toggle('wn-final', index === list.length - 1);
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  go(0);
  next.focus();
}
