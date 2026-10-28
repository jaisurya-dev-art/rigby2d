// SPDX-License-Identifier: MIT OR Apache-2.0
// The project website (GitHub Pages, https://jaisurya-dev-art.github.io/rigby2d/): the landing page
// is built from this folder into _site/, the documentation from docs/*.md into _site/docs/ (see
// docs/build.js), and the browser editor into _site/editor/ (see package.json "site:build"). The
// landing page plays NILA with the real runtime from src/core.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { DOCS, imageFiles, pageHtml, renderAll, searchIndex } from './docs/build.js';

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

/** The demo projects at fixed URLs (demos/<id>.rigby and .png), which the desktop app downloads. */
const DEMOS = { rigbytron: 'branding/rigbytron/rigbytron.rigby', nila: 'branding/nila/nila.rigby', scene: 'branding/scene/scene.rigby' };
function demoFiles() {
  return {
    name: 'rigby-site-demos',
    generateBundle() {
      for (const [id, file] of Object.entries(DEMOS)) {
        this.emitFile({ type: 'asset', fileName: `demos/${id}.rigby`, source: fs.readFileSync(path.join(repo, file)) });
        this.emitFile({ type: 'asset', fileName: `demos/${id}.png`, source: fs.readFileSync(path.join(repo, path.dirname(file), 'thumbnail.png')) });
      }
    },
  };
}

const OG = 'https://jaisurya-dev-art.github.io/rigby2d/og.jpg';
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
  base: process.env.SITE_BASE ?? '/rigby2d/',
  clearScreen: false,
  plugins: [socialImage(), documentation(), demoFiles()],
  // The pages import the runtime, NILA and the docs from outside this folder.
  server: { port: 1430, strictPort: true, fs: { allow: [repo] } },
  build: {
    target: 'es2021',
    outDir: path.join(repo, '_site'),
    emptyOutDir: true,
    rollupOptions: { input: { main: path.join(here, 'index.html'), docs: path.join(here, 'docs/docs.js') } },
  },
});
