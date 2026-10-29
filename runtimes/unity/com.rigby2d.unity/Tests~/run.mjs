// SPDX-License-Identifier: MIT OR Apache-2.0
// Builds the C# runtime core (Runtime/Core) with the golden tests and runs them, using the C#
// compiler and .NET runtime that ship with Unity (no .NET SDK needed). Exits non-zero on failure.
//   node runtimes/unity/com.rigby2d.unity/Tests~/run.mjs [path to the Unity Editor's Data folder]
// The Data folder defaults to $UNITY_EDITOR_DATA, else the newest Unity in the Hub's default path.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '../../..');

const bench = process.argv.indexOf('--bench');
const benchArgs = bench >= 0 ? process.argv.slice(bench, bench + 3).map((a, i) => (i ? path.resolve(a) : a)) : null;

function unityData() {
  if (process.argv[2] && !process.argv[2].startsWith('--')) return process.argv[2];
  if (process.env.UNITY_EDITOR_DATA) return process.env.UNITY_EDITOR_DATA;
  const hubs = ['C:/Program Files/Unity/Hub/Editor', '/Applications/Unity/Hub/Editor', path.join(os.homedir(), 'Unity/Hub/Editor')];
  for (const hub of hubs) {
    if (!fs.existsSync(hub)) continue;
    const versions = fs.readdirSync(hub).sort().reverse();
    for (const v of versions) {
      for (const data of [path.join(hub, v, 'Editor/Data'), path.join(hub, v, 'Unity.app/Contents')]) if (fs.existsSync(path.join(data, 'DotNetSdkRoslyn'))) return data;
    }
  }
  return null;
}

// Unity's bundled compiler and runtime, else the .NET SDK on the PATH (as on CI machines).
function toolchain() {
  const data = unityData();
  if (data) return { dotnet: path.join(data, 'NetCoreRuntime', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'), csc: path.join(data, 'DotNetSdkRoslyn/csc.dll'), shared: path.join(data, 'NetCoreRuntime/shared/Microsoft.NETCore.App') };
  const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['dotnet'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  const root = path.dirname(fs.realpathSync(which));
  const sdk = fs.readdirSync(path.join(root, 'sdk')).filter((v) => /^\d/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  if (!sdk) throw new Error('neither Unity nor the .NET SDK was found');
  return { dotnet: which, csc: path.join(root, 'sdk', sdk, 'Roslyn/bincore/csc.dll'), shared: path.join(root, 'shared/Microsoft.NETCore.App') };
}

const { dotnet, csc, shared } = toolchain();
const version = fs.readdirSync(shared).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const refs = fs.readdirSync(path.join(shared, version)).filter((f) => /^(System|Microsoft|netstandard|mscorlib).*\.dll$/.test(f) && !f.includes('Native'));

const out = path.join(os.tmpdir(), 'rigby2d-cs-golden');
fs.mkdirSync(out, { recursive: true });
const sources = [...fs.readdirSync(path.join(pkg, 'Runtime/Core')).filter((f) => f.endsWith('.cs')).map((f) => path.join(pkg, 'Runtime/Core', f)), path.join(here, 'Golden/GoldenTests.cs'), path.join(here, 'Golden/Bench.cs')];
const dll = path.join(out, 'golden.dll');
execFileSync(dotnet, [csc, '-nologo', '-optimize+', '-nullable-', '-langversion:9', `-out:${dll}`, '-target:exe', ...refs.map((r) => `-r:${path.join(shared, version, r)}`), ...sources], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'golden.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: `net${version.split('.').slice(0, 2).join('.')}`, framework: { name: 'Microsoft.NETCore.App', version } } }));
const t0 = Date.now();
try {
  execFileSync(dotnet, benchArgs ? [dll, ...benchArgs] : [dll, repo], { stdio: 'inherit' });
} catch {
  process.exit(1);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
