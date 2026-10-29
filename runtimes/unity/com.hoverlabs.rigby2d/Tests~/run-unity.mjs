// SPDX-License-Identifier: MIT OR Apache-2.0
// Runs the Unity integration check (Integration/RigbyUnityCheck.cs) in a Unity project: adds this
// package (by path) and the demo exports, imports them, plays and renders them, measures a crowd.
//   node runtimes/unity/com.hoverlabs.rigby2d/Tests~/run-unity.mjs <unity project> [Unity executable]
// Create the project once with: Unity -batchmode -quit -createProject <unity project>
// Renders and rigby-check.json go to <unity project>/CheckOutput.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '../../..');
const [project, unityArg] = process.argv.slice(2);
if (!project) throw new Error('usage: run-unity.mjs <unity project> [Unity executable]');

function unityExe() {
  if (unityArg) return unityArg;
  if (process.env.UNITY_EDITOR) return process.env.UNITY_EDITOR;
  const hub = 'C:/Program Files/Unity/Hub/Editor';
  const v = fs.existsSync(hub) ? fs.readdirSync(hub).sort().reverse()[0] : null;
  if (v) return path.join(hub, v, 'Editor/Unity.exe');
  throw new Error('pass the Unity executable or set UNITY_EDITOR');
}

// The package, by path.
const manifestPath = path.join(project, 'Packages/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.dependencies['com.hoverlabs.rigby2d'] = `file:${pkg.split(path.sep).join('/')}`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Demo exports (demo content (c) Hoverlabs; see branding/DEMO-LICENSE.md).
const copy = (from, to, filter = () => true) => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const src = path.join(from, f);
    if (fs.statSync(src).isFile() && filter(f)) fs.copyFileSync(src, path.join(to, f));
  }
};
const assets = path.join(project, 'Assets');
copy(path.join(repo, 'branding/rigbytron/export'), path.join(assets, 'Rigbytron'), (f) => !f.endsWith('.json'));
copy(path.join(repo, 'branding/nila/export'), path.join(assets, 'Nila'), (f) => !f.endsWith('.json'));
copy(path.join(repo, 'runtimes/godot/demo/scene'), path.join(assets, 'Scene'), (f) => !f.endsWith('.import'));
copy(path.join(here, 'Integration'), path.join(assets, 'Editor'));

// --make-sample: build Samples~/Demo (Rigbytron, a demo scene and its controller) with Unity's .meta files.
if (process.argv.includes('--make-sample')) {
  const demo = path.join(assets, 'Rigby2D Demo');
  fs.rmSync(demo, { recursive: true, force: true });
  copy(path.join(repo, 'branding/rigbytron/export'), demo, (f) => /\.(skel|atlas|png)$/.test(f));
  fs.copyFileSync(path.join(repo, 'branding/DEMO-LICENSE.md'), path.join(demo, 'LICENSE.md'));
  fs.copyFileSync(path.join(here, 'Tools/RigbyDemoController.cs'), path.join(demo, 'RigbyDemoController.cs'));
  fs.copyFileSync(path.join(here, 'Tools/RigbyMakeSample.cs'), path.join(assets, 'Editor/RigbyMakeSample.cs'));
  const log = path.join(project, 'rigby-sample.log');
  const r = spawnSync(unityExe(), ['-batchmode', '-projectPath', project, '-executeMethod', 'RigbyMakeSample.Run', '-logFile', log], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log(fs.readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => /error|rigby-sample/.test(l)).join('\n'));
    process.exit(1);
  }
  const target = path.join(pkg, 'Samples~/Demo');
  fs.rmSync(target, { recursive: true, force: true });
  copy(demo, target);
  console.log(`sample written to ${target}: ${fs.readdirSync(target).join(', ')}`);
  process.exit(0);
}

const out = path.join(project, 'CheckOutput');
fs.rmSync(out, { recursive: true, force: true });
const log = path.join(project, 'rigby-check.log');
// Release code optimization: Unity's default Debug mode makes timings meaningless.
const r = spawnSync(unityExe(), ['-batchmode', '-releaseCodeOptimization', '-projectPath', project, '-executeMethod', 'RigbyUnityCheck.Run', '-logFile', log], {
  stdio: 'inherit',
  env: { ...process.env, RIGBY_CHECK_OUT: out },
});
const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/) : [];
for (const l of lines) if (l.includes('[rigby-check]') || /error CS\d+|Rigby2D:/.test(l)) console.log(l);
const result = path.join(out, 'rigby-check.json');
if (fs.existsSync(result)) console.log(fs.readFileSync(result, 'utf8'));
process.exit(r.status ?? 1);
