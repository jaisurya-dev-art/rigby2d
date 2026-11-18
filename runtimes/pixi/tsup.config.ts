// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds @rigby2d/pixi-js (run `npm run build` in this folder, or `npm run build:pixi:npm` in the
// repository root): an ES module and its type declarations in dist/.
//   - The shared JavaScript core (../../src/core) is bundled in; nothing else is imported.
//   - pixi.js is external and a peer dependency. The runtime never imports it: rigbyPixi(PIXI)
//     takes the namespace the game already loads, so the bundle has no bare imports and works
//     from a CDN as it is.
import fs from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: { index: 'rigby-pixi.ts' },
  format: ['esm'],
  target: 'es2020',
  platform: 'browser',
  dts: true,
  clean: true,
  minify: false,
  treeshake: true,
  bundle: true,
  skipNodeModulesBundle: false,
  external: ['pixi.js'],
  banner: { js: `/*! @rigby2d/pixi-js ${version} | MIT OR Apache-2.0 | https://rigby2d.com/docs/runtimes.html#pixijs */` },
});
