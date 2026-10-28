// SPDX-License-Identifier: MIT OR Apache-2.0
// The project website (GitHub Pages, https://jaisurya-dev-art.github.io/rigby2d/): the landing page
// is built from this folder into _site/, the documentation from docs/*.md into _site/docs/ (see
// docs/build.js), and the browser editor into _site/editor/ (see package.json "site:build"). The
// landing page plays NILA with the real runtime from src/core.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

import { DOCS, imageFiles, pageHtml, renderAll, renderMarkdown, searchIndex } from './docs/build.js';

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
  *File ▸ Open demo…*. The editor runs in your browser too: https://jaisurya-dev-art.github.io/rigby2d/editor/
- \`export/\`: the same content exported for games (${exported.join(', ')}), ready for the
  JavaScript, Rust and Godot runtimes: https://jaisurya-dev-art.github.io/rigby2d/docs/runtimes.html
- \`thumbnail.png\`: a preview.
- \`LICENSE.md\`: the Rigby2D Demo Content License.

## License

This demo is © Hoverlabs and is **not** open source. You may open, study and modify it to learn
Rigby2D, use it to evaluate Rigby2D and its runtimes, and show it in tutorials, reviews and videos
with the credit *"${demo.credit} © Hoverlabs, from the Rigby2D demo projects."* You may not use it in your
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
    rollupOptions: { input: { main: path.join(here, 'index.html'), demos: path.join(here, 'demos/index.html'), docs: path.join(here, 'docs/docs.js') } },
  },
});
