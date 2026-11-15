// SPDX-License-Identifier: MIT OR Apache-2.0
// The `rigby` command-line tool: argument parsing, render planning, and the commands that do not
// need a browser, on the bundled Rigbytron project and test fixtures.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { writePsd } from 'ag-psd';

import { UsageError, convertValue, parseArgs, toolArguments } from '../src/cli/args.js';
import { COMMANDS, VERSION, formatText, main } from '../src/cli/main.js';
import { APP_RENDER_VERSION, GPU_ARGS, appArgs, appCandidates, appReporter, chooseEngine, compareVersions, ffmpegArgs, findApp, parseColor, planJobs } from '../src/cli/render.js';
import { RENDER_OPTIONS, jobTarget } from '../src/editor/render/plan.js';
import { parseAtlas } from '../src/core/atlas.js';
import { unzip } from '../src/editor/zip.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '../..');
const RIGBY = path.join(REPO, 'branding/rigbytron/rigbytron.rigby');
const TURN = path.join(REPO, 'test/fixtures/turn-rig.json');

/** Runs the CLI in-process: { code, out, err, json (parsed stdout when --json) }. */
async function rigby(...argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) });
  let json;
  if (argv.includes('--json')) json = JSON.parse(out);
  return { code, out, err, json };
}

const tmpDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'rigby-cli-'));
const exists = (f) => fs.stat(f).then(() => true, () => false);

// ---- argument parsing -------------------------------------------------------------------------

test('cli args: positionals, typed options, short names, = values, lists and --no-', () => {
  const spec = {
    positionals: ['input', 'output?'],
    options: {
      version: { type: 'string', short: 'V', choices: ['3.8', '4.2', '4.3'] },
      time: { type: 'number', short: 't' },
      padding: { type: 'integer' },
      trim: { type: 'boolean' },
      animation: { type: 'list', short: 'a' },
      'dry-run': { type: 'boolean' },
      quality: { type: 'string', default: 'high' },
    },
  };
  const r = parseArgs(['in.rigby', '-V', '4.2', '--time=0.5', '--padding', '3', '--no-trim', '-a', 'walk,run', '--animation', 'idle', '--dry-run'], spec);
  assert.deepEqual(r.positionals, { input: 'in.rigby' });
  assert.deepEqual(r.options, { version: '4.2', time: 0.5, padding: 3, trim: false, animation: ['walk', 'run', 'idle'], dryRun: true, quality: 'high' });
  // Negative numbers are values, and -- ends the options.
  assert.equal(parseArgs(['a', '--time', '-2'], spec).options.time, -2);
  assert.deepEqual(parseArgs(['--', '--weird', 'b'], spec).positionals, { input: '--weird', output: 'b' });
  assert.equal(parseArgs(['a', '--trim=false'], spec).options.trim, false);
});

test('cli args: mistakes are usage errors with clear messages', () => {
  const spec = { positionals: ['project'], options: { time: { type: 'number' }, padding: { type: 'integer' }, format: { type: 'string', choices: ['json', 'skel'] } } };
  const fails = (argv, pattern) => assert.throws(() => parseArgs(argv, spec), (e) => e instanceof UsageError && pattern.test(e.message));
  fails([], /missing <project>/);
  fails(['a', 'b'], /unexpected argument 'b'/);
  fails(['a', '--bogus'], /unknown option '--bogus'/);
  fails(['a', '-z'], /unknown option '-z'/);
  fails(['a', '--time'], /--time needs a value/);
  fails(['a', '--time', 'soon'], /--time needs a number/);
  fails(['a', '--padding', '1.5'], /whole number/);
  fails(['a', '--format', 'xml'], /one of json, skel/);
  assert.throws(() => convertValue('x', 'json', '{nope'), /needs JSON/);
});

test('cli args: passthrough options become tool arguments', () => {
  const r = parseArgs(['add_bone', '--path', 'a.rigby', '--x', '10', '--flip', '--parent-name', 'root', '--keys', '[1,2]'], { positionals: ['tool'], passthrough: true });
  assert.deepEqual(r.positionals, { tool: 'add_bone' });
  assert.deepEqual(toolArguments(r.extra), { path: 'a.rigby', x: 10, flip: true, parent_name: 'root', keys: [1, 2] });
});

