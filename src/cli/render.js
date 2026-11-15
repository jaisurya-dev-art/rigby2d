// SPDX-License-Identifier: MIT OR Apache-2.0
// `rigby render`: film output from the command line, on the GPU, with two engines:
//  - app: the installed Rigby2D desktop app renders in its windowless render mode
//    (`Rigby2D --render ...`, src/editor/rendermode.js), exactly as its Render dialog does;
//  - chromium: the editor's frame renderer in headless Chromium (Playwright) on the discrete GPU,
//    with MP4 frames encoded by ffmpeg's NVIDIA encoder (h264_nvenc) and WebM / PNG / GIF by the
//    editor's encoders. For machines without the app, such as CI.
// The default is the app when one that has the render mode is found, else Chromium.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ToolError } from '../mcp/protocol.js';
import { RenderError, jobTarget, planJobs, renderFormat } from '../editor/render/plan.js';
import { checkTargets, exists } from './project.js';

export { QUALITIES, RENDER_FORMATS, RENDER_OPTIONS, parseColor, planJobs } from '../editor/render/plan.js';

const SRC = path.resolve(fileURLToPath(import.meta.url), '../..');

/** Chromium switches that put WebGL on the discrete GPU (not the integrated one or SwiftShader). */
export const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'];

/** The first desktop app version with the windowless render mode. */
export const APP_RENDER_VERSION = '0.6.0';

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.wasm': 'application/wasm', '.css': 'text/css' };

// ---- ffmpeg -----------------------------------------------------------------------------------

function run(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve({ code, out }));
  });
}

/** ffmpeg (from --ffmpeg, RIGBY_FFMPEG or PATH) with the NVIDIA H.264 encoder, or a ToolError. */
export function findFfmpeg(given) {
  const cmd = given ?? process.env.RIGBY_FFMPEG ?? 'ffmpeg';
  // Asked once per ffmpeg: the engine choice and the render then agree.
  if (!ffmpegChecks.has(cmd)) ffmpegChecks.set(cmd, checkFfmpeg(cmd));
  return ffmpegChecks.get(cmd);
}

const ffmpegChecks = new Map();

async function checkFfmpeg(cmd) {
  const r = await run(cmd, ['-hide_banner', '-encoders']);
  if (!r) throw new ToolError(`MP4 rendering needs ffmpeg: '${cmd}' was not found. Install ffmpeg, or pass --ffmpeg <path>.`);
  if (!/\bh264_nvenc\b/.test(r.out)) throw new ToolError(`'${cmd}' has no h264_nvenc encoder: MP4 renders on an NVIDIA GPU (NVENC). Use an ffmpeg build with NVENC, or render .webm or .png.`);
  return cmd;
}

/** ffmpeg arguments for raw RGBA frames (bottom row first) to H.264 on the GPU, with optional audio. */
export function ffmpegArgs({ width, height, fps, quality, audio, output }) {
  const cq = { high: 18, medium: 23, low: 28 }[quality] ?? 18;
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0',
    ...(audio ? ['-i', audio] : []),
    '-vf', 'vflip,format=yuv420p',
    '-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0',
    ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    '-movflags', '+faststart',
    output,
  ];
}

// ---- local server -----------------------------------------------------------------------------

/**
 * Serves the page and Rigby2D's sources, the project folder read-only, and takes files and frames.
 * `sink.file(name, bytes)` and `sink.frame(bytes)` receive POSTs.
 */
