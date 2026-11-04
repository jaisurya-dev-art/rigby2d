// SPDX-License-Identifier: MIT OR Apache-2.0
// What's new in 0.5: a full-screen launch tour, one idea per screen, shown once when a new minor
// version first starts (before the welcome screen) and any time from Help ▸ What's new in 0.5. Each
// feature screen has a button that opens the feature. Arrow keys, the dots, Next and Skip move
// through it; Escape closes it.

import { VERSION } from './helpui.js';
import { t } from './i18n.js';
import { engineIcon } from './icons.js';
import { openExternal } from './platform.js';
import { openRuntimes } from './runtimeui.js';
import { openSpriteSheetDialog } from './spritesheetui.js';
import { h } from './widgets.js';
import markUrl from '../../branding/rigby2d-mark.svg?url';

/** The release this tour is for (major.minor); it shows once per release that is newer than the last one seen. */
export const TOUR_RELEASE = '0.5';
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

/** Key caps for the shortcuts screen. */
const keys = (...k) => h('span', { class: 'wn-keys' }, ...k.map((x) => h('kbd', null, x)));

/** A mesh drawing itself: an outline, then the triangles inside it (an SVG with stroke animations). */
function meshArt() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 240');
  svg.setAttribute('class', 'wn-mesh');
  // A leaf-like shape, its outline points and a fan of triangles inside it.
  const pts = [[120, 18], [168, 42], [200, 92], [206, 146], [182, 196], [132, 222], [86, 212], [48, 176], [34, 124], [48, 72], [82, 34]];
  const inner = [[120, 96], [150, 136], [96, 150], [124, 176]];
  const all = [...pts, ...inner];
  const tri = [[0, 1, 11], [1, 2, 11], [2, 3, 12], [2, 12, 11], [3, 4, 12], [4, 14, 12], [4, 5, 14], [5, 6, 14], [6, 13, 14], [6, 7, 13], [7, 8, 13], [8, 9, 11], [8, 11, 13], [9, 10, 11], [10, 0, 11], [11, 12, 13], [12, 14, 13]];
  const P = (i) => all[i].join(',');
  svg.innerHTML =
    `<polygon class="wn-mesh-fill" points="${pts.map((p) => p.join(',')).join(' ')}"/>` +
    tri.map(([a, b, c], i) => `<polygon class="wn-mesh-tri" style="animation-delay:${0.5 + i * 0.05}s" points="${P(a)} ${P(b)} ${P(c)}"/>`).join('') +
    all.map(([x, y], i) => `<circle class="wn-mesh-pt" style="animation-delay:${0.2 + i * 0.03}s" cx="${x}" cy="${y}" r="4.5"/>`).join('');
  return svg;
}

/** A sprite sheet filling up, frame by frame. */
function sheetArt() {
  return h('div', { class: 'wn-sheet' }, ...Array.from({ length: 24 }, (_, i) => h('span', { style: `animation-delay:${0.3 + i * 0.06}s` }, h('i', { style: `transform:rotate(${Math.sin(i / 3.8) * 22}deg)` }))));
}

