// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's header and footer, shared by every page: the Vite pages get them through the
// <!--site-header:active--> and <!--site-footer--> markers (vite.config.js), and the generated
// pages (devlog, add-on pages) call siteHeader / siteFooter directly.
//
// `base` is the way back to the site's root from the page ('./', '../' or '/'); `mark` and
// `lockup` are the brand images as that page can reach them.

export const DISCORD = 'https://discord.gg/PGgaTwbNH';
export const GITHUB = 'https://github.com/jaisurya-dev-art/rigby2d';
export const X = 'https://x.com/Rigby2d';

const DISCORD_PATH =
  'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';
const GITHUB_PATH =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3.988.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.31 3.285-.988 3.285-.988.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

const HEART = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;

const BUILDING = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`;

const X_PATH = 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z';

/** An inline brand icon ('discord', 'github' or 'x'). */
export const brandIcon = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${{ discord: DISCORD_PATH, x: X_PATH }[name] ?? GITHUB_PATH}"/></svg>`;

const SECTIONS = [
  ['features', '#features', 'Features'],
  ['demos', 'demos/', 'Demos'],
  ['runtimes', 'runtimes/', 'Runtimes'],
  ['addons', 'addons/', 'Add-ons'],
  ['docs', 'docs/', 'Docs'],
  ['vs', 'vs/spine/', 'Compare'],
  ['blog', 'blog/', 'Devlog'],
];

export function siteHeader({ base = '/', mark = '/blog/mark.svg', active = '' } = {}) {
  const link = ([id, href, label]) => `<a href="${base}${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="nav">
      <div class="wrap nav-row">
        <a class="brand" href="${base}" aria-label="Rigby2D home"><img src="${mark}" alt="" width="28" height="28" /><span>Rigby<b>2D</b></span></a>
        <nav id="site-nav" aria-label="Sections">
          <a class="nav-extra nav-studios-extra" href="${base}studios/"${active === 'studios' ? ' aria-current="page"' : ''}>${BUILDING} For studios</a>
          ${SECTIONS.map(link).join('\n          ')}
          <a class="nav-extra" href="${base}#download">Download</a>
          <a class="nav-extra nav-fund-extra" href="${base}fund/"${active === 'fund' ? ' aria-current="page"' : ''}>${HEART} Support Rigby2D</a>
          <a class="nav-extra" href="${DISCORD}" rel="noopener">${brandIcon('discord', 16)} Discord</a>
          <a class="nav-extra" href="${X}" rel="noopener">${brandIcon('x', 16)} X</a>
          <a class="nav-extra" href="${GITHUB}" rel="noopener">${brandIcon('github', 16)} GitHub</a>
        </nav>
        <div class="nav-actions">
          <a class="nav-studios" href="${base}studios/" title="Rigby2D for studios: free for every seat" data-goatcounter-click="site-studios-nav"${active === 'studios' ? ' aria-current="page"' : ''}>${BUILDING}<span>Studios</span></a>
          <a class="nav-fund" href="${base}fund/" title="Rigby2D is free. Supporters keep it moving." data-goatcounter-click="site-fund-nav"${active === 'fund' ? ' aria-current="page"' : ''}>${HEART}<span>Support</span></a>
          <a class="nav-icon discord" href="${DISCORD}" rel="noopener" title="Discord: the community" aria-label="Rigby2D on Discord" data-goatcounter-click="site-community-nav">${brandIcon('discord')}</a>
          <a class="nav-icon" href="${X}" rel="noopener" title="Follow @Rigby2d on X" aria-label="Rigby2D on X" data-goatcounter-click="site-x-nav">${brandIcon('x')}</a>
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
          <a class="btn small discord" href="${DISCORD}" rel="noopener" data-goatcounter-click="site-community-footer">${brandIcon('discord', 16)}Join our Discord</a>
          <a class="btn small x" href="${X}" rel="noopener" data-goatcounter-click="site-x-footer">${brandIcon('x', 16)}Follow us on X</a>
        </div>
        ${col('Product', [
          [`${base}#download`, 'Download'],
          [`${base}editor/`, 'Browser editor'],
          [`${base}runtimes/`, 'Runtimes'],
          [`${base}studios/`, 'For studios'],
          [`${base}addons/`, 'Add-ons'],
          [`${base}demos/`, 'Demos'],
          [`${base}cloud/`, 'Cloud'],
          [`${base}vs/dragonbones/`, 'For DragonBones users'],
          [`${base}vs/moho/`, 'Rigby2D vs Moho'],
          [`${base}vs/toon-boom/`, 'Rigby2D vs Toon Boom'],
        ])}
        ${col('Learn', [
          [`${base}docs/`, 'Documentation'],
          [`${base}docs/quick-start.html`, 'Quick start'],
          [`${base}docs/migrating-from-spine.html`, 'Coming from Spine'],
          [`${base}docs/migrating-from-dragonbones.html`, 'Coming from DragonBones'],
          [`${base}vs/spine/`, 'Rigby2D vs Spine'],
          [`${base}blog/`, 'Devlog'],
        ])}
        ${col('Community', [
          [DISCORD, 'Discord', true],
          [X, 'X (@Rigby2d)', true],
          [GITHUB, 'GitHub', true],
          [`${GITHUB}/issues`, 'Issues', true],
          [`${GITHUB}/blob/develop/CONTRIBUTING.md`, 'Contributing', true],
          [`${base}addons/#publish`, 'Publish an add-on'],
          [`${base}fund/`, 'Support Rigby2D'],
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
