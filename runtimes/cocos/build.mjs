// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds the Cocos Creator runtime package, in dist-cocos/:
//   rigby2d/                          the folder to copy into a Cocos project's assets/
//     rigby2d-core.ts                 the Rigby2D runtime (src/core) as one ES module (unchecked TypeScript)
//     RigbySkeleton.ts, RigbyBoneFollower.ts, rigby2d.effect (+ .meta)
//   rigby2d-cocos-<version>.zip       the same folder, zipped
// Usage: npm run build:cocos

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { version } = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const outDir = path.join(repo, 'dist-cocos');
const pkg = path.join(outDir, 'rigby2d');
const banner = `/*! Rigby2D runtime ${version} for Cocos Creator | MIT OR Apache-2.0 | https://rigby2d.com/docs/runtimes.html#cocos-creator */`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(pkg, { recursive: true });
await build({
  configFile: false,
  root: repo,
  logLevel: 'warn',
  build: {
    outDir: pkg,
    emptyOutDir: false,
    minify: true,
    lib: { entry: path.join(repo, 'src/core/index.js'), formats: ['es'], fileName: () => 'rigby2d-core.js' },
    rollupOptions: { output: { banner } },
  },
});
// Cocos treats .js assets as CommonJS; as TypeScript (unchecked) the runtime is compiled as an ES module.
const core = path.join(pkg, 'rigby2d-core.js');
fs.writeFileSync(path.join(pkg, 'rigby2d-core.ts'), `// @ts-nocheck
${fs.readFileSync(core, 'utf8')}`);
fs.rmSync(core);
for (const f of fs.readdirSync(path.join(here, 'rigby2d'))) fs.copyFileSync(path.join(here, 'rigby2d', f), path.join(pkg, f));
fs.copyFileSync(path.join(here, 'README.md'), path.join(pkg, 'README.md'));
fs.copyFileSync(path.join(here, 'README.zh-CN.md'), path.join(pkg, 'README.zh-CN.md'));

const { zip } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
const files = fs.readdirSync(pkg).map((f) => ({ path: `rigby2d/${f}`, bytes: new Uint8Array(fs.readFileSync(path.join(pkg, f))) }));
const zipName = `rigby2d-cocos-${version}.zip`;
fs.writeFileSync(path.join(outDir, zipName), zip(files));
for (const f of fs.readdirSync(pkg)) console.log(`dist-cocos/rigby2d/${f} (${(fs.statSync(path.join(pkg, f)).size / 1024).toFixed(0)} KB)`);
console.log(`dist-cocos/${zipName}`);
