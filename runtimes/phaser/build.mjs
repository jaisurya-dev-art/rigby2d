// SPDX-License-Identifier: MIT OR Apache-2.0
// Bundles the Phaser runtime (rigby-phaser.js with the JavaScript runtime and WebGL renderer) into
// single files for games, in dist-phaser/:
//   rigby2d-phaser-<version>.mjs   ES module:   import { rigbyPhaser } from './rigby2d-phaser-<version>.mjs'
//   rigby2d-phaser-<version>.js    script tag:  <script src="rigby2d-phaser-<version>.js"> -> window.RigbyPhaser.rigbyPhaser
// Usage: npm run build:phaser

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { version } = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const outDir = path.join(repo, 'dist-phaser');
const banner = `/*! Rigby2D for Phaser ${version} | MIT OR Apache-2.0 | https://rigby2d.com/docs/runtimes.html#phaser */`;

fs.rmSync(outDir, { recursive: true, force: true });
for (const [format, ext] of [
  ['es', 'mjs'],
  ['iife', 'js'],
]) {
  await build({
    configFile: false,
    root: repo,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      minify: true,
      lib: { entry: path.join(here, 'rigby-phaser.js'), name: 'RigbyPhaser', formats: [format], fileName: () => `rigby2d-phaser-${version}.${ext}` },
      rollupOptions: { output: { banner } },
    },
  });
}
for (const f of fs.readdirSync(outDir)) console.log(`dist-phaser/${f} (${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)} KB)`);
