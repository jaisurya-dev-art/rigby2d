// SPDX-License-Identifier: MIT OR Apache-2.0
// The devlog: release posts and news written as Markdown in site/blog/posts/<date>-<slug>.md,
// with a small front matter (title, date, summary, image, video, tag, lang, and time: HH:MM to order posts of one day). The website build turns them
// into blog/<slug>.html pages, the blog/ index, the blog/feed.xml RSS feed, and news.json, which
// the editor's welcome screen reads ("What's new"). Each published release gets a post written
// from its notes (.github/workflows/release-post.yml) unless one was written by hand first.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_SCRIPT, siteFooter, siteHeader } from '../chrome.js';
import { renderMarkdown } from '../docs/build.js';

const SITE = 'https://rigby2d.com';
/**
 * The website's stylesheet as the generated pages (devlog, add-on pages) link it: blog/site.css with a
 * hash of its contents, so browsers fetch it again whenever it changes instead of keeping an old copy.
 */
export const SITE_CSS = `/blog/site.css?v=${createHash('sha256').update(fs.readFileSync(new URL('../style.css', import.meta.url))).digest('hex').slice(0, 10)}`;

const POSTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'posts'); // decoded (spaces), every platform
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
    .sort((a, b) => `${b.date} ${b.time ?? ''}`.localeCompare(`${a.date} ${a.time ?? ''}`) || b.slug.localeCompare(a.slug));
}

const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const absolute = (p) => (!p ? '' : /^https?:/.test(p) ? p : `${SITE}${p.startsWith('/') ? '' : '/'}${p}`);

/** The page shell: the website's header, footer and styles around `main`. */
function shell({ title, description, url, image, main, lang = 'en' }) {
  return `<!doctype html>
<html lang="${esc(lang)}">
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
    <link rel="stylesheet" href="${SITE_CSS}" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    ${siteHeader({ active: 'blog' })}
    <main id="main">${main}</main>
    ${siteFooter()}
    ${NAV_SCRIPT}
    ${READS_SCRIPT}
  </body>
</html>
`;
}

/**
 * Likes and comments, by giscus (giscus.app): each post's thread is a GitHub Discussion in the rigby2d
 * repo (Announcements, where only maintainers start threads). Anyone can read; reacting or commenting
 * needs a GitHub sign-in. The frame loads only when the reader scrolls to it, and sets no cookies for
 * readers who don't sign in (see docs/privacy.md).
 */
const GISCUS = { repo: 'jaisurya-dev-art/rigby2d', repoId: 'R_kgDOVHCfHg', category: 'Announcements', categoryId: 'DIC_kwDOVHCfHs4DKV9I' };
const discussBlock = (post) =>
  GISCUS.categoryId
    ? `<section class="post-discuss" aria-label="Likes and comments">
            <h2>${post.lang === 'zh-CN' ? '点赞与评论' : 'Likes and comments'}</h2>
            <p class="post-discuss-note">${post.lang === 'zh-CN' ? '所有人都可以阅读；用 GitHub 登录即可点赞或评论。' : 'Anyone can read. Sign in with GitHub to like or comment.'}</p>
            <script src="https://giscus.app/client.js" data-repo="${GISCUS.repo}" data-repo-id="${GISCUS.repoId}" data-category="${GISCUS.category}" data-category-id="${GISCUS.categoryId}"
              data-mapping="pathname" data-strict="1" data-reactions-enabled="1" data-emit-metadata="0" data-input-position="top" data-theme="transparent_dark"
              data-lang="${post.lang === 'zh-CN' ? 'zh-CN' : 'en'}" data-loading="lazy" crossorigin="anonymous" async></script>
          </section>`
    : '';

/**
 * Read counts (site/reads/worker.js at /api/reads): each post and index card shows its running total,
 * and a post page counts one read once it has been visible for 5 seconds in all. Only on rigby2d.com,
 * so local previews never count; with no count yet, nothing shows.
 */
