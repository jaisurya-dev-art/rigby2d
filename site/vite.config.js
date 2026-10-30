// SPDX-License-Identifier: MIT OR Apache-2.0
// The project website (GitHub Pages, https://rigby2d.com/): the landing page
// is built from this folder into _site/, the documentation from docs/*.md into _site/docs/ (see
// docs/build.js), and the browser editor into _site/editor/ (see package.json "site:build"). The
// landing page plays NILA with the real runtime from src/core.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

import { DOCS, imageFiles, pageHtml, renderAll, renderMarkdown, searchIndex } from './docs/build.js';
import { siteFooter, siteHeader } from './chrome.js';
import { icon, mark } from './icons.js';
import { feedXml, indexPage, newsJson, postPage, readPosts } from './blog/devlog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

/** The link-preview image (og:image) needs a fixed URL, so the editor screenshot is copied as og.jpg. */
function socialImage() {
  return {
    name: 'rigby-site-og',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'og.jpg', source: fs.readFileSync(path.join(repo, 'docs/screenshot.jpg')) });
    },
  };
}

/**
 * The demo projects. Each is published at a fixed URL (demos/<id>.rigby and .png, which the desktop
 * app downloads) and as a zip for the Demos page: the project, its game-ready export, a README and
 * the demo content license (branding/DEMO-LICENSE.md).
 */
const DEMOS = {
  rigbytron: {
    title: 'Rigbytron',
    credit: 'Rigbytron',
    file: 'branding/rigbytron/rigbytron.rigby',
    export: 'branding/rigbytron/export',
    about: 'The Rigby2D robot mascot: a rig with a meshed body, IK, and its hold and release animations with a slash event.',
  },
  nila: {
    title: 'NILA',
    credit: 'NILA',
    file: 'branding/nila/nila.rigby',
    export: 'branding/nila/export',
    about: 'A layered character with bending meshes, physics on her braid and jhumkas, face poses, her voice with viseme lip-sync, and the 70-second promo animation (Film workspace).',
  },
  scene: {
    title: 'Scene: NILA meets Rigbytron',
    credit: 'NILA and Rigbytron',
    file: 'branding/scene/scene.rigby',
    export: 'runtimes/godot/demo/scene',
    about: 'Scene composition: both characters as actors with clips, voices and lip-sync, on a painted multiplane stage with parallax and a moving camera.',
  },
};
const DEMO_LICENSE = 'branding/DEMO-LICENSE.md';

