// SPDX-License-Identifier: MIT OR Apache-2.0
// Bundles the PixiJS runtime (rigby-pixi.js with the JavaScript runtime; PixiJS itself stays outside) into
// single files for games, in dist-pixi/:
//   rigby2d-pixi-<version>.mjs     ES module:   import { rigbyPixi } from './rigby2d-pixi-<version>.mjs'
//   rigby2d-pixi-<version>.js      script tag:  <script src="rigby2d-pixi-<version>.js"> -> window.RigbyPixi.rigbyPixi(PIXI)
// Usage: npm run build:pixi

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { version } = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const outDir = path.join(repo, 'dist-pixi');
const banner = `/*! Rigby2D for PixiJS ${version} | MIT OR Apache-2.0 | https://rigby2d.com/docs/runtimes.html#pixijs */`;

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
      lib: { entry: path.join(here, 'rigby-pixi.js'), name: 'RigbyPixi', formats: [format], fileName: () => `rigby2d-pixi-${version}.${ext}` },
      rollupOptions: { output: { banner } },
    },
  });
}
for (const f of fs.readdirSync(outDir)) console.log(`dist-pixi/${f} (${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)} KB)`);
