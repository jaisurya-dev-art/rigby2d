// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds the Rigby2D MCP Bundle (.mcpb): a one-file, double-click install of the MCP server for
// Claude Desktop, which brings its own Node.js. The server's files are found by following its
// imports from src/mcp/server.js, so the bundle holds exactly what the server uses, plus Pyodide
// (Python scripts) and ag-psd (PSD files). Output: dist-mcpb/Rigby2D-AI-<version>.mcpb and
// dist-mcpb/Rigby2D-AI.mcpb (the same file under a fixed name, for "latest" download links).
//
//   node mcpb/build.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(repo, 'build', 'mcpb');
const out = path.join(repo, 'dist-mcpb');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));

// ---- the server's own files: follow its relative imports -----------------------------------

function sourceFiles(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    const specs = [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      const target = path.resolve(path.dirname(file), spec);
      if (fs.existsSync(target)) visit(target);
    }
    // Files read at run time next to the code (new URL('…', import.meta.url)).
    for (const m of text.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+\.(?:py|json))['"]\s*,\s*import\.meta\.url\s*\)/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (fs.existsSync(target) && !target.endsWith('package.json')) seen.add(target);
    }
  };
  visit(entry);
  return [...seen];
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to, keep = () => true) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, keep);
    else if (keep(a)) copy(a, b);
  }
}

fs.rmSync(stage, { recursive: true, force: true });
const server = path.join(stage, 'server');
const files = sourceFiles(path.join(repo, 'src', 'mcp', 'server.js'));
for (const f of files) copy(f, path.join(server, path.relative(repo, f)));
// server.js reads its version from ../../package.json.
fs.writeFileSync(path.join(server, 'package.json'), JSON.stringify({ name: 'rigby2d-mcp', version: pkg.version, private: true, type: 'module' }, null, 2));

// ---- dependencies: Pyodide (run_script) and ag-psd (PSD files) -----------------------------

const nm = path.join(repo, 'node_modules');
const PYODIDE = ['package.json', 'pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'LICENSE'];
for (const f of PYODIDE) if (fs.existsSync(path.join(nm, 'pyodide', f))) copy(path.join(nm, 'pyodide', f), path.join(server, 'node_modules', 'pyodide', f));
// Only what Node loads: package.json, the licence, the main file and the built code (dist/, lib/).
// Sources, typings, maps, dev scripts and caches (.v8-cache) stay out.
for (const dep of ['ag-psd', 'base64-js', 'pako']) {
  const from = path.join(nm, dep);
  const main = path.normalize(JSON.parse(fs.readFileSync(path.join(from, 'package.json'), 'utf8')).main ?? 'index.js');
  copyDir(from, path.join(server, 'node_modules', dep), (f) => {
    const rel = path.relative(from, f);
    if (/\.(ts|map)$/.test(rel)) return false;
    return rel === 'package.json' || /^LICEN[SC]E/i.test(rel) || rel === main || /^(dist|lib)[\\/]/.test(rel);
  });
}

// ---- manifest, icon, notices ---------------------------------------------------------------

copy(path.join(repo, 'src-tauri', 'icons', 'icon.png'), path.join(stage, 'icon.png'));
copy(path.join(repo, 'LICENSE-MIT'), path.join(stage, 'LICENSE-MIT'));
copy(path.join(repo, 'LICENSE-APACHE'), path.join(stage, 'LICENSE-APACHE'));
copy(path.join(repo, 'THIRD_PARTY_NOTICES.md'), path.join(stage, 'THIRD_PARTY_NOTICES.md'));

// The tool list shown on the install screen, read from the server itself.
const listed = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { Workspace, createTools } = await import(${JSON.stringify(new URL('../src/mcp/tools.js', import.meta.url).href)});
    const { createEditTools } = await import(${JSON.stringify(new URL('../src/mcp/edits.js', import.meta.url).href)});
    const { createFilmTools } = await import(${JSON.stringify(new URL('../src/mcp/film.js', import.meta.url).href)});
    const { createRiggingTools } = await import(${JSON.stringify(new URL('../src/mcp/rigging.js', import.meta.url).href)});
    const { createScriptTools } = await import(${JSON.stringify(new URL('../src/mcp/scripting.js', import.meta.url).href)});
    const { createSceneTools } = await import(${JSON.stringify(new URL('../src/mcp/scene.js', import.meta.url).href)});
    const ws = await Workspace.open([process.cwd()]);
    const all = [...createTools(ws), ...createEditTools(ws), ...createFilmTools(ws), ...createRiggingTools(ws), ...createSceneTools(ws), ...createScriptTools(ws)];
    process.stdout.write(JSON.stringify(all.map((t) => ({ name: t.name, description: t.description.split('. ')[0].replace(/\\.$/, '') + '.' }))));
  `], { cwd: repo, encoding: 'utf8' }),
);

const entry = 'server/src/mcp/server.js';
const manifest = {
  manifest_version: '0.3',
  name: 'rigby2d',
  display_name: 'Rigby2D',
  version: pkg.version,
  description: 'Let Claude open, rig, animate, check and convert your Rigby2D 2D animation projects.',
  long_description:
    'Connects Claude to your Rigby2D projects (.rigby work files and skeleton .json / .skel exports). Ask Claude to explain a rig, find missing images, add bones and animations, set eased keys, rig a layered PSD with AutoRig, reuse animations on other characters, set up film output, poses, face controls and lip-sync, or run Python scripts. Claude only reads and writes files inside the project folders you choose here.',
  author: { name: 'Rigby2D', url: 'https://github.com/jaisurya-dev-art/rigby2d' },
  homepage: 'https://github.com/jaisurya-dev-art/rigby2d',
  documentation: 'https://github.com/jaisurya-dev-art/rigby2d/blob/main/docs/mcp.md',
  support: 'https://github.com/jaisurya-dev-art/rigby2d/issues',
  repository: { type: 'git', url: 'https://github.com/jaisurya-dev-art/rigby2d' },
  icon: 'icon.png',
  license: 'MIT OR Apache-2.0',
  keywords: ['animation', '2d', 'skeletal', 'rigging', 'game', 'film', 'rigby2d'],
  server: {
    type: 'node',
    entry_point: entry,
    mcp_config: {
      command: 'node',
      args: [`\${__dirname}/${entry}`, '${user_config.project_folders}'],
    },
  },
  tools: listed,
  user_config: {
    project_folders: {
      type: 'directory',
      title: 'Project folders',
      description: 'The folders with your Rigby2D projects. Claude can only open and change files inside them.',
      multiple: true,
      required: true,
      default: ['${DOCUMENTS}'],
    },
  },
  compatibility: { platforms: ['win32', 'darwin'], runtimes: { node: '>=20.0.0' } },
};
fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// ---- validate and pack ----------------------------------------------------------------------

const mcpb = path.join(nm, '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
const run = (args) => execFileSync(process.execPath, [mcpb, ...args], { cwd: repo, stdio: 'inherit' });
run(['validate', path.join(stage, 'manifest.json')]);
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `Rigby2D-AI-${pkg.version}.mcpb`);
fs.rmSync(file, { force: true });
run(['pack', stage, file]);
fs.copyFileSync(file, path.join(out, 'Rigby2D-AI.mcpb'));
console.log(`\n${path.relative(repo, file)}: ${(fs.statSync(file).size / 1048576).toFixed(1)} MB, ${files.length} server files, ${listed.length} tools`);
