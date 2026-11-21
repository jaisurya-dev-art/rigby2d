// SPDX-License-Identifier: MIT OR Apache-2.0
// Checks the package as it would be published (`npm run verify`; the pack runs prepack, which builds it):
//  - `npm pack --dry-run` lists only the files the runtime needs;
//  - pixi.js is a peer dependency, and neither a dependency nor imported by the bundle (so a CDN
//    has nothing to resolve: the bundle has no import or require of anything);
//  - the bundle loads and runs with the PixiJS namespace passed in;
//  - the declarations import only pixi.js and their own files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: here, encoding: 'utf8', shell: process.platform === 'win32' });
const files = JSON.parse(out)[0].files.map((f) => f.path).sort();
const expected = ['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json'];
assert.deepEqual(files, expected, `package files: ${files.join(', ')}`);

assert.equal(pkg.name, '@rigby2d/pixi-js');
assert.ok(pkg.peerDependencies?.['pixi.js'], 'pixi.js must be a peer dependency');
assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
assert.equal(pkg.peerDependenciesMeta?.['pixi.js']?.optional, undefined);

const js = fs.readFileSync(path.join(here, 'dist/index.js'), 'utf8');
const imports = [...js.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/gm)];
assert.deepEqual(imports.map((m) => m[1] ?? m[2] ?? m[3]), [], 'the bundle must not import anything');
assert.ok(!/from\s*['"]pixi\.js['"]/.test(js), 'pixi.js must stay out of the bundle');

const dts = fs.readFileSync(path.join(here, 'dist/index.d.ts'), 'utf8');
const specs = [...dts.matchAll(/from\s*['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g)].map((m) => m[1] ?? m[2]);
assert.ok(specs.every((s) => s === 'pixi.js'), `declarations import only pixi.js: ${specs.join(', ')}`);

// PixiJS probes the user agent during import, and Node 20 has no navigator.
globalThis.navigator ??= { userAgent: '' };
const PIXI = await import('pixi.js');
const { rigbyPixi } = await import(pathToFileURL(path.join(here, 'dist/index.js')).href);
assert.deepEqual(Object.keys(rigbyPixi(PIXI)).sort(), ['RigbyData', 'RigbySkeleton', 'loadRigby', 'parseRigby']);

console.log(`${pkg.name}@${pkg.version}: ${files.length} files, no imports in the bundle, pixi.js peer dependency: OK`);
