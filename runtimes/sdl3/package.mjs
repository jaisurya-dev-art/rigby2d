// SPDX-License-Identifier: MIT OR Apache-2.0
// Packages the SDL3 runtime for download: the SDL3 layer, the C++ animation runtime it builds on
// (in core/, from runtimes/defold/rigby2d), the example player, CMakeLists.txt and the licences.
// Usage: node package.mjs  (writes runtimes/sdl3/dist/rigby2d-sdl3-<version>.zip)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { zip } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const root = `rigby2d-sdl3-${version}`;

const file = (to, from) => ({ path: `${root}/${to}`, bytes: fs.readFileSync(from) });
const core = path.join(repo, 'runtimes/defold/rigby2d');
const files = [
  file('CMakeLists.txt', path.join(here, 'CMakeLists.txt')),
  file('README.md', path.join(here, 'README.md')),
  ...['rigby_sdl.h', 'rigby_geometry.h'].map((f) => file(`include/${f}`, path.join(here, 'include', f))),
  file('src/rigby_sdl.cpp', path.join(here, 'src/rigby_sdl.cpp')),
  file('example/main.cpp', path.join(here, 'example/main.cpp')),
  file('core/include/rigby.h', path.join(core, 'include/rigby.h')),
  ...fs
    .readdirSync(path.join(core, 'commonsrc'))
    .filter((f) => /^rigby_.*\.cpp$/.test(f))
    .sort()
    .map((f) => file(`core/commonsrc/${f}`, path.join(core, 'commonsrc', f))),
  file('LICENSE-MIT', path.join(repo, 'LICENSE-MIT')),
  file('LICENSE-APACHE', path.join(repo, 'LICENSE-APACHE')),
];
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
const out = path.join(here, 'dist', `${root}.zip`);
fs.writeFileSync(out, zip(files));
console.log(`${path.relative(repo, out)}: ${files.length} files`);
