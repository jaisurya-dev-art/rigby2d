// SPDX-License-Identifier: MIT OR Apache-2.0
// Records the golden data the Python tests compare against, with the JavaScript runtime: pose data
// (generate.mjs of the Rust runtime) and drawn geometry (make_render_golden.mjs). The small files are
// checked in; `--large <dir>` also records NILA and the demo scene's characters into <dir>, for
// RIGBY_GOLDEN_DIR=<dir> python3 -m unittest discover -s runtimes/renpy/tests.
// Usage: node make_golden.mjs [--large <dir>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const generate = path.join(repo, 'runtimes/rust/rigby-runtime/tests/golden/generate.mjs');
const run = (script, args) => console.log(execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' }).trim());

execFileSync('python3', [path.join(here, 'make_fixtures.py'), path.join(here, 'fixtures')], { stdio: 'inherit' });
const golden = path.join(here, 'golden');
fs.mkdirSync(golden, { recursive: true });
const small = [
  'runtimes/renpy/tests/fixtures/kitchen-sink-42.json',
  'runtimes/renpy/tests/fixtures/kitchen-sink-43.json',
  'runtimes/renpy/tests/fixtures/kitchen-sink-38.json',
  'branding/rigbytron/export/rigbytron.json',
  'test/fixtures/turn-rig.json',
  'test/fixtures/ik-stretch.json',
  'runtimes/godot/demo/scene/scene.json',
];
for (const f of small) run(generate, [path.join(golden, `${path.basename(f, '.json')}.golden.json`), f]);
const atlas = 'runtimes/renpy/tests/fixtures/kitchen-sink.atlas';
for (const v of ['42', '43', '38']) run(path.join(here, 'make_render_golden.mjs'), [path.join(golden, `kitchen-sink-${v}.render.json`), `runtimes/renpy/tests/fixtures/kitchen-sink-${v}.json`, atlas, 'walk']);
run(path.join(here, 'make_render_golden.mjs'), [path.join(golden, 'kitchen-sink-42-wave.render.json'), 'runtimes/renpy/tests/fixtures/kitchen-sink-42.json', atlas, 'wave']);
run(path.join(here, 'make_render_golden.mjs'), [path.join(golden, 'rigbytron.render.json'), 'branding/rigbytron/export/rigbytron.json', 'branding/rigbytron/export/rigbytron.atlas', 'hold']);

const large = process.argv.indexOf('--large');
if (large >= 0) {
  const dir = path.resolve(process.argv[large + 1] ?? '/tmp/rigby-golden');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['branding/nila/export/nila.json', 'runtimes/godot/demo/scene/scene.nila.json', 'runtimes/godot/demo/scene/scene.rigbytron.json']) {
    run(generate, [path.join(dir, `${path.basename(f, '.json')}.golden.json`), f]);
  }
  run(path.join(here, 'make_render_golden.mjs'), [path.join(dir, 'nila.render.json'), 'branding/nila/export/nila.json', 'branding/nila/export/nila.atlas', 'wave']);
}