function startServer(projectDir, sink) {
  const inside = (root, p) => {
    const rel = path.relative(root, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const fail = (code, text) => {
      res.writeHead(code, { 'content-type': 'text/plain' });
      res.end(text);
    };
    try {
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        if (url.pathname === '/frame') await sink.frame(body);
        else if (url.pathname === '/file') await sink.file(url.searchParams.get('name') ?? '', body);
        else return fail(404, 'not found');
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<!doctype html><meta charset="utf-8"><title>Rigby2D render</title><script type="module" src="/src/cli/render-page.js"></script>');
      }
      if (url.pathname === '/fs' || url.pathname === '/ls') {
        const p = path.resolve(projectDir, url.searchParams.get('path') ?? '');
        if (!inside(projectDir, p)) return fail(403, `${p} is outside the project folder`);
        if (url.pathname === '/ls') {
          const names = await fs.readdir(p).catch(() => []);
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify(names));
        }
        const bytes = await fs.readFile(p).catch(() => null);
        if (!bytes) return fail(404, `${p} not found`);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(bytes);
      }
      if (url.pathname.startsWith('/src/')) {
        const p = path.resolve(SRC, decodeURIComponent(url.pathname.slice(5)));
        if (!inside(SRC, p)) return fail(403, 'forbidden');
        const bytes = await fs.readFile(p).catch(() => null);
        if (!bytes) return fail(404, 'not found');
        res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
        return res.end(bytes);
      }
      fail(404, 'not found');
    } catch (e) {
      fail(500, e.message);
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---- app engine -------------------------------------------------------------------------------

/** Compares dotted versions: negative when a < b. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Where the desktop app may be installed, most likely first: on PATH, then the installers' folders
 * (Windows: per-user NSIS in %LOCALAPPDATA%\Rigby2D, MSI in Program Files; macOS: Applications;
 * Linux: /usr/bin from the .deb).
 */
export function appCandidates({ platform = process.platform, env = process.env } = {}) {
  const names = platform === 'win32' ? ['Rigby2D.exe', 'rigby2d.exe'] : platform === 'darwin' ? [] : ['rigby2d', 'Rigby2D'];
  const sep = platform === 'win32' ? ';' : ':';
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const out = [];
  for (const dir of (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean)) for (const n of names) out.push(join(dir, n));
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) out.push(join(env.LOCALAPPDATA, 'Rigby2D', 'Rigby2D.exe'), join(env.LOCALAPPDATA, 'Programs', 'Rigby2D', 'Rigby2D.exe'));
    for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) out.push(join(pf, 'Rigby2D', 'Rigby2D.exe'));
  } else if (platform === 'darwin') {
    out.push('/Applications/Rigby2D.app/Contents/MacOS/Rigby2D');
    if (env.HOME) out.push(join(env.HOME, 'Applications/Rigby2D.app/Contents/MacOS/Rigby2D'));
  } else {
    out.push('/usr/bin/rigby2d', '/usr/local/bin/rigby2d');
  }
  return [...new Set(out)];
}

