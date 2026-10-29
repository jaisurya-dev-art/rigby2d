// SPDX-License-Identifier: MIT OR Apache-2.0
// Packages the Godot runtime for download: the addon alone, and a demo project with the addon.
// Build the library first (cargo build --release -p rigby-godot in runtimes/rust).
// Usage: node package.mjs <platform label, e.g. windows-x64>  (writes runtimes/godot/dist/)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const { crc32 } = await import(pathToFileURL(path.join(repo, 'src/editor/zip.js')).href);
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const platform = process.argv[2] ?? 'windows-x64';
const LIBRARIES = { 'windows-x64': 'rigby_godot.dll', 'linux-x64': 'librigby_godot.so', macos: 'librigby_godot.dylib' };
const library = LIBRARIES[platform];
if (!library) throw new Error(`unknown platform ${platform}`);
const built = path.join(repo, 'runtimes/rust/target/release', library);
if (!fs.existsSync(built)) throw new Error(`build ${built} first`);

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

const read = (p) => fs.readFileSync(path.join(here, p));
const addon = [
  ...['rigby2d.gdextension', 'README.md', 'THIRD_PARTY_NOTICES.md'].map((f) => ({ path: `addons/rigby2d/${f}`, bytes: read(`addons/rigby2d/${f}`) })),
  { path: 'addons/rigby2d/LICENSE-MIT', bytes: fs.readFileSync(path.join(repo, 'LICENSE-MIT')) },
  { path: 'addons/rigby2d/LICENSE-APACHE', bytes: fs.readFileSync(path.join(repo, 'LICENSE-APACHE')) },
  { path: `addons/rigby2d/bin/${library}`, bytes: fs.readFileSync(built) },
];
const demo = [
  { path: 'project.godot', bytes: read('project.godot') },
  ...['demo/main.tscn', 'demo/main.gd', 'demo/rigbytron/rigbytron.skel', 'demo/rigbytron/rigbytron.atlas', 'demo/rigbytron/rigbytron.png'].map((f) => ({ path: f, bytes: read(f) })),
  ...['demo/scene.tscn', 'demo/scene.gd', ...fs.readdirSync(path.join(here, 'demo/scene')).filter((f) => !f.endsWith('.import')).map((f) => `demo/scene/${f}`)].map((f) => ({ path: f, bytes: read(f) })),
  {
    path: 'README.md',
    bytes: Buffer.from(
      `# Rigby2D for Godot: demo\n\nOpen this folder in Godot ${'4.3'} or newer and run it: Rigbytron holds; press Space to slash, S\nto show bones. Open \`demo/scene.tscn\` for a scene exported from the editor: NILA and\nRigbytron meet on a stage with a moving camera and parallax (the \`RigbyScene2D\` node). The addon is in \`addons/rigby2d\` (see its README).\n\nNILA, Rigbytron and the Rigby2D name and logo are trademarks of the Rigby2D project: use the\ndemo characters to try the runtime, not in your own products. The code is MIT OR Apache-2.0.\n`,
    ),
  },
  ...addon,
];
const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const [name, files] of [
  [`rigby2d-godot-addon-${version}-${platform}.zip`, addon],
  [`rigby2d-godot-demo-${version}-${platform}.zip`, demo],
]) {
  const bytes = zip(files);
  fs.writeFileSync(path.join(out, name), bytes);
  console.log(`${name}: ${files.length} files, ${(bytes.length / 1048576).toFixed(2)} MB`);
}