/** Every file under `dir` (relative paths with '/'), skipping Godot's import metadata. */
function filesIn(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (!/\.(import|uid)$/.test(e.name)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

function demoReadme(id, demo, exported) {
  const name = path.basename(demo.file);
  return `# Rigby2D demo: ${demo.title}

${demo.about}

## What's inside

- \`${name}\`: the Rigby2D project. Open it in Rigby2D with *File ▸ Open…*, or open the demo from
  *File ▸ Open demo…*. The editor runs in your browser too: https://rigby2d.com/editor/
- \`export/\`: the same content exported for games (${exported.join(', ')}), ready for the
  JavaScript, Rust and Godot runtimes: https://rigby2d.com/docs/runtimes.html
- \`thumbnail.png\`: a preview.
- \`LICENSE.md\`: the Rigby2D Demo Content License.

## License

This demo is © Rigby2D and is **not** open source. You may open, study and modify it to learn
Rigby2D, use it to evaluate Rigby2D and its runtimes, and show it in tutorials, reviews and videos
with the credit *"${demo.credit} © Rigby2D, from the Rigby2D demo projects."* You may not use it in your
own games, apps, films or other products, or to train AI models. Read \`LICENSE.md\` for the full
terms.

Rigby2D itself (the editor and runtimes) is open source under MIT OR Apache-2.0:
https://github.com/jaisurya-dev-art/rigby2d
`;
}

/** The demo zip: <id>/ with the project, export/, thumbnail.png, README.md and LICENSE.md. */
async function demoZip(id, demo) {
  const { zip } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
  const dir = path.dirname(demo.file);
  const exported = filesIn(path.join(repo, demo.export));
  const read = (p) => new Uint8Array(fs.readFileSync(path.join(repo, p)));
  const text = (t) => new TextEncoder().encode(t);
  return zip([
    { path: `${id}/README.md`, bytes: text(demoReadme(id, demo, exported.filter((f) => !f.includes('/')))) },
    { path: `${id}/LICENSE.md`, bytes: read(DEMO_LICENSE) },
    { path: `${id}/${path.basename(demo.file)}`, bytes: read(demo.file) },
    { path: `${id}/thumbnail.png`, bytes: read(path.join(dir, 'thumbnail.png')) },
    ...exported.map((f) => ({ path: `${id}/export/${f}`, bytes: read(path.join(demo.export, f)) })),
  ]);
}

const zips = new Map();
const zipOf = (id) => {
  if (!zips.has(id)) zips.set(id, demoZip(id, DEMOS[id]));
  return zips.get(id);
};

/**
 * Game starters for the editor's welcome screen: starters/rigby2d-phaser-starter.zip holds
 * runtimes/phaser/starter, the Phaser runtime bundle (npm run build:phaser, run first by site:build)
 * and NILA's export with the demo license.
 */
function starterFiles() {
  return {
    name: 'rigby-site-starters',
    async generateBundle() {
      const { zip } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
      const { version } = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
      const bundle = path.join(repo, `dist-phaser/rigby2d-phaser-${version}.mjs`);
      if (!fs.existsSync(bundle)) throw new Error('run npm run build:phaser before the site build');
      const read = (p) => new Uint8Array(fs.readFileSync(path.join(repo, p)));
      const root = 'rigby2d-phaser-starter';
      const files = [
        ...['index.html', 'main.js', 'README.md'].map((f) => ({ path: `${root}/${f}`, bytes: read(`runtimes/phaser/starter/${f}`) })),
        { path: `${root}/rigby2d-phaser.mjs`, bytes: new Uint8Array(fs.readFileSync(bundle)) },
        ...['nila.skel', 'nila.atlas', 'nila.png'].map((f) => ({ path: `${root}/assets/${f}`, bytes: read(`branding/nila/export/${f}`) })),
        { path: `${root}/assets/LICENSE.md`, bytes: read(DEMO_LICENSE) },
      ];
      this.emitFile({ type: 'asset', fileName: 'starters/rigby2d-phaser-starter.zip', source: zip(files) });
    },
  };
}

/**
 * The add-on marketplace (registry/, see registry/registry.mjs): the Add-ons page, a page for each
 * add-on at addons/<id>/, the newest version of each mirrored as addons/files/<id>-<version>.zip
 * (checked against the digest the registry recorded when it vetted that version), and
 * addons/index.json, the editor's gallery (Preferences ▸ Add-ons ▸ Get add-ons).
 */
function addonFiles() {
  const registry = () => import(pathToFileURL(path.join(repo, 'registry/registry.mjs')).href);
  let listing = null;
  const load = () =>
    (listing ??= (async () => {
      const { inspect, readEntries, readIndex } = await registry();
      const index = new Map(readIndex().addons.map((a) => [a.id, a]));
      const out = [];
      for (const entry of readEntries()) {
        const a = entry.path ? await inspect(entry) : index.get(entry.id);
        if (a?.versions?.length) out.push(a);
      }
      return out;
    })());
  return {
    name: 'rigby-site-addons',
    async transformIndexHtml(html, ctx) {
      if (!ctx.filename.replace(/\\/g, '/').endsWith('/addons/index.html')) return html;
      const addons = await load();
      const { addonCard } = await import('./addons/pages.js');
      const { TAGS } = await import(pathToFileURL(path.join(repo, 'src/editor/registry.js')).href);
      const chips = ['<button type="button" data-tag="" aria-pressed="true">All</button>', ...TAGS.filter((t) => addons.some((a) => a.tags.includes(t))).map((t) => `<button type="button" data-tag="${t}" aria-pressed="false">${t[0].toUpperCase()}${t.slice(1)}</button>`)];
      return html
        .replace('<!--addon-list-->', addons.map(addonCard).join(''))
        .replace('<!--addon-tags-->', chips.join(''))
        .replace('<!--addon-count-->', `${addons.length} add-ons`);
    },
    async generateBundle() {
      const { zip } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
      const { downloadPackage, localPackage, packageDigest } = await registry();
      const { addonPage } = await import('./addons/pages.js');
      const gallery = [];
      for (const a of await load()) {
        let found = null;
        for (const v of a.versions) {
          try {
            const files = a.path ? localPackage(a.path) : await downloadPackage(v.source, a.id);
            if (packageDigest(files) !== v.digest) throw new Error('its files changed since the registry checked them');
            found = { v, files };
            break;
          } catch (e) {
            this.warn(`add-on ${a.id} ${v.version} is not mirrored: ${e.message}`);
          }
        }
        let download = null;
        if (found) {
          const { v, files } = found;
          const bytes = zip([...files].map(([p, b]) => ({ path: `${a.id}/${p}`, bytes: b })), new Date('2026-01-01T00:00:00Z'));
          const fileName = `addons/files/${a.id}-${v.version}.zip`;
          this.emitFile({ type: 'asset', fileName, source: bytes });
          download = `/${fileName}`;
          gallery.push({
            id: a.id,
            name: a.name,
            version: v.version,
            author: a.author,
            description: a.description,
            tags: a.tags,
            official: a.official,
            publisher: a.publisher,
            rigby: v.rigby,
            license: a.license || (a.official ? 'MIT OR Apache-2.0' : ''),
            stars: a.stars ?? 0,
            url: `https://rigby2d.com/${fileName}`,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            size: bytes.length,
            page: `https://rigby2d.com/addons/${a.id}/`,
            repo: a.path ? `https://github.com/${a.repo}/tree/develop/${a.path}` : `https://github.com/${a.repo}`,
          });
        }
        this.emitFile({ type: 'asset', fileName: `addons/${a.id}/index.html`, source: addonPage(a, download) });
      }
      this.emitFile({ type: 'asset', fileName: 'addons/index.json', source: JSON.stringify({ updated: new Date().toISOString(), addons: gallery }, null, 2) });
    },
  };
}

/**
 * The comparison pages (compare/compare.js) as vs/<slug>/index.html, and sitemap.xml and robots.txt
 * listing every page of the site.
 */
function comparePages() {
  return {
    name: 'rigby-site-compare',
    async generateBundle(_options, bundle) {
      const { COMPARISONS, comparePage } = await import('./compare/compare.js');
      for (const c of COMPARISONS) this.emitFile({ type: 'asset', fileName: `vs/${c.slug}/index.html`, source: comparePage(c) });
      const pages = new Set(['', 'demos/', 'addons/', 'cloud/', 'blog/', 'editor/', ...COMPARISONS.map((c) => `vs/${c.slug}/`)]);
      for (const name of Object.keys(bundle)) {
        if (!name.endsWith('.html') || name.startsWith('editor/')) continue;
        pages.add(name.replace(/(^|\/)index\.html$/, '$1'));
      }
      for (const page of (await renderAll()).map((p) => `docs/${p.slug}.html`)) pages.add(page);
      for (const post of readPosts()) pages.add(`blog/${post.slug}.html`);
      const { readEntries } = await import(pathToFileURL(path.join(repo, 'registry/registry.mjs')).href);
      for (const e of readEntries()) pages.add(`addons/${e.id}/`);
      const urls = [...pages].sort().map((p) => `  <url><loc>https://rigby2d.com/${p}</loc></url>`);
      const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''];
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml.join('\n') });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: ['User-agent: *', 'Allow: /', '', 'Sitemap: https://rigby2d.com/sitemap.xml', ''].join('\n') });
    },
  };
}