// ---- help and errors --------------------------------------------------------------------------

test('cli: help, version, unknown commands and exit codes', async () => {
  const help = await rigby('--help');
  assert.equal(help.code, 0);
  for (const name of Object.keys(COMMANDS)) assert.match(help.out, new RegExp(`\\b${name}\\b`));
  assert.equal((await rigby()).code, 0);
  assert.equal((await rigby('--version')).out.trim(), VERSION);
  // Every command has its own help.
  for (const name of Object.keys(COMMANDS)) {
    const r = await rigby(name, '--help');
    assert.equal(r.code, 0, name);
    assert.match(r.out, /^Usage: rigby /, name);
  }
  assert.match((await rigby('help', 'render')).out, /h264_nvenc/);
  assert.match((await rigby('call', 'add_bone', '--help')).out, /--name <string> \(required\)/);

  const unknown = await rigby('frobnicate');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown command 'frobnicate'/);
  const usage = await rigby('inspect');
  assert.equal(usage.code, 2);
  assert.match(usage.err, /missing <project>[\s\S]*usage: rigby inspect/);
  const missing = await rigby('inspect', 'no/such/file.rigby', '--json');
  assert.equal(missing.code, 1);
  assert.match(missing.json.error, /File not found/);
});

test('cli: bin/rigby.js runs as a program', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin/rigby.js'), 'inspect', RIGBY, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).name, 'rigbytron');
  const bad = spawnSync(process.execPath, [path.join(REPO, 'bin/rigby.js'), 'validate'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

// ---- reading ----------------------------------------------------------------------------------

test('cli: inspect, rig, animation, pose and validate', async () => {
  const inspect = await rigby('inspect', RIGBY, '--json');
  assert.equal(inspect.code, 0);
  assert.equal(inspect.json.format, 'rigby');
  assert.deepEqual(inspect.json.animations.map((a) => a.name), ['hold', 'release']);
  assert.match((await rigby('inspect', TURN)).out, /turn-rig {2}\(json 4\.3[\s\S]*head-turn \(slider\)/);

  const rig = await rigby('rig', RIGBY);
  assert.match(rig.out, /bones \(11\):\n {2}root[\s\S]*\n {4}hip/);
  const anim = await rigby('animation', RIGBY, 'release', '--json');
  assert.equal(anim.json.duration, 1.6);
  assert.equal((await rigby('animation', RIGBY, 'nope')).code, 1);

  const pose = await rigby('pose', RIGBY, '-a', 'release', '-t', '0.5', '--json');
  assert.equal(pose.json.animation, 'release');
  assert.equal(pose.json.bones.length, 11);

  const valid = await rigby('validate', RIGBY);
  assert.equal(valid.code, 0);
  assert.match(valid.out, /^valid: /);
  // A skeleton without its images is checked, but not failed for that.
  const turn = await rigby('validate', TURN, '--json');
  assert.equal(turn.json.checks.structure, 'ok');
});

test('cli: validate exits with 1 for an invalid project', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'broken.json');
  const obj = JSON.parse(await fs.readFile(TURN, 'utf8'));
  obj.slots[0].bone = 'no-such-bone';
  await fs.writeFile(file, JSON.stringify(obj));
  const r = await rigby('validate', file);
  assert.equal(r.code, 1);
});

// ---- writing ----------------------------------------------------------------------------------

test('cli: convert to skeleton JSON, .skel and back to a work file', async () => {
  const dir = await tmpDir();
  const json = path.join(dir, 'rt.json');
  assert.equal((await rigby('convert', RIGBY, json, '--version', '4.2')).code, 0);
  assert.match(JSON.parse(await fs.readFile(json, 'utf8')).skeleton.spine, /^4\.2/);
  // Existing files are kept unless --force.
  const again = await rigby('convert', RIGBY, json);
  assert.equal(again.code, 1);
  assert.match(again.err, /already exists\. Pass --force/);
  assert.equal((await rigby('convert', RIGBY, json, '--force')).code, 0);
  assert.equal((await rigby('convert', RIGBY, path.join(dir, 'deep/er/rt.skel'))).code, 0);
  assert.equal((await rigby('convert', RIGBY, path.join(dir, 'rt.skel'), '--version', '4.2')).code, 1);
  // A skeleton with no images still becomes a work file.
  const back = await rigby('convert', TURN, path.join(dir, 'turn.rigby'), '--json');
  assert.equal(back.code, 0);
  assert.equal(back.json.missingImages.length, 5);
  assert.equal((await rigby('inspect', path.join(dir, 'turn.rigby'), '--json')).json.counts.bones, 6);
});

test('cli: export packs an atlas, and the export opens again with its images', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'game/rt.json');
  const r = await rigby('export', RIGBY, '--out', out, '--json');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.regions, 10);
  const atlas = parseAtlas(await fs.readFile(path.join(dir, 'game/rt.atlas'), 'utf8'));
  assert.equal(atlas.pages[0].name, 'rt.png');
  assert.equal(atlas.pages[0].regions.length, 10);
  assert.ok(await exists(path.join(dir, 'game/rt.png')));
  // The export validates with its images, and converts back to a complete work file.
  assert.equal((await rigby('validate', out, '--json')).json.checks.images, 'ok');
  const work = path.join(dir, 'rt.rigby');
  assert.equal((await rigby('convert', out, work, '--json')).json.missingImages.length, 0);
  const entries = unzip(new Uint8Array(await fs.readFile(work)));
  assert.equal([...entries.keys()].filter((k) => k.startsWith('images/')).length, 10);
  assert.equal((await rigby('validate', work, '--json')).json.valid, true);

  const skel = await rigby('export', RIGBY, '-F', 'skel', '--out', path.join(dir, 'bin/rt.skel'));
  assert.equal(skel.code, 0);
  assert.equal((await rigby('export', RIGBY, '--out', path.join(dir, 'x.txt'))).code, 2);
});

