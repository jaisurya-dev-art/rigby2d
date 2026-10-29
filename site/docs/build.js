// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds the documentation website from docs/*.md: one HTML page per entry in nav.js, with the site
// header, a section sidebar, an "On this page" outline, previous / next links and search
// (search.json, read by docs.js). The Markdown stays readable on GitHub: links between pages
// (`film.md#rendering`) become page links, links to other repository files point at GitHub, images
// in docs/images are published next to the pages, and GitHub alerts (`> [!TIP]`) become callouts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import hljs from 'highlight.js';
import { Marked } from 'marked';

import { fillGenerated, generatedSections } from './generate.js';
import { NAV, PAGES } from './nav.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../..');
export const DOCS = path.join(REPO, 'docs');
const GITHUB = 'https://github.com/jaisurya-dev-art/rigby2d';
const BRANCH = 'develop';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** GitHub-style heading ids: lowercase, punctuation dropped, spaces to dashes. */
export function slugify(text) {
  return stripTags(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const ALERTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

/** GitHub alerts (`> [!NOTE]` blocks) as callout boxes; the content stays Markdown. */
function alerts(md) {
  return md.replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n((?:>.*(?:\n|$))*)/gm, (all, kind, body) => {
    const inner = body.replace(/^> ?/gm, '');
    return `<div class="callout ${kind.toLowerCase()}"><p class="callout-title">${ALERTS[kind]}</p>\n\n${inner}\n</div>\n\n`;
  });
}

/** Where a link in docs/<page>.md points on the website. */
function linkTarget(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [file, hash] = href.split('#');
  const anchor = hash ? `#${hash}` : '';
  const page = file.replace(/^\.\//, '');
  if (/^[\w-]+\.md$/.test(page) && fs.existsSync(path.join(DOCS, page))) return `${page.replace(/\.md$/, '')}.html${anchor}`;
  if (page.startsWith('images/') || page.startsWith('videos/')) return page;
  // Any other repository path: show it on GitHub.
  const rel = path.posix.normalize(path.posix.join('docs', page));
  const isDir = file.endsWith('/') || (fs.existsSync(path.join(REPO, rel)) && fs.statSync(path.join(REPO, rel)).isDirectory());
  return `${GITHUB}/${isDir ? 'tree' : 'blob'}/${BRANCH}/${rel.replace(/\/$/, '')}${anchor}`;
}

/** Renders one Markdown page: { title, html, toc: [{ depth, id, text }], text }. */
export function renderMarkdown(md) {
  const toc = [];
  const used = new Map();
  let title = '';
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const plain = stripTags(inner);
        if (depth === 1) {
          title ||= plain;
          return `<h1>${inner}</h1>\n`;
        }
        let id = slugify(plain);
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth <= 3) toc.push({ depth, id, text: plain });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${depth}>\n`;
      },
      link({ href, title: t, tokens }) {
        const target = linkTarget(href);
        const external = /^https?:/.test(target) && !target.startsWith(GITHUB + '/blob') ? ' rel="noopener"' : '';
        return `<a href="${esc(target)}"${t ? ` title="${esc(t)}"` : ''}${external}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title: caption, text }) {
        const src = esc(linkTarget(href));
        const img = `<img src="${src}" alt="${esc(text)}" loading="lazy">`;
        return caption ? `<figure>${img}<figcaption>${esc(caption)}</figcaption></figure>` : img;
      },
      code({ text, lang }) {
        const language = (lang ?? '').split(/\s/)[0];
        const known = language && hljs.getLanguage(language);
        const body = known ? hljs.highlight(text, { language }).value : esc(text);
        return `<div class="code"><pre><code class="hljs${known ? ` language-${language}` : ''}">${body}</code></pre><button type="button" class="copy" aria-label="Copy code">Copy</button></div>\n`;
      },
      table({ header, rows }) {
        const cellHtml = (c, tag) => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${header.map((c) => cellHtml(c, 'th')).join('')}</tr>`;
        const body = rows.map((r) => `<tr>${r.map((c) => cellHtml(c, 'td')).join('')}</tr>`).join('\n');
        return `<div class="table"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  const html = marked.parse(alerts(md));
  return { title, html, toc, text: stripTags(html).replace(/\s+/g, ' ').trim() };
}

let generated = null;

/** Reads and renders every page in the navigation. */
export async function renderAll({ fresh = false } = {}) {
  if (!generated || fresh) generated = await generatedSections();
  return PAGES.map((p, i) => {
    const file = path.join(DOCS, `${p.slug}.md`);
    const md = fillGenerated(fs.readFileSync(file, 'utf8'), generated);
    return { ...p, index: i, ...renderMarkdown(md) };
  });
}

// On phones the header keeps only the search, so the site links lead the sidebar there.
const SITE_LINKS = `<div class="nav-section sidebar-site"><p class="nav-title">Rigby2D</p><ul><li><a href="../">Home</a></li><li><a href="../demos/">Demos</a></li><li><a href="../editor/" data-goatcounter-click="docs-open-editor-menu">Open the editor</a></li><li><a href="${GITHUB}" rel="noopener">GitHub</a></li></ul></div>`;