/**
 * The shared header and footer (chrome.js) in place of the pages' <!--site-header:…--> and
 * <!--site-footer--> markers, and icons (icons.js) in place of <i data-icon="…"></i> and
 * <i data-mark="…"></i>.
 */
function siteChrome() {
  return {
    name: 'rigby-site-chrome',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const depth = path.relative(here, ctx.filename).split(path.sep).length - 1;
        const base = depth ? '../'.repeat(depth) : './';
        const up = '../'.repeat(depth + 1);
        return html
          .replace(/<!--site-header:(\w*)-->/, (_, active) => siteHeader({ base, active, mark: `${up}branding/rigby2d-mark.svg` }))
          .replace('<!--site-footer-->', siteFooter({ base, lockup: `${up}branding/rigby2d-lockup-transparent.svg` }))
          .replace(/<i data-(icon|mark)="([\w-]+)"><\/i>/g, (_, kind, name) => (kind === 'icon' ? icon(name) : mark(name)));
      },
    },
  };
}

/**
 * The devlog (site/blog/posts, rendered by blog/devlog.js): blog/<slug>.html, the blog/ index, the
 * RSS feed, and news.json for the editor's welcome screen. The pages are static and link the
 * website's stylesheet as blog/site.css.
 */
function devlogFiles() {
  return {
    name: 'rigby-site-devlog',
    generateBundle() {
      const posts = readPosts();
      for (const post of posts) this.emitFile({ type: 'asset', fileName: `blog/${post.slug}.html`, source: postPage(post) });
      this.emitFile({ type: 'asset', fileName: 'blog/index.html', source: indexPage(posts) });
      this.emitFile({ type: 'asset', fileName: 'blog/feed.xml', source: feedXml(posts) });
      this.emitFile({ type: 'asset', fileName: 'news.json', source: newsJson(posts) });
      this.emitFile({ type: 'asset', fileName: 'blog/site.css', source: fs.readFileSync(path.join(here, 'style.css')) });
      for (const [name, src] of [
        ['icon.svg', 'branding/rigby2d-icon-dark.svg'],
        ['mark.svg', 'branding/rigby2d-mark.svg'],
        ['lockup.svg', 'branding/rigby2d-lockup-transparent.svg'],
      ])
        this.emitFile({ type: 'asset', fileName: `blog/${name}`, source: fs.readFileSync(path.join(repo, src)) });
    },
  };
}