/** The screens of the tour: the opening, each feature, and the rest. */
function screens(app, { showPreferences }) {
  const engines = (names, size) => h('div', { class: 'wn-engines' }, ...names.map((n) => h('span', { class: `wn-engine wn-${n}` }, engineIcon(n, size))));
  return [
    {
      id: 'intro',
      body: () => [
        h('img', { class: 'wn-mark', src: markUrl, alt: '' }),
        h('h1', { class: 'wn-hero' }, 'Rigby2D ', h('span', { class: 'wn-ice' }, '0.5')),
        h('p', { class: 'wn-lede' }, t('Our biggest update yet.')),
      ],
    },
    {
      id: 'defold',
      art: () => h('div', { class: 'wn-art-stack' }, engines(['defold'], 132), h('div', { class: 'wn-chips' }, ...['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'HTML5'].map((p, i) => h('span', { style: `animation-delay:${0.45 + i * 0.07}s` }, p)))),
      title: t('Now in Defold.'),
      text: t('A native runtime in C++, on every platform Defold ships to, matching the editor frame for frame.'),
      cta: [t('Get the Defold runtime'), () => openRuntimes(app)],
    },
    {
      id: 'sheets',
      art: sheetArt,
      title: t('Sprite sheets.'),
      text: t('Turn any animation into a sprite sheet, a Defold atlas, or loose frames. Drawn on your GPU, in seconds.'),
      cta: [t('Export a sprite sheet'), () => openSpriteSheetDialog(app)],
    },
    {
      id: 'mesh',
      art: meshArt,
      title: t('One click. A mesh.'),
      text: t('Rigby2D traces your art, places the points and builds the triangles. Then bend it.'),
      cta: [t('See how it works'), () => openExternal('https://rigby2d.com/docs/meshes.html')],
    },
    {
      id: 'godot',
      art: () => h('div', { class: 'wn-art-stack' }, engines(['godot'], 132), h('span', { class: 'wn-badge' }, t('Production-ready'))),
      title: t('Godot, out of preview.'),
      text: t('RigbySkeleton2D and RigbyScene2D are complete, tested against the editor on every frame.'),
      cta: [t('Get the Godot runtime'), () => openRuntimes(app)],
    },
    {
      id: 'keys',
      art: () => h('div', { class: 'wn-keyart' }, keys('Ctrl', 'Shift', 'B'), h('span', { class: 'wn-keyarrow' }, '→'), h('span', { class: 'wn-keyto' }, t('Create bone'))),
      title: t('Your keys. Your way.'),
      text: t('Rebind any action, keep more than one key for it, and take your keymap to any computer.'),
      cta: [t('Customize shortcuts'), () => showPreferences('interface')],
    },
    {
      id: 'more',
      body: () => [
        h('h2', { class: 'wn-title' }, t('And so much more.')),
        h(
          'div',
          { class: 'wn-more' },
          ...[
            [t('Copy and paste keys'), t('in the timeline, across bones and frames')],
            [t('Phaser 4'), t('the plugin runs on Phaser 3.60+ and 4')],
            [t('Layered PNGs in place'), t('like a PSD, ready for AutoRig')],
            [t('A smarter AutoRig'), t('the spine finds the neck and head')],
            [t('Seven runtimes'), t('Unity, Godot, Defold, Cocos, Phaser, JavaScript, Rust')],
            [t('Big sheets, split'), t('over the size limit, on to the next sheet: Phaser and PixiJS load them as one')],
            [t('Every export reports back'), t('where it went, or what went wrong')],
            [t('Fixes'), t('mesh rebinding, bone hover, DragonBones import')],
          ].map(([b, s], i) => h('div', { class: 'wn-more-item', style: `animation-delay:${0.15 + i * 0.07}s` }, h('b', null, b), h('span', null, s))),
        ),
        h('p', { class: 'wn-free' }, t('Free. Forever.')),
      ],
      cta: [t('Start animating'), null],
    },
  ];
}

/** Opens the tour. `showPreferences(page)` opens Preferences on a page; `onClose` runs once it closes. */
export function openWhatsNew(app, { showPreferences, onClose } = {}) {
  markSeen();
  const list = screens(app, { showPreferences });
  let index = 0;
  const overlay = h('div', { class: 'wn-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('What is new in Rigby2D 0.5') });
  const stage = h('div', { class: 'wn-stage' });
  const dots = h('div', { class: 'wn-dots' });
  const back = h('button', { class: 'wn-nav', onclick: () => go(index - 1) }, t('Back'));
  const next = h('button', { class: 'wn-nav wn-next', onclick: () => (index === list.length - 1 ? close() : go(index + 1)) });
  const skip = h('button', { class: 'wn-skip', onclick: () => close() }, t('Skip'));
  overlay.append(skip, stage, h('div', { class: 'wn-bar' }, back, dots, next));

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
    const page = h('div', { class: `wn-page wn-page-${s.id}` });
    if (s.body) page.append(...s.body());
    else
      page.append(
        h('div', { class: 'wn-art' }, s.art()),
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