test('cli: export sprite sheets and a Defold model', async () => {
  const dir = await tmpDir();
  const sheet = await rigby('export', RIGBY, '-F', 'spritesheet', '--out', path.join(dir, 'sheet'), '-a', 'hold', '--fps', '6', '--scale', '0.25', '--json');
  assert.equal(sheet.code, 0, sheet.out);
  assert.ok(sheet.json.files.includes('rigbytron.json'));
  const defold = await rigby('export', RIGBY, '-F', 'defold', '--out', path.join(dir, 'defold'), '--folder', '/assets/rt', '-a', 'hold', '--json');
  assert.equal(defold.code, 0, defold.out);
  assert.equal(defold.json.folder, '/assets/rt');
  assert.ok(await exists(path.join(dir, 'defold/rigbytron.rigbymodel')));
});

/** A small layered PSD: two rectangles. */
function samplePsd() {
  const layer = (name, left, top, w, h, rgb) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
    return { name, left, top, imageData: { width: w, height: h, data } };
  };
  return writePsd({ width: 200, height: 300, children: [layer('body', 50, 100, 100, 150, [200, 80, 40]), layer('head', 70, 20, 60, 60, [240, 200, 160])] }, { noBackground: true, generateThumbnail: false });
}

test('cli: import-psd lays the layers out as slots', async () => {
  const dir = await tmpDir();
  const psd = path.join(dir, 'hero.psd');
  await fs.writeFile(psd, new Uint8Array(samplePsd()));
  const r = await rigby('import-psd', psd, '--json');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.layers, ['body', 'head']);
  const rig = (await rigby('rig', path.join(dir, 'hero.rigby'), '--json')).json;
  assert.deepEqual(rig.slots.map((s) => s.name), ['body', 'head']);
  // The canvas' bottom center is the origin: the body's center is at (0, 300 - 175).
  const pose = (await rigby('pose', path.join(dir, 'hero.rigby'), '--json')).json;
  assert.deepEqual(pose.bounds, { minX: -50, minY: 50, maxX: 50, maxY: 280 });
  assert.equal((await rigby('import-psd', psd)).code, 1);
  assert.equal((await rigby('import-psd', psd, '--out', path.join(dir, 'x.json'))).code, 2);
});