function demoFiles() {
  return {
    name: 'rigby-site-demos',
    // The Demos page: the full license rendered from its Markdown, and the size of each zip.
    async transformIndexHtml(html, ctx) {
      if (!ctx.filename.replace(/\\/g, '/').endsWith('/demos/index.html')) return html;
      const license = fs.readFileSync(path.join(repo, DEMO_LICENSE), 'utf8').replace(/^# .*\n/, '');
      let out = html.replace('<!--demo-license-->', renderMarkdown(license).html);
      for (const id of Object.keys(DEMOS)) out = out.replace(`{{size:${id}}}`, `${((await zipOf(id)).length / 1048576).toFixed(1)} MB`);
      return out;
    },
    async generateBundle() {
      for (const [id, demo] of Object.entries(DEMOS)) {
        this.emitFile({ type: 'asset', fileName: `demos/${id}.rigby`, source: fs.readFileSync(path.join(repo, demo.file)) });
        this.emitFile({ type: 'asset', fileName: `demos/${id}.png`, source: fs.readFileSync(path.join(repo, path.dirname(demo.file), 'thumbnail.png')) });
        this.emitFile({ type: 'asset', fileName: `demos/rigby2d-demo-${id}.zip`, source: await zipOf(id) });
      }
      this.emitFile({ type: 'asset', fileName: 'demos/DEMO-LICENSE.md', source: fs.readFileSync(path.join(repo, DEMO_LICENSE)) });
    },
  };
}

const OG = 'https://rigby2d.com/og.jpg';
const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const BRAND = { 'mark.svg': 'branding/rigby2d-mark.svg', 'icon.svg': 'branding/rigby2d-icon-dark.svg' };

/** The documentation: pages rendered from docs/*.md, served live in development and written by the build. */
function documentation() {
  let base = '/';
  return {
    name: 'rigby-docs',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!url.startsWith(`${base}docs/`)) return next();
        const rest = url.slice(`${base}docs/`.length);
        try {
          if (rest === '' || rest.endsWith('.html')) {
            const pages = await renderAll({ fresh: true });
            const page = pages.find((p) => p.slug === (rest.replace(/\.html$/, '') || 'index'));
            if (!page) return next();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(pageHtml(page, pages, { css: null, js: `${base}docs/docs.js`, mark: 'mark.svg', icon: 'icon.svg', og: OG }).replace('<link rel="stylesheet" href="null" />', ''));
          }
          if (rest === 'search.json') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(searchIndex(await renderAll())));
          }
          const file = BRAND[rest] ? path.join(repo, BRAND[rest]) : /^(images|videos)\//.test(rest) ? path.join(DOCS, rest) : null;
          if (file && fs.existsSync(file)) {
            res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
            return fs.createReadStream(file).pipe(res);
          }
        } catch (e) {
          res.statusCode = 500;
          return res.end(String(e?.stack ?? e));
        }
        next();
      });
    },
    async generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && c.name === 'docs');
      const css = [...(entry.viteMetadata?.importedCss ?? [])][0];
      const assets = { css: `../${css}`, js: `../${entry.fileName}`, mark: 'mark.svg', icon: 'icon.svg', og: OG };
      const pages = await renderAll({ fresh: true });
      for (const page of pages) this.emitFile({ type: 'asset', fileName: `docs/${page.slug}.html`, source: pageHtml(page, pages, assets) });
      this.emitFile({ type: 'asset', fileName: 'docs/search.json', source: JSON.stringify(searchIndex(pages)) });
      for (const [name, src] of Object.entries(BRAND)) this.emitFile({ type: 'asset', fileName: `docs/${name}`, source: fs.readFileSync(path.join(repo, src)) });
      for (const img of imageFiles()) this.emitFile({ type: 'asset', fileName: `docs/${img}`, source: fs.readFileSync(path.join(DOCS, img)) });
    },
  };
}

export default defineConfig({
  root: here,
  base: process.env.SITE_BASE ?? '/',
  clearScreen: false,
  plugins: [siteChrome(), comparePages(), socialImage(), documentation(), demoFiles(), starterFiles(), addonFiles(), devlogFiles()],
  // The pages import the runtime, NILA and the docs from outside this folder.
  server: { port: 1430, strictPort: true, fs: { allow: [repo] } },
  build: {
    target: 'es2021',
    outDir: path.join(repo, '_site'),
    emptyOutDir: true,
    rollupOptions: { input: { main: path.join(here, 'index.html'), demos: path.join(here, 'demos/index.html'), addons: path.join(here, 'addons/index.html'), cloud: path.join(here, 'cloud/index.html'), docs: path.join(here, 'docs/docs.js') } },
  },
});
