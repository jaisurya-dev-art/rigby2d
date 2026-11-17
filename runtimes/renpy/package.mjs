// SPDX-License-Identifier: MIT OR Apache-2.0
// Packages the Ren'Py runtime for download: the runtime alone (drop into a game's `game/` folder),
// and the demo game with the runtime. `node package.mjs sync` instead copies the runtime into
// demo/game, to open the demo from the Ren'Py launcher without packaging.
// Usage: node package.mjs [sync]  (writes runtimes/renpy/dist/)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { crc32 } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

/** Files under `dir` (relative paths, sorted), skipping caches and compiled files. */
function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__pycache__' || e.name === 'cache' || e.name === 'saves' || e.name.endsWith('.rpyc') || e.name.endsWith('.pyc')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

const runtimeFiles = () => [
  ...walk(path.join(here, 'game/rigby2d')).map((f) => ({ path: `game/rigby2d/${f}`, bytes: fs.readFileSync(path.join(here, 'game/rigby2d', f)) })),
  { path: 'game/rigby2d.rpy', bytes: fs.readFileSync(path.join(here, 'game/rigby2d.rpy')) },
];

if (process.argv[2] === 'sync') {
  for (const f of runtimeFiles()) {
    const target = path.join(here, 'demo', f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.bytes);
  }
  console.log('Copied the runtime into demo/game.');
  process.exit(0);
}

/** ZIP with deflate-compressed entries: [{ path, bytes }]. */
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const data = zlib.deflateRawSync(f.bytes, { level: 9 });
    const crc = crc32(f.bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(f.bytes.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(f.bytes.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

const licenses = [
  { path: 'LICENSE-MIT', bytes: fs.readFileSync(path.join(repo, 'LICENSE-MIT')) },
  { path: 'LICENSE-APACHE', bytes: fs.readFileSync(path.join(repo, 'LICENSE-APACHE')) },
];
const runtime = [...runtimeFiles(), { path: 'README.md', bytes: fs.readFileSync(path.join(here, 'README.md')) }, ...licenses];

const root = `rigby2d-renpy-demo-${version}`;
const demoGame = walk(path.join(here, 'demo/game')).filter((f) => !f.startsWith('rigby2d/') && f !== 'rigby2d.rpy');
const demo = [
  ...demoGame.map((f) => {
    let bytes = fs.readFileSync(path.join(here, 'demo/game', f));
    // The demo's version is the release's (the repository keeps "dev").
    if (f === 'options.rpy') bytes = Buffer.from(bytes.toString('utf8').replace(/define config\.version = "[^"]*"/, `define config.version = "${version}"`));
    return { path: `${root}/game/${f}`, bytes };
  }),
  ...runtimeFiles().map((f) => ({ ...f, path: `${root}/${f.path}` })),
  {
    path: `${root}/README.md`,
    bytes: Buffer.from(
      `# Rigby2D for Ren'Py: demo\n\nAdd the folder holding this one as a projects directory in the Ren'Py launcher (8.3 or newer),\nthen launch "${root}". NILA talks with her voice lines (lip-synced), changes expressions,\nwaves, blinks and follows the mouse; Rigbytron joins her. See game/script.rpy, and the guide in\nREADME-runtime.md.\n\nNILA, Rigbytron and the Rigby2D name and logo are trademarks of the Rigby2D project: use the\ndemo characters to try the runtime, not in your own products (see LICENSE-DEMO.md). The code is MIT OR Apache-2.0.\n`,
    ),
  },
  { path: `${root}/README-runtime.md`, bytes: fs.readFileSync(path.join(here, 'README.md')) },
  ...licenses.map((f) => ({ ...f, path: `${root}/${f.path}` })),
  // NILA and Rigbytron are demo content, not open source: every demo download carries their licence.
  { path: `${root}/LICENSE-DEMO.md`, bytes: fs.readFileSync(path.join(repo, 'branding/DEMO-LICENSE.md')) },
];

const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const [name, files] of [
  [`rigby2d-renpy-${version}.zip`, runtime],
  [`rigby2d-renpy-demo-${version}.zip`, demo],
]) {
  const bytes = zip(files);
  fs.writeFileSync(path.join(out, name), bytes);
  console.log(`${name}: ${files.length} files, ${(bytes.length / 1048576).toFixed(2)} MB`);
}
