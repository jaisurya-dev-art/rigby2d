// SPDX-License-Identifier: MIT OR Apache-2.0
// The devlog: release posts and news written as Markdown in site/blog/posts/<date>-<slug>.md,
// with a small front matter (title, date, summary, image, video, tag). The website build turns them
// into blog/<slug>.html pages, the blog/ index, the blog/feed.xml RSS feed, and news.json, which
// the editor's welcome screen reads ("What's new").

import fs from 'node:fs';
import path from 'node:path';
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
    <header class="nav">
      <div class="wrap nav-row">
        <a class="brand" href="/" aria-label="Rigby2D home"><img src="/blog/mark.svg" alt="" width="28" height="28" /><span>Rigby<b>2D</b></span></a>
        <nav id="site-nav" aria-label="Sections">
          <a href="/#features">Features</a>
          <a href="/demos/">Demos</a>
          <a href="/blog/" aria-current="page">Devlog</a>
          <a href="/#runtimes">Runtimes</a>
          <a href="/#download">Download</a>
          <a href="/docs/">Docs</a>
          <a href="https://www.reddit.com/r/rigby2d/" rel="noopener">Community</a>
          <a href="https://github.com/jaisurya-dev-art/rigby2d" rel="noopener">GitHub</a>
        </nav>
        <a class="btn small primary" href="/editor/">Open editor</a>
        <button class="nav-toggle" type="button" aria-label="Open the menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>
      </div>
    </header>
    <main id="main">${main}</main>
    <footer class="foot">
      <div class="wrap foot-row">
        <img src="/blog/lockup.svg" alt="Rigby2D" width="176" height="66" />
        <p>Source code licensed MIT OR Apache-2.0. The Rigby2D, NILA and Rigbytron names, logos and artwork are trademarks of the Rigby2D project; see <a href="https://github.com/jaisurya-dev-art/rigby2d/blob/develop/TRADEMARKS.md" rel="noopener">TRADEMARKS.md</a>.</p>
        <nav aria-label="Project links">
          <a href="/docs/">Documentation</a>
          <a href="/blog/feed.xml">RSS</a>
          <a href="https://www.reddit.com/r/rigby2d/" rel="noopener">r/rigby2d</a>
          <a href="/docs/privacy.html">Privacy</a>
          <a href="mailto:hello@rigby2d.com">Contact</a>
        </nav>
      </div>
    </footer>
    <script>
      // The phone menu (the same behaviour as the rest of the website).
      const toggle = document.querySelector('.nav-toggle');
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        document.querySelector('.nav').classList.toggle('open', open);
      });
    </script>
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
          <p class="post-follow">Follow along: <a href="https://www.reddit.com/r/rigby2d/" rel="noopener">r/rigby2d</a> · <a href="/blog/feed.xml">RSS</a> · <a href="https://github.com/jaisurya-dev-art/rigby2d" rel="noopener">GitHub</a></p>
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
