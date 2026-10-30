// SPDX-License-Identifier: MIT OR Apache-2.0
// The devlog: release posts and news written as Markdown in site/blog/posts/<date>-<slug>.md,
// with a small front matter (title, date, summary, image, video, tag). The website build turns them
// into blog/<slug>.html pages, the blog/ index, the blog/feed.xml RSS feed, and news.json, which
// the editor's welcome screen reads ("What's new").

import fs from 'node:fs';
import path from 'node:path';
import { NAV_SCRIPT, siteFooter, siteHeader } from '../chrome.js';
import { renderMarkdown } from '../docs/build.js';

const SITE = 'https://rigby2d.com';
const POSTS = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'posts');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Every post, newest first: { slug, title, date, summary, image, video, tag, html }. */
export function readPosts() {
  if (!fs.existsSync(POSTS)) return [];
  return fs
    .readdirSync(POSTS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = fs.readFileSync(path.join(POSTS, f), 'utf8').replace(/\r\n/g, '\n');
      const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
      if (!m) throw new Error(`${f}: no front matter`);
      const meta = Object.fromEntries(
        m[1]
          .split('\n')
          .filter((l) => l.includes(':'))
          .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]),
      );
      for (const key of ['title', 'date', 'summary']) if (!meta[key]) throw new Error(`${f}: front matter needs ${key}`);
      const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
      return { slug, ...meta, html: renderMarkdown(text.slice(m[0].length)).html };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
}

const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const absolute = (p) => (!p ? '' : /^https?:/.test(p) ? p : `${SITE}${p.startsWith('/') ? '' : '/'}${p}`);

/** The page shell: the website's header, footer and styles around `main`. */
function shell({ title, description, url, image, main }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="theme-color" content="#0a0a0b" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image || `${SITE}/og.jpg`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" type="image/svg+xml" href="/blog/icon.svg" />
    <link rel="alternate" type="application/rss+xml" title="Rigby2D devlog" href="/blog/feed.xml" />
    <link rel="stylesheet" href="/blog/site.css" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    ${siteHeader({ active: 'blog' })}
    <main id="main">${main}</main>
    ${siteFooter()}
    ${NAV_SCRIPT}
  </body>
</html>
`;
}

/** A video poster that opens the video on YouTube (no embed, so no third-party cookies). */
const videoBlock = (post) =>
  post.video
    ? `<a class="video post-video" href="${esc(post.video)}" rel="noopener"><img src="${esc(post.image)}" alt="Watch on YouTube: ${esc(post.title)}" width="1200" /><span class="play" aria-hidden="true"></span><span class="video-label">Watch on YouTube</span></a>`
    : post.image
      ? `<img class="post-hero" src="${esc(post.image)}" alt="" width="1200" />`
      : '';

const tag = (post) => (post.tag ? `<span class="post-tag">${esc(post.tag)}</span>` : '');

export function postPage(post) {
  const main = `
      <article class="section post">
        <div class="wrap post-wrap">
          <p class="post-meta"><a href="/blog/">Devlog</a> · <time datetime="${esc(post.date)}">${longDate(post.date)}</time> ${tag(post)}</p>
          <h1>${esc(post.title)}</h1>
          <p class="section-lede">${esc(post.summary)}</p>
          ${videoBlock(post)}
          <div class="post-body">${post.html}</div>
          <div class="community-callout"><p><b>Talk about this on r/rigby2d.</b> Questions, ideas and what you made with it: the community hears it first.</p><a class="btn reddit" href="https://www.reddit.com/r/rigby2d/" rel="noopener"><svg class="snoo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg>Join r/rigby2d</a></div>
          <p class="post-follow">Also: <a href="/blog/feed.xml">RSS</a> · <a href="https://github.com/jaisurya-dev-art/rigby2d" rel="noopener">GitHub</a></p>
        </div>
      </article>`;
  return shell({ title: `${post.title} · Rigby2D devlog`, description: post.summary, url: `${SITE}/blog/${post.slug}.html`, image: absolute(post.image), main });
}

export function indexPage(posts) {
  const cards = posts
    .map(
      (p) => `
          <a class="post-card" href="/blog/${esc(p.slug)}.html">
            ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="640" />` : ''}
            <span class="post-meta"><time datetime="${esc(p.date)}">${longDate(p.date)}</time> ${tag(p)}</span>
            <b>${esc(p.title)}</b>
            <span>${esc(p.summary)}</span>
          </a>`,
    )
    .join('');
  const main = `
      <section class="page-head">
        <div class="wrap">
          <p class="eyebrow">Devlog</p>
          <h1>What's new in Rigby2D</h1>
          <p class="section-lede">Releases, behind the scenes, and what's coming next. Follow with <a href="/blog/feed.xml">RSS</a> or join <a href="https://www.reddit.com/r/rigby2d/" rel="noopener">r/rigby2d</a>.</p>
        </div>
      </section>
      <section class="section">
        <div class="wrap post-grid">${cards}
        </div>
      </section>`;
  return shell({ title: 'Devlog · Rigby2D', description: "Rigby2D releases, behind the scenes, and what's coming next.", url: `${SITE}/blog/`, image: absolute(posts[0]?.image), main });
}

export function feedXml(posts) {
  const items = posts
    .map(
      (p) => `
    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE}/blog/${esc(p.slug)}.html</link>
      <guid>${SITE}/blog/${esc(p.slug)}.html</guid>
      <pubDate>${new Date(`${p.date}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${esc(p.summary)}</description>
    </item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Rigby2D devlog</title>
    <link>${SITE}/blog/</link>
    <description>Releases, behind the scenes, and what's coming next for Rigby2D.</description>
    <language>en</language>${items}
  </channel>
</rss>
`;
}

/** What the editor's welcome screen shows: the newest posts. */
export function newsJson(posts) {
  return JSON.stringify(
    {
      updated: posts[0]?.date ?? null,
      items: posts.slice(0, 6).map((p) => ({ title: p.title, date: p.date, summary: p.summary, tag: p.tag ?? null, url: `${SITE}/blog/${p.slug}.html`, image: absolute(p.image) || null, video: p.video ?? null })),
    },
    null,
    2,
  );
}
