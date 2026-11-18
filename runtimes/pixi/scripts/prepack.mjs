// SPDX-License-Identifier: MIT OR Apache-2.0
// Runs before `npm pack` / `npm publish` in runtimes/pixi: builds the package and puts the repository's
// license files next to package.json (they are git-ignored copies).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(here, '../..');
for (const f of ['LICENSE-MIT', 'LICENSE-APACHE']) fs.copyFileSync(path.join(repo, f), path.join(here, f));
execFileSync('npm', ['run', 'build'], { cwd: here, stdio: ['ignore', 2, 2], shell: process.platform === 'win32' });