test('cli: call runs any tool, with JSON or --key value arguments', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'turn.json');
  await fs.copyFile(TURN, file);
  const add = await rigby('call', 'add_bone', '--path', file, '--name', 'tail', '--parent', 'root', '--x', '10', '--json');
  assert.equal(add.code, 0, add.out);
  const args = path.join(dir, 'args.json');
  await fs.writeFile(args, JSON.stringify({ path: file, animation: 'wave' }));
  const key = await rigby('call', 'set_bone_key', JSON.stringify({ bone: 'tail', channel: 'rotate', time: 0.5, value: 30 }), '--args-file', args, '--json');
  assert.equal(key.code, 0, key.out);
  const pose = (await rigby('pose', file, '-a', 'wave', '-t', '0.5', '--json')).json;
  assert.equal(pose.bones.find((b) => b.name === 'tail').rotation, 30);
  const listed = await rigby('tools', '--json');
  assert.ok(listed.json.some((t) => t.name === 'batch_edit'));
  assert.equal((await rigby('call', 'add_bone', '--path', file)).code, 2);
  assert.equal((await rigby('call', 'nope')).code, 2);
});

test('cli: run executes a Python script and saves, or rolls back on errors', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'edited.rigby');
  const query = await rigby('run', RIGBY, '--code', 'import rigby\nprint(len(rigby.bones()), "bones")', '--dry-run', '--json');
  assert.equal(query.code, 0, query.out);
  assert.deepEqual(query.json.output, ['11 bones']);
  const script = path.join(dir, 'add.py');
  await fs.writeFile(script, "import rigby\nrigby.add_bone('extra', parent='root')\n");
  assert.equal((await rigby('run', RIGBY, script, '--out', out)).code, 0);
  assert.equal((await rigby('inspect', out, '--json')).json.counts.bones, 12);
  const failed = await rigby('run', out, '--code', "raise ValueError('boom')");
  assert.equal(failed.code, 1);
  assert.match(failed.err, /ValueError: boom/);
  assert.equal((await rigby('run', RIGBY)).code, 2);
});

// ---- render planning (rendering itself needs a GPU and a browser) ----------------------------

const INFO = { name: 'Hero Rig', animations: [{ name: 'walk' }, { name: 'run fast' }], skins: ['red'], settings: { fps: 30, width: 1279, height: 720, background: null, frame: null } };

test('cli render: jobs, file names and settings', () => {
  const one = planJobs(INFO, { out: '/r/walk.mp4', animation: ['walk'] });
  assert.equal(one.length, 1);
  assert.equal(one[0].name, 'walk');
  assert.equal(one[0].format, 'mp4');
  // Jobs are the Render dialog's: the project settings as they are (its MP4 encoder evens the size).
  assert.deepEqual(one[0].settings, INFO.settings);
  assert.notEqual(one[0].settings, INFO.settings);
  assert.equal(jobTarget(one[0], { start: 0, end: 30 }), '/r/walk.mp4');
  assert.equal(jobTarget({ ...one[0], format: 'png' }, { start: 0, end: 30 }), '/r/walk_0000.png');
  // Windows paths keep their separators.
  assert.equal(jobTarget(planJobs(INFO, { out: 'C:\\r\\walk.webm', animation: ['walk'] })[0], { start: 0, end: 1 }), 'C:\\r\\walk.webm');

  const all = planJobs(INFO, { out: '/r/hero.webm', all: true, fps: 24, background: '#ff000080' });
  assert.deepEqual(all.map((j) => j.name), ['hero_walk', 'hero_run_fast']);
  assert.equal(all[0].settings.fps, 24);
  assert.deepEqual(all[0].settings.background.map((v) => Math.round(v * 100) / 100), [1, 0, 0, 0.5]);
  assert.equal(all[0].width, undefined);

  const folder = planJobs(INFO, { out: '/r', outIsDir: true, animation: ['walk'], skin: ['default', 'red'], format: 'png' });
  assert.deepEqual(folder.map((j) => [j.name, j.skin]), [['Hero_Rig_walk_default', null], ['Hero_Rig_walk_red', 'red']]);
  const pattern = planJobs(INFO, { out: '/r/{animation}-{skin}.gif', all: true });
  assert.deepEqual(pattern.map((j) => j.name), ['walk-default', 'run_fast-default']);
  // Frame ranges only apply to a single render.
  assert.equal(planJobs(INFO, { out: '/r/a.png', animation: ['walk'], start: 3, end: 9 })[0].start, 3);
  assert.equal(planJobs(INFO, { out: '/r/a.png', all: true, start: 3 })[0].start, null);
});