const sidebar = (pages, current) =>
  SITE_LINKS +
  NAV.map(
    (s) =>
      `<div class="nav-section"><p class="nav-title">${esc(s.title)}</p><ul>${s.pages
        .map((slug) => {
          const p = pages.find((x) => x.slug === slug);
          return `<li><a href="${slug}.html"${slug === current ? ' aria-current="page"' : ''}>${esc(p?.title ?? slug)}</a></li>`;
        })
        .join('')}</ul></div>`,
  ).join('');

const outline = (toc) =>
  toc.filter((t) => t.depth >= 2).length
    ? `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${toc
        .filter((t) => t.depth >= 2)
        .map((t) => `<li class="d${t.depth}"><a href="#${t.id}">${esc(t.text)}</a></li>`)
        .join('')}</ul></nav>`
    : '';

/** The full HTML document for one page. `assets` maps docs.css / docs.js / icons to their URLs. */
export function pageHtml(page, pages, assets) {
  const prev = pages[page.index - 1];
  const next = pages[page.index + 1];
  const description = page.text.slice(0, 180).replace(/\s\S*$/, '') + '…';
  const pager = `<nav class="pager" aria-label="Previous and next page">${prev ? `<a class="prev" href="${prev.slug}.html"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><span>Next</span>${esc(next.title)}</a>` : ''}</nav>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(page.title)} · Rigby2D documentation</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="theme-color" content="#0a0a0b" />
    <meta property="og:title" content="${esc(page.title)} · Rigby2D documentation" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:image" content="${assets.og}" />
    <link rel="icon" type="image/svg+xml" href="${assets.icon}" />
    <link rel="stylesheet" href="${assets.css}" />
  </head>
  <body>
    <a class="skip" href="#content">Skip to content</a>
    <header class="top">
      <button type="button" class="menu-button" aria-label="Show the table of contents" aria-expanded="false" aria-controls="sidebar">☰</button>
      <a class="brand" href="../" aria-label="Rigby2D home"><img src="${assets.mark}" alt="" width="26" height="26" /><span>Rigby<b>2D</b></span><span class="brand-docs">Docs</span></a>
      <div class="search" role="search">
        <input type="search" placeholder="Search the docs" aria-label="Search the documentation" autocomplete="off" spellcheck="false" />
        <kbd class="search-key">/</kbd>
        <div class="results" role="listbox" hidden></div>
      </div>
      <nav class="top-links" aria-label="Site">
        <a href="../">Home</a>
        <a href="../demos/">Demos</a>
        <a href="${GITHUB}" rel="noopener">GitHub</a>
        <a class="btn" href="../editor/" data-goatcounter-click="docs-open-editor">Open editor</a>
      </nav>
    </header>
    <div class="layout">
      <aside id="sidebar" class="sidebar" aria-label="Documentation">${sidebar(pages, page.slug)}</aside>
      <main id="content" class="content">
        <p class="crumb">${esc(page.section)}</p>
        <article class="doc">${page.html}</article>
        <p class="edit"><a href="${GITHUB}/edit/${BRANCH}/docs/${page.slug}.md" rel="noopener">Edit this page on GitHub</a></p>
        ${pager}
      </main>
      ${outline(page.toc)}
    </div>
    <footer class="foot">
      <p>Rigby2D source code is licensed MIT OR Apache-2.0. The Rigby2D, Hoverlabs, NILA and Rigbytron names, logos and artwork are trademarks of Hoverlabs (<a href="${GITHUB}/blob/${BRANCH}/TRADEMARKS.md" rel="noopener">TRADEMARKS.md</a>). <a href="privacy.html">Privacy</a></p>
    </footer>
    <script type="module" src="${assets.js}"></script>
  </body>
</html>
`;
}

/** The search index: one entry per page section. */
export function searchIndex(pages) {
  const entries = [];
  for (const p of pages) {
    // Split the page's text at its headings, so a hit links straight to its section.
    const parts = p.html.split(/(?=<h[23] id=")/);
    for (const part of parts) {
      const m = /^<h([23]) id="([^"]+)">(.*?)<\/h\1>/s.exec(part);
      entries.push({
        page: p.slug,
        title: p.title,
        section: m ? stripTags(m[3]).replace(/^#/, '') : '',
        id: m ? m[2] : '',
        text: stripTags(m ? part.slice(m[0].length) : part)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1200),
      });
    }
  }
  return entries;
}

/** Image and video files under docs/images and docs/videos, relative to docs/. */
export function imageFiles() {
  const out = [];
  for (const sub of ['images', 'videos']) {
    const dir = path.join(DOCS, sub);
    if (fs.existsSync(dir)) out.push(...fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|gif|svg|mp4|webm)$/i.test(f)).map((f) => `${sub}/${f}`));
  }
  return out;
}
