// SPDX-License-Identifier: MIT OR Apache-2.0
// Packages the Defold runtime for download: the library (a Defold dependency zip: game.project
// with [library] include_dirs, and the rigby2d folder) and the demo project with the library.
// The library zip has no version in its name so releases/latest/download/rigby2d-defold.zip works.
// Usage: node package.mjs  (writes runtimes/defold/dist/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { zip } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

/** Files under `dir` (relative to this folder), as zip entries. */
function tree(dir) {
  return fs
    .readdirSync(path.join(here, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(here, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort()
    .map((p) => ({ path: p, bytes: fs.readFileSync(path.join(here, p)) }));
}

const licenses = ['LICENSE-MIT', 'LICENSE-APACHE'].map((f) => ({ path: `rigby2d/${f}`, bytes: fs.readFileSync(path.join(repo, f)) }));
const library = [
  { path: 'game.project', bytes: Buffer.from(`[project]\ntitle = Rigby2D\n\n[library]\ninclude_dirs = rigby2d\n`) },
  { path: 'rigby2d/README.md', bytes: fs.readFileSync(path.join(here, 'README.md')) },
  ...tree('rigby2d'),
  ...licenses,
];
const demo = [
  { path: 'game.project', bytes: fs.readFileSync(path.join(here, 'game.project')) },
  { path: 'README.md', bytes: fs.readFileSync(path.join(here, 'README.md')) },
  ...tree('main'),
  ...tree('input'),
  ...tree('assets'),
  ...tree('rigby2d'),
  ...licenses,
];
/** Adds an entry for every folder: Defold finds native extensions in a dependency zip only then. */
function withFolders(files) {
  const folders = new Set();
  for (const f of files) {
    for (let d = path.posix.dirname(f.path); d !== '.' && !folders.has(d); d = path.posix.dirname(d)) folders.add(d);
  }
  return [...[...folders].sort().map((d) => ({ path: `${d}/`, bytes: new Uint8Array(0) })), ...files];
}

const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const [name, files] of [
  ['rigby2d-defold.zip', library],
  [`rigby2d-defold-demo-${version}.zip`, demo],
]) {
  const bytes = zip(withFolders(files));
  fs.writeFileSync(path.join(out, name), bytes);
  console.log(`${name}: ${files.length} files, ${(bytes.length / 1048576).toFixed(2)} MB`);
}