test('cli render: mistakes are caught before rendering', () => {
  assert.throws(() => planJobs(INFO, { out: '/r/a.mp4' }), /--animation <name> or --all/);
  assert.throws(() => planJobs(INFO, { out: '/r/a.mp4', animation: ['fly'] }), /No animation 'fly'/);
  assert.throws(() => planJobs(INFO, { out: '/r/a.mp4', animation: ['walk'], skin: ['blue'] }), /No skin 'blue'/);
  assert.throws(() => planJobs(INFO, { out: '/r/a.avi', animation: ['walk'] }), /not 'avi'/);
  assert.throws(() => planJobs(INFO, { out: '/r/a.mp4', animation: ['walk'], fps: 0 }), /--fps/);
  assert.throws(() => planJobs({ ...INFO, animations: [] }, { out: '/r/a.mp4' }), /no animations/);
  assert.throws(() => planJobs(INFO, { out: '/r/{skin}.png', all: true }), /same file name/);
  assert.throws(() => parseColor('red'), /colour like #202020/);
  assert.equal(parseColor('none'), null);
});

test('cli render: GPU only: NVENC for H.264 and the discrete GPU for Chromium', () => {
  const args = ffmpegArgs({ width: 1920, height: 1080, fps: 30, quality: 'high', audio: 'a.wav', output: 'o.mp4' });
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_nvenc');
  assert.ok(!args.includes('libx264'));
  assert.ok(args.includes('a.wav'));
  assert.ok(args.includes('vflip,format=yuv420p'));
  for (const flag of ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu']) assert.ok(GPU_ARGS.includes(flag));
});

test('cli: text output', () => {
  const text = formatText({ name: 'x', list: [1, 2], none: [], rows: [{ a: 1, b: 'two' }], nested: { deep: { v: null } } });
  assert.equal(text, 'name: x\nlist: 1, 2\nnone: none\nrows:\n  - a: 1, b: two\nnested:\n  deep:\n    v: -');
});

// ---- the desktop app engine ---------------------------------------------------------------------

test('cli render app: the app gets the same options back, paths made absolute', () => {
  const opts = { out: 'renders/', format: 'webm', animation: ['walk', 'run'], skin: ['red'], fps: 24, width: 640, height: 360, background: '#202020', quality: 'medium', start: 2, end: 9, force: true, allowSoftware: true };
  const args = appArgs('hero.rigby', opts);
  assert.equal(args[0], '--render');
  assert.equal(args[1], path.resolve('hero.rigby'));
  // The app parses them with the same option table as rigby render.
  const back = parseArgs(args.slice(1), { positionals: ['project'], options: { ...RENDER_OPTIONS, 'allow-software': { type: 'boolean' } } });
  assert.equal(back.positionals.project, path.resolve('hero.rigby'));
  assert.equal(back.options.out, path.resolve('renders') + path.sep);
  for (const k of ['format', 'animation', 'skin', 'fps', 'width', 'height', 'background', 'quality', 'start', 'end', 'force', 'allowSoftware']) assert.deepEqual(back.options[k], opts[k], k);
  // Options left out stay out (the app then uses the project's output settings).
  assert.deepEqual(appArgs('a.rigby', { out: 'a.mp4', all: true }).slice(2), ['--out', path.resolve('a.mp4'), '--all']);
});

test('cli render app: where the app is looked for', () => {
  const win = appCandidates({ platform: 'win32', env: { PATH: 'C:\\Tools;C:\\Bin', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' } });
  assert.equal(win[0], 'C:\\Tools\\Rigby2D.exe');
  assert.ok(win.includes('C:\\Users\\u\\AppData\\Local\\Rigby2D\\Rigby2D.exe'));
  assert.ok(win.includes('C:\\Program Files\\Rigby2D\\Rigby2D.exe'));
  assert.ok(appCandidates({ platform: 'darwin', env: { HOME: '/Users/u' } }).includes('/Applications/Rigby2D.app/Contents/MacOS/Rigby2D'));
  assert.ok(appCandidates({ platform: 'linux', env: { PATH: '/opt/bin' } }).includes('/opt/bin/rigby2d'));
});

test('cli render app: only an app with the render mode is used on its own', async () => {
  assert.ok(compareVersions('0.6.0', APP_RENDER_VERSION) >= 0);
  assert.ok(compareVersions('0.5.1', APP_RENDER_VERSION) < 0);
  assert.ok(compareVersions('0.10.0', '0.6.0') > 0);
  const env = { PATH: '', LOCALAPPDATA: 'L' };
  const installed = path.win32.join('L', 'Rigby2D', 'Rigby2D.exe');
  const deps = (version, present = [installed]) => ({ platform: 'win32', env, exists: async (p) => present.includes(p), versionOf: async () => version });
  assert.deepEqual(await findApp(undefined, deps('0.6.0')), { exe: installed, version: '0.6.0', source: 'installed' });
  // An older app would open its editor window: it is reported, not used.
  assert.deepEqual(await findApp(undefined, deps('0.5.1')), { exe: null, tooOld: [`${installed} (0.5.1)`] });
  assert.deepEqual(await findApp(undefined, deps(null)), { exe: null, tooOld: [`${installed} (unknown version)`] });
  assert.equal(await findApp(undefined, deps('0.6.0', [])), null);
  // --app and RIGBY2D_APP are used as given (development builds).
  assert.equal((await findApp('dev/rigby2d.exe', deps(null, ['dev/rigby2d.exe']))).source, '--app');
  assert.equal((await findApp(undefined, { ...deps(null, ['x.exe']), env: { RIGBY2D_APP: 'x.exe' } })).source, 'RIGBY2D_APP');
  await assert.rejects(findApp('missing.exe', deps(null, [])), /not found at missing.exe/);
});

test('cli render app: the report becomes progress and a result', () => {
  const log = [];
  const state = {};
  const on = appReporter((t) => log.push(t), state);
  on('[1114/120000.123:ERROR:gpu] not json');
  assert.equal(state.seen, undefined);
  on(JSON.stringify({ type: 'gpu', gpu: 'NVIDIA GTX', encoder: 'hardware H.264 (WebCodecs)' }));
  on(JSON.stringify({ type: 'start', animation: 'walk', skin: 'default', frames: 49, width: 1920, height: 1080, fps: 30, format: 'mp4' }));
  on(JSON.stringify({ type: 'progress', done: 49, total: 49 }));
  on(JSON.stringify({ type: 'done', result: { engine: 'app', renders: [] } }));
  assert.equal(state.seen, true);
  assert.deepEqual(state.result, { engine: 'app', renders: [] });
  assert.deepEqual(log, ['GPU: NVIDIA GTX (encoder: hardware H.264 (WebCodecs))', 'Rendering walk: 49 frame(s) at 1920×1080, 30 fps → mp4', '  frame 49/49']);
  on(JSON.stringify({ type: 'error', message: 'boom' }));
  assert.equal(state.error, 'boom');
});

test('cli render: --engine app without an app fails clearly; a bad format fails before rendering', async () => {
  const r = await rigby('render', RIGBY, '--out', path.join(os.tmpdir(), 'x.avi'), '--json');
  assert.equal(r.code, 1);
  assert.match(r.json.error, /not 'avi'/);
  assert.equal((await rigby('render', RIGBY, '--out', 'x.mp4', '--engine', 'gpu')).code, 2);
  const missing = await rigby('render', RIGBY, '--out', path.join(os.tmpdir(), 'x.mp4'), '--engine', 'app', '--app', path.join(os.tmpdir(), 'no-such-app.exe'), '--json');
  assert.equal(missing.code, 1);
  assert.match(missing.json.error, /app was not found/);
});

test('cli render: MP4 goes to NVENC when there is such an ffmpeg, everything else to the app', async () => {
  const yes = { ffmpeg: async () => 'ffmpeg' };
  const no = {
    ffmpeg: async () => {
      throw new Error('no nvenc');
    },
  };
  assert.equal((await chooseEngine(undefined, 'mp4', undefined, yes)).name, 'chromium');
  assert.equal((await chooseEngine(undefined, 'mp4', undefined, no)).name, 'app');
  assert.equal((await chooseEngine(undefined, 'webm', undefined, yes)).name, 'app');
  assert.equal((await chooseEngine('app', 'mp4', undefined, yes)).name, 'app');
  assert.equal((await chooseEngine('chromium', 'png', undefined, no)).name, 'chromium');
});
