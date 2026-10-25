// SPDX-License-Identifier: MIT OR Apache-2.0
// The project website (GitHub Pages, https://jaisurya-dev-art.github.io/rigby2d/): the landing page
// is built from this folder into _site/, and the browser editor into _site/editor/ (see
// package.json "site:build"). The page plays Rigbytron with the real runtime from src/core.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

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

export default defineConfig({
  root: here,
  base: process.env.SITE_BASE ?? '/rigby2d/',
  clearScreen: false,
  plugins: [socialImage()],
  // The page imports the runtime and Rigbytron from outside this folder.
  server: { port: 1430, strictPort: true, fs: { allow: [repo] } },
  build: {
    target: 'es2021',
    outDir: path.join(repo, '_site'),
    emptyOutDir: true,
  },
});