const readsSpan = (post, count = false) => `<span class="post-reads" data-reads="${esc(post.slug)}"${count ? ' data-count' : ''} hidden></span>`;
const READS_SCRIPT = `<script>
(() => {
  if (location.hostname !== 'rigby2d.com') return;
  const els = [...document.querySelectorAll('[data-reads]')];
  if (!els.length) return;
  const zh = document.documentElement.lang === 'zh-CN';
  const show = (slug, n) => {
    for (const e of els) if (e.dataset.reads === slug && n > 0) {
      e.textContent = zh ? \`\${n.toLocaleString()} 次阅读\` : \`\${n.toLocaleString()} \${n === 1 ? 'read' : 'reads'}\`;
      e.hidden = false;
    }
  };
  fetch('/api/reads?slugs=' + [...new Set(els.map((e) => e.dataset.reads))].join(','))
    .then((r) => r.json()).then((t) => Object.entries(t).forEach(([s, n]) => show(s, n))).catch(() => {});
  const mine = els.find((e) => 'count' in e.dataset);
  if (!mine) return;
  let seen = 0, since = document.visibilityState === 'visible' ? Date.now() : 0, sent = false;
  const tick = () => {
    if (since) { seen += Date.now() - since; since = document.visibilityState === 'visible' ? Date.now() : 0; }
    if (!sent && seen >= 5000) {
      sent = true;
      fetch('/api/reads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: mine.dataset.reads }), keepalive: true })
        .then((r) => r.json()).then((d) => d.reads && show(mine.dataset.reads, d.reads)).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', () => { tick(); if (document.visibilityState === 'visible') since = Date.now(); });
  const timer = setInterval(() => { tick(); if (sent) clearInterval(timer); }, 1000);
})();
</script>`;

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
          <p class="post-meta"><a href="/blog/">Devlog</a> · <time datetime="${esc(post.date)}">${longDate(post.date)}</time> ${tag(post)}${readsSpan(post, true)}</p>
          <h1>${esc(post.title)}</h1>
          <p class="section-lede">${esc(post.summary)}</p>
          ${videoBlock(post)}
          <div class="post-body">${post.html}</div>
          ${discussBlock(post)}
          <div class="community-callout"><p><b>Talk about this on Discord.</b> Questions, ideas and what you made with it: the community hears it first.</p><a class="btn discord" href="https://discord.gg/PGgaTwbNH" rel="noopener"><svg class="discord-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>Join our Discord</a>
              <a class="btn x" href="https://x.com/Rigby2d" rel="noopener" data-goatcounter-click="site-x-devlog"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>Follow us on X</a></div>
          <p class="post-follow">Also: <a href="/blog/feed.xml">RSS</a> · <a href="https://github.com/jaisurya-dev-art/rigby2d" rel="noopener">GitHub</a> · <a href="/fund/">Support Rigby2D</a>: free for everyone, paid for by a few.</p>
        </div>
      </article>`;
  return shell({ title: `${post.title} · Rigby2D devlog`, description: post.summary, url: `${SITE}/blog/${post.slug}.html`, image: absolute(post.image), main, lang: post.lang ?? 'en' });
}

export function indexPage(posts) {
  const cards = posts
    .map(
      (p) => `
          <a class="post-card" href="/blog/${esc(p.slug)}.html">
            ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="640" />` : ''}
            <span class="post-meta"><time datetime="${esc(p.date)}">${longDate(p.date)}</time> ${tag(p)}${readsSpan(p)}</span>
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
          <p class="section-lede">Releases, behind the scenes, and what's coming next. Follow with <a href="/blog/feed.xml">RSS</a> or join <a href="https://discord.gg/PGgaTwbNH" rel="noopener">Discord</a>.</p>
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
      <pubDate>${new Date(`${p.date}T${p.time ?? '12:00'}:00Z`).toUTCString()}</pubDate>
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
      // `lang` marks posts written for one interface language (the editor shows them only there).
      items: posts.slice(0, 10).map((p) => ({ title: p.title, date: p.date, summary: p.summary, tag: p.tag ?? null, lang: p.lang ?? null, url: `${SITE}/blog/${p.slug}.html`, image: absolute(p.image) || null, video: p.video ?? null })),
    },
    null,
    2,
  );
}