/** The installed app's version, or null when it cannot be told. */
export async function appVersion(exe, platform = process.platform) {
  if (platform === 'win32') {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`]);
    return r?.code === 0 && /^\d+\.\d+/.test(r.out.trim()) ? r.out.trim() : null;
  }
  if (platform === 'darwin') {
    const plist = await fs.readFile(path.join(path.dirname(exe), '..', 'Info.plist'), 'utf8').catch(() => '');
    return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null;
  }
  const r = await run('dpkg-query', ['-W', '-f=${Version}', 'rigby2d']);
  return r?.code === 0 && r.out.trim() ? r.out.trim() : null;
}

/**
 * The desktop app to render with: { exe, version, source } or null. `--app` and RIGBY2D_APP are
 * used as given (they may be development builds); an app found on its own is used only when it
 * is new enough to have the render mode, since an older one would open its editor window instead.
 * `deps` ({ platform, env, exists, versionOf }) is for tests.
 */
export async function findApp(given, deps = {}) {
  const env = deps.env ?? process.env;
  const has = deps.exists ?? exists;
  const versionOf = deps.versionOf ?? ((exe) => appVersion(exe, deps.platform));
  const explicit = given ?? env.RIGBY2D_APP;
  if (explicit) {
    if (!(await has(explicit))) throw new ToolError(`The Rigby2D app was not found at ${explicit}${given ? '' : ' (RIGBY2D_APP)'}.`);
    return { exe: explicit, version: null, source: given ? '--app' : 'RIGBY2D_APP' };
  }
  const tooOld = [];
  for (const exe of appCandidates({ platform: deps.platform, env })) {
    if (!(await has(exe))) continue;
    const version = await versionOf(exe);
    if (version && compareVersions(version, APP_RENDER_VERSION) >= 0) return { exe, version, source: 'installed' };
    tooOld.push(`${exe} (${version ?? 'unknown version'})`);
  }
  return tooOld.length ? { exe: null, tooOld } : null;
}

/** The app's command line for a render: `--render <project>` and the render options, paths absolute. */
export function appArgs(project, opts) {
  const args = ['--render', path.resolve(project), '--out', /[\\/]$/.test(opts.out) ? `${path.resolve(opts.out)}${path.sep}` : path.resolve(opts.out)];
  const list = (name, v) => (v?.length ? [`--${name}`, v.join(',')] : []);
  const value = (name, v) => (v === undefined || v === null ? [] : [`--${name}`, String(v)]);
  const flag = (name, v) => (v ? [`--${name}`] : []);
  args.push(
    ...value('format', opts.format),
    ...list('animation', opts.animation),
    ...flag('all', opts.all),
    ...list('skin', opts.skin),
    ...value('fps', opts.fps),
    ...value('width', opts.width),
    ...value('height', opts.height),
    ...value('background', opts.background),
    ...value('quality', opts.quality),
    ...value('start', opts.start),
    ...value('end', opts.end),
    ...flag('force', opts.force),
    ...flag('allow-software', opts.allowSoftware),
  );
  return args;
}

/**
 * Turns the app's report (JSON lines, see src/editor/rendermode.js) into progress messages and the
 * result. Returns a line handler; `state` collects { result, error }.
 */
export function appReporter(log, state) {
  return (text) => {
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      return; // not a report line (driver or WebView messages)
    }
    state.seen = true;
    if (line.type === 'gpu') log(`GPU: ${line.gpu} (encoder: ${line.encoder})`);
    else if (line.type === 'start') log(`Rendering ${line.animation}${line.skin !== 'default' ? ` (${line.skin})` : ''}: ${line.frames} frame(s) at ${line.width}×${line.height}, ${line.fps} fps → ${line.format}`);
    else if (line.type === 'progress') log(`  frame ${line.done}/${line.total}`);
    else if (line.type === 'done') state.result = line.result;
    else if (line.type === 'error') state.error = line.message;
  };
}

/** The app engine: runs the app's render mode and relays its report. */
async function renderApp(app, project, opts, log) {
  log(`Rendering with the Rigby2D app: ${app.exe}${app.version ? ` (${app.version})` : ''}`);
  const state = { result: null, error: null, seen: false };
  const onLine = appReporter(log, state);
  const child = spawn(app.exe, appArgs(project, opts), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, i).trim());
      buffer = buffer.slice(i + 1);
    }
  });
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  // An app that never reports (it opened its editor instead, or its window could not start) is stopped.
  const timer = setTimeout(() => {
    if (!state.seen) {
      state.error = 'The app did not start its render mode within 60 seconds (is it Rigby2D 0.6 or newer?).';
      child.kill();
    }
  }, 60000);
  const code = await new Promise((resolve) => {
    child.on('error', (e) => {
      state.error ??= `The app could not start: ${e.message}`;
      resolve(-1);
    });
    child.on('close', resolve);
  });
  clearTimeout(timer);
  if (buffer.trim()) onLine(buffer.trim());
  if (state.error) throw new ToolError(state.error);
  if (code !== 0 || !state.result) throw new ToolError(`The app's render ended without a result (exit code ${code}).${stderr.trim() ? `\n${stderr.trim()}` : ''}`);
  return state.result;
}

// ---- render -----------------------------------------------------------------------------------

/**
 * Which engine renders when --engine is not given. Everything goes to the app, except MP4: the
 * app's WebCodecs H.264 (as in its Render dialog) was measured encoding on the CPU in WebView2, so
 * MP4 goes to Chromium + ffmpeg NVENC when such an ffmpeg is there, keeping the encode on the GPU.
 * `deps.ffmpeg(given)` (for tests) resolves when ffmpeg with h264_nvenc is found.
 */
export async function chooseEngine(engine, format, ffmpeg, deps = {}) {
  if (engine) return { name: engine };
  if (format !== 'mp4') return { name: 'app' };
  const nvenc = await (deps.ffmpeg ?? findFfmpeg)(ffmpeg).then(() => true, () => false);
  return nvenc ? { name: 'chromium', note: 'MP4: encoding with ffmpeg on the GPU (NVENC); --engine app renders it in the app instead.' } : { name: 'app' };
}

/**
 * Renders a project. `opts`: { out, format, animation (list), all, skin (list), fps, width, height,
 * background, quality, start, end, force, engine ('app' | 'chromium'), app, ffmpeg, allowSoftware,
 * onProgress(text) }. Returns { engine, gpu, format, width, height, fps, renders: [{ animation,
 * skin, frames, files, first }], warnings }.
 */
export async function render(project, opts) {
  const file = path.resolve(project);
  if (!(await exists(file))) throw new ToolError(`File not found: ${project}`);
  const out = path.resolve(opts.out);
  const outIsDir = /[\\/]$/.test(opts.out) || (await fs.stat(out).then((s) => s.isDirectory(), () => false));
  // What can be checked without a renderer fails fast.
  let format;
  try {
    format = renderFormat(out, outIsDir, opts.format);
  } catch (e) {
    throw new ToolError(e.message);
  }
  const log = opts.onProgress ?? (() => {});
  const engine = await chooseEngine(opts.engine ?? (opts.app ? 'app' : undefined), format, opts.ffmpeg);
  if (engine.note) log(engine.note);
  if (engine.name === 'app') {
    const app = await findApp(opts.app);
    if (app?.exe) return renderApp(app, file, { ...opts, out: opts.out }, log);
    const why = app?.tooOld ? `the installed app is older than ${APP_RENDER_VERSION}: ${app.tooOld.join(', ')}` : 'no Rigby2D desktop app was found';
    if (opts.engine === 'app') throw new ToolError(`Cannot render with the app: ${why}. Install Rigby2D ${APP_RENDER_VERSION} or newer, or pass --app <path>.`);
    log(`Rendering with Chromium (${why}).`);
  }
  return renderChromium(file, project, opts, { out, outIsDir, format });
}

// ---- Chromium engine -----------------------------------------------------------------------------------

/** The Chromium engine (see the top of this file). */
async function renderChromium(file, project, opts, { out, outIsDir, format }) {
  const ffmpeg = format === 'mp4' ? await findFfmpeg(opts.ffmpeg) : null;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new ToolError('Rendering needs Playwright: run npm install in the Rigby2D folder (then npx playwright install chromium).');
  }
  const log = opts.onProgress ?? (() => {});
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-render-'));
  let current = null; // { dir, files, ffmpeg }
  const sink = {
    async file(name, bytes) {
      if (!name || name !== path.basename(name)) throw new Error(`bad file name '${name}'`);
      const target = name.startsWith('__') ? path.join(temp, name) : path.join(current.dir, name);
      await fs.writeFile(target, bytes);
      if (!name.startsWith('__')) current.files.push(target);
    },
    async frame(bytes) {
      const stdin = current?.ffmpeg?.stdin;
      if (!stdin || stdin.destroyed) throw new Error('the encoder is not running');
      if (!stdin.write(bytes)) await new Promise((resolve) => stdin.once('drain', resolve));
    },
  };
  const server = await startServer(path.dirname(file), sink);
  let browser;
  try {
    try {
      browser = await chromium.launch({ args: GPU_ARGS });
    } catch (e) {
      throw new ToolError(`Chromium could not start (${e.message.split('\n')[0]}). Run npx playwright install chromium.`);
    }
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let lastLine = 0;
    await page.exposeFunction('rigbyProgress', (n, total) => {
      const now = Date.now();
      if (n === total || now - lastLine > 500) {
        lastLine = now;
        log(`  frame ${n}/${total}`);
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.rigbyRender, null, { timeout: 30000 }).catch(() => {
      throw new ToolError(`The render page did not load${errors.length ? `: ${errors[0]}` : ''}.`);
    });
    const gpu = await page.evaluate(() => window.rigbyRender.gpu());
    if (!gpu) throw new ToolError('WebGL is not available in Chromium: rendering needs a GPU.');
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(gpu) && !opts.allowSoftware) {
      throw new ToolError(`Chromium fell back to software rendering (${gpu}). Rendering needs the GPU: update the graphics driver, or pass --allow-software to render slowly on the CPU.`);
    }
    log(`GPU: ${gpu}`);
    const info = await page.evaluate((p) => window.rigbyRender.open(p), path.basename(file)).catch((e) => {
      throw new ToolError(`Cannot open ${project}: ${e.message.replace(/^.*Error: /s, '')}`);
    });
    const jobs = planJobs(info, { ...opts, out, outIsDir });
    // ffmpeg takes opaque frames: H.264 has no transparency, so they are drawn over black (as the
    // Render dialog's MP4 shows them) or the background, at even sizes.
    for (const job of jobs) {
      if (job.format !== 'mp4') continue;
      const s = job.settings;
      s.background = s.background ? [...s.background.slice(0, 3), 1] : [0, 0, 0, 1];
      Object.assign(job, { width: s.width + (s.width % 2), height: s.height + (s.height % 2) });
    }
    // Check every target before rendering anything.
    const ranges = [];
    for (const job of jobs) ranges.push(await page.evaluate((j) => window.rigbyRender.range(j), job));
    await fs.mkdir(jobs[0].dir, { recursive: true });
    await checkTargets(jobs.map((j, k) => jobTarget(j, ranges[k])), opts.force);

    const renders = [];
    for (const [k, job] of jobs.entries()) {
      const label = `${job.animationName}${job.skin ? ` (${job.skin})` : ''}`;
      log(`Rendering ${label}: ${ranges[k].count} frame(s) at ${job.width ?? job.settings.width}×${job.height ?? job.settings.height}, ${job.settings.fps} fps → ${job.format}`);
      current = { dir: job.dir, files: [], ffmpeg: null };
      if (job.format === 'mp4') {
        const audio = (await page.evaluate(({ j, n }) => window.rigbyRender.audio(j, n), { j: job, n: '__audio.wav' })) ? path.join(temp, '__audio.wav') : null;
        const output = path.join(job.dir, `${job.name}.mp4`);
        const child = spawn(ffmpeg, ffmpegArgs({ width: job.width, height: job.height, fps: job.settings.fps, quality: job.quality, audio, output }), { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d));
        child.stdin.on('error', () => {});
        const done = new Promise((resolve) => child.on('close', resolve));
        current.ffmpeg = child;
        try {
          await page.evaluate((j) => window.rigbyRender.frames(j), job);
        } finally {
          child.stdin.end();
        }
        const code = await done;
        if (code !== 0) throw new ToolError(`ffmpeg (h264_nvenc) failed: ${stderr.trim() || `exit code ${code}`}`);
        current.files.push(output);
      } else {
        await page.evaluate((j) => window.rigbyRender.encode(j), job);
      }
      // The animation's audio, mixed, next to the render for the editing software (as the Render dialog does).
      await page.evaluate(({ j, n }) => window.rigbyRender.audio(j, n), { j: job, n: `${job.name}.wav` });
      renders.push({ animation: job.animationName, skin: job.skin ?? 'default', frames: ranges[k].count, files: current.files.length, first: current.files[0] ?? null });
    }
    return { engine: 'chromium', gpu, format: jobs[0].format, width: jobs[0].width ?? jobs[0].settings.width, height: jobs[0].height ?? jobs[0].settings.height, fps: jobs[0].settings.fps, renders, warnings: info.warnings };
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e instanceof RenderError) throw new ToolError(e.message);
    throw new ToolError(`Render failed: ${e.message.split('\n')[0]}`);
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}
