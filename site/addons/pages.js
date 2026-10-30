// SPDX-License-Identifier: MIT OR Apache-2.0
// The add-on marketplace's pages (Node, used by vite.config.js): the cards on addons/index.html and
// a page for each add-on at addons/<id>/, with its README. READMEs come from other people's
// repositories, so they are rendered without raw HTML and with only http(s) links.

import { Marked } from 'marked';

import { brandIcon, NAV_SCRIPT, siteFooter, siteHeader } from '../chrome.js';

const SITE = 'https://rigby2d.com';
export const SUBMIT_URL = 'https://github.com/jaisurya-dev-art/rigby2d/issues/new?template=addon-submission.yml';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

/** An add-on's README as safe HTML: relative links and images point into its repository. */
export function readmeHtml(md, repo) {
  const resolve = (href, raw) => {
    if (/^https?:\/\//i.test(href)) return href;
    if (/^#/.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // javascript:, data:, …
    const p = href.replace(/^\.?\//, '');
    return raw ? `https://raw.githubusercontent.com/${repo}/HEAD/${p}` : `https://github.com/${repo}/blob/HEAD/${p}`;
  };
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => esc(text),
      heading({ tokens, depth }) {
        const level = Math.min(6, depth + 1); // the page has its own h1
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      link({ href, tokens }) {
        const target = resolve(href, false);
        const inner = this.parser.parseInline(tokens);
        return target ? `<a href="${esc(target)}" rel="noopener nofollow ugc">${inner}</a>` : inner;
      },
      image({ href, text }) {
        const src = resolve(href, true);
        return src && /^https:/.test(src) ? `<img src="${esc(src)}" alt="${esc(text)}" loading="lazy" referrerpolicy="no-referrer">` : esc(text);
      },
    },
  });
  // The README's own first heading repeats the add-on's name.
  return marked.parse(String(md ?? '').replace(/^\s*#\s[^\n]*\n/, ''));
}

/** The letter tile standing in for an add-on's icon, coloured from its id. */
function tile(a, size = '') {
  let h = 0;
  for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="addon-tile${size}" style="--hue:${h}" aria-hidden="true">${esc((a.name || a.id).trim()[0].toUpperCase())}</span>`;
}

const tags = (a) => a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');

/** One card on the Add-ons page; data-* feed the search, filters and sorting (market.js). */
export function addonCard(a) {
  const v = a.versions[0];
  return `<a class="addon-card" href="./${esc(a.id)}/" data-search="${esc([a.name, a.description, a.author, a.publisher, ...a.tags].join(' ').toLowerCase())}" data-tags="${esc(a.tags.join(' '))}" data-stars="${a.stars ?? 0}" data-official="${a.official ? 1 : 0}" data-date="${esc(v?.published ?? a.added ?? '')}" data-name="${esc(a.name.toLowerCase())}">
            <span class="addon-card-head">${tile(a)}<span><b>${esc(a.name)}</b><small>${a.official ? '<span class="badge">Official</span>' : ''}by ${esc(a.author || a.publisher)}</small></span></span>
            <span class="addon-card-desc">${esc(a.description)}</span>
            <span class="addon-card-foot"><span class="tags">${tags(a)}</span><span class="addon-card-meta">${a.stars ? `★ ${a.stars}` : ''} <span>v${esc(v?.version)}</span></span></span>
          </a>`;
}

/** The page of one add-on (addons/<id>/index.html). `download` is its mirrored zip, if any. */
export function addonPage(a, download) {
  const v = a.versions[0];
  const source = a.path ? `https://github.com/${a.repo}/tree/develop/${a.path}` : `https://github.com/${a.repo}`;
  const facts = [
    ['Version', esc(v.version)],
    ['Updated', date(v.published) || date(a.added)],
    ['Needs', v.rigby ? `Rigby2D ${esc(v.rigby)} or newer` : 'Any Rigby2D'],
    ['Author', esc(a.author)],
    ['Publisher', `<a href="https://github.com/${esc(a.publisher)}" rel="noopener">@${esc(a.publisher)}</a>`],
    ['License', esc(a.license || (a.official ? 'MIT OR Apache-2.0' : 'Not stated'))],
    ...(a.official ? [] : [['Stars', `★ ${a.stars ?? 0}`]]),
  ];
  const versions = a.versions
    .map((x) => `<tr><td>${esc(x.version)}</td><td>${date(x.published)}</td><td>${x.rigby ? esc(x.rigby) : 'any'}</td><td>${x.tag ? `<a href="https://github.com/${esc(a.repo)}/releases/tag/${encodeURIComponent(x.tag)}" rel="noopener">${esc(x.tag)}</a>` : x.commit ? `<code>${esc(x.commit.slice(0, 7))}</code>` : ''}</td></tr>`)
    .join('');
  const main = `
      <section class="page-head addon-head">
        <div class="wrap">
          <p class="crumbs"><a href="/addons/">Add-ons</a> / ${esc(a.name)}</p>
          <div class="addon-title">${tile(a, ' big')}<div><h1>${esc(a.name)}${a.official ? ' <span class="badge">Official</span>' : ''}</h1><p class="section-lede">${esc(a.description)}</p><p class="tags">${tags(a)}</p></div></div>
          <div class="cta">
            ${download ? `<a class="btn primary" href="${esc(download)}" download data-goatcounter-click="addon-download-${esc(a.id)}">Download .zip</a>` : ''}
            <a class="btn" href="${esc(source)}" rel="noopener">${brandIcon('github', 16)} Source</a>
            ${a.url && !a.url.startsWith(source) ? `<a class="btn" href="${esc(a.url)}" rel="noopener nofollow">Documentation</a>` : ''}
          </div>
        </div>
      </section>
      <section class="section addon-body">
        <div class="wrap addon-layout">
          <article class="addon-readme post-body">${a.readme ? readmeHtml(a.readme, a.repo) : `<p>${esc(a.description)}</p>`}</article>
          <aside class="addon-side">
            <div class="addon-install">
              <h4>Install</h4>
              <ol>
                <li>In Rigby2D, open <b>Edit ▸ Preferences ▸ Add-ons</b>.</li>
                <li>Choose <b>Get add-ons</b> and search for <b>${esc(a.name)}</b>.</li>
                <li>Click <b>Install</b>. Its tools appear in the <b>Scripts</b> menu.</li>
              </ol>
              <p class="fine">Or download the .zip and use <b>Install from file…</b>. Add-ons run sandboxed: they can change the open project, but not your files or the network.</p>
            </div>
            <dl class="addon-facts">${facts.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
            <h4>Versions</h4>
            <table class="addon-versions"><thead><tr><th>Version</th><th>Date</th><th>Needs</th><th>Release</th></tr></thead><tbody>${versions}</tbody></table>
            <p class="fine"><a href="https://github.com/jaisurya-dev-art/rigby2d/issues/new?title=${encodeURIComponent(`Add-on report: ${a.id}`)}" rel="noopener">Report this add-on</a></p>
          </aside>
        </div>
      </section>`;
  const title = `${a.name} · Rigby2D add-ons`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(a.description)}" />
    <meta name="theme-color" content="#0a0a0b" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(a.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${SITE}/addons/${esc(a.id)}/" />
    <meta property="og:image" content="${SITE}/og.jpg" />
    <link rel="icon" type="image/svg+xml" href="/blog/icon.svg" />
    <link rel="stylesheet" href="/blog/site.css" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    ${siteHeader({ active: 'addons' })}
    <main id="main">${main}</main>
    ${siteFooter()}
    ${NAV_SCRIPT}
  </body>
</html>
`;
}
