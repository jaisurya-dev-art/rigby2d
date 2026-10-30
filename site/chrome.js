// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's header and footer, shared by every page: the Vite pages get them through the
// <!--site-header:active--> and <!--site-footer--> markers (vite.config.js), and the generated
// pages (devlog, add-on pages) call siteHeader / siteFooter directly.
//
// `base` is the way back to the site's root from the page ('./', '../' or '/'); `mark` and
// `lockup` are the brand images as that page can reach them.

export const REDDIT = 'https://www.reddit.com/r/rigby2d/';
export const GITHUB = 'https://github.com/jaisurya-dev-art/rigby2d';

export const SNOO_PATH =
  'M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z';
const GITHUB_PATH =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3.988.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.31 3.285-.988 3.285-.988.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

/** An inline brand icon ('reddit' or 'github'). */
export const brandIcon = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${name === 'reddit' ? SNOO_PATH : GITHUB_PATH}"/></svg>`;

const SECTIONS = [
  ['features', '#features', 'Features'],
  ['demos', 'demos/', 'Demos'],
  ['addons', 'addons/', 'Add-ons'],
  ['docs', 'docs/', 'Docs'],
  ['blog', 'blog/', 'Devlog'],
];

export function siteHeader({ base = '/', mark = '/blog/mark.svg', active = '' } = {}) {
  const link = ([id, href, label]) => `<a href="${base}${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="nav">
      <div class="wrap nav-row">
        <a class="brand" href="${base}" aria-label="Rigby2D home"><img src="${mark}" alt="" width="28" height="28" /><span>Rigby<b>2D</b></span></a>
        <nav id="site-nav" aria-label="Sections">
          ${SECTIONS.map(link).join('\n          ')}
          <a class="nav-extra" href="${base}#download">Download</a>
          <a class="nav-extra" href="${REDDIT}" rel="noopener">${brandIcon('reddit', 16)} r/rigby2d</a>
          <a class="nav-extra" href="${GITHUB}" rel="noopener">${brandIcon('github', 16)} GitHub</a>
        </nav>
        <div class="nav-actions">
          <a class="nav-icon reddit" href="${REDDIT}" rel="noopener" title="r/rigby2d: the community" aria-label="r/rigby2d on Reddit" data-goatcounter-click="site-community-nav">${brandIcon('reddit')}</a>
          <a class="nav-icon" href="${GITHUB}" rel="noopener" title="Source code on GitHub" aria-label="Rigby2D on GitHub" data-goatcounter-click="site-github-nav">${brandIcon('github')}</a>
          <a class="btn small nav-download" href="${base}#download" data-goatcounter-click="site-download-nav">Download</a>
          <a class="btn small primary" href="${base}editor/" data-goatcounter-click="site-open-editor-nav">Open editor</a>
        </div>
        <button class="nav-toggle" type="button" aria-label="Open the menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>
      </div>
    </header>`;
}

export function siteFooter({ base = '/', lockup = '/blog/lockup.svg' } = {}) {
  const col = (title, links) =>
    `<div class="foot-col"><h4>${title}</h4>${links.map(([href, label, ext]) => `<a href="${href}"${ext ? ' rel="noopener"' : ''}>${label}</a>`).join('')}</div>`;
  return `<footer class="foot">
      <div class="wrap foot-grid">
        <div class="foot-brand">
          <img src="${lockup}" alt="Rigby2D" width="176" height="66" />
          <p>Free, open-source 2D skeletal animation for games and film.</p>
          <a class="btn small reddit" href="${REDDIT}" rel="noopener" data-goatcounter-click="site-community-footer">${brandIcon('reddit', 16)}Join r/rigby2d</a>
        </div>
        ${col('Product', [
          [`${base}#download`, 'Download'],
          [`${base}editor/`, 'Browser editor'],
          [`${base}#runtimes`, 'Runtimes'],
          [`${base}addons/`, 'Add-ons'],
          [`${base}demos/`, 'Demos'],
          [`${base}cloud/`, 'Cloud'],
        ])}
        ${col('Learn', [
          [`${base}docs/`, 'Documentation'],
          [`${base}docs/quick-start.html`, 'Quick start'],
          [`${base}docs/migrating-from-spine.html`, 'Coming from Spine'],
          [`${base}docs/migrating-from-dragonbones.html`, 'Coming from DragonBones'],
          [`${base}blog/`, 'Devlog'],
          [`${base}blog/feed.xml`, 'RSS'],
        ])}
        ${col('Community', [
          [REDDIT, 'r/rigby2d', true],
          [GITHUB, 'GitHub', true],
          [`${GITHUB}/issues`, 'Issues', true],
          [`${GITHUB}/blob/develop/CONTRIBUTING.md`, 'Contributing', true],
          [`${base}addons/#publish`, 'Publish an add-on'],
          ['mailto:hello@rigby2d.com', 'Contact'],
        ])}
      </div>
      <div class="wrap foot-legal">
        <p>
          Source code licensed MIT OR Apache-2.0. The Rigby2D, NILA and Rigbytron names, logos and artwork are trademarks of the
          Rigby2D project; see <a href="${GITHUB}/blob/develop/TRADEMARKS.md" rel="noopener">TRADEMARKS.md</a>. Visits are counted
          anonymously with <a href="https://www.goatcounter.com" rel="noopener">GoatCounter</a>: no cookies, no personal data.
        </p>
        <a href="${base}docs/privacy.html">Privacy</a>
      </div>
    </footer>`;
}

/** The phone menu for generated pages (the Vite pages use nav.js). */
export const NAV_SCRIPT = `<script>
      const toggle = document.querySelector('.nav-toggle');
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        document.querySelector('.nav').classList.toggle('open', open);
      });
    </script>`;
